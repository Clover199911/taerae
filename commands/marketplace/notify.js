// marketplace/notify.js – Notification subscription handler
// Allows users to subscribe to marketplace listing alerts
// ============================================================================

const MarketNotification = require("../../models/marketNotification");
const { EMBED_COLORS, RARITY_EMOJIS, CONDITION_EMOJIS, MARKETPLACE_EMOJIS } = require("../../config/embedConstants");
const searchAliases = require("../../config/searchAliases");

const MAX_NOTIFICATIONS = 10; // Limit per user to prevent spam

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Determines the watch type based on the search term
 */
const determineWatchType = (term) => {
  const lowerTerm = term.toLowerCase();
  
  // Check if it's a rarity
  const rarities = ['standard', 'unique', 'glyph', 'mythic'];
  if (rarities.includes(lowerTerm)) {
    return 'rarity';
  }
  
  // Check if it's a print number (p#123 or print:123)
  if (/^(p#|print:)(\d+)$/i.test(term)) {
    return 'print';
  }
  
  // Multiple words = specific card (group + member)
  if (term.includes(' ')) {
    return 'specific';
  }
  
  // Single word could be group or member name
  // Default to 'group' but will match both in notifications
  return 'group';
};

/**
 * Parses print number from term like "p#123" or "print:123"
 */
const parsePrintNumber = (term) => {
  const match = term.match(/^(p#|print:)(\d+)$/i);
  return match ? parseInt(match[2]) : null;
};

/**
 * Creates a human-readable description of the notification
 */
const formatNotificationDescription = (notification) => {
  if (notification.watchType === 'print') {
    return `Print #${notification.printNumber}`;
  }
  
  const term = notification.searchTerm;
  
  switch (notification.watchType) {
    case 'rarity':
      return `${term.charAt(0).toUpperCase() + term.slice(1)} rarity`;
    case 'specific':
      return term.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    case 'group':
    case 'member':
    default:
      return term.charAt(0).toUpperCase() + term.slice(1);
  }
};

// ============================================================================
// SUBCOMMAND HANDLERS
// ============================================================================

/**
 * Add a new notification subscription
 */
const addNotification = async (msg, args, client) => {
  const userId = msg.author.id;
  
  if (args.length === 0) {
    return msg.channel.createMessage({
      embeds: [{
        title: `${MARKETPLACE_EMOJIS.error} Missing Search Term`,
        description: 
          `Please specify what to watch for.\n\n` +
          `${MARKETPLACE_EMOJIS.tip} **Examples:**\n` +
          `• \`?market notify dreamcatcher\` - Watch group\n` +
          `• \`?market notify jiu\` - Watch member\n` +
          `• \`?market notify mythic\` - Watch rarity\n` +
          `• \`?market notify dreamcatcher jiu\` - Specific card\n` +
          `• \`?market notify p#123\` - Specific print number`,
        color: EMBED_COLORS.ERROR
      }],
      messageReference: { messageID: msg.id }
    });
  }

  try {
    // Check current notification count
    const currentCount = await MarketNotification.countDocuments({ userId });
    
    if (currentCount >= MAX_NOTIFICATIONS) {
      return msg.channel.createMessage({
        embeds: [{
          title: `${MARKETPLACE_EMOJIS.warning} Notification Limit Reached`,
          description: 
            `You can only have **${MAX_NOTIFICATIONS}** active notifications.\n\n` +
            `${MARKETPLACE_EMOJIS.tip} **Manage your notifications:**\n` +
            `• Remove: \`?market notify remove <term>\`\n` +
            `• Clear all: \`?market notify clear\`\n` +
            `• View list: \`?market notify list\``,
          color: EMBED_COLORS.ERROR
        }],
        messageReference: { messageID: msg.id }
      });
    }

    const rawTerm = args.join(' ');
    const watchType = determineWatchType(rawTerm);
    let searchTerm = rawTerm.toLowerCase();
    let printNumber = null;

    // Handle print number notifications
    if (watchType === 'print') {
      printNumber = parsePrintNumber(rawTerm);
      searchTerm = `print:${printNumber}`;
    } else {
      // Expand aliases for search term
      const expanded = searchAliases.expandAll([searchTerm]);
      searchTerm = expanded[0] || searchTerm;
    }

    // Check if already exists
    const existing = await MarketNotification.findOne({ 
      userId, 
      searchTerm,
      printNumber 
    });

    if (existing) {
      return msg.channel.createMessage({
        embeds: [{
          title: `${MARKETPLACE_EMOJIS.warning} Already Watching`,
          description: 
            `You're already watching for: **${formatNotificationDescription(existing)}**\n\n` +
            `${MARKETPLACE_EMOJIS.tip} View all: \`?market notify list\``,
          color: EMBED_COLORS.ERROR
        }],
        messageReference: { messageID: msg.id }
      });
    }

    // Create notification
    const notification = await MarketNotification.create({
      userId,
      watchType,
      searchTerm,
      printNumber
    });

    return msg.channel.createMessage({
      embeds: [{
        title: `${MARKETPLACE_EMOJIS.notify} Notification Added`,
        description: 
          `Now watching for: **${formatNotificationDescription(notification)}**\n\n` +
          `${MARKETPLACE_EMOJIS.success} You'll receive a DM when matching cards are listed!\n` +
          `**Active notifications:** ${currentCount + 1}/${MAX_NOTIFICATIONS}\n\n` +
          `${MARKETPLACE_EMOJIS.tip} View all: \`?market notify list\``,
        color: EMBED_COLORS.DEFAULT
      }],
      messageReference: { messageID: msg.id }
    });

  } catch (error) {
    console.error("Add notification error:", error);
    return msg.channel.createMessage({
      embeds: [{
        title: `${MARKETPLACE_EMOJIS.error} Error`,
        description: 
          `Failed to add notification.\n\n` +
          `${MARKETPLACE_EMOJIS.tip} Try again or contact support if this continues.`,
        color: EMBED_COLORS.ERROR
      }],
      messageReference: { messageID: msg.id }
    });
  }
};

/**
 * Remove a notification subscription
 */
const removeNotification = async (msg, args, client) => {
  const userId = msg.author.id;
  
  if (args.length === 0) {
    return msg.channel.createMessage({
      embeds: [{
        title: `${MARKETPLACE_EMOJIS.error} Missing Search Term`,
        description: 
          `Specify what to stop watching.\n\n` +
          `${MARKETPLACE_EMOJIS.tip} **Example:** \`?market notify remove dreamcatcher\`\n` +
          `${MARKETPLACE_EMOJIS.help} View list: \`?market notify list\``,
        color: EMBED_COLORS.ERROR
      }],
      messageReference: { messageID: msg.id }
    });
  }

  try {
    const rawTerm = args.join(' ');
    const watchType = determineWatchType(rawTerm);
    let searchTerm = rawTerm.toLowerCase();
    let printNumber = null;

    if (watchType === 'print') {
      printNumber = parsePrintNumber(rawTerm);
      searchTerm = `print:${printNumber}`;
    } else {
      const expanded = searchAliases.expandAll([searchTerm]);
      searchTerm = expanded[0] || searchTerm;
    }

    const result = await MarketNotification.findOneAndDelete({ 
      userId, 
      searchTerm,
      ...(printNumber !== null && { printNumber })
    });

    if (!result) {
      return msg.channel.createMessage({
        embeds: [{
          title: `${MARKETPLACE_EMOJIS.error} Not Found`,
          description: 
            `You're not watching for: **${rawTerm}**\n\n` +
            `${MARKETPLACE_EMOJIS.tip} View your notifications: \`?market notify list\``,
          color: EMBED_COLORS.ERROR
        }],
        messageReference: { messageID: msg.id }
      });
    }

    return msg.channel.createMessage({
      embeds: [{
        title: `${MARKETPLACE_EMOJIS.success} Notification Removed`,
        description: `Stopped watching for: **${formatNotificationDescription(result)}**`,
        color: 0x57F287
      }],
      messageReference: { messageID: msg.id }
    });

  } catch (error) {
    console.error("Remove notification error:", error);
    return msg.channel.createMessage({
      embeds: [{
        title: `${MARKETPLACE_EMOJIS.error} Error`,
        description: 
          `Failed to remove notification.\n\n` +
          `${MARKETPLACE_EMOJIS.tip} Try again or contact support if this continues.`,
        color: EMBED_COLORS.ERROR
      }],
      messageReference: { messageID: msg.id }
    });
  }
};

/**
 * List all active notifications
 */
const listNotifications = async (msg, args, client) => {
  const userId = msg.author.id;

  try {
    const notifications = await MarketNotification.find({ userId })
      .sort({ createdAt: -1 })
      .lean();

    if (notifications.length === 0) {
      return msg.channel.createMessage({
        embeds: [{
          title: `${MARKETPLACE_EMOJIS.notify} Your Notifications`,
          description: 
            `You have no active notifications.\n\n` +
            `${MARKETPLACE_EMOJIS.tip} **Add one with:**\n\`?market notify <search term>\``,
          color: EMBED_COLORS.DEFAULT
        }],
        messageReference: { messageID: msg.id }
      });
    }

    // Group by type for better display
    const byType = {
      rarity: [],
      group: [],
      member: [],
      specific: [],
      print: []
    };

    notifications.forEach(n => {
      byType[n.watchType].push(formatNotificationDescription(n));
    });

    let description = `**Active: ${notifications.length}/${MAX_NOTIFICATIONS}**\n\n`;

    if (byType.rarity.length) {
      description += `**Rarities:**\n${byType.rarity.map(t => `• ${t}`).join('\n')}\n\n`;
    }
    if (byType.specific.length) {
      description += `**Specific Cards:**\n${byType.specific.map(t => `• ${t}`).join('\n')}\n\n`;
    }
    if (byType.group.length) {
      description += `**Groups/Members:**\n${byType.group.map(t => `• ${t}`).join('\n')}\n\n`;
    }
    if (byType.print.length) {
      description += `**Print Numbers:**\n${byType.print.map(t => `• ${t}`).join('\n')}\n\n`;
    }

    return msg.channel.createMessage({
      embeds: [{
        title: `${MARKETPLACE_EMOJIS.notify} Your Notifications`,
        description: description.trim(),
        color: EMBED_COLORS.DEFAULT,
        footer: { text: "Remove with: ?market notify remove <term>" }
      }],
      messageReference: { messageID: msg.id }
    });

  } catch (error) {
    console.error("List notifications error:", error);
    return msg.channel.createMessage({
      embeds: [{
        title: `${MARKETPLACE_EMOJIS.error} Error`,
        description: 
          `Failed to load notifications.\n\n` +
          `${MARKETPLACE_EMOJIS.tip} Try again or contact support if this continues.`,
        color: EMBED_COLORS.ERROR
      }],
      messageReference: { messageID: msg.id }
    });
  }
};

/**
 * Clear all notifications
 */
const clearNotifications = async (msg, args, client) => {
  const userId = msg.author.id;

  try {
    const count = await MarketNotification.countDocuments({ userId });

    if (count === 0) {
      return msg.channel.createMessage({
        embeds: [{
          title: `${MARKETPLACE_EMOJIS.info} No Notifications`,
          description: `You have no active notifications to clear.`,
          color: EMBED_COLORS.DEFAULT
        }],
        messageReference: { messageID: msg.id }
      });
    }

    await MarketNotification.deleteMany({ userId });

    return msg.channel.createMessage({
      embeds: [{
        title: `${MARKETPLACE_EMOJIS.success} Notifications Cleared`,
        description: `Removed **${count}** notification(s).`,
        color: 0x57F287
      }],
      messageReference: { messageID: msg.id }
    });

  } catch (error) {
    console.error("Clear notifications error:", error);
    return msg.channel.createMessage({
      embeds: [{
        title: `${MARKETPLACE_EMOJIS.error} Error`,
        description: 
          `Failed to clear notifications.\n\n` +
          `${MARKETPLACE_EMOJIS.tip} Try again or contact support if this continues.`,
        color: EMBED_COLORS.ERROR
      }],
      messageReference: { messageID: msg.id }
    });
  }
};

// ============================================================================
// MAIN HANDLER
// ============================================================================

module.exports = {
  async execute(msg, args, client, checkRegistration) {
    // Check registration
    if (!await checkRegistration(msg.author.id, msg, client)) return;

    // Show help if no subcommand
    if (args.length === 0) {
      return msg.channel.createMessage({
        embeds: [{
          title: `${MARKETPLACE_EMOJIS.notify} Marketplace Notifications`,
          description: 
            `Get notified when cards you're looking for are listed!\n\n` +
            `**Commands:**\n` +
            `• \`?market notify <term>\` - Add notification\n` +
            `• \`?market notify remove <term>\` - Remove notification\n` +
            `• \`?market notify list\` - View your notifications\n` +
            `• \`?market notify clear\` - Remove all notifications\n\n` +
            `**Examples:**\n` +
            `• \`?market notify dreamcatcher\` - Watch for Dreamcatcher cards\n` +
            `• \`?market notify jiu\` - Watch for Jiu cards\n` +
            `• \`?market notify mythic\` - Watch for mythic rarity\n` +
            `• \`?market notify dreamcatcher jiu\` - Watch for specific card\n` +
            `• \`?market notify p#123\` - Watch for print #123`,
          color: EMBED_COLORS.DEFAULT,
          footer: { text: `Maximum ${MAX_NOTIFICATIONS} notifications per user` }
        }],
        messageReference: { messageID: msg.id }
      });
    }

    const subcommand = args[0].toLowerCase();

    // Route to appropriate handler
    if (subcommand === 'remove' || subcommand === 'delete') {
      args.shift(); // Remove subcommand
      return removeNotification(msg, args, client);
    }
    
    if (subcommand === 'list' || subcommand === 'show') {
      return listNotifications(msg, args, client);
    }
    
    if (subcommand === 'clear' || subcommand === 'reset') {
      return clearNotifications(msg, args, client);
    }

    // Default: add notification (no subcommand needed)
    return addNotification(msg, args, client);
  }
};