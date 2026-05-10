const Currency = require("../../models/currency");
const Eris = require("eris");
const { isAdmin } = require("../../config/constants");

module.exports = {
name: "adminpay",
description: "Admin command to pay fragments and Crystals based on card rarities",
async execute(msg, args, client) {
if (!isAdmin(msg.author.id)) {
console.log(`Unauthorized user ${msg.author.id} attempted to use adminpay command`);
return msg.channel.createMessage({ content: "You are not authorized to run this command", messageReference: { messageID: msg.id } });
}

if (!args || args.length < 2) {
return msg.channel.createMessage({ content: "Please provide a user mention or Discord ID and the card quantities (e.g., ?adminpay @user S:2, M:1)", messageReference: { messageID: msg.id } });
}

const recipient = msg.mentions[0] || args[0];
let recipientId;

if (recipient.id) {
recipientId = recipient.id;
} else {
recipientId = recipient;
}

const cardCountsInput = args.slice(1).join(" ");
const cardCounts = parseCardCounts(cardCountsInput);
if (!cardCounts) {
return msg.channel.createMessage({ content: "Invalid card count format. Please use the format like S:2, M:1", messageReference: { messageID: msg.id } });
}

const { fantasiaTokens, stardust, reverieGem, astralEssence, crystals } = calculateRewards(cardCounts);

const recipientCurrency = await Currency.findOne({ userId: recipientId });
if (!recipientCurrency) {
return msg.channel.createMessage({ content: "The recipient does not have a currency balance.", messageReference: { messageID: msg.id } });
}

const confirmationEmbed = {
title: "Admin Payment Confirmation",
description: `Are you sure you want to award <@${recipientId}>:

**${fantasiaTokens}** Fantasia Tokens
**${stardust}** Stardust
**${reverieGem}** Reverie Gem
**${astralEssence}** Astral Essence
**${crystals}** Crystals

Based on:
${Object.entries(cardCounts)
.filter(([_, count]) => count > 0)
.map(([rarity, count]) => `${rarity}: ${count}`)
.join("\n")}`,
color: 0xcaf0f8,
};

const generateButtons = () => {
return [
{
type: 2,
style: 3,
custom_id: "confirm_adminpay",
label: "Yes"
},
{
type: 2,
style: 4,
custom_id: "cancel_adminpay",
label: "No"
}
];
};

const confirmationMessage = await msg.channel.createMessage({
embeds: [confirmationEmbed],
messageReference: { messageID: msg.id },
components: [
{
type: 1,
components: generateButtons()
}
]
});

const filter = (i) => i.message.id === confirmationMessage.id && i.member.id === msg.author.id;

let interactionHandled = false;

const collector = async (i) => {
if (!filter(i)) return;

await i.acknowledge();

if (i.data.custom_id === "confirm_adminpay") {
recipientCurrency.fantasiaTokens += fantasiaTokens;
recipientCurrency.stardust += stardust;
recipientCurrency.reverieGem += reverieGem;
recipientCurrency.astralEssence += astralEssence;
recipientCurrency.crystals += crystals;

await recipientCurrency.save();

const successEmbed = {
title: "Admin Payment Successful",
description: `<@${recipientId}> has been awarded:

**${fantasiaTokens}** Fantasia Tokens
**${stardust}** Stardust
**${reverieGem}** Reverie Gem
**${astralEssence}** Astral Essence
**${crystals}** Crystals`,
fields: [
{
name: "Card Counts",
value: Object.entries(cardCounts)
.filter(([_, count]) => count > 0)
.map(([rarity, count]) => `${rarity}: ${count}`)
.join("\n") || "None",
inline: true
}
],
color: 0x00ff00,
footer: { text: "Admin Payment" }
};

await i.editOriginalMessage({ embeds: [successEmbed], components: [] });
interactionHandled = true;
} else if (i.data.custom_id === "cancel_adminpay") {
const cancelEmbed = {
description: "Admin payment operation cancelled.",
color: 0xff4d6d,
};
await i.editOriginalMessage({ embeds: [cancelEmbed], components: [] });
interactionHandled = true;
}

client.removeListener("interactionCreate", collector);
};

client.on("interactionCreate", collector);

setTimeout(() => {
client.removeListener("interactionCreate", collector);
if (!interactionHandled) {
confirmationMessage.edit({
embeds: [{
description: "Admin payment operation timed out.",
color: 0xff4d6d,
}],
components: []
}).catch(console.error);
}
}, 30000);
}
};

function parseCardCounts(input) {
const counts = { S: 0, U: 0, G: 0, M: 0 };
const regex = /([SUGSM]):(\d+)/gi;
let match;

while ((match = regex.exec(input)) !== null) {
counts[match[1].toUpperCase()] = parseInt(match[2]);
}

return Object.values(counts).some(count => count > 0) ? counts : null;
}

function calculateRewards(cardCounts) {
const fragmentRates = {
S: { fantasiaTokens: 2, stardust: 2, reverieGem: 2, astralEssence: 2 },
U: { fantasiaTokens: 3, stardust: 3, reverieGem: 3, astralEssence: 3 },
G: { fantasiaTokens: 5, stardust: 5, reverieGem: 5, astralEssence: 5 },
M: { fantasiaTokens: 7, stardust: 7, reverieGem: 7, astralEssence: 7 }
};
const crystalRates = { S: 1000, U: 2000, G: 3000, M: 4500 };

let totalFantasiaTokens = 0;
let totalStardust = 0;
let totalReverieGem = 0;
let totalAstralEssence = 0;
let totalCrystals = 0;

for (const [rarity, count] of Object.entries(cardCounts)) {
totalFantasiaTokens += fragmentRates[rarity].fantasiaTokens * count;
totalStardust += fragmentRates[rarity].stardust * count;
totalReverieGem += fragmentRates[rarity].reverieGem * count;
totalAstralEssence += fragmentRates[rarity].astralEssence * count;
totalCrystals += crystalRates[rarity] * count;
}

return {
fantasiaTokens: totalFantasiaTokens,
stardust: totalStardust,
reverieGem: totalReverieGem,
astralEssence: totalAstralEssence,
crystals: totalCrystals
};
}