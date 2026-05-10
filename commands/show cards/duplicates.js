const Eris = require("eris");
const User = require("../../models/user");

function escapeRegExp(string) {
return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

moduleexports = {
name: "duplicates",
description: "View your duplicate cards",
execute: async (msg, args, client) => {
const userId = msg.author.id;
const query = { discordId: userId };
const cards = await User.find(query);

// Count duplicates
const cardCounts = {};
cards.forEach(card => {
const cardKey = `${card.imageURL}-${card.condition}`;
cardCounts[cardKey] = (cardCounts[cardKey] || 0) + 1;
});

// Filter duplicates
const duplicates = cards.filter(card => {
const cardKey = `${card.imageURL}-${card.condition}`;
return cardCounts[cardKey] > 1;
});

if (duplicates.length === 0) {
return msg.channel.createMessage({ content: "You don't have any duplicate cards.", messageReference: { messageID: msg.id } });
}

const pageSize = 7; // duplicates per page
const totalPages = Math.ceil(duplicates.length / pageSize);

const rarityOrder = ["standard", "unique", "glyph", "mythic"];
const rarityEmojis = {
standard: "<:x_:1256609888302272542><:Rx:1256632501523316778><:Rx:1256632501523316778><:Rx:1256632501523316778>",
unique: "<:xx:1256609884795965472><:xx:1256609884795965472><:Rxx:1256632495835709492><:Rxx:1256632495835709492>",
glyph: "<:xxx:1256609893239095396><:xxx:1256609893239095396><:xxx:1256609893239095396><:Rxxx:1256632499073978398>",
mythic: "<:xxxx:1256609881595838636><:xxxx:1256609881595838636><:xxxx:1256609881595838636><:xxxx:1256609881595838636>",
};

// Sort duplicates
duplicates.sort((a, b) => {
const rarityA = a.rarity.toLowerCase();
const rarityB = b.rarity.toLowerCase();
const groupA = a.group.toLowerCase();
const groupB = b.group.toLowerCase();
const nameA = a.name.toLowerCase();
const nameB = b.name.toLowerCase();

if (rarityA !== rarityB) {
return rarityOrder.indexOf(rarityA) - rarityOrder.indexOf(rarityB);
}
if (groupA !== groupB) {
return groupA.localeCompare(groupB);
}
return nameA.localeCompare(nameB);
});

const generateEmbed = (page) => {
const startIndex = (page - 1) * pageSize;
const endIndex = startIndex + pageSize;
const paginatedDuplicates = duplicates.slice(startIndex, endIndex);

let duplicatesDescription = "";
for (const card of paginatedDuplicates) {
const rarityEmoji = rarityEmojis[card.rarity.toLowerCase()];
const count = cardCounts[`${card.imageURL}-${card.condition}`];
duplicatesDescription += `${rarityEmoji} \`${card.cardCode}\` | **[${card.rarity}]** \`${card.group}\` [${card.name}](${card.imageURL}) (${card.condition}) (x${count})\n`;
}

return {
author: {
name: `${msg.author.username}'s Duplicate Cards`,
icon_url: msg.author.avatarURL,
},
title: `Duplicate Cards (Page ${page}/${totalPages})`,
description: duplicatesDescription,
color: 0x800080,
};
};

const generateButtons = (page) => {
return [
{
type: 2,
style: 2,
custom_id: "first",
emoji: { id: "1255876906058776668", name: "fleft" },
disabled: page === 1
},
{
type: 2,
style: 2,
custom_id: "prev",
emoji: { id: "1255876721752936521", name: "left" },
disabled: page === 1
},
{
type: 2,
style: 2,
custom_id: "next",
emoji: { id: "1255876719626289223", name: "right" },
disabled: page === totalPages
},
{
type: 2,
style: 2,
custom_id: "last",
emoji: { id: "1255876908378357771", name: "fright" },
disabled: page === totalPages
}
];
};

let currentPage = 1;

const initialMessage = await msg.channel.createMessage({
embeds: [generateEmbed(currentPage)],
messageReference: { messageID: msg.id },
components: [
{
type: 1,
components: generateButtons(currentPage)
}
]
});

const filter = (i) => i.message.id === initialMessage.id && i.member.id === msg.author.id;

const collector = async (i) => {
if (!filter(i)) return;

await i.acknowledge();

switch (i.data.custom_id) {
case "first":
currentPage = 1;
break;
case "prev":
currentPage = Math.max(1, currentPage - 1);
break;
case "next":
currentPage = Math.min(totalPages, currentPage + 1);
break;
case "last":
currentPage = totalPages;
break;
}

await i.editOriginalMessage({
embeds: [generateEmbed(currentPage)],
components: [
{
type: 1,
components: generateButtons(currentPage)
}
]
}).catch(console.error);
};

client.on("interactionCreate", collector);

setTimeout(() => {
client.removeListener("interactionCreate", collector);
initialMessage.edit({
components: []
}).catch(console.error);
}, 60000);
},
};