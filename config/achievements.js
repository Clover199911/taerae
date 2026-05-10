// ============================================================================
// ACHIEVEMENT CONFIGURATION - Hidden tier rewards!
// ============================================================================
// These are special achievements that unlock when specific conditions are met
// They're one-time only and show up as surprises!
// ============================================================================

const ACHIEVEMENT_CONFIG = {
  
    // ========== GROUP COMPLETION ACHIEVEMENTS ==========
    
    completeTBZ: {
      type: 'GROUP_COMPLETE',
      requirement: {
        group: 'The Boyz',  // ← CHANGE GROUP NAME HERE
        condition: 'all'  // Must have ALL cards from this group
      },
      reward: {
        type: 'CARD_GENERATION',
        rarity: 'Mythic',
        count: 2,
        condition: 'pristine',
        fromGroup: 'The Boyz'  // Cards will be from this group!
      },
      name: '🎉 The Boyz Master',
      description: 'Collected every single The Boyz card!',
      icon: '👑',
      hidden: true  // Won't show until unlocked
    },

    completeRIIZE: {
      type: 'GROUP_COMPLETE',
      requirement: {
        group: 'RIIZE',  // ← CHANGE GROUP NAME HERE
        condition: 'all'  // Must have ALL cards from this group
      },
      reward: {
        type: 'CARD_GENERATION',
        rarity: 'Mythic',
        count: 2,
        condition: 'pristine',
        fromGroup: 'RIIZE'  // Cards will be from this group!
      },
      name: '🎉 RIIZE Master',
      description: 'Collected every single RIIZE card!',
      icon: '👑',
      hidden: true  // Won't show until unlocked
    },
  

    collectTaeraeWinter: {
      type: 'EMOJI_GROUP_COLLECTOR',  // New type!
      requirement: {
        emojiPattern: '<:taeraewinter:1449661297867227156>',  // The emoji to search for
        count: 5  // Total cards from ANY group with this emoji
      },
      reward: {
        type: 'CARD_GENERATION',
        rarity: 'Mythic',
        count: 1,
        condition: 'pristine',
        fromGroup: '<:taeraewinter:1449661297867227156>'
      },
      name: '❄️ Taerae Winter Collector',
      description: 'Collected 5 cards from Taerae Winter event groups!',
      icon: '<:taeraewinter:1449661297867227156>',
      hidden: false
    },
    // ========== GROUP COLLECTOR ACHIEVEMENTS (10+ cards) ==========
    
    collectNewJeans: {
      type: 'GROUP_COLLECTOR',
      requirement: {
        group: 'ZEROBASEONE',  // ← CHANGE GROUP NAME HERE
        count: 20  // ← CHANGE COUNT HERE (10, 20, 50, etc.)
      },
      reward: {
        type: 'CARD',
        rarity: 'Glyph',
        count: 2,
        condition: 'pristine'
      },
      name: '🐰 ZB1 Fan',
      description: 'Collected 10+ ZEROBASEONE cards!',
      icon: '🎵',
      hidden: false  // Visible from the start
    },
  
  
    // ========== PRISTINE ACHIEVEMENTS ==========
    
    pristineCollector: {
      type: 'PRISTINE_COUNT',
      requirement: {
        count: 50  // ← CHANGE COUNT HERE
      },
      reward: {
        type: 'CURRENCY',
        crystals: 5000,
        astralEssence: 30
      },
      name: '✨ Pristine Perfectionist',
      description: 'Collected 50 pristine condition cards!',
      icon: '💫',
      hidden: false
    },
  
    pristineMaster: {
      type: 'PRISTINE_COUNT',
      requirement: {
        count: 100
      },
      reward: {
        type: 'CARD_GENERATION',
        rarity: 'Mythic',
        count: 5,
        condition: 'pristine'
      },
      name: '🌟 Pristine Legend',
      description: 'Collected 100 pristine condition cards!',
      icon: '👑',
      hidden: true
    },
  
    // ========== RARITY ACHIEVEMENTS ==========
    
    mythicHunter: {
      type: 'RARITY_COUNT',
      requirement: {
        rarity: 'Mythic',
        count: 50  // ← CHANGE COUNT HERE
      },
      reward: {
        type: 'PACK',
        packType: 'ascent-2',
        count: 1
      },
      name: '🔮 Mythic Hunter',
      description: 'Collected 20 Mythic cards!',
      icon: '🎆',
      hidden: false
    },

  
    // ========== SPEED ACHIEVEMENTS ==========
    
    speedCollector: {
      type: 'DAILY_COLLECTION',
      requirement: {
        count: 50,  // Collect 50 cards in one day
        timeframe: 'day'
      },
      reward: {
        type: 'CURRENCY',
        crystals: 3000,
        stardust: 5
      },
      name: '⚡ Speed Demon',
      description: 'Collected 50 cards in a single day!',
      icon: '🚀',
      hidden: false
    },
  
    weeklyGrind: {
      type: 'WEEKLY_COLLECTION',
      requirement: {
        count: 200,  // Collect 200 cards in one week
        timeframe: 'week'
      },
      reward: {
        type: 'PACK',
        packType: 'ascent-1',
        count: 3
      },
      name: '📅 Weekly Warrior',
      description: 'Collected 200 cards in one week!',
      icon: '💪',
      hidden: true
    },
  
    // ========== PACK ACHIEVEMENTS ==========
    
    packAddict: {
      type: 'PACK_OPENED',
      requirement: {
        count: 50  // Opened 50 packs total
      },
      reward: {
        type: 'PACK',
        packType: 'premium-10',
        count: 1
      },
      name: '📦 Pack Addict',
      description: 'Opened 50 card packs!',
      icon: '🎁',
      hidden: false
    },
  
    packMaster: {
      type: 'PACK_OPENED',
      requirement: {
        count: 200
      },
      reward: {
        type: 'CHOICE',
        options: [
          { type: 'PACK', packType: 'ascent-3', count: 1 },
          { type: 'CARD', rarity: 'Mythic', count: 5, condition: 'pristine' },
          { type: 'CURRENCY', crystals: 10000, astralEssence: 70 }
        ]
      },
      name: '🏆 Pack Master',
      description: 'Opened 200 card packs!',
      icon: '🎉',
      hidden: true
    },
  
    // ========== COLLECTION MILESTONE ACHIEVEMENTS ==========
    
    collectionStarter: {
      type: 'TOTAL_CARDS',
      requirement: {
        count: 500
      },
      reward: {
        type: 'CURRENCY',
        crystals: 2000,
        astralEssence: 15
      },
      name: '🌱 Collection Starter',
      description: 'Reached 500 total cards!',
      icon: '🎯',
      hidden: false
    },
  
    collectionVeteran: {
      type: 'TOTAL_CARDS',
      requirement: {
        count: 2000
      },
      reward: {
        type: 'CARD_GENERATION',
        rarities: ['Glyph', 'Mythic'],  // Mix of rarities!
        count: 5,
        pristineChance: 0.5
      },
      name: '🎖️ Collection Veteran',
      description: 'Reached 2000 total cards!',
      icon: '🏅',
      hidden: true
    },
  
    // ========== UNIQUE ACHIEVEMENTS (Add your own!) ==========

  
  };
  
  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================
  
  const getAchievementById = (achievementId) => ACHIEVEMENT_CONFIG[achievementId];
  
  const getAllAchievements = () => {
    return Object.entries(ACHIEVEMENT_CONFIG).map(([id, config]) => ({
      id,
      ...config
    }));
  };
  
  const getVisibleAchievements = () => {
    return getAllAchievements().filter(a => !a.hidden);
  };
  
  const getAchievementsByType = (type) => {
    return getAllAchievements().filter(a => a.type === type);
  };
  
  // ============================================================================
  // EXPORTS
  // ============================================================================
  
  module.exports = {
    ACHIEVEMENT_CONFIG,
    getAchievementById,
    getAllAchievements,
    getVisibleAchievements,
    getAchievementsByType
  };