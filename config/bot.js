module.exports = {
    bot: {
      prefix: process.env.BOT_PREFIX || '?',
      intents: ["guildMessages", "guilds", "directMessages"],
      status: {
        name: "card drops | ?help",
        type: 3
      }
    },
    
    database: {
      uri: process.env.MONGODB_URI,
      options: {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: 10
      }
    },
    
    redis: {
      url: process.env.REDIS_URL,
      retryStrategy: (times) => Math.min(times * 50, 2000)
    },
    
    cooldowns: {
      drop: 300000, // 5 minutes
      daily: 86400000 // 24 hours
    },
    
    limits: {
      global: { max: 5, window: 60000 }, // 5 commands per minute
      drop: { max: 3, window: 300000 }  // 3 drops per 5 minutes
    }
  };