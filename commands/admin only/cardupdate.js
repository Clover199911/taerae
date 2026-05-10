const Card = require("../../models/card");
const { isAdmin } = require("../../config/constants");

module.exports = {
name: "spawn",
description: "Updates the spawnable status for specified card IDs",
async execute(msg, args) {
try {
// Authorization check
if (!isAdmin(msg.author.id)) {
console.log("Unauthorized user attempted to use command");
return msg.channel.createMessage({ content: "You are not authorized to run this command", messageReference: { messageID: msg.id } });
}

if (args.length < 2) {
return msg.channel.createMessage({ content: "Usage: ?spawn <true/false> <cardId1,cardId2,cardId3...>", messageReference: { messageID: msg.id } });
}

const spawnableStatus = args[0].toLowerCase() === 'true';
const cardIds = args.slice(1).join('').split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));

if (cardIds.length === 0) {
return msg.channel.createMessage({ content: "No valid card IDs provided", messageReference: { messageID: msg.id } });
}

const result = await Card.updateMany(
{ cardId: { $in: cardIds } },
{ $set: { spawnable: spawnableStatus } }
);

console.log(`Updated ${result.modifiedCount} cards`);
return msg.channel.createMessage({ content: `Successfully updated spawnable status to ${spawnableStatus} for ${result.modifiedCount} cards.`, messageReference: { messageID: msg.id } });
} catch (error) {
console.error("Error in updatespawn command:", error);
return msg.channel.createMessage({ content: "An error occurred while updating the cards in the database", messageReference: { messageID: msg.id } });
}
},
};