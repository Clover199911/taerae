const Card = require("../../models/card");
const User = require("../../models/user");
const { isAdmin } = require("../../config/constants");

module.exports = {
  name: "fix",
  description: "Updates a card and all matching user cards based on cardID",
  async execute(msg, args) {
    try {
      // Check user authorization
      if (!isAdmin(msg.author.id)) {
        return msg.channel.createMessage({ content: "You are not authorized to run this command", messageReference: { messageID: msg.id } });
      }

      // Parse arguments
      const argString = args.join(" ");
      const [cardId, ...updateArgs] = argString.split(/\s+--\s+/);
      
      if (!cardId || updateArgs.length === 0) {
        return msg.channel.createMessage({ content: "Please provide a card ID and at least one field to update", messageReference: { messageID: msg.id } });
      }

      // Find the card in the Card database
      const card = await Card.findOne({ cardId: parseInt(cardId) });
      if (!card) {
        return msg.channel.createMessage({ content: "Card not found", messageReference: { messageID: msg.id } });
      }

      // Process updates
      const updates = {};
      const validFields = ['name', 'group', 'imageURL', 'imagePath', 'rarity'];
      updateArgs.forEach(arg => {
        const [field, ...valueParts] = arg.split(':').map(s => s.trim());
        const value = valueParts.join(':').trim(); // Rejoin in case the value contains colons
        if (validFields.includes(field)) {
          updates[field] = value;
        }
      });

      // Update the card in the Card database
      const cardUpdateResult = await Card.updateOne({ cardId: parseInt(cardId) }, updates);

      // Prepare search criteria for User database
      const searchCriteria = {
        rarity: updates.rarity || card.rarity,
        name: updates.name || card.name,
        imageURL: updates.imageURL || card.imageURL
      };

      // Update matching cards in the User database
      const userUpdateResult = await User.updateMany(searchCriteria, updates);

      // Prepare response
      const updatedFields = Object.keys(updates).join(', ');
      let response = `Updated card ${cardId} in Card database. ` +
                     `Updated ${userUpdateResult.modifiedCount} matching cards in User database. ` +
                     `Fields changed: ${updatedFields}.`;

      if (userUpdateResult.modifiedCount > 1) {
        response += `\nNote: Multiple user cards matched the criteria and were updated.`;
      }

      return msg.channel.createMessage({ content: response, messageReference: { messageID: msg.id } });

    } catch (error) {
      console.error("Error in fix command:", error);
      return msg.channel.createMessage({ content: "An error occurred while updating the cards", messageReference: { messageID: msg.id } });
    }
  },
};
