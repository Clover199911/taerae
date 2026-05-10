// ============================================================================
// TIER SERVICE - Handles all tier-related logic
// ============================================================================

const User = require('../models/user');
const { UserProgress } = require('../models/userprogress');
const { TIER_CONFIG, getAllTiers, getNextTier, getTierById } = require('../config/tiers');

class TierService {
  
  // ========== GET USER'S CARD COUNT ==========
  static async getUserCardCount(userId) {
    try {
      const cardCount = await User.countDocuments({ discordId: userId });
      return cardCount;
    } catch (error) {
      console.error('[TIER_SERVICE] Error getting card count:', error);
      throw new Error('Failed to get user card count');
    }
  }

  // ========== GET CLAIMED TIERS ==========
  static async getClaimedTiers(userId) {
    try {
      const progress = await UserProgress.findOne({ userId });
      return progress?.claimedTiers || [];
    } catch (error) {
      console.error('[TIER_SERVICE] Error getting claimed tiers:', error);
      throw new Error('Failed to get claimed tiers');
    }
  }

  // ========== MARK TIER AS CLAIMED ==========
  static async markTierAsClaimed(userId, tierId) {
    try {
      await UserProgress.findOneAndUpdate(
        { userId },
        { 
          $addToSet: { claimedTiers: tierId },
          $set: { lastUpdated: new Date() }
        },
        { upsert: true }
      );
      return true;
    } catch (error) {
      console.error('[TIER_SERVICE] Error marking tier as claimed:', error);
      throw new Error('Failed to mark tier as claimed');
    }
  }

  // ========== ROLLBACK CLAIMED TIER (ON REWARD FAILURE) ==========
  static async rollbackTierClaim(userId, tierId) {
    try {
      await UserProgress.findOneAndUpdate(
        { userId },
        {
          $pull: { claimedTiers: tierId },
          $set: { lastUpdated: new Date() }
        }
      );
      return true;
    } catch (error) {
      console.error('[TIER_SERVICE] Error rolling back tier claim:', error);
      return false;
    }
  }

  // ========== FIRST ELIGIBLE TIER FROM KNOWN STATS ==========
  static getFirstEligibleTierId(cardCount, claimedTiers = []) {
    const allTiers = getAllTiers();

    for (const tier of allTiers) {
      if (!claimedTiers.includes(tier.id)) {
        if (cardCount >= tier.requirement.cardCount) {
          return tier.id;
        }
        break;
      }
    }

    return null;
  }

  // ========== CHECK TIER ELIGIBILITY ==========
  static async checkTierEligibility(userId) {
    try {
      const [cardCount, claimedTiers] = await Promise.all([
        this.getUserCardCount(userId),
        this.getClaimedTiers(userId)
      ]);

      const nextEligibleTierId = this.getFirstEligibleTierId(cardCount, claimedTiers);
      return nextEligibleTierId ? [nextEligibleTierId] : [];
    } catch (error) {
      console.error('[TIER_SERVICE] Error checking eligibility:', error);
      throw new Error('Failed to check tier eligibility');
    }
  }

  // ========== CREATE TIER DISPLAY EMBED ==========
  static createTierEmbed(cardCount, claimedTiers = []) {
    const embed = {
      title: "🏆 Card Collection Tiers",
      description: `You currently have **${cardCount}** cards in your collection!`,
      fields: [],
      color: 0x9966CC,
      footer: {
        text: `Claimed: ${claimedTiers.length}/${getAllTiers().length} tiers`
      }
    };

    const allTiers = getAllTiers();
    
    // Find the first unclaimed tier
    let nextUnclaimedTier = null;
    for (const tier of allTiers) {
      if (!claimedTiers.includes(tier.id)) {
        nextUnclaimedTier = tier;
        break;
      }
    }

    // If there's an unclaimed tier
    if (nextUnclaimedTier) {
      const rewardText = this.formatRewardText(nextUnclaimedTier.reward);
      const tierNumber = nextUnclaimedTier.id.replace('tier', '');
      
      // Check if user has enough cards
      if (cardCount >= nextUnclaimedTier.requirement.cardCount) {
        embed.fields.push({
          name: `✨ Tier ${tierNumber}: ${nextUnclaimedTier.name}`,
          value: `**Requirement:** ${nextUnclaimedTier.requirement.cardCount} cards\n**Reward:** ${rewardText}\n**Status:** 🎁 **Ready to Claim!**\n\n*${nextUnclaimedTier.description}*`,
          inline: false
        });
      } else {
        const remaining = nextUnclaimedTier.requirement.cardCount - cardCount;
        const progressBar = this.createProgressBar(cardCount, nextUnclaimedTier.requirement.cardCount);
        
        embed.fields.push({
          name: `🎯 Next Tier: Tier ${tierNumber} - ${nextUnclaimedTier.name}`,
          value: `**Requirement:** ${nextUnclaimedTier.requirement.cardCount} cards\n**Reward:** ${rewardText}\n**Progress:** ${progressBar}\n**Remaining:** ${remaining} cards\n\n*${nextUnclaimedTier.description}*`,
          inline: false
        });
      }

      // Show next 2 upcoming tiers as preview
      const unclaimedTiers = allTiers.filter(t => !claimedTiers.includes(t.id));
      const upcomingTiers = unclaimedTiers.slice(1, 3);
      
      if (upcomingTiers.length > 0) {
        const upcomingText = upcomingTiers.map(t => {
          const tierNum = t.id.replace('tier', '');
          return `**Tier ${tierNum}** (${t.requirement.cardCount} cards) - ${t.name}`;
        }).join('\n');
        
        embed.fields.push({
          name: '📋 Upcoming Tiers',
          value: upcomingText,
          inline: false
        });
      }

    } else {
      // All tiers claimed!
      embed.fields.push({
        name: "🌟 Congratulations!",
        value: "You've claimed all available tier rewards!\n\n*Keep collecting for achievement rewards!*",
        inline: false
      });
    }

    return embed;
  }

