//  enhance.js — card enhancement system with condition & wellness upgrades
// -----------------------------------------------------------------------------
const User        = require("../models/user");
const Currency    = require("../models/currency");
const Graphic     = require("../models/graphic");
const PACK_CONFIG = require("../utils/packConfig");
const CardGenerationService = require("../services/CardGenerationService");
const { CONDITION_EMOJIS } = require("../config/embedConstants");

/* --------------- EMOJI CONFIG --------------- */
const EMOJI = {
  // Currency
  crystals      : "<:rose:1461015415466496191>",
  essence       : "<:astralessence:1461015891138318598>",
  stardust      : "<:stardust:1449661267915571274>",
  
  // Status
  success       : "<:check:1461015775266603110>",
  fail          : "<:cross:1461015696954753034>",
  warning       : "⚠️",
  upgrade       : "⬆️",
  
  // Card states
  condition     : "<:cards:1461015816869777450>",
  wellness      : "💫",
  pristine      : "<:pristinee:1272529510696222842>"
};

/* --------------- CONFIGURATION --------------- */
const CONDITION_ORDER = ['Damaged', 'Worn', 'Good', 'Mint', 'Pristine'];

const RARITY_CONFIG = {
  Standard : { maxWellness : 200,  stardustCost : 1 },
  Unique   : { maxWellness : 400,  stardustCost : 2 },
  Glyph    : { maxWellness : 700,  stardustCost : 3 },
  Mythic   : { maxWellness : 1000, stardustCost : 3 }
};

const BUTTON_COOLDOWN = 1750;
const INTERFACE_TIMEOUT = 60000;
const CLEANUP_INTERVAL = 300000;
const SELECTION_TIMEOUT = 60000;
const CONTINUE_TIMEOUT = 60000;
const CONFIRM_TIMEOUT = 60000;

// Bot ID for card destruction (transferred cards go to this bot)
const CARD_DESTRUCTION_BOT_ID = process.env.BOT_USER_ID || "1117452463407104042";

/* --------------- STATE MANAGEMENT --------------- */
const buttonCooldowns = new Map();
const wellnessUpdates = new Map();
const activeCollectors = new Map();
const activeEnhancements = new Set();
const cardSelections = new Map();

// Periodic cleanup to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  
  for (const [key, timestamp] of buttonCooldowns.entries()) {
    if (now - timestamp >= BUTTON_COOLDOWN) {
      buttonCooldowns.delete(key);
    }
  }
  
  for (const [key, timestamp] of wellnessUpdates.entries()) {
    if (now - timestamp >= CLEANUP_INTERVAL) {
      wellnessUpdates.delete(key);
    }
  }
  
  // Cleanup stale activeCollectors
  for (const [userId, collector] of activeCollectors.entries()) {
    if (collector.createdAt && now - collector.createdAt > INTERFACE_TIMEOUT + 30000) {
      console.warn(`[ENHANCE] Cleaning stale collector for user ${userId}`);
      if (collector.cleanup) collector.cleanup();
      activeCollectors.delete(userId);
      activeEnhancements.delete(userId);
      cardSelections.delete(userId);
    }
  }
  
  // Safety net for activeEnhancements
  if (activeEnhancements.size > 100) {
    console.warn('[ENHANCE] activeEnhancements has grown large, clearing stale entries');
    activeEnhancements.clear();
  }
}, CLEANUP_INTERVAL);

/* --------------- HELPER FUNCTIONS --------------- */
const isOnCooldown = (userId) => {
  const lastUsed = buttonCooldowns.get(userId);
  return lastUsed && Date.now() - lastUsed < BUTTON_COOLDOWN;
};

const setButtonCooldown = (userId) => {
  buttonCooldowns.set(userId, Date.now());
};

const formatNumber = (num) => 
  num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const getConditionCost = (currentConditionIndex) => ({
  crystals      : (currentConditionIndex + 1) * 500,
  astralEssence : currentConditionIndex + 2
});

