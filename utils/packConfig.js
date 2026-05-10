// Enhanced Pack Configuration with GROUP-FOCUSED PACKS
const CONFIG_VERSION = "2.2.0";
const LAST_UPDATED = new Date().toISOString();

// Pre-compiled validation patterns
const REQUIRED_FIELDS = new Set(['price', 'cardCount', 'rarities', 'pristineChance']);
const VALIDATION_RULES = {
  pristineChance: v => typeof v === 'number' && v >= 0 && v <= 1,
  winterChance: v => v === undefined || (typeof v === 'number' && v >= 0 && v <= 1),
  newCardChance: v => v === undefined || (typeof v === 'number' && v >= 0 && v <= 1),
  groupFocusChance: v => v === undefined || (typeof v === 'number' && v >= 0 && v <= 1),
  cardCount: v => Number.isInteger(v) && v > 0,
  rarities: v => Array.isArray(v) && v.length > 0,
  price: v => v && (v.crystals > 0 || v.astralEssence > 0),
  weeklyLimit: v => v === undefined || (Number.isInteger(v) && v > 0)
};

const ERROR_MESSAGES = {
  pristineChance: 'Must be between 0 and 1',
  newCardChance: 'Must be between 0 and 1',
  groupFocusChance: 'Must be between 0 and 1',
  cardCount: 'Must be a positive integer',
  rarities: 'Must be a non-empty array',
  price: 'Must have crystals or astralEssence'
};

// Memoized validation results
const validationCache = new Map();

// Fast validation function
function validatePackConfig(packType, config) {
  const cacheKey = `${packType}:${CONFIG_VERSION}`;
  if (validationCache.has(cacheKey)) return validationCache.get(cacheKey);

  const errors = [];
  
  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in config)) {
      errors.push(`Missing ${field}`);
    }
  }
  
  // Validate types
  for (const [field, validator] of Object.entries(VALIDATION_RULES)) {
    if (config[field] !== undefined && !validator(config[field])) {
      errors.push(`${field}: ${ERROR_MESSAGES[field]}`);
    }
  }

  const isValid = errors.length === 0;
  if (!isValid) {
    console.error(`❌ ${packType}: ${errors.join(', ')}`);
  }
  
  validationCache.set(cacheKey, isValid);
  return isValid;
}

// ============================================================================
// 🚫 BLOCKED GROUPS CONFIGURATION
// ============================================================================
// Groups that CANNOT be used for group-focused packs
// Add more groups here as needed (case-insensitive matching)
const BLOCKED_GROUPS = [
  'iotw',           // Idol of the Week
  'winter',         // Winter event cards
  // Add more blocked groups below:
  // 'special',
  // 'limited',
];

// Helper to check if a group is blocked
const isGroupBlocked = (groupName) => {
  const normalized = groupName.toLowerCase().trim();
  return BLOCKED_GROUPS.some(blocked => {
    // Exact match only (no substring matching to avoid false positives like "seventeen")
    return normalized === blocked.toLowerCase();
  });
};

// ============================================================================
// ⚖️ RARITY WEIGHTS CONFIGURATION
// ============================================================================
// Weighted rarity distribution for group-focused packs
const RARITY_WEIGHTS = {
  'Standard': 55,   // 55%
  'Unique': 30,     // 30%
  'Glyph': 12,      // 12%
  'Mythic': 3       // 3%
};

// Helper to get random rarity based on weights
const getWeightedRarity = (availableRarities) => {
  // Filter weights to only include available rarities
  const filteredWeights = {};
  let totalWeight = 0;
  
  for (const rarity of availableRarities) {
    const weight = RARITY_WEIGHTS[rarity] || 0;
    filteredWeights[rarity] = weight;
    totalWeight += weight;
  }
  
  // Pick random rarity based on weight
  const random = Math.random() * totalWeight;
  let cumulative = 0;
  
  for (const [rarity, weight] of Object.entries(filteredWeights)) {
    cumulative += weight;
    if (random <= cumulative) {
      return rarity;
    }
  }
  
  // Fallback to first available rarity
  return availableRarities[0];
};

