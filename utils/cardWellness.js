const wellnessRanges = {
Standard: { min: 100, max: 300 },
Unique: { min: 250, max: 300 },
Glyph: { min: 250, max: 300 },
Mythic: { min: 300, max: 1000 }
};

const getRandomWellness = (min, max) => {
return Math.floor(Math.random() * (max - min + 1)) + min;
};

function getCardWellness(rarity) {
const range = wellnessRanges[rarity];
if (!range) {
    console.warn(`Unknown rarity: ${rarity}. Defaulting to Standard range.`);
    return getRandomWellness(wellnessRanges.Standard.min, wellnessRanges.Standard.max);
}
return getRandomWellness(range.min, range.max);
}

module.exports = { getCardWellness };