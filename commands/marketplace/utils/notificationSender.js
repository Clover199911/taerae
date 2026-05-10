// marketplace/utils/notificationSender.js – Sends alerts to subscribed users
// When a card is listed, checks for matching subscriptions and sends DMs
// ============================================================================

const MarketNotification = require("../../../models/marketNotification");
const { RARITY_EMOJIS, CONDITION_EMOJIS } = require("../../../config/embedConstants");
const searchUtils = require("../../../utils/searchUtils");

// Cache to prevent spamming same user multiple times for one listing
const sentNotifications = new Map();

// ============================================================================
// MATCHING LOGIC
// ============================================================================

/**
 * Checks if a card matches a notification subscription
 */
const cardMatchesNotification = (cardDetails, notification) => {
  const { watchType, searchTerm, printNumber } = notification;

  switch (watchType) {
    case 'rarity':
      return cardDetails.rarity.toLowerCase() === searchTerm;

    case 'print':
      return cardDetails.printNumber === printNumber;

    case 'specific':
      // Match both group and name
      const terms = searchTerm.split(' ');
      return terms.every(term => searchUtils.cardMatchesTerm(cardDetails, term));

    case 'group':
    case 'member':
    default:
      // Match against group or name
      return searchUtils.cardMatchesTerm(cardDetails, searchTerm);
  }
};

// ============================================================================
// NOTIFICATION SENDER
// ============================================================================

/**
 * Sends notifications to users watching for this card
 * Called when a new listing is created
 * 
 * @param {Object} client - Eris client instance
 * @param {Object} listing - The marketplace listing object
 * @param {Object} cardDetails - The full card details from User model
 */
const sendListingNotifications = async (client, listing, cardDetails) => {
  try {
    // Ensure we have all required card details (including printNumber)
    if (!cardDetails || !cardDetails.printNumber) {
      console.error(`Missing card details for listing ${listing.code}`);
      return;
    }

    // Get all active notifications
    const notifications = await MarketNotification.find({}).lean();

    if (notifications.length === 0) return;

    // Find matching subscriptions
    const matches = notifications.filter(n => 
      cardMatchesNotification(cardDetails, n)
    );

    if (matches.length === 0) return;

    // Group by user to prevent duplicate DMs
    const userNotifications = new Map();
    matches.forEach(match => {
      if (!userNotifications.has(match.userId)) {
        userNotifications.set(match.userId, []);
      }
      userNotifications.get(match.userId).push(match);
    });

    // Create cache key for this listing
    const cacheKey = `${listing.code}-${Date.now()}`;

    // Send DMs to each unique user
    const promises = Array.from(userNotifications.entries()).map(([userId, userSubs]) => 
      sendNotificationDM(client, userId, listing, cardDetails, userSubs, cacheKey)
    );

    await Promise.allSettled(promises);

    console.log(`📬 Sent ${userNotifications.size} notification(s) for listing ${listing.code}`);

  } catch (error) {
    console.error("Error sending listing notifications:", error);
  }
};

/**
 * Sends a DM to a specific user about a new listing
 */
const sendNotificationDM = async (client, userId, listing, cardDetails, matchedSubs, cacheKey) => {
  try {
    // Prevent seller from getting their own notification
    if (userId === listing.sellerId) return;

    // Check cache to prevent duplicate notifications
    const userCacheKey = `${userId}-${cacheKey}`;
    if (sentNotifications.has(userCacheKey)) return;
    sentNotifications.set(userCacheKey, true);

    // Get user and DM channel
    const user = await client.getRESTUser(userId).catch(() => null);
    if (!user) return;

    const dmChannel = await user.getDMChannel();

    // Format card display
    const conditionEmoji = CONDITION_EMOJIS[cardDetails.condition.toLowerCase()] || "❓";
    const rarityStars = RARITY_EMOJIS[cardDetails.rarity.toLowerCase()] || "☆☆☆☆";
    const cardLine = `${conditionEmoji} ${rarityStars} **${cardDetails.group} ${cardDetails.name}** #${cardDetails.printNumber} — \`${listing.code}\``;

    // Format matching reasons (what they were watching for)
    const watchingFor = matchedSubs.map(sub => {
      if (sub.watchType === 'print') return `Print #${sub.printNumber}`;
      if (sub.watchType === 'rarity') return sub.searchTerm.toUpperCase();
      return sub.searchTerm.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }).join(', ');

    // Create embed with grayscale thumbnail
    const embed = {
      title: "🔔 New Listing Alert!",
      description: 
        `${cardLine}\n\n` +
        `<:rose:1461015415466496191> **Price:** ${listing.amount.toLocaleString()} crystals\n` +
        `<:notification:1461017653970997333> **Watching for:** ${watchingFor}\n\n` +
        `**Buy now:** \`?market buy ${listing.code}\``,
      color: 0x000000, // Black for grayscale theme
      thumbnail: {
        url: cardDetails.imageURL // Will appear as grayscale in Discord
      },
      footer: { 
        text: "Marketplace Notification" 
      },
      timestamp: new Date().toISOString()
    };

    await dmChannel.createMessage({ embeds: [embed] });

    console.log(`✅ Notified ${userId} about listing ${listing.code}`);

  } catch (error) {
    // Fail silently if user has DMs disabled
    if (error.code === 50007) {
      console.log(`Cannot DM user ${userId} (DMs disabled)`);
    } else {
      console.error(`Error sending notification to ${userId}:`, error.message);
    }
  }
};

// ============================================================================
// CACHE CLEANUP
// ============================================================================

// Clear notification cache every 5 minutes to prevent memory buildup
setInterval(() => {
  sentNotifications.clear();
}, 5 * 60 * 1000);

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  sendListingNotifications
};