// Check if card is an event card
const isEventCard = (cardId) => {
  const cardIdStr = cardId.toString();
  
  // Get all event card IDs from pack config
  const eventCardIds = new Set();
  
  // Collect winter cards
  ['winter-1', 'winter-5', 'winter-10'].forEach(pack => {
    const config = PACK_CONFIG[pack];
    if (config?.winterCardIds) {
      config.winterCardIds.forEach(id => eventCardIds.add(id.toString()));
    }
  });
  
  // Collect new update cards
  ['new-update-1', 'new-update-5', 'new-update-10'].forEach(pack => {
    const config = PACK_CONFIG[pack];
    if (config?.newCardIds) {
      config.newCardIds.forEach(id => eventCardIds.add(id.toString()));
    }
  });
  
  return eventCardIds.has(cardIdStr);
};

const createEmbed = (user, currency, avatarURL) => {
  const currentIndex = CONDITION_ORDER.indexOf(user.condition);
  const nextCondition = CONDITION_ORDER[currentIndex + 1];
  const cost = getConditionCost(currentIndex);
  
  const maxWellness = RARITY_CONFIG[user.rarity]?.maxWellness || 200;
  const wellnessFailRate = (0.2 + ((user.cardWellness / maxWellness) * 0.5)) * 100;
  const wellnessCost = RARITY_CONFIG[user.rarity]?.stardustCost || 1;

  // Get condition emojis
  const currentConditionEmoji = CONDITION_EMOJIS[user.condition.toLowerCase()] || user.condition;
  const nextConditionEmoji = nextCondition ? CONDITION_EMOJIS[nextCondition.toLowerCase()] || nextCondition : '';

  return {
    author : { 
      name     : `Enhance [${user.rarity}] ${user.group} ${user.name}`, 
      icon_url : avatarURL 
    },
    thumbnail : { url : user.imageURL },
    color     : 0xcaf0f8,
    description : `
${EMOJI.condition} **Condition:** ${currentConditionEmoji}${user.condition === 'Pristine' 
  ? ` ${EMOJI.pristine}` 
  : ` → ${nextConditionEmoji}`}
${user.condition === 'Pristine' 
  ? '' 
  : `Required: 2 identical cards\nCost: ${EMOJI.crystals} ${formatNumber(cost.crystals)} • ${EMOJI.essence} ${cost.astralEssence}\n`}
${EMOJI.wellness} **Wellness:** ${user.cardWellness}/${maxWellness}
Fail Rate: ${wellnessFailRate.toFixed(1)}% • Cost: ${EMOJI.stardust} ${formatNumber(wellnessCost)}

**Your Balance**
${EMOJI.crystals} ${formatNumber(currency.crystals)} • ${EMOJI.essence} ${formatNumber(currency.astralEssence)} • ${EMOJI.stardust} ${formatNumber(currency.stardust)}`
  };
};

/* --------------- MAIN COMMAND --------------- */
async function enhance(msg, args, client) {
  try {
    if (!args?.length) {
      return msg.channel.createMessage({
        content          : "Please provide a card code to enhance.",
        messageReference : { messageID : msg.id }
      });
    }

    const [user, graphic] = await Promise.all([
      User.findOne({ cardCode : args[0] }).lean(),
      Graphic.findOne({ userId : msg.author.id }).lean()
    ]);

    if (!user?.discordId) {
      return msg.channel.createMessage({
        content          : `Card with code \`${args[0]}\` not found.`,
        messageReference : { messageID : msg.id }
      });
    }

    if (user.discordId !== msg.author.id) {
      return msg.channel.createMessage({
        content          : `You don't own card: \`${args[0]}\``,
        messageReference : { messageID : msg.id }
      });
    }

    const currency = await Currency.findOne({ userId : user.discordId }).lean();
    
    if (!currency) {
      return msg.channel.createMessage({
        content          : "Currency data not found. Please contact support.",
        messageReference : { messageID : msg.id }
      });
    }

    return handleEnhanceInterface(msg, user, currency, client);
    
  } catch (error) {
    console.error("Enhance command error:", error);
    
    return msg.channel.createMessage({
      content          : `${EMOJI.fail} An error occurred. Please try again later.`,
      messageReference : { messageID : msg.id }
    });
  }
}

