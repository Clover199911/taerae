/**
 * Daily Quest Configuration
 * Defines all quest types, rewards, and generation settings
 */

const { CURRENCY_EMOJIS, CONDITION_EMOJIS, STATUS_EMOJIS } = require('./embedConstants');

const QUEST_EMOJIS = {
  drop: "🎴",
  star: "⭐",
  gift: "🎁",
  daily: "📅",
  melt: "🔥",
  view: "👁️",
  travel: "🚶",
  travel_zerose: "🌹",
  travel_stardust: "✨",
  travel_moonlit: "🌙",
  // Rarity collection
  collect_standard: "⬜",
  collect_unique: "🔵",
  collect_glyph: "🟣",
  collect_mythic: "🟡",
  // Condition collection
  collect_pristine: CONDITION_EMOJIS.pristine,
  collect_mint: CONDITION_EMOJIS.mint,
  collect_good: CONDITION_EMOJIS.good,
  collect_worn: CONDITION_EMOJIS.worn,
  collect_damaged: CONDITION_EMOJIS.damaged,
  // Packs
  open_pack: "📦",
  open_normal: "📦",
  open_premium: "🎁",
  open_ascent: "🔥",
  open_group: "🎯",
  complete: STATUS_EMOJIS.success,
  incomplete: "⬜",
  claimed: "💎"
};

