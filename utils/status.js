const conditionProbabilities = [
{ condition: "Pristine", weight: 5 },
{ condition: "Mint", weight: 10 },
{ condition: "Good", weight: 20 },
{ condition: "Worn", weight: 30 },
{ condition: "Damaged", weight: 40 },
];

function getRandomCardCondition() {
const totalWeight = conditionProbabilities.reduce((sum, condition) => sum + condition.weight, 0);
const randomNum = Math.random() * totalWeight;

let cumulativeWeight = 0;
for (const condition of conditionProbabilities) {
    cumulativeWeight += condition.weight;
    if (randomNum <= cumulativeWeight) {
    return condition.condition;
    }
}

return "Good"; // Fallback to "Good" condition if needed
}

module.exports = { conditionProbabilities, getRandomCardCondition };
