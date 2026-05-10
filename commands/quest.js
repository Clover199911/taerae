/**
 * Quest Command - Daily quest tracking and reward claiming
 * Usage: ?quest / ?quests
 */

const QuestService = require("../services/QuestService");
const Currency = require("../models/currency");
const Graphic = require("../models/graphic");
const {
  QUEST_POOL,
  QUEST_EMOJIS,
  COMPLETION_BONUS,
  PROGRESS_BAR,
  STATUS_COLORS,
  QUEST_SETTINGS
} = require("../config/questConfig");
const { CURRENCY_EMOJIS, STATUS_EMOJIS } = require("../config/embedConstants");

// ==================== CONFIGURATION ====================
const CONFIG = {
  buttonTimeout: 120_000, // 2 minutes
  colors: {
    incomplete: 0x95A5A6,
    completed: 0x2ECC71,
    claimed: 0x3498DB,
    allComplete: 0xFFD700
  }
};

// ==================== HELPERS ====================
const formatNumber = num => num.toLocaleString();

const createProgressBar = (progress, target) => {
  const percentage = Math.min(progress / target, 1);
  const filled = Math.round(percentage * PROGRESS_BAR.length);
  const empty = PROGRESS_BAR.length - filled;
  return PROGRESS_BAR.filled.repeat(filled) + PROGRESS_BAR.empty.repeat(empty);
};

const getStatusEmoji = (status) => {
  switch (status) {
    case "incomplete": return QUEST_EMOJIS.incomplete;
    case "completed": return QUEST_EMOJIS.complete;
    case "claimed": return QUEST_EMOJIS.claimed;
    default: return "⬜";
  }
};

const formatReward = (reward) => {
  const parts = [];
  const emoji = CURRENCY_EMOJIS[reward.type] || "💰";
  parts.push(`${emoji} ${formatNumber(reward.amount)}`);
  
  // Only show secondary if it has valid type and amount
  if (reward.secondary && reward.secondary.type && reward.secondary.amount > 0) {
    const secEmoji = CURRENCY_EMOJIS[reward.secondary.type] || "💰";
    parts.push(`${secEmoji} ${formatNumber(reward.secondary.amount)}`);
  }
  
  // Show card reward if present
  if (reward.card && reward.card.count > 0) {
    parts.push(`🎴 ${reward.card.rarity} Card`);
  }
  
  return parts.join(" + ");
};

const getDifficultyStars = (difficulty) => {
  switch (difficulty) {
    case "easy": return "⭐";
    case "medium": return "⭐⭐";
    case "hard": return "⭐⭐⭐";
    default: return "⭐";
  }
};

