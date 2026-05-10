const Redis = require('ioredis');
const NodeCache = require('node-cache');

// In-memory fallback for rate limiting when Redis unavailable
const memoryCache = new NodeCache({ stdTTL: 60, checkperiod: 30 });

// Initialize Redis with proper error handling and fallback
let redis = null;
let redisAvailable = false;

const shouldUseRedis = process.env.USE_REDIS === 'true' && process.env.REDIS_URL;

if (shouldUseRedis) {
  try {
    redis = new Redis(process.env.REDIS_URL, {
      retryStrategy: () => null,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 5000
    });

    redis.on('error', () => {
      redisAvailable = false;
    });

    redis.on('connect', () => {
      redisAvailable = true;
    });

    redis.connect().catch(() => {
      redisAvailable = false;
    });
  } catch (err) {
    redis = null;
    redisAvailable = false;
  }
}

module.exports = {
  async checkLimit(userId, command, limit = 10, window = 10000, isWebhook = false) {
    // Skip rate limiting for addcard when used via webhook
    const excludedCommands = ['addcard'];
    if (isWebhook && excludedCommands.includes(command)) {
      return { limited: false };
    }
    
    const key = `ratelimit:${userId}:${command}`;
    const windowSeconds = Math.ceil(window / 1000);
    
    // Use Redis if available, otherwise use memory cache
    if (redis && redisAvailable) {
      try {
        const current = await redis.incr(key);
        
        if (current === 1) {
          await redis.expire(key, windowSeconds);
        }
        
        if (current > limit) {
          const ttl = await redis.ttl(key);
          return { limited: true, retryAfter: ttl };
        }
        
        return { limited: false };
      } catch (err) {
        // Fall through to memory cache on Redis error
        redisAvailable = false;
      }
    }
    
    // Memory cache fallback
    const cached = memoryCache.get(key) || 0;
    const newCount = cached + 1;
    memoryCache.set(key, newCount, windowSeconds);
    
    if (newCount > limit) {
      const ttl = memoryCache.getTtl(key);
      const retryAfter = ttl ? Math.ceil((ttl - Date.now()) / 1000) : windowSeconds;
      return { limited: true, retryAfter };
    }
    
    return { limited: false };
  }
};