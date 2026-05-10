//  exchange.js — exchange deprecated currency for cards and cosmic
// -----------------------------------------------------------------------------
const Currency = require("../models/currency");
const Graphic = require("../models/graphic");
const CardGenerationService = require("../services/CardGenerationService");
const { RARITY_EMOJIS, CONDITION_EMOJIS } = require("../config/embedConstants");

/* --------------- EMOJI CONFIG --------------- */
const EMOJI = {
  // Deprecated Currency
  fantasiaToken : "", // Replace with your emoji ID
  reverieGem    : "",    // Replace with your emoji ID
  
  // Currency
  cosmic        : "<:cosmic:1461015742219550924>",  // Selca/cosmic currency
  
  // Status
  success       : "<:check:1461015775266603110>",
  fail          : "<:cross:1461015696954753034>",
  warning       : "⚠️",
  card          : "<:cards:1461015816869777450>"
};

/* --------------- CONFIGURATION --------------- */
const EXCHANGE_RATES = {
  CARD: {
    currency: "fantasiaTokens",
    cost: 20,
    emoji: EMOJI.fantasiaToken,
    name: "Fantasia Tokens",
    gives: "card"
  },
  COSMIC: {
    currency: "reverieGem",
    cost: 20,
    emoji: EMOJI.reverieGem,
    name: "Reverie Gems",
    gives: "selca",  // This is the cosmic currency
    selcaAmount: 1   // How much cosmic to give per exchange
  }
};

const BUTTON_COOLDOWN = 1750;  // Same as enhance
const INTERFACE_TIMEOUT = 60000;
const CLEANUP_INTERVAL = 300000;

/* --------------- STATE MANAGEMENT --------------- */
const buttonCooldowns = new Map();
const activeCollectors = new Map();
const activePulls = new Set();

