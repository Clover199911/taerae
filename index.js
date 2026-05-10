require('dotenv').config(); // Load environment variables
const Eris = require("eris");
const mongoose = require("mongoose");
const Redis = require('ioredis');
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const { DateTime } = require('luxon');
const winston = require('winston'); // Better logging
const { IMAGE_ROOT_ABSOLUTE } = require('./utils/cardImageSource');

// Import services
const CardGenerationService = require('./services/CardGenerationService');
const VoucherExpirationService = require('./services/VoucherExpirationService'); // 🎫 NEW
const { wrapCommand } = require('./middleware/errorHandler');
const rateLimiter = require('./middleware/rateLimiter');
const { ALLOWED_GUILDS } = require('./config/constants');
const Blacklist = require('./models/blacklist');

// Initialize logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'card-bot' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

// Enhanced bot configuration with better connection settings
const bot = new Eris(process.env.BOT_TOKEN, {
  restMode: true,
  intents: ["guildMessages", "guilds", "directMessages", "messageContent"],
  maxShards: "auto",
  allowedMentions: {
    everyone: false,
    roles: false,
    users: true
  },
  requestTimeout: 30000,
  connectionTimeout: 30000,      // Prevents timeout disconnects
  reconnectDelay: 5000,          // Wait 5s before reconnecting
  largeThreshold: 250,           // Better for larger servers
  compress: true                 // Reduces bandwidth usage
});

// Database connection with retry logic
class DatabaseManager {
  constructor() {
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  async connect() {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cardbot';
    
    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err);
      this.isConnected = false;
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
      this.isConnected = false;
      this.attemptReconnect();
    });

    mongoose.connection.on('connected', () => {
      logger.info('Connected to MongoDB');
      this.isConnected = true;
      this.reconnectAttempts = 0;
    });

    try {
      await mongoose.connect(mongoURI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000
      });
    } catch (error) {
      logger.error('Initial MongoDB connection failed:', error);
      this.attemptReconnect();
    }
  }

  async attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached');
      process.exit(1);
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    
    logger.info(`Attempting to reconnect to MongoDB (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms`);
    
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  async gracefulShutdown(signal) {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);
    
    try {
      // 🎫 Stop voucher service
      if (global.voucherService) {
        global.voucherService.stop();
        logger.info('Voucher service stopped');
      }
      
      // Close database connections
      await mongoose.connection.close();
      logger.info('MongoDB connection closed');
      
      // Close Redis
      if (global.redisClient) {
        await global.redisClient.quit();
        logger.info('Redis connection closed');
      }
      
      // Disconnect bot
      await bot.disconnect({ reconnect: false });
      logger.info('Bot disconnected');
      
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  }
}

// Redis setup with reconnection support
let redisClient = null;
let redisConnected = false;

// Check if we should even attempt Redis
const shouldUseRedis = process.env.USE_REDIS === 'true';

if (shouldUseRedis) {
  try {
    redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      retryStrategy: (times) => {
        // Retry with exponential backoff, max 30s
        const delay = Math.min(times * 1000, 30000);
        logger.info(`Redis reconnection attempt ${times}, waiting ${delay}ms`);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
      lazyConnect: true,
      showFriendlyErrorStack: false,
      reconnectOnError: (err) => {
        logger.warn('Redis error, attempting reconnect:', err.message);
        return true; // Always attempt to reconnect
      }
    });

    // Track connection status
    redisClient.on('connect', () => {
      logger.info('✅ Connected to Redis');
      redisConnected = true;
    });

    redisClient.on('ready', () => {
      logger.info('✅ Redis ready for commands');
      redisConnected = true;
    });

    redisClient.on('error', (err) => {
      logger.warn('Redis connection error:', err.message);
      redisConnected = false;
    });

    redisClient.on('close', () => {
      logger.warn('⚠️ Redis connection closed');
      redisConnected = false;
    });

    redisClient.on('reconnecting', () => {
      logger.info('🔄 Reconnecting to Redis...');
      redisConnected = false;
    });

    // Try initial connection
    redisClient.connect().catch((err) => {
      logger.warn('Redis initial connection failed - will retry:', err.message);
      redisConnected = false;
    });

  } catch (err) {
    logger.warn('Redis setup failed - using in-memory fallback:', err.message);
    redisClient = null;
    redisConnected = false;
  }
} else {
  logger.info('💾 Using in-memory fallback (Redis disabled)');
}

