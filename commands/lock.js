// lock.js - Lock/unlock cards to prevent gifting
const User = require("../models/user");
const { EMBED_COLORS, RARITY_EMOJIS, CONDITION_EMOJIS } = require('../config/embedConstants');

const COLLECTOR_TIMEOUT = 60000; // 1 minute
const activeCollectors = new Map();

module.exports = {
  name: "lock",
  aliases: ["lk"],
  description: "Lock or unlock cards to prevent gifting",

  async execute(msg, args, client) {
    const userId = msg.author.id;

    if (!args.length) {
      return msg.channel.createMessage({
        content: "Usage: `?lock <cardCode> [cardCode2] [cardCode3]...`",
        messageReference: { messageID: msg.id }
      });
    }

    const cardCodes = args.map(code => code);

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
      const embed = this.buildEmbed(orderedCards, msg.author);
      const components = this.createComponents();

      const message = await client.createMessage(msg.channel.id, {
        embeds: [embed],
        components,
        messageReference: { messageID: msg.id }
      });

      // Setup button handler
      this.setupInteractionHandler(client, message, userId, orderedCards);

    } catch (error) {
      console.error("Lock command error:", error);
      return msg.channel.createMessage({
        content: "❌ An error occurred. Please try again.",
        messageReference: { messageID: msg.id }
      });
    }
  },

  buildEmbed(orderedCards, author) {
    let description = '';

    orderedCards.forEach(card => {
      if (!card.found) {
        description += `❌ **Not Found** — \`${card.cardCode}\`\n`;
      } else {
        const lockEmoji = card.cardLocked ? '<:lock:1461015492939481192>' : '<:unlock:1461015144426377367>';
        const conditionEmoji = CONDITION_EMOJIS[card.condition.toLowerCase()] || '';
        const rarityEmoji = RARITY_EMOJIS[card.rarity.toLowerCase()] || '';
        const printInfo = card.printNumber ? `#${card.printNumber}` : '';
        
        description += `${lockEmoji} ${rarityEmoji} **${card.group} ${card.name}** ${printInfo} — \`${card.cardCode}\`\n`;
      }
    });

    return {
      author: {
        name: `${author.username} (Un)Lock`,
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
          style: 2,
          custom_id: 'lock_cards',
          label: 'Lock',
          emoji     : { id : "1461015492939481192", name : "lock" }
        },
        {
          type: 2,
          style: 2,
          custom_id: 'unlock_cards',
          label: 'Unlock',
          emoji     : { id : "1461015144426377367", name : "unlock" }
        }
      ]
    }];
  },

  setupInteractionHandler(client, message, authorId, orderedCards) {
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

        const wantsToLock = interaction.data.custom_id === 'lock_cards';
        const results = await this.updateCardLocks(orderedCards, authorId, wantsToLock);

        // Update the embed
        const updatedEmbed = this.buildUpdatedEmbed(orderedCards, results, wantsToLock, interaction.member.user);
        await interaction.message.edit({ 
          embeds: [updatedEmbed],
          components: [] // Remove buttons after action
        });

        // Send ephemeral feedback
        const feedbackMessage = this.buildFeedbackMessage(results, wantsToLock);
        await interaction.createFollowup({
          content: feedbackMessage,
          flags: 64
        });

        // Cleanup collector
        activeCollectors.delete(message.id);
        client.removeListener('interactionCreate', handler);

      } catch (error) {
        console.error('Lock interaction error:', error);
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

  async updateCardLocks(orderedCards, userId, wantsToLock) {
    const results = {
      success: [],
      alreadyInState: [],
      notFound: []
    };

    for (const card of orderedCards) {
      if (!card.found) {
        results.notFound.push(card.cardCode);
        continue;
      }

      const isLocked = card.cardLocked === true;

      // Check if already in desired state
      if ((wantsToLock && isLocked) || (!wantsToLock && !isLocked)) {
        results.alreadyInState.push(card.cardCode);
        card.cardLocked = isLocked; // Keep current state for display
        continue;
      }

      // Update the card
      try {
        await User.updateOne(
          { discordId: userId, cardCode: card.cardCode },
          { $set: { cardLocked: wantsToLock } }
        );
        card.cardLocked = wantsToLock; // Update for display
        results.success.push(card.cardCode);
      } catch (error) {
        console.error(`Failed to update ${card.cardCode}:`, error);
      }
    }

    return results;
  },

  buildUpdatedEmbed(orderedCards, results, wantsToLock, author) {
    let description = '';

    orderedCards.forEach(card => {
      if (!card.found) {
        description += `❌ **Not Found** — \`${card.cardCode}\`\n`;
      } else {
        const lockEmoji = card.cardLocked ? '<:lock:1461015492939481192>' : '<:unlock:1461015144426377367>';
        const conditionEmoji = CONDITION_EMOJIS[card.condition.toLowerCase()] || '';
        const rarityEmoji = RARITY_EMOJIS[card.rarity.toLowerCase()] || '';
        const printInfo = card.printNumber ? `#${card.printNumber}` : '';
        
        description += `${lockEmoji} ${rarityEmoji} **${card.group} ${card.name}**  ${printInfo} — \`${card.cardCode}\`\n`;
      }
    });

    const action = wantsToLock ? 'Lock' : 'Unlock';

    return {
      author: {
        name: `${author.username}'s ${action} Complete`,
        icon_url: author.avatarURL
      },
      description: description.trim(),
      footer: { 
        text: `${results.success.length} cards ${wantsToLock ? 'locked' : 'unlocked'}`
      },
      color: EMBED_COLORS.SUCCESS || 0x00ff00
    };
  },

  buildFeedbackMessage(results, wantsToLock) {
    const action = wantsToLock ? 'locked' : 'unlocked';
    const alreadyState = wantsToLock ? 'locked' : 'unlocked';
    
    let message = '';

    if (results.success.length) {
      message += `<:check:1461015775266603110> Successfully ${action}: ${results.success.map(c => `\`${c}\``).join(', ')}\n`;
    }

    if (results.alreadyInState.length) {
      message += `⚠️ Already ${alreadyState}: ${results.alreadyInState.map(c => `\`${c}\``).join(', ')}\n`;
    }

    if (results.notFound.length) {
      message += `❌ Not found: ${results.notFound.map(c => `\`${c}\``).join(', ')}`;
    }

    return message.trim() || `No changes made.`;
  }
};