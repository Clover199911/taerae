// gift.js – Eris – case-sensitive – card gifting system
// -----------------------------------------------------------------------------

const User = require("../models/user");
const Graphic = require("../models/graphic");
const axios = require("axios");
const { CONDITION_EMOJIS, RARITY_EMOJIS } = require("../config/embedConstants"); // Import emoji mappings

const WEBHOOK_URL = process.env.GIFT_WEBHOOK;
const INTERACTION_TIMEOUT = 30 * 1000;
const CACHE_TTL = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 100;

// LRU-style bounded cache
class UserLookupCache {
  constructor(maxSize, ttl) {
    this.maxSize = maxSize;
    this.ttl = ttl;
    this.cache = new Map();
  }

  get(uid) {
    const entry = this.cache.get(uid);
    if (!entry) return undefined;
    if (Date.now() - entry.t >= this.ttl) {
      this.cache.delete(uid);
      return undefined;
    }
    // Move to end (LRU)
    this.cache.delete(uid);
    this.cache.set(uid, entry);
    return entry.e;
  }

  set(uid, exists) {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
    this.cache.set(uid, { e: exists, t: Date.now() });
  }

  clear() {
    this.cache.clear();
  }
}

const userLookupCache = new UserLookupCache(MAX_CACHE_SIZE, CACHE_TTL);
const activeCollectors = new Map();

// Track active gift interactions to prevent spam
const activeGifts = new Set();

// Periodic cleanup for stale gift entries (safety net)
setInterval(() => {
  // activeGifts should auto-cleanup via timeout, but this is a safety net
  // In case of crashes/errors that bypass cleanup
  if (activeGifts.size > 50) {
    console.warn('[GIFT] activeGifts has grown large, clearing stale entries');
    activeGifts.clear();
  }
}, 300000); // 5 minutes

// ----------  UTILS  ----------
const createEmbed = (title, desc, color, footer = null) => ({
  title,
  description: desc,
  color,
  footer,
  timestamp: new Date().toISOString()
});