/* --------------- INTERFACE HANDLER --------------- */
async function handleEnhanceInterface(msg, user, currency, client) {
  // Clean up any existing collector for this user
  const existingCollector = activeCollectors.get(msg.author.id);
  if (existingCollector) {
    client.removeListener("interactionCreate", existingCollector.handler);
    clearTimeout(existingCollector.timeout);
  }

  const maxWellness = RARITY_CONFIG[user.rarity]?.maxWellness || 200;
  
  const enhanceMessage = await msg.channel.createMessage({
    embeds           : [createEmbed(user, currency, msg.author.avatarURL)],
    messageReference : { messageID : msg.id },
    components : [{
      type : 1,
      components : [
        {
          type      : 2,
          style     : 2,
          custom_id : "enhance_condition",
          label     : "Enhance Condition",
          disabled  : user.condition === 'Pristine'
        },
        {
          type      : 2,
          style     : 2,
          custom_id : "enhance_wellness",
          label     : "Enhance Wellness",
          disabled  : user.cardWellness >= maxWellness
        }
      ]
    }]
  });

  let isCollectorActive = true;

  const collector = async (interaction) => {
    if (!isCollectorActive) return;
    if (interaction.message.id !== enhanceMessage.id) return;
    if (interaction.member.id !== msg.author.id) return;

    const userId = interaction.member.id;

    // Check if user already has an active enhancement
    if (activeEnhancements.has(userId)) {
      await interaction.createMessage({
        content : `${EMOJI.warning} Enhancement in progress. Please wait!`,
        flags   : 64
      }).catch(() => {});
      return;
    }

    try {
      // Acknowledge immediately
      await interaction.acknowledge();
      setButtonCooldown(userId);

      // Handle enhancement based on button clicked
      if (interaction.data.custom_id === "enhance_wellness") {
        // Mark user as having active enhancement
        activeEnhancements.add(userId);
        await handleWellnessEnhancement(interaction, user, currency);
        activeEnhancements.delete(userId);
      } else if (interaction.data.custom_id === "enhance_condition") {
        // For condition, show card selection first
        await handleCardSelection(interaction, user, currency, client, msg);
        return; // Don't refresh yet, wait for selection
      }

      // Fetch fresh data after enhancement
      const [updatedUser, updatedCurrency] = await Promise.all([
        User.findOne({ cardCode : user.cardCode }).lean(),
        Currency.findOne({ userId : user.discordId }).lean()
      ]);

      if (updatedUser && updatedCurrency) {
        const updatedMaxWellness = RARITY_CONFIG[updatedUser.rarity]?.maxWellness || 200;
        
        await enhanceMessage.edit({
          embeds : [createEmbed(updatedUser, updatedCurrency, msg.author.avatarURL)],
          components : [{
            type : 1,
            components : [
              {
                type      : 2,
                style     : 2,
                custom_id : "enhance_condition",
                label     : "Enhance Condition",
                disabled  : updatedUser.condition === 'Pristine'
              },
              {
                type      : 2,
                style     : 2,
                custom_id : "enhance_wellness",
                label     : "Enhance Wellness",
                disabled  : updatedUser.cardWellness >= updatedMaxWellness
              }
            ]
          }]
        }).catch(console.error);
        
        // Update local references for next interaction
        user.condition = updatedUser.condition;
        user.cardWellness = updatedUser.cardWellness;
        currency.crystals = updatedCurrency.crystals;
        currency.stardust = updatedCurrency.stardust;
        currency.astralEssence = updatedCurrency.astralEssence;
      }
      
    } catch (error) {
      console.error("Collector error:", error);
      activeEnhancements.delete(userId);
    }
  };

  client.on("interactionCreate", collector);

  const timeoutId = setTimeout(() => {
    cleanup();
  }, INTERFACE_TIMEOUT);

  const cleanup = () => {
    if (!isCollectorActive) return;
    
    isCollectorActive = false;
    client.removeListener("interactionCreate", collector);
    activeCollectors.delete(msg.author.id);
    activeEnhancements.delete(msg.author.id);
    
    enhanceMessage.edit({
      components : [{
        type : 1,
        components : enhanceMessage.components[0].components.map(b => ({ 
          ...b, 
          disabled : true 
        }))
      }]
    }).catch(() => {});
  };

  activeCollectors.set(msg.author.id, {
    handler : collector,
    timeout : timeoutId,
    cleanup,
    createdAt: Date.now()
  });
}

