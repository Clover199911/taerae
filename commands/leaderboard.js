// ============================================================================
// LEADERBOARD COMMAND - Card Ownership Rankings
// ============================================================================
// Usage: ?leaderboard [rarity] [group/search terms]
// Example: ?lb, ?lb mythic, ?lb disco, ?lb unique winter
// ============================================================================

const User = require("../models/user");
const Card = require("../models/card");
const specialGroups = require("../config/specialGroups");
const { BOT_USER_ID } = require("../config/constants");

// ============================================================================
// CONFIGURATION - Add new groups here!
// ============================================================================

const DISCORD_BOT_ID = BOT_USER_ID;
const RARITY_TYPES = ['standard', 'unique', 'glyph', 'mythic'];


// Cache configuration - in-memory fallback when Redis unavailable
const queryCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const REDIS_CACHE_TTL = 300; // 5 minutes in seconds
const MAX_CACHE_SIZE = 500;

// Pre-computed special group exclusion regex (cached at module load)
let specialGroupExcludeRegex = null;
const initSpecialGroupRegex = () => {
  if (specialGroupExcludeRegex !== null) return;
  const patterns = specialGroups.getAllKeys()
    .filter(key => specialGroups[key].isCombined)
    .map(key => `^${escapeRegex(specialGroups[key].emoji)}`);
  
  if (patterns.length > 0) {
    specialGroupExcludeRegex = new RegExp(patterns.join('|'));
  } else {
    specialGroupExcludeRegex = false; // No patterns to exclude
  }
};
initSpecialGroupRegex();

// ============================================================================
// MAIN COMMAND
// ============================================================================

