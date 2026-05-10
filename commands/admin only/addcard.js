const Card = require("../../models/card");
const Graphic = require("../../models/graphic");
const { ADMIN_IDS, isAdmin } = require("../../config/constants");
const { normalizeRelativeImagePath, buildPublicImageUrl } = require("../../utils/cardImageSource");

module.exports = {
name: "addcard",
description: "Adds a new card to the database",
async execute(msg, args) {

try {
if (msg.webhookID) {
console.log("Command triggered by webhook");
} else {
if (!isAdmin(msg.author.id)) {
console.log("Unauthorized user attempted to use command");
return msg.channel.createMessage({ content: "You are not authorized to run this command", messageReference: { messageID: msg.id } });
}
}

const argString = args.join(" ");
const [rarityArg, nameArg, groupArg, imageArg, imagePathArg] = argString.split(",").map(arg => arg.trim());
console.log(`Parsed arguments: ${rarityArg}, ${nameArg}, ${groupArg}, ${imageArg}, ${imagePathArg}`);

if (!rarityArg || !nameArg || !groupArg || !imageArg) {
console.log("Missing required arguments");
return msg.channel.createMessage({ content: "Please provide a rarity, name, group, and image URL", messageReference: { messageID: msg.id } });
}

const rarity = rarityArg.split("=")[1];
const name = nameArg.split("=")[1];
const group = groupArg.split("=")[1];
let imageURL = imageArg.split("=")[1];
let imagePath = imagePathArg?.startsWith("imagePath=") ? normalizeRelativeImagePath(imagePathArg.split("=")[1]) : null;

if (imagePath) {
  const publicURL = buildPublicImageUrl(imagePath);
  if (!publicURL) {
    return msg.channel.createMessage({
      content: "PUBLIC_BASE_URL (or HEROKU_APP_NAME) is required when using imagePath.",
      messageReference: { messageID: msg.id }
    });
  }
  imageURL = publicURL;
}

const existingCard = await Card.findOne({ imageURL, name, group, rarity });
if (existingCard) {
console.log("Card already exists in database");
return msg.channel.createMessage({ content: "This card is already in the database!", messageReference: { messageID: msg.id } });
}

const validRarities = ["Standard", "Unique", "Glyph", "Mythic", "Event"];
if (!validRarities.includes(rarity)) {
console.log("Invalid rarity provided");
return msg.channel.createMessage({ content: "Only valid rarities are: Standard, Unique, Glyph, Mythic, and Event!", messageReference: { messageID: msg.id } });
}

const lastCard = await Card.findOne({}, {}, { sort: { cardId: -1 } });
const nextCardId = lastCard ? lastCard.cardId + 1 : 1;

const card = new Card({
cardId: nextCardId,
rarity,
name,
group,
imageURL,
imagePath,
spawnable: true,
dateAdded: new Date(),
printCounter: 0 // Initialize print counter at 0
});

await card.save();
console.log("Card saved to database");

const embed = {
author: {
name: msg.author ? msg.author.username : "Webhook",
icon_url: msg.author ? msg.author.avatarURL : null,
},
description: `## Card Added
**Rarity**
- ${card.rarity}
**Group**
- ${card.group}
**Name**
- ${card.name}
**Card Id**
- ${card.cardId}
**Spawnable**
- ${card.spawnable}
**Date Added**
- ${card.dateAdded.toISOString().split('T')[0]}
`,
thumbnail: {
url: card.imageURL,
},
};

return msg.channel.createMessage({embed, messageReference: { messageID: msg.id }}).then(() => {
console.log("Response sent successfully");
}).catch((error) => {
console.error("Error sending response:", error);
});
} catch (error) {
console.error("Error in addcard command:", error);
return msg.channel.createMessage({ content: "An error occurred while adding the card to the database", messageReference: { messageID: msg.id } }).catch((sendError) => {
console.error("Error sending error message:", sendError);
});
}
},
};
