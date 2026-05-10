/**
 * Quest Service
 * Handles daily quest generation, progress tracking, and reward claiming
 * Uses consolidated single-document structure for efficiency
 */

const DailyQuest = require("../models/quest");
const Currency = require("../models/currency");
const CardGenerationService = require("./CardGenerationService");
const { DateTime } = require("luxon");
const { logCardSpawn } = require("../utils/cardSpawnLogger");
const {
  QUEST_POOL,
  QUEST_SETTINGS,
  REWARD_CONFIG,
  COMPLETION_BONUS
} = require("../config/questConfig");

class QuestService {
  /**
   * Get current date string in KST (YYYY-MM-DD)
   */
  static getTodayKST() {
    return DateTime.now()
      .setZone(QUEST_SETTINGS.resetTimezone)
      .toFormat("yyyy-MM-dd");
  }

  /**
   * Get time until next reset in KST
   */
  static getTimeUntilReset() {
    const now = DateTime.now().setZone(QUEST_SETTINGS.resetTimezone);
    const midnight = now.plus({ days: 1 }).startOf("day");
    const diff = midnight.diff(now, ["hours", "minutes", "seconds"]);
    return {
      hours: Math.floor(diff.hours),
      minutes: Math.floor(diff.minutes),
      seconds: Math.floor(diff.seconds),
      timestamp: Math.floor(midnight.toMillis() / 1000) // Unix timestamp for Discord
    };
  }

  /**
   * Generate random number between min and max (inclusive)
   */
  static randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Select random quests using weighted selection
   */
  static selectRandomQuests(count) {
    const questTypes = Object.keys(QUEST_POOL);
    const weights = QUEST_SETTINGS.questWeights;
    
    // Build weighted array
    const weightedTypes = [];
    for (const type of questTypes) {
      const weight = weights[type] || 1;
      for (let i = 0; i < weight; i++) {
        weightedTypes.push(type);
      }
    }
    
    // Select unique quest types
    const selected = [];
    const usedTypes = new Set();
    
    while (selected.length < count && usedTypes.size < questTypes.length) {
      const randomIndex = Math.floor(Math.random() * weightedTypes.length);
      const questType = weightedTypes[randomIndex];
      
      if (!usedTypes.has(questType)) {
        usedTypes.add(questType);
        selected.push(questType);
      }
    }
    
    return selected;
  }

  /**
   * Generate reward for a quest based on difficulty
   */
  static generateReward(difficulty) {
    const config = REWARD_CONFIG[difficulty];
    
    // Primary reward: crystals or stardust
    const rewardType = Math.random() < 0.6 ? "crystals" : "stardust";
    const amount = this.randomBetween(
      config[rewardType].min,
      config[rewardType].max
    );
    
    // Check for secondary selca reward
    const hasSelca = Math.random() < config.selcaChance;
    
    // Check for card reward
    const hasCard = Math.random() < config.cardChance;
    
    const reward = {
      type: rewardType,
      amount: amount
    };
    
    if (hasSelca) {
      reward.secondary = {
        type: "selca",
        amount: this.randomBetween(1, 3)
      };
    }
    
    if (hasCard && config.cardRarities) {
      const rarity = config.cardRarities[
        Math.floor(Math.random() * config.cardRarities.length)
      ];
      reward.card = {
        count: 1,
        rarity: rarity
      };
    }
    
    return reward;
  }

  /**
   * Get or create daily quest document for a user
   */
  static async getOrCreateDailyQuests(userId) {
    const today = this.getTodayKST();
    
    // Try to find existing document
    let dailyQuest = await DailyQuest.findOne({
      userId,
      dailyResetDate: today
    });
    
    if (dailyQuest) {
      return dailyQuest;
    }
    
    // Generate new quests
    const selectedTypes = this.selectRandomQuests(QUEST_SETTINGS.questsPerDay);
    const quests = [];
    
    for (let i = 0; i < selectedTypes.length; i++) {
      const questType = selectedTypes[i];
      const questConfig = QUEST_POOL[questType];
      
      const target = this.randomBetween(
        questConfig.targetRange.min,
        questConfig.targetRange.max
      );
      
      const reward = this.generateReward(questConfig.difficulty);
      
      quests.push({
        questType: questConfig.type,
        questId: `${questConfig.type}_${today}_${i}`,
        description: questConfig.descriptionFn(target),
        progress: 0,
        target,
        status: "incomplete",
        reward,
        difficulty: questConfig.difficulty
      });
    }
    
    // Create single document with all quests
    dailyQuest = new DailyQuest({
      userId,
      dailyResetDate: today,
      quests,
      bonusClaimed: false
    });
    
    await dailyQuest.save();
    return dailyQuest;
  }