module.exports = {
  name: "gift",
  aliases: ["gf"],
  description: "Gift cards to another user",

  async execute(msg, args, client) {
    const senderId = msg.author.id;

    // Check if user already has an active gift
    if (activeGifts.has(senderId)) {
      return msg.channel.createMessage({
        content: "⏳ You already have a gift in progress! Please finish or cancel it first.",
        messageReference: { messageID: msg.id }
      });
    }

    try {
      // Basic format checks
      if (args.some(a => a.includes("\n") || a.includes("  "))) {
        return msg.channel.createMessage({
          content: "Please avoid new-lines or double spaces.",
          messageReference: { messageID: msg.id }
        });
      }

      // Parse mention + card codes (case-sensitive)
      const cardCodeIndex = args.findIndex(a => /^[A-Za-z0-9]+$/.test(a));
      if (cardCodeIndex <= 0) {
        return msg.channel.createMessage({
          content: "Mention a user followed by card code(s).",
          messageReference: { messageID: msg.id }
        });
      }

      const recipientId = args.slice(0, cardCodeIndex).join(" ").replace(/[<@!>]/g, "");
      const cardCodes = args.slice(cardCodeIndex).map(c => c);
      
      // Check if recipient exists
      const recipientExists = await this.userExists(recipientId);
      
      if (!recipientId || recipientId === senderId) {
        return msg.channel.createMessage({
          content: "Please mention a valid recipient.",
          messageReference: { messageID: msg.id }
        });
      }
      
      if (!recipientExists) {
        return msg.channel.createMessage({
          content: "Recipient not found.",
          messageReference: { messageID: msg.id }
        });
      }

      const validation = await this.validateCards(senderId, cardCodes);
      if (validation.error) {
        return msg.channel.createMessage({
          content: validation.error,
          messageReference: { messageID: msg.id }
        });
      }

      // Mark as active before showing confirmation
      activeGifts.add(senderId);

      await this.showConfirmation(msg, client, recipientId, validation.cards);

    } catch (err) {
      console.error("Gift error:", err);
      // Remove from active gifts on error
      activeGifts.delete(senderId);
      msg.channel.createMessage({
        content: "Gift failed. Try again later.",
        messageReference: { messageID: msg.id }
      });
    }
  },

  async userExists(uid) {
    const cached = userLookupCache.get(uid);
    if (cached !== undefined) return cached;
    
    const exists = !!(await Graphic.findOne({ userId: uid }).lean());
    userLookupCache.set(uid, exists);
    return exists;
  },

  async validateCards(ownerId, codes) {
    if (new Set(codes).size !== codes.length) {
      return { error: "Duplicate card codes detected." };
    }
  
    // OPTIMIZED: Parallel queries for ownership and marketplace check
    const Marketplace = require("../models/marketplace");
    const [owned, listed] = await Promise.all([
      User.find({ 
        discordId: ownerId, 
        cardCode: { $in: codes } 
      }).lean(),
      Marketplace.find({ 
        sellerId: ownerId, 
        code: { $in: codes } 
      }).select('code').lean()
    ]);
  
    if (owned.length !== codes.length) {
      const missing = codes.filter(c => !owned.some(card => card.cardCode === c));
      return { error: `You don't own: ${missing.join(", ")}` };
    }
  
    // Check for locked cards
    const locked = owned.filter(card => card.cardLocked === true);
    if (locked.length) {
      return { error: `🔒 Locked cards cannot be gifted: \`${locked.map(c => c.cardCode).join(", ")}\`` };
    }
  
    // Check marketplace listings
    if (listed.length) {
      return { error: `Listed on market: \`${listed.map(l => l.code).join(", ")}\`` };
    }
  
    return { cards: owned };
  },

  // ----------  FORMAT CARD LINE  ----------
  // Edit this function to customize how each card is displayed
  formatCardLine(card) {
    const conditionEmoji = CONDITION_EMOJIS[card.condition.toLowerCase()] || "❓";
    const rarityStars = RARITY_EMOJIS[card.rarity.toLowerCase()] || "☆☆☆☆";
    
    // Format: [condition emoji] [Code] **Group Name** #Print [rarity stars]
    return `[${conditionEmoji}] ${rarityStars} **${card.group} ${card.name}** #${card.printNumber} — \`${card.cardCode}\` `;
  },

  async showConfirmation(msg, client, recipientId, cards) {
    const senderId = msg.author.id;

    // Format card list using the formatCardLine function
    const cardList = cards.map(c => this.formatCardLine(c)).join('\n');

    const embed = createEmbed(
      `🎁 Gift Confirmation`,
      `**From:** ${msg.author.username}\n**To:** <@${recipientId}>\n\n**Cards (${cards.length}):**\n${cardList}`,
      0x5865F2
    );
    embed.thumbnail = { url: cards[0].imageURL }; // Show first card image

    // Buttons with emojis only (no labels)
    const buttons = [
      { 
        type: 2, 
        style: 3, 
        custom_id: "gift_confirm", 
        emoji: { id: '1461015775266603110', name: 'check' }
        
      },
      { 
        type: 2, 
        style: 4, 
        custom_id: "gift_cancel", 
        emoji: { id: '1461015696954753034', name: 'cross' }
      }
    ];

    const m = await msg.channel.createMessage({
      embeds: [embed],
      components: [{ type: 1, components: buttons }],
      messageReference: { messageID: msg.id }
    });

    const filter = i => i.message.id === m.id && i.member?.id === senderId;
    let handled = false;

    const handler = async i => {
      if (!filter(i) || handled) return;
      handled = true;
      client.removeListener("interactionCreate", handler);

      // Remove from active gifts when handling interaction
      activeGifts.delete(senderId);

      try {
        if (i.data.custom_id === "gift_confirm") {
          // Use atomic updateMany with ownership check to prevent race condition
          const cardCodes = cards.map(c => c.cardCode);
          
          const result = await User.updateMany(
            { 
              discordId: senderId,
              cardCode: { $in: cardCodes },
              cardLocked: { $ne: true }
            },
            { $set: { discordId: recipientId } }
          );

          if (result.modifiedCount === 0) {
            await m.edit({
              embeds: [createEmbed(
                "❌ Transfer Failed",
                "Cards are no longer available (sold, gifted, or locked).",
                0xED4245
              )],
              components: []
            });
            return;
          }

          if (result.modifiedCount < cards.length) {
            // Partial transfer - some cards were already moved
            const successEmbed = createEmbed(
              `⚠️ Partial Transfer`,
              `Only **${result.modifiedCount}** of ${cards.length} card(s) were transferred to <@${recipientId}>.\nSome cards were no longer available.`,
              0xFFAA00
            );
            await m.edit({
              embeds: [successEmbed],
              components: []
            });
            return;
          }
          // ----------  SUCCESS EMBED - EDIT HERE  ----------
          // Keep the card info visible after successful gift
          const successEmbed = createEmbed(
            `<:check:1461015775266603110> Gift Successful!`,
            `Gifted **${result.modifiedCount}** card(s) to <@${recipientId}>.\n\n**Cards (${cards.length}):**\n${cardList}`,
            0x57F287
          );
          successEmbed.thumbnail = { url: cards[0].imageURL }; // Keep thumbnail

          await m.edit({
            embeds: [successEmbed],
            components: [] // Remove buttons
          });

          // Update quest progress for gift command
          const QuestService = require("../services/QuestService");
          QuestService.updateQuestProgress(senderId, ['gift'], 1).catch(err =>
            console.error('[GIFT_QUEST_UPDATE_ERROR]', err)
          );

          // Webhook log
          if (WEBHOOK_URL) {
            axios.post(WEBHOOK_URL, {
              username: "Gift Log",
              embeds: [{
                title: "🎁 Cards Gifted",
                description: `**From:** ${msg.author.username}\n**To:** <@${recipientId}>\n**Count:** ${cards.length}`,
                color: 0x57F287
              }]
            }).catch(() => {});
          }
        } else {
          // Cancel button pressed
          await m.edit({
            embeds: [createEmbed("❌ Cancelled", "Gift cancelled.", 0xFEE75C)],
            components: []
          });
        }
      } catch (err) {
        console.error("Gift interaction error:", err);
        await m.edit({
          embeds: [createEmbed("❌ Error", "Something went wrong. Please try again.", 0xED4245)],
          components: []
        }).catch(() => {});
      }
    };

    client.on("interactionCreate", handler);

    setTimeout(() => {
      if (!handled) {
        client.removeListener("interactionCreate", handler);
        // Remove from active gifts on timeout
        activeGifts.delete(senderId);
        m.edit({ components: [] }).catch(() => {});
      }
    }, INTERACTION_TIMEOUT);
  }
};

// Cleanup on exit
process.on("SIGINT", () => {
  activeCollectors.forEach(({ cleanup }) => cleanup());
  activeCollectors.clear();
  userLookupCache.clear();
  activeGifts.clear();
});