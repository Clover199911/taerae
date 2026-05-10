// ============================================================================
// GROUPT COMMAND - Interactive Collection Viewer
// ============================================================================
// Usage: ?groupt <group name/alias/emoji>
// Example: ?groupt tbz, ?groupt disco, ?groupt winter, ?groupt iotw1
// ============================================================================

const sharp = require('sharp');
const Card = require('../models/card');
const User = require('../models/user');
const CardGenerationService = require('../services/CardGenerationService');
const specialGroups = require('../config/specialGroups');
const searchAliases = require('../config/searchAliases');
const searchUtils = require('../utils/searchUtils');
const COSMIC_CONFIG = require('../utils/cosmicConfig');

const RARITY_ORDER = ['Mythic', 'Glyph', 'Unique', 'Standard'];
const RARITY_EMOJIS = {
  'Mythic': { name: '✨' },
  'Glyph': { name: '🔮' },
  'Unique': { name: '💎' },
  'Standard': { name: '⭐' }
};

const GRID_CONFIG = {
  maxCardsPerRow: 5,
  cardWidth: 300,
  cardHeight: 480,
  padding: 5,
  backgroundColor: { r: 0, g: 0, b: 0, alpha: 0 }
};

const UNOWNED_OPACITY = 0.35;
const INTERACTION_TIMEOUT = 300000; // 5 minutes

// Store active interactions
const activeInteractions = new Map();

// ============================================================================
// MAIN COMMAND
// ============================================================================

module.exports = {
  name: 'group',
  description: 'Display cards by group with interactive rarity selection',
  aliases: ['g', 'groupview'],
  cooldown: 5000,

  async execute(msg, args, bot) {
    if (!args.length) {
      return bot.createMessage(msg.channel.id, {
        content: "Usage: `?groupt <group name/alias>`\nExample: `?groupt tbz`, `?groupt disco`, `?groupt iotw1`",
        messageReference: { messageID: msg.id }
      });
    }

    try {
      const searchTerm = args.join(' ').toLowerCase();
      
      // 🎯 NEW: Check if search term matches IOTW/Event config
      const cardIds = COSMIC_CONFIG.findCardsBySearchTerm(searchTerm);
      const displayName = COSMIC_CONFIG.getDisplayName(searchTerm);
      
      if (cardIds.length > 0) {
        // Found in cosmic config - display those cards directly
        await displayCosmicCollection(bot, msg, cardIds, displayName || searchTerm);
        return;
      }
      
      // Original group search logic
      const expandedTerms = expandSearchTerm(searchTerm);
      const matchingGroups = await findMatchingGroups(expandedTerms);

      if (!matchingGroups.length) {
        return bot.createMessage(msg.channel.id, {
          content: "📊 No groups found matching that search term.",
          messageReference: { messageID: msg.id }
        });
      }

      // Check if this is a special combined group
      const specialGroup = specialGroups.findBySearchTerm(searchTerm);
      const isCombined = specialGroup?.isCombined || false;

      // If combined search OR single group, display directly
      if (isCombined || matchingGroups.length === 1) {
        await displayGroupCollection(
          bot, 
          msg, 
          matchingGroups, 
          isCombined ? specialGroup.displayName : matchingGroups[0]
        );
        return;
      }

      // Multiple groups - let user pick
      return handleMultipleGroups(bot, msg, matchingGroups);

    } catch (error) {
      console.error('Error in groupt command:', error);
      return bot.createMessage(msg.channel.id, {
        content: "⚠️ An error occurred while processing your request.",
        messageReference: { messageID: msg.id }
      });
    }
  }
};

// ============================================================================
// COSMIC COLLECTION DISPLAY (for IOTW/Events by card ID)
// ============================================================================