  /**
   * Get active quests for a user (today's quests)
   */
  static async getActiveQuests(userId) {
    const dailyQuest = await this.getOrCreateDailyQuests(userId);
    return dailyQuest.quests;
  }

  /**
   * Update quest progress for a user
   * @param {string} userId - User's Discord ID
   * @param {string|string[]} questTypes - Quest type(s) to update
   * @param {number} increment - Amount to increment (default 1)
   */
  static async updateQuestProgress(userId, questTypes, increment = 1) {
    const today = this.getTodayKST();
    const types = Array.isArray(questTypes) ? questTypes : [questTypes];
    
    // Find user's daily quest document
    const dailyQuest = await DailyQuest.findOne({
      userId,
      dailyResetDate: today
    });
    
    if (!dailyQuest) return [];
    
    const updatedQuests = [];
    let modified = false;
    
    for (const quest of dailyQuest.quests) {
      // Skip if quest type doesn't match or already claimed
      if (!types.includes(quest.questType) || quest.status === "claimed") {
        continue;
      }
      
      const newProgress = Math.min(quest.progress + increment, quest.target);
      quest.progress = newProgress;
      
      // Check if quest is now complete
      if (newProgress >= quest.target && quest.status === "incomplete") {
        quest.status = "completed";
        quest.completedAt = new Date();
      }
      
      updatedQuests.push(quest);
      modified = true;
    }
    
    // Single save for all updates
    if (modified) {
      await dailyQuest.save();
    }
    
    return updatedQuests;
  }

  /**
   * Claim a single quest reward
   */
  static async claimQuestReward(userId, questId) {
    const today = this.getTodayKST();
    
    const dailyQuest = await DailyQuest.findOne({
      userId,
      dailyResetDate: today
    });
    
    if (!dailyQuest) {
      return { success: false, error: "No quests found" };
    }
    
    // Find the specific quest
    const quest = dailyQuest.quests.find(q => q.questId === questId);
    
    if (!quest) {
      return { success: false, error: "Quest not found" };
    }
    
    if (quest.status !== "completed") {
      return { success: false, error: "Quest not completed" };
    }
    
    // Give currency rewards
    const currencyUpdates = {};
    currencyUpdates[quest.reward.type] = quest.reward.amount;
    
    if (quest.reward.secondary && quest.reward.secondary.type && quest.reward.secondary.amount) {
      currencyUpdates[quest.reward.secondary.type] = quest.reward.secondary.amount;
    }
    
    await Currency.findOneAndUpdate(
      { userId },
      { $inc: currencyUpdates },
      { upsert: true }
    );
    
    // Generate card reward if applicable
    let cardReward = null;
    if (quest.reward.card && quest.reward.card.count > 0) {
      try {
        const cards = await CardGenerationService.generateCards(userId, quest.reward.card.count, {
          rarity: quest.reward.card.rarity,
          condition: "Good"
        });
        
        if (cards.length > 0) {
          const cardData = cards.map(c => c.cardData);
          await CardGenerationService.saveCardsToDatabase(cardData);
          cardReward = cardData[0];
          
          // Log card spawns from quest rewards
          for (const card of cardData) {
            logCardSpawn({
              userId: userId,
              username: 'Quest Reward',
              cardName: card.name,
              group: card.group,
              rarity: card.rarity,
              condition: card.condition,
              cardCode: card.cardCode,
              printNumber: card.printNumber,
              command: 'quest',
              channelId: 'N/A',
              channelName: 'Quest System',
              guildId: 'N/A',
              guildName: 'Quest System',
              isCosmic: false
            }).catch(err => console.error('[QUEST_LOG_ERROR]', err));
          }
        }
      } catch (err) {
        console.error('[QUEST_CARD_REWARD_ERROR]', err);
      }
    }
    
    // Mark quest as claimed
    quest.status = "claimed";
    quest.claimedAt = new Date();
    await dailyQuest.save();
    
    return {
      success: true,
      quest,
      rewards: currencyUpdates,
      cardReward
    };
  }

