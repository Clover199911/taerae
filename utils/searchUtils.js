// ============================================================================
// SEARCH UTILITIES - Handles special characters in search terms
// ============================================================================

/**
 * Escapes special regex characters in a string
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  
  /**
   * Removes special characters from a string for simplified matching
   */
  function removeSpecialChars(str) {
    return str.replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, '');
  }
  
  /**
   * Creates flexible search patterns that match both exact and simplified versions
   * @param {string} term - The search term
   * @returns {Object} - Contains exact and simplified regex patterns
   */
  function createFlexiblePattern(term) {
    const exactPattern = new RegExp(escapeRegex(term), 'i');
    const simplifiedTerm = removeSpecialChars(term);
    const simplifiedPattern = simplifiedTerm 
      ? new RegExp(escapeRegex(simplifiedTerm), 'i')
      : null;
  
    return { exactPattern, simplifiedPattern };
  }
  
  /**
   * Tests if a value matches a search term (handles special characters)
   * @param {string} value - The value to test
   * @param {string} searchTerm - The search term
   * @returns {boolean}
   */
  function flexibleMatch(value, searchTerm) {
    if (!value || !searchTerm) return false;
  
    const { exactPattern, simplifiedPattern } = createFlexiblePattern(searchTerm);
  
    // Try exact match first
    if (exactPattern.test(value)) return true;
  
    // Try simplified match
    if (simplifiedPattern) {
      const simplifiedValue = removeSpecialChars(value);
      if (simplifiedPattern.test(simplifiedValue)) return true;
    }
  
    return false;
  }
  
  /**
   * Tests if a value matches ANY of the search terms
   * @param {string} value - The value to test
   * @param {string[]} searchTerms - Array of search terms
   * @returns {boolean}
   */
  function matchesAnyTerm(value, searchTerms) {
    return searchTerms.some(term => flexibleMatch(value, term));
  }
  
  /**
   * Tests if a value matches ALL of the search terms
   * @param {string} value - The value to test
   * @param {string[]} searchTerms - Array of search terms
   * @returns {boolean}
   */
  function matchesAllTerms(value, searchTerms) {
    return searchTerms.every(term => flexibleMatch(value, term));
  }
  
  /**
   * Tests if a card matches a search term (checks multiple fields)
   * @param {Object} card - The card object
   * @param {string} term - Search term
   * @returns {boolean}
   */
  function cardMatchesTerm(card, term) {
    const fieldsToCheck = [
      card.name,
      card.group,
      card.rarity,
      card.condition,
      card.cardCode
    ];
  
    return fieldsToCheck.some(field => 
      field && flexibleMatch(field, term)
    );
  }
  
  /**
   * Checks if a group name has an emoji prefix (custom Discord emoji)
   * @param {string} groupName - The group name to check
   * @returns {boolean} True if group has emoji prefix like <:name:id> or <name:id>
   */
  function hasEmojiPrefix(groupName) {
    if (!groupName) return false;
    // Match patterns like <:iotw1:123456789> or <disco:123456789>
    return /^<a?:[^:>]+:\d+>/.test(groupName.trim());
  }
  
  /**
   * Removes emoji prefix from group name
   * @param {string} groupName - The group name
   * @returns {string} Group name without emoji prefix
   */
  function removeEmojiPrefix(groupName) {
    if (!groupName) return '';
    return groupName.replace(/^<a?:[^:>]+:\d+>\s*/, '').trim();
  }
  
  module.exports = {
    escapeRegex,
    removeSpecialChars,
    createFlexiblePattern,
    flexibleMatch,
    matchesAnyTerm,
    matchesAllTerms,
    cardMatchesTerm,
    hasEmojiPrefix,
    removeEmojiPrefix
  };