// Periodic cleanup to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  
  for (const [key, timestamp] of buttonCooldowns.entries()) {
    if (now - timestamp >= BUTTON_COOLDOWN) {
      buttonCooldowns.delete(key);
    }
  }
  
  // Cleanup stale activeCollectors
  for (const [userId, collector] of activeCollectors.entries()) {
    if (collector.createdAt && now - collector.createdAt > INTERFACE_TIMEOUT + 30000) {
      console.warn(`[EXCHANGE] Cleaning stale collector for user ${userId}`);
      if (collector.cleanup) collector.cleanup();
      activeCollectors.delete(userId);
      activePulls.delete(userId);
    }
  }
  
  // Safety net for activePulls
  if (activePulls.size > 100) {
    console.warn('[EXCHANGE] activePulls has grown large, clearing stale entries');
    activePulls.clear();
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

// Determine card type for normal pull (same as drop.js)
const determineCardRarity = () => {
  const rarities = [
    { name: "Standard", chance: 60 },
    { name: "Unique", chance: 30 },
    { name: "Glyph", chance: 8 },
    { name: "Mythic", chance: 2 }
  ];

  const random = Math.random() * 100;
  let cumulative = 0;

  for (const rarity of rarities) {
    cumulative += rarity.chance;
    if (random < cumulative) {
      return rarity.name;
    }
  }

  return "Standard";
};

const createMainEmbed = (currency, avatarURL) => {
  return {
    author: {
      name: "Currency Exchange Shop",
      icon_url: avatarURL
    },
    description: `Exchange your deprecated currency for rewards!\n
**Available Exchanges:**
${EMOJI.card} **Random Card** - ${EMOJI.fantasiaToken} 20 Fantasia Tokens each
${EMOJI.cosmic} **1 Cosmic** - ${EMOJI.reverieGem} 20 Reverie Gems each

**Your Balance:**
${EMOJI.fantasiaToken} ${formatNumber(currency.fantasiaTokens)} Fantasia Tokens
${EMOJI.reverieGem} ${formatNumber(currency.reverieGem)} Reverie Gems
${EMOJI.cosmic} ${formatNumber(currency.selca)} Cosmic`,
    color: 0xcaf0f8,
    footer: {
      text: "Use the dropdowns below to select your exchange!"
    }
  };
};

/* --------------- MAIN COMMAND --------------- */
async function exchange(msg, args, client) {
  try {
    // Validate user registration
    const graphic = await Graphic.findOne({ userId: msg.author.id }).lean();
    if (!graphic?.isRegistered) {
      return msg.channel.createMessage({
        embeds: [{
          title: "🚫 Registration Required",
          description: "You need to register first! Use `?register` to start your journey.",
          color: 0xFF6B6B
        }],
        messageReference: { messageID: msg.id }
      });
    }

    // Get user's currency
    const currency = await Currency.findOne({ userId: msg.author.id }).lean();
    
    if (!currency) {
      return msg.channel.createMessage({
        content: "Currency data not found. Please contact support.",
        messageReference: { messageID: msg.id }
      });
    }

    return handleExchangeInterface(msg, currency, client);
    
  } catch (error) {
    console.error("Exchange command error:", error);
    
    return msg.channel.createMessage({
      content: `${EMOJI.fail} An error occurred. Please try again later.`,
      messageReference: { messageID: msg.id }
    });
  }
}

/* --------------- INTERFACE HANDLER --------------- */
async function handleExchangeInterface(msg, currency, client) {
  // Clean up any existing collector for this user
  const existingCollector = activeCollectors.get(msg.author.id);
  if (existingCollector) {
    client.removeListener("interactionCreate", existingCollector.handler);
    clearTimeout(existingCollector.timeout);
  }

  // Check if user has enough for any exchange
  const canPullCard = currency.fantasiaTokens >= EXCHANGE_RATES.CARD.cost;
  const canPullCosmic = currency.reverieGem >= EXCHANGE_RATES.COSMIC.cost;

  // Calculate max pulls for each type
  const maxCardPulls = Math.min(5, Math.floor(currency.fantasiaTokens / EXCHANGE_RATES.CARD.cost));
  const maxCosmicPulls = Math.floor(currency.reverieGem / EXCHANGE_RATES.COSMIC.cost);

  const exchangeMessage = await msg.channel.createMessage({
    embeds: [createMainEmbed(currency, msg.author.avatarURL)],
    messageReference: { messageID: msg.id },
    components: [{
      type: 1,
      components: [
        {
          type: 3, // Select menu
          custom_id: "select_card_amount",
          placeholder: "Select card amount (1-5)",
          disabled: !canPullCard,
          options: maxCardPulls > 0 ? Array.from({ length: maxCardPulls }, (_, i) => {
            const amount = i + 1;
            const cost = EXCHANGE_RATES.CARD.cost * amount;
            return {
              label: `${amount} Card${amount > 1 ? 's' : ''}`,
              value: `card_${amount}`,
              description: `Cost: ${cost} Fantasia Tokens`,
              emoji: { name: "🎴" }
            };
          }) : [{
            label: "Not enough tokens",
            value: "none",
            description: "Need 20 Fantasia Tokens minimum"
          }]
        }
      ]
    }, {
      type: 1,
      components: [
        {
          type: 3, // Select menu
          custom_id: "select_cosmic_amount",
          placeholder: "Select cosmic amount",
          disabled: !canPullCosmic,
          options: (() => {
            const options = [];
            const amounts = [1, 5, 10, 25, 50, 100];
            
            for (const amount of amounts) {
              if (amount <= maxCosmicPulls) {
                const cost = EXCHANGE_RATES.COSMIC.cost * amount;
                options.push({
                  label: `${amount} Cosmic`,
                  value: `cosmic_${amount}`,
                  description: `Cost: ${cost} Reverie Gems`,
                  emoji: { id: "1461015742219550924", name: "cosmic" }
                });
              }
            }
            
            return options.length > 0 ? options : [{
              label: "Not enough gems",
              value: "none",
              description: "Need 20 Reverie Gems minimum"
            }];
          })()
        }
      ]
    }]
  });

  let isCollectorActive = true;

  const collector = async (interaction) => {
    if (!isCollectorActive) return;
    if (interaction.message.id !== exchangeMessage.id) return;
    if (interaction.member.id !== msg.author.id) return;
    if (!interaction.data.values || !interaction.data.values[0]) return;

    const userId = interaction.member.id;
    const selectedValue = interaction.data.values[0];

    // Ignore placeholder selections
    if (selectedValue === "none") {
      return interaction.createMessage({
        content: `${EMOJI.warning} You don't have enough currency for this exchange!`,
        flags: 64
      }).catch(() => {});
    }

    // Button cooldown check (anti-spam)
    if (isOnCooldown(userId)) {
      return interaction.createMessage({
        content: `${EMOJI.warning} Please wait before making another exchange!`,
        flags: 64
      }).catch(() => {});
    }

    setButtonCooldown(userId);

    try {
      // Parse the selection
      const [type, amountStr] = selectedValue.split('_');
      const amount = parseInt(amountStr);
      const exchangeType = type === "card" ? "CARD" : "COSMIC";
      
      await interaction.acknowledge();
      
      // Process the pull
      await handleExchangePull(interaction, msg, exchangeType, amount, client);

      // Refresh the interface with updated currency
      const updatedCurrency = await Currency.findOne({ userId: msg.author.id }).lean();
      
      if (updatedCurrency) {
        const canPullCardNew = updatedCurrency.fantasiaTokens >= EXCHANGE_RATES.CARD.cost;
        const canPullCosmicNew = updatedCurrency.reverieGem >= EXCHANGE_RATES.COSMIC.cost;
        const maxCardPullsNew = Math.min(5, Math.floor(updatedCurrency.fantasiaTokens / EXCHANGE_RATES.CARD.cost));
        const maxCosmicPullsNew = Math.floor(updatedCurrency.reverieGem / EXCHANGE_RATES.COSMIC.cost);

        await exchangeMessage.edit({
          embeds: [createMainEmbed(updatedCurrency, msg.author.avatarURL)],
          components: [{
            type: 1,
            components: [
              {
                type: 3,
                custom_id: "select_card_amount",
                placeholder: "Select card amount (1-5)",
                disabled: !canPullCardNew,
                options: maxCardPullsNew > 0 ? Array.from({ length: maxCardPullsNew }, (_, i) => {
                  const amt = i + 1;
                  const cost = EXCHANGE_RATES.CARD.cost * amt;
                  return {
                    label: `${amt} Card${amt > 1 ? 's' : ''}`,
                    value: `card_${amt}`,
                    description: `Cost: ${cost} Fantasia Tokens`,
                    emoji: { name: "🎴" }
                  };
                }) : [{
                  label: "Not enough tokens",
                  value: "none",
                  description: "Need 20 Fantasia Tokens minimum"
                }]
              }
            ]
          }, {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: "select_cosmic_amount",
                placeholder: "Select cosmic amount",
                disabled: !canPullCosmicNew,
                options: (() => {
                  const opts = [];
                  const amts = [1, 5, 10, 25, 50, 100];
                  
                  for (const amt of amts) {
                    if (amt <= maxCosmicPullsNew) {
                      const cost = EXCHANGE_RATES.COSMIC.cost * amt;
                      opts.push({
                        label: `${amt} Cosmic`,
                        value: `cosmic_${amt}`,
                        description: `Cost: ${cost} Reverie Gems`,
                        emoji: { id: "1461015742219550924", name: "cosmic" }
                      });
                    }
                  }
                  
                  return opts.length > 0 ? opts : [{
                    label: "Not enough gems",
                    value: "none",
                    description: "Need 20 Reverie Gems minimum"
                  }];
                })()
              }
            ]
          }]
        }).catch(console.error);
      }

    } catch (error) {
      console.error("Exchange interaction error:", error);
      
      return interaction.createFollowup({
        content: `${EMOJI.fail} An error occurred during the exchange.`,
        flags: 64
      }).catch(() => {});
    }
  };

  const timeoutId = setTimeout(async () => {
    if (isCollectorActive) {
      cleanup();
      
      await exchangeMessage.edit({
        components: [{
          type: 1,
          components: [{
            type: 3,
            custom_id: "select_card_amount_disabled",
            placeholder: "Exchange expired - run command again",
            disabled: true,
            options: [{ label: "Expired", value: "expired" }]
          }]
        }, {
          type: 1,
          components: [{
            type: 3,
            custom_id: "select_cosmic_amount_disabled",
            placeholder: "Exchange expired - run command again",
            disabled: true,
            options: [{ label: "Expired", value: "expired" }]
          }]
        }]
      }).catch(() => {});
    }
  }, INTERFACE_TIMEOUT);

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
}

