const Blacklist = require("../../models/blacklist");
const { isAdmin } = require("../../config/constants");

module.exports = {
  name: "blacklist",
  aliases: ["bl"],
  description: "Blacklist a user from using the bot",
  async execute(msg, args, client) {
    // Admin check
    if (!isAdmin(msg.author.id)) {
      console.log(`Unauthorized user ${msg.author.id} attempted to use blacklist command`);
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
          description: "Please provide a user ID or mention.\n\n**Usage:** `?blacklist <userID> [reason]`\n**Example:** `?blacklist 123456789012345678 Cheating`",
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

    // Prevent blacklisting admins
    if (isAdmin(targetUserId)) {
      return msg.channel.createMessage({
        embeds: [{
          title: "❌ Cannot Blacklist Admin",
          description: "You cannot blacklist a bot administrator.",
          color: 0xFF4D6D
        }],
        messageReference: { messageID: msg.id }
      });
    }

    // Prevent self-blacklist
    if (targetUserId === msg.author.id) {
      return msg.channel.createMessage({
        embeds: [{
          title: "❌ Cannot Blacklist Yourself",
          description: "You cannot blacklist yourself.",
          color: 0xFF4D6D
        }],
        messageReference: { messageID: msg.id }
      });
    }

    // Get reason (everything after the user ID)
    const reason = args.slice(1).join(" ") || "No reason provided";

    try {
      // Check if already blacklisted
      const existingBlacklist = await Blacklist.findOne({ userId: targetUserId });
      if (existingBlacklist) {
        return msg.channel.createMessage({
          embeds: [{
            title: "⚠️ Already Blacklisted",
            description: `<@${targetUserId}> is already blacklisted.`,
            fields: [
              { name: "Reason", value: existingBlacklist.reason, inline: true },
              { name: "Blacklisted By", value: `<@${existingBlacklist.blacklistedBy}>`, inline: true },
              { name: "Date", value: `<t:${Math.floor(existingBlacklist.blacklistedAt.getTime() / 1000)}:F>`, inline: true }
            ],
            color: 0xFFA500
          }],
          messageReference: { messageID: msg.id }
        });
      }

      // Create blacklist entry
      const blacklistEntry = new Blacklist({
        userId: targetUserId,
        reason: reason,
        blacklistedBy: msg.author.id
      });
      await blacklistEntry.save();

      return msg.channel.createMessage({
        embeds: [{
          title: "🚫 User Blacklisted",
          description: `<@${targetUserId}> has been blacklisted from using Taerae.`,
          fields: [
            { name: "User ID", value: targetUserId, inline: true },
            { name: "Reason", value: reason, inline: true },
            { name: "Blacklisted By", value: `<@${msg.author.id}>`, inline: true }
          ],
          color: 0xFF4D6D,
          footer: { text: "Use ?unblacklist to remove" }
        }],
        messageReference: { messageID: msg.id }
      });

    } catch (error) {
      console.error("Error blacklisting user:", error);
      return msg.channel.createMessage({
        embeds: [{
          title: "❌ Error",
          description: "An error occurred while blacklisting the user. Please try again.",
          color: 0xFF4D6D
        }],
        messageReference: { messageID: msg.id }
      });
    }
  }
};