// Create a safe Redis wrapper that checks connection status
const safeRedisClient = {
  isConnected: () => redisClient && redisConnected && redisClient.status === 'ready',

  async get(key) {
    if (!this.isConnected()) return null;
    try {
      return await redisClient.get(key);
    } catch (err) {
      logger.warn('Redis GET error:', err.message);
      return null;
    }
  },

  async setex(key, seconds, value) {
    if (!this.isConnected()) return;
    try {
      await redisClient.setex(key, seconds, value);
    } catch (err) {
      logger.warn('Redis SETEX error:', err.message);
    }
  },

  async del(key) {
    if (!this.isConnected()) return;
    try {
      await redisClient.del(key);
    } catch (err) {
      logger.warn('Redis DEL error:', err.message);
    }
  },

  async ping() {
    if (!this.isConnected()) throw new Error('Redis not connected');
    try {
      return await redisClient.ping();
    } catch (err) {
      logger.warn('Redis PING error:', err.message);
      throw err;
    }
  },

  async quit() {
    if (redisClient) {
      try {
        await redisClient.quit();
      } catch (err) {
        logger.warn('Redis QUIT error:', err.message);
      }
    }
  },

  get status() {
    return redisClient ? redisClient.status : 'unavailable';
  }
};

global.redisClient = safeRedisClient;

// Enhanced command manager
class CommandManager {
  constructor() {
    this.commands = new Map();
    this.aliases = new Map();
    this.commandUsage = new Map(); // Track usage for stats
  }

  async loadCommand(filePath) {
    try {
      // Clear require cache for hot reloading in dev
      delete require.cache[require.resolve(filePath)];
      
      const command = require(filePath);
      
      // Validate command structure
      if (!command.name || !command.execute) {
        logger.warn(`Invalid command structure in ${filePath}`);
        return;
      }

      this.commands.set(command.name, command);
      logger.info(`✅ Loaded command: ${command.name}`);

      // Handle aliases
      if (command.aliases?.length) {
        command.aliases.forEach(alias => {
          if (this.aliases.has(alias)) {
            logger.warn(`Alias ${alias} already exists for ${command.name}`);
          }
          this.aliases.set(alias, command.name);
        });
      }

      // Track usage
      this.commandUsage.set(command.name, 0);
    } catch (error) {
      logger.error(`Error loading command from ${filePath}:`, error);
    }
  }

  async loadCommandsFromDirectory(directory) {
    try {
      const items = await fs.readdir(directory, { withFileTypes: true });
      
      await Promise.all(items.map(async (item) => {
        const itemPath = path.join(directory, item.name);
        if (item.isDirectory()) {
          await this.loadCommandsFromDirectory(itemPath);
        } else if (item.isFile() && item.name.endsWith('.js')) {
          await this.loadCommand(itemPath);
        }
      }));
      
      logger.info(`📦 Loaded ${this.commands.size} commands with ${this.aliases.size} aliases`);
    } catch (error) {
      logger.error('Failed to load commands:', error);
    }
  }

  getCommand(commandName) {
    return this.commands.get(commandName) || this.commands.get(this.aliases.get(commandName));
  }

  getUsageStats() {
    return Object.fromEntries(this.commandUsage);
  }
}

// Enhanced maintenance mode
class MaintenanceManager {
  constructor() {
    this.isEnabled = process.env.MAINTENANCE_MODE === 'true';
    this.whitelist = new Set(JSON.parse(process.env.MAINTENANCE_WHITELIST || '[]'));
    this.bypassCommands = new Set(['addcard', 'maintenance']);
  }

