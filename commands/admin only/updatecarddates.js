const Card = require("../../models/card");
const { isAdmin } = require("../../config/constants");

module.exports = {
name: "updatecarddates",
description: "Updates existing cards with dateAdded field based on discord channel messages",
async execute(msg, args) {
try {
if (!isAdmin(msg.author.id)) {
console.log(`Unauthorized user ${msg.author.id} attempted to use updatecarddates command`);
return msg.channel.createMessage({ content: "You are not authorized to run this command", messageReference: { messageID: msg.id } });
}

const channelId = args[0];
const startFromMessageId = args[1];
if (!channelId) {
console.log("Channel ID not provided");
return msg.channel.createMessage({ content: "Please provide the channel ID", messageReference: { messageID: msg.id } });
}

const channel = msg.channel.guild.channels.get(channelId);
if (!channel) {
console.log(`Invalid channel ID provided: ${channelId}`);
return msg.channel.createMessage({ content: "Invalid channel ID", messageReference: { messageID: msg.id } });
}

console.log(`Starting to update card dates from channel ${channelId}`);

let before = startFromMessageId || null;
let updatedCount = 0;
let processedMessages = 0;

while (true) {
const messages = await channel.getMessages({ limit: 100, before });
if (messages.length === 0) break;

console.log(`Processing batch of ${messages.length} messages`);

for (const message of messages) {
    processedMessages++;
    if (message.content.startsWith("?addcard")) {
    const cardInfo = parseAddCardCommand(message.content);
    if (cardInfo) {
        const updatedCard = await Card.findOneAndUpdate(
        { name: cardInfo.name, group: cardInfo.group, rarity: cardInfo.rarity },
        { $set: { dateAdded: message.timestamp } },
        { new: true }
        );
        if (updatedCard) {
        updatedCount++;
        console.log(`Updated card: ${updatedCard.name} (${updatedCard.group}) with date ${message.timestamp}`);
        } else {
        console.log(`Could not find card to update: ${cardInfo.name} (${cardInfo.group})`);
        }
    }
    }
}

before = messages[messages.length - 1].id;
console.log(`Processed ${processedMessages} messages so far, updated ${updatedCount} cards`);
}

console.log(`Finished processing. Total messages processed: ${processedMessages}, Total cards updated: ${updatedCount}`);
return msg.channel.createMessage({ content: `Updated ${updatedCount} cards with dateAdded field. Processed ${processedMessages} messages.`, messageReference: { messageID: msg.id } });
} catch (error) {
console.error("Error in updatecarddates command:", error);
return msg.channel.createMessage({ content: "An error occurred while updating card dates", messageReference: { messageID: msg.id } });
}
},
};

function parseAddCardCommand(content) {
const match = content.match(/\?addcard rarity=(.+), name=(.+), group=(.+), image=(.+)/);
if (match) {
return {
rarity: match[1].trim(),
name: match[2].trim(),
group: match[3].trim(),
imageURL: match[4].trim()
};
}
return null;
}