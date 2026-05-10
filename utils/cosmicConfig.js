// utils/cosmicConfig.js
// Configuration for Cosmic Card Generator
// ================================================================

const CONFIG_VERSION = "2.0.0";
const LAST_UPDATED = new Date().toISOString();

/* ========================================
   HELPER: Parse range string to array
======================================== */
function parseRangeString(rangeStr) {
  if (!rangeStr) return [];
  
  const results = [];
  const parts = rangeStr.split(',').map(p => p.trim());
  
  for (const part of parts) {
    if (part.includes('-')) {
      // Range like "1225-1231"
      const [start, end] = part.split('-').map(Number);
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = start; i <= end; i++) {
          results.push(i);
        }
      }
    } else {
      // Single number like "1232"
      const num = Number(part);
      if (!isNaN(num)) {
        results.push(num);
      }
    }
  }
  
  return results;
}

/* ========================================
   COSMIC CARD POOLS
======================================== */

const COSMIC_CONFIG = {
  _meta: {
    version: CONFIG_VERSION,
    lastUpdated: LAST_UPDATED,
    description: "Cosmic card generation configuration"
  },

  /* ========================================
     IDOL OF THE WEEK (IOTW) CARDS
  ======================================== */
  IOTW_CARDS: {
    // IOTM (Idol of the Month)
    iotm1: {
      range: "1806-1819",
      searchTerms: ["iotm1", "iotm", "idol of the month", "idol of the month 1"],
      displayName: "Idol of the Month (January 2026)"
    },

    iotm2: {
      range: "1942,1943,1948,1951,1953,1954,1959,1960",
      searchTerms: ["iotm2", "iotm", "idol of the month", "idol of the month 2"],
      displayName: "Idol of the Month (April 2026)"
    },
    
    // IOTW (Idol of the Week) batches
    iotw1: {
      range: "306",
      searchTerms: ["iotw1", "week1", "idol of the week 1", "iotw 1"],
      displayName: "Idol of the Week 1"
    },
    iotw2: {
      range: "442",
      searchTerms: ["iotw2", "week2", "idol of the week 2", "iotw 2"],
      displayName: "Idol of the Week 2"
    },
    iotw3: {
      range: "578-584",
      searchTerms: ["iotw3", "week3", "idol of the week 3", "iotw 3"],
      displayName: "Idol of the Week 3"
    },
    iotw4: {
      range: "833",
      searchTerms: ["iotw4", "week4", "idol of the week 4", "iotw 4"],
      displayName: "Idol of the Week 4"
    },
    iotw5: {
      range: "937-943",
      searchTerms: ["iotw5", "week5", "idol of the week 5", "iotw 5"],
      displayName: "Idol of the Week 5"
    },
    iotw6: {
      range: "1036-1042",
      searchTerms: ["iotw6", "week6", "idol of the week 6", "iotw 6"],
      displayName: "Idol of the Week 6"
    },
    iotw7: {
      range: "1158-1164",
      searchTerms: ["iotw7", "week7", "idol of the week 7", "iotw 7"],
      displayName: "Idol of the Week 7"
    },
    iotw8: {
      range: "1225-1231",
      searchTerms: ["iotw8", "week8", "idol of the week 8", "iotw 8"],
      displayName: "Idol of the Week 8"
    },
    iotw9: {
      range: "1325-1331",
      searchTerms: ["iotw9", "week9", "idol of the week 9", "iotw 9"],
      displayName: "Idol of the Week 9"
    },
    iotw10: {
      range: "1384-1390",
      searchTerms: ["iotw10", "week10", "idol of the week 10", "iotw 10"],
      displayName: "Idol of the Week 10"
    },
    iotw11: {
      range: "1419-1425",
      searchTerms: ["iotw11", "week11", "idol of the week 11", "iotw 11"],
      displayName: "Idol of the Week 11"
    },
    iotw12: {
      range: "1507-1513",
      searchTerms: ["iotw12", "week12", "idol of the week 12", "iotw 12"],
      displayName: "Idol of the Week 12"
    },
    iotw13: {
      range: "1643-1649",
      searchTerms: ["iotw13", "week13", "idol of the week 13", "iotw 13"],
      displayName: "Idol of the Week 13"
    },
    
    get current() {
      const allIds = [];
      const keys = ['iotm1', 'iotm2', 'iotw1', 'iotw2', 'iotw3', 'iotw4', 'iotw5', 'iotw6', 'iotw7', 'iotw8', 'iotw9', 'iotw10', 'iotw11', 'iotw12', 'iotw13'];
      
      for (const key of keys) {
        const value = this[key];
        if (value && value.range) {
          allIds.push(...parseRangeString(value.range));
        }
      }
      return allIds;
    }
  },

  /* ========================================
     SPECIAL EVENT CARDS
  ======================================== */
  SPECIAL_EVENT_CARDS: {
    winter2024: {
      range: "1623-1642",
      searchTerms: ["winter 2024", "winter event 2024", "winter cards 2024"],
      displayName: "Winter Event"
    },
    winter2025: {
      range: "1820-1839",
      searchTerms: ["winter 2025", "winter event 2025", "winter cards 2025"],
      displayName: "Winter Event"
    },
    anniversary: {
      range: "307-327",
      searchTerms: ["anniversary", "anni", "anniversary event"],
      displayName: "Anniversary Event"
    },
    disco: {
      range: "1305-1324",
      searchTerms: ["disco", "dance", "disco event"],
      displayName: "Disco Event"
    }
  },

  /* ========================================
     COSMIC EXCLUSIVE CARDS
  ======================================== */
  COSMIC_EXCLUSIVE: {
    cards: {
      range: "",
      searchTerms: ["cosmic exclusive", "exclusive"],
      displayName: "Cosmic Exclusive"
    }
  },

  /* ========================================
     HELPER FUNCTIONS
  ======================================== */
  
  /**
   * Get all IOTW cards
   * @returns {number[]} Array of all IOTW card IDs
   */
  getAllIOTWCards: function() {
    return this.IOTW_CARDS.current;
  },

  /**
   * Get ALL cosmic cards (IOTW + Special Events + Exclusive)
   * @returns {number[]} Array of all cosmic card IDs
   */
  getAllCosmicCards: function() {
    const allIds = [];
    
    // Get all IOTW cards
    allIds.push(...this.getAllIOTWCards());
    
    // Get all special event cards
    for (const [key, value] of Object.entries(this.SPECIAL_EVENT_CARDS)) {
      if (value.range) {
        allIds.push(...parseRangeString(value.range));
      }
    }
    
    // Get cosmic exclusive cards
    if (this.COSMIC_EXCLUSIVE.cards.range) {
      allIds.push(...parseRangeString(this.COSMIC_EXCLUSIVE.cards.range));
    }
    
    // Remove duplicates and return
    return [...new Set(allIds)];
  },

  /**
   * Get only current active IOTW cards
   * @returns {number[]} Array of current IOTW card IDs
   */
  getCurrentIOTWCards: function() {
    return this.IOTW_CARDS.current;
  },

  /**
   * Get specific IOTW batch by name
   * @param {string} batchName - Batch name (iotm1, iotw1, etc.)
   * @returns {number[]} Array of card IDs for that batch
   */
  getIOTWBatch: function(batchName) {
    const batch = this.IOTW_CARDS[batchName];
    if (!batch || !batch.range) return [];
    return parseRangeString(batch.range);
  },

  /**
   * Get event cards by event name
   * @param {string} eventName - Event name (winter, halloween, etc.)
   * @returns {number[]} Array of event card IDs
   */
  getEventCards: function(eventName) {
    const event = this.SPECIAL_EVENT_CARDS[eventName];
    if (!event || !event.range) return [];
    return parseRangeString(event.range);
  },

  /**
   * Find card IDs by search term (checks all IOTW and events)
   * @param {string} searchTerm - Search term to match
   * @returns {number[]} Array of matching card IDs
   */
  findCardsBySearchTerm: function(searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    
    // Check IOTW cards
    for (const [key, value] of Object.entries(this.IOTW_CARDS)) {
      if (key === 'current' || typeof value !== 'object') continue;
      if (value.searchTerms && value.searchTerms.some(t => t.toLowerCase() === term)) {
        return parseRangeString(value.range);
      }
    }
    
    // Check event cards
    for (const [key, value] of Object.entries(this.SPECIAL_EVENT_CARDS)) {
      if (value.searchTerms && value.searchTerms.some(t => t.toLowerCase() === term)) {
        return parseRangeString(value.range);
      }
    }
    
    // Check cosmic exclusive
    const exclusive = this.COSMIC_EXCLUSIVE.cards;
    if (exclusive.searchTerms && exclusive.searchTerms.some(t => t.toLowerCase() === term)) {
      return parseRangeString(exclusive.range);
    }
    
    return [];
  },

  /**
   * Get display name for a search term
   * @param {string} searchTerm - Search term
   * @returns {string|null} Display name or null
   */
  getDisplayName: function(searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    
    // Check IOTW
    for (const [key, value] of Object.entries(this.IOTW_CARDS)) {
      if (key === 'current' || typeof value !== 'object') continue;
      if (value.searchTerms && value.searchTerms.some(t => t.toLowerCase() === term)) {
        return value.displayName;
      }
    }
    
    // Check events
    for (const [key, value] of Object.entries(this.SPECIAL_EVENT_CARDS)) {
      if (value.searchTerms && value.searchTerms.some(t => t.toLowerCase() === term)) {
        return value.displayName;
      }
    }
    
    // Check cosmic exclusive
    const exclusive = this.COSMIC_EXCLUSIVE.cards;
    if (exclusive.searchTerms && exclusive.searchTerms.some(t => t.toLowerCase() === term)) {
      return exclusive.displayName;
    }
    
    return null;
  },

  /**
   * Check if card ID is an IOTW card
   * @param {number} cardId - Card ID to check
   * @returns {boolean} True if card is IOTW
   */
  isIOTWCard: function(cardId) {
    return this.getAllIOTWCards().includes(cardId);
  },

  /**
   * Validate configuration on load
   * @returns {boolean} True if config is valid
   */
  validateConfig: function() {
    const errors = [];

    // Check if current IOTW has cards
    if (!Array.isArray(this.IOTW_CARDS.current)) {
      errors.push('IOTW_CARDS.current must be an array');
    }

    // Check if all card IDs are numbers
    const allIOTW = this.getAllIOTWCards();
    if (allIOTW.some(id => typeof id !== 'number')) {
      errors.push('All card IDs must be numbers');
    }

    if (errors.length > 0) {
      console.error('❌ Cosmic Config Validation Errors:', errors);
      return false;
    }

    // Warn if no IOTW cards defined
    if (this.IOTW_CARDS.current.length === 0) {
      console.warn('⚠️ No current IOTW cards defined in cosmicConfig');
    }

    console.log(`✅ Cosmic config loaded v${CONFIG_VERSION}`);
    console.log(`📊 Current IOTW cards: ${this.IOTW_CARDS.current.length}`);
    
    return true;
  }
};

// Validate config on load
COSMIC_CONFIG.validateConfig();

module.exports = COSMIC_CONFIG;