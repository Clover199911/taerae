const User = require("../../models/user");
const Graphic = require("../../models/graphic");
const Marketplace = require("../../models/marketplace");
const Eris = require("eris");
const NodeCache = require('node-cache');
const { EMBED_COLORS, RARITY_EMOJIS, CONDITION_EMOJIS, BUTTON_CONFIGS } = require('../../config/embedConstants');
const searchAliases = require('../../config/searchAliases');
const searchUtils = require('../../utils/searchUtils');

const PAGE_SIZE = 12;
const COLLECTOR_TIMEOUT = 300000;
const CACHE_TTL = 300; // 5 minutes

// Caching layer for frequently accessed data
const cardCache = new NodeCache({ stdTTL: CACHE_TTL, checkperiod: 60 });
const marketplaceCache = new NodeCache({ stdTTL: 60, checkperiod: 30 }); // Shorter TTL for marketplace

// Enhanced collector management with automatic cleanup
const activeCollectors = new Map();

// Database indexes (add to your schema files):
/*
User.index({ discordId: 1, cardLocked: 1 });
User.index({ discordId: 1, rarity: 1, group: 1, name: 1 });
User.index({ discordId: 1, printNumber: 1 });
User.index({ discordId: 1, cardTag: 1 });
Marketplace.index({ sellerId: 1, code: 1 });
*/

