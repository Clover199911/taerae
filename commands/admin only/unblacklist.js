const Blacklist = require("../../models/blacklist");
const { isAdmin } = require("../../config/constants");

module.exports = {
  name: "unblacklist",
  aliases: ["ubl", "unbl"],
  description: "Remove a user from the blacklist",
  async execute(msg, args, client) {
    // Admin check
    if (!isAdmin(msg.author.id)) {
      console.log(`Unauthorized user ${msg.author.id} attempted to use unblacklist command`);
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
          description: "Please provide a user ID or mention.\n\n**Usage:** `?unblacklist <userID>`\n**Example:** `?unblacklist 123456789012345678`",
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
      // Find and remove blacklist entry
      const blacklistEntry = await Blacklist.findOneAndDelete({ userId: targetUserId });
      
      if (!blacklistEntry) {
        return msg.channel.createMessage({
          embeds: [{
            title: "⚠️ Not Blacklisted",
            description: `<@${targetUserId}> is not on the blacklist.`,
            color: 0xFFA500
          }],
          messageReference: { messageID: msg.id }
        });
      }

      return msg.channel.createMessage({
        embeds: [{
          title: "✅ User Unblacklisted",
          description: `<@${targetUserId}> has been removed from the blacklist.`,
          fields: [
            { name: "User ID", value: targetUserId, inline: true },
            { name: "Previous Reason", value: blacklistEntry.reason, inline: true },
            { name: "Removed By", value: `<@${msg.author.id}>`, inline: true }
          ],
          color: 0x00FF00
        }],
        messageReference: { messageID: msg.id }
      });

    } catch (error) {
      console.error("Error unblacklisting user:", error);
      return msg.channel.createMessage({
        embeds: [{
          title: "❌ Error",
          description: "An error occurred while removing the user from the blacklist. Please try again.",
          color: 0xFF4D6D
        }],
        messageReference: { messageID: msg.id }
      });
    }
  }
};