// ==================== EMBED BUILDERS ====================
const buildQuestEmbed = async (userId, username, avatarURL) => {
  const quests = await QuestService.getActiveQuests(userId);
  const stats = await QuestService.getQuestStats(userId);
  const timeUntilReset = QuestService.getTimeUntilReset();
  
  // Determine embed color based on status
  let embedColor = CONFIG.colors.incomplete;
  if (stats.allComplete && stats.bonusAvailable) {
    embedColor = CONFIG.colors.allComplete;
  } else if (stats.completed > 0) {
    embedColor = CONFIG.colors.completed;
  }
  
  const embed = {
    author: {
      name: `${username}'s Daily Quests`,
      icon_url: avatarURL
    },
    description: `**Progress:** ${stats.completed + stats.claimed}/${stats.total} completed\n` +
      `**Reset:** <t:${timeUntilReset.timestamp}:R> (<t:${timeUntilReset.timestamp}:t>)\n\n` +
      `**───────────────────**`,
    color: embedColor,
    fields: [],
    footer: {
      text: "Complete all quests for a bonus reward!"
    },
    timestamp: new Date()
  };
  
  // Add quest fields with numbering
  for (let i = 0; i < quests.length; i++) {
    const quest = quests[i];
    const questNumber = i + 1;
    const questConfig = QUEST_POOL[quest.questType] || {};
    const emoji = questConfig.emoji || "📋";
    const statusEmoji = getStatusEmoji(quest.status);
    const progressBar = createProgressBar(quest.progress, quest.target);
    const diffStars = getDifficultyStars(quest.difficulty);
    
    let fieldValue = `${progressBar} \`${quest.progress}/${quest.target}\`\n`;
    fieldValue += `${diffStars} │ Reward: ${formatReward(quest.reward)}`;
    
    if (quest.status === "completed") {
      fieldValue += `\n${STATUS_EMOJIS.success} **Ready to claim!**`;
    } else if (quest.status === "claimed") {
      fieldValue += "\n💎 **Claimed!**";
    }
    
    embed.fields.push({
      name: `${statusEmoji} ${questNumber}. ${emoji} ${quest.description}`,
      value: fieldValue,
      inline: false
    });
  }
  
  // Add completion bonus section
  embed.fields.push({
    name: "───────────────────",
    value: `🎁 **Completion Bonus** (All 5 quests)\n` +
      `${CURRENCY_EMOJIS.crystals} ${formatNumber(COMPLETION_BONUS.crystals)} ` +
      `+ ${CURRENCY_EMOJIS.stardust} ${COMPLETION_BONUS.stardust} ` +
      `+ ${CURRENCY_EMOJIS.astralEssence} ${COMPLETION_BONUS.astralEssence}` +
      (stats.bonusAvailable ? "\n\n🎉 **Bonus available! Click below to claim all!**" : ""),
    inline: false
  });
  
  return { embed, quests, stats };
};

const buildClaimButtons = (quests, stats) => {
  const components = [];
  
  // Build claimable quests with their actual position numbers
  const claimableWithIndex = quests
    .map((quest, index) => ({ quest, questNumber: index + 1 }))
    .filter(item => item.quest.status === "completed");
  
  if (claimableWithIndex.length > 0) {
    const row1 = {
      type: 1,
      components: claimableWithIndex.slice(0, 5).map(({ quest, questNumber }) => ({
        type: 2,
        style: 3, // Green
        custom_id: `claim_quest_${quest.questId}`,
        label: `Claim #${questNumber}`,
        emoji: { name: "✅" }
      }))
    };
    components.push(row1);
  }
  
  // Claim All / Bonus button
  if (stats.bonusAvailable || claimableWithIndex.length > 1) {
    const row2 = {
      type: 1,
      components: [{
        type: 2,
        style: stats.bonusAvailable ? 1 : 2, // Primary if bonus available
        custom_id: "claim_all_quests",
        label: stats.bonusAvailable ? "Claim All + Bonus!" : "Claim All",
        emoji: { name: stats.bonusAvailable ? "🎁" : "📥" },
        disabled: claimableWithIndex.length === 0 && !stats.bonusAvailable
      }]
    };
    components.push(row2);
  }
  
  // Refresh button
  const refreshRow = {
    type: 1,
    components: [{
      type: 2,
      style: 2,
      custom_id: "refresh_quests",
      label: "Refresh",
      emoji: { name: "🔄" }
    }]
  };
  components.push(refreshRow);
  
  return components;
};

// ==================== MAIN COMMAND ====================
module.exports = {
  name: "quest",
  aliases: ["quests", "dq", "dailyquest"],
  description: "View and claim daily quests",
  
  async execute(msg, args, client) {
    const userId = msg.author.id;
    const username = msg.author.username;
    const avatarURL = msg.author.avatarURL;
    
    try {
      // Check if user is registered
      const registration = await Graphic.findOne({ userId }).lean();
      if (!registration) {
        return msg.channel.createMessage({
          content: "Please register with `?register` first.",
          messageReference: { messageID: msg.id }
        });
      }
      
      // Build initial embed
      const { embed, quests, stats } = await buildQuestEmbed(userId, username, avatarURL);
      const components = buildClaimButtons(quests, stats);
      
      const questMessage = await msg.channel.createMessage({
        embeds: [embed],
        components,
        messageReference: { messageID: msg.id }
      });
      
      // Setup interaction handler
      const handleInteraction = async (interaction) => {
        // Verify it's for this message and user
        if (interaction.message.id !== questMessage.id) return;
        if (interaction.member.id !== userId) {
          return interaction.createMessage({
            content: "This isn't your quest panel!",
            flags: 64 // Ephemeral
          });
        }
        
        const customId = interaction.data.custom_id;
        
        try {
          // Defer the interaction immediately to prevent "Unknown interaction" errors
          // This acknowledges the interaction within Discord's 3-second window
          // Using deferUpdate() for component interactions that update the parent message
          await interaction.deferUpdate();
          
          if (customId === "refresh_quests") {
            // Refresh the quest display
            const { embed: newEmbed, quests: newQuests, stats: newStats } = 
              await buildQuestEmbed(userId, username, avatarURL);
            const newComponents = buildClaimButtons(newQuests, newStats);
            
            await interaction.editParent({
              embeds: [newEmbed],
              components: newComponents
            });
            
          } else if (customId.startsWith("claim_quest_")) {
            // Claim individual quest
            const questId = customId.replace("claim_quest_", "");
            const result = await QuestService.claimQuestReward(userId, questId);
            
            if (result.success) {
              // Refresh display
              const { embed: newEmbed, quests: newQuests, stats: newStats } = 
                await buildQuestEmbed(userId, username, avatarURL);
              const newComponents = buildClaimButtons(newQuests, newStats);
              
              // Build reward message
              const rewardParts = [];
              for (const [type, amount] of Object.entries(result.rewards || {})) {
                // Skip undefined/null amounts and non-currency keys
                if (amount == null || amount <= 0) continue;
                if (!CURRENCY_EMOJIS[type]) continue; // Only valid currency types
                const emoji = CURRENCY_EMOJIS[type];
                rewardParts.push(`${emoji} ${formatNumber(amount)}`);
              }
              
              // Add card reward to message if present
              let cardMsg = "";
              if (result.cardReward) {
                cardMsg = `\n🎴 **Bonus Card!** ${result.cardReward.rarity} **${result.cardReward.group} ${result.cardReward.name}** - \`${result.cardReward.cardCode}\``;
              }
              
              await interaction.editParent({
                content: `${STATUS_EMOJIS.success} Quest claimed! You received: ${rewardParts.join(" + ")}${cardMsg}`,
                embeds: [newEmbed],
                components: newComponents
              });
            } else {
              await interaction.createFollowup({
                content: `❌ ${result.error}`,
                flags: 64
              });
            }
            
          } else if (customId === "claim_all_quests") {
            // Claim all completed quests + bonus if available
            const currentStats = await QuestService.getQuestStats(userId);
            
            if (currentStats.bonusAvailable) {
              // Claim bonus (which also claims all completed quests)
              const result = await QuestService.claimCompletionBonus(userId);
              
              if (result.success) {
                // Calculate total rewards
                let totalRewards = {
                  crystals: COMPLETION_BONUS.crystals,
                  stardust: COMPLETION_BONUS.stardust,
                  astralEssence: COMPLETION_BONUS.astralEssence
                };
                
                // Add individual quest rewards + track card rewards
                const cardRewards = [];
                for (const qr of result.questRewards || []) {
                  if (qr.success) {
                    for (const [type, amount] of Object.entries(qr.rewards || {})) {
                      if (amount != null && amount > 0 && CURRENCY_EMOJIS[type]) {
                        totalRewards[type] = (totalRewards[type] || 0) + amount;
                      }
                    }
                    if (qr.cardReward) {
                      cardRewards.push(qr.cardReward);
                    }
                  }
                }
                
                // Add bonus card reward if present
                if (result.bonusCardReward) {
                  cardRewards.push(result.bonusCardReward);
                }
                
                // Refresh display
                const { embed: newEmbed, quests: newQuests, stats: newStats } = 
                  await buildQuestEmbed(userId, username, avatarURL);
                const newComponents = buildClaimButtons(newQuests, newStats);
                
                // Build reward message
                const rewardParts = [];
                for (const [type, amount] of Object.entries(totalRewards)) {
                  if (amount != null && amount > 0 && CURRENCY_EMOJIS[type]) {
                    const emoji = CURRENCY_EMOJIS[type];
                    rewardParts.push(`${emoji} ${formatNumber(amount)}`);
                  }
                }
                
                // Build card rewards message
                let cardMsg = "";
                if (cardRewards.length > 0) {
                  const cardParts = cardRewards.map(c => 
                    `🎴 ${c.rarity} **${c.group} ${c.name}** - \`${c.cardCode}\``
                  );
                  cardMsg = `\n${cardParts.join("\n")}`;
                }
                
                await interaction.editParent({
                  content: `🎉 **All quests claimed + Completion Bonus!**\nYou received: ${rewardParts.join(" + ")}${cardMsg}`,
                  embeds: [newEmbed],
                  components: newComponents
                });
              } else {
                await interaction.createFollowup({
                  content: `❌ ${result.error}`,
                  flags: 64
                });
              }
            } else {
              // Just claim all completed quests (no bonus)
              const currentQuests = await QuestService.getActiveQuests(userId);
              const completedQuests = currentQuests.filter(q => q.status === "completed");
              
              let totalRewards = {};
              const cardRewards = [];
              for (const quest of completedQuests) {
                const claimResult = await QuestService.claimQuestReward(userId, quest.questId);
                if (claimResult.success) {
                  for (const [type, amount] of Object.entries(claimResult.rewards || {})) {
                    if (amount != null && amount > 0 && CURRENCY_EMOJIS[type]) {
                      totalRewards[type] = (totalRewards[type] || 0) + amount;
                    }
                  }
                  if (claimResult.cardReward) {
                    cardRewards.push(claimResult.cardReward);
                  }
                }
              }
              
              // Refresh display
              const { embed: newEmbed, quests: newQuests, stats: newStats } = 
                await buildQuestEmbed(userId, username, avatarURL);
              const newComponents = buildClaimButtons(newQuests, newStats);
              
              // Build reward message
              const rewardParts = [];
              for (const [type, amount] of Object.entries(totalRewards)) {
                if (amount != null && amount > 0 && CURRENCY_EMOJIS[type]) {
                  const emoji = CURRENCY_EMOJIS[type];
                  rewardParts.push(`${emoji} ${formatNumber(amount)}`);
                }
              }
              
              // Build card rewards message
              let cardMsg = "";
              if (cardRewards.length > 0) {
                const cardParts = cardRewards.map(c => 
                  `🎴 ${c.rarity} **${c.group} ${c.name}** - \`${c.cardCode}\``
                );
                cardMsg = `\n${cardParts.join("\n")}`;
              }
              
              const rewardMsg = rewardParts.length > 0 
                ? `✅ Quests claimed! You received: ${rewardParts.join(" + ")}${cardMsg}`
                : "No quests to claim!";
              
              await interaction.editParent({
                content: rewardMsg,
                embeds: [newEmbed],
                components: newComponents
              });
            }
          }
        } catch (err) {
          console.error("[QUEST_INTERACTION_ERROR]", err);
          await interaction.createFollowup({
            content: "❌ An error occurred. Please try again.",
            flags: 64
          }).catch(() => {});
        }
      };
      
      client.on("interactionCreate", handleInteraction);
      
      // Cleanup after timeout
      setTimeout(() => {
        client.off("interactionCreate", handleInteraction);
        questMessage.edit({
          embeds: [embed],
          components: [] // Remove buttons
        }).catch(() => {});
      }, CONFIG.buttonTimeout);
      
    } catch (err) {
      console.error("[QUEST_COMMAND_ERROR]", err);
      msg.channel.createMessage({
        content: "❌ Could not load quests. Please try again.",
        messageReference: { messageID: msg.id }
      });
    }
  }
};
