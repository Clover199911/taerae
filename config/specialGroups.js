// ============================================================================
// SPECIAL GROUPS CONFIG - Centralized special group definitions
// ============================================================================
// Save this file as: config/specialGroups.js
// Import this in any command that needs special group handling!
// Usage: const specialGroups = require('./config/specialGroups');
//        OR: const specialGroups = require('../config/specialGroups');
// ============================================================================

module.exports = {
    // Special combined groups
    disco: {
      emoji: '<:disco:1276489798042779700>',
      displayName: 'Disco',
      color: 0x9d4edd,
      isCombined: true,
      pattern: /^<:disco:1276489798042779700>/
    },
    
    iotm: {
      emoji: '<:iotm25:1450697068682285177>',
      displayName: 'Idol of the Month',
      color: 0xff6b6b,
      isCombined: true,
      pattern: /^<:iotm25:1450697068682285177>/
    },
    
    winter25: {
      emoji: '<:taeraewinter:1449661297867227156>',
      displayName: '<:taeraewinter:1449661297867227156> Taerae Winter (2025)',
      color: 0x74c0fc,
      isCombined: true,
      pattern: /^<:taeraewinter:1449661297867227156>/
    },

    winter24: {
      emoji: '<:winter:1320755932325609543>',
      displayName: '<:winter:1320755932325609543> Taerae Winter (2024)',
      color: 0x74c0f1,
      isCombined: true,
      pattern: /^<:winter:1320755932325609543>/
    },
  
    // Add more special groups here easily!
    // template: {
    //   emoji: '<:name:id>',
    //   displayName: 'Display Name',
    //   color: 0xHEXCODE,
    //   isCombined: true,
    //   pattern: /^<:name:id>/
    // },
  
    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================
  
    /**
     * Check if a search term matches a special group
     * @param {string} searchTerm - The term to check
     * @returns {object|null} - Special group config or null
     */
    findBySearchTerm(searchTerm) {
      const lowerTerm = searchTerm.toLowerCase();
      return this[lowerTerm] || null;
    },
  
    /**
     * Get all special group keys
     * @returns {string[]} - Array of special group keys
     */
    getAllKeys() {
      return Object.keys(this).filter(key => 
        typeof this[key] === 'object' && this[key].emoji
      );
    },
  
    /**
     * Get groups matching a pattern (for database queries)
     * @param {string} searchTerm - The search term
     * @returns {RegExp|null} - Pattern to use in MongoDB query
     */
    getPattern(searchTerm) {
      const group = this.findBySearchTerm(searchTerm);
      return group?.pattern || null;
    },
  
    /**
     * Check if a group name matches any special group pattern
     * @param {string} groupName - The group name to check
     * @returns {object|null} - Matching special group or null
     */
    matchGroupName(groupName) {
      for (const key of this.getAllKeys()) {
        if (this[key].pattern && this[key].pattern.test(groupName)) {
          return this[key];
        }
      }
      return null;
    },
  
    /**
     * Expand search term to include emoji if it's a special group
     * @param {string} searchTerm - The term to expand
     * @returns {string[]} - Array with original term and emoji (if special)
     */
    expandSearchTerm(searchTerm) {
      const expanded = [searchTerm];
      const specialGroup = this.findBySearchTerm(searchTerm);
      
      if (specialGroup) {
        expanded.push(specialGroup.emoji);
      }
      
      return expanded;
    }
  };