module.exports = {
  name: "leaderboard",
  aliases: ["lb"],
  description: "Display card ownership leaderboard",

  async execute(msg, args) {
    const startTime = Date.now();
    
    try {
      const cacheKey = args.join(':') || 'default';
      
      // Try to get cached query data
      let queryData = await this.getCachedQuery(cacheKey);
      
      if (!queryData) {
        queryData = this.buildQuery(args);
        await this.setCachedQuery(cacheKey, queryData);
      }

      // Try to get cached leaderboard results first
      let leaderboard = await this.getCachedLeaderboard(cacheKey);
      
      if (!leaderboard) {
        leaderboard = await this.fetchLeaderboard(queryData.query);
        await this.setCachedLeaderboard(cacheKey, leaderboard);
      }
      
      const embed = this.createEmbed(queryData.title, leaderboard, queryData.color);
      
      await msg.channel.createMessage({ 
        embeds: [embed],
        messageReference: { messageID: msg.id }
      });

      const duration = Date.now() - startTime;
      if (duration > 2000) {
        console.warn(`[Leaderboard] Slow query: ${duration}ms for "${args.join(' ')}"`);
      }

    } catch (error) {
      console.error('[Leaderboard] Error:', error);
      return this.sendErrorMessage(msg);
    }
  },

  // ============================================================================
  // QUERY BUILDING - Much simpler now!
  // ============================================================================

  buildQuery(args) {
    const query = { discordId: { $ne: DISCORD_BOT_ID } };
    let title = "🏆 Leaderboard";
    let color = 0xcaf0f8; // Default color

    if (!args.length) {
      // Use pre-computed regex instead of creating new ones each time
      if (specialGroupExcludeRegex) {
        query.group = { $not: specialGroupExcludeRegex };
      }
      
      return { query, title, color };
    }

    const terms = args.map(t => t.toLowerCase().trim());
    const rarities = this.extractRarities(terms);
    const searchTerms = terms.filter(t => !rarities.includes(t));

    // Add rarity filter
    if (rarities.length) {
      query.rarity = { $in: rarities.map(r => new RegExp(r, 'i')) };
      title += ` [${rarities.join(', ')}]`;
    }

    // Check for special group search
    const specialGroup = this.findSpecialGroup(searchTerms);
    
    if (specialGroup) {
      query.group = { $regex: new RegExp(`^${escapeRegex(specialGroup.emoji)}`) };
      title += ` "${specialGroup.displayName}"`;
      color = specialGroup.color;
      return { query, title, color };
    }

    // Regular search in group/name
    if (searchTerms.length) {
      const searchRegex = new RegExp(searchTerms.join('.*'), 'i');
      query.$or = [
        { group: { $regex: searchRegex } },
        { name: { $regex: searchRegex } }
      ];
      title += ` "${searchTerms.join(' ')}"`;
      
      // Try to set color based on search terms
      color = this.getColorFromSearch(searchTerms);
    }

    return { query, title, color };
  },

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  extractRarities(terms) {
    return terms.filter(term => 
      RARITY_TYPES.some(r => r.startsWith(term))
    ).map(term => 
      RARITY_TYPES.find(r => r.startsWith(term))
    );
  },

  findSpecialGroup(searchTerms) {
    const searchKey = searchTerms.join(' ').toLowerCase();
    return specialGroups.findBySearchTerm(searchKey);
  },

  getColorFromSearch(terms) {
    const search = terms.join(' ');
    
    // Check special groups first
    for (const key of specialGroups.getAllKeys()) {
      if (search.includes(key)) return specialGroups[key].color;
    }
    
    // Check rarities
    if (search.includes('mythic')) return 0xffd700;
    if (search.includes('glyph')) return 0x9b59b6;
    
    return 0xcaf0f8; // Default
  },

  // ============================================================================
  // DATABASE OPERATIONS
  // ============================================================================

  async fetchLeaderboard(query) {
    return await User.aggregate([
      { $match: query },
      { $group: { _id: "$discordId", totalCards: { $sum: 1 } } },
      { $sort: { totalCards: -1 } },
      { $limit: 10 }
    ]);
  },

  // ============================================================================
  // EMBED CREATION
  // ============================================================================

  createEmbed(title, leaderboard, color) {
    if (!leaderboard?.length) {
      return {
        title: "📊 " + title,
        description: "No collectors found. Try different filters!",
        color: 0x95a5a6
      };
    }

    const fields = leaderboard.map((user, i) => ({
      name: `${this.getMedal(i)} #${i + 1}`,
      value: `<@${user._id}>\n${user.totalCards.toLocaleString()} cards`,
      inline: true
    }));

    // Responsive layout: only pad for 3-column if enough entries
    if (fields.length > 3 && fields.length % 3 !== 0) {
      while (fields.length % 3 !== 0 && fields.length < 12) {
        fields.push({ name: '\u200B', value: '\u200B', inline: true });
      }
    }

    const total = leaderboard.reduce((sum, user) => sum + user.totalCards, 0);
    
    return {
      title: "🏆 " + title,
      description: `**${leaderboard.length}** collectors • **${total.toLocaleString()}** cards`,
      color,
      fields,
      footer: { text: "Updated " + new Date().toLocaleTimeString() }
    };
  },

  getMedal(index) {
    return ['🥇', '🥈', '🥉'][index] || '🏅';
  },

  // ============================================================================
  // CACHING - Uses Redis when available, falls back to in-memory
  // ============================================================================

  async getCachedQuery(key) {
    // Try Redis first
    if (global.redisClient?.isConnected?.()) {
      try {
        const cached = await global.redisClient.get(`lb:query:${key}`);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch (err) {
        // Fall through to in-memory cache
      }
    }

    // In-memory fallback
    const cached = queryCache.get(key);
    if (!cached) return null;
    
    const isValid = cached.timestamp > Date.now() - CACHE_TTL;
    if (!isValid) {
      queryCache.delete(key);
      return null;
    }
    
    return cached.data;
  },

  async setCachedQuery(key, data) {
    // Try Redis first
    if (global.redisClient?.isConnected?.()) {
      try {
        await global.redisClient.setex(`lb:query:${key}`, REDIS_CACHE_TTL, JSON.stringify(data));
        return;
      } catch (err) {
        // Fall through to in-memory cache
      }
    }

    // In-memory fallback
    if (queryCache.size >= MAX_CACHE_SIZE) {
      const firstKey = queryCache.keys().next().value;
      queryCache.delete(firstKey);
    }
    
    queryCache.set(key, { data, timestamp: Date.now() });
  },

  // Cache leaderboard results (expensive aggregation)
  async getCachedLeaderboard(cacheKey) {
    if (global.redisClient?.isConnected?.()) {
      try {
        const cached = await global.redisClient.get(`lb:results:${cacheKey}`);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch (err) {
        // Fall through
      }
    }
    return null;
  },

  async setCachedLeaderboard(cacheKey, data) {
    if (global.redisClient?.isConnected?.()) {
      try {
        await global.redisClient.setex(`lb:results:${cacheKey}`, REDIS_CACHE_TTL, JSON.stringify(data));
      } catch (err) {
        // Silent fail
      }
    }
  },

  // ============================================================================
  // ERROR MESSAGES
  // ============================================================================


  sendErrorMessage(msg) {
    return msg.channel.createMessage({
      embeds: [{
        title: "⚠️ Error",
        description: "Something went wrong. Please try again later.",
        color: 0xe67e22
      }],
      messageReference: { messageID: msg.id }
    });
  }
};

// ============================================================================
// UTILITIES
// ============================================================================

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}