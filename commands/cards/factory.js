const Card = require("../../models/card");
const User = require("../../models/user");
const Currency = require("../../models/currency");
const Graphic = require("../../models/graphic");
const { getRandomCardCondition } = require("../../utils/status");
const { generateUniqueCode } = require('../../utils/cardCodeGenerator');
const { getCardWellness } = require('../../utils/cardWellness');
const CardGenerationService = require('../../services/CardGenerationService');
const { logCardSpawn } = require('../../utils/cardSpawnLogger');
const sharp = require("sharp");
const axios = require("axios");
const path = require('path');

// Constants
const COOLDOWNS = {
  PREMIUM_BOX: 8 * 60 * 60 * 1000,
  CACHE_TTL: 10 * 60 * 1000
};

const DROP_RATES = {
  CRYSTALS: 0.4,
  STARDUST: 0.3,
  ASTRAL_ESSENCE: 0.3,
  COSMICS: 0.3,
  IOTW_CARD: 0.05,
  WINTER_CARD: 0.1,
  PRISTINE_CARD: 0.3
};

const DIMENSIONS = { width: 600, height: 960 };

// NEW: Special card IDs (update these with your actual card IDs)
const IOTW_CARD_IDS = ['1806', '1807', '1809', '1810', '1811', '18812', '1813', '1814', '1815', '1816', '1817', '1818', '1819']; // Replace with actual Idol of the Month card IDs
const WINTER_CARD_IDS = [
  "1820", "1821", "1822", "1823", "1824",
  "1825", "1826", "1827", "1828", "1829",
  "1830", "1831", "1832", "1833", "1834",
  "1835", "1836", "1837", "1838", "1839"
]; // Replace with actual Winter card IDs

const BOX_CONFIG = {
  normal: {
    cost: 20,
    currencyKey: 'candyCanes',
    rewards: {
      crystals: { min: 100, max: 1000, rate: DROP_RATES.CRYSTALS },
      stardust: { min: 5, max: 10, rate: DROP_RATES.STARDUST }
    },
    cardRarities: ['Standard', 'Unique'],
    canBePristine: false,
    color: 0x3498DB
  },
  premium: {
    cost: 50,
    currencyKey: 'candyCanes',
    rewards: {
      crystals: { min: 500, max: 2000, rate: DROP_RATES.CRYSTALS },
      astralEssence: { min: 1, max: 20, rate: DROP_RATES.ASTRAL_ESSENCE },
      selca: { min: 5, max: 20, rate: DROP_RATES.COSMICS }
    },
    cardRarities: ['Glyph', 'Mythic'],
    canBePristine: true,
    color: 0x9B59B6,
    specialCards: {
      iotw: DROP_RATES.IOTW_CARD,
      winter: DROP_RATES.WINTER_CARD,
      pristine: DROP_RATES.PRISTINE_CARD
    }
  }
};

const DROP_RATES_DISPLAY = {
  normal: {
    currencies: {
      "Crystals": "40%",
      "Stardust": "30%"
    },
    cards: {
      "Standard": "70%",
      "Unique": "30%"
    }
  },
  premium: {
    currencies: {
      "Crystals": "40%",
      "Astral Essence": "30%",
      "Cosmics": "30%"
    },
    cards: {
      "Idol of the Month": "5%",
      "Winter": "10%",
      "Pristine": "30%",
      "Regular Mythic": "55%"
    }
  }
};

const CURRENCY_EMOJIS = {
  crystals: "<:zerose:1449661246407311455> ",
  stardust: "<:stardust:1125059156785762436>",
  astralEssence: "<:astral_essence:1129023606542839819>",
  selca: "<:taerae_sparkles:1268944470049820865>",
  candyCanes: "<:candycane:1320755924620808255>"
};

const premiumBoxCooldowns = new Map();
const cardCache = new Map();

function cleanupExpiredEntries(map, ttl) {
  const now = Date.now();
  for (const [key, value] of map.entries()) {
    if (now - value.timestamp > ttl) {
      map.delete(key);
    }
  }
}

function canOpenPremiumBox(userId) {
  const lastOpened = premiumBoxCooldowns.get(userId);
  if (!lastOpened) return true;
  return Date.now() - lastOpened >= COOLDOWNS.PREMIUM_BOX;
}

function getTimeUntilNextPremium(userId) {
  const lastOpened = premiumBoxCooldowns.get(userId);
  if (!lastOpened) return "Ready!";

  const timeLeft = COOLDOWNS.PREMIUM_BOX - (Date.now() - lastOpened);
  const hours = Math.floor(timeLeft / 3600000);
  const minutes = Math.floor((timeLeft % 3600000) / 60000);

  return `${hours}h ${minutes}m`;
}

