// ============================================================================
// ACHIEVEMENT SERVICE - Handles hidden achievement tracking
// ============================================================================

const User = require('../models/user');
const Pack = require('../models/pack');
const Card = require('../models/card');
const { UserProgress } = require('../models/userprogress');
const { ACHIEVEMENT_CONFIG, getAllAchievements } = require('../config/achievements');

class AchievementService {

  // ========== CHECK ALL ACHIEVEMENTS FOR USER ==========
  static async checkAchievements(userId) {
    try {
      const unlockedAchievements = [];
      const allAchievements = getAllAchievements();
      
      // Get user's claimed achievements
      const progress = await UserProgress.findOne({ userId });
      const claimedAchievements = progress?.claimedAchievements || [];

      // Check each achievement
      for (const achievement of allAchievements) {
        // Skip if already claimed
        if (claimedAchievements.includes(achievement.id)) continue;

        const isUnlocked = await this.checkSingleAchievement(userId, achievement);
        if (isUnlocked) {
          unlockedAchievements.push(achievement);
        }
      }

      return unlockedAchievements;
    } catch (error) {
      console.error('[ACHIEVEMENT_SERVICE] Error checking achievements:', error);
      return [];
    }
  }

  // ========== CHECK SINGLE ACHIEVEMENT ==========
  static async checkSingleAchievement(userId, achievement) {
    try {
      switch (achievement.type) {
        case 'GROUP_COMPLETE':
          return await this.checkGroupComplete(userId, achievement.requirement);
        
        case 'GROUP_COLLECTOR':
          return await this.checkGroupCollector(userId, achievement.requirement);
        
        case 'EMOJI_GROUP_COLLECTOR':
          return await this.checkEmojiGroupCollector(userId, achievement.requirement);
        
        case 'PRISTINE_COUNT':
          return await this.checkPristineCount(userId, achievement.requirement);
        
        case 'RARITY_COUNT':
          return await this.checkRarityCount(userId, achievement.requirement);
        
        case 'DAILY_COLLECTION':
          return await this.checkDailyCollection(userId, achievement.requirement);
        
        case 'WEEKLY_COLLECTION':
          return await this.checkWeeklyCollection(userId, achievement.requirement);
        
        case 'PACK_OPENED':
          return await this.checkPacksOpened(userId, achievement.requirement);
        
        case 'TOTAL_CARDS':
          return await this.checkTotalCards(userId, achievement.requirement);
        
        default:
          return false;
      }
    } catch (error) {
      console.error(`[ACHIEVEMENT_SERVICE] Error checking ${achievement.id}:`, error);
      return false;
    }
  }

  // ========== GROUP COMPLETE CHECK ==========
  static async checkGroupComplete(userId, requirement) {
    try {
      // Get all cards from the group
      const groupRegex = new RegExp(`^${requirement.group}$`, 'i');
      const allGroupCards = await Card.find({ group: groupRegex }).select('imageURL').lean();
      
      if (allGroupCards.length === 0) return false;

      // Get user's cards from this group (unique by imageURL)
      const userGroupCards = await User.find({ 
        discordId: userId, 
        group: groupRegex 
      }).select('imageURL').lean();

      // Get unique imageURLs
      const allUniqueUrls = new Set(allGroupCards.map(c => c.imageURL));
      const userUniqueUrls = new Set(userGroupCards.map(c => c.imageURL));

      // Check if user has ALL unique cards
      return allUniqueUrls.size === userUniqueUrls.size;
    } catch (error) {
      console.error('[ACHIEVEMENT_SERVICE] Error in checkGroupComplete:', error);
      return false;
    }
  }

  // ========== GROUP COLLECTOR CHECK (10+ cards from group) ==========
  static async checkGroupCollector(userId, requirement) {
    try {
      const groupRegex = new RegExp(`^${requirement.group}$`, 'i');
      const count = await User.countDocuments({ 
        discordId: userId, 
        group: groupRegex 
      });

      return count >= requirement.count;
    } catch (error) {
      console.error('[ACHIEVEMENT_SERVICE] Error in checkGroupCollector:', error);
      return false;
    }
  }

  // ========== EMOJI GROUP COLLECTOR CHECK (NEW!) ==========
  static async checkEmojiGroupCollector(userId, requirement) {
    try {
      // Escape special regex characters in the emoji pattern
      const escapedPattern = requirement.emojiPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      // Count cards from any group that starts with this emoji
      const count = await User.countDocuments({
        discordId: userId,
        group: { $regex: `^${escapedPattern}` }
      });

      return count >= requirement.count;
    } catch (error) {
      console.error('[ACHIEVEMENT_SERVICE] Error in checkEmojiGroupCollector:', error);
      return false;
    }
  }

