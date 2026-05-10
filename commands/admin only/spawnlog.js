const { isAdmin } = require("../../config/constants");
const { readSpawnLogs, getSpawnStats } = require("../../utils/cardSpawnLogger");

module.exports = {
  name: "spawnlog",
  aliases: ["sl", "cardlog", "clogs"],
  description: "View card spawn logs (Admin only)",
  
  async execute(msg, args, client) {
    // Admin check
    if (!isAdmin(msg.author.id)) {
      console.log(`Unauthorized user ${msg.author.id} attempted to use spawnlog command`);
      return msg.channel.createMessage({
        content: "You are not authorized to run this command",
        messageReference: { messageID: msg.id }
      });
    }

    const subCommand = args[0]?.toLowerCase();

    // Handle subcommands
    switch (subCommand) {
      case "user":
        return this.handleUserFilter(msg, args.slice(1));
      case "card":
        return this.handleCardFilter(msg, args.slice(1));
      case "date":
        return this.handleDateFilter(msg, args.slice(1));
      case "stats":
        return this.handleStats(msg);
      case "help":
        return this.showHelp(msg);
      default:
        return this.handleRecent(msg, args);
    }
  },

  async handleRecent(msg, args) {
    const limit = parseInt(args[0]) || 10;
    const clampedLimit = Math.min(Math.max(limit, 1), 25);

    const logs = readSpawnLogs({ limit: clampedLimit });

    if (logs.length === 0) {
      return msg.channel.createMessage({
        embeds: [{
          title: "📋 Card Spawn Logs",
          description: "No spawn logs found.",
          color: 0x5865F2
        }],
        messageReference: { messageID: msg.id }
      });
    }

    const logLines = logs.map((entry, i) => {
      const cosmicTag = entry.isCosmic ? ' 🌟' : '';
      const timestamp = `<t:${Math.floor(new Date(entry.timestamp).getTime() / 1000)}:R>`;
      return `**${i + 1}.** ${entry.rarity}${cosmicTag} \`${entry.cardCode || 'N/A'}\`\n` +
             `-# ${entry.group} ${entry.cardName} • <@${entry.userId}> • ${entry.command} • ${timestamp}`;
    });

    return msg.channel.createMessage({
      embeds: [{
        title: `📋 Recent Card Spawns (${logs.length})`,
        description: logLines.join('\n\n'),
        color: 0x5865F2,
        footer: { text: `Use >spawnlog help for more options` }
      }],
      messageReference: { messageID: msg.id }
    });
  },

  async handleUserFilter(msg, args) {
    if (!args.length) {
      return msg.channel.createMessage({
        embeds: [{
          title: "⚠️ Missing User ID",
          description: "Please provide a user ID.\n\n**Usage:** `>spawnlog user <userID> [limit]`",
          color: 0xFFA500
        }],
        messageReference: { messageID: msg.id }
      });
    }

    const userId = args[0].replace(/[<@!>]/g, "");
    const limit = parseInt(args[1]) || 10;
    const clampedLimit = Math.min(Math.max(limit, 1), 25);

    if (!/^\d{17,19}$/.test(userId)) {
      return msg.channel.createMessage({
        embeds: [{
          title: "❌ Invalid User ID",
          description: "Please provide a valid Discord user ID (17-19 digits).",
          color: 0xFF4D6D
        }],
        messageReference: { messageID: msg.id }
      });
    }

    const logs = readSpawnLogs({ userId, limit: clampedLimit });

    if (logs.length === 0) {
      return msg.channel.createMessage({
        embeds: [{
          title: "📋 Card Spawn Logs",
          description: `No spawn logs found for <@${userId}>.`,
          color: 0x5865F2
        }],
        messageReference: { messageID: msg.id }
      });
    }

    const logLines = logs.map((entry, i) => {
      const cosmicTag = entry.isCosmic ? ' 🌟' : '';
      const timestamp = `<t:${Math.floor(new Date(entry.timestamp).getTime() / 1000)}:R>`;
      return `**${i + 1}.** ${entry.rarity}${cosmicTag} \`${entry.cardCode || 'N/A'}\`\n` +
             `-# ${entry.group} ${entry.cardName} • ${entry.command} • ${timestamp}`;
    });

    return msg.channel.createMessage({
      embeds: [{
        title: `📋 Spawns for User (${logs.length})`,
        description: `**User:** <@${userId}>\n\n${logLines.join('\n\n')}`,
        color: 0x5865F2,
        footer: { text: `Showing last ${logs.length} spawns` }
      }],
      messageReference: { messageID: msg.id }
    });
  },

  async handleCardFilter(msg, args) {
    if (!args.length) {
      return msg.channel.createMessage({
        embeds: [{
          title: "⚠️ Missing Search Term",
          description: "Please provide a card name or group to search.\n\n**Usage:** `>spawnlog card <name> [limit]`",
          color: 0xFFA500
        }],
        messageReference: { messageID: msg.id }
      });
    }

    // Check if last arg is a number (limit)
    const lastArg = args[args.length - 1];
    const isLastArgNumber = /^\d+$/.test(lastArg);
    
    const limit = isLastArgNumber ? parseInt(lastArg) : 10;
    const cardName = isLastArgNumber ? args.slice(0, -1).join(' ') : args.join(' ');
    const clampedLimit = Math.min(Math.max(limit, 1), 25);

    const logs = readSpawnLogs({ cardName, limit: clampedLimit });

    if (logs.length === 0) {
      return msg.channel.createMessage({
        embeds: [{
          title: "📋 Card Spawn Logs",
          description: `No spawn logs found matching "${cardName}".`,
          color: 0x5865F2
        }],
        messageReference: { messageID: msg.id }
      });
    }

    const logLines = logs.map((entry, i) => {
      const cosmicTag = entry.isCosmic ? ' 🌟' : '';
      const timestamp = `<t:${Math.floor(new Date(entry.timestamp).getTime() / 1000)}:R>`;
      return `**${i + 1}.** ${entry.rarity}${cosmicTag} \`${entry.cardCode || 'N/A'}\`\n` +
             `-# ${entry.group} ${entry.cardName} • <@${entry.userId}> • ${entry.command} • ${timestamp}`;
    });

    return msg.channel.createMessage({
      embeds: [{
        title: `📋 Spawns for "${cardName}" (${logs.length})`,
        description: logLines.join('\n\n'),
        color: 0x5865F2,
        footer: { text: `Showing last ${logs.length} matches` }
      }],
      messageReference: { messageID: msg.id }
    });
  },

  async handleDateFilter(msg, args) {
    if (!args.length) {
      return msg.channel.createMessage({
        embeds: [{
          title: "⚠️ Missing Date",
          description: "Please provide a date range.\n\n**Usage:** `>spawnlog date <start> [end] [limit]`\n**Format:** YYYY-MM-DD\n**Example:** `>spawnlog date 2024-01-01 2024-01-31`",
          color: 0xFFA500
        }],
        messageReference: { messageID: msg.id }
      });
    }

    const startDate = args[0];
    const endDate = args[1] && !/^\d+$/.test(args[1]) ? args[1] : null;
    const limitArg = endDate ? args[2] : args[1];
    const limit = parseInt(limitArg) || 10;
    const clampedLimit = Math.min(Math.max(limit, 1), 25);

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate)) {
      return msg.channel.createMessage({
        embeds: [{
          title: "❌ Invalid Date Format",
          description: "Please use YYYY-MM-DD format (e.g., 2024-01-15).",
          color: 0xFF4D6D
        }],
        messageReference: { messageID: msg.id }
      });
    }

    const options = { startDate, limit: clampedLimit };
    if (endDate) {
      // Add end of day for end date
      options.endDate = endDate + 'T23:59:59.999Z';
    }

    const logs = readSpawnLogs(options);

    if (logs.length === 0) {
      const dateRange = endDate ? `${startDate} to ${endDate}` : `since ${startDate}`;
      return msg.channel.createMessage({
        embeds: [{
          title: "📋 Card Spawn Logs",
          description: `No spawn logs found for ${dateRange}.`,
          color: 0x5865F2
        }],
        messageReference: { messageID: msg.id }
      });
    }

    const logLines = logs.map((entry, i) => {
      const cosmicTag = entry.isCosmic ? ' 🌟' : '';
      const timestamp = `<t:${Math.floor(new Date(entry.timestamp).getTime() / 1000)}:R>`;
      return `**${i + 1}.** ${entry.rarity}${cosmicTag} \`${entry.cardCode || 'N/A'}\`\n` +
             `-# ${entry.group} ${entry.cardName} • <@${entry.userId}> • ${entry.command} • ${timestamp}`;
    });

    const dateRange = endDate ? `${startDate} to ${endDate}` : `since ${startDate}`;
    return msg.channel.createMessage({
      embeds: [{
        title: `📋 Spawns ${dateRange} (${logs.length})`,
        description: logLines.join('\n\n'),
        color: 0x5865F2,
        footer: { text: `Showing last ${logs.length} matches` }
      }],
      messageReference: { messageID: msg.id }
    });
  },

  async handleStats(msg) {
    const stats = getSpawnStats();

    if (stats.totalSpawns === 0) {
      return msg.channel.createMessage({
        embeds: [{
          title: "📊 Spawn Statistics",
          description: "No spawn data available yet.",
          color: 0x5865F2
        }],
        messageReference: { messageID: msg.id }
      });
    }

    const rarityLines = Object.entries(stats.byRarity)
      .sort((a, b) => b[1] - a[1])
      .map(([rarity, count]) => `• **${rarity}:** ${count}`)
      .join('\n');

    const commandLines = Object.entries(stats.byCommand)
      .sort((a, b) => b[1] - a[1])
      .map(([cmd, count]) => `• **${cmd}:** ${count}`)
      .join('\n');

    return msg.channel.createMessage({
      embeds: [{
        title: "📊 Spawn Statistics",
        fields: [
          { name: "Total Spawns", value: stats.totalSpawns.toString(), inline: true },
          { name: "Cosmic Cards", value: `🌟 ${stats.cosmicCount}`, inline: true },
          { name: "\u200B", value: "\u200B", inline: true },
          { name: "By Rarity", value: rarityLines || "N/A", inline: true },
          { name: "By Command", value: commandLines || "N/A", inline: true }
        ],
        color: 0x5865F2
      }],
      messageReference: { messageID: msg.id }
    });
  },

  showHelp(msg) {
    return msg.channel.createMessage({
      embeds: [{
        title: "📋 Spawn Log Commands",
        description: "View and filter card spawn logs.",
        fields: [
          { 
            name: "Recent Spawns", 
            value: "`>spawnlog [limit]`\nView most recent spawns (default: 10, max: 25)", 
            inline: false 
          },
          { 
            name: "Filter by User", 
            value: "`>spawnlog user <userID> [limit]`\nView spawns for a specific user", 
            inline: false 
          },
          { 
            name: "Filter by Card", 
            value: "`>spawnlog card <name> [limit]`\nSearch by card name or group", 
            inline: false 
          },
          { 
            name: "Filter by Date", 
            value: "`>spawnlog date <start> [end] [limit]`\nFilter by date range (YYYY-MM-DD)", 
            inline: false 
          },
          { 
            name: "Statistics", 
            value: "`>spawnlog stats`\nView spawn statistics", 
            inline: false 
          }
        ],
        color: 0x5865F2,
        footer: { text: "Admin only command" }
      }],
      messageReference: { messageID: msg.id }
    });
  }
};