/* --------------- PULL HANDLER --------------- */
async function handleExchangePull(interaction, msg, exchangeType, amount, client) {
  const userId = msg.author.id;
  const config = EXCHANGE_RATES[exchangeType];
  const totalCost = config.cost * amount;

  try {
    // Fetch fresh currency data
    const currentCurrency = await Currency.findOne({ userId });

    if (!currentCurrency) {
      return interaction.createFollowup({
        content: `${EMOJI.fail} Currency data not found.`,
        flags: 64
      });
    }

    // Check balance
    if (currentCurrency[config.currency] < totalCost) {
      return interaction.createFollowup({
        content: `${EMOJI.fail} Insufficient ${config.name}! You need ${config.emoji} ${totalCost} but have ${formatNumber(currentCurrency[config.currency])}.`,
        flags: 64
      });
    }

    // Deduct currency IMMEDIATELY
    currentCurrency[config.currency] -= totalCost;
    await currentCurrency.save();

    // Handle based on exchange type
    if (exchangeType === "COSMIC") {
      // Give cosmic currency (selca)
      const cosmicAmount = config.selcaAmount * amount;
      
      await Currency.findOneAndUpdate(
        { userId },
        { $inc: { selca: cosmicAmount } }
      );

      // Get updated total
      const updatedCurrency = await Currency.findOne({ userId });

      const successEmbed = {
        title: `${EMOJI.cosmic} Cosmic Received!`,
        description: `You exchanged ${config.emoji} **${formatNumber(totalCost)}** ${config.name} and received **${cosmicAmount}** ${EMOJI.cosmic} cosmic!`,
        color: 0xFFD700,
        footer: {
          text: `Total Cosmic: ${formatNumber(updatedCurrency.selca)}`,
          icon_url: interaction.member.avatarURL
        },
        timestamp: new Date()
      };

      return interaction.createFollowup({
        embeds: [successEmbed]
      });

    } else {
      // Generate multiple cards
      const cards = [];
      const files = [];
      
      for (let i = 0; i < amount; i++) {
        const rarity = determineCardRarity();
        const card = await CardGenerationService.generateCard(userId, {
          rarity: rarity,
          isCosmic: false
        });

        // Generate card code
        const { generateUniqueCode } = require("../utils/cardCodeGenerator");
        card.cardData.cardCode = await generateUniqueCode();

        cards.push(card.cardData);
        files.push({ file: card.imageBuffer, name: `card${i + 1}.png` });
      }

      // Save all cards to database
      await CardGenerationService.saveCardsToDatabase(cards);

      // Create embed listing all cards
      const rarityEmoji = (rarity) => RARITY_EMOJIS[rarity.toLowerCase()] || "⭐";
      const conditionEmoji = (condition) => CONDITION_EMOJIS[condition.toLowerCase()] || condition;

      const cardListings = cards.map((card, i) => {
        return `${rarityEmoji(card.rarity)} [#${card.printNumber || '???'}] ${conditionEmoji(card.condition)} ${card.group} ${card.name} - \`${card.cardCode}\``;
      }).join('\n');

      const cardEmbed = {
        title: `${EMOJI.card} ${amount} Card${amount > 1 ? 's' : ''} Received!`,
        description: `${cardListings}\n\n-# Exchanged ${config.emoji} ${formatNumber(totalCost)} ${config.name}`,
        color: 0x5865F2,
        thumbnail: {
          url: `attachment://card1.png`
        },
        footer: {
          text: interaction.member.username,
          icon_url: interaction.member.avatarURL
        },
        timestamp: new Date()
      };

      // Send cards as followup (only attach first card image to avoid clutter)
      return interaction.createFollowup({
        embeds: [cardEmbed],
        file: files[0]  // Just show the first card
      });
    }

  } catch (error) {
    console.error("Exchange Pull Error:", error);
    
    // Try to refund on error
    try {
      await Currency.findOneAndUpdate(
        { userId },
        { $inc: { [config.currency]: totalCost } }
      );
    } catch (refundError) {
      console.error("Failed to refund currency:", refundError);
    }
    
    return interaction.createFollowup({
      content: `${EMOJI.fail} An error occurred. Currency has been refunded.`,
      flags: 64
    }).catch(() => {});
  }
}

/* --------------- EXPORTS --------------- */
module.exports = {
  name: "exchange",
  aliases: ["trade", "ex"],
  description: "Exchange deprecated currency for cards and cosmic",
  execute: exchange
};

/* --------------- CLEANUP --------------- */
process.on("SIGINT", () => {
  activeCollectors.forEach(({ cleanup }) => cleanup());
  activeCollectors.clear();
  buttonCooldowns.clear();
  activePulls.clear();
});