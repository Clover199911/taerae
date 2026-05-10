//  info.js — Eris — case-insensitive — card information display
// -----------------------------------------------------------------------------
const Eris    = require("eris");
const User    = require("../../models/user");
const Card    = require("../../models/card");
const Graphic = require("../../models/graphic");
const searchAliases = require('../../config/searchAliases');
const sharp   = require('sharp');
const CardGenerationService = require('../../services/CardGenerationService');
const { readImageBufferFromCard, buildPublicImageUrl, getImagePathFromCard } = require('../../utils/cardImageSource');

/* --------------- CONFIG --------------- */
const EMBED_COLORS = {
  standard : 0xcaf0f8,
  unique   : 0x00b4d8,
  glyph    : 0x48cae4,
  mythic   : 0x03045e,
  default  : 0xcaf0f8
};

// Grayscale embed colors (for print lookup)
const GRAYSCALE_EMBED_COLORS = {
  standard : 0x808080,
  unique   : 0x696969,
  glyph    : 0x505050,
  mythic   : 0x303030,
  default  : 0x808080
};

const INTERACTION_TIMEOUT = 60000;
const activeHandlers = new Map();
const LOOKUP_DIMENSIONS = { width: 300, height: 480 };  // Thumbnail size

/* --------------- MAIN --------------- */
module.exports = {
  name        : "info",
  description : "Shows card information",
  
  async execute(msg, args, bot) {
    try {
      if (!(await isUserRegistered(msg, bot))) return;
      
      if (!args.length) {
        return sendMessage(
          msg, 
          bot, 
          "Invalid arguments. Usage: `?info <name or group>`"
        );
      }

      const matchingCards = await searchCards(args);
      
      if (!matchingCards.length) {
        return sendMessage(
          msg, 
          bot, 
          `No cards found matching: \`${args.join(" ")}\``
        );
      }

      const response = await sendCardEmbed(matchingCards[0], msg, matchingCards, bot);
      await setupInteractionHandler(response, matchingCards, msg, bot);
      
    } catch (err) {
      console.error("Info command error:", err);
      sendMessage(msg, bot, "❌ An error occurred. Please try again later.", 0xFF6B6B);
    }
  }
};

/* --------------- HELPERS --------------- */

async function isUserRegistered(msg, bot) {
  const graphic = await Graphic.findOne({ userId : msg.author.id }).lean();
  
  if (graphic?.isRegistered) return true;

  await sendMessage(
    msg, 
    bot, 
    "🚫 You need to register first! Use `?register` to begin!", 
    0xFF6B6B
  );
  
  return false;
}


async function searchCards(args) {
  // Expand aliases for each search term
  const expandedTerms = searchAliases.expandAll(
    args.map(term => term.toLowerCase())
  );
  
  // Build MongoDB query with OR conditions for each term
  // This lets the database do the filtering efficiently
  const query = {
    $and: expandedTerms.map(term => {
      const orConditions = [
        { name: { $regex: term, $options: 'i' } },
        { group: { $regex: term, $options: 'i' } },
        { rarity: { $regex: term, $options: 'i' } }
      ];
      
      // Only add cardId search if the term is a valid number
      const numericValue = parseInt(term);
      if (!isNaN(numericValue)) {
        orConditions.push({ cardId: numericValue });
      }
      
      return { $or: orConditions };
    })
  };
  
  // Fetch cards from database (no limit yet)
  let cards = await Card.find(query).limit(100).lean();
  
  // Sort by rarity (Standard → Unique → Glyph → Mythic), then by name
  const RARITY_ORDER = { standard: 1, unique: 2, glyph: 3, mythic: 4 };
  
  cards.sort((a, b) => {
    const rarityDiff = RARITY_ORDER[a.rarity.toLowerCase()] - RARITY_ORDER[b.rarity.toLowerCase()];
    if (rarityDiff !== 0) return rarityDiff;
    
    // If same rarity, sort by group then name
    const groupDiff = a.group.localeCompare(b.group);
    if (groupDiff !== 0) return groupDiff;
    
    return a.name.localeCompare(b.name);
  });
  
  // Limit to 25 for dropdown
  return cards.slice(0, 25);
}