  isWhitelisted(userId) {
    return this.whitelist.has(userId);
  }

  canBypassMaintenance(commandName) {
    return this.bypassCommands.has(commandName);
  }

  async toggle(state) {
    this.isEnabled = state;
    return this.isEnabled;
  }
}

// Message handler with rate limiting and validation
class MessageHandler {
  constructor(bot, commandManager, maintenanceManager) {
    this.bot = bot;
    this.commandManager = commandManager;
    this.maintenanceManager = maintenanceManager;
    // Use centralized allowed guilds from config
    this.allowedGuilds = ALLOWED_GUILDS;
  }

  async handleMessage(msg) {
    // Ignore self messages
    if (msg.author.id === bot.user.id) return;

    // Check if message is from an allowed guild (skip DMs)
    if (msg.guildID && !this.allowedGuilds.has(msg.guildID)) {
      // Only send the restriction message once per guild when a command is attempted
      if (msg?.content?.startsWith(process.env.BOT_PREFIX || '>')) {
        return msg.channel.createMessage({
          embeds: [{
            title: "🔒 Access Restricted",
            description: "Access to Taerae is temporarily only available on the support server.",
            color: 0xFF6B6B,
            fields: [{
              name: "Join Support Server",
              value: "[Click here to join](https://discord.gg/kCck9aWGEH)"
            }],
            footer: {
              text: "Thank you for your understanding!"
            }
          }],
          messageReference: { messageID: msg.id }
        }).catch(err => logger.warn('Failed to send restriction message:', err.message));
      }
      return;
    }

    // Validate message structure
    if (!msg?.content?.startsWith(process.env.BOT_PREFIX || '>')) return;

    const args = msg.content.slice((process.env.BOT_PREFIX || '>').length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();
    const command = this.commandManager.getCommand(commandName);

    if (!command) return;

    const isWebhook = !!msg.webhookID;
    const userId = msg.author?.id || 'webhook';
    
    // Skip rate limiting for webhooks using addcard
    const shouldSkipRateLimit = isWebhook && commandName === 'addcard';
    
    // Rate limiting for non-whitelisted users (but only if NOT in maintenance mode)
    if (!shouldSkipRateLimit && !this.maintenanceManager.isWhitelisted(userId)) {
      const rateLimit = await rateLimiter.checkLimit(userId, 'global', 10, 10000);
      if (rateLimit.limited) {
        logger.warn(`Rate limited user ${userId} for ${rateLimit.retryAfter}s`);
        return;
      }
    }

    // Increment usage tracking
    this.commandManager.commandUsage.set(command.name, 
      (this.commandManager.commandUsage.get(command.name) || 0) + 1
    );

    try {
      // Blacklist check - block blacklisted users from all commands
      const isBlacklisted = await Blacklist.findOne({ userId: userId });
      if (isBlacklisted) {
        logger.warn(`Blacklisted user ${userId} attempted to use command: ${commandName}`);
        return msg.channel.createMessage({
          embeds: [{
            title: "🚫 Access Denied",
            description: "You have been blacklisted from using Taerae.\n\nPlease open a ticket to know the reason or to appeal.",
            color: 0xFF4D6D
          }],
          components: [{
            type: 1,
            components: [{
              type: 2,
              style: 5,
              label: "Open Ticket / Appeal",
              url: "https://discord.gg/kCck9aWGEH"
            }]
          }],
          messageReference: { messageID: msg.id }
        });
      }

      // Maintenance mode check - ONLY block if maintenance is ON
      if (this.maintenanceManager.isEnabled && 
          !this.maintenanceManager.isWhitelisted(userId) && 
          !this.maintenanceManager.canBypassMaintenance(command.name)) {
        return msg.channel.createMessage({
          embeds: [{
            title: "🔧 Maintenance Mode",
            description: "The bot is currently under maintenance. Please try again later.",
            color: 0xFFA500
          }],
          messageReference: { messageID: msg.id }
        });
      }

      // Execute command - everyone can use it when maintenance is OFF
      await wrapCommand(command, msg, args, this.bot);
      
    } catch (error) {
      logger.error(`Command execution error (${commandName}):`, error);
    }
  }

  async handleInteraction(interaction) {
    // Handle slash commands and components
    if (interaction.type === 2) { // Slash command
      const command = this.commandManager.getCommand(interaction.data.name);
      if (command?.handleInteraction) {
        await command.handleInteraction(interaction, this.bot);
      }
    } else if (interaction.type === 3) { // Component interaction (button/select menu)
      await this.handleComponentInteraction(interaction);
    }
  }

  async handleComponentInteraction(interaction) {
    const customId = interaction.data.custom_id;
    
    // Handle pack details button
    if (customId.startsWith('pack_details_')) {
      const cache = global.packDetailsCache || new Map();
      const cachedData = cache.get(customId);
      
      if (!cachedData) {
        await interaction.defer(64); // Ephemeral defer
        return interaction.createFollowup({
          flags: 64,
          embeds: [{
            title: '❌ Expired',
            description: 'This pack detail view has expired. Please open a new pack to see details.',
            color: 0xED4245
          }]
        });
      }
      
      // Get user ID (in Eris, use interaction.member.id)
      const userId = interaction.member?.id || interaction.user?.id;
      
      // Check if the user is authorized to view details
      if (cachedData.userId !== userId) {
        await interaction.defer(64); // Ephemeral defer
        return interaction.createFollowup({
          flags: 64,
          embeds: [{
            title: '🔒 Access Denied',
            description: 'You can only view details for packs you opened.',
            color: 0xFEE75C
          }]
        });
      }
      
      // Send the detailed embed ephemerally
      await interaction.defer(64); // Ephemeral defer
      return interaction.createFollowup({
        flags: 64,
        embeds: [cachedData.embed]
      });
    }
  }
}

// Health check server for monitoring
const http = require('http');
function setupHealthCheck() {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health') {
      const health = {
        timestamp: DateTime.now().toISO(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        commands: commandManager.commands.size,
        maintenance: maintenanceManager.isEnabled,
        database: mongoose.connection.readyState === 1 ? 'healthy' : 'unhealthy',
        redis: global.redisClient?.isConnected() ? 'healthy' : 'unhealthy',
        voucherService: global.voucherService?.isRunning ? 'running' : 'stopped' // 🎫 NEW
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health));
    } else if (req.url.startsWith('/images/')) {
      const decodedPath = decodeURIComponent(req.url.split('?')[0]);
      const imageRoot = path.resolve(IMAGE_ROOT_ABSOLUTE);
      const relativeRequestedPath = decodedPath.slice('/images/'.length).replace(/\//g, path.sep);
      const absoluteImagePath = path.resolve(path.join(imageRoot, relativeRequestedPath));

      if (!absoluteImagePath.startsWith(imageRoot)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      if (!fsSync.existsSync(absoluteImagePath)) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      const ext = path.extname(absoluteImagePath).toLowerCase();
      const contentType =
        ext === '.png' ? 'image/png' :
        ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
        ext === '.gif' ? 'image/gif' :
        ext === '.webp' ? 'image/webp' : 'application/octet-stream';

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400'
      });
      fsSync.createReadStream(absoluteImagePath).pipe(res);
    } else if (req.url === '/metrics') {
      // Prometheus-style metrics
      const metrics = `# HELP bot_commands_total Total number of commands executed
# TYPE bot_commands_total counter
bot_commands_total{bot="${bot.user.username}"} ${Array.from(commandManager.commandUsage.values()).reduce((a, b) => a + b, 0)}
`;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(metrics);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  const port = process.env.HEALTH_CHECK_PORT || 8080;
  
  // Add error handling for port in use
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn(`⚠️ Port ${port} already in use, skipping health check server`);
    } else {
      logger.error('Health check server error:', err);
    }
  });
  
  server.listen(port, () => {
    logger.info(`🏥 Health check server listening on port ${port}`);
  });
}