// Quest definitions with difficulty and target ranges
const QUEST_POOL = {
  // Basic Quests
  drop: {
    type: "drop",
    name: "Card Collector",
    description: "Use ?drop {target} times",
    descriptionFn: (target) => `Use \`?drop\` ${target} times`,
    difficulty: "easy",
    targetRange: { min: 5, max: 15 },
    emoji: QUEST_EMOJIS.drop
  },
  star: {
    type: "star",
    name: "Generous Star",
    description: "Star other users {target} times",
    descriptionFn: (target) => `Star other users ${target} times`,
    difficulty: "easy",
    targetRange: { min: 3, max: 8 },
    emoji: QUEST_EMOJIS.star
  },
  gift: {
    type: "gift",
    name: "Gift Giver",
    description: "Gift cards to others {target} times",
    descriptionFn: (target) => `Gift cards to others ${target} times`,
    difficulty: "medium",
    targetRange: { min: 1, max: 3 },
    emoji: QUEST_EMOJIS.gift
  },
  daily: {
    type: "daily",
    name: "Daily Devotion",
    description: "Claim your daily reward",
    descriptionFn: () => "Claim your daily reward",
    difficulty: "easy",
    targetRange: { min: 1, max: 1 },
    emoji: QUEST_EMOJIS.daily
  },
  melt: {
    type: "melt",
    name: "Card Melter",
    description: "Melt {target} cards",
    descriptionFn: (target) => `Melt ${target} cards`,
    difficulty: "easy",
    targetRange: { min: 3, max: 10 },
    emoji: QUEST_EMOJIS.melt
  },
  view: {
    type: "view",
    name: "Card Viewer",
    description: "View {target} cards",
    descriptionFn: (target) => `View ${target} cards`,
    difficulty: "easy",
    targetRange: { min: 5, max: 15 },
    emoji: QUEST_EMOJIS.view
  },

  // Rarity Collection Quests
  collect_standard: {
    type: "collect_standard",
    name: "Standard Seeker",
    description: "Obtain {target} standard cards",
    descriptionFn: (target) => `Obtain ${target} standard cards`,
    difficulty: "easy",
    targetRange: { min: 5, max: 15 },
    emoji: QUEST_EMOJIS.collect_standard
  },
  collect_unique: {
    type: "collect_unique",
    name: "Unique Finder",
    description: "Obtain {target} unique cards",
    descriptionFn: (target) => `Obtain ${target} unique cards`,
    difficulty: "medium",
    targetRange: { min: 3, max: 8 },
    emoji: QUEST_EMOJIS.collect_unique
  },
  collect_glyph: {
    type: "collect_glyph",
    name: "Glyph Gatherer",
    description: "Obtain {target} glyph card(s)",
    descriptionFn: (target) => `Obtain ${target} glyph card${target > 1 ? "s" : ""}`,
    difficulty: "hard",
    targetRange: { min: 1, max: 3 },
    emoji: QUEST_EMOJIS.collect_glyph
  },
  collect_mythic: {
    type: "collect_mythic",
    name: "Mythic Seeker",
    description: "Obtain a mythic card",
    descriptionFn: () => "Obtain a mythic card",
    difficulty: "hard",
    targetRange: { min: 1, max: 1 },
    emoji: QUEST_EMOJIS.collect_mythic
  },

  // Condition Collection Quests
  collect_pristine: {
    type: "collect_pristine",
    name: "Pristine Hunter",
    description: "Obtain {target} pristine card(s)",
    descriptionFn: (target) => `Obtain ${target} pristine card${target > 1 ? "s" : ""}`,
    difficulty: "hard",
    targetRange: { min: 1, max: 2 },
    emoji: QUEST_EMOJIS.collect_pristine
  },
  collect_mint: {
    type: "collect_mint",
    name: "Mint Collector",
    description: "Obtain {target} mint card(s)",
    descriptionFn: (target) => `Obtain ${target} mint card${target > 1 ? "s" : ""}`,
    difficulty: "medium",
    targetRange: { min: 2, max: 5 },
    emoji: QUEST_EMOJIS.collect_mint
  },
  collect_good: {
    type: "collect_good",
    name: "Good Condition Fan",
    description: "Obtain {target} good condition cards",
    descriptionFn: (target) => `Obtain ${target} good condition cards`,
    difficulty: "easy",
    targetRange: { min: 3, max: 8 },
    emoji: QUEST_EMOJIS.collect_good
  },
  collect_worn: {
    type: "collect_worn",
    name: "Worn Card Finder",
    description: "Obtain {target} worn card(s)",
    descriptionFn: (target) => `Obtain ${target} worn card${target > 1 ? "s" : ""}`,
    difficulty: "easy",
    targetRange: { min: 2, max: 5 },
    emoji: QUEST_EMOJIS.collect_worn
  },
  collect_damaged: {
    type: "collect_damaged",
    name: "Damaged Card Collector",
    description: "Obtain {target} damaged card(s)",
    descriptionFn: (target) => `Obtain ${target} damaged card${target > 1 ? "s" : ""}`,
    difficulty: "easy",
    targetRange: { min: 2, max: 4 },
    emoji: QUEST_EMOJIS.collect_damaged
  },

  // Travel Quests
  travel: {
    type: "travel",
    name: "World Traveler",
    description: "Travel anywhere {target} times",
    descriptionFn: (target) => `Travel anywhere ${target} times`,
    difficulty: "easy",
    targetRange: { min: 1, max: 3 },
    emoji: QUEST_EMOJIS.travel
  },
  travel_zerose: {
    type: "travel_zerose",
    name: "Forest Explorer",
    description: "Visit ZEROSE Forest {target} times",
    descriptionFn: (target) => `Visit ZEROSE Forest ${target} times`,
    difficulty: "easy",
    targetRange: { min: 1, max: 2 },
    emoji: QUEST_EMOJIS.travel_zerose
  },
  travel_stardust: {
    type: "travel_stardust",
    name: "Star Seeker",
    description: "Visit Stardust Park {target} times",
    descriptionFn: (target) => `Visit Stardust Park ${target} times`,
    difficulty: "medium",
    targetRange: { min: 1, max: 2 },
    emoji: QUEST_EMOJIS.travel_stardust
  },
  travel_moonlit: {
    type: "travel_moonlit",
    name: "Moonlit Wanderer",
    description: "Visit Moonlit Grove",
    descriptionFn: () => "Visit Moonlit Grove",
    difficulty: "hard",
    targetRange: { min: 1, max: 2 },
    emoji: QUEST_EMOJIS.travel_moonlit
  },

  // Pack Quests
  open_pack: {
    type: "open_pack",
    name: "Pack Opener",
    description: "Open {target} pack(s)",
    descriptionFn: (target) => `Open ${target} pack${target > 1 ? "s" : ""}`,
    difficulty: "medium",
    targetRange: { min: 1, max: 3 },
    emoji: QUEST_EMOJIS.open_pack
  },
  open_normal: {
    type: "open_normal",
    name: "Normal Pack Fan",
    description: "Open {target} normal pack(s)",
    descriptionFn: (target) => `Open ${target} normal pack${target > 1 ? "s" : ""}`,
    difficulty: "easy",
    targetRange: { min: 1, max: 2 },
    emoji: QUEST_EMOJIS.open_normal
  },
  open_premium: {
    type: "open_premium",
    name: "Premium Collector",
    description: "Open a premium pack",
    descriptionFn: () => "Open a premium pack",
    difficulty: "medium",
    targetRange: { min: 1, max: 1 },
    emoji: QUEST_EMOJIS.open_premium
  },
  open_ascent: {
    type: "open_ascent",
    name: "Ascent Chaser",
    description: "Open an ascent pack",
    descriptionFn: () => "Open an ascent pack",
    difficulty: "hard",
    targetRange: { min: 1, max: 1 },
    emoji: QUEST_EMOJIS.open_ascent
  },
  open_group: {
    type: "open_group",
    name: "Group Focused",
    description: "Open a group-focused pack",
    descriptionFn: () => "Open a group-focused pack",
    difficulty: "medium",
    targetRange: { min: 1, max: 1 },
    emoji: QUEST_EMOJIS.open_group
  }
};

