// ============================================================================
// TIER COMMAND - FIXED with anti-spam protection
// ============================================================================

const Graphic = require("../../models/graphic");
const TierService = require("../../services/TierService");
const AchievementService = require("../../services/AchievementService");
const RewardService = require("../../services/RewardService");
const { getTierById } = require("../../config/tiers");
const { UserProgress } = require("../../models/userprogress");

// Store active collectors to clean them up properly
const activeCollectors = new Map();
// Track active claims to prevent spam
const activeClaims = new Set();

module.exports = {
  name: "tier",
  aliases: ["t", "tiers"],
  description: "View and claim your card collection tier rewards",
  cooldown: 3,

  // ========== MAIN EXECUTE ==========
  async execute(msg, args, client) {
    try {
      const userId = msg.author.id;

      // Check if user wants to see achievements
      if (args[0] && args[0].toLowerCase() === 'achievements') {
        return this.showAchievementsList(msg, client, userId);
      }

      // Check registration
      const graphic = await Graphic.findOne({ userId });
      if (!graphic?.isRegistered) {
        return this.sendRegistrationMessage(msg);
      }

      // Clean up any existing collectors for this user
      this.cleanupCollectorsForUser(client, userId);

      // Check for achievements (limit to first 2)
      const unlockedAchievements = await AchievementService.checkAchievements(userId);
      
      // Store unlocked achievements
      if (unlockedAchievements.length > 0) {
        await this.storeUnlockedAchievements(userId, unlockedAchievements);
        
        // Show only first 2 achievements
        const achievementsToShow = unlockedAchievements.slice(0, 2);
        const remainingCount = unlockedAchievements.length - achievementsToShow.length;
        
        await this.showAchievementUnlocks(msg, client, achievementsToShow);
        
        // Notify about remaining achievements
        if (remainingCount > 0) {
          await msg.channel.createMessage({
            content: `🎉 **You have ${remainingCount} more unlocked achievement${remainingCount > 1 ? 's' : ''}!**\n\nType \`?tier achievements\` to view and claim them all!`,
            messageReference: { messageID: msg.id }
          });
        }
      }

      // Get user stats
      const [cardCount, claimedTiers] = await Promise.all([
        TierService.getUserCardCount(userId),
        TierService.getClaimedTiers(userId)
      ]);

      // Create main tier embed
      const embed = TierService.createTierEmbed(cardCount, claimedTiers);
      const currentTier = TierService.getFirstEligibleTierId(cardCount, claimedTiers);

      const messageOptions = {
        embeds: [embed],
        messageReference: { messageID: msg.id }
      };

      // Add claim button if tier is ready
      if (currentTier) {
        messageOptions.components = [{
          type: 1,
          components: [{
            type: 2,
            style: 3,
            label: "Claim Reward",
            custom_id: `claim_tier_${currentTier}_${userId}`,
            emoji: { name: '🎁' }
          }]
        }];
      }

      const message = await msg.channel.createMessage(messageOptions);

      // Set up button collector
      if (currentTier) {
        this.setupClaimCollector(msg, message, client, userId, currentTier);
      }

    } catch (error) {
      console.error("[TIER_CMD] Error:", error);
      return msg.channel.createMessage({
        content: "⚠️ An error occurred while processing your tier rewards. Please try again later.",
        messageReference: { messageID: msg.id }
      });
    }
  },

  // ========== STORE UNLOCKED ACHIEVEMENTS ==========
  async storeUnlockedAchievements(userId, achievements) {
    try {
      const achievementIds = achievements.map(a => a.id);
      await UserProgress.findOneAndUpdate(
        { userId },
        { 
          $addToSet: { unlockedAchievements: { $each: achievementIds } }
        },
        { upsert: true }
      );
    } catch (error) {
      console.error('[TIER_CMD] Error storing unlocked achievements:', error);
    }
  },

  // ========== SHOW ACHIEVEMENTS LIST (PAGINATED) ==========
  async showAchievementsList(msg, client, userId) {
    try {
      const progress = await UserProgress.findOne({ userId });
      const unlockedIds = progress?.unlockedAchievements || [];
      const claimedIds = progress?.claimedAchievements || [];
      
      // Get unclaimed achievements
      const { getAllAchievements } = require('../../config/achievements');
      const allAchievements = getAllAchievements();
      
      const unclaimedAchievements = unlockedIds
        .filter(id => !claimedIds.includes(id))
        .map(id => allAchievements.find(a => a.id === id))
        .filter(Boolean);

      if (unclaimedAchievements.length === 0) {
        return msg.channel.createMessage({
          content: "<:check:1461015775266603110> You have no unlocked achievements to claim right now!",
          messageReference: { messageID: msg.id }
        });
      }

      // Paginate (5 per page)
      const perPage = 5;
      const paginationData = {
        currentPage: 0,
        perPage,
        unclaimedAchievements
      };

      const getTotalPages = () => Math.max(1, Math.ceil(paginationData.unclaimedAchievements.length / paginationData.perPage));

      const getPageAchievements = (page) => {
        const start = page * paginationData.perPage;
        return paginationData.unclaimedAchievements.slice(start, start + paginationData.perPage);
      };

      const createAchievementEmbed = (page) => {
        const pageAchievements = getPageAchievements(page);
        const start = page * paginationData.perPage;
        const totalPages = getTotalPages();
        
        return {
          title: "🏆 Unlocked Achievements",
          description: `You have **${paginationData.unclaimedAchievements.length}** achievement${paginationData.unclaimedAchievements.length > 1 ? 's' : ''} ready to claim!`,
          fields: pageAchievements.map((ach, idx) => ({
            name: `${ach.icon} ${ach.name}`,
            value: `*${ach.description}*\n\nClick button ${start + idx + 1} to claim!`,
            inline: false
          })),
          color: 0xFFD700,
          footer: {
            text: `Page ${page + 1}/${totalPages}`
          }
        };
      };

      const createComponents = (page) => {
        const pageAchievements = getPageAchievements(page);
        const components = [];

        // Claim buttons (up to 5)
        const claimButtons = pageAchievements.map((ach, idx) => ({
          type: 2,
          style: 3,
          label: `${idx + 1}`,
          custom_id: `claim_ach_${ach.id}_${userId}`,
          emoji: { name: ach.icon }
        }));

        if (claimButtons.length > 0) {
          components.push({ type: 1, components: claimButtons });
        }

        // Navigation buttons
        const totalPages = getTotalPages();
        if (totalPages > 1) {
          const navButtons = [];
          
          if (page > 0) {
            navButtons.push({
              type: 2,
              style: 2,
              label: "Previous",
              custom_id: `ach_prev_${userId}`,
              emoji: { name: '◀️' }
            });
          }
          
          if (page < totalPages - 1) {
            navButtons.push({
              type: 2,
              style: 2,
              label: "Next",
              custom_id: `ach_next_${userId}`,
              emoji: { name: '▶️' }
            });
          }

          if (navButtons.length > 0) {
            components.push({ type: 1, components: navButtons });
          }
        }

        return components;
      };

      paginationData.getPageAchievements = getPageAchievements;
      paginationData.createAchievementEmbed = createAchievementEmbed;
      paginationData.createComponents = createComponents;
      paginationData.getTotalPages = getTotalPages;

      const achievementListMsg = await msg.channel.createMessage({
        embeds: [createAchievementEmbed(paginationData.currentPage)],
        components: createComponents(paginationData.currentPage),
        messageReference: { messageID: msg.id }
      });

      // Set up paginated collector
      this.setupAchievementPaginationCollector(msg, achievementListMsg, client, userId, paginationData);

    } catch (error) {
      console.error('[TIER_CMD] Error showing achievements list:', error);
      return msg.channel.createMessage({
        content: "⚠️ Error loading achievements.",
        messageReference: { messageID: msg.id }
      });
    }
  },

  // ========== SETUP ACHIEVEMENT PAGINATION COLLECTOR ==========
  setupAchievementPaginationCollector(originalMsg, listMsg, client, userId, paginationData) {
    const collectorKey = `ach_list_${userId}`;
    this.cleanupCollector(client, collectorKey);

    let { currentPage } = paginationData;
    const { createAchievementEmbed, createComponents, getTotalPages } = paginationData;

    const collector = async (interaction) => {
      if (interaction.message.id !== listMsg.id) return;
      if (interaction.member.id !== userId) {
        return interaction.createMessage({
          content: "⚠️ This isn't your achievement list!",
          flags: 64
        }).catch(() => {});
      }

      const customId = interaction.data.custom_id;

      try {
        // Handle pagination
        if (customId === `ach_prev_${userId}`) {
          try {
            await interaction.defer();
          } catch (deferError) {
            return;
          }
          currentPage = Math.max(0, currentPage - 1);
          await listMsg.edit({
            embeds: [createAchievementEmbed(currentPage)],
            components: createComponents(currentPage)
          });
          return;
        }

        if (customId === `ach_next_${userId}`) {
          try {
            await interaction.defer();
          } catch (deferError) {
            return;
          }
          const totalPages = getTotalPages();
          currentPage = Math.min(totalPages - 1, currentPage + 1);
          await listMsg.edit({
            embeds: [createAchievementEmbed(currentPage)],
            components: createComponents(currentPage)
          });
          return;
        }

        // Handle achievement claim
        if (customId.startsWith(`claim_ach_`)) {
          const claimKey = `${userId}-ach`;

          // Check if already claiming
          if (activeClaims.has(claimKey)) {
            await interaction.createMessage({
              content: "⏳ Hold up! You already have a claim in progress. Wait for it to finish!",
              flags: 64
            }).catch(() => {});
            return;
          }

          // Mark as claiming IMMEDIATELY
          activeClaims.add(claimKey);

          try {
            await interaction.defer(64);
          } catch (deferError) {
            activeClaims.delete(claimKey);
            return;
          }
          
          try {
            const achievementId = customId.split('_')[2];
            const { getAllAchievements } = require('../../config/achievements');
            const achievement = getAllAchievements().find(a => a.id === achievementId);
            
            if (!achievement) {
              activeClaims.delete(claimKey);
              return interaction.createFollowup({
                content: "⚠️ Achievement not found.",
                flags: 64
              });
            }

            // Mark as claimed FIRST
            await AchievementService.markAchievementClaimed(userId, achievement.id);
            await UserProgress.findOneAndUpdate(
              { userId },
              { $pull: { unlockedAchievements: achievementId } }
            );

            let result;
            try {
              // Distribute reward
              result = await RewardService.distributeReward(interaction, achievement.reward);
            } catch (rewardError) {
              await AchievementService.rollbackAchievementClaim(userId, achievement.id);
              await UserProgress.findOneAndUpdate(
                { userId },
                { $addToSet: { unlockedAchievements: achievementId } }
              );
              throw rewardError;
            }

            // Send reward message
            let rewardMessage = `🎉 **Achievement Claimed: ${achievement.name}**\n\n`;

            if (result.type === 'CARDS') {
              const combinedImage = await RewardService.createCombinedImage(result.cards);
              const cardEmbed = RewardService.createCardEmbed(interaction.member.user, result.cards);

              await interaction.createFollowup({
                content: rewardMessage,
                embeds: [cardEmbed],
                files: [{ file: combinedImage, name: "achievement_cards.png" }],
                flags: 64
              });
            } else if (result.type === 'CHOICE') {
              await this.handleChoiceReward(interaction, result, achievement.id);
            } else {
              rewardMessage += RewardService.formatRewardMessage(result);
              await interaction.createFollowup({
                content: rewardMessage,
                flags: 64
              });
            }

            // Update the list
            const progress = await UserProgress.findOne({ userId });
            const updatedUnlockedIds = progress?.unlockedAchievements || [];
            const updatedClaimedIds = progress?.claimedAchievements || [];
            
            const { getAllAchievements: getAll } = require('../../config/achievements');
            const allAchievements = getAll();
            
            const updatedUnclaimed = updatedUnlockedIds
              .filter(id => !updatedClaimedIds.includes(id))
              .map(id => allAchievements.find(a => a.id === id))
              .filter(Boolean);

            if (updatedUnclaimed.length === 0) {
              await listMsg.edit({
                content: "<:check:1461015775266603110> All achievements claimed!",
                embeds: [],
                components: []
              });
              this.cleanupCollector(client, collectorKey);
            } else {
              // Refresh the page
              paginationData.unclaimedAchievements = updatedUnclaimed;
              currentPage = Math.min(currentPage, getTotalPages() - 1);
              
              await listMsg.edit({
                embeds: [createAchievementEmbed(currentPage)],
                components: createComponents(currentPage)
              });
            }
          } catch (claimError) {
            console.error("[TIER_CMD] Achievement claim error:", claimError);
            await interaction.createFollowup({
              content: "⚠️ An error occurred while claiming.",
              flags: 64
            }).catch(() => {});
          } finally {
            activeClaims.delete(claimKey);
          }
        }

      } catch (error) {
        console.error("[TIER_CMD] Achievement pagination error:", error);
        await interaction.createFollowup({
          content: "⚠️ An error occurred.",
          flags: 64
        }).catch(() => {});
      }
    };

    client.on("interactionCreate", collector);
    activeCollectors.set(collectorKey, { collector, client });

    setTimeout(() => {
      this.cleanupCollector(client, collectorKey);
      listMsg.edit({ components: [] }).catch(() => {});
    }, 300000);
  },

  // ========== SHOW ACHIEVEMENT UNLOCKS (Limited to 2) ==========
  async showAchievementUnlocks(msg, client, achievements) {
    for (const achievement of achievements) {
      const embed = AchievementService.createAchievementEmbed(achievement);
      
      const achievementMsg = await msg.channel.createMessage({
        embeds: [embed],
        components: [{
          type: 1,
          components: [{
            type: 2,
            style: 1,
            label: "Claim Achievement",
            custom_id: `claim_achievement_${achievement.id}_${msg.author.id}`,
            emoji: { name: '⭐' }
          }]
        }],
        messageReference: { messageID: msg.id }
      });

      this.setupAchievementCollector(msg, achievementMsg, client, achievement);
    }
  },

  // ========== SETUP ACHIEVEMENT COLLECTOR ==========
  setupAchievementCollector(originalMsg, achievementMsg, client, achievement) {
    const userId = originalMsg.author.id;
    const collectorKey = `ach_${achievement.id}_${userId}`;
    
    this.cleanupCollector(client, collectorKey);

    const collector = async (interaction) => {
      if (interaction.message.id !== achievementMsg.id) return;
      if (interaction.member.id !== userId) {
        return interaction.createMessage({
          content: "⚠️ This isn't your achievement!",
          flags: 64
        }).catch(() => {});
      }
      if (!interaction.data.custom_id.startsWith(`claim_achievement_${achievement.id}`)) return;

      const claimKey = `${userId}-ach-${achievement.id}`;

      // Check if already claiming
      if (activeClaims.has(claimKey)) {
        await interaction.createMessage({
          content: "⏳ Hold up! You already have a claim in progress. Wait for it to finish!",
          flags: 64
        }).catch(() => {});
        return;
      }

      // Mark as claiming IMMEDIATELY
      activeClaims.add(claimKey);

      try {
        await interaction.defer(64);
      } catch (deferError) {
        activeClaims.delete(claimKey);
        return;
      }

      try {
        // Mark as claimed FIRST
        await AchievementService.markAchievementClaimed(userId, achievement.id);
        await UserProgress.findOneAndUpdate(
          { userId },
          { $pull: { unlockedAchievements: achievement.id } }
        );

        let result;
        try {
          // Distribute reward
          result = await RewardService.distributeReward(interaction, achievement.reward);
        } catch (rewardError) {
          await AchievementService.rollbackAchievementClaim(userId, achievement.id);
          await UserProgress.findOneAndUpdate(
            { userId },
            { $addToSet: { unlockedAchievements: achievement.id } }
          );
          throw rewardError;
        }

        // Send reward message
        let rewardMessage = `🎉 **Achievement Claimed!**\n\n`;

        if (result.type === 'CARDS') {
          const combinedImage = await RewardService.createCombinedImage(result.cards);
          const cardEmbed = RewardService.createCardEmbed(interaction.member.user, result.cards);

          await interaction.createFollowup({
            content: rewardMessage,
            embeds: [cardEmbed],
            files: [{ file: combinedImage, name: "achievement_cards.png" }],
            flags: 64
          });
        } else if (result.type === 'CHOICE') {
          await this.handleChoiceReward(interaction, result, achievement.id);
        } else {
          rewardMessage += RewardService.formatRewardMessage(result);
          await interaction.createFollowup({
            content: rewardMessage,
            flags: 64
          });
        }

        // Remove button
        await achievementMsg.edit({ components: [] });
        this.cleanupCollector(client, collectorKey);

      } catch (error) {
        console.error("[TIER_CMD] Achievement claim error:", error);
        await interaction.createFollowup({
          content: "⚠️ Failed to claim achievement. Please try again.",
          flags: 64
        }).catch(() => {});
      } finally {
        activeClaims.delete(claimKey);
      }
    };

    client.on("interactionCreate", collector);
    activeCollectors.set(collectorKey, { collector, client });

    setTimeout(() => {
      this.cleanupCollector(client, collectorKey);
      activeClaims.delete(`${userId}-ach-${achievement.id}`);
      achievementMsg.edit({ components: [] }).catch(() => {});
    }, 300000);
  },

  // ========== SETUP CLAIM COLLECTOR ==========
  setupClaimCollector(originalMsg, tierMsg, client, userId, tierId) {
    const collectorKey = `tier_${userId}`;
    this.cleanupCollector(client, collectorKey);

    const collector = async (interaction) => {
      if (interaction.message.id !== tierMsg.id) return;
      if (interaction.member.id !== userId) {
        return interaction.createMessage({
          content: "⚠️ This isn't your tier view!",
          flags: 64
        }).catch(() => {});
      }
      if (!interaction.data.custom_id.startsWith(`claim_tier_${tierId}`)) return;

      const claimKey = `${userId}-tier-${tierId}`;

      // Check if already claiming
      if (activeClaims.has(claimKey)) {
        await interaction.createMessage({
          content: "⏳ Hold up! You already have a claim in progress. Wait for it to finish!",
          flags: 64
        }).catch(() => {});
        return;
      }

      // Mark as claiming IMMEDIATELY
      activeClaims.add(claimKey);

      try {
        await interaction.defer(64);
      } catch (deferError) {
        activeClaims.delete(claimKey);
        return;
      }

      try {
        // Validate claim
        const validation = await TierService.validateTierClaim(userId, tierId);
        if (!validation.valid) {
          activeClaims.delete(claimKey);
          return interaction.createFollowup({
            content: `❌ ${validation.message}`,
            flags: 64
          });
        }

        const tierConfig = getTierById(tierId);
        if (!tierConfig) {
          activeClaims.delete(claimKey);
          return interaction.createFollowup({
            content: "❌ Invalid tier configuration.",
            flags: 64
          });
        }

        // Mark tier as claimed FIRST
        await TierService.markTierAsClaimed(userId, tierId);

        let result;
        try {
          // Distribute reward
          result = await RewardService.distributeReward(interaction, tierConfig.reward);
        } catch (rewardError) {
          await TierService.rollbackTierClaim(userId, tierId);
          throw rewardError;
        }

        // Handle different reward types
        const tierNumber = tierId.replace('tier', '');
        let rewardMessage = `🎉 **Successfully claimed Tier ${tierNumber}!**\n\n`;

        if (result.type === 'CARDS') {
          const combinedImage = await RewardService.createCombinedImage(result.cards);
          const cardEmbed = RewardService.createCardEmbed(interaction.member.user, result.cards);

          await interaction.createFollowup({
            content: rewardMessage,
            embeds: [cardEmbed],
            files: [{ file: combinedImage, name: "tier_reward_cards.png" }],
            flags: 64
          });
        } else if (result.type === 'CHOICE') {
          await this.handleChoiceReward(interaction, result, tierId);
          this.cleanupCollector(client, collectorKey);
          activeClaims.delete(claimKey);
          return;
        } else if (result.type === 'MEGA') {
          rewardMessage += '**MEGA REWARD PACKAGE:**\n\n';
          for (const subResult of result.results) {
            if (subResult.type === 'CARDS') {
              const combinedImage = await RewardService.createCombinedImage(subResult.cards);
              const cardEmbed = RewardService.createCardEmbed(interaction.member.user, subResult.cards);
              await interaction.createFollowup({
                embeds: [cardEmbed],
                files: [{ file: combinedImage, name: "mega_reward_cards.png" }],
                flags: 64
              });
            } else {
              rewardMessage += RewardService.formatRewardMessage(subResult) + '\n\n';
            }
          }
          if (!result.results.some(r => r.type === 'CARDS')) {
            await interaction.createFollowup({
              content: rewardMessage,
              flags: 64
            });
          }
        } else {
          rewardMessage += RewardService.formatRewardMessage(result);
          await interaction.createFollowup({
            content: rewardMessage,
            flags: 64
          });
        }

        // Update main tier view
        const [newCardCount, newClaimedTiers] = await Promise.all([
          TierService.getUserCardCount(userId),
          TierService.getClaimedTiers(userId)
        ]);

        const updatedEmbed = TierService.createTierEmbed(newCardCount, newClaimedTiers);
        const nextTier = TierService.getFirstEligibleTierId(newCardCount, newClaimedTiers);

        const updatedMessageOptions = { 
          embeds: [updatedEmbed],
          components: []
        };

        if (nextTier) {
          updatedMessageOptions.components = [{
            type: 1,
            components: [{
              type: 2,
              style: 3,
              label: "Claim Reward",
              custom_id: `claim_tier_${nextTier}_${userId}`,
              emoji: { name: '🎁' }
            }]
          }];
        }

        await tierMsg.edit(updatedMessageOptions);
        
        // Clean up old collector FIRST
        this.cleanupCollector(client, collectorKey);

        // Set up NEW collector if there's a next tier
        if (nextTier) {
          this.setupClaimCollector(originalMsg, tierMsg, client, userId, nextTier);
        }

      } catch (error) {
        console.error("[TIER_CMD] Claim error:", error);
        await interaction.createFollowup({
          content: "⚠️ An error occurred while claiming. Please try again.",
          flags: 64
        }).catch(() => {});
      } finally {
        activeClaims.delete(claimKey);
      }
    };

    client.on("interactionCreate", collector);
    activeCollectors.set(collectorKey, { collector, client });

    setTimeout(() => {
      this.cleanupCollector(client, collectorKey);
      activeClaims.delete(`${userId}-tier-${tierId}`);
      tierMsg.edit({ components: [] }).catch(() => {});
    }, 300000);
  },

  // ========== HANDLE CHOICE REWARDS ==========
  async handleChoiceReward(interaction, result, sourceId) {
    const userId = interaction.member.id;
    
    const choiceEmbed = {
      title: "🎁 Choose Your Reward",
      description: "Select one of the options below:",
      fields: result.options.map((opt, i) => ({
        name: `Option ${i + 1}`,
        value: TierService.formatRewardText(opt),
        inline: false
      })),
      color: 0x9966CC
    };

    const choiceMsg = await interaction.createFollowup({
      embeds: [choiceEmbed],
      components: [{
        type: 1,
        components: result.options.slice(0, 3).map((opt, i) => ({
          type: 2,
          style: 1,
          label: `Option ${i + 1}`,
          custom_id: `choice_${sourceId}_${i}_${userId}`,
          emoji: { name: ['1️⃣', '2️⃣', '3️⃣'][i] }
        }))
      }],
      flags: 64
    });

    const collectorKey = `choice_${sourceId}_${userId}`;
    this.cleanupCollector(interaction._client, collectorKey);

    const choiceCollector = async (choiceInteraction) => {
      if (choiceInteraction.message.id !== choiceMsg.id) return;
      if (choiceInteraction.member.id !== userId) return;
      if (!choiceInteraction.data.custom_id.startsWith(`choice_${sourceId}_`)) return;

      const choiceKey = `${userId}-choice-${sourceId}`;

      // Check if already choosing
      if (activeClaims.has(choiceKey)) {
        await choiceInteraction.createMessage({
          content: "⏳ Hold up! You already have a choice in progress. Wait for it to finish!",
          flags: 64
        }).catch(() => {});
        return;
      }

      // Mark as choosing IMMEDIATELY
      activeClaims.add(choiceKey);

      try {
        await choiceInteraction.defer(64);
      } catch (deferError) {
        activeClaims.delete(choiceKey);
        return;
      }

      try {
        const customId = choiceInteraction.data.custom_id;
        const prefix = `choice_${sourceId}_`;
        const suffix = `_${userId}`;
        const choiceIndexStr = customId.slice(prefix.length, customId.length - suffix.length);
        const choiceIndex = Number.parseInt(choiceIndexStr, 10);

        if (Number.isNaN(choiceIndex) || choiceIndex < 0 || choiceIndex >= result.options.length) {
          await choiceInteraction.createFollowup({
            content: "⚠️ Invalid choice selection.",
            flags: 64
          }).catch(() => {});
          return;
        }

        const chosenReward = result.options[choiceIndex];

        const choiceResult = await RewardService.distributeReward(choiceInteraction, chosenReward);

        let message = `✅ **Choice confirmed!**`;

        if (choiceResult.type === 'CARDS') {
          const combinedImage = await RewardService.createCombinedImage(choiceResult.cards);
          const cardEmbed = RewardService.createCardEmbed(choiceInteraction.member.user, choiceResult.cards);

          await choiceInteraction.createFollowup({
            content: message,
            embeds: [cardEmbed],
            files: [{ file: combinedImage, name: "choice_reward.png" }],
            flags: 64
          });
        } else {
          message += '\n\n' + RewardService.formatRewardMessage(choiceResult);
          await choiceInteraction.createFollowup({
            content: message,
            flags: 64
          });
        }

        // Update the original choice message
        await choiceInteraction.editOriginalMessage({
          content: "✅ **Reward claimed!**",
          embeds: [],
          components: []
        });

        this.cleanupCollector(interaction._client, collectorKey);

      } catch (error) {
        console.error("[TIER_CMD] Choice error:", error);
        await choiceInteraction.createFollowup({
          content: "⚠️ Failed to process choice.",
          flags: 64
        }).catch(() => {});
      } finally {
        activeClaims.delete(choiceKey);
      }
    };

    interaction._client.on("interactionCreate", choiceCollector);
    activeCollectors.set(collectorKey, { collector: choiceCollector, client: interaction._client });

    setTimeout(() => {
      this.cleanupCollector(interaction._client, collectorKey);
      activeClaims.delete(`${userId}-choice-${sourceId}`);
    }, 60000);
  },

  // ========== CLEANUP COLLECTOR ==========
  cleanupCollector(client, key) {
    const active = activeCollectors.get(key);
    if (active) {
      client.removeListener("interactionCreate", active.collector);
      activeCollectors.delete(key);
    }
  },

  // ========== CLEANUP ALL USER COLLECTORS ==========
  cleanupCollectorsForUser(client, userId) {
    for (const key of activeCollectors.keys()) {
      if (key.endsWith(`_${userId}`)) {
        this.cleanupCollector(client, key);
      }
    }
  },

  // ========== REGISTRATION MESSAGE ==========
  async sendRegistrationMessage(msg) {
    return msg.channel.createMessage({
      embeds: [{
        title: "🚫 Uncharted Territory",
        description: "Oops! It seems you haven't registered for this grand adventure yet. Fear not, brave soul! Simply use the `?register` command to begin your journey and unlock a world of possibilities!",
        color: 0xFF6B6B,
        footer: { text: "Your epic saga awaits!" }
      }],
      messageReference: { messageID: msg.id }
    });
  }
};