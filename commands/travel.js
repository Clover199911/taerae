const User = require("../models/user");
const Currency = require("../models/currency");
const Cooldown = require("../models/cooldown");
const Graphic = require("../models/graphic");
const Eris = require("eris");

// Constants
const COOLDOWN_MS = 20 * 60 * 1000; // 20 minutes

const DESTINATIONS = [
  {
    name: "ZEROSE Forest",
    minWellness: 100,
    currency: "crystals",
    rarity: ["Standard", "Unique", "Glyph", "Mythic"],
    emoji: { id: "1461015415466496191", name: "rose" },
    deduction: 10,
    description: "encountered a water spirit",
    reward: "Crystals",
    ranges: {
      Standard: [50, 100],
      Unique: [250, 500],
      Glyph: [500, 1000],
      Mythic: [1500, 2500]
    }
  },
  {
    name: "Stardust Park",
    minWellness: 350,
    currency: "stardust",
    rarity: ["Unique", "Glyph", "Mythic"],
    emoji: { id: "1449661267915571274", name: "stardust" },
    deduction: 30,
    description: "encountered a celestial being",
    reward: "Stardust",
    ranges: {
      Unique: [0, 3],
      Glyph: [3, 7],
      Mythic: [10, 15]
    }
  },
  {
    name: "Moonlit Grove",
    minWellness: 800,
    currency: "astralEssence",
    rarity: ["Mythic"],
    emoji: { id: "1461015891138318598", name: "astralessence" },
    deduction: 50,
    description: "met a mystical guardian",
    reward: "Astral Essence",
    ranges: {
      Mythic: [10, 20]
    }
  }
];

const CONDITION_MULTIPLIERS = {
  Pristine: 1.5,
  Mint: 1.25,
  Good: 1,
  Worn: 0.75,
  Damaged: 0.5
};

module.exports = {
  name: "travel",
  aliases: ["tr"],
  description: "Embark on a journey with your card",
  async execute(msg, args, client) {
    try {
      // Validate input synchronously first
      if (!args?.length) {
        return sendErrorMessage(msg, "Please provide your card code to travel.");
      }

      // Then perform async checks
      if (!await isRegistered(msg)) return;
      if (await isOnCooldown(msg)) return;
      
      const card = await getUserCard(msg.author.id, args[0]);
      if (!card) {
        return sendErrorMessage(msg, "Invalid card code or you don't own this card.");
      }

      const availableDestinations = getAvailableDestinations(card);
      if (!availableDestinations.length) {
        return sendErrorMessage(msg, "Your card doesn't have enough wellness for any destination.");
      }

      const message = await sendDestinationOptions(msg, card, availableDestinations);
      await setCooldown(msg.author.id);
      await handleDestinationSelection(message, msg, card, availableDestinations, client);
    } catch (error) {
      console.error('Travel error:', error);
      sendErrorMessage(msg, "An error occurred. Please try again later.");
    }
  }
};

// Registration Check
async function isRegistered(msg) {
  const graphic = await Graphic.findOne({ userId: msg.author.id });
  if (!graphic?.isRegistered) {
    sendErrorMessage(msg, "Please use `?register` to begin your journey!");
    return false;
  }
  return true;
}

// Cooldown Management
async function isOnCooldown(msg) {
  const cooldown = await Cooldown.findOne({ 
    user: msg.author.id, 
    command: 'travel' 
  });
  
  if (cooldown && cooldown.cooldownEnd > Date.now()) {
    const remaining = Math.ceil((cooldown.cooldownEnd - Date.now()) / 1000);
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    
    sendErrorMessage(msg, `Please wait ${minutes}m ${seconds}s before traveling again.`);
    return true;
  }
  return false;
}

async function setCooldown(userId) {
  const cooldownEnd = new Date(Date.now() + COOLDOWN_MS);
  
  await Cooldown.findOneAndUpdate(
    { user: userId, command: 'travel' },
    { cooldownEnd },
    { upsert: true }
  );
}

// Card Retrieval
async function getUserCard(userId, cardCode) {
  return await User.findOne({ cardCode, discordId: userId });
}

// Destination Logic
function getAvailableDestinations(card) {
  return DESTINATIONS.filter(dest => 
    card.cardWellness >= dest.minWellness && 
    dest.rarity.includes(card.rarity)
  );
}

// Reward Calculation
function calculateReward(destination, cardRarity, condition) {
  const ranges = destination.ranges?.[cardRarity];
  
  if (!ranges) {
    console.warn(`Missing reward range for destination "${destination.name}" and rarity "${cardRarity}"`);
    return 1;
  }
  
  const [min, max] = ranges;
  const baseAmount = Math.floor(Math.random() * (max - min + 1)) + min;
  const multiplier = CONDITION_MULTIPLIERS[condition] || 1;
  
  return Math.floor(baseAmount * multiplier);
}

// Message Handling
function sendErrorMessage(msg, content) {
  msg.channel.createMessage({
    content,
    messageReference: { messageID: msg.id }
  }).catch(err => console.error('Error sending message:', err));
}

