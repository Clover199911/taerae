// marketplace/utils/notifications.js – Notification system
// Sends DMs to sellers and guild notifications for purchases
// ============================================================================

const { GUILD_IDS, CHANNEL_IDS, WEBHOOKS, EMOJI_IDS } = require('../../../config/constants');

const WEBHOOK_URL = WEBHOOKS.MARKETPLACE;
const GUILD_ID = GUILD_IDS.MAIN;
const NOTIFICATION_CHANNEL_ID = CHANNEL_IDS.MARKETPLACE_NOTIFICATIONS;

// ============================================================================
// SELLER NOTIFICATIONS
// ============================================================================

/**
 * Sends DM to seller when their card is purchased
 * @param {Object} client - Eris client instance
 * @param {Object} listing - Marketplace listing object
 * @param {Number} amount - Sale amount in crystals
 */
const sendSellerNotification = async (client, listing, amount) => {
  try {
    const seller = await client.getRESTUser(listing.sellerId).catch(() => null);
    
    if (!seller) {
      console.log(`Failed to find seller ${listing.sellerId}`);
      return;
    }

    const dmChannel = await seller.getDMChannel();
    
    await dmChannel.createMessage({
      embeds: [{
        title: "Card Sold!",
        description: 
          `Your **${listing.name}** has been sold!\n\n` +
          `<:rose:${EMOJI_IDS.ROSE}> **Earned:** ${amount.toLocaleString()} crystals\n` +
          `<:cards:${EMOJI_IDS.CARDS}> **Card:** \`${listing.code}\`\n\n` +
          `The crystals have been added to your balance. ✨`,
        color: 0x57F287,
        footer: { text: "Marketplace Sale" },
        timestamp: new Date().toISOString()
      }]
    });

    console.log(`✅ Notified seller ${listing.sellerId} of sale`);
  } catch (error) {
    // Fail silently if user has DMs disabled
    console.log(`Failed to DM seller ${listing.sellerId}:`, error.message);
  }
};

// ============================================================================
// GUILD NOTIFICATIONS
// ============================================================================

/**
 * Sends notification to guild channel when a card is purchased
 * @param {Object} client - Eris client instance
 * @param {Object} listing - Marketplace listing object
 * @param {String} buyerId - Discord ID of buyer
 * @param {Number} amount - Purchase amount in crystals
 */
const sendGuildNotification = async (client, listing, buyerId, amount) => {
  try {
    const guild = client.guilds.get(GUILD_ID);
    
    if (!guild) {
      console.log(`Guild ${GUILD_ID} not found`);
      return;
    }

    const channel = guild.channels.get(NOTIFICATION_CHANNEL_ID);
    
    if (!channel) {
      console.log(`Channel ${NOTIFICATION_CHANNEL_ID} not found`);
      return;
    }

    await channel.createMessage({
      embeds: [{
        description: 
        `Card Sold`
          `**Seller:** <@${listing.sellerId}>\n` +
          `**Buyer:** <@${buyerId}>\n\n` +
          `**Card:** \`${listing.rarity}\` **${listing.name}**\n` +
          `**Price:** ${amount.toLocaleString()} <:rose:${EMOJI_IDS.ROSE}>`,
        color: 0x57F287,
        timestamp: new Date().toISOString()
      }]
    });

    console.log(`✅ Sent guild notification for sale of ${listing.code}`);
  } catch (error) {
    console.error("Error sending guild notification:", error);
  }
};

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  sendSellerNotification,
  sendGuildNotification
};