  // ========== PRISTINE COUNT CHECK ==========
  static async checkPristineCount(userId, requirement) {
    try {
      const count = await User.countDocuments({ 
        discordId: userId, 
        condition: { $regex: /^pristine$/i }
      });

      return count >= requirement.count;
    } catch (error) {
      console.error('[ACHIEVEMENT_SERVICE] Error in checkPristineCount:', error);
      return false;
    }
  }

  // ========== RARITY COUNT CHECK ==========
  static async checkRarityCount(userId, requirement) {
    try {
      const count = await User.countDocuments({ 
        discordId: userId, 
        rarity: { $regex: new RegExp(`^${requirement.rarity}$`, 'i') }
      });

      return count >= requirement.count;
    } catch (error) {
      console.error('[ACHIEVEMENT_SERVICE] Error in checkRarityCount:', error);
      return false;
    }
  }

  // ========== DAILY COLLECTION CHECK ==========
  static async checkDailyCollection(userId, requirement) {
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const count = await User.countDocuments({ 
        discordId: userId,
        createdAt: { $gte: oneDayAgo }
      });

      return count >= requirement.count;
    } catch (error) {
      console.error('[ACHIEVEMENT_SERVICE] Error in checkDailyCollection:', error);
      return false;
    }
  }

  // ========== WEEKLY COLLECTION CHECK ==========
  static async checkWeeklyCollection(userId, requirement) {
    try {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      const count = await User.countDocuments({ 
        discordId: userId,
        createdAt: { $gte: oneWeekAgo }
      });

      return count >= requirement.count;
    } catch (error) {
      console.error('[ACHIEVEMENT_SERVICE] Error in checkWeeklyCollection:', error);
      return false;
    }
  }

  // ========== PACKS OPENED CHECK ==========
  static async checkPacksOpened(userId, requirement) {
    try {
      const count = await Pack.countDocuments({ 
        userId, 
        isOpened: true 
      });

      return count >= requirement.count;
    } catch (error) {
      console.error('[ACHIEVEMENT_SERVICE] Error in checkPacksOpened:', error);
      return false;
    }
  }

  // ========== TOTAL CARDS CHECK ==========
  static async checkTotalCards(userId, requirement) {
    try {
      const count = await User.countDocuments({ discordId: userId });
      return count >= requirement.count;
    } catch (error) {
      console.error('[ACHIEVEMENT_SERVICE] Error in checkTotalCards:', error);
      return false;
    }
  }

  // ========== MARK ACHIEVEMENT AS CLAIMED ==========
  static async markAchievementClaimed(userId, achievementId) {
    try {
      await UserProgress.findOneAndUpdate(
        { userId },
        { 
          $addToSet: { claimedAchievements: achievementId },
          $set: { lastUpdated: new Date() }
        },
        { upsert: true }
      );
      return true;
    } catch (error) {
      console.error('[ACHIEVEMENT_SERVICE] Error marking achievement claimed:', error);
      return false;
    }
  }

  // ========== ROLLBACK CLAIMED ACHIEVEMENT (ON REWARD FAILURE) ==========
  static async rollbackAchievementClaim(userId, achievementId) {
    try {
      await UserProgress.findOneAndUpdate(
        { userId },
        {
          $pull: { claimedAchievements: achievementId },
          $set: { lastUpdated: new Date() }
        }
      );
      return true;
    } catch (error) {
      console.error('[ACHIEVEMENT_SERVICE] Error rolling back achievement claim:', error);
      return false;
    }
  }

  // ========== GET CLAIMED ACHIEVEMENTS ==========
  static async getClaimedAchievements(userId) {
    try {
      const progress = await UserProgress.findOne({ userId });
      return progress?.claimedAchievements || [];
    } catch (error) {
      console.error('[ACHIEVEMENT_SERVICE] Error getting claimed achievements:', error);
      return [];
    }
  }

  // ========== CREATE ACHIEVEMENT UNLOCK EMBED ==========
  static createAchievementEmbed(achievement) {
    return {
      title: `${achievement.icon} Achievement Unlocked!`,
      description: `**${achievement.name}**\n\n*${achievement.description}*`,
      color: 0xFFD700, // Gold color
      footer: {
        text: 'Hidden achievement rewards are one-time only!'
      }
    };
  }

  // ========== GET ACHIEVEMENT PROGRESS ==========
  static async getAchievementProgress(userId) {
    try {
      const [claimed, unlocked] = await Promise.all([
        this.getClaimedAchievements(userId),
        this.checkAchievements(userId)
      ]);

      const allAchievements = getAllAchievements();
      const visible = allAchievements.filter(a => !a.hidden);

      return {
        claimed: claimed.length,
        total: allAchievements.length,
        visible: visible.length,
        unlocked: unlocked.length,
        percentage: Math.round((claimed.length / allAchievements.length) * 100)
      };
    } catch (error) {
      console.error('[ACHIEVEMENT_SERVICE] Error getting progress:', error);
      return {
        claimed: 0,
        total: 0,
        visible: 0,
        unlocked: 0,
        percentage: 0
      };
    }
  }
}

module.exports = AchievementService;