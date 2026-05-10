const Blacklist = require("../../models/blacklist");
const { isAdmin } = require("../../config/constants");

module.exports = {
  name: "blacklistinfo",
  aliases: ["bli", "checkbl"],
  description: "Check if a user is blacklisted",
  async execute(msg, args, client) {
    // Admin check
    if (!isAdmin(msg.author.id)) {
      console.log(`Unauthorized user ${msg.author.id} attempted to use blacklistinfo command`);
      return msg.channel.createMessage({
        content: "You are not authorized to run this command",
        messageReference: { messageID: msg.id }
      });
    }

    // Check for user argument
    if (!args || args.length < 1) {
      return msg.channel.createMessage({
        embeds: [{
          title: "⚠️ Missing Arguments",
          description: "Please provide a user ID or mention.\n\n**Usage:** `?blacklistinfo <userID>`\n**Example:** `?blacklistinfo 123456789012345678`",
          color: 0xFFA500
        }],
        messageReference: { messageID: msg.id }
      });
    }

    // Parse user ID from mention or direct ID
    let targetUserId;
    if (msg.mentions && msg.mentions.length > 0) {
      targetUserId = msg.mentions[0].id;
    } else {
      // Extract numeric ID (remove any non-numeric characters)
      targetUserId = args[0].replace(/[<@!>]/g, "");
    }

    // Validate user ID format
    if (!/^\d{17,19}$/.test(targetUserId)) {
      return msg.channel.createMessage({
        embeds: [{
          title: "❌ Invalid User ID",
          description: "Please provide a valid Discord user ID (17-19 digits).",
          color: 0xFF4D6D
        }],
        messageReference: { messageID: msg.id }
      });
    }

    try {
      const blacklistEntry = await Blacklist.findOne({ userId: targetUserId });
      
      if (!blacklistEntry) {
        return msg.channel.createMessage({
          embeds: [{
            title: "✅ Not Blacklisted",
            description: `<@${targetUserId}> is not on the blacklist.`,
            color: 0x00FF00
          }],
          messageReference: { messageID: msg.id }
        });
      }

      return msg.channel.createMessage({
        embeds: [{
          title: "🚫 User is Blacklisted",
          description: `<@${targetUserId}> is currently blacklisted.`,
          fields: [
            { name: "User ID", value: targetUserId, inline: true },
            { name: "Reason", value: blacklistEntry.reason, inline: true },
            { name: "Blacklisted By", value: `<@${blacklistEntry.blacklistedBy}>`, inline: true },
            { name: "Date", value: `<t:${Math.floor(blacklistEntry.blacklistedAt.getTime() / 1000)}:F>`, inline: false }
          ],
          color: 0xFF4D6D
        }],
        messageReference: { messageID: msg.id }
      });

    } catch (error) {
      console.error("Error checking blacklist:", error);
      return msg.channel.createMessage({
        embeds: [{
          title: "❌ Error",
          description: "An error occurred while checking the blacklist. Please try again.",
          color: 0xFF4D6D
        }],
        messageReference: { messageID: msg.id }
      });
    }
  }
};
