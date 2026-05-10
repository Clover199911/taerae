// ============================================================================
// TIER CONFIGURATION - Easy to edit and expand!
// ============================================================================
// Add more tiers by following the pattern below
// Each tier needs: requirement + reward
// ============================================================================

const TIER_CONFIG = {
// ========== TIER 1-5: Beginner Tiers ==========
tier1: {
    requirement: { cardCount: 300 },
    reward: { 
    type: 'CARD', 
    rarity: 'Standard', 
    count: 1, 
    condition: 'pristine' 
    },
    name: 'Collector Initiate',
    description: 'Welcome to the collection journey!'
},

tier2: {
    requirement: { cardCount: 500 },
    reward: { 
    type: 'CURRENCY', 
    crystals: 1500 
    },
    name: 'Rising Star',
    description: 'Your collection is growing!'
},

tier3: {
    requirement: { cardCount: 750 },
    reward: { 
    type: 'CARD', 
    rarity: 'Unique', 
    count: 3 
    },
    name: 'Card Enthusiast',
    description: 'Keep up the momentum!'
},

tier4: {
    requirement: { cardCount: 1000 },
    reward: { 
    type: 'CURRENCY', 
    astralEssence: 30 
    },
    name: 'Dedicated Collector',
    description: 'Your dedication is paying off!'
},

tier5: {
    requirement: { cardCount: 1250 },
    reward: { 
    type: 'CARD', 
    rarity: 'Glyph', 
    count: 1, 
    condition: 'pristine' 
    },
    name: 'Glyph Seeker',
    description: 'Rare treasures await!'
},

// ========== TIER 6-10: Intermediate Tiers ==========
tier6: {
    requirement: { cardCount: 1500 },
    reward: { 
    type: 'PACK', 
    packType: 'normal-10',  // ← CHANGE PACK TYPE HERE
    count: 2 
    },
    name: 'Pack Hunter',
    description: 'Time to open some packs!'
},

tier7: {
    requirement: { cardCount: 2000 },
    reward: { 
    type: 'CARD', 
    rarity: 'Mythic', 
    count: 1, 
    condition: 'pristine' 
    },
    name: 'Mythic Discoverer',
    description: 'Your first pristine mythic!'
},

tier8: {
    requirement: { cardCount: 2500 },
    reward: { 
    type: 'CURRENCY', 
    crystals: 3000,
    astralEssence: 20
    },
    name: 'Resource Master',
    description: 'Double the rewards!'
},

tier9: {
    requirement: { cardCount: 3000 },
    reward: { 
    type: 'CARD_GENERATION',
    rarity: 'Glyph',
    count: 5,
    pristineChance: 0.3  // 30% chance each card is pristine
    },
    name: 'Card Summoner',
    description: 'Generate cards on the spot!'
},

tier10: {
    requirement: { cardCount: 3500 },
    reward: { 
    type: 'CHOICE',
    options: [
        { type: 'PACK', packType: 'premium-5', count: 3 },
        { type: 'CARD', rarity: 'Mythic', count: 3, condition: 'pristine' },
        { type: 'CURRENCY', crystals: 5000, astralEssence: 50 }
    ]
    },
    name: 'Decision Maker',
    description: 'Choose your own reward!'
},

// ========== TIER 11-15: Advanced Tiers ==========
tier11: {
    requirement: { cardCount: 3750 },
    reward: { 
    type: 'CURRENCY', 
    crystals: 4000,
    stardust: 10  // Different currency!
    },
    name: 'Stardust Collector',
    description: 'Rare currency unlocked!'
},

tier12: {
    requirement: { cardCount: 4000 },
    reward: { 
    type: 'PACK', 
    packType: 'premium-10',  // ← CHANGE PACK TYPE HERE
    count: 2 
    },
    name: 'Premium Member',
    description: 'Premium packs unlocked!'
},

tier13: {
    requirement: { cardCount: 4500 },
    reward: { 
    type: 'CARD_GENERATION',
    rarity: 'Mythic',
    count: 3,
    pristineChance: 0.5  // 50% pristine chance!
    },
    name: 'Mythic Creator',
    description: 'Create your own mythics!'
},

tier14: {
    requirement: { cardCount: 5000 },
    reward: { 
    type: 'CURRENCY', 
    crystals: 6000,
    astralEssence: 40,
    stardust: 20
    },
    name: 'Triple Threat',
    description: 'Three currencies at once!'
},

tier15: {
    requirement: { cardCount: 5250 },
    reward: { 
    type: 'CHOICE',
    options: [
        { type: 'PACK', packType: 'ascent-2', count: 2 },
        { type: 'CARD', rarity: 'Mythic', count: 5, condition: 'pristine' },
        { type: 'CARD_GENERATION', rarity: 'Glyph', count: 10, pristineChance: 0.4 }
    ]
    },
    name: 'Elite Collector',
    description: 'Elite rewards await!'
},

// ========== TIER 16-20: Master Tiers ==========
tier16: {
    requirement: { cardCount: 5500 },
    reward: { 
    type: 'PACK', 
    packType: 'ascent-1',  // ← CHANGE PACK TYPE HERE
    count: 3 
    },
    name: 'Ascent Beginner',
    description: 'Ascent packs unlocked!'
},

tier17: {
    requirement: { cardCount: 5750 },
    reward: { 
    type: 'CARD_GENERATION',
    rarities: ['Glyph', 'Mythic'],  // Mix of rarities!
    count: 7,
    pristineChance: 0.6
    },
    name: 'Mixed Master',
    description: 'Generate multiple rarities!'
},

tier18: {
    requirement: { cardCount: 6000 },
    reward: { 
    type: 'CURRENCY', 
    crystals: 8000,
    astralEssence: 60,
    fantasiaTokens: 3
    },
    name: 'Currency King',
    description: 'Massive currency boost!'
},

tier19: {
    requirement: { cardCount: 6500 },
    reward: { 
    type: 'CHOICE',
    options: [
        { type: 'PACK', packType: 'ascent-3', count: 1 },
        { type: 'CARD', rarity: 'Mythic', count: 7, condition: 'pristine' },
        { type: 'CURRENCY', crystals: 10000, astralEssence: 80 }
    ]
    },
    name: 'Almost There',
    description: 'One more tier to go!'
},

tier20: {
    requirement: { cardCount: 7000 },
    reward: { 
    type: 'MEGA',  // Special mega reward type
    items: [
        { type: 'PACK', packType: 'premium-10', count: 3 },
        { type: 'CURRENCY', crystals: 5000 }
    ]
    },
    name: 'Ultimate Collector',
    description: '🎉 YOU DID IT! Maximum tier reached!'
}
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const getTierCount = () => Object.keys(TIER_CONFIG).length;

const getTierById = (tierId) => TIER_CONFIG[tierId];

const SORTED_TIERS = Object.entries(TIER_CONFIG)
    .map(([id, config]) => ({ id, ...config }))
    .sort((a, b) => a.requirement.cardCount - b.requirement.cardCount);

const getAllTiers = () => SORTED_TIERS;

const getNextTier = (currentCardCount, claimedTiers = []) => {
const allTiers = getAllTiers();

for (const tier of allTiers) {
    if (!claimedTiers.includes(tier.id) && currentCardCount >= tier.requirement.cardCount) {
    return tier;
    }
}

return null;
};

const getTierProgress = (currentCardCount) => {
const allTiers = getAllTiers();
let progress = { current: 0, total: allTiers.length, percentage: 0 };

for (let i = 0; i < allTiers.length; i++) {
    if (currentCardCount >= allTiers[i].requirement.cardCount) {
    progress.current = i + 1;
    }
}

progress.percentage = Math.round((progress.current / progress.total) * 100);
return progress;
};

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
TIER_CONFIG,
getTierCount,
getTierById,
getAllTiers,
getNextTier,
getTierProgress
};