async function sendCardEmbed(card, msg, matchingCards, bot) {
  const embed = await createCardEmbed(card, msg.author);
  
  const components = [];
  
  // Row 1: Select menu (if multiple cards)
  if (matchingCards.length > 1) {
    components.push({
      type       : 1,
      components : [{
        type        : 3,
        custom_id   : "select_related_card",
        placeholder : "View matching cards",
        options     : createSelectMenuOptions(matchingCards)
      }]
    });
  }
  
  // Row 2: Print Lookup button
  components.push({
    type       : 1,
    components : [{
      type      : 2,  // Button
      style     : 1,  // Primary (blue)
      label     : "🔍 Print Lookup",
      custom_id : `print_lookup:${card.cardId}`
    }]
  });

  return bot.createMessage(
    msg.channel.id, 
    { 
      embed, 
      components, 
      messageReference : { messageID : msg.id } 
    }
  );
}

function createSelectMenuOptions(cards) {
  return cards.slice(0, 25).map(card => ({
    label       : `${card.name} (${card.cardId})`,
    value       : card.cardId.toString(),
    description : `${card.group} - ${card.rarity}`.slice(0, 100)
  }));
}

async function setupInteractionHandler(botMsg, matchingCards, msg, bot) {
  // Clean up any existing handler for this message
  const existingHandler = activeHandlers.get(botMsg.id);
  if (existingHandler) {
    bot.removeListener("interactionCreate", existingHandler.handler);
    clearTimeout(existingHandler.timeout);
  }

  let isHandlerActive = true;
  let currentCard = matchingCards[0]; // Track currently displayed card

  const interactionHandler = async (interaction) => {
    if (!isHandlerActive) return;
    
    const interactionType = interaction.type;
    const interactionUserId = interaction.member?.id || interaction.user?.id;
    
    // For modal submissions, check custom_id prefix instead of message.id
    if (interactionType === Eris.Constants.InteractionTypes.MODAL_SUBMIT) {
      if (!interaction.data.custom_id.startsWith("plu_modal:")) return;
      if (interactionUserId !== msg.author.id) return;
      
      try {
        const cardId = parseInt(interaction.data.custom_id.split(":")[1]);
        const card = matchingCards.find(c => c.cardId === cardId) || currentCard;
        
        const printNumberInput = interaction.data.components[0]?.components[0]?.value;
        const printNumber = parseInt(printNumberInput);
        
        if (isNaN(printNumber) || printNumber < 1) {
          await interaction.createMessage({
            embeds : [{ 
              description : "❌ Please enter a valid print number (positive integer).", 
              color       : 0xFF6B6B 
            }],
            flags : 64  // Ephemeral
          });
          return;
        }
        
        // Find the owned card with this print number and imageURL
        const ownedCard = await User.findOne({ 
          imageURL : card.imageURL, 
          printNumber 
        }).lean();
        
        if (!ownedCard) {
          await interaction.createMessage({
            embeds : [{ 
              description : `❌ No card found with print #${printNumber} for this card.`, 
              color       : 0xFF6B6B 
            }],
            flags : 64  // Ephemeral
          });
          return;
        }
        
        // Acknowledge first, then send the result
        await interaction.acknowledge();
        
        // Send the owned card info with B&W image
        await sendPrintLookupResult(ownedCard, interaction.channel.id, botMsg.id, msg.author, bot);
        
      } catch (err) {
        console.error("Modal submit error:", err);
        try {
          await interaction.createMessage({
            content : "❌ An error occurred while looking up the print.",
            flags   : 64
          });
        } catch (e) {}
      }
      return;
    }
    
    // For component interactions, check message.id
    if (interactionType !== Eris.Constants.InteractionTypes.MESSAGE_COMPONENT) return;
    if (interaction.message?.id !== botMsg.id) return;
    if (interactionUserId !== msg.author.id) return;
    
    try {
      // Handle Button Click (Print Lookup)
      if (interaction.data.component_type === 2) {
        if (interaction.data.custom_id.startsWith("print_lookup:")) {
          const cardId = parseInt(interaction.data.custom_id.split(":")[1]);
          const card = matchingCards.find(c => c.cardId === cardId) || currentCard;
          
          // Show modal for print number input (keep custom_id short!)
          await interaction.createModal({
            title      : `Print Lookup: ${card.name}`.slice(0, 45),
            custom_id  : `plu_modal:${card.cardId}`,
            components : [{
              type       : 1,
              components : [{
                type        : 4,  // Text input
                custom_id   : "print_number",
                label       : "Enter Print Number",
                style       : 1,  // Short
                placeholder : "e.g. 453",
                required    : true,
                min_length  : 1,
                max_length  : 10
              }]
            }]
          });
          return;
        }
      }
      
      // Handle Select Menu (Card Selection)
      if (interaction.data.component_type === 3) {
        await interaction.acknowledge();
        
        const selectedCard = matchingCards.find(
          c => c.cardId === parseInt(interaction.data.values[0])
        );
        
        if (selectedCard) {
          currentCard = selectedCard;
          const embed = await createCardEmbed(selectedCard, msg.author);
          
          // Update button with new card ID
          const components = [];
          if (matchingCards.length > 1) {
            components.push({
              type       : 1,
              components : [{
                type        : 3,
                custom_id   : "select_related_card",
                placeholder : "View matching cards",
                options     : createSelectMenuOptions(matchingCards)
              }]
            });
          }
          components.push({
            type       : 1,
            components : [{
              type      : 2,
              style     : 1,
              label     : "🔍 Print Lookup",
              custom_id : `print_lookup:${selectedCard.cardId}`
            }]
          });
          
          await bot.editMessage(msg.channel.id, botMsg.id, { embed, components });
        }
        return;
      }
      
    } catch (err) {
      console.error("Interaction handler error:", err);
    }
  };

  bot.on("interactionCreate", interactionHandler);
  
  // Setup cleanup timeout
  const timeoutId = setTimeout(() => {
    cleanup();
  }, INTERACTION_TIMEOUT);

  const cleanup = () => {
    if (!isHandlerActive) return;
    
    isHandlerActive = false;
    bot.removeListener("interactionCreate", interactionHandler);
    activeHandlers.delete(botMsg.id);
    
    // Disable components
    bot.editMessage(
      botMsg.channel.id, 
      botMsg.id, 
      { 
        components: botMsg.components?.map(row => ({
          ...row,
          components: row.components.map(c => ({ ...c, disabled: true }))
        })) || []
      }
    ).catch(() => {});
  };

  // Store handler reference for cleanup
  activeHandlers.set(botMsg.id, {
    handler: interactionHandler,
    timeout: timeoutId,
    cleanup
  });
}

