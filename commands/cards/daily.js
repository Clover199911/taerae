// daily.js - Eris - Daily rewards command with streak system
// ================================================================

const Cooldown = require("../../models/cooldown");
const Currency = require("../../models/currency");
const Graphic = require("../../models/graphic");
const CardGenerationService = require('../../services/CardGenerationService');
const CONFIG = require('../../config/commands/daily');
const { DateTime } = require('luxon');
const { logCardSpawn } = require('../../utils/cardSpawnLogger');

// ==================== CACHE WITH TTL ====================
class TTLCache {
  constructor(ttlMs) {
    this.cache = new Map();
    this.ttl = ttlMs;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value) {
    this.cache.set(key, {
      value,
      expiry: Date.now() + this.ttl
    });
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const registrationCache = new TTLCache(CACHE_TTL);
const cooldownCache = new TTLCache(CACHE_TTL);

// ==================== STREAK CONFIG ====================
const STREAK_BONUSES = {
  3: { type: 'CRYSTALS', amount: 500, label: '3-day streak!' },
  7: { type: 'CRYSTALS', amount: 1500, label: '1 week streak!' },
  14: { type: 'ASTRAL_ESSENCE', amount: 25, label: '2 week streak!' },
  21: { type: 'CARD', rarity: 'Unique', count: 1, label: '3 week streak!' },
  30: { type: 'CARD', rarity: 'Glyph', count: 1, condition: 'pristine', label: '1 month streak!' },
  60: { type: 'CARD', rarity: 'Mythic', count: 1, label: '2 month streak!' },
  90: { type: 'CARD', rarity: 'Mythic', count: 1, condition: 'pristine', label: '3 month streak!' }
};

// ==================== REWARD SCHEDULE ====================
const SPECIAL_DATES = new Set(Object.keys(CONFIG.specialDateRewards).map(Number));

// ==================== DAILY COMMAND CLASS ====================
class DailyCommand {
  constructor() {
    this.name = "daily";
    this.aliases = ["d"];
    this.description = "Claim daily rewards";
  }

  async execute(msg, args, client) {
    const userId = msg.author.id;

    try {
      // Check if user is registered
      if (!await this.isRegistered(userId)) {
        return msg.channel.createMessage({
          content: "Please register with `?register` first.",
          messageReference: { messageID: msg.id }
        });
      }

      // Check cooldown and get streak info
      const cooldownInfo = await this.getCooldown(userId);
      if (cooldownInfo.claimed) {
        const resetTimestamp = Math.floor(cooldownInfo.resetDate.toMillis() / 1000);
        return msg.channel.createMessage({
          embeds: [{
            title: "⏰ Already Claimed",
            description: `You've already claimed today's reward!\n\n` +
              `**Current Streak:** 🔥 ${cooldownInfo.streak} days\n` +
              `**Next Reset:** <t:${resetTimestamp}:R> (<t:${resetTimestamp}:t>)`,
            color: 0xFFA500,
            footer: { text: `Best streak: ${cooldownInfo.maxStreak} days` }
          }],
          messageReference: { messageID: msg.id }
        });
      }

      // Calculate new streak
      const newStreak = this.calculateNewStreak(cooldownInfo);
      
      // Calculate and process rewards (including streak bonus)
      const rewards = this.getRewards(newStreak);
      const [cards, currency] = await Promise.all([
        this.processCards(userId, rewards.cards),
        this.processCurrency(userId, rewards.currency)
      ]);

      // Send response and update cooldown with streak
      await this.sendResponse(msg, cards, currency, newStreak, rewards.streakBonus);
      await this.updateCooldown(userId, newStreak);
      this.clearCaches(userId);

      // Update quest progress for daily command
      const QuestService = require("../../services/QuestService");
      QuestService.updateQuestProgress(userId, ['daily'], 1).catch(err =>
        console.error('[DAILY_QUEST_UPDATE_ERROR]', err)
      );
      
      // Track condition-based quests for cards received from daily
      if (cards.length > 0) {
        // Log card spawns
        for (const card of cards) {
          logCardSpawn({
            userId: userId,
            username: msg.author.username,
            cardName: card.cardData.name,
            group: card.cardData.group,
            rarity: card.cardData.rarity,
            condition: card.cardData.condition,
            cardCode: card.cardData.cardCode,
            printNumber: card.cardData.printNumber,
            command: 'daily',
            channelId: msg.channel.id,
            channelName: msg.channel.name || 'DM',
            guildId: msg.guildID || 'DM',
            guildName: msg.channel.guild?.name || 'DM',
            isCosmic: card.isCosmic || false
          }).catch(err => console.error('[DAILY_LOG_ERROR]', err));
        }
        
        const conditionQuestUpdates = {};
        for (const card of cards) {
          const condition = card.cardData.condition.toLowerCase();
          const questType = `collect_${condition}`;
          conditionQuestUpdates[questType] = (conditionQuestUpdates[questType] || 0) + 1;
        }
        
        for (const [questType, count] of Object.entries(conditionQuestUpdates)) {
          QuestService.updateQuestProgress(userId, [questType], count).catch(err =>
            console.error('[DAILY_CONDITION_QUEST_UPDATE_ERROR]', err)
          );
        }
        
        // Also track rarity-based quests
        const rarityQuestUpdates = {};
        for (const card of cards) {
          const rarity = card.cardData.rarity.toLowerCase();
          const questType = `collect_${rarity}`;
          rarityQuestUpdates[questType] = (rarityQuestUpdates[questType] || 0) + 1;
        }
        
        for (const [questType, count] of Object.entries(rarityQuestUpdates)) {
          QuestService.updateQuestProgress(userId, [questType], count).catch(err =>
            console.error('[DAILY_RARITY_QUEST_UPDATE_ERROR]', err)
          );
        }
      }

    } catch (err) {
      console.error("Daily command error:", err);
      msg.channel.createMessage({
        content: "❌ Could not process daily rewards.",
        messageReference: { messageID: msg.id }
      });
    }
  }

  // ==================== REGISTRATION ====================
  async isRegistered(userId) {
    const cached = registrationCache.get(userId);
    if (cached !== undefined) return cached;

    const user = await Graphic.findOne({ userId })
      .select("isRegistered")
      .lean();
    
    const isRegistered = !!user;
    registrationCache.set(userId, isRegistered);
    
    return isRegistered;
  }

  // ==================== STREAK CALCULATION ====================
  calculateNewStreak(cooldownInfo) {
    const yesterday = this.getKoreanTime().minus({ days: 1 }).toFormat("yyyy-MM-dd");
    
    // If last claim was yesterday, increment streak
    if (cooldownInfo.lastClaimDate === yesterday) {
      return cooldownInfo.streak + 1;
    }
    
    // If no previous claim or gap > 1 day, reset to 1
    return 1;
  }

  // ==================== REWARD CALCULATION ====================
  getRewards(streak) {
    const now = DateTime.now().setZone("Asia/Seoul");
    const rewards = { 
      cards: [], 
      currency: [],
      streakBonus: null
    };

    // Check for weekly rewards based on weekday (1=Monday, 7=Sunday in Luxon)
    const weekdayReward = CONFIG.weeklyRewards[now.weekday];
    if (weekdayReward) {
      if (weekdayReward.type === 'CARD') {
        rewards.cards.push(weekdayReward);
      } else {
        rewards.currency.push({
          type: weekdayReward.type,
          amount: weekdayReward.amount
        });
      }
    }

    // Check for special date rewards
    if (SPECIAL_DATES.has(now.day)) {
      const specialReward = CONFIG.specialDateRewards[now.day];
      if (specialReward) {
        if (specialReward.type === 'CARD') {
          rewards.cards.push(specialReward);
        } else {
          rewards.currency.push({
            type: specialReward.type,
            amount: specialReward.amount
          });
        }
      }
    }

    // Check for streak bonus
    const streakBonus = STREAK_BONUSES[streak];
    if (streakBonus) {
      rewards.streakBonus = streakBonus;
      if (streakBonus.type === 'CARD') {
        rewards.cards.push(streakBonus);
      } else {
        rewards.currency.push({
          type: streakBonus.type,
          amount: streakBonus.amount
        });
      }
    }

    // Daily crystal reward (always given)
    rewards.currency.push({ 
      type: "CRYSTALS", 
      amount: 500 
    });

    return rewards;
  }

  // ==================== CARD PROCESSING ====================
  async processCards(userId, cardRewards) {
    if (!cardRewards.length) return [];

    const generatedCards = await Promise.all(
      cardRewards.map(reward => 
        CardGenerationService.generateCards(userId, reward.count || 1, {
          rarity: reward.rarity,
          condition: reward.condition || "Good",
          dimensions: { width: 300, height: 480 }
        })
      )
    );

    const flattenedCards = generatedCards.flat();
    const cardData = flattenedCards.map(card => card.cardData);
    
    await CardGenerationService.saveCardsToDatabase(cardData);
    console.log(`[DAILY] User ${userId} received ${cardData.length} cards with print numbers`);
    
    return flattenedCards;
  }

  // ==================== CURRENCY PROCESSING ====================
  async processCurrency(userId, currencyRewards) {
    const updates = {};
    const summary = {};

    currencyRewards.forEach(reward => {
      const field = this.getCurrencyField(reward.type);
      updates[field] = (updates[field] || 0) + reward.amount;
      summary[reward.type] = (summary[reward.type] || 0) + reward.amount;
    });

    if (Object.keys(updates).length > 0) {
      await Currency.findOneAndUpdate(
        { userId },
        { $inc: updates },
        { upsert: true }
      );
    }

    return summary;
  }

  getCurrencyField(type) {
    const fieldMap = {
      CRYSTALS: "crystals",
      ASTRAL_ESSENCE: "astralEssence",
      STARDUST: "stardust"
    };
    return fieldMap[type] || "crystals";
  }

  // ==================== RESPONSE BUILDING ====================
  async sendResponse(msg, cards, currency, streak, streakBonus) {
    const now = this.getKoreanTime();
    const nextReset = now.plus({ days: 1 }).startOf("day");
    const resetTimestamp = Math.floor(nextReset.toMillis() / 1000);

    // Build streak display with fire emojis based on streak level
    const streakFires = streak >= 30 ? '🔥🔥🔥' : streak >= 7 ? '🔥🔥' : '🔥';
    const streakDisplay = `${streakFires} **${streak}** day${streak > 1 ? 's' : ''}`;

    // Find next streak milestone
    const nextMilestone = Object.keys(STREAK_BONUSES)
      .map(Number)
      .sort((a, b) => a - b)
      .find(m => m > streak);

    const embed = {
      author: {
        name: `${msg.author.username}'s Daily Rewards`,
        icon_url: msg.author.avatarURL
      },
      description: `📅 **${now.toFormat("MMMM d, yyyy")}** (KST)\n\n` +
        `**Streak:** ${streakDisplay}\n` +
        (nextMilestone ? `**Next Bonus:** ${nextMilestone - streak} days until ${STREAK_BONUSES[nextMilestone].label}\n` : '') +
        `**Next Reset:** <t:${resetTimestamp}:R>`,
      color: streak >= 7 ? 0xFF6B35 : 0xcaf0f8,
      fields: [],
      timestamp: new Date()
    };

    // Currency emojis mapping
    const currencyEmojis = {
      CRYSTALS: "<:rose:1461015415466496191>",
      ASTRAL_ESSENCE: "<:astralessence:1461015891138318598>",
      STARDUST: "<:stardust:1449661267915571274>"
    };

    // Add streak bonus notification if achieved
    if (streakBonus) {
      embed.fields.push({
        name: `🎉 STREAK BONUS: ${streakBonus.label}`,
        value: streakBonus.type === 'CARD' 
          ? `+${streakBonus.count} ${streakBonus.rarity || ''} ${streakBonus.condition || ''} Card!`
          : `+${streakBonus.amount.toLocaleString()} ${streakBonus.type.replace('_', ' ')}!`,
        inline: false
      });
    }

    // Add currency rewards - consolidated into single field
    const currencyLines = Object.entries(currency).map(([type, amount]) => {
      const emoji = currencyEmojis[type] || "💰";
      return `${emoji} **+${amount.toLocaleString()}** ${type.replace("_", " ")}`;
    });
    
    if (currencyLines.length > 0) {
      embed.fields.push({
        name: "💰 Currency Rewards",
        value: currencyLines.join('\n'),
        inline: false
      });
    }

    // Add card details - all cards shown in single field to avoid 25 field limit
    if (cards.length > 0) {
      const cardLines = cards.map(card => 
        `🎴 **${card.cardData.group} ${card.cardData.name}** #${card.cardData.printNumber} • ${card.cardData.condition} • \`${card.cardData.cardCode}\``
      );
      
      embed.fields.push({
        name: `🎴 Cards Received (${cards.length})`,
        value: cardLines.join('\n'),
        inline: false
      });
    }

    const messageOptions = { 
      embeds: [embed], 
      messageReference: { messageID: msg.id } 
    };

    // Attach card images if any
    if (cards.length > 0) {
      const imageBuffers = cards.map(card => card.imageBuffer);
      const combinedImage = await CardGenerationService.createCombinedImage(
        imageBuffers,
        { columns: Math.min(cards.length, 5) }
      );

      embed.image = { url: "attachment://daily.png" };

      await msg.channel.createMessage(
        messageOptions,
        { file: combinedImage, name: "daily.png" }
      );
    } else {
      await msg.channel.createMessage(messageOptions);
    }
  }

  // ==================== COOLDOWN MANAGEMENT ====================
  async getCooldown(userId) {
    const cached = cooldownCache.get(userId);
    if (cached) return cached;

    const today = this.getKoreanDateString();
    const cooldownRecord = await Cooldown.findOne({ 
      user: userId, 
      command: this.name 
    })
      .select("lastClaimDate streak maxStreak")
      .lean();

    const claimed = cooldownRecord?.lastClaimDate === today;
    const resetDate = this.getKoreanTime().plus({ days: 1 }).startOf("day");

    const cooldownData = { 
      claimed, 
      resetDate,
      lastClaimDate: cooldownRecord?.lastClaimDate || null,
      streak: cooldownRecord?.streak || 0,
      maxStreak: cooldownRecord?.maxStreak || 0
    };
    
    cooldownCache.set(userId, cooldownData);
    return cooldownData;
  }

  async updateCooldown(userId, newStreak) {
    const maxStreak = await Cooldown.findOne({ user: userId, command: this.name })
      .select("maxStreak")
      .lean();

    await Cooldown.findOneAndUpdate(
      { user: userId, command: this.name },
      { 
        lastClaimDate: this.getKoreanDateString(),
        streak: newStreak,
        maxStreak: Math.max(newStreak, maxStreak?.maxStreak || 0)
      },
      { upsert: true }
    );
  }

  // ==================== TIME HELPERS ====================
  getKoreanTime() {
    return DateTime.now().setZone("Asia/Seoul");
  }

  getKoreanDateString() {
    return this.getKoreanTime().toFormat("yyyy-MM-dd");
  }

  // ==================== CACHE MANAGEMENT ====================
  clearCaches(userId) {
    registrationCache.delete(userId);
    cooldownCache.delete(userId);
  }
}

// ==================== PERIODIC CACHE CLEANUP ====================
// TTLCache handles expiry automatically via get() - no need for aggressive clearing
// Only clear if cache grows too large (memory protection)
const MAX_CACHE_ENTRIES = 1000;
setInterval(() => {
  if (cooldownCache.cache.size > MAX_CACHE_ENTRIES) {
    cooldownCache.clear();
  }
  if (registrationCache.cache.size > MAX_CACHE_ENTRIES) {
    registrationCache.clear();
  }
}, 600_000); // Check every 10 minutes instead of clearing every 5

module.exports = new DailyCommand();