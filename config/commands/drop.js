module.exports = {
  cooldownDuration: 300000, // 5 minutes
  selectionTimeout: 180000, // 3 minutes
  cardDimensions: {
    width: 300,
    height: 480
  },
  rarities: [
    { name: "Standard", chance: 70, color: 0xcaf0f8, emoji: "★☆☆☆" },
    { name: "Unique", chance: 25, color: 0x00b4d8, emoji: "★★☆☆" },
    { name: "Glyph", chance: 4, color: 0x48cae4, emoji: "★★★☆" },
    { name: "Mythic", chance: 1, color: 0x03045e, emoji: "★★★★" }
  ],
  conditionEmojis: {
    damaged: "1268950803830407249",
    worn: "1460381763988619489",
    good: "1460381686515634197",
    mint: "1268950809404641401",
    pristine: "1272529510696222842"
  }
};