/* --------------- CARD SELECTION --------------- */
async function handleCardSelection(interaction, user, currency, client, msg) {
  try {
    // Check if already at max condition
    if (user.condition === 'Pristine') {
      return interaction.createFollowup({
        content : `${EMOJI.warning} Card is already at maximum condition!`,
        flags   : 64
      });
    }

    // Determine if event card
    const isEvent = isEventCard(user.cardId);
    
    // Find eligible cards
    const searchCriteria = {
      discordId : user.discordId,
      cardCode  : { $ne : user.cardCode }
    };
    
    if (isEvent) {
      searchCriteria.name = user.name;
    } else {
      searchCriteria.cardId = user.cardId;
    }

    const eligibleCards = await User.find(searchCriteria).lean();

    if (eligibleCards.length < 2) {
      return interaction.createFollowup({
        content : `${EMOJI.fail} You need 2 identical cards for enhancement. You have ${eligibleCards.length}.`,
        flags   : 64
      });
    }

    // Fetch fresh currency data
    const currentCurrency = await Currency.findOne({ userId : user.discordId });
    const currentIndex = CONDITION_ORDER.indexOf(user.condition);
    const cost = getConditionCost(currentIndex);

    if (!currentCurrency || currentCurrency.crystals < cost.crystals || currentCurrency.astralEssence < cost.astralEssence) {
      return interaction.createFollowup({
        content : `${EMOJI.fail} Insufficient funds. Need ${EMOJI.crystals} ${formatNumber(cost.crystals)} and ${EMOJI.essence} ${cost.astralEssence}.`,
        flags   : 64
      });
    }

    // Initialize selection state
    const selectionId = `${interaction.member.id}_${Date.now()}`;
    cardSelections.set(selectionId, {
      userId: interaction.member.id,
      user,
      currency,
      eligibleCards,
      selectedCards: [],
      step: 1
    });

    // Create dropdown with all eligible cards
    const selectionMsg = await interaction.createFollowup({
      embeds: [{
        title: "Select Cards to Consume",
        description: `${EMOJI.condition} Select 2 identical cards to consume for enhancement.\n\n**Step 1:** Select first card`,
        color: 0xcaf0f8
      }],
      components: [{
        type: 1,
        components: [{
          type: 3,
          custom_id: `card_select_${selectionId}`,
          placeholder: "Choose first card to consume...",
          options: eligibleCards.slice(0, 25).map(card => ({
            label: `#${card.printNumber || '???'} • ${card.condition}`.substring(0, 100),
            description: `${card.group} ${card.name}`.substring(0, 100),
            value: card.cardCode
          }))
        }]
      }],
      flags: 64
    });

    // Define selectionCollector first so it can be referenced in timeout
    let selectionCollector;
    
    // Set up selection collector timeout
    const selectionTimeout = setTimeout(() => {
      cardSelections.delete(selectionId);
      if (selectionCollector) {
        client.removeListener("interactionCreate", selectionCollector);
      }
      selectionMsg.edit({
        embeds: [{
          description: `${EMOJI.warning} Selection timed out.`,
          color: 0xff4d6d
        }],
        components: []
      }).catch(() => {});
    }, SELECTION_TIMEOUT);

    selectionCollector = async (selectInteraction) => {
      if (selectInteraction.message.id !== selectionMsg.id) return;
      if (selectInteraction.member.id !== interaction.member.id) return;
      if (!selectInteraction.data.custom_id.startsWith('card_select_')) return;

      const selection = cardSelections.get(selectionId);
      if (!selection) return;

      try {
        await selectInteraction.acknowledge();

        const selectedCardCode = selectInteraction.data.values[0];
        const selectedCard = selection.eligibleCards.find(c => c.cardCode === selectedCardCode);

        if (!selectedCard) return;

        selection.selectedCards.push(selectedCard);

        if (selection.step === 1) {
          // First card selected, show second dropdown
          selection.step = 2;
          
          const remainingCards = selection.eligibleCards.filter(c => 
            c.cardCode !== selectedCardCode
          );

          await selectInteraction.editParent({
            embeds: [{
              title: "Select Cards to Consume",
              description: `${EMOJI.condition} Select 2 identical cards to consume for enhancement.\n\n**Step 1:** ✅ #${selectedCard.printNumber || '???'} • ${selectedCard.condition}\n**Step 2:** Select second card`,
              color: 0xcaf0f8
            }],
            components: [{
              type: 1,
              components: [{
                type: 3,
                custom_id: `card_select_${selectionId}`,
                placeholder: "Choose second card to consume...",
                options: remainingCards.slice(0, 25).map(card => ({
                  label: `#${card.printNumber || '???'} • ${card.condition}`.substring(0, 100),
                  description: `${card.group} ${card.name}`.substring(0, 100),
                  value: card.cardCode
                }))
              }]
            }]
          });

        } else if (selection.step === 2) {
          // Second card selected, show continue button
          clearTimeout(selectionTimeout);
          
          await selectInteraction.editParent({
            embeds: [{
              title: "Cards Selected",
              description: `${EMOJI.condition} Cards to consume:\n\n1️⃣ #${selection.selectedCards[0].printNumber || '???'} • ${selection.selectedCards[0].condition}\n2️⃣ #${selectedCard.printNumber || '???'} • ${selectedCard.condition}\n\nClick Continue to proceed with enhancement.`,
              color: 0xcaf0f8
            }],
            components: [{
              type: 1,
              components: [
                {
                  type: 2,
                  style: 3,
                  custom_id: `continue_enhance_${selectionId}`,
                  label: "Continue"
                },
                {
                  type: 2,
                  style: 4,
                  custom_id: `cancel_selection_${selectionId}`,
                  label: "Cancel"
                }
              ]
            }]
          });

          // Set up continue/cancel collector with timeout
          let continueTimeout;
          const continueCollector = async (btnInteraction) => {
            if (btnInteraction.message.id !== selectionMsg.id) return;
            if (btnInteraction.member.id !== interaction.member.id) return;

            try {
              await btnInteraction.acknowledge();
              clearTimeout(continueTimeout);

              if (btnInteraction.data.custom_id === `cancel_selection_${selectionId}`) {
                cardSelections.delete(selectionId);
                client.removeListener("interactionCreate", continueCollector);
                
                return btnInteraction.editParent({
                  embeds: [{
                    description: `${EMOJI.fail} Selection cancelled.`,
                    color: 0xff4d6d
                  }],
                  components: []
                });
              }

              if (btnInteraction.data.custom_id === `continue_enhance_${selectionId}`) {
                client.removeListener("interactionCreate", continueCollector);
                
                await btnInteraction.editParent({
                  embeds: [{
                    description: `⏳ Preparing confirmation...`,
                    color: 0xcaf0f8
                  }],
                  components: []
                });

                await handleConditionConfirmation(btnInteraction, selection, client, msg);
                cardSelections.delete(selectionId);
              }

            } catch (error) {
              console.error("Continue button error:", error);
              client.removeListener("interactionCreate", continueCollector);
            }
          };

          continueTimeout = setTimeout(() => {
            cardSelections.delete(selectionId);
            client.removeListener("interactionCreate", continueCollector);
            selectInteraction.editParent({
              embeds: [{
                description: `${EMOJI.warning} Selection timed out.`,
                color: 0xff4d6d
              }],
              components: []
            }).catch(() => {});
          }, CONTINUE_TIMEOUT);

          client.on("interactionCreate", continueCollector);
          client.removeListener("interactionCreate", selectionCollector);
        }

      } catch (error) {
        console.error("Selection error:", error);
      }
    };

    client.on("interactionCreate", selectionCollector);

  } catch (error) {
    console.error("Card selection error:", error);
    return interaction.createFollowup({
      content: `${EMOJI.fail} An error occurred.`,
      flags: 64
    }).catch(() => {});
  }
}

