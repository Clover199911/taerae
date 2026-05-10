const User = require("../../models/user");
const { isAdmin } = require("../../config/constants");

module.exports = {
name: "update",
description: "Updates all old cards in the database to include a card condition",
execute: async (msg, args) => {
if (!isAdmin(msg.author.id)) {
    return msg.channel.createMessage({ content: "You are not authorized to run this command", messageReference: { messageID: msg.id } });
}

try {
    const oldCards = await User.find({ condition: { $exists: false } });

    for (const oldCard of oldCards) {
    const cardCondition = getRandomCardCondition();
    oldCard.condition = cardCondition;
    await oldCard.save();
    }

    return msg.channel.createMessage({ content: "All old cards have been updated with a card status.", messageReference: { messageID: msg.id } });
} catch (err) {
    console.error(err);
    return msg.channel.createMessage({ content: "Failed to update old cards. Please try again later.", messageReference: { messageID: msg.id } });
}
},
};

const conditionProbabilities = [
  { condition: "Pristine", weight: 5 }, // 20% chance of being Pristine
  { condition: "Mint", weight: 15 }, // 30% chance of being Mint
  { condition: "Good", weight: 20 }, // 25% chance of being Good
  { condition: "Worn", weight: 30 }, // 15% chance of being Worn
  { condition: "Damaged", weight: 40 }, // 10% chance of being Damaged
];

function getRandomCardCondition() {
// Calculate the total weight sum
const totalWeight = conditionProbabilities.reduce((sum, condition) => sum + condition.weight, 0);

// Generate a random number between 0 and the total weight sum
const randomNum = Math.random() * totalWeight;

// Find the card condition that matches the random number
let cumulativeWeight = 0;
for (const condition of conditionProbabilities) {
    cumulativeWeight += condition.weight;
    if (randomNum <= cumulativeWeight) {
    return condition.condition;
    }
}

// In case something goes wrong, fallback to "Good" condition
return "Good";
}
