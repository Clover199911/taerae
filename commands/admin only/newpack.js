const UpdateCard = require("../../models/updatecards");
const { isAdmin } = require("../../config/constants");

module.exports = {
name: "newpack",
description: "Sets the range of card IDs for new update cards",
async execute(msg, args) {
// Check if the user has permission to use this command
if (!isAdmin(msg.author.id)) {
return msg.channel.createMessage({ content: "You are not authorized to run this command", messageReference: { messageID: msg.id } });
}

if (args.length !== 2) {
return msg.channel.createMessage({ content: "Please provide both start and end card IDs", messageReference: { messageID: msg.id } });
}

const startId = parseInt(args[0]);
const endId = parseInt(args[1]);

if (isNaN(startId) || isNaN(endId)) {
return msg.channel.createMessage({ content: "Please provide valid numeric IDs", messageReference: { messageID: msg.id } });
}

if (startId > endId) {
return msg.channel.createMessage({ content: "Start ID must be less than or equal to End ID", messageReference: { messageID: msg.id } });
}

try {
await UpdateCard.findOneAndUpdate({}, { startId, endId }, { upsert: true, new: true });
return msg.channel.createMessage({ content: `New update card range set: ${startId} to ${endId}`, messageReference: { messageID: msg.id } });
} catch (error) {
console.error("Error in newpack command:", error);
return msg.channel.createMessage({ content: "An error occurred while setting the new update card range", messageReference: { messageID: msg.id } });
}
},
};