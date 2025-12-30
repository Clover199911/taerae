const User = require("../../models/user");
const Graphic = require("../../models/graphic");
const { EMBED_COLORS, RARITY_EMOJIS, CONDITION_EMOJIS, BUTTON_CONFIGS } = require('../../config/embedConstants');
const searchAliases = require('../../config/searchAliases');

const PAGE_SIZE = 12;
const COLLECTOR_TIMEOUT = 300000; // 5 minutes
const activeCollectors = new Map();

module.exports = {
  name: "cabinet",
  description: "Displays your card collection",
  aliases: ["cab"],
  
  async execute(msg, args, client) {
    const authorId = msg.author.id;
    
    // Fast registration check
    const isRegistered = await Graphic.exists({ userId: authorId, isRegistered: true });
    if (!isRegistered) {
      return this.sendRegistrationMessage(msg, client);
    }

    try {
      const options = this.parseArguments(args, authorId);
      const targetUser = options.userId === authorId 
        ? msg.author 
        : await client.getRESTUser(options.userId).catch(() => null);
      
      if (!targetUser) {
        return msg.channel.createMessage("❌ User not found.");
      }

      const cards = await this.fetchUserCards(targetUser.id);
      if (!cards.length) {
        return msg.channel.createMessage("This user doesn't have any cards in their cabinet.");
      }

      const processedCards = this.processCards(cards, options);
      const pagination = this.calculatePagination(processedCards, options.page);
      
      const message = await this.sendCabinetEmbed(msg, client, processedCards, pagination, targetUser, options);
      this.setupInteractionHandler(client, message, authorId, processedCards, targetUser, options);
      
    } catch (error) {
      console.error("Cabinet error:", error);
      return msg.channel.createMessage("❌ An error occurred while displaying the cabinet.");
    }
  },

  parseArguments(args, defaultUserId) {
    const options = {
      searchTerms: [],
      excludeTerms: [],
      userId: defaultUserId,
      page: 1,
      showDuplicates: false
    };

    for (const arg of args) {
      if (arg.startsWith('<@')) {
        const match = arg.match(/\d+/);
        if (match) options.userId = match[0];
      } else if (/^(page:|p:|#)(\d+)$/i.test(arg)) {
        const pageNum = parseInt(arg.match(/(\d+)$/)[0]);
        options.page = pageNum > 0 ? pageNum : 1;
      } else if ([“duplicates”, “dupes”, “dupe”].includes(arg.toLowerCase())) {
        options.showDuplicates = true;
      } else if (arg.startsWith('-')) {
        options.excludeTerms.push(arg.slice(1).toLowerCase());
      } else {
        options.searchTerms.push(arg.toLowerCase());
      }
    }
    return options;
  },

  async fetchUserCards(userId) {
    return User.find({ discordId: userId })
      .select('name group rarity imageURL condition cardCode cardWellness')
      .lean();
  },

  processCards(cards, options) {
    let filtered = cards.filter(card => this.isValidCard(card));
    
    // Expand aliases in search terms
    const expandedSearchTerms = searchAliases.expandAll(options.searchTerms);
    const expandedExcludeTerms = searchAliases.expandAll(options.excludeTerms);
    
    // FIXED: Changed to AND logic - all search terms must match
    if (expandedSearchTerms.length) {
      filtered = filtered.filter(card => 
        expandedSearchTerms.every(term => this.cardMatchesTerm(card, term))
      );
    }
    
    if (expandedExcludeTerms.length) {
      filtered = filtered.filter(card => !this.matchesSearch(card, expandedExcludeTerms));
    }

    if (options.showDuplicates) {
      const duplicates = this.findDuplicates(filtered);
      filtered = filtered.filter(card => duplicates.has(card.imageURL));
    }

    return this.sortCards(filtered);
  },

  isValidCard(card) {
    return card?.name && card?.group && card?.rarity && card?.condition;
  },

  // NEW: Helper function to check if a card matches a single term
  cardMatchesTerm(card, term) {
    return card.name.toLowerCase().includes(term) ||
           card.group.toLowerCase().includes(term) ||
           card.rarity.toLowerCase().includes(term) ||
           card.condition.toLowerCase().includes(term) ||
           card.cardCode.toLowerCase().includes(term);
  },

  matchesSearch(card, terms) {
    return terms.some(term => 
      card.name.toLowerCase().includes(term) ||
      card.group.toLowerCase().includes(term) ||
      card.rarity.toLowerCase().includes(term) ||
      card.condition.toLowerCase().includes(term) ||
      card.cardCode.toLowerCase().includes(term)
    );
  },

  findDuplicates(cards) {
    const counts = new Map();
    cards.forEach(card => {
      const key = `${card.imageURL}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    
    return new Set([...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key]) => key));
  },

  sortCards(cards) {
    const RARITY_ORDER = { mythic: 4, glyph: 3, unique: 2, standard: 1 };
    const CONDITION_ORDER = { pristine: 1, mint: 2, good: 3, worn: 4, damaged: 5 };
    
    return [...cards].sort((a, b) => 
      RARITY_ORDER[b.rarity.toLowerCase()] - RARITY_ORDER[a.rarity.toLowerCase()] ||
      CONDITION_ORDER[a.condition.toLowerCase()] - CONDITION_ORDER[b.condition.toLowerCase()] ||
      a.group.localeCompare(b.group) ||
      a.name.localeCompare(b.name)
    );
  },

  calculatePagination(cards, page) {
    const totalPages = Math.max(1, Math.ceil(cards.length / PAGE_SIZE));
    const currentPage = Math.max(1, Math.min(page || 1, totalPages));
    return { currentPage, totalPages, pageSize: PAGE_SIZE };
  },

  async sendCabinetEmbed(msg, client, cards, pagination, targetUser, options) {
    const embed = this.buildEmbed(cards, pagination, targetUser, options);
    const components = this.createComponents(pagination);
    
    return client.createMessage(msg.channel.id, {
      embeds: [embed],
      components,
      messageReference: { messageID: msg.id }
    });
  },

  buildEmbed(cards, pagination, targetUser, options) {
    const start = (pagination.currentPage - 1) * PAGE_SIZE;
    const pageCards = cards.slice(start, start + PAGE_SIZE);
    const pristineCount = cards.filter(c => c.condition.toLowerCase() === 'pristine').length;

    // Build description instead of fields
    const description = this.buildCardDescription(pageCards);

    return {
      author: {
        name: `${targetUser.username}'s Cabinet ${options.showDuplicates ? "(Duplicates) " : ""}` +
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

  buildCardDescription(cards) {
    if (!cards.length) return 'No cards found for this page.';

    // Group by rarity
    const grouped = {};
    cards.forEach(card => {
      const rarityKey = card.rarity.toLowerCase();
      if (!grouped[rarityKey]) grouped[rarityKey] = [];
      grouped[rarityKey].push(card);
    });

    // Build description text
    let description = '';
    Object.entries(grouped).forEach(([rarity, cards]) => {
      const rarityEmoji = RARITY_EMOJIS[rarity] || '';
      description += `### ${rarityEmoji} ${rarity.toUpperCase()} (${cards.length} card${cards.length > 1 ? 's' : ''})\n`;
      
      cards.forEach(card => {
        const conditionEmoji = CONDITION_EMOJIS[card.condition.toLowerCase()] || '';
        description += `[${conditionEmoji}] **${card.group}** • ${card.name}—\`${card.cardCode}\`\n`;
      });
      
      description += '\n'; // Extra line between rarities
    });

    // Trim and check length (Discord max is 4096)
    description = description.trim();
    if (description.length > 4096) {
      description = description.slice(0, 4090) + '\n...';
    }

    return description;
  },

  createComponents(pagination) {
    const buttons = [
      { id: 'first', disabled: pagination.currentPage === 1, emoji: BUTTON_CONFIGS.first.emoji },
      { id: 'prev', disabled: pagination.currentPage === 1, emoji: BUTTON_CONFIGS.prev.emoji },
      { id: 'next', disabled: pagination.currentPage === pagination.totalPages, emoji: BUTTON_CONFIGS.next.emoji },
      { id: 'last', disabled: pagination.currentPage === pagination.totalPages, emoji: BUTTON_CONFIGS.last.emoji },
      { id: 'code_catalog', disabled: false, emoji: BUTTON_CONFIGS.code_catalog.emoji }
    ];

    return [{
      type: 1,
      components: buttons.map(btn => ({
        type: 2,
        style: 2,
        custom_id: btn.id,
        emoji: { id: btn.emoji },
        disabled: btn.disabled
      }))
    }];
  },

  setupInteractionHandler(client, message, authorId, cards, targetUser, options) {
    // Clean up existing collector
    const existing = activeCollectors.get(message.id);
    if (existing) {
      client.removeListener('interactionCreate', existing.handler);
      clearTimeout(existing.timeout);
    }

    const handler = async (interaction) => {
      if (interaction.message.id !== message.id || interaction.member?.id !== authorId) return;
      
      try {
        // CODE CATALOG - Ephemeral reply
        if (interaction.data.custom_id === 'code_catalog') {
          await interaction.defer(64); // Ephemeral defer
          await this.sendCodeCatalog(interaction, cards);
          return;
        }
        
        // PAGINATION - Edit original message directly (NO DEFER)
        const newPage = this.calculateNewPage(interaction, cards.length);
        const pagination = this.calculatePagination(cards, newPage);
        
        await this.updateMessage(interaction, cards, pagination, targetUser, options);
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
    };

    const timeout = setTimeout(() => {
      activeCollectors.delete(message.id);
      client.removeListener('interactionCreate', handler);
      message.edit({ components: [] }).catch(() => {});
    }, COLLECTOR_TIMEOUT);

    activeCollectors.set(message.id, { handler, timeout });
    client.on('interactionCreate', handler);
  },

  calculateNewPage(interaction, totalCards) {
    const customId = interaction.data.custom_id;
    const totalPages = Math.ceil(totalCards / PAGE_SIZE);
    
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

  async updateMessage(interaction, cards, pagination, targetUser, options) {
    const embed = this.buildEmbed(cards, pagination, targetUser, options);
    const components = this.createComponents(pagination);
    
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
    const codes = pageCards.map(c => c.cardCode).join(' ');

    await interaction.createFollowup({
      content: `**Card codes for Page ${currentPage}:**\n\`\`\`${codes || 'No codes'}\`\`\``,
      flags: 64 // Ephemeral
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