// Reward configurations by difficulty
const REWARD_CONFIG = {
  easy: {
    crystals: { min: 100, max: 500 },
    stardust: { min: 5, max: 10 },
    selcaChance: 0.1,
    cardChance: 0.05, // 5% chance
    cardRarities: ['Standard'] // Only standard cards
  },
  medium: {
    crystals: { min: 500, max: 1000 },
    stardust: { min: 10, max: 20 },
    selcaChance: 0.25,
    cardChance: 0.15, // 15% chance
    cardRarities: ['Standard', 'Unique'] // Standard or Unique
  },
  hard: {
    crystals: { min: 1100, max: 3000 },
    stardust: { min: 20, max: 40 },
    selcaChance: 0.5,
    cardChance: 0.30, // 30% chance
    cardRarities: ['Unique', 'Glyph'] // Unique or Glyph
  }
};

// Completion bonus for finishing all 5 quests
const COMPLETION_BONUS = {
  crystals: 2500,
  stardust: 50,
  astralEssence: 10,
  cardChance: 0.50, // 50% chance for a card
  cardRarities: ['Unique', 'Glyph', 'Mythic'] // Better pool for bonus
};

// Quest generation settings
const QUEST_SETTINGS = {
  questsPerDay: 5,
  resetTimezone: "Asia/Seoul", // KST
  maxQuestsOfSameType: 1, // Prevent duplicates
  
  // Weight certain quest types (higher = more common)
  questWeights: {
    drop: 3,
    star: 2,
    gift: 2,
    daily: 3,
    melt: 2,
    view: 2,
    travel: 2,
    travel_zerose: 1,
    travel_stardust: 1,
    travel_moonlit: 1,
    // Rarity collection
    collect_standard: 2,
    collect_unique: 2,
    collect_glyph: 1,
    collect_mythic: 1,
    // Condition collection
    collect_pristine: 1,
    collect_mint: 2,
    collect_good: 2,
    collect_worn: 1,
    collect_damaged: 1,
    // Packs
    open_pack: 2,
    open_normal: 1,
    open_premium: 1,
    open_ascent: 1,
    open_group: 1
  }
};

// Progress bar configuration
const PROGRESS_BAR = {
  filled: "▓",
  empty: "░",
  length: 10
};

// Status colors for embed
const STATUS_COLORS = {
  incomplete: 0x95A5A6, // Gray
  completed: 0x2ECC71,   // Green
  claimed: 0x3498DB,     // Blue
  allComplete: 0xFFD700  // Gold
};

module.exports = {
  QUEST_POOL,
  QUEST_EMOJIS,
  REWARD_CONFIG,
  COMPLETION_BONUS,
  QUEST_SETTINGS,
  PROGRESS_BAR,
  STATUS_COLORS
};
