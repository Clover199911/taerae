module.exports = {
  weeklyRewards: {
    1: { type: 'CARD', rarity: 'Glyph', count: 1 },                          // Monday
    2: { type: 'CARD', condition: 'pristine', count: 1 },                    // Tuesday
    3: { type: 'CRYSTALS', amount: 2000 },                                   // Wednesday
    4: { type: 'CARD', rarity: 'Standard', count: 1 },                       // Thursday
    5: { type: 'ASTRAL_ESSENCE', amount: 50 },                               // Friday
    6: { type: 'CARD', rarity: 'Unique', count: 2 },                         // Saturday
    7: { type: 'CARD', rarity: 'Mythic', count: 1, condition: 'pristine' }   // Sunday
  },
  specialDateRewards: {
    1: { type: 'CARD', count: 15, condition: 'pristine' },
    2: { type: 'CARD', count: 5, rarity:'Mythic',  condition: 'pristine' },
    20: { type: 'CARD', count: 10, condition: 'pristine' },  // 1st of month
    21: { type: 'CARD', count: 5, condition: 'pristine' },  // 2nd of month
    22: { type: 'CRYSTALS', amount: 10000 },               // 3rd of month
  }
};