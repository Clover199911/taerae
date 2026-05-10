module.exports = {
  EMBED_COLORS: {
    ERROR: 0xFF6B6B,
    DEFAULT: 0xCAF0F8,
    MYTHIC: 0xFFD700,
    GLYPH: 0x9B59B6,
    UNIQUE: 0x3498DB,
    STANDARD: 0x95A5A6
  },
  
  RARITY_EMOJIS: {
    standard: "★☆☆☆",
    unique: "★★☆☆",
    glyph: "★★★☆",
    mythic: "★★★★"
  },
  
  CONDITION_EMOJIS: {
    damaged: "<:damaged:1460381834650189978>",
    worn: "<:worn:1460381763988619489>",
    good: "<:good:1460381686515634197>",
    mint: "<:mint:1460381600616415437>",
    pristine: "<:pristinee:1272529510696222842>"
  },

  // Currency emojis - used across balance, rewards, quests, etc.
  CURRENCY_EMOJIS: {
    crystals: "<:rose:1461015415466496191>",
    stardust: "<:stardust:1449661267915571274>",
    astralEssence: "<:astralessence:1461015891138318598>",
    selca: "<:cosmic:1461015742219550924>",
    cosmic: "<:cosmic:1461015742219550924>",
    candyCanes: "<:candycane:1320755924620808255>"
  },

  // Status emojis - checkmarks, crosses, etc.
  STATUS_EMOJIS: {
    success: "<:check:1461015775266603110>",
    error: "<:cross:1461015696954753034>",
    warning: "⚠️",
    info: "ℹ️"
  },
  
  BUTTON_CONFIGS: {
    first: { emoji: "1461015248218620159", name: "rleft" },
    prev: { emoji: "1461015542382067773", name: "left" },
    next: { emoji: "1462320826421612639", name: "right" },
    last: { emoji: "1461015309464113203", name: "rright" },
    code_catalog: { emoji: "1268913257687679088", name: "code_catalog" }
  },

  // Marketplace specific emojis
  MARKETPLACE_EMOJIS: {
    // Main icons
    marketplace: '🏪',
    crystal: '<:rose:1461015415466496191>',
    
    // Actions
    buy: '💳',
    sell: '📤',
    remove: '🗑️',
    view: '👁️',
    notify: '🔔',
    
    // Status indicators
    success: '<:check:1461015775266603110>',
    error: '<:cross:1461015696954753034>',
    warning: '⚠️',
    info: 'ℹ️',
    locked: '🔒',
    
    // UI elements
    tip: '💡',
    help: '❓',
    search: '🔍',
    filter: '🎯',
    exclude: '⛔',
    user: '👤',
    print: '🔢',
    balance: '💰',
    after: '📉',
    example: '📝'
  }
};