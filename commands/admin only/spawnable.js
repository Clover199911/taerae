const Card = require("../../models/card");
const { isAdmin } = require("../../config/constants");

module.exports = {
name: "updatespawnable",
description: "Updates all existing cards to have spawnable: true",
async execute(msg, args) {
try {
    // Authorization check
    if (!isAdmin(msg.author.id)) {
    console.log("Unauthorized user attempted to use command");
    return msg.channel.createMessage({ content: "You are not authorized to run this command", messageReference: { messageID: msg.id } });
    }

    const result = await Card.updateMany({}, { $set: { spawnable: true } });

    console.log(`Updated ${result.modifiedCount} cards`);
    return msg.channel.createMessage({ content: `Successfully updated ${result.modifiedCount} cards to be spawnable.`, messageReference: { messageID: msg.id } });
} catch (error) {
    console.error("Error in updatespawnable command:", error);
    return msg.channel.createMessage({ content: "An error occurred while updating the cards in the database", messageReference: { messageID: msg.id } });
}
},
};