const Currency = require("../../models/currency");

module.exports = {
  name: "updatecurrency",
  description: "Updates all user records with the new selca field",
  async execute(msg, args, client) {
    // Check if the user has permission to run this command
    if (!msg.member.permissions.has("administratorPermission")) {
      return msg.channel.createMessage({ content: "You don't have permission to use this command.", messageReference: { messageID: msg.id } });
    }

    try {
      const updateResult = await Currency.updateMany(
        { selca: { $exists: false } },
        { $set: { selca: 0 } }
      );

      const embed = {
        title: "Currency Schema Update",
        description: `Updated ${updateResult.nModified} user records with the new selca field.`,
        color: 0x00FF00,
        footer: {
          text: "Currency schema update complete",
          icon_url: client.user.avatarURL
        },
        timestamp: new Date()
      };

      await msg.channel.createMessage({ embed, messageReference: { messageID: msg.id } });
    } catch (error) {
      console.error("Error updating currency schema:", error);
      await msg.channel.createMessage({ content: "An error occurred while updating the currency schema. Please check the logs.", messageReference: { messageID: msg.id } });
    }
  },
};