  // ========== FORMAT REWARD TEXT ==========
  static formatRewardText(reward) {
    switch (reward.type) {
      case 'CARD':
        const condition = reward.condition ? ` (${reward.condition})` : '';
        return `${reward.count}x ${reward.rarity} Card${reward.count > 1 ? 's' : ''}${condition}`;
      
      case 'CURRENCY':
        const currencies = [];
        if (reward.crystals) currencies.push(`${reward.crystals} <:rose:1461015415466496191> Crystals`);
        if (reward.astralEssence) currencies.push(`${reward.astralEssence} <:astralessence:1461015891138318598> Astral Essence`);
        if (reward.stardust) currencies.push(`${reward.stardust} <:stardust:1461015197958410423> Stardust`);
        if (reward.fantasiaTokens) currencies.push(`${reward.fantasiaTokens} 🎫 Fantasia Tokens`);
        if (reward.reverieGem) currencies.push(`${reward.reverieGem} 💠 Reverie Gems`);
        return currencies.join(' + ');
      
      case 'PACK':
        return `${reward.count}x ${reward.packType.toUpperCase()} Pack${reward.count > 1 ? 's' : ''}`;
      
      case 'CARD_GENERATION':
        const rarity = reward.rarities ? reward.rarities.join('/') : reward.rarity;
        const pristine = reward.pristineChance ? ` (${Math.round(reward.pristineChance * 100)}% pristine)` : '';
        return `Generate ${reward.count}x ${rarity} Card${reward.count > 1 ? 's' : ''}${pristine}`;
      
      case 'CHOICE':
        return `**Choose 1 of 3 rewards:**\n${reward.options.map((opt, i) => 
          `${i + 1}. ${this.formatRewardText(opt)}`
        ).join('\n')}`;
      
      case 'MEGA':
        return reward.items.map(item => this.formatRewardText(item)).join('\n+ ');
      
      default:
        return 'Unknown reward';
    }
  }

  // ========== CREATE PROGRESS BAR ==========
  static createProgressBar(current, target, length = 10) {
    const percentage = Math.min(current / target, 1);
    const filled = Math.floor(percentage * length);
    const empty = length - filled;
    
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const percent = Math.round(percentage * 100);
    
    return `${bar} ${percent}%`;
  }

  // ========== GET TIER STATISTICS ==========
  static async getTierStatistics(userId) {
    try {
      const [cardCount, claimedTiers] = await Promise.all([
        this.getUserCardCount(userId),
        this.getClaimedTiers(userId)
      ]);

      const allTiers = getAllTiers();
      const totalTiers = allTiers.length;
      const percentage = Math.round((claimedTiers.length / totalTiers) * 100);

      return {
        cardCount,
        claimedTiers: claimedTiers.length,
        totalTiers,
        percentage,
        nextTierRequirement: this.getNextTierRequirement(cardCount, claimedTiers)
      };
    } catch (error) {
      console.error('[TIER_SERVICE] Error getting statistics:', error);
      throw new Error('Failed to get tier statistics');
    }
  }

  // ========== GET NEXT TIER REQUIREMENT ==========
  static getNextTierRequirement(cardCount, claimedTiers) {
    const allTiers = getAllTiers();
    
    for (const tier of allTiers) {
      if (!claimedTiers.includes(tier.id)) {
        return {
          tierId: tier.id,
          required: tier.requirement.cardCount,
          remaining: Math.max(0, tier.requirement.cardCount - cardCount)
        };
      }
    }
    
    return null; // All tiers claimed
  }

  // ========== VALIDATE TIER CLAIM ==========
  static async validateTierClaim(userId, tierId) {
    const tierConfig = getTierById(tierId);
    if (!tierConfig) {
      return { valid: false, message: 'Invalid tier ID' };
    }

    const [cardCount, claimedTiers] = await Promise.all([
      this.getUserCardCount(userId),
      this.getClaimedTiers(userId)
    ]);

    if (claimedTiers.includes(tierId)) {
      return { valid: false, message: `You've already claimed this tier!` };
    }

    if (cardCount < tierConfig.requirement.cardCount) {
      return { 
        valid: false, 
        message: `You need ${tierConfig.requirement.cardCount} cards to claim this tier. You currently have ${cardCount} cards.` 
      };
    }

    // Check if user needs to claim previous tiers first
    const allTiers = getAllTiers();
    for (const tier of allTiers) {
      if (tier.id === tierId) break;
      if (!claimedTiers.includes(tier.id) && cardCount >= tier.requirement.cardCount) {
        return {
          valid: false,
          message: `Please claim previous tiers first!`
        };
      }
    }

    return { valid: true };
  }
}

module.exports = TierService;