  /**
   * Claim completion bonus for finishing all quests
   */
  static async claimCompletionBonus(userId) {
    const today = this.getTodayKST();
    
    const dailyQuest = await DailyQuest.findOne({
      userId,
      dailyResetDate: today
    });
    
    if (!dailyQuest || dailyQuest.quests.length !== QUEST_SETTINGS.questsPerDay) {
      return { success: false, error: "Not all quests generated" };
    }
    
    // Check if any quest is still incomplete
    const incompleteQuests = dailyQuest.quests.filter(q => q.status === "incomplete");
    if (incompleteQuests.length > 0) {
      return { success: false, error: "Not all quests completed" };
    }
    
    // Check if bonus already claimed
    if (dailyQuest.bonusClaimed) {
      return { success: false, error: "Completion bonus already claimed" };
    }
    
    // Claim all unclaimed completed quests first
    const claimResults = [];
    for (const quest of dailyQuest.quests) {
      if (quest.status === "completed") {
        const result = await this.claimQuestReward(userId, quest.questId);
        claimResults.push(result);
      }
    }
    
    // Give completion bonus
    await Currency.findOneAndUpdate(
      { userId },
      {
        $inc: {
          crystals: COMPLETION_BONUS.crystals,
          stardust: COMPLETION_BONUS.stardust,
          astralEssence: COMPLETION_BONUS.astralEssence
        }
      },
      { upsert: true }
    );
    
    // Check for bonus card reward
    let bonusCardReward = null;
    if (COMPLETION_BONUS.cardChance && Math.random() < COMPLETION_BONUS.cardChance) {
      try {
        const rarity = COMPLETION_BONUS.cardRarities[
          Math.floor(Math.random() * COMPLETION_BONUS.cardRarities.length)
        ];
        
        const cards = await CardGenerationService.generateCards(userId, 1, {
          rarity: rarity,
          condition: "Good"
        });
        
        if (cards.length > 0) {
          const cardData = cards.map(c => c.cardData);
          await CardGenerationService.saveCardsToDatabase(cardData);
          bonusCardReward = cardData[0];
          
          // Log card spawns from quest completion bonus
          for (const card of cardData) {
            logCardSpawn({
              userId: userId,
              username: 'Quest Bonus',
              cardName: card.name,
              group: card.group,
              rarity: card.rarity,
              condition: card.condition,
              cardCode: card.cardCode,
              printNumber: card.printNumber,
              command: 'quest_bonus',
              channelId: 'N/A',
              channelName: 'Quest System',
              guildId: 'N/A',
              guildName: 'Quest System',
              isCosmic: false
            }).catch(err => console.error('[QUEST_BONUS_LOG_ERROR]', err));
          }
        }
      } catch (err) {
        console.error('[QUEST_BONUS_CARD_ERROR]', err);
      }
    }
    
    // Mark bonus as claimed
    dailyQuest.bonusClaimed = true;
    await dailyQuest.save();
    
    return {
      success: true,
      bonus: COMPLETION_BONUS,
      questRewards: claimResults,
      bonusCardReward
    };
  }

  /**
   * Get quest statistics for a user
   */
  static async getQuestStats(userId) {
    const dailyQuest = await this.getOrCreateDailyQuests(userId);
    const quests = dailyQuest.quests;
    
    const stats = {
      total: quests.length,
      incomplete: quests.filter(q => q.status === "incomplete").length,
      completed: quests.filter(q => q.status === "completed").length,
      claimed: quests.filter(q => q.status === "claimed").length,
      allComplete: false,
      bonusAvailable: false
    };
    
    stats.allComplete = stats.incomplete === 0 && stats.total > 0;
    stats.bonusAvailable = stats.allComplete && !dailyQuest.bonusClaimed;
    
    return stats;
  }

  /**
   * Delete old quests (cleanup utility)
   */
  static async cleanupOldQuests(daysOld = 7) {
    const cutoffDate = DateTime.now()
      .setZone(QUEST_SETTINGS.resetTimezone)
      .minus({ days: daysOld })
      .toFormat("yyyy-MM-dd");
    
    const result = await DailyQuest.deleteMany({
      dailyResetDate: { $lt: cutoffDate }
    });
    
    return result.deletedCount;
  }
}

module.exports = QuestService;