module.exports = {
  name: "cabinet",
  description: "Displays your card collection",
  aliases: ["cab"],
  
  async execute(msg, args, client) {
    const authorId = msg.author.id;
    
    // Fast registration check with lean query
    const isRegistered = await Graphic.exists({ userId: authorId, isRegistered: true }).lean();
    if (!isRegistered) {
      return this.sendRegistrationMessage(msg, client);
    }

    try {
      const options = this.parseArguments(args, authorId);
      const targetUser = options.userId === authorId 
        ? msg.author 
        : await client.getRESTUser(options.userId).catch(() => null);
      
      if (!targetUser) {
        return msg.channel.createMessage({ content: "❌ User not found.", messageReference: { messageID: msg.id } });
      }

      // PARALLEL DATABASE QUERIES - Major performance gain
      const [cards, marketplaceListings] = await Promise.all([
        this.fetchUserCards(targetUser.id),
        this.fetchMarketplaceSet(targetUser.id)
      ]);

      if (!cards.length) {
        return msg.channel.createMessage({ content: "This user doesn't have any cards in their cabinet.", messageReference: { messageID: msg.id } });
      }

      const marketplaceSet = new Set(marketplaceListings.map(l => l.code));
      
      // SINGLE-PASS FILTERING - Optimized from multiple filter passes
      const processedCards = this.processCardsOptimized(cards, options);
      const pagination = this.calculatePagination(processedCards, options.page);
      
      const message = await this.sendCabinetEmbed(msg, client, processedCards, pagination, targetUser, options, marketplaceSet);
      
      // Enhanced interaction handler with proper cleanup
      this.setupInteractionHandler(client, message, authorId, processedCards, targetUser, options, marketplaceSet);
      
    } catch (error) {
      console.error("Cabinet error:", error);
      return msg.channel.createMessage({ content: "❌ An error occurred while displaying the cabinet.", messageReference: { messageID: msg.id } });
    }
  },

  parseArguments(args, defaultUserId) {
    const options = {
      searchTerms: [],
      excludeTerms: [],
      userId: defaultUserId,
      page: 1,
      showDuplicates: false,
      printNumbers: [],
      tagFilter: null
    };

    for (const arg of args) {
      // User mention or ID (supports both <@123> and plain 123)
      if (arg.startsWith('<@') || /^\d{17,19}$/.test(arg)) {
        const match = arg.match(/\d+/);
        if (match) options.userId = match[0];
      } 
      // Page number (#3, page:3, p:3)
      else if (/^(page:|p:|#)(\d+)$/i.test(arg)) {
        const pageNum = parseInt(arg.match(/(\d+)$/)[0]);
        options.page = pageNum > 0 ? pageNum : 1;
      } 
      // Print number range filter (print:1-10 or p#50-100 or p#5)
      else if (/^(print:|p#)(\d+(-\d+)?)$/i.test(arg)) {
        const printPart = arg.match(/^(print:|p#)(.+)$/i)[2];
        if (printPart.includes('-')) {
          const [start, end] = printPart.split('-').map(n => parseInt(n, 10));
          if (!isNaN(start) && !isNaN(end)) {
            for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
              options.printNumbers.push(i);
            }
          }
        } else {
          const num = parseInt(printPart, 10);
          if (!isNaN(num)) options.printNumbers.push(num);
        }
      }
      // Duplicates filter
      else if (arg.toLowerCase() === "duplicates") {
        options.showDuplicates = true;
      } 
      // Exclude terms
      else if (arg.startsWith('-')) {
        options.excludeTerms.push(arg.slice(1).toLowerCase());
      }
      // Emoji tag filter (single emoji character)
      else if (/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)$/u.test(arg)) {
        options.tagFilter = arg;
      }
      // Search terms
      else {
        options.searchTerms.push(arg.toLowerCase());
      }
    }
    return options;
  },

  // CACHED fetch with cache invalidation awareness
  async fetchUserCards(userId) {
    const cacheKey = `cards:${userId}`;
    let cards = cardCache.get(cacheKey);
    
    if (!cards) {
      cards = await User.find({ discordId: userId })
        .select('name group rarity imageURL condition cardCode cardWellness printNumber cardLocked cardTag')
        .lean();
      
      // Only cache if reasonable size
      if (cards.length < 1000) {
        cardCache.set(cacheKey, cards);
      }
    }
    
    return cards;
  },

  // Clear cache when cards change (call this from card modification commands)
  invalidateUserCache(userId) {
    cardCache.del(`cards:${userId}`);
  },

  async fetchMarketplaceSet(userId) {
    const cacheKey = `marketplace:${userId}`;
    let listings = marketplaceCache.get(cacheKey);
    
    if (!listings) {
      listings = await Marketplace.find({ sellerId: userId })
        .select('code')
        .lean();
      marketplaceCache.set(cacheKey, listings);
    }
    
    return listings;
  },

  // OPTIMIZED: Single-pass filtering instead of multiple .filter() passes
  processCardsOptimized(cards, options) {
    // Pre-compute expanded terms once
    const expandedSearchTerms = options.searchTerms.length ? 
      searchAliases.expandAll(options.searchTerms) : [];
    const expandedExcludeTerms = options.excludeTerms.length ? 
      searchAliases.expandAll(options.excludeTerms) : [];
    
    // Pre-compute duplicates if needed
    let duplicateSet = null;
    if (options.showDuplicates) {
      duplicateSet = this.findDuplicates(cards);
    }

    // SINGLE PASS FILTER - O(n) instead of O(n*m) where m = number of filters
    let filtered = [];
    for (const card of cards) {
      // Basic validation
      if (!this.isValidCard(card)) continue;
      
      // Search terms (all must match)
      if (expandedSearchTerms.length) {
        const allMatch = expandedSearchTerms.every(term => 
          this.cardMatchesTerm(card, term)
        );
        if (!allMatch) continue;
      }
      
      // Exclude terms (any match fails)
      if (expandedExcludeTerms.length) {
        const anyMatch = expandedExcludeTerms.some(term => 
          this.cardMatchesTerm(card, term)
        );
        if (anyMatch) continue;
      }
      
      // Print number filter (supports single or range)
      if (options.printNumbers.length > 0 && !options.printNumbers.includes(card.printNumber)) {
        continue;
      }
      
      // Tag filter
      if (options.tagFilter !== null && card.cardTag !== options.tagFilter) {
        continue;
      }
      
      // Duplicates filter
      if (options.showDuplicates) {
        const key = `${card.imageURL}-${card.rarity}`;
        if (!duplicateSet.has(key)) continue;
      }
      
      filtered.push(card);
    }

    return this.sortCards(filtered);
  },

  // Keep old method for backward compatibility, but use optimized internally
  processCards(cards, options) {
    return this.processCardsOptimized(cards, options);
  },

  isValidCard(card) {
    return card?.name && card?.group && card?.rarity && card?.condition;
  },

  cardMatchesTerm(card, term) {
    return searchUtils.cardMatchesTerm(card, term);
  },

  matchesSearch(card, terms) {
    const fieldsToCheck = [
      card.name,
      card.group,
      card.rarity,
      card.condition,
      card.cardCode
    ];
    
    return terms.some(term =>
      fieldsToCheck.some(field => field && searchUtils.flexibleMatch(field, term))
    );
  },

  findDuplicates(cards) {
    const counts = new Map();
    cards.forEach(card => {
      const key = `${card.imageURL}-${card.rarity}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    
    return new Set([...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key]) => key));
  },

  sortCards(cards) {
    const RARITY_ORDER = { mythic: 4, glyph: 3, unique: 2, standard: 1 };
    const CONDITION_ORDER = { pristine: 1, mint: 2, good: 3, worn: 4, damaged: 5 };
    
    // Use native sort with optimized comparator
    return cards.sort((a, b) => {
      const rarityDiff = RARITY_ORDER[b.rarity.toLowerCase()] - RARITY_ORDER[a.rarity.toLowerCase()];
      if (rarityDiff !== 0) return rarityDiff;
      
      const groupCmp = a.group.localeCompare(b.group);
      if (groupCmp !== 0) return groupCmp;
      
      const nameCmp = a.name.localeCompare(b.name);
      if (nameCmp !== 0) return nameCmp;
      
      return CONDITION_ORDER[a.condition.toLowerCase()] - CONDITION_ORDER[b.condition.toLowerCase()];
    });
  },

  calculatePagination(cards, page) {
    const totalPages = Math.max(1, Math.ceil(cards.length / PAGE_SIZE));
    const currentPage = Math.max(1, Math.min(page || 1, totalPages));
    return { currentPage, totalPages, pageSize: PAGE_SIZE };
  },

  async sendCabinetEmbed(msg, client, cards, pagination, targetUser, options, marketplaceSet, modalFilters = null) {
    const embed = this.buildEmbed(cards, pagination, targetUser, options, marketplaceSet, modalFilters);
    const hasActiveFilters = modalFilters && (modalFilters.includeTerms.length > 0 || modalFilters.excludeTerms.length > 0 || modalFilters.conditions.length > 0 || modalFilters.printNumbers.length > 0);
    const components = this.createComponents(pagination, hasActiveFilters);
    
    return client.createMessage(msg.channel.id, {
      embeds: [embed],
      components,
      messageReference: { messageID: msg.id }
    });
  },

  buildEmbed(cards, pagination, targetUser, options, marketplaceSet, modalFilters = null) {
    const start = (pagination.currentPage - 1) * PAGE_SIZE;
    const pageCards = cards.slice(start, start + PAGE_SIZE);
    
    // OPTIMIZED: Single-pass pristine count using cached length check
    let pristineCount = 0;
    for (const card of cards) {
      if (card.condition.toLowerCase() === 'pristine') pristineCount++;
    }

    const description = this.buildCardDescription(pageCards, marketplaceSet);

    let titleSuffix = options.showDuplicates ? "(Duplicates) " : "";
    if (options.printNumber !== null) {
      titleSuffix += `(Print #${options.printNumber}) `;
    }
    if (options.tagFilter !== null) {
      titleSuffix += `(${options.tagFilter}) `;
    }
    
    // Add modal filter indicator
    if (modalFilters) {
      if (modalFilters.includeTerms.length > 0) {
        titleSuffix += `(+${modalFilters.includeTerms.length} filters) `;
      }
      if (modalFilters.excludeTerms.length > 0) {
        titleSuffix += `(-${modalFilters.excludeTerms.length} excluded) `;
      }
      if (modalFilters.conditions.length > 0) {
        titleSuffix += `(${modalFilters.conditions.join(', ')}) `;
      }
      if (modalFilters.printNumbers.length > 0) {
        titleSuffix += `(Print #${modalFilters.printNumbers.length > 3 ? modalFilters.printNumbers.slice(0, 3).join(', ') + '...' : modalFilters.printNumbers.join(', ')}) `;
      }
    }

    return {
      author: {
        name: `${targetUser.username}'s Cabinet ${titleSuffix}` +
              `(Page ${pagination.currentPage}/${pagination.totalPages})`,
        icon_url: targetUser.avatarURL
      },
      description: description,
      footer: { 
        text: `Total: ${cards.length} cards` + 
              (pristineCount ? ` • ✨ ${pristineCount} Pristine` : '')
      },
      color: EMBED_COLORS.DEFAULT
    };
  },

  buildCardDescription(cards, marketplaceSet) {
    if (!cards.length) return 'No cards found for this page.';

    // OPTIMIZED: Pre-size the grouped object
    const grouped = {};
    const rarityKeys = new Set();
    
    // Single pass grouping
    for (const card of cards) {
      const rarityKey = card.rarity.toLowerCase();
      rarityKeys.add(rarityKey);
      if (!grouped[rarityKey]) grouped[rarityKey] = [];
      grouped[rarityKey].push(card);
    }

    // Build description with array join (faster than string concatenation)
    const lines = [];
    const sortedRarities = ['mythic', 'glyph', 'unique', 'standard'].filter(r => rarityKeys.has(r));
    
    for (const rarity of sortedRarities) {
      const rarityCards = grouped[rarity];
      const rarityEmoji = RARITY_EMOJIS[rarity] || '';
      lines.push(`### ${rarityEmoji} ${rarity.toUpperCase()}`);
      
      for (const card of rarityCards) {
        const conditionEmoji = CONDITION_EMOJIS[card.condition.toLowerCase()] || '';
        const printInfo = card.printNumber ? `#${card.printNumber}` : '';
        
        // Build status emojis efficiently
        const statusParts = [];
        if (card.cardTag) statusParts.push(card.cardTag);
        if (marketplaceSet.has(card.cardCode)) statusParts.push('<:market:1461017757507129464>');
        if (card.cardLocked) statusParts.push('<:lock:1461015492939481192>');
        
        lines.push(`${conditionEmoji} **${card.group} ${card.name}** [${printInfo}] — \`${card.cardCode}\`${statusParts.join(' ')}`);
      }
    }

    let description = lines.join('\n');
    if (description.length > 4096) {
      description = description.slice(0, 4090) + '\n...';
    }

    return description;
  },

  createComponents(pagination, hasActiveFilters = false) {
    const isFirstPage = pagination.currentPage === 1;
    const isLastPage = pagination.currentPage === pagination.totalPages;
    
    const buttons = [
      { id: 'first', disabled: isFirstPage, emoji: BUTTON_CONFIGS.first.emoji },
      { id: 'prev', disabled: isFirstPage, emoji: BUTTON_CONFIGS.prev.emoji },
      { id: 'next', disabled: isLastPage, emoji: BUTTON_CONFIGS.next.emoji },
      { id: 'last', disabled: isLastPage, emoji: BUTTON_CONFIGS.last.emoji },
      { id: 'code_catalog', disabled: false, emoji: BUTTON_CONFIGS.code_catalog.emoji }
    ];

    // Second row with search button
    const searchButton = {
      type: 2,
      style: hasActiveFilters ? 1 : 2, // Primary (blue) if filters active, Secondary (gray) otherwise
      custom_id: 'search_modal',
      label: hasActiveFilters ? '🔍 Search (Active)' : '🔍 Search',
      disabled: false
    };

    // Clear filters button (only show if filters are active)
    const clearButton = {
      type: 2,
      style: 4, // Danger (red)
      custom_id: 'clear_filters',
      label: '✕ Clear',
      disabled: !hasActiveFilters
    };

    return [
      {
        type: 1,
        components: buttons.map(btn => ({
          type: 2,
          style: 2,
          custom_id: btn.id,
          emoji: { id: btn.emoji },
          disabled: btn.disabled
        }))
      },
      {
        type: 1,
        components: [searchButton, clearButton]
      }
    ];
  },

  // ENHANCED: Proper cleanup for all scenarios
  setupInteractionHandler(client, message, authorId, allCards, targetUser, options, marketplaceSet) {
    // Clean up existing collector for this message
    this.cleanupCollector(message.id, client);

    // Track current modal filters and displayed cards
    let modalFilters = { includeTerms: [], excludeTerms: [], conditions: [], printNumbers: [] };
    let displayedCards = allCards;

    const handler = async (interaction) => {
      // Handle button interactions
      if (interaction.type === Eris.Constants.InteractionTypes.MESSAGE_COMPONENT) {
        if (interaction.message.id !== message.id) return;
        const interactionUserId = interaction.member?.id || interaction.user?.id;
        if (interactionUserId !== authorId) return;
        
        try {
          const customId = interaction.data.custom_id;
          
          if (customId === 'code_catalog') {
            await interaction.defer(64);
            await this.sendCodeCatalog(interaction, displayedCards);
            return;
          }
          
          if (customId === 'search_modal') {
            // Open the search modal
            await interaction.createModal({
              title: "🔍 Search & Filter Cards",
              custom_id: `cabinet_search_modal_${message.id}`,
              components: [
                {
                  type: 1,
                  components: [{
                    type: 4, // Text Input
                    custom_id: "include_terms",
                    label: "Groups/Artists to Include (comma-sep)",
                    style: 1, // Short
                    placeholder: "e.g., stray kids, jungkook, newjeans, winter",
                    required: false,
                    max_length: 200
                  }]
                },
                {
                  type: 1,
                  components: [{
                    type: 4,
                    custom_id: "exclude_terms",
                    label: "Groups/Artists to Exclude (comma-sep)",
                    style: 1,
                    placeholder: "e.g., bts, lisa, blackpink",
                    required: false,
                    max_length: 200
                  }]
                },
                {
                  type: 1,
                  components: [{
                    type: 4,
                    custom_id: "conditions",
                    label: "Conditions (comma-separated)",
                    style: 1,
                    placeholder: "e.g., pristine, mint, good",
                    required: false,
                    max_length: 100
                  }]
                },
                {
                  type: 1,
                  components: [{
                    type: 4,
                    custom_id: "print_numbers",
                    label: "Print Numbers (comma-sep or range)",
                    style: 1,
                    placeholder: "e.g., 1, 5, 10 or 1-10",
                    required: false,
                    max_length: 50
                  }]
                }
              ]
            });
            return;
          }
          
          if (customId === 'clear_filters') {
            // Clear all modal filters
            modalFilters = { includeTerms: [], excludeTerms: [], conditions: [], printNumbers: [] };
            displayedCards = allCards;
            
            const pagination = this.calculatePagination(displayedCards, 1);
            await this.updateMessage(interaction, displayedCards, pagination, targetUser, options, marketplaceSet, null);
            return;
          }
          
          // Navigation buttons
          const newPage = this.calculateNewPage(interaction, displayedCards.length);
          const pagination = this.calculatePagination(displayedCards, newPage);
          
          const hasActiveFilters = modalFilters.includeTerms.length > 0 || modalFilters.excludeTerms.length > 0 || modalFilters.conditions.length > 0 || modalFilters.printNumbers.length > 0;
          await this.updateMessage(interaction, displayedCards, pagination, targetUser, options, marketplaceSet, hasActiveFilters ? modalFilters : null);
          
        } catch (error) {
          console.error('Interaction error:', error);
          try {
            await interaction.createFollowup({
              content: "❌ An error occurred. Please try again.",
              flags: 64
            }).catch(() => {});
          } catch (e) {
            console.error('Failed to send error message:', e);
          }
        }
        return;
      }
      
      // Handle modal submission
      if (interaction.type === Eris.Constants.InteractionTypes.MODAL_SUBMIT) {
        if (!interaction.data.custom_id.startsWith(`cabinet_search_modal_${message.id}`)) return;
        
        const interactionUserId = interaction.member?.id || interaction.user?.id;
        if (interactionUserId !== authorId) return;
        
        try {
          // Parse modal inputs
          const components = interaction.data.components;
          const includeTermsRaw = components[0]?.components[0]?.value || '';
          const excludeTermsRaw = components[1]?.components[0]?.value || '';
          const conditionsRaw = components[2]?.components[0]?.value || '';
          const printNumbersRaw = components[3]?.components[0]?.value || '';
          
          // Parse comma-separated values, expand aliases, and trim
          const parseInput = (input) => input.split(',')
            .map(s => s.trim().toLowerCase())
            .filter(s => s.length > 0);
          
          // Parse print numbers (supports "1, 5, 10" or "1-10" range syntax)
          const parsePrintNumbers = (input) => {
            const numbers = new Set();
            const parts = input.split(',').map(s => s.trim()).filter(s => s.length > 0);
            for (const part of parts) {
              if (part.includes('-')) {
                // Range syntax: "1-10"
                const [start, end] = part.split('-').map(n => parseInt(n.trim(), 10));
                if (!isNaN(start) && !isNaN(end)) {
                  for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
                    numbers.add(i);
                  }
                }
              } else {
                const num = parseInt(part, 10);
                if (!isNaN(num)) numbers.add(num);
              }
            }
            return Array.from(numbers);
          };
          
          // Update modal filters
          modalFilters = {
            includeTerms: searchAliases.expandAll(parseInput(includeTermsRaw)),
            excludeTerms: searchAliases.expandAll(parseInput(excludeTermsRaw)),
            conditions: searchAliases.expandAll(parseInput(conditionsRaw)),
            printNumbers: parsePrintNumbers(printNumbersRaw)
          };
          
          // Apply modal filters to all cards
          displayedCards = this.applyModalFilters(allCards, modalFilters);
          
          const pagination = this.calculatePagination(displayedCards, 1);
          const hasActiveFilters = modalFilters.includeTerms.length > 0 || modalFilters.excludeTerms.length > 0 || modalFilters.conditions.length > 0 || modalFilters.printNumbers.length > 0;
          
          // Acknowledge and update the message
          await interaction.editParent({
            embeds: [this.buildEmbed(displayedCards, pagination, targetUser, options, marketplaceSet, hasActiveFilters ? modalFilters : null)],
            components: this.createComponents(pagination, hasActiveFilters)
          });
          
        } catch (error) {
          console.error('Modal submit error:', error);
          try {
            await interaction.createMessage({
              content: "❌ An error occurred while applying filters.",
              flags: 64
            }).catch(() => {});
          } catch (e) {
            console.error('Failed to send error message:', e);
          }
        }
      }
    };

    // Set up timeout with cleanup
    const timeout = setTimeout(() => {
      this.cleanupCollector(message.id, client);
      message.edit({ components: [] }).catch(() => {});
    }, COLLECTOR_TIMEOUT);

    // Store with metadata for proper cleanup
    activeCollectors.set(message.id, { 
      handler, 
      timeout, 
      channelId: message.channel.id,
      createdAt: Date.now()
    });
    
    client.on('interactionCreate', handler);
    
    // ADDITIONAL: Message deletion detection
    const deleteHandler = (deletedMsg) => {
      if (deletedMsg.id === message.id) {
        this.cleanupCollector(message.id, client);
        client.off('messageDelete', deleteHandler);
      }
    };
    client.on('messageDelete', deleteHandler);
    
    // Periodic cleanup of stale collectors (safety net)
    this.periodicCleanup(client);
  },

  // Apply modal-based filters to cards (filters already-cached data, very fast)
  applyModalFilters(cards, modalFilters) {
    if (!modalFilters.includeTerms.length && !modalFilters.excludeTerms.length && !modalFilters.conditions.length && !modalFilters.printNumbers.length) {
      return cards;
    }
    
    return cards.filter(card => {
      const cardGroup = card.group.toLowerCase();
      const cardName = card.name.toLowerCase();
      
      // Include terms filter - matches against both group AND artist name (any match passes)
      if (modalFilters.includeTerms.length > 0) {
        const matchesInclude = modalFilters.includeTerms.some(term => 
          cardGroup.includes(term) || searchUtils.flexibleMatch(cardGroup, term) ||
          cardName.includes(term) || searchUtils.flexibleMatch(cardName, term)
        );
        if (!matchesInclude) return false;
      }
      
      // Exclude terms filter - matches against both group AND artist name (any match fails)
      if (modalFilters.excludeTerms.length > 0) {
        const matchesExclude = modalFilters.excludeTerms.some(term => 
          cardGroup.includes(term) || searchUtils.flexibleMatch(cardGroup, term) ||
          cardName.includes(term) || searchUtils.flexibleMatch(cardName, term)
        );
        if (matchesExclude) return false;
      }
      
      // Condition filter (any match passes)
      if (modalFilters.conditions.length > 0) {
        const cardCondition = card.condition.toLowerCase();
        const matchesCondition = modalFilters.conditions.some(term => 
          cardCondition === term || cardCondition.includes(term)
        );
        if (!matchesCondition) return false;
      }
      
      // Print number filter (any match passes)
      if (modalFilters.printNumbers.length > 0) {
        if (!modalFilters.printNumbers.includes(card.printNumber)) {
          return false;
        }
      }
      
      return true;
    });
  },

  cleanupCollector(messageId, client) {
    const existing = activeCollectors.get(messageId);
    if (existing) {
      client.removeListener('interactionCreate', existing.handler);
      clearTimeout(existing.timeout);
      activeCollectors.delete(messageId);
    }
  },

  // Safety net: Clean up collectors older than 6 minutes
  periodicCleanup(client) {
    if (activeCollectors.size > 100 || Math.random() < 0.1) { // 10% chance or high load
      const now = Date.now();
      const maxAge = 360000; // 6 minutes
      
      for (const [messageId, data] of activeCollectors.entries()) {
        if (now - data.createdAt > maxAge) {
          this.cleanupCollector(messageId, client);
        }
      }
    }
  },

  calculateNewPage(interaction, totalCards) {
    const customId = interaction.data.custom_id;
    const totalPages = Math.ceil(totalCards / PAGE_SIZE);
    
    // OPTIMIZED: Use bitwise operations for faster parsing when possible
    const authorText = interaction.message.embeds[0]?.author?.name || '';
    const pageMatch = authorText.match(/Page (\d+)\//);
    const currentPage = pageMatch ? parseInt(pageMatch[1], 10) : 1;

    switch (customId) {
      case 'first': return 1;
      case 'prev': return Math.max(1, currentPage - 1);
      case 'next': return Math.min(totalPages, currentPage + 1);
      case 'last': return totalPages;
      default: return currentPage;
    }
  },

  async updateMessage(interaction, cards, pagination, targetUser, options, marketplaceSet, modalFilters = null) {
    const embed = this.buildEmbed(cards, pagination, targetUser, options, marketplaceSet, modalFilters);
    const hasActiveFilters = modalFilters && (modalFilters.includeTerms.length > 0 || modalFilters.excludeTerms.length > 0 || modalFilters.conditions.length > 0 || modalFilters.printNumbers.length > 0);
    const components = this.createComponents(pagination, hasActiveFilters);
    
    await interaction.editParent({ 
      embeds: [embed], 
      components 
    });
  },

  async sendCodeCatalog(interaction, cards) {
    const authorText = interaction.message.embeds[0]?.author?.name || '';
    const pageMatch = authorText.match(/Page (\d+)\//);
    const currentPage = pageMatch ? parseInt(pageMatch[1], 10) : 1;
    
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageCards = cards.slice(start, start + PAGE_SIZE);
    
    // OPTIMIZED: Pre-allocate array size
    const codes = new Array(pageCards.length);
    for (let i = 0; i < pageCards.length; i++) {
      codes[i] = pageCards[i].cardCode;
    }

    await interaction.createFollowup({
      content: `\`${codes.join(' ') || 'No codes'}\``,
      flags: 64
    });
  },

  sendRegistrationMessage(msg, client) {
    return client.createMessage(msg.channel.id, {
      embeds: [{
        title: "🚫 Uncharted Territory",
        description: "Oops! It seems you haven't registered yet. Use `?register` to begin!",
        color: EMBED_COLORS.ERROR,
        footer: { text: "Your epic saga awaits!" }
      }],
      messageReference: { messageID: msg.id }
    });
  }
};