/* --------------- CONDITION CONFIRMATION --------------- */
async function handleConditionConfirmation(interaction, selection, client, msg) {
  try {
    const { user, selectedCards } = selection;
    
    const currentIndex = CONDITION_ORDER.indexOf(user.condition);
    const nextCondition = CONDITION_ORDER[currentIndex + 1];
    const cost = getConditionCost(currentIndex);

    // Generate before/after card images
    const beforeOverlayPromise = user.condition && user.condition.toLowerCase() !== 'good'
      ? CardGenerationService.preloadOverlay(user.group, user.rarity, user.condition, user.cardId)
      : Promise.resolve(null);

    const afterOverlayPromise = nextCondition && nextCondition.toLowerCase() !== 'good'
      ? CardGenerationService.preloadOverlay(user.group, user.rarity, nextCondition, user.cardId)
      : Promise.resolve(null);

    const beforeImage = await CardGenerationService.processCardImage(
      { imageURL: user.imageURL, group: user.group, rarity: user.rarity },
      user.condition,
      beforeOverlayPromise
    );

    const afterImage = await CardGenerationService.processCardImage(
      { imageURL: user.imageURL, group: user.group, rarity: user.rarity },
      nextCondition,
      afterOverlayPromise
    );

    // Create side-by-side comparison with arrow
    const sharp = require('sharp');
    const arrow = Buffer.from(
      `<svg width="80" height="480">
        <text x="40" y="240" font-size="60" text-anchor="middle" fill="white">→</text>
      </svg>`
    );

    const comparisonImage = await sharp({
      create: {
        width: 680,
        height: 480,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
    .composite([
      { input: beforeImage, left: 0, top: 0 },
      { input: arrow, left: 300, top: 0 },
      { input: afterImage, left: 380, top: 0 }
    ])
    .webp({ quality: 100, effort: 2 })
    .toBuffer();

    // Get condition emojis for embed
    const currentConditionEmoji = CONDITION_EMOJIS[user.condition.toLowerCase()] || user.condition;
    const nextConditionEmoji = CONDITION_EMOJIS[nextCondition.toLowerCase()] || nextCondition;

    // Fetch fresh currency
    const currentCurrency = await Currency.findOne({ userId: user.discordId });

    // Send confirmation message
    const confirmMsg = await interaction.createFollowup({
      embeds: [{
        title: "Confirm Condition Enhancement",
        description: `${currentConditionEmoji} → ${nextConditionEmoji}\n\n**Cards to consume:**\n1️⃣ #${selectedCards[0].printNumber || '???'} • ${selectedCards[0].condition}\n2️⃣ #${selectedCards[1].printNumber || '???'} • ${selectedCards[1].condition}\n\n**Cost:**\n• ${EMOJI.crystals} ${formatNumber(cost.crystals)}\n• ${EMOJI.essence} ${cost.astralEssence}\n\n**Your Balance:**\n${EMOJI.crystals} ${formatNumber(currentCurrency.crystals)} • ${EMOJI.essence} ${formatNumber(currentCurrency.astralEssence)}`,
        color: 0xcaf0f8,
        image: { url: "attachment://confirmation.png" }
      }],
      components: [{
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            custom_id: "confirm_enhance",
            label: "Confirm"
          },
          {
            type: 2,
            style: 4,
            custom_id: "cancel_enhance",
            label: "Cancel"
          }
        ]
      }],
      file: { file: comparisonImage, name: "confirmation.png" },
      flags: 64
    });

    // Set up confirmation collector with timeout
    let confirmTimeout;
    const confirmCollector = async (confirmInteraction) => {
      if (confirmInteraction.message.id !== confirmMsg.id) return;
      if (confirmInteraction.member.id !== interaction.member.id) return;

      try {
        await confirmInteraction.acknowledge();
        clearTimeout(confirmTimeout);

        if (confirmInteraction.data.custom_id === "cancel_enhance") {
          client.removeListener("interactionCreate", confirmCollector);
          return confirmInteraction.editParent({
            embeds: [{
              description: `${EMOJI.fail} Enhancement cancelled.`,
              color: 0xff4d6d
            }],
            components: []
          });
        }

        if (confirmInteraction.data.custom_id === "confirm_enhance") {
          activeEnhancements.add(interaction.member.id);
          
          await confirmInteraction.editParent({
            embeds: [{
              description: `⏳ Processing enhancement...`,
              color: 0xcaf0f8
            }],
            components: []
          });

          await processConditionEnhancement(confirmInteraction, {
            user,
            selectedCards,
            cost,
            nextCondition
          }, msg, client);
          
          activeEnhancements.delete(interaction.member.id);
          client.removeListener("interactionCreate", confirmCollector);
        }

      } catch (error) {
        console.error("Confirmation error:", error);
        activeEnhancements.delete(interaction.member.id);
        client.removeListener("interactionCreate", confirmCollector);
      }
    };

    confirmTimeout = setTimeout(() => {
      client.removeListener("interactionCreate", confirmCollector);
      confirmMsg.edit({
        embeds: [{
          description: `${EMOJI.warning} Confirmation timed out.`,
          color: 0xff4d6d
        }],
        components: []
      }).catch(() => {});
    }, CONFIRM_TIMEOUT);

    client.on("interactionCreate", confirmCollector);

  } catch (error) {
    console.error("Condition confirmation error:", error);
    return interaction.createFollowup({
      content: `${EMOJI.fail} An error occurred.`,
      flags: 64
    }).catch(() => {});
  }
}

/* --------------- PROCESS CONDITION ENHANCEMENT --------------- */
async function processConditionEnhancement(interaction, data, msg, client) {
  try {
    const { user, selectedCards, cost, nextCondition } = data;

    // Fetch fresh currency
    const currentCurrency = await Currency.findOne({ userId: user.discordId });

    // Final validation
    if (!currentCurrency || currentCurrency.crystals < cost.crystals || currentCurrency.astralEssence < cost.astralEssence) {
      return interaction.editParent({
        embeds: [{
          description: `${EMOJI.fail} Insufficient funds.`,
          color: 0xff4d6d
        }]
      });
    }

    // Deduct currency IMMEDIATELY
    currentCurrency.crystals -= cost.crystals;
    currentCurrency.astralEssence -= cost.astralEssence;
    await currentCurrency.save();

    try {
      const [transferResult, conditionUpdate] = await Promise.all([
        User.updateMany(
          { cardCode: { $in: selectedCards.map(card => card.cardCode) } },
          { discordId: CARD_DESTRUCTION_BOT_ID }
        ),
        User.findOneAndUpdate(
          { 
            cardCode: user.cardCode,
            condition: user.condition
          },
          { condition: nextCondition },
          { new: true }
        )
      ]);

      if (!conditionUpdate) {
        // Rollback
        await Promise.all([
          User.updateMany(
            { cardCode: { $in: selectedCards.map(card => card.cardCode) } },
            { discordId: user.discordId }
          ),
          Currency.findOneAndUpdate(
            { userId: user.discordId },
            { 
              $inc: { 
                crystals: cost.crystals, 
                astralEssence: cost.astralEssence 
              } 
            }
          )
        ]);

        return interaction.editParent({
          embeds: [{
            description: `${EMOJI.fail} Enhancement failed. Resources refunded.`,
            color: 0xff4d6d
          }]
        });
      }

      // Success
      await interaction.editParent({
        embeds: [{
          description: `${EMOJI.success} Condition enhanced to **${nextCondition}**!`,
          color: 0xcaf0f8
        }]
      });

      // Refresh main interface
      const [updatedUser, updatedCurrency] = await Promise.all([
        User.findOne({ cardCode: user.cardCode }).lean(),
        Currency.findOne({ userId: user.discordId }).lean()
      ]);

      if (updatedUser && updatedCurrency) {
        const collector = activeCollectors.get(msg.author.id);
        if (collector) {
          const maxWellness = RARITY_CONFIG[updatedUser.rarity]?.maxWellness || 200;
          
          const messages = await msg.channel.getMessages({ limit: 10 });
          const enhanceMsg = messages.find(m => 
            m.author.id === client.user.id && 
            m.embeds[0]?.author?.name?.startsWith('Enhance')
          );

          if (enhanceMsg) {
            await enhanceMsg.edit({
              embeds: [createEmbed(updatedUser, updatedCurrency, msg.author.avatarURL)],
              components: [{
                type: 1,
                components: [
                  {
                    type: 2,
                    style: 2,
                    custom_id: "enhance_condition",
                    label: "Enhance Condition",
                    disabled: updatedUser.condition === 'Pristine'
                  },
                  {
                    type: 2,
                    style: 2,
                    custom_id: "enhance_wellness",
                    label: "Enhance Wellness",
                    disabled: updatedUser.cardWellness >= maxWellness
                  }
                ]
              }]
            }).catch(console.error);
          }
        }
      }

    } catch (enhanceError) {
      // Rollback on error
      await Promise.all([
        User.updateMany(
          { cardCode: { $in: selectedCards.map(card => card.cardCode) } },
          { discordId: user.discordId }
        ),
        Currency.findOneAndUpdate(
          { userId: user.discordId },
          { 
            $inc: { 
              crystals: cost.crystals, 
              astralEssence: cost.astralEssence 
            } 
          }
        )
      ]);

      throw enhanceError;
    }

  } catch (error) {
    console.error("Process enhancement error:", error);
    return interaction.editParent({
      embeds: [{
        description: `${EMOJI.fail} An error occurred. Resources refunded.`,
        color: 0xff4d6d
      }]
    }).catch(() => {});
  }
}

/* --------------- WELLNESS ENHANCEMENT --------------- */
async function handleWellnessEnhancement(interaction, user, currency) {
  try {
    const wellnessCost = RARITY_CONFIG[user.rarity]?.stardustCost || 1;
    const maxWellness = RARITY_CONFIG[user.rarity]?.maxWellness || 200;

    // Fetch fresh currency data
    const currentCurrency = await Currency.findOne({ userId : user.discordId });

    // Check if already at max
    if (user.cardWellness >= maxWellness) {
      return interaction.createFollowup({
        content : `${EMOJI.warning} Card is already at maximum wellness!`,
        flags   : 64
      });
    }

    // Check balance
    if (!currentCurrency || currentCurrency.stardust < wellnessCost) {
      return interaction.createFollowup({
        content : `${EMOJI.fail} Insufficient Stardust. Need ${EMOJI.stardust} ${wellnessCost}, have ${currentCurrency?.stardust || 0}.`,
        flags   : 64
      });
    }

    // Deduct stardust IMMEDIATELY
    currentCurrency.stardust -= wellnessCost;
    await currentCurrency.save();

    // Calculate success rate
    const failRate = 0.2 + ((user.cardWellness / maxWellness) * 0.5);
    const success = Math.random() > failRate;

    if (!success) {
      // Fetch latest wellness value
      const latestUser = await User.findOne({ cardCode : user.cardCode }).lean();
      const latestWellness = latestUser?.cardWellness || user.cardWellness;

      return interaction.createFollowup({
        embeds : [{
          author : { 
            name     : "Enhancement Failed", 
            icon_url : interaction.member.avatarURL 
          },
          thumbnail   : { url : user.imageURL },
          description : `${EMOJI.fail} Wellness remains at **${latestWellness}**`,
          color       : 0xff4d6d
        }],
        flags : 64
      });
    }

    // Calculate wellness increase
    const increase = Math.floor(Math.random() * 99) + 2;
    const newWellness = Math.min(user.cardWellness + increase, maxWellness);

    // Atomic update with optimistic concurrency control
    const updatedUser = await User.findOneAndUpdate(
      {
        cardCode     : user.cardCode,
        cardWellness : user.cardWellness
      },
      { cardWellness : newWellness },
      { new : true }
    );

    if (!updatedUser) {
      // Refund stardust on concurrent update failure
      await Currency.findOneAndUpdate(
        { userId : user.discordId },
        { $inc : { stardust : wellnessCost } }
      );

      return interaction.createFollowup({
        content : `${EMOJI.warning} Enhancement failed due to concurrent update. Stardust refunded. Please try again.`,
        flags   : 64
      });
    }

    // Track update to help prevent future race conditions
    wellnessUpdates.set(user.cardCode, Date.now());

    return interaction.createFollowup({
      embeds : [{
        author : { 
          name     : "Wellness Enhanced", 
          icon_url : interaction.member.avatarURL 
        },
        thumbnail   : { url : user.imageURL },
        description : `${EMOJI.success} **+${increase}** wellness\n${EMOJI.wellness} New Wellness: **${newWellness}**`,
        color       : 0xcaf0f8
      }],
      flags : 64
    });

  } catch (error) {
    console.error("Wellness Enhancement Error:", error);
    
    // Try to refund on error
    try {
      const wellnessCost = RARITY_CONFIG[user.rarity]?.stardustCost || 1;
      await Currency.findOneAndUpdate(
        { userId : user.discordId },
        { $inc : { stardust : wellnessCost } }
      );
    } catch (refundError) {
      console.error("Failed to refund stardust:", refundError);
    }
    
    return interaction.createFollowup({
      content : `${EMOJI.fail} An error occurred. Stardust has been refunded.`,
      flags   : 64
    }).catch(() => {});
  }
}

/* --------------- EXPORTS --------------- */
module.exports = {
  name        : "enhance",
  description : "Enhance a card's condition or wellness",
  execute     : enhance
};

/* --------------- CLEANUP --------------- */
process.on("SIGINT", () => {
  activeCollectors.forEach(({ cleanup }) => cleanup());
  activeCollectors.clear();
  buttonCooldowns.clear();
  wellnessUpdates.clear();
  activeEnhancements.clear();
  cardSelections.clear();
});