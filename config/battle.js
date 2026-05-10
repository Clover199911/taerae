// config/battle.js - Battle system configuration
// ============================================================================

module.exports = {
    // Emoji configuration
    EMOJI: {
      // Battle states
      vs: "⚔️",
      win: "🏆",
      lose: "💔",
      draw: "🤝",
      
      // Actions
      reroll: "🔄",
      battle: "⚡",
      select: "👆",
      
      // Status
      success: "<:check:1461015775266603110>",
      fail: "<:cross:1461015696954753034>",
      warning: "⚠️",
      loading: "⏳",
      
      // Currency
      crystals: "<:rose:1461015415466496191>",
    },
  
    // Battle configuration
    BATTLE_CONFIG: {
      cooldownDuration: 1800000, // 30 minutes
      maxRerolls: 5,
      rerollCost: 500,
      selectionTimeout: 120000, // 2 minutes
      requiredCards: 5,
      randomBonus: 15, // Max random points added to score
    },
  
    // Score weights for win calculation
    SCORE_WEIGHTS: {
      rarity: {
        'Mythic': 4,
        'Glyph': 3,
        'Unique': 2,
        'Standard': 1
      },
      condition: {
        'Pristine': 5,
        'Mint': 4,
        'Good': 3,
        'Worn': 2,
        'Damaged': 1
      },
      rarityMultiplier: 10 // Rarity is weighted higher
    },
  
    // Card dimensions (same as drop.js)
    CARD_DIMENSIONS: {
      width: 300,
      height: 480,
      padding: 5
    }
  };