// tag.js - Tag cards with emojis for organization
const User = require("../models/user");
const { EMBED_COLORS, RARITY_EMOJIS, CONDITION_EMOJIS } = require('../config/embedConstants');

const COLLECTOR_TIMEOUT = 60000; // 1 minute
const activeCollectors = new Map();

// Regex to detect Unicode emojis (not custom Discord emojis)
const EMOJI_REGEX = /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)$/u;

module.exports = {
  name: "tag",
  aliases: ["tg"],
  description: "Tag cards with emojis for organization",

  async execute(msg, args, client) {
    const userId = msg.author.id;

    // Handle subcommands
    if (args.length && args[0].toLowerCase() === 'all') {
      return this.showAllTags(msg, client, userId);
    }

    if (args.length && (args[0].toLowerCase() === 'remove' || args[0].toLowerCase() === 'r')) {
      return this.removeTagsCommand(msg, client, userId, args.slice(1));
    }

    // Main tagging command
    if (args.length < 2) {
      return msg.channel.createMessage({
        content: "Usage:\n" +
                 "`?tag <emoji> <cardCode> [cardCode2]...` - Tag cards\n" +
                 "`?tag remove <cardCode> [cardCode2]...` - Remove tags\n" +
                 "`?tag all` - View all your tags",
        messageReference: { messageID: msg.id }
      });
    }

    const emoji = args[0];
    
    // Validate emoji (must be standard Unicode emoji, not custom)
    if (!this.isValidEmoji(emoji)) {
      return msg.channel.createMessage({
        content: "❌ Please use a standard emoji (not custom Discord emojis).\nExample: `?tag ⭐ ABC123`",
        messageReference: { messageID: msg.id }
      });
    }

    const cardCodes = args.slice(1);

    try {
      // Fetch all cards in one query
      const cards = await User.find({ 
        discordId: userId, 
        cardCode: { $in: cardCodes }
      }).lean();

      // Map found cards by cardCode for quick lookup
      const cardMap = new Map(cards.map(card => [card.cardCode, card]));

      // Build ordered card list (preserving user's order)
      const orderedCards = cardCodes.map(code => {
        const card = cardMap.get(code);
        return card ? { ...card, found: true } : { cardCode: code, found: false };
      });

      // Build and send embed
      const embed = this.buildEmbed(orderedCards, msg.author, emoji);
      const components = this.createComponents();

      const message = await client.createMessage(msg.channel.id, {
        embeds: [embed],
        components,
        messageReference: { messageID: msg.id }
      });

      // Setup button handler
      this.setupInteractionHandler(client, message, userId, orderedCards, emoji);

    } catch (error) {
      console.error("Tag command error:", error);
      return msg.channel.createMessage({
        content: "❌ An error occurred. Please try again.",
        messageReference: { messageID: msg.id }
      });
    }
  },

  isValidEmoji(str) {
    // Check if it's a custom Discord emoji (has <:name:id> format)
    if (str.startsWith('<') && str.includes(':')) {
      return false;
    }
    
    // Check if it's a valid Unicode emoji
    return EMOJI_REGEX.test(str);
  },

  buildEmbed(orderedCards, author, emoji) {
    let description = '';

    orderedCards.forEach(card => {
      if (!card.found) {
        description += `❌ **Not Found** — \`${card.cardCode}\`\n`;
      } else {
        const lockEmoji = card.cardLocked ? '<:lock:1461015492939481192>' : '';
        const currentTag = card.cardTag || '';
        const rarityEmoji = RARITY_EMOJIS[card.rarity.toLowerCase()] || '';
        const printInfo = card.printNumber ? `#${card.printNumber}` : '';
        
        // Show current tag if exists
        const tagStatus = currentTag ? ` (currently: ${currentTag})` : '';
        
        description += `${lockEmoji} ${rarityEmoji} **${card.group} ${card.name}** ${printInfo} — \`${card.cardCode}\`${tagStatus}\n`;
      }
    });

    return {
      author: {
        name: `${author.username}'s Tagging ${emoji}`,
        icon_url: author.avatarURL
      },
      description: description.trim(),
      footer: { 
        text: `${orderedCards.filter(c => c.found).length}/${orderedCards.length} cards found`
      },
      color: EMBED_COLORS.DEFAULT
    };
  },

  createComponents() {
    return [{
      type: 1,
      components: [
        {
          type: 2,
          style: 3,
          custom_id: 'apply_tag',
          label: 'Apply Tag',
          emoji: { name: '🏷️' }
        },
        {
          type: 2,
          style: 4,
          custom_id: 'cancel_tag',
          label: 'Cancel',
          emoji: { name: '❌' }
        }
      ]
    }];
  },

  setupInteractionHandler(client, message, authorId, orderedCards, emoji) {
    // Clear existing collector if any
    const existing = activeCollectors.get(message.id);
    if (existing) {
      client.removeListener('interactionCreate', existing.handler);
      clearTimeout(existing.timeout);
    }

    const handler = async (interaction) => {
      if (interaction.message.id !== message.id || interaction.member?.id !== authorId) return;
      
      try {
        await interaction.defer(64); // Ephemeral defer

        if (interaction.data.custom_id === 'cancel_tag') {
          await interaction.message.edit({ 
            components: [] 
          });
          await interaction.createFollowup({
            content: "❌ Tagging cancelled.",
            flags: 64
          });
          
          // Cleanup
          activeCollectors.delete(message.id);
          client.removeListener('interactionCreate', handler);
          return;
        }

        const results = await this.updateCardTags(orderedCards, authorId, emoji);

        // Update the embed
        const updatedEmbed = this.buildUpdatedEmbed(orderedCards, results, emoji, interaction.member.user);
        await interaction.message.edit({ 
          embeds: [updatedEmbed],
          components: [] // Remove buttons after action
        });

        // Send ephemeral feedback
        const feedbackMessage = this.buildFeedbackMessage(results, emoji);
        await interaction.createFollowup({
          content: feedbackMessage,
          flags: 64
        });

        // Cleanup collector
        activeCollectors.delete(message.id);
        client.removeListener('interactionCreate', handler);

      } catch (error) {
        console.error('Tag interaction error:', error);
        try {
          await interaction.createFollowup({
            content: "❌ An error occurred. Please try again.",
            flags: 64
          });
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

  async updateCardTags(orderedCards, userId, emoji) {
    const results = {
      success: [],
      replaced: [],
      notFound: []
    };

    for (const card of orderedCards) {
      if (!card.found) {
        results.notFound.push(card.cardCode);
        continue;
      }

      const hadPreviousTag = card.cardTag && card.cardTag !== emoji;

      try {
        await User.updateOne(
          { discordId: userId, cardCode: card.cardCode },
          { $set: { cardTag: emoji } }
        );
        
        card.cardTag = emoji; // Update for display
        
        if (hadPreviousTag) {
          results.replaced.push({ code: card.cardCode, old: card.cardTag });
        } else {
          results.success.push(card.cardCode);
        }
      } catch (error) {
        console.error(`Failed to update ${card.cardCode}:`, error);
      }
    }

    return results;
  },

  buildUpdatedEmbed(orderedCards, results, emoji, author) {
    let description = '';

    orderedCards.forEach(card => {
      if (!card.found) {
        description += `❌ **Not Found** — \`${card.cardCode}\`\n`;
      } else {
        const lockEmoji = card.cardLocked ? '<:lock:1461015492939481192>' : '';
        const tagEmoji = card.cardTag || '';
        const rarityEmoji = RARITY_EMOJIS[card.rarity.toLowerCase()] || '';
        const printInfo = card.printNumber ? `#${card.printNumber}` : '';
        
        description += `${lockEmoji} ${rarityEmoji} **${card.group} ${card.name}** ${printInfo} — \`${card.cardCode}\` ${tagEmoji}\n`;
      }
    });

    return {
      author: {
        name: `${author.username}'s Tagging Complete`,
        icon_url: author.avatarURL
      },
      description: description.trim(),
      footer: { 
        text: `${results.success.length + results.replaced.length} cards tagged with ${emoji}`
      },
      color: EMBED_COLORS.SUCCESS || 0x00ff00
    };
  },

  buildFeedbackMessage(results, emoji) {
    let message = '';

    if (results.success.length) {
      message += `<:check:1461015775266603110> Tagged with ${emoji}: ${results.success.map(c => `\`${c}\``).join(', ')}\n`;
    }

    if (results.replaced.length) {
      message += `🔄 Replaced tag: ${results.replaced.map(r => `\`${r.code}\``).join(', ')}\n`;
    }

    if (results.notFound.length) {
      message += `❌ Not found: ${results.notFound.map(c => `\`${c}\``).join(', ')}`;
    }

    return message.trim() || `No changes made.`;
  },

  // Remove tags command
  async removeTagsCommand(msg, client, userId, cardCodes) {
    if (!cardCodes.length) {
      return msg.channel.createMessage({
        content: "Usage: `?tag remove <cardCode> [cardCode2]...`",
        messageReference: { messageID: msg.id }
      });
    }

    try {
      const cards = await User.find({ 
        discordId: userId, 
        cardCode: { $in: cardCodes }
      }).lean();

      const cardMap = new Map(cards.map(card => [card.cardCode, card]));
      const orderedCards = cardCodes.map(code => {
        const card = cardMap.get(code);
        return card ? { ...card, found: true } : { cardCode: code, found: false };
      });

      const results = {
        success: [],
        noTag: [],
        notFound: []
      };

      for (const card of orderedCards) {
        if (!card.found) {
          results.notFound.push(card.cardCode);
          continue;
        }

        if (!card.cardTag) {
          results.noTag.push(card.cardCode);
          continue;
        }

        try {
          await User.updateOne(
            { discordId: userId, cardCode: card.cardCode },
            { $unset: { cardTag: "" } }
          );
          results.success.push(card.cardCode);
        } catch (error) {
          console.error(`Failed to remove tag from ${card.cardCode}:`, error);
        }
      }

      let response = '';
      if (results.success.length) {
        response += `<:check:1461015775266603110> Tags removed: ${results.success.map(c => `\`${c}\``).join(', ')}\n`;
      }
      if (results.noTag.length) {
        response += `ℹ️ No tag to remove: ${results.noTag.map(c => `\`${c}\``).join(', ')}\n`;
      }
      if (results.notFound.length) {
        response += `❌ Not found: ${results.notFound.map(c => `\`${c}\``).join(', ')}`;
      }

      return msg.channel.createMessage({
        content: response.trim() || 'No changes made.',
        messageReference: { messageID: msg.id }
      });

    } catch (error) {
      console.error("Remove tags error:", error);
      return msg.channel.createMessage({
        content: "❌ An error occurred. Please try again.",
        messageReference: { messageID: msg.id }
      });
    }
  },

  // Show all tags
  async showAllTags(msg, client, userId) {
    try {
      const cards = await User.find({ 
        discordId: userId,
        cardTag: { $exists: true, $ne: null }
      }).select('cardTag').lean();

      if (!cards.length) {
        return msg.channel.createMessage({
          content: "You haven't tagged any cards yet!",
          messageReference: { messageID: msg.id }
        });
      }

      // Count cards per tag
      const tagCounts = new Map();
      cards.forEach(card => {
        if (card.cardTag) {
          tagCounts.set(card.cardTag, (tagCounts.get(card.cardTag) || 0) + 1);
        }
      });

      // Build embed
      let description = '';
      [...tagCounts.entries()]
        .sort((a, b) => b[1] - a[1]) // Sort by count descending
        .forEach(([emoji, count]) => {
          description += `${emoji} — **${count}** card${count !== 1 ? 's' : ''}\n`;
        });

      return client.createMessage(msg.channel.id, {
        embeds: [{
          author: {
            name: `${msg.author.username}'s Tags`,
            icon_url: msg.author.avatarURL
          },
          description: description.trim(),
          footer: {
            text: `Total: ${tagCounts.size} unique tag${tagCounts.size !== 1 ? 's' : ''}`
          },
          color: EMBED_COLORS.DEFAULT
        }],
        messageReference: { messageID: msg.id }
      });

    } catch (error) {
      console.error("Show all tags error:", error);
      return msg.channel.createMessage({
        content: "❌ An error occurred. Please try again.",
        messageReference: { messageID: msg.id }
      });
    }
  }
};