// Initialize bot
async function initialize() {
  logger.info('🚀 Starting bot initialization...');
  
  // Initialize database
  const dbManager = new DatabaseManager();
  await dbManager.connect();

  // Initialize command manager
  const commandManager = new CommandManager();
  await commandManager.loadCommandsFromDirectory(
    path.join(__dirname, 'commands')
  );

  // Initialize maintenance manager
  const maintenanceManager = new MaintenanceManager();

  // Add maintenance command
  commandManager.commands.set("maintenance", {
    name: "maintenance",
    description: "Toggle maintenance mode (admin only)",
    aliases: ["maint"],
    async execute(msg, args) {
      if (!maintenanceManager.isWhitelisted(msg.author.id)) {
        return msg.channel.createMessage({ content: "❌ Unauthorized", messageReference: { messageID: msg.id } });
      }

      const action = args[0]?.toLowerCase();
      if (action === "on" || action === "off") {
        const state = action === "on";
        maintenanceManager.toggle(state);
        await msg.channel.createMessage({ content: `🔧 Maintenance mode ${state ? 'enabled' : 'disabled'}`, messageReference: { messageID: msg.id } });
      } else {
        await msg.channel.createMessage({ content: "Usage: maintenance <on|off>", messageReference: { messageID: msg.id } });
      }
    }
  });

  // Add stats command
  commandManager.commands.set("stats", {
    name: "stats",
    description: "Show bot statistics",
    async execute(msg) {
      const usage = commandManager.getUsageStats();
      return {
        embed: {
          title: "📊 Bot Statistics",
          fields: [
            { name: "Commands Loaded", value: commandManager.commands.size.toString(), inline: true },
            { name: "Uptime", value: `${Math.floor(process.uptime() / 60)}m`, inline: true },
            { name: "Memory Usage", value: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0)}MB`, inline: true }
          ],
          color: 0x00ff00
        }
      };
    }
  });

  // Setup message handler
  const messageHandler = new MessageHandler(bot, commandManager, maintenanceManager);

  // Bot event handlers
  bot.on("ready", () => {
    logger.info(`✅ Bot ready! Logged in as ${bot.user.username}`);
    logger.info(`🌍 Serving ${bot.guilds.size} guilds`);
    
    // 🎫 NEW: Start voucher expiration service
    const voucherService = new VoucherExpirationService(bot);
    voucherService.start();
    global.voucherService = voucherService;
    logger.info('🎫 Voucher expiration service started');
    
    // Setup health check after bot is ready
    setupHealthCheck();
    
    // Set bot status
    bot.editStatus("online", {
      name: "taerae soft launch | ?help",
      type: 3
    });
  });

  bot.on("messageCreate", (msg) => {
    messageHandler.handleMessage(msg).catch(err => {
      logger.error('Message handler error:', err);
    });
  });
  bot.on("interactionCreate", (interaction) => {
    messageHandler.handleInteraction(interaction).catch(err => {
      logger.error('Interaction handler error:', err);
    });
  });
  
  // Connection event handlers
  bot.on("disconnect", () => {
    logger.warn('⚠️ Bot disconnected from Discord');
  });

  bot.on("error", (err) => {
    logger.error('Bot error:', err);
  });

  bot.on("shardDisconnect", (err, id) => {
    logger.warn(`⚠️ Shard ${id} disconnected:`, err);
  });

  bot.on("shardResume", (id) => {
    logger.info(`✅ Shard ${id} resumed`);
  });

  // Error handlers
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection:', { promise, reason });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    // Graceful shutdown on uncaught exception
    setTimeout(() => process.exit(1), 1000);
  });

  // Graceful shutdown
  const signals = ['SIGTERM', 'SIGINT'];
  signals.forEach(signal => {
    process.on(signal, () => dbManager.gracefulShutdown(signal));
  });

  // Connect bot
  await bot.connect();
  logger.info('🔌 Bot connection initiated');
}

// Start everything
initialize().catch((error) => {
  logger.error('Failed to initialize bot:', error);
  process.exit(1);
});