async function displayCosmicCollection(bot, msg, cardIds, displayName) {
  const [allCards, userCards] = await Promise.all([
    Card.find({ cardId: { $in: cardIds } }).lean().sort({ rarity: 1, cardId: 1 }),
    User.find({ discordId: msg.author.id, cardId: { $in: cardIds } }).lean()
  ]);

  if (!allCards.length) {
    return bot.createMessage(msg.channel.id, {
      content: "📊 No cards found for that collection.",
      messageReference: { messageID: msg.id }
    });
  }

  const cardsByRarity = groupCardsByRarity(allCards);
  const availableRarities = RARITY_ORDER.filter(r => cardsByRarity[r]?.length > 0);

  if (!availableRarities.length) {
    return bot.createMessage(msg.channel.id, {
      content: "📊 No cards found for that collection.",
      messageReference: { messageID: msg.id }
    });
  }

  const overallSummary = generateOverallSummary(cardsByRarity, userCards);
  const collectionTitle = capitalizeGroup(displayName);

  const selectMenu = createRaritySelectMenu(msg.author.id, availableRarities);

  const initialMsg = await bot.createMessage(msg.channel.id, {
    content: `📊 **${collectionTitle}**\n\n${overallSummary}\n\n*Select a rarity from the dropdown below:*`,
    components: [selectMenu],
    messageReference: { messageID: msg.id }
  });

  cleanupInteraction(bot, msg.author.id);

  activeInteractions.set(msg.author.id, {
    messageId: initialMsg.id,
    channelId: msg.channel.id,
    groupNames: null, // Not used for cosmic collections
    cardIds: cardIds,
    cardsByRarity,
    userCards,
    availableRarities,
    collectionTitle,
    timestamp: Date.now()
  });

  setupInteractionHandler(bot, msg.author.id);

  setTimeout(() => {
    cleanupInteraction(bot, msg.author.id);
  }, INTERACTION_TIMEOUT);
}

// ============================================================================
// SEARCH FUNCTIONS
// ============================================================================

function expandSearchTerm(term) {
  const expanded = [term];

  // Check aliases from config
  if (searchAliases.groups?.[term]) {
    expanded.push(searchAliases.groups[term]);
  }

  // Check special groups and add emoji
  const specialExpanded = specialGroups.expandSearchTerm(expanded[expanded.length - 1]);
  
  // If specialGroups returns a string, use it; otherwise keep the array
  if (typeof specialExpanded === 'string' && specialExpanded !== expanded[expanded.length - 1]) {
    expanded.push(specialExpanded);
  }
  
  return expanded; // Always return an array
}

async function findMatchingGroups(searchTerms) {
  console.log('Searching for terms:', searchTerms);
  const allGroups = await Card.distinct('group');
  
  // 🎯 NEW: Filter out emoji-prefixed groups
  const filteredGroups = allGroups.filter(group => !searchUtils.hasEmojiPrefix(group));
  
  const matches = new Set();

  for (const group of filteredGroups) {
    for (const term of searchTerms) {
      if (searchUtils.flexibleMatch(group, term)) {
        matches.add(group);
        break;
      }
    }
  }

  console.log('Found matches:', Array.from(matches));
  return Array.from(matches).sort();
}

// ============================================================================
// MULTI-GROUP SELECTION
// ============================================================================

async function handleMultipleGroups(bot, msg, groups) {
  const displayGroups = groups.slice(0, 25); // Discord limit

  const selectMenu = {
    type: 1,
    components: [{
      type: 3,
      custom_id: `groupt_group_select_${msg.author.id}_${Date.now()}`,
      placeholder: `${groups.length} groups found - Select one`,
      options: displayGroups.map(group => ({
        label: capitalizeGroup(group),
        value: group.toLowerCase(),
        description: `View ${capitalizeGroup(group)} collection`
      }))
    }]
  };

  const initialMsg = await bot.createMessage(msg.channel.id, {
    content: `🔍 **Found ${groups.length} matching groups:**\n\n*Select a group from the dropdown below:*`,
    components: [selectMenu],
    messageReference: { messageID: msg.id }
  });

  setupGroupSelectionHandler(bot, msg, initialMsg, groups);
}