/* --------------- PRINT LOOKUP (B&W) --------------- */

async function sendPrintLookupResult(cardData, channelId, replyToId, author, bot) {
  // Get card template info and print stats in parallel
  const [cardTemplate, totalPrints, pristineCount, imageBuffer] = await Promise.all([
    Card.findOne({ imageURL : cardData.imageURL }).lean(),
    User.countDocuments({ imageURL : cardData.imageURL }),
    User.countDocuments({ imageURL : cardData.imageURL, condition : "Pristine" }),
    processGrayscaleImage(cardData)
  ]);

  const embed = createPrintLookupEmbed(cardData, cardTemplate, totalPrints, pristineCount, author);

  return bot.createMessage(
    channelId,
    { embed, messageReference : { messageID : replyToId } },
    { file : imageBuffer, name : "print_lookup.png" }
  );
}

async function processGrayscaleImage(card) {
  const redis = CardGenerationService.redis;
  const imageSource = card.imagePath || card.imageURL;
  const hash  = require('crypto').createHash('md5').update(String(imageSource)).digest('hex');
  const key   = `image:${hash}:grayscale:${LOOKUP_DIMENSIONS.width}x${LOOKUP_DIMENSIONS.height}`;

  // Check cache for grayscale version
  try {
    const cached = redis?.getBuffer 
      ? await redis.getBuffer(key) 
      : await redis?.get(key);
    
    if (cached) {
      return typeof cached === 'string' 
        ? Buffer.from(cached, 'base64') 
        : cached;
    }
  } catch (err) {
    // Continue without cache
  }

  // Read image
  let buffer;
  try {
    buffer = await readImageBufferFromCard(card, { timeout: 20000 });
  } catch (error) {
    throw new Error(`Failed to read image: ${error.message}`);
  }

  // Process with grayscale effect
  const result = await sharp(buffer, { 
    sequentialRead   : true,
    limitInputPixels : 268402689
  })
    .resize(LOOKUP_DIMENSIONS.width, LOOKUP_DIMENSIONS.height, {
      fit                : 'contain',
      background         : { r: 0, g: 0, b: 0, alpha: 0 },
      kernel             : sharp.kernel.lanczos3,
      withoutEnlargement : false
    })
    .grayscale()  // Convert to B&W
    .modulate({ brightness: 1.05 })  // Slightly brighten for visibility
    .webp({ 
      quality      : 100,
      effort       : 3,
      lossless     : false,
      nearLossless : true
    })
    .toBuffer();

  // Cache asynchronously
  if (redis?.set) {
    redis.set(key, result, 'EX', 86400).catch(() => {});
  }

  return result;
}

function createPrintLookupEmbed(cardData, cardTemplate, totalPrints, pristineCount, author) {
  const formattedTotal = totalPrints.toString().padStart(5, "0");
  const printRunValue  = pristineCount > 0 
    ? `${formattedTotal} (${pristineCount} Pristine)`
    : formattedTotal;

  const dateAdded = cardTemplate?.dateAdded
    ? `<t:${Math.floor(new Date(cardTemplate.dateAdded).getTime() / 1000)}:f>`
    : "Unknown";

  return {
    title       : `🔍 Print Lookup: ${cardData.name} #${cardData.printNumber}`,
    description : `**Owner:** <@${cardData.discordId}>`,
    color       : GRAYSCALE_EMBED_COLORS[cardData.rarity?.toLowerCase()] || GRAYSCALE_EMBED_COLORS.default,
    thumbnail   : { url : "attachment://print_lookup.png" },
    
    fields : [
      { name : "Card Code",        value : `\`${cardData.cardCode}\``,        inline : true },
      { name : "Print #",          value : `#${cardData.printNumber}`,        inline : true },
      { name : "Condition",        value : cardData.condition || "Unknown",   inline : true },
      { name : "Wellness",         value : `${cardData.cardWellness ?? "N/A"}`, inline : true },
      { name : "Rarity",           value : cardData.rarity || "Unknown",      inline : true },
      { name : "Group",            value : cardData.group || "Unknown",       inline : true },
      { name : "Global Print Run", value : printRunValue,                     inline : true },
      { name : "Date Added",       value : dateAdded,                         inline : true },
      { name : "Status",           value : cardData.cardLocked ? "🔒 Locked" : "🔓 Unlocked", inline : true }
    ],

    footer    : { text : `Requested by ${author.username}`, icon_url : author.avatarURL },
    timestamp : new Date()
  };
}

async function createCardEmbed(card, author) {
  // Get total count (everyone) and pristine count (everyone)
  const [totalCount, pristineCount] = await Promise.all([
    User.countDocuments({ imageURL : card.imageURL }),
    User.countDocuments({ 
      imageURL  : card.imageURL,
      condition : "Pristine"
    })
  ]);
  
  const formattedTotal = totalCount.toString().padStart(5, "0");
  const printRunValue = pristineCount > 0 
    ? `${formattedTotal} (${pristineCount} Pristine)`
    : formattedTotal;
  
  const formattedDate = card.dateAdded 
    ? `<t:${Math.floor(new Date(card.dateAdded).getTime() / 1000)}:f>` 
    : "Unknown";

  const thumbnailUrl = buildPublicImageUrl(getImagePathFromCard(card)) || card.imageURL;

  return {
    title     : `Card Information: ${card.cardId}`,
    color     : EMBED_COLORS[card.rarity?.toLowerCase()] || EMBED_COLORS.default,
    thumbnail : thumbnailUrl ? { url : thumbnailUrl } : undefined,
    
    fields : [
      { 
        name   : "Print Run", 
        value  : printRunValue, 
        inline : true 
      },
      { 
        name   : "Rarity", 
        value  : card.rarity || "Unknown", 
        inline : true 
      },
      { 
        name   : "Group", 
        value  : card.group || "Unknown", 
        inline : true 
      },
      { 
        name   : "Name", 
        value  : card.name || "Unknown", 
        inline : true 
      },
      { 
        name   : "Date Added", 
        value  : formattedDate, 
        inline : true 
      },
      { 
        name   : "Status", 
        value  : card.spawnable ? "Obtainable" : "Limited", 
        inline : true 
      }
    ],
    
    footer    : { 
      text     : `Requested by ${author.username}`, 
      icon_url : author.avatarURL 
    },
    timestamp : new Date()
  };
}

function sendMessage(msg, bot, content, color = 0xcaf0f8) {
  return bot.createMessage(msg.channel.id, {
    embed : { 
      description : content, 
      color 
    },
    messageReference : { messageID : msg.id }
  });
}

// Cleanup on process exit
process.on("SIGINT", () => {
  activeHandlers.forEach(({ cleanup }) => cleanup());
});
