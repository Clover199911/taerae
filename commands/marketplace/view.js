// marketplace/view.js – Marketplace browsing with cabinet-style display
// Displays paginated marketplace listings with search functionality
// ============================================================================

const Marketplace = require("../../models/marketplace");
const User = require("../../models/user");
const { EMBED_COLORS, RARITY_EMOJIS, CONDITION_EMOJIS, BUTTON_CONFIGS, MARKETPLACE_EMOJIS } = require("../../config/embedConstants");
const searchAliases = require("../../config/searchAliases");
const searchUtils = require("../../utils/searchUtils");

const PAGE_SIZE = 10;
const COLLECTOR_TIMEOUT = 300000; // 5 minutes
const activeCollectors = new Map();

// ============================================================================
// FILTER PARSING (Cabinet-style)
// ============================================================================

/**
 * Parses command arguments into search filters
 * Supports: search terms, exclusions (-term), user mentions, page numbers
 */
const parseFilters = (args) => {
  const filters = {
    searchTerms: [],
    excludeTerms: [],
    userId: null,
    page: 1,
    printNumber: null
  };

  for (const arg of args) {
    // User mention or ID
    if (arg.startsWith('<@') || /^\d{17,19}$/.test(arg)) {
      const match = arg.match(/\d+/);
      if (match) filters.userId = match[0];
    }
    // Page number (#3, page:3, p:3)
    else if (/^(page:|p:|#)(\d+)$/i.test(arg)) {
      const pageNum = parseInt(arg.match(/(\d+)$/)[0]);
      filters.page = pageNum > 0 ? pageNum : 1;
    }
    // Print number filter (print:3 or p#3)
    else if (/^(print:|p#)(\d+)$/i.test(arg)) {
      filters.printNumber = parseInt(arg.match(/(\d+)$/)[0]);
    }
    // Exclude terms
    else if (arg.startsWith('-')) {
      filters.excludeTerms.push(arg.slice(1).toLowerCase());
    }
    // Search terms
    else {
      filters.searchTerms.push(arg.toLowerCase());
    }
  }

  return filters;
};

// ============================================================================
// CARD MATCHING
// ============================================================================

/**
 * Checks if a card matches the search criteria
 */
const cardMatchesFilters = (card, cardDetails, filters) => {
  // Expand aliases for search terms
  const expandedSearchTerms = searchAliases.expandAll(filters.searchTerms);
  const expandedExcludeTerms = searchAliases.expandAll(filters.excludeTerms);

  // All search terms must match
  if (expandedSearchTerms.length) {
    const allMatch = expandedSearchTerms.every(term => {
      return searchUtils.cardMatchesTerm(cardDetails, term);
    });
    if (!allMatch) return false;
  }

  // No exclude terms should match
  if (expandedExcludeTerms.length) {
    const anyMatch = expandedExcludeTerms.some(term => {
      return searchUtils.cardMatchesTerm(cardDetails, term);
    });
    if (anyMatch) return false;
  }

  // User filter
  if (filters.userId && card.sellerId !== filters.userId) {
    return false;
  }

  // Print number filter
  if (filters.printNumber !== null && cardDetails.printNumber !== filters.printNumber) {
    return false;
  }

  return true;
};

// ============================================================================
// VIEW HANDLER
// ============================================================================

module.exports = {
  async execute(msg, args, client) {
    try {
      const filters = parseFilters(args);

      // OPTIMIZED: Use aggregation with $lookup instead of separate queries
      // This fetches listings with card details in a single database round-trip
      const pipeline = [
        // Match stage (can add user filter here if needed)
        ...(filters.userId ? [{ $match: { sellerId: filters.userId } }] : []),
        // Join with user cards collection to get card details
        {
          $lookup: {
            from: 'users',
            localField: 'code',
            foreignField: 'cardCode',
            as: 'cardDetails'
          }
        },
        // Unwind the joined data (1:1 relationship)
        { $unwind: { path: '$cardDetails', preserveNullAndEmptyArrays: false } },
        // Sort by rarity (descending) then price (ascending)
        {
          $addFields: {
            rarityOrder: {
              $switch: {
                branches: [
                  { case: { $eq: [{ $toLower: '$cardDetails.rarity' }, 'mythic'] }, then: 4 },
                  { case: { $eq: [{ $toLower: '$cardDetails.rarity' }, 'glyph'] }, then: 3 },
                  { case: { $eq: [{ $toLower: '$cardDetails.rarity' }, 'unique'] }, then: 2 }
                ],
                default: 1
              }
            }
          }
        },
        { $sort: { rarityOrder: -1, amount: 1 } },
        // Limit to reasonable max for performance (500 listings max)
        { $limit: 500 }
      ];

      const listingsWithDetails = await Marketplace.aggregate(pipeline);

      if (listingsWithDetails.length === 0) {
        return msg.channel.createMessage({
          embeds: [{
            title: `${MARKETPLACE_EMOJIS.marketplace} Marketplace`,
            description: `No listings available right now.\n\n${MARKETPLACE_EMOJIS.tip} **Be the first!** Use \`?market sell <code> <price>\` to list a card.`,
            color: EMBED_COLORS.DEFAULT
          }],
          messageReference: { messageID: msg.id }
        });
      }

      // Build cardDetailsMap from aggregated results
      const cardDetailsMap = new Map();
      listingsWithDetails.forEach(item => {
        cardDetailsMap.set(item.code, item.cardDetails);
      });

      // Filter listings based on search criteria (in-memory, but on limited dataset)
      const filteredListings = listingsWithDetails.filter(item => {
        return cardMatchesFilters(item, item.cardDetails, filters);
      });

      if (filteredListings.length === 0) {
        return msg.channel.createMessage({
          embeds: [{
            title: `${MARKETPLACE_EMOJIS.marketplace} Marketplace`,
            description: `No listings match your search.\n\n${MARKETPLACE_EMOJIS.tip} **Try:**\n• Removing filters\n• Different search terms\n• \`?market help\` for search examples`,
            color: EMBED_COLORS.DEFAULT
          }],
          messageReference: { messageID: msg.id }
        });
      }

      // Calculate pagination
      const totalPages = Math.ceil(filteredListings.length / PAGE_SIZE);
      const currentPage = Math.max(1, Math.min(filters.page, totalPages));

      // Send initial embed
      const message = await sendMarketplaceEmbed(
        msg, 
        client, 
        filteredListings, 
        cardDetailsMap, 
        currentPage, 
        totalPages,
        filters
      );

      // Setup pagination if multiple pages
      if (totalPages > 1) {
        setupPagination(
          client, 
          message, 
          msg.author.id, 
          filteredListings, 
          cardDetailsMap, 
          totalPages,
          filters
        );
      }

    } catch (error) {
      console.error("View marketplace error:", error);
      return msg.channel.createMessage({
        embeds: [{
          title: `${MARKETPLACE_EMOJIS.error} Error`,
          description: `Failed to load marketplace.\n\n${MARKETPLACE_EMOJIS.tip} **What to do:**\n• Try again in a moment\n• Contact a server admin if this continues`,
          color: EMBED_COLORS.ERROR
        }],
        messageReference: { messageID: msg.id }
      });
    }
  }
};

// ============================================================================
// EMBED GENERATION (CABINET STYLE)
// ============================================================================

/**
 * Builds the marketplace embed for a specific page (cabinet-style)
 */
const buildMarketplaceEmbed = (listings, cardDetailsMap, page, totalPages, filters) => {
  const start = (page - 1) * PAGE_SIZE;
  const pageListings = listings.slice(start, start + PAGE_SIZE);

  // Group by rarity (like cabinet)
  const grouped = {};
  pageListings.forEach(listing => {
    const cardDetails = cardDetailsMap.get(listing.code);
    if (!cardDetails) return;

    const rarityKey = cardDetails.rarity.toLowerCase();
    if (!grouped[rarityKey]) grouped[rarityKey] = [];
    grouped[rarityKey].push({ listing, cardDetails });
  });

  // Build description with rarity headers
  let description = '';
  const rarityOrder = ['mythic', 'glyph', 'unique', 'standard'];
  
  const MAX_DESC_LENGTH = 3500; // Safe margin below 4096 Discord limit
  let truncated = false;

  for (const rarity of rarityOrder) {
    if (truncated) break;
    if (!grouped[rarity]) continue;
    
    const rarityEmoji = RARITY_EMOJIS[rarity] || '';
    const header = `### ${rarityEmoji} ${rarity.toUpperCase()}\n`;
    
    if (description.length + header.length > MAX_DESC_LENGTH) {
      truncated = true;
      break;
    }
    description += header;
    
    for (const { listing, cardDetails } of grouped[rarity]) {
      const conditionEmoji = CONDITION_EMOJIS[cardDetails.condition.toLowerCase()] || '';
      const printInfo = cardDetails.printNumber ? `#${cardDetails.printNumber}` : '';
      
      const line = `${conditionEmoji} **${cardDetails.group} ${cardDetails.name}** [${printInfo}] — \`${listing.code}\` — **${listing.amount.toLocaleString()}** ${MARKETPLACE_EMOJIS.crystal} by <@${listing.sellerId}>\n`;
      
      if (description.length + line.length > MAX_DESC_LENGTH) {
        truncated = true;
        break;
      }
      description += line;
    }
  }
  
  if (truncated) {
    description += `\n*... more listings on next pages*`;
  }

  // Build title suffix for filters
  let titleSuffix = '';
  if (filters.printNumber !== null) {
    titleSuffix += ` (Print #${filters.printNumber})`;
  }
  if (filters.userId) {
    titleSuffix += ` (Filtered by user)`;
  }

  return {
    title: `${MARKETPLACE_EMOJIS.marketplace} Marketplace${titleSuffix} (Page ${page}/${totalPages})`,
    description: description.trim() || "No listings found.",
    color: EMBED_COLORS.DEFAULT,
    footer: { 
      text: `${listings.length} listings • Use ?market buy <code> to purchase` 
    }
  };
};

/**
 * Sends marketplace embed message
 */
const sendMarketplaceEmbed = async (msg, client, listings, cardDetailsMap, page, totalPages, filters) => {
  const embed = buildMarketplaceEmbed(listings, cardDetailsMap, page, totalPages, filters);
  const components = totalPages > 1 ? createPaginationButtons(page, totalPages) : [];

  return client.createMessage(msg.channel.id, {
    embeds: [embed],
    components,
    messageReference: { messageID: msg.id }
  });
};

// ============================================================================
// PAGINATION
// ============================================================================

/**
 * Creates pagination button components
 */
const createPaginationButtons = (page, totalPages) => {
  return [{
    type: 1,
    components: [
      {
        type: 2,
        style: 2,
        custom_id: "first",
        emoji: { id: BUTTON_CONFIGS.first.emoji },
        disabled: page === 1
      },
      {
        type: 2,
        style: 2,
        custom_id: "prev",
        emoji: { id: BUTTON_CONFIGS.prev.emoji },
        disabled: page === 1
      },
      {
        type: 2,
        style: 2,
        custom_id: "next",
        emoji: { id: BUTTON_CONFIGS.next.emoji },
        disabled: page === totalPages
      },
      {
        type: 2,
        style: 2,
        custom_id: "last",
        emoji: { id: BUTTON_CONFIGS.last.emoji },
        disabled: page === totalPages
      }
    ]
  }];
};

/**
 * Sets up pagination interaction handler
 */
const setupPagination = (client, message, authorId, listings, cardDetailsMap, totalPages, filters) => {
  // Clean up existing collector if any
  const existing = activeCollectors.get(message.id);
  if (existing) {
    client.removeListener('interactionCreate', existing.handler);
    clearTimeout(existing.timeout);
  }

  let currentPage = 1;

  const handler = async (interaction) => {
    if (interaction.message.id !== message.id || interaction.member?.id !== authorId) return;

    try {
      // Calculate new page
      const customId = interaction.data.custom_id;
      switch (customId) {
        case 'first':
          currentPage = 1;
          break;
        case 'prev':
          currentPage = Math.max(1, currentPage - 1);
          break;
        case 'next':
          currentPage = Math.min(totalPages, currentPage + 1);
          break;
        case 'last':
          currentPage = totalPages;
          break;
        default:
          return;
      }

      // Update embed
      const embed = buildMarketplaceEmbed(listings, cardDetailsMap, currentPage, totalPages, filters);
      const components = createPaginationButtons(currentPage, totalPages);

      await interaction.editParent({
        embeds: [embed],
        components
      });

    } catch (error) {
      console.error('Pagination error:', error);
    }
  };

  // Setup timeout
  const timeout = setTimeout(() => {
    activeCollectors.delete(message.id);
    client.removeListener('interactionCreate', handler);
    message.edit({ components: [] }).catch(() => {});
  }, COLLECTOR_TIMEOUT);

  activeCollectors.set(message.id, { handler, timeout });
  client.on('interactionCreate', handler);
};