function setupGroupSelectionHandler(bot, msg, initialMsg, groups) {
  const listener = async (interaction) => {
    if (interaction.type !== 3) return;
    if (!interaction.data.custom_id.includes(`groupt_group_select_${msg.author.id}`)) return;

    try {
      await interaction.acknowledge();
      const selectedGroup = interaction.data.values[0];
      
      await initialMsg.delete().catch(() => {});
      await displayGroupCollection(bot, msg, [selectedGroup], selectedGroup);
      
      bot.removeListener('interactionCreate', listener);
    } catch (error) {
      console.error('Group selection error:', error);
      await interaction.createMessage({
        content: "⚠️ An error occurred. Please try again.",
        flags: 64
      }).catch(() => {});
    }
  };

  bot.on('interactionCreate', listener);

  setTimeout(() => {
    bot.removeListener('interactionCreate', listener);
    initialMsg.edit({
      components: [{
        type: 1,
        components: [{
          type: 3,
          custom_id: 'disabled',
          placeholder: 'This selection has expired',
          options: [],
          disabled: true
        }]
      }]
    }).catch(() => {});
  }, INTERACTION_TIMEOUT);
}

// ============================================================================
// GROUP COLLECTION DISPLAY
// ============================================================================

async function displayGroupCollection(bot, msg, groupNames, displayName) {
  const groupArray = Array.isArray(groupNames) ? groupNames : [groupNames];
  
  // FIX: Escape special regex characters in group names
  const groupRegexes = groupArray.map(g => 
    new RegExp(`^${searchUtils.escapeRegex(g)}$`, 'i')
  );

  const groupQuery = groupArray.length === 1 
    ? { group: groupRegexes[0] }
    : { $or: groupRegexes.map(regex => ({ group: regex })) };

  const userQuery = {
    discordId: msg.author.id,
    $or: groupRegexes.map(regex => ({ group: regex }))
  };

  const [allCards, userCards] = await Promise.all([
    Card.find(groupQuery).lean().sort({ rarity: 1, cardId: 1 }),
    User.find(userQuery).lean()
  ]);

  if (!allCards.length) {
    return bot.createMessage(msg.channel.id, {
      content: "📊 No cards found for that group.",
      messageReference: { messageID: msg.id }
    });
  }

  const cardsByRarity = groupCardsByRarity(allCards);
  const availableRarities = RARITY_ORDER.filter(r => cardsByRarity[r]?.length > 0);

  if (!availableRarities.length) {
    return bot.createMessage(msg.channel.id, {
      content: "📊 No cards found for that group.",
      messageReference: { messageID: msg.id }
    });
  }

  const overallSummary = generateOverallSummary(cardsByRarity, userCards);
  const collectionTitle = groupArray.length === 1 
    ? capitalizeGroup(groupArray[0])
    : `${capitalizeGroup(displayName)} Collection (${groupArray.length} groups)`;

  const selectMenu = createRaritySelectMenu(msg.author.id, availableRarities);

  const initialMsg = await bot.createMessage(msg.channel.id, {
    content: `📊 **${collectionTitle}**\n\n${overallSummary}\n\n*Select a rarity from the dropdown below:*`,
    components: [selectMenu],
    messageReference: { messageID: msg.id }
  });

  cleanupInteraction(bot, msg.author.id);

  activeInteractions.set(msg.author.id, {
    messageId: initialMsg.id,
    channelId: msg.channel.id,
    groupNames: groupArray,
    cardIds: null,
    cardsByRarity,
    userCards,
    availableRarities,
    collectionTitle,
    timestamp: Date.now()
  });

  setupInteractionHandler(bot, msg.author.id);

  setTimeout(() => {
    cleanupInteraction(bot, msg.author.id);
  }, INTERACTION_TIMEOUT);
}

function createRaritySelectMenu(userId, availableRarities, selectedRarity = null) {
  return {
    type: 1,
    components: [{
      type: 3,
      custom_id: `groupt_rarity_select_${userId}_${Date.now()}`,
      placeholder: selectedRarity 
        ? `Viewing ${selectedRarity} - Select another rarity`
        : 'Select a rarity to view',
      options: availableRarities.map(rarity => ({
        label: rarity,
        value: rarity.toLowerCase(),
        description: `View ${rarity} cards`,
        emoji: RARITY_EMOJIS[rarity] || { name: '📦' },
        default: rarity === selectedRarity
      }))
    }]
  };
}

// ============================================================================
// INTERACTION HANDLING
// ============================================================================

function setupInteractionHandler(bot, userId) {
  const existingData = activeInteractions.get(userId);
  if (existingData?.listener) {
    bot.removeListener('interactionCreate', existingData.listener);
  }

  const listener = async (interaction) => {
    if (interaction.type !== 3) return;
    if (!interaction.data.custom_id.includes(`groupt_rarity_select_${userId}`)) return;

    if (interaction.member.id !== userId) {
      return interaction.createMessage({
        content: "⚠️ This is not your collection view!",
        flags: 64
      }).catch(() => {});
    }

    const interactionData = activeInteractions.get(userId);
    if (!interactionData) {
      await interaction.acknowledge().catch(() => {});
      return;
    }

    try {
      await interaction.acknowledge();

      const selectedRarity = interaction.data.values[0];
      const rarityName = selectedRarity.charAt(0).toUpperCase() + selectedRarity.slice(1);
      const rarityCards = interactionData.cardsByRarity[rarityName];

      if (!rarityCards?.length) {
        return interaction.editParent({
          content: "⚠️ No cards found for this rarity.",
          components: []
        });
      }

      await interaction.editParent({
        content: `⏳ **Loading ${rarityName} cards...**`,
        components: []
      }).catch(() => {});

      const gridBuffer = await generateRarityGrid(
        rarityCards, 
        interactionData.userCards,
        interactionData.groupNames,
        interactionData.cardIds
      );

      if (!gridBuffer || !Buffer.isBuffer(gridBuffer)) {
        return interaction.editParent({
          content: "⚠️ Failed to generate card grid.",
          components: []
        });
      }

      const { ownedUnique, totalUnique } = calculateRarityStats(
        rarityCards,
        interactionData.userCards,
        rarityName
      );

      const selectMenu = createRaritySelectMenu(
        userId, 
        interactionData.availableRarities,
        rarityName
      );

      await bot.editMessage(interactionData.channelId, interactionData.messageId, {
        content: `📊 **${interactionData.collectionTitle}** • ${rarityName}\n\n**Collected:** ${ownedUnique}/${totalUnique}`,
        attachments: [],
        file: {
          file: gridBuffer,
          name: `${selectedRarity}_collection.png`
        },
        components: [selectMenu]
      });

    } catch (error) {
      console.error('Error handling interaction:', error);
      await interaction.editParent({
        content: "⚠️ An error occurred while loading the cards.",
        components: []
      }).catch(() => {});
    }
  };

  const data = activeInteractions.get(userId);
  if (data) {
    data.listener = listener;
  }

  bot.on('interactionCreate', listener);
}

function cleanupInteraction(bot, userId) {
  const data = activeInteractions.get(userId);
  if (!data) return;

  if (data.listener) {
    bot.removeListener('interactionCreate', data.listener);
  }

  if (data.channelId && data.messageId) {
    bot.editMessage(data.channelId, data.messageId, {
      components: [{
        type: 1,
        components: [{
          type: 3,
          custom_id: 'disabled',
          placeholder: 'This interaction has expired',
          options: [],
          disabled: true
        }]
      }]
    }).catch(() => {});
  }

  activeInteractions.delete(userId);
}

// ============================================================================
// IMAGE GENERATION
// ============================================================================

async function generateRarityGrid(cards, userCards, groupNames, cardIds) {
  const { maxCardsPerRow, cardWidth, cardHeight, padding, backgroundColor } = GRID_CONFIG;
  
  // Use cardIds if available (cosmic collection), otherwise use groupNames
  const filterContext = cardIds ? { cardIds } : { groupNames };

  const imagePromises = cards.map(card => 
    processCardImage(card, userCards, filterContext).catch(error => {
      console.error(`Failed to process card ${card.name}:`, error);
      return null;
    })
  );

  const processedImages = await Promise.all(imagePromises);
  const validImages = processedImages.filter(Boolean);

  if (!validImages.length) {
    throw new Error('No valid card images to display');
  }

  const { rows, rowLayout, totalWidth, totalHeight } = calculateGridLayout(validImages.length);
  const compositeOps = buildCompositeOperations(validImages, rowLayout, totalWidth);

  if (!compositeOps.length) {
    throw new Error('No images to composite');
  }

  return sharp({
    create: {
      width: totalWidth,
      height: totalHeight,
      channels: 4,
      background: backgroundColor
    }
  })
  .composite(compositeOps)
  .webp({ quality: 100, effort: 3 })
  .toBuffer();
}

function calculateGridLayout(numCards) {
  const { maxCardsPerRow, cardWidth, cardHeight, padding } = GRID_CONFIG;

  // Single row
  if (numCards <= maxCardsPerRow) {
    return {
      rows: 1,
      rowLayout: [numCards],
      totalWidth: (cardWidth * numCards) + (padding * (numCards - 1)),
      totalHeight: cardHeight
    };
  }

  // Two rows for 6-10 cards
  if (numCards <= 10) {
    const firstRow = Math.ceil(numCards / 2);
    const secondRow = numCards - firstRow;
    const maxCardsInRow = Math.max(firstRow, secondRow);

    return {
      rows: 2,
      rowLayout: [firstRow, secondRow],
      totalWidth: (cardWidth * maxCardsInRow) + (padding * (maxCardsInRow - 1)),
      totalHeight: (cardHeight * 2) + padding
    };
  }

  // Multiple rows
  const rows = Math.ceil(numCards / maxCardsPerRow);
  const cardsPerRow = Math.ceil(numCards / rows);
  const rowLayout = [];
  let remainingCards = numCards;

  for (let i = 0; i < rows; i++) {
    const cardsForThisRow = Math.min(cardsPerRow, remainingCards);
    rowLayout.push(cardsForThisRow);
    remainingCards -= cardsForThisRow;
  }

  const maxCardsInRow = Math.max(...rowLayout);

  return {
    rows,
    rowLayout,
    totalWidth: (cardWidth * maxCardsInRow) + (padding * (maxCardsInRow - 1)),
    totalHeight: (cardHeight * rows) + (padding * (rows - 1))
  };
}

function buildCompositeOperations(validImages, rowLayout, totalWidth) {
  const { cardWidth, cardHeight, padding } = GRID_CONFIG;
  const compositeOps = [];
  let currentImageIndex = 0;

  for (let rowIndex = 0; rowIndex < rowLayout.length; rowIndex++) {
    const cardsInRow = rowLayout[rowIndex];
    const rowWidth = (cardWidth * cardsInRow) + (padding * (cardsInRow - 1));
    const rowOffset = Math.round((totalWidth - rowWidth) / 2);

    for (let colIndex = 0; colIndex < cardsInRow; colIndex++) {
      if (currentImageIndex >= validImages.length) break;
      
      compositeOps.push({
        input: validImages[currentImageIndex],
        left: Math.round(rowOffset + (colIndex * (cardWidth + padding))),
        top: Math.round(rowIndex * (cardHeight + padding))
      });
      
      currentImageIndex++;
    }
  }

  return compositeOps;
}

async function processCardImage(card, userCards, filterContext) {
  const { groupNames, cardIds } = filterContext;

  // Condition hierarchy: pristine > mint > good > worn > damaged
  const CONDITION_PRIORITY = { 'pristine': 5, 'mint': 4, 'good': 3, 'worn': 2, 'damaged': 1 };

  let isOwned = false;
  let bestCondition = 'good';
  
  if (cardIds) {
    // Cosmic collection - match by cardId
    const matchingCards = userCards.filter(userCard => 
      userCard.cardId === card.cardId &&
      userCard.rarity.toLowerCase() === card.rarity.toLowerCase()
    );
    isOwned = matchingCards.length > 0;
    
    // Find the highest condition among owned copies
    if (isOwned) {
      for (const ownedCard of matchingCards) {
        const cond = ownedCard.condition?.toLowerCase() || 'good';
        if ((CONDITION_PRIORITY[cond] || 0) > (CONDITION_PRIORITY[bestCondition] || 0)) {
          bestCondition = cond;
        }
      }
    }
  } else {
    // Group collection - match by group
    const groupArray = Array.isArray(groupNames) ? groupNames : [groupNames];
    const matchingCards = userCards.filter(userCard => 
      userCard.imageURL === card.imageURL && 
      groupArray.some(g => userCard.group.toLowerCase() === g.toLowerCase()) &&
      userCard.rarity.toLowerCase() === card.rarity.toLowerCase()
    );
    isOwned = matchingCards.length > 0;
    
    // Find the highest condition among owned copies
    if (isOwned) {
      for (const ownedCard of matchingCards) {
        const cond = ownedCard.condition?.toLowerCase() || 'good';
        if ((CONDITION_PRIORITY[cond] || 0) > (CONDITION_PRIORITY[bestCondition] || 0)) {
          bestCondition = cond;
        }
      }
    }
  }

  // Apply overlay for all conditions including 'good'
  const overlayPromise = isOwned
    ? CardGenerationService.preloadOverlay(card.group, card.rarity, bestCondition, card.cardId)
    : Promise.resolve(null);

  const baseBuffer = await CardGenerationService.processCardImage(
    card,
    isOwned ? bestCondition : 'good',
    overlayPromise
  );

  if (!baseBuffer || !Buffer.isBuffer(baseBuffer)) {
    throw new Error('Invalid base buffer from CardGenerationService');
  }

  if (isOwned) {
    return baseBuffer;
  }

  // Apply grayscale effect for unowned cards
  return sharp(baseBuffer)
    .grayscale()
    .modulate({
      brightness: 0.7,
      saturation: 0.5
    })
    .composite([{
      input: Buffer.from([0, 0, 0, Math.floor(255 * (1 - UNOWNED_OPACITY))]),
      raw: { width: 1, height: 1, channels: 4 },
      tile: true,
      blend: 'dest-in'
    }])
    .toBuffer();
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function groupCardsByRarity(cards) {
  return cards.reduce((acc, card) => {
    const rarity = card.rarity.charAt(0).toUpperCase() + card.rarity.slice(1).toLowerCase();
    acc[rarity] = acc[rarity] || [];
    acc[rarity].push(card);
    return acc;
  }, {});
}

function generateOverallSummary(cardsByRarity, userCards) {
  return RARITY_ORDER
    .filter(rarity => cardsByRarity[rarity]?.length > 0)
    .map(rarity => {
      const { ownedUnique, totalUnique } = calculateRarityStats(
        cardsByRarity[rarity],
        userCards,
        rarity
      );
      return `**${rarity}**: ${ownedUnique}/${totalUnique}`;
    })
    .join('\n');
}

function calculateRarityStats(rarityCards, userCards, rarityName) {
  const totalUnique = rarityCards.length;
  const ownedUnique = new Set(
    userCards
      .filter(card => card.rarity.toLowerCase() === rarityName.toLowerCase())
      .map(card => card.imageURL)
  ).size;

  return { ownedUnique, totalUnique };
}

function capitalizeGroup(group) {
  // Check for IOTW format
  const iotwPattern = /^<:iotw(\d+):\d+>\s*(.*)/i;
  const match = group.match(iotwPattern);

  if (match) {
    const weekNumber = match[1];
    const restOfName = match[2].trim() || 'Idol of the Week';
    return `${restOfName} ${weekNumber}`;
  }

  // Standard capitalization
  return group
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}