async function getCachedCards(rarities, groupFilter = null, cardIds = null) {
  const cacheKey = `${rarities.join(',')}_${groupFilter || 'all'}_${cardIds ? cardIds.join(',') : 'none'}`;
  const cached = cardCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < COOLDOWNS.CACHE_TTL) {
    return cached.cards;
  }

  try {
    let query = { 
      rarity: { $in: rarities },
      spawnable: true 
    };

    if (groupFilter) {
      query.group = { $regex: new RegExp(groupFilter, 'i') };
    }

    // NEW: Filter by cardIds if provided
    if (cardIds && cardIds.length > 0) {
      query.cardId = { $in: cardIds };
    }

    const cards = await Card.find(query).lean();

    cardCache.set(cacheKey, {
      cards,
      timestamp: Date.now()
    });

    return cards;
  } catch (error) {
    console.error('Error fetching cards from database:', error);
    return [];
  }
}

class BoxError extends Error {
  constructor(message, type = 'GENERIC') {
    super(message);
    this.type = type;
    this.name = 'BoxError';
  }
}

function calculateRewards(rewardConfig) {
  const rewards = {};
  const rand = Math.random();
  let cumulative = 0;

  for (const [type, config] of Object.entries(rewardConfig)) {
    cumulative += config.rate;
    if (rand <= cumulative) {
      rewards[type] = Math.floor(Math.random() * (config.max - config.min + 1)) + config.min;
      break;
    }
  }

  return rewards;
}

async function processCardImage(card, condition) {
  try {
    const overlayPromise = condition && condition.toLowerCase() !== 'good'
      ? CardGenerationService.preloadOverlay(card.group, card.rarity, condition, card.cardId)
      : Promise.resolve(null);

    return await CardGenerationService.processCardImage(card, condition, overlayPromise);
  } catch (error) {
    console.error(`Error processing image for ${card.name}:`, error.message);
    throw new BoxError('Failed to process card image', 'IMAGE_ERROR');
  }
}

async function generateCard(msg, options = {}) {
  const {
    rarities = ['Standard'],
    groupFilter = null,
    forcePristine = false,
    specialType = null
  } = options;

  try {
    let cards;

    if (specialType === 'iotw') {
      // NEW: Use cardIds instead of group filter
      cards = await getCachedCards(['Standard', 'Unique', 'Glyph', 'Mythic'], null, IOTW_CARD_IDS);
    } else if (specialType === 'winter') {
      cards = await getCachedCards(['Standard', 'Unique', 'Glyph', 'Mythic'], null, WINTER_CARD_IDS);
    } else {
      cards = await getCachedCards(rarities, groupFilter);
    }

    if (cards.length === 0) {
      throw new BoxError('No cards available for the specified criteria', 'NO_CARDS');
    }

    const selectedCard = cards[Math.floor(Math.random() * cards.length)];
    const cardCode = await generateUniqueCode();

    if (!cardCode) {
      throw new BoxError('Failed to generate unique card code', 'CODE_ERROR');
    }

    const cardWellness = getCardWellness(selectedCard.rarity);
    const cardCondition = forcePristine ? 'Pristine' : getRandomCardCondition();

    const imageBuffer = await processCardImage(
      { ...selectedCard, condition: cardCondition }, 
      cardCondition
    );

    const newCard = new User({
      discordId: msg.author.id,
      cardCode: cardCode,
      name: selectedCard.name,
      group: selectedCard.group,
      rarity: selectedCard.rarity,
      imageURL: selectedCard.imageURL,
      cardWellness: cardWellness,
      condition: cardCondition,
    });

    await newCard.save();
    
    // Log card spawn
    logCardSpawn({
      userId: msg.author.id,
      username: msg.author.username,
      cardName: selectedCard.name,
      group: selectedCard.group,
      rarity: selectedCard.rarity,
      condition: cardCondition,
      cardCode: cardCode,
      printNumber: newCard.printNumber,
      command: 'factory',
      channelId: msg.channel.id,
      channelName: msg.channel.name || 'DM',
      guildId: msg.guildID || 'DM',
      guildName: msg.channel.guild?.name || 'DM',
      isCosmic: false
    }).catch(err => console.error('[FACTORY_LOG_ERROR]', err));
    
    return { ...newCard.toObject(), imageBuffer };

  } catch (error) {
    if (error instanceof BoxError) {
      throw error;
    }
    console.error("Error generating card:", error);
    throw new BoxError('Failed to generate card', 'GENERATION_ERROR');
  }
}

async function openBox(msg, currency, userId, boxType) {
  const config = BOX_CONFIG[boxType];
  
  const isFree = boxType === 'premium' && canOpenPremiumBox(userId);
  const actualCost = isFree ? 0 : config.cost;

  if (!isFree && currency[config.currencyKey] < actualCost) {
    throw new BoxError(
      `You need ${actualCost} ${CURRENCY_EMOJIS.candyCanes} Candy Canes to open a ${boxType} box!`, 
      'INSUFFICIENT_FUNDS'
    );
  }

  const rewards = calculateRewards(config.rewards);

  let card;
  if (boxType === 'premium') {
    const rand = Math.random();
    
    if (rand < 0.05) {
      card = await generateCard(msg, { specialType: 'iotw' });
    } else if (rand < 0.15) {
      card = await generateCard(msg, { specialType: 'winter' });
    } else if (rand < 0.45) {
      card = await generateCard(msg, { 
        rarities: config.cardRarities, 
        forcePristine: true 
      });
    } else {
      card = await generateCard(msg, { rarities: ['Mythic'] });
    }
  } else {
    card = await generateCard(msg, { rarities: config.cardRarities });
  }

  if (!isFree) {
    currency[config.currencyKey] -= actualCost;
  }
  
  for (const [rewardType, amount] of Object.entries(rewards)) {
    currency[rewardType] += amount;
  }
  await currency.save();

  if (boxType === 'premium' && isFree) {
    premiumBoxCooldowns.set(userId, Date.now());
  }

  return {
    card,
    embed: createRewardEmbed(msg.author, rewards, card, boxType, actualCost, config.color)
  };
}

// UPDATED: Cleaner embeds
function createOptionEmbed(author, balance, canOpenPremium) {
  return {
    author: {
      name: `🎁 Festive Factory`,
      icon_url: author.avatarURL,
    },
    description: "**Choose your box:**",
    fields: [
      {
        name: "📦 Normal Box",
        value: `${BOX_CONFIG.normal.cost} ${CURRENCY_EMOJIS.candyCanes}\n• Standard-Unique cards\n• 2% pristine chance`,
        inline: true
      },
      {
        name: "✨ Premium Box",
        value: canOpenPremium 
          ? `**FREE** (Next: ${getTimeUntilNextPremium(author.id)})\n• Glyph-Mythic + Specials\n• 30% pristine chance`
          : `${BOX_CONFIG.premium.cost} ${CURRENCY_EMOJIS.candyCanes}\n• Glyph-Mythic + Specials\n• 30% pristine chance`,
        inline: true
      },
      {
        name: "💰 Your Balance",
        value: `${balance} ${CURRENCY_EMOJIS.candyCanes}`,
        inline: false
      }
    ],
    color: 0xE74C3C,
    footer: { text: "Free premium box every 8 hours!" }
  };
}

function createOptionButtons(canOpenPremium) {
  return [
    {
      type: 2,
      style: 2,
      custom_id: "normal_box",
      label: "Normal Box",
      emoji: { id: "1321082103785328681", name: "normalbox" }
    },
    {
      type: 2,
      style: 2,
      custom_id: "premium_box",
      label: "Premium Box",
      emoji: { id: "1321082105655988307", name: "premiumbox" }
    },
    {
      type: 2,
      style: 2,
      custom_id: "drop_rates",
      label: "Drop Rates",
      emoji: { name: "📊" }
    }
  ];
}

function createDropRatesEmbed() {
  return {
    title: "📊 Factory Box Drop Rates",
    fields: [
      {
        name: "📦 Normal Box",
        value: "**Currencies:**\n" +
          Object.entries(DROP_RATES_DISPLAY.normal.currencies)
            .map(([currency, rate]) => `${rate} ${currency}`)
            .join(' • ') +
          "\n\n**Cards:**\n" +
          Object.entries(DROP_RATES_DISPLAY.normal.cards)
            .map(([card, rate]) => `${rate} ${card}`)
            .join(' • '),
        inline: false
      },
      {
        name: "✨ Premium Box",
        value: "**Currencies:**\n" +
          Object.entries(DROP_RATES_DISPLAY.premium.currencies)
            .map(([currency, rate]) => `${rate} ${currency}`)
            .join(' • ') +
          "\n\n**Cards:**\n" +
          Object.entries(DROP_RATES_DISPLAY.premium.cards)
            .map(([card, rate]) => `${rate} ${card}`)
            .join(' • '),
        inline: false
      }
    ],
    color: 0xE74C3C
  };
}

function createRewardEmbed(author, rewards, card, boxType, cost, color) {
  const rewardText = Object.entries(rewards)
    .map(([type, amount]) => {
      const formattedType = type === 'selca' ? 'cosmics' : type.replace(/([A-Z])/g, ' $1').toLowerCase();
      return `${CURRENCY_EMOJIS[type]} **${amount}** ${formattedType}`;
    })
    .join(' • ');

  const embed = {
    title: `🎁 ${boxType.charAt(0).toUpperCase() + boxType.slice(1)} Box Opened!`,
    description: `**Rewards:** ${rewardText}`,
    color: color,
    footer: { text: cost > 0 ? `${cost} Candy Canes used` : "Free box!" }
  };

  if (card) {
    embed.fields = [{
      name: `${card.group} ${card.name}`,
      value: `**${card.rarity}** • ${card.condition} • ${card.cardWellness} wellness\nCode: \`${card.cardCode}\``,
      inline: false
    }];

    if (card.imageBuffer) {
      embed.image = { url: "attachment://factory_card.png" };
    }
  }

  return embed;
}

module.exports = {
  name: "factory",
  description: "Open festive factory boxes for special rewards!",

  async execute(msg, args, client) {
    cleanupExpiredEntries(premiumBoxCooldowns, COOLDOWNS.PREMIUM_BOX);

    const userId = msg.author.id;

    try {
      const graphic = await Graphic.findOne({ userId });
      if (!graphic || !graphic.isRegistered) {
        return msg.channel.createMessage({
          embeds: [{
            title: "🚫 Registration Required",
            description: "Please register first using the `?register` command!",
            color: 0xFF6B6B
          }]
        });
      }

      const currency = await Currency.findOne({ userId });
      if (!currency) {
        return msg.channel.createMessage({
          content: "Currency profile not found. Please check your balance.",
          messageReference: { messageID: msg.id }
        });
      }

      const embed = createOptionEmbed(msg.author, currency.candyCanes, canOpenPremiumBox(userId));
      const buttons = createOptionButtons(canOpenPremiumBox(userId));

      const optionMessage = await msg.channel.createMessage({
        embeds: [embed],
        components: [{ type: 1, components: buttons }],
        messageReference: { messageID: msg.id }
      });

      const interactionHandler = async (interaction) => {
        if (interaction.message.id !== optionMessage.id || interaction.member.id !== msg.author.id) {
          return;
        }
        
        try {
          await interaction.acknowledge();

          if (interaction.data.custom_id === "drop_rates") {
            await interaction.createFollowup({
              embeds: [createDropRatesEmbed()],
              flags: 64
            });
            return;
          }

          const freshCurrency = await Currency.findOne({ userId });
          if (!freshCurrency) {
            throw new BoxError('Currency profile not found', 'CURRENCY_ERROR');
          }

          if (interaction.data.custom_id === "premium_box") {
            const isPremiumFree = canOpenPremiumBox(userId);
            
            if (!isPremiumFree && freshCurrency.candyCanes < BOX_CONFIG.premium.cost) {
              await interaction.createFollowup({
                content: `You need ${BOX_CONFIG.premium.cost} ${CURRENCY_EMOJIS.candyCanes} Candy Canes!\n\n**Next free box:** ${getTimeUntilNextPremium(userId)}`,
                flags: 64
              });
              return;
            }
          }

          let result;
          if (interaction.data.custom_id === "normal_box") {
            result = await openBox(msg, freshCurrency, userId, 'normal');
          } else if (interaction.data.custom_id === "premium_box") {
            result = await openBox(msg, freshCurrency, userId, 'premium');
          }

          if (result) {
            await interaction.createFollowup({
              embeds: [result.embed],
              file: result.card ? { 
                file: result.card.imageBuffer, 
                name: "factory_card.png" 
              } : null
            });

            const updatedCurrency = await Currency.findOne({ userId });
            const updatedEmbed = createOptionEmbed(
              msg.author, 
              updatedCurrency.candyCanes, 
              canOpenPremiumBox(userId)
            );
            const updatedButtons = createOptionButtons(canOpenPremiumBox(userId));
            
            await optionMessage.edit({ 
              embeds: [updatedEmbed],
              components: [{ type: 1, components: updatedButtons }]
            });
          }

        } catch (error) {
          console.error('Error in box interaction:', error);
          
          const errorMessage = error instanceof BoxError 
            ? error.message 
            : 'Something went wrong while opening your box. Please try again!';
            
          await interaction.createFollowup({
            content: errorMessage,
            flags: 64
          }).catch(console.error);
        }
      };

      client.on("interactionCreate", interactionHandler);

      setTimeout(() => {
        client.removeListener("interactionCreate", interactionHandler);
        
        const disabledButtons = buttons.map(button => ({ ...button, disabled: true }));
        optionMessage.edit({
          components: [{ type: 1, components: disabledButtons }]
        }).catch(console.error);
      }, 60000);

    } catch (error) {
      console.error('Error in factory command:', error);
      return msg.channel.createMessage({
        content: "An unexpected error occurred. Please try again later!",
        messageReference: { messageID: msg.id }
      });
    }
  }
};