async function sendDestinationOptions(msg, card, destinations) {
  const embed = {
    title: "🗺️ Choose Your Destination",
    description: `**Traveler:** ${card.name}\n**Rarity:** ${card.rarity}\n**Condition:** ${card.condition}\n\n*Select a destination from the menu below*`,
    color: 0x48cae4,
    fields: destinations.map(dest => ({
      name: `${dest.emoji ? `<:${dest.emoji.name}:${dest.emoji.id}>` : ''} ${dest.name}`,
      value: [
        `📍 Min Wellness: \`${dest.minWellness}\``,
        `💰 Cost: \`${dest.deduction}\` wellness`,
        `🎁 Reward: ${dest.reward}`
      ].join('\n'),
      inline: true
    })),
    footer: {
      text: `Current Wellness: ${card.cardWellness}`
    },
    timestamp: new Date()
  };

  const selectMenu = {
    type: 1,
    components: [{
      type: 3, // Select menu type
      custom_id: "travel_destination",
      placeholder: "Select a destination...",
      min_values: 1,
      max_values: 1,
      options: destinations.map((dest, index) => ({
        label: dest.name,
        value: `travel_${index}`,
        description: `Requires ${dest.minWellness} wellness • -${dest.deduction} wellness`,
        emoji: dest.emoji
      }))
    }]
  };

  return msg.channel.createMessage({
    embed,
    components: [selectMenu],
    messageReference: { messageID: msg.id }
  });
}

// Interaction Handling
async function handleDestinationSelection(message, originalMsg, card, destinations, client) {
  let interactionProcessed = false;
  let handlerRemoved = false;

  const handler = async (interaction) => {
    if (!isValidInteraction(interaction, message, originalMsg)) return;

    try {
      interactionProcessed = true;
      await interaction.acknowledge();

      const selectedValue = interaction.data.values[0]; // Get selected value from select menu
      const destinationIndex = parseInt(selectedValue.split('_')[1]);
      const destination = destinations[destinationIndex];

      const result = await processTravel(card, destination);
      await sendTravelResult(interaction, card, destination, result);
    } catch (error) {
      console.error('Travel interaction error:', error);
      await interaction.editOriginalMessage({
        content: "An error occurred during your travel.",
        components: []
      }).catch(err => console.error('Error editing message:', err));
    } finally {
      if (!handlerRemoved) {
        client.removeListener("interactionCreate", handler);
        handlerRemoved = true;
      }
    }
  };

  client.on("interactionCreate", handler);

  // Timeout handler
  setTimeout(() => {
    if (!handlerRemoved) {
      client.removeListener("interactionCreate", handler);
      handlerRemoved = true;
    }

    if (!interactionProcessed) {
      message.edit({
        components: []
      }).catch(err => console.error('Error editing message:', err));
    }
  }, 30000);
}

function isValidInteraction(interaction, message, originalMsg) {
  return interaction.type === Eris.Constants.InteractionTypes.MESSAGE_COMPONENT
    && interaction.message.id === message.id
    && interaction.member.id === originalMsg.author.id;
}

// Core Travel Processing
async function processTravel(card, destination) {
  // Deduct wellness first - if this fails, no currency is awarded
  card.cardWellness = Math.max(0, card.cardWellness - destination.deduction);
  await card.save();
  
  const amount = calculateReward(destination, card.rarity, card.condition);
  
  // Award currency after wellness is successfully deducted
  await Currency.findOneAndUpdate(
    { userId: card.discordId },
    { $inc: { [destination.currency]: amount } },
    { upsert: true }
  );
  
  // Update quest progress for travel command
  const QuestService = require("../services/QuestService");
  const questTypes = ['travel'];
  
  // Add destination-specific quest types
  if (destination.name === "ZEROSE Forest") questTypes.push('travel_zerose');
  else if (destination.name === "Stardust Park") questTypes.push('travel_stardust');
  else if (destination.name === "Moonlit Grove") questTypes.push('travel_moonlit');
  
  QuestService.updateQuestProgress(card.discordId, questTypes, 1).catch(err =>
    console.error('[TRAVEL_QUEST_UPDATE_ERROR]', err)
  );
  
  return { amount, newWellness: card.cardWellness };
}

async function sendTravelResult(interaction, card, destination, result) {
  const resultEmbed = {
    author: {
      name: `${interaction.member.username}'s Travel Log`,
      icon_url: interaction.member.avatarURL
    },
    title: `${destination.emoji ? `<:${destination.emoji.name}:${destination.emoji.id}>` : '✨'} ${destination.name}`,
    description: `*You ${destination.description}...*`,
    color: 0x48cae4,
    fields: [
      {
        name: "🎁 Rewards Obtained",
        value: `**||${result.amount}||** ${destination.reward}`,
        inline: true
      },
      {
        name: "💫 Wellness Cost",
        value: `-${destination.deduction}`,
        inline: true
      },
      {
        name: "❤️ Remaining Wellness",
        value: `${result.newWellness}`,
        inline: true
      }
    ],
    footer: {
      text: `Card: ${card.name} • ${card.condition}`
    },
    timestamp: new Date()
  };

  await interaction.editOriginalMessage({ 
    embeds: [resultEmbed], 
    components: [] 
  });
}