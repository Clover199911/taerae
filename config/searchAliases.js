// Search aliases for cabinet command
// Add your shortcuts here to make searching easier!

module.exports = {
    // Group name aliases
    groups: {
      'tbz': 'the boyz',
      'zb1': 'zerobaseone',
      'zb': 'zerobaseone',
      'skz': 'stray kids',
      'svt': 'seventeen',
      'txt': 'tomorrow x together',
      'wayv': 'wayv',
      'enha': 'enhypen',
      'atz': 'ateez',
      'bp': 'blackpink',
      'rv': 'red velvet',
      'nj': 'newjeans',
      'lsf': 'le sserafim',
      'gidle': '(g)i-dle',
      'dc': 'dreamcatcher',
      'mmm': 'mamamoo',
      'ad1': 'alpha drive one',
      'bnd' : 'boynextdoor',
      'w25' : '<:taeraewinter:1449661297867227156>',
      'w24' : '<:winter:1320755932325609543>',
    },
  
    // Rarity aliases (in case people use different terms)
    rarity: {
      'myth': 'mythic',
      'm': 'mythic',
      'g': 'glyph',
      'u': 'unique',
      's': 'standard',
      'std': 'standard',
    },
  
    // Condition aliases
    condition: {
      'p': 'pristine',
      'pris': 'pristine',
      'mint': 'mint',
      'good': 'good',
      'worn': 'worn',
      'dmg': 'damaged',
      'd': 'damaged',
    },
  
    // Helper function to expand all aliases in a search term
    expand(term) {
      const lowerTerm = term.toLowerCase();
      
      // Check each alias category
      if (this.groups[lowerTerm]) return this.groups[lowerTerm];
      if (this.rarity[lowerTerm]) return this.rarity[lowerTerm];
      if (this.condition[lowerTerm]) return this.condition[lowerTerm];
      
      // If no alias found, return original term
      return term;
    },
  
    // Expand multiple terms at once
    expandAll(terms) {
      return terms.map(term => this.expand(term));
    }
  };