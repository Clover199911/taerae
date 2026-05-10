//  view.js  —  Eris  —  case-sensitive  —  edits original message
// -------------------------------------------------------------
const User                  = require("../models/user");
const CardGenerationService = require('../services/CardGenerationService');
const rateLimiter           = require('../middleware/rateLimiter');
const { DateTime }          = require('luxon');
const winston               = require('winston');

const logger = winston.createLogger({
  level   : process.env.LOG_LEVEL || 'info',
  format  : winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports : [
    new winston.transports.Console({
      format : winston.format.combine(winston.format.colorize(), winston.format.simple())
    })
  ]
});

const CARD_CODE_REGEX = /^[A-Za-z0-9]{1,20}$/;
const VIEW_DIMENSIONS = { width: 600, height: 960 }; // Higher res for view command

class CardViewController {
  constructor() {
    this.name        = "view";
    this.description = "View a card";
    this.aliases     = ["vw", "card"];
    this.cooldown    = 2000;
  }

  async execute(msg, args, client) {
    const userId   = msg.author.id;
    const startTime = DateTime.now();

    try {
      // rate-limit
      const rateLimit = await rateLimiter.checkLimit(userId, 'view', 15, 60000);
      if (rateLimit.limited) {
        return msg.channel.createMessage({
          content : `⏰  Wait ${rateLimit.retryAfter}s.`,
          flags   : 64
        });
      }

      // input checks
      if (!args?.length) {
        return msg.channel.createMessage({
          embed : { title : "❌  Invalid Input", description : "Provide a card code to view.", color : 0xff6b6b },
          messageReference : { messageID : msg.id }
        });
      }

      const cardCode = args[0].trim();
      if (!CARD_CODE_REGEX.test(cardCode)) {
        return msg.channel.createMessage({
          embed : { title : "❌  Invalid Code", description : "Card codes are 4-12 alphanumeric characters.", color : 0xff6b6b },
          messageReference : { messageID : msg.id }
        });
      }

      // fetch card
      const redis       = CardGenerationService.redis;
      const cardResult  = await this.fetchCardOptimized(userId, cardCode, redis);
      if (!cardResult.user) {
        return msg.channel.createMessage({
          embed : { title : "🔍  Card Not Found", description : `No card with code \`${cardCode}\`.`, color : 0xffa726 },
          messageReference : { messageID : msg.id }
        });
      }

      // parallel image + duplicate count
      const [imageBuffer, duplicateCount] = await Promise.all([
        this.processCardImage(cardResult.user),
        this.getDuplicateCount(userId, cardResult.user.imageURL, cardResult.isOwnCard)
      ]);

      const embed = this.buildEmbed(cardResult, duplicateCount);
      await msg.channel.createMessage(
        { embeds : [embed], messageReference : { messageID : msg.id } },
        { file : imageBuffer, name : "card.png" }
      );

      // Update quest progress for view command
      const QuestService = require("../services/QuestService");
      QuestService.updateQuestProgress(userId, ['view'], 1).catch(err =>
        console.error('[VIEW_QUEST_UPDATE_ERROR]', err)
      );

    } catch (err) {
      logger.error("View error:", { userId, error : err.message });
      msg.channel.createMessage({
        embed : { title : "⚠️  Processing Error", description : "Unable to view this card right now.", color : 0xff4757 },
        messageReference : { messageID : msg.id }
      });
    }
  }

  // ----------  helpers  ----------
  async fetchCardOptimized(discordId, cardCode, redis) {
    const key = `card:${cardCode}`;
    if (redis?.get) {
      const cached = await redis.get(key);
      if (cached) {
        const parsed = JSON.parse(cached);
        return { user : parsed, isOwnCard : parsed.discordId === discordId };
      }
    }

    const [ownCard, anyCard] = await Promise.all([
      User.findOne({ discordId, cardCode }).lean().hint({ discordId : 1, cardCode : 1 }),
      User.findOne({ cardCode }).lean().hint({ cardCode : 1 })
    ]);
    const result = { user : ownCard || anyCard, isOwnCard : !!ownCard };

    if (result.user && redis?.setex) {
      redis.setex(key, 300, JSON.stringify(result.user)).catch(() => {});
    }
    return result;
  }

  async processCardImage(card) {
    // Use higher resolution for view command
    const overlayPromise = card.condition && card.condition.toLowerCase() !== 'good'
      ? CardGenerationService.preloadOverlay(card.group, card.rarity, card.condition, card.cardId)
      : Promise.resolve(null);

    return await CardGenerationService.processCardImage(card, card.condition, overlayPromise);
  }

  async getDuplicateCount(discordId, imageURL, isOwnCard) {
    if (!isOwnCard) return 0;
    
    const redis = CardGenerationService.redis;
    const key = `duplicates:${discordId}:${Buffer.from(imageURL).toString("base64").slice(0, 16)}`;
    
    if (redis?.get) {
        const cached = await redis.get(key);
        if (cached) return parseInt(cached, 10);
    }
    
    const count = await User.countDocuments({ discordId, imageURL });
    
    if (redis?.setex) {
        redis.setex(key, 60, count.toString()).catch(() => {});
    }
    
    return count;
  }

  buildEmbed(cardResult, duplicateCount) {
    const { user, isOwnCard } = cardResult;
    const isPristine = user.condition.toLowerCase() === "pristine";

    return {
      title       : `View - ${user.name} #${user.printNumber}`,
      description : `**Condition:** ${user.condition}\n**Code:** \`${user.cardCode}\`\n**Wellness:** ${user.cardWellness}\n **Owner:** <@${user.discordId}>`,
      color       : 0xcaf0f8,
      image       : { url : "attachment://card.png" },
      timestamp   : new Date(),
    };
  }
};

module.exports = new CardViewController;