// Pre-computed pack data for faster lookups
const PACK_CONFIG = {
  _meta: {
    version: CONFIG_VERSION,
    lastUpdated: LAST_UPDATED,
    totalPacks: 0
  },

  CATEGORIES: {
    NORMAL: {
      title: "Standard Packs",
      description: "### Standard to Glyph Cards\n**2%** Pristine Chance\nPerfect for beginners!",
      packs: ['normal-5', 'normal-10'],
      icon: "📦",
      color: 0x3498DB,
      recommended: true
    },
    PREMIUM: {
      title: "Premium Packs",
      description: "### Unique to Mythic Cards\n**7%** Pristine Chance\nStep up your game!",
      packs: ['premium-5', 'premium-10'],
      icon: "🎁",
      color: 0x9B59B6,
      recommended: false
    },
    ASCENT: {
      title: "Ascent Packs",
      description: "### Enhanced Rarity Rates\n**10-40%** Pristine Chance\nLimited weekly packs!",
      packs: ['ascent-1', 'ascent-2', 'ascent-3'],
      icon: "🔥",
      color: 0xE74C3C,
      recommended: false,
      special: true
    },
    NEW_UPDATE: {
      title: "New Content Packs",
      description: "### Fresh Content Added\n**25%** New Card Chance\nGet the latest cards!",
      packs: ['new-update-1', 'new-update-5', 'new-update-10'],
      icon: "🆕",
      color: 0xF39C12,
      recommended: true,
      new: true
    },
    // 🎯 NEW: GROUP FOCUSED PACKS
    GROUP_FOCUS: {
      title: "Group-Focused Packs",
      description: "### Target Your Favorite Group!\n**Custom Group Selection**\nHigher chance for specific groups!",
      packs: ['group-focus-5', 'group-focus-10', 'group-premium-10'],
      icon: "🎯",
      color: 0xE67E22,
      recommended: true,
      requiresGroupSelection: true  // Flag for special handling
    }
  },

  // Individual pack configurations (existing packs...)
  'normal-5': {
    price: { crystals: 5000 },
    cardCount: 5,
    rarities: ['Standard', 'Unique', 'Glyph'],
    pristineChance: 0.02,
    description: "Basic 5-card pack"
  },

  'normal-10': {
    price: { crystals: 7500 },
    cardCount: 10,
    rarities: ['Standard', 'Unique', 'Glyph'],
    pristineChance: 0.02,
    description: "Better value 10-card pack"
  },

  'premium-5': {
    price: { crystals: 7000, astralEssence: 5 },
    cardCount: 5,
    rarities: ['Unique', 'Glyph', 'Mythic'],
    pristineChance: 0.07,
    description: "Premium pack with higher rarities"
  },

  'premium-10': {
    price: { crystals: 15000, astralEssence: 10 },
    cardCount: 10,
    rarities: ['Unique', 'Glyph', 'Mythic'],
    pristineChance: 0.07,
    description: "Large premium pack"
  },

  'ascent-1': {
    price: { crystals: 7000 },
    cardCount: 10,
    rarities: ['Standard', 'Unique', 'Glyph'],
    pristineChance: 0.10,
    weeklyLimit: 1,
    description: "Entry-level Ascent pack"
  },

  'ascent-2': {
    price: { crystals: 10000 },
    cardCount: 10,
    rarities: ['Standard', 'Unique', 'Glyph', 'Mythic'],
    pristineChance: 0.20,
    weeklyLimit: 1,
    description: "Mid-tier Ascent pack"
  },

  'ascent-3': {
    price: { astralEssence: 50 },
    cardCount: 10,
    rarities: ['Unique', 'Glyph', 'Mythic'],
    pristineChance: 0.40,
    description: "Ultimate Ascent pack"
  },

  'new-update-1': {
    price: { astralEssence: 30 },
    cardCount: 1,
    rarities: ['Standard', 'Unique', 'Glyph', 'Mythic'],
    pristineChance: 0.50,
    newCardChance: 1,
    newCardIds: ['1941', '1942', '1943', '1944', '1945', '1946', '1947', '1948', '1949', '1950', '1951', '1952', '1953', '1954', '1955', '1956', '1957', '1958', '1959', '1960', '1961', '1962', '1963', '1964', '1965', '1966', '1967', '1968', '1969', '1970', '1971', '1972', '1973', '1974', '1975', '1976', '1977', '1978', '1979', '1980', '1981', '1982', '1983', '1984', '1985', '1986', '1987', '1988', '1989', '1990', '1991', '1992', '1993', '1994', '1995', '1996', '1997', '1998', '1999', '2000', '2001', '2002', '2003', '2004', '2005', '2006', '2007', '2008', '2009', '2010', '2011', '2012', '2013', '2014', '2015', '2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026'],
    description: "Latest content pack"
  },

  'new-update-5': {
    price: { crystals: 11000, astralEssence: 10 },
    cardCount: 5,
    rarities: ['Standard', 'Unique', 'Glyph', 'Mythic'],
    pristineChance: 0.10,
    newCardChance: 0.15,
    newCardIds: ['1941', '1942', '1943', '1944', '1945', '1946', '1947', '1948', '1949', '1950', '1951', '1952', '1953', '1954', '1955', '1956', '1957', '1958', '1959', '1960', '1961', '1962', '1963', '1964', '1965', '1966', '1967', '1968', '1969', '1970', '1971', '1972', '1973', '1974', '1975', '1976', '1977', '1978', '1979', '1980', '1981', '1982', '1983', '1984', '1985', '1986', '1987', '1988', '1989', '1990', '1991', '1992', '1993', '1994', '1995', '1996', '1997', '1998', '1999', '2000', '2001', '2002', '2003', '2004', '2005', '2006', '2007', '2008', '2009', '2010', '2011', '2012', '2013', '2014', '2015', '2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026'],
    description: "Latest content pack"
  },

  'new-update-10': {
    price: { crystals: 15000, astralEssence: 20 },
    cardCount: 10,
    rarities: ['Standard', 'Unique', 'Glyph', 'Mythic'],
    pristineChance: 0.30,
    newCardChance: 0.35,
    newCardIds: ['1941', '1942', '1943', '1944', '1945', '1946', '1947', '1948', '1949', '1950', '1951', '1952', '1953', '1954', '1955', '1956', '1957', '1958', '1959', '1960', '1961', '1962', '1963', '1964', '1965', '1966', '1967', '1968', '1969', '1970', '1971', '1972', '1973', '1974', '1975', '1976', '1977', '1978', '1979', '1980', '1981', '1982', '1983', '1984', '1985', '1986', '1987', '1988', '1989', '1990', '1991', '1992', '1993', '1994', '1995', '1996', '1997', '1998', '1999', '2000', '2001', '2002', '2003', '2004', '2005', '2006', '2007', '2008', '2009', '2010', '2011', '2012', '2013', '2014', '2015', '2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026'],
    description: "Latest content pack"
  },

  // ============================================================================
  // 🎯 NEW: GROUP-FOCUSED PACKS
  // ============================================================================
  
  'group-focus-5': {
    price: { crystals: 7000 },
    cardCount: 5,
    rarities: ['Standard', 'Unique', 'Glyph', 'Mythic'],
    pristineChance: 0.02,
    groupFocusChance: 0.30,  // 30% chance for target group
    useWeightedRarity: true,  // Uses RARITY_WEIGHTS
    description: "5 cards with 30% chance for your chosen group"
  },

  'group-focus-10': {
    price: { crystals: 13000, astralEssence: 5 },
    cardCount: 10,
    rarities: ['Standard', 'Unique', 'Glyph', 'Mythic'],
    pristineChance: 0.05,
    groupFocusChance: 0.30,  // 30% chance for target group
    useWeightedRarity: true,
    description: "10 cards with 30% chance for your chosen group"
  },

  'group-premium-10': {
    price: { crystals: 20000, astralEssence: 15 },
    cardCount: 10,
    rarities: ['Standard', 'Unique', 'Glyph', 'Mythic'],
    pristineChance: 0.10,
    groupFocusChance: 0.50,  // 50% chance for target group
    useWeightedRarity: true,
    description: "10 premium cards with 50% chance for your chosen group"
  }
};

// Pre-compute utility functions for performance
const _utils = {
  // Get all pack types (excluding metadata)
  getAllPackTypes: () => {
    const excludedKeys = new Set(['CATEGORIES', 'BLOCKED_GROUPS', 'isGroupBlocked', 'RARITY_WEIGHTS', 'getWeightedRarity']);
    return Object.keys(PACK_CONFIG).filter(key => !key.startsWith('_') && !excludedKeys.has(key));
  },

  // Get packs by category
  getPacksByCategory: (categoryKey) => {
    const category = PACK_CONFIG.CATEGORIES[categoryKey];
    return category?.packs || [];
  },

  // Get pack config with validation
  getPackConfig: (packType) => {
    const config = PACK_CONFIG[packType];
    if (!config) return null;
    return validatePackConfig(packType, config) ? config : null;
  },

  // Get recommended packs
  getRecommendedPacks: () => {
    return Object.entries(PACK_CONFIG.CATEGORIES)
      .filter(([, category]) => category.recommended)
      .flatMap(([, category]) => category.packs);
  },

  // Get packs by price range
  getPacksByPriceRange: (min = 0, max = Infinity) => {
    return _utils.getAllPackTypes().filter(packType => {
      const crystals = PACK_CONFIG[packType]?.price?.crystals || 0;
      return crystals >= min && crystals <= max;
    });
  },

  // Get pack statistics
  getPackStats: () => {
    const allPacks = _utils.getAllPackTypes();
    const weeklyLimited = allPacks.filter(p => PACK_CONFIG[p].weeklyLimit).length;
    const seasonal = allPacks.filter(p => PACK_CONFIG.CATEGORIES.SEASONAL?.packs.includes(p)).length;
    
    const avgPristine = allPacks.reduce((sum, pack) => 
      sum + (PACK_CONFIG[pack].pristineChance || 0), 0) / allPacks.length;

    return {
      totalPacks: allPacks.length,
      categories: Object.keys(PACK_CONFIG.CATEGORIES).length,
      averagePristineChance: Number(avgPristine.toFixed(4)),
      weeklyLimitedPacks: weeklyLimited,
      seasonalPacks: seasonal
    };
  },

  // Validate all configs on startup
  validateAllConfigs: () => {
    const errors = [];
    const allPacks = _utils.getAllPackTypes();

    allPacks.forEach(packType => {
      if (!validatePackConfig(packType, PACK_CONFIG[packType])) {
        errors.push(packType);
      }
    });

    if (errors.length) {
      console.error(`❌ Validation failed for: ${errors.join(', ')}`);
      return false;
    }

    // Update meta
    PACK_CONFIG._meta.totalPacks = allPacks.length;
    console.log(`✅ ${allPacks.length} packs validated across ${Object.keys(PACK_CONFIG.CATEGORIES).length} categories`);
    return true;
  }
};

// Attach utils
PACK_CONFIG._utils = _utils;
PACK_CONFIG.BLOCKED_GROUPS = BLOCKED_GROUPS;
PACK_CONFIG.isGroupBlocked = isGroupBlocked;
PACK_CONFIG.RARITY_WEIGHTS = RARITY_WEIGHTS;
PACK_CONFIG.getWeightedRarity = getWeightedRarity;

// Validate on load
if (!PACK_CONFIG._utils.validateAllConfigs()) {
  console.error('❌ Pack configuration validation failed!');
} else {
  console.log(`📦 ${PACK_CONFIG._meta.totalPacks} packs loaded v${CONFIG_VERSION}`);
  console.log(`🚫 ${BLOCKED_GROUPS.length} blocked groups configured`);
}

module.exports = PACK_CONFIG;