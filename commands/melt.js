//  melt.js – card melting system for resource conversion
// -----------------------------------------------------------------------------
const User        = require("../models/user");
const Currency    = require("../models/currency");
const Graphic     = require("../models/graphic");
const Marketplace = require("../models/marketplace");
const BattleTeam  = require("../models/battleTeam");
const { CONDITION_EMOJIS, RARITY_EMOJIS } = require("../config/embedConstants");

/* --------------- CONFIGURATION --------------- */
const BOT_USER_ID = "1117452463407104042";
const MAX_CARDS_PER_MELT = 7;
const CONFIRMATION_TIMEOUT = 30000;

const CONDITION_MULTIPLIERS = {
  Pristine : 1.3,
  Mint     : 1.15,
  Good     : 1,
  Worn     : 0.15,
  Damaged  : 0.3
};

const RESOURCE_CONFIG = {
  crystals: {
    displayName: "Rose Crystals",
    emoji: "<:rose:1461015415466496191> "
  },
  stardust: {
    displayName: "Stardust",
    emoji: "<:stardust:1449661267915571274>"
  },
  astralEssence: {
    displayName: "Astral Essence",
    emoji: "<:astralessence:1461015891138318598>"
  },
};

const RARITY_REWARDS = {
  Standard : {
    crystals       : [80, 160],
    stardust       : [0, 2],
    astralEssence  : [0, 0],
  },
  Unique : {
    crystals       : [160, 400],
    stardust       : [1, 4],
    astralEssence  : [0, 2],
  },
  Glyph : {
    crystals       : [400, 800],
    stardust       : [3, 7],
    astralEssence  : [1, 5],
  },
  Mythic : {
    crystals       : [1200, 4000],
    stardust       : [5, 10],
    astralEssence  : [3, 10],
  }
};

const activeCollectors = new Map();
const activeMelts = new Set();

// Periodic cleanup for stale entries (safety net)
setInterval(() => {
  // Check for stale collectors (older than 2 minutes should have timed out)
  const now = Date.now();
  for (const [userId, collector] of activeCollectors.entries()) {
    if (collector.createdAt && now - collector.createdAt > 120000) {
      console.warn(`[MELT] Cleaning stale collector for user ${userId}`);
      if (collector.cleanup) collector.cleanup();
      activeCollectors.delete(userId);
      activeMelts.delete(userId);
    }
  }
  
  // Safety net for activeMelts
  if (activeMelts.size > 50) {
    console.warn('[MELT] activeMelts has grown large, clearing stale entries');
    activeMelts.clear();
  }
}, 120000); // 2 minutes

/* --------------- HELPER FUNCTIONS --------------- */
const getRandomNumber = (min, max) => 
  Math.floor(Math.random() * (max - min + 1) + min);

const createEmbed = (title, description, color, thumbnailUrl = null) => ({
  title,
  description,
  color,
  ...(thumbnailUrl && { thumbnail: { url: thumbnailUrl } }),
  timestamp: new Date().toISOString()
});

async function calculateRewards(cards) {
  const totalRewards = {
    crystals       : 0,
    stardust       : 0,
    astralEssence  : 0,
  };

  for (const card of cards) {
    const conditionMultiplier = CONDITION_MULTIPLIERS[card.condition] || 1;
    const rewards = RARITY_REWARDS[card.rarity];
    
    if (!rewards) {
      console.warn(`Unknown rarity: ${card.rarity} for card ${card.cardCode}`);
      continue;
    }

    for (const [resource, [min, max]] of Object.entries(rewards)) {
      const baseReward = getRandomNumber(min, max);
      totalRewards[resource] += Math.round(baseReward * conditionMultiplier);
    }
  }

  return totalRewards;
}

// Format card line matching gift.js style
function formatCardLine(card) {
  const conditionEmoji = CONDITION_EMOJIS[card.condition.toLowerCase()] || "❓";
  const rarityStars = RARITY_EMOJIS[card.rarity.toLowerCase()] || "☆☆☆☆";
  
  return `[${conditionEmoji}] ${rarityStars} **${card.group} ${card.name}** #${card.printNumber} – \`${card.cardCode}\``;
}

// Format rewards for display with emojis and proper names
function formatRewards(rewards) {
  return Object.entries(rewards)
    .filter(([_, value]) => value > 0)
    .map(([key, value]) => {
      const config = RESOURCE_CONFIG[key];
      return `${config.emoji} ${value} ${config.displayName}`;
    })
    .join('\n');
}

/* --------------- MAIN MELT FUNCTION --------------- */
async function meltCards(msg, args, client) {
  const discordId = msg.author.id;
  const cardCodes = args.slice(0, MAX_CARDS_PER_MELT);

  if (!cardCodes.length) {
    return msg.channel.createMessage({
      content: "Please provide at least one card code to melt.",
      messageReference: { messageID: msg.id }
    });
  }

  try {
    // Check if any cards are listed on marketplace
    const marketplaceListings = await Marketplace.find({ 
      code: { $in: cardCodes } 
    }).lean();
    
    if (marketplaceListings.length) {
      return msg.channel.createMessage({
        content: `You can't melt cards that you're selling on the marketplace: ${marketplaceListings.map(l => l.code).join(", ")}`,
        messageReference: { messageID: msg.id }
      });
    }

    // Check if any cards are in battle team
    const battleTeam = await BattleTeam.findOne({ 
      userId: discordId,
      cardCodes: { $in: cardCodes }
    }).lean();
    
    if (battleTeam) {
      const battleCards = cardCodes.filter(code => 
        battleTeam.cardCodes.includes(code)
      );
      return msg.channel.createMessage({
        content: `⚔️ Battle team cards cannot be melted: \`${battleCards.join(", ")}\``,
        messageReference: { messageID: msg.id }
      });
    }

    // Find user's cards
    const userCards = await User.find({ 
      discordId, 
      cardCode: { $in: cardCodes } 
    }).lean();
    
    if (!userCards.length) {
      return msg.channel.createMessage({
        content: "No valid cards found to melt.",
        messageReference: { messageID: msg.id }
      });
    }

    // Check for duplicates in requested codes vs found cards
    if (userCards.length !== cardCodes.length) {
      const foundCodes = userCards.map(c => c.cardCode);
      const missingCodes = cardCodes.filter(code => !foundCodes.includes(code));
      
      return msg.channel.createMessage({
        content: `Some card codes were not found or don't belong to you: ${missingCodes.join(", ")}`,
        messageReference: { messageID: msg.id }
      });
    }

    // Check for locked cards
    const locked = userCards.filter(card => card.cardLocked === true);
    if (locked.length) {
      return msg.channel.createMessage({
        content: `🔒 Locked cards cannot be melted: \`${locked.map(c => c.cardCode).join(", ")}\``,
        messageReference: { messageID: msg.id }
      });
    }

    const cardList = userCards.map(c => formatCardLine(c)).join('\n');
    
    const confirmationEmbed = createEmbed(
      "🔥 Melt Confirmation",
      `**From:** ${msg.author.username}\n\n**Cards (${userCards.length}):**\n${cardList}`,
      0x5865F2,
      userCards[0].imageURL
    );

    const buttons = [
      {
        type: 2,
        style: 3,
        custom_id: "confirm_melt",
        emoji: { id: "1461015775266603110", name: "check" }
      },
      {
        type: 2,
        style: 4,
        custom_id: "cancel_melt",
        emoji: { id: "1461015696954753034", name: "cross" }
      }
    ];

    const confirmationMessage = await msg.channel.createMessage({
      embeds: [confirmationEmbed],
      messageReference: { messageID: msg.id },
      components: [{ type: 1, components: buttons }]
    });

    await handleMeltConfirmation(
      client, 
      confirmationMessage, 
      msg, 
      userCards, 
      cardCodes, 
      discordId,
      cardList
    );

  } catch (err) {
    console.error("Melt cards error:", err);
    
    return msg.channel.createMessage({
      content: "An error occurred while processing the card melting.",
      messageReference: { messageID: msg.id }
    });
  }
}

/* --------------- CONFIRMATION HANDLER --------------- */
async function handleMeltConfirmation(client, confirmationMessage, msg, userCards, cardCodes, discordId, cardList) {
  // Clean up any existing collector for this user
  const existingCollector = activeCollectors.get(msg.author.id);
  if (existingCollector) {
    client.removeListener("interactionCreate", existingCollector.handler);
    clearTimeout(existingCollector.timeout);
  }

  return new Promise((resolve) => {
    let isCollectorActive = true;

    const timeoutId = setTimeout(() => {
      if (isCollectorActive) {
        cleanup();
        
        confirmationMessage.edit({
          embeds: [createEmbed(null, "Card melting operation timed out.", 0xFEE75C)],
          components: []
        }).catch(() => {});
        
        resolve();
      }
    }, CONFIRMATION_TIMEOUT);

    const collector = async (i) => {
      if (!isCollectorActive) return;
      if (i.message.id !== confirmationMessage.id) return;
      if (i.member.id !== msg.author.id) return;

      // Check if user already has an active melt processing
      if (activeMelts.has(discordId)) {
        await i.createMessage({
          content: "⏳ Melt in progress. Please wait!",
          flags: 64
        }).catch(() => {});
        return;
      }

      isCollectorActive = false;

      try {
        // Acknowledge immediately
        await i.acknowledge();

        if (i.data.custom_id === "confirm_melt") {
          // Mark as active ONLY when processing starts
          activeMelts.add(discordId);
          
          try {
            // Re-validate cards still exist and belong to user
            const currentCards = await User.find({ 
              discordId, 
              cardCode: { $in: cardCodes } 
            }).lean();

            if (currentCards.length !== userCards.length) {
              await client.editMessage(
                confirmationMessage.channel.id,
                confirmationMessage.id,
                {
                  embeds: [createEmbed(
                    "❌ Melt Failed",
                    "Some cards are no longer available. Please try again.", 
                    0xED4245
                  )],
                  components: []
                }
              );
              
              cleanup();
              return resolve();
            }

            // Calculate rewards
            const totalRewards = await calculateRewards(userCards);

            // Execute melt transaction atomically
            const [updateResult, currencyResult] = await Promise.all([
              User.updateMany(
                { 
                  discordId, 
                  cardCode: { $in: cardCodes } 
                },
                { discordId: BOT_USER_ID }
              ),
              Currency.findOneAndUpdate(
                { userId: discordId },
                { $inc: totalRewards },
                { upsert: true, new: true }
              )
            ]);

            if (updateResult.modifiedCount !== userCards.length) {
              console.error("Mismatch in cards melted");
            }

            const successEmbed = createEmbed(
              "<:check:1461015775266603110> Melt Successful!",
              `Melted **${updateResult.modifiedCount}** card(s).\n\n**Cards (${userCards.length}):**\n${cardList}\n\n**Rewards Received:**\n${formatRewards(totalRewards)}`,
              0x57F287,
              userCards[0].imageURL
            );

            // Update quest progress for melt command
            const QuestService = require("../services/QuestService");
            QuestService.updateQuestProgress(discordId, ['melt'], updateResult.modifiedCount).catch(err =>
              console.error('[MELT_QUEST_UPDATE_ERROR]', err)
            );

            await client.editMessage(
              confirmationMessage.channel.id,
              confirmationMessage.id,
              { 
                embeds: [successEmbed], 
                components: [] 
              }
            );

          } finally {
            // Always remove from active melts
            activeMelts.delete(discordId);
          }

        } else {
          await client.editMessage(
            confirmationMessage.channel.id,
            confirmationMessage.id,
            {
              embeds: [createEmbed("❌ Cancelled", "Melt cancelled.", 0xFEE75C)],
              components: []
            }
          );
        }

      } catch (error) {
        console.error("Melt confirmation error:", error);
        
        await client.editMessage(
          confirmationMessage.channel.id,
          confirmationMessage.id,
          {
            embeds: [createEmbed("❌ Error", "Something went wrong. Please try again.", 0xED4245)],
            components: []
          }
        ).catch(() => {});
      } finally {
        cleanup();
        resolve();
      }
    };

    const cleanup = () => {
      if (!isCollectorActive) return;
      
      isCollectorActive = false;
      clearTimeout(timeoutId);
      client.removeListener("interactionCreate", collector);
      activeCollectors.delete(msg.author.id);
    };

    client.on("interactionCreate", collector);
    
    activeCollectors.set(msg.author.id, {
      handler: collector,
      timeout: timeoutId,
      cleanup,
      createdAt: Date.now()
    });
  });
}

/* --------------- COMMAND EXPORT --------------- */
module.exports = {
  name: "melt",
  description: "Delete up to 7 cards and receive rewards based on rarity and condition.",
  
  async execute(msg, args, client) {
    try {
      const userId = msg.author.id;
      await meltCards(msg, args, client);
      
    } catch (error) {
      console.error("Melt command error:", error);
      
      return msg.channel.createMessage({
        embeds: [createEmbed(null, "An error occurred while executing the command.", 0xED4245)],
        messageReference: { messageID: msg.id }
      });
    }
  }
};

/* --------------- CLEANUP --------------- */
process.on("SIGINT", () => {
  activeCollectors.forEach(({ cleanup }) => cleanup());
  activeCollectors.clear();
  activeMelts.clear();
});