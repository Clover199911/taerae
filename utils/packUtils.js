const Card = require('../models/card');
const User = require('../models/user');
const { generateUniqueCode } = require('../utils/cardCodeGenerator');
const { getCardWellness } = require('../utils/cardWellness');
const { getRandomCardCondition } = require('../utils/status');
const searchUtils = require('../utils/searchUtils');

/* ========================================
   CONFIGURATION
======================================== */
const CONFIG = {
  CACHE_TTL: 5 * 60 * 1000,
  MAX_CACHE_SIZE: 1000,
  CACHE_CLEANUP_INTERVAL: 120000,
  EMOJIS: {
    crystals: '<:rose:1461015415466496191> ',
    essence: '<:astralessence:1461015891138318598>'
  }
};

/* ========================================
   CACHE MANAGEMENT
======================================== */
const cardCache = new Map();
const SPAWNABLE_REGEX = { spawnable: true };

const formatNumber = (num) => {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
};

const formatPrice = (price) => {
  const parts = [];
  if (price.crystals) parts.push(`${formatNumber(price.crystals)} crystals`);
  if (price.astralEssence) parts.push(`${formatNumber(price.astralEssence)} astral essence`);
  return parts.join(" + ") || "FREE";
};

/* ========================================
   PACK DISPLAY CREATION
======================================== */
const createPackDisplay = (categoryKey, userCurrency, PACK_CONFIG) => {
  const category = PACK_CONFIG.CATEGORIES[categoryKey];

  const packsList = category.packs
    .map(packType => {
      const pack = PACK_CONFIG[packType];
      const price = formatPrice(pack.price);
      const weekly = pack.weeklyLimit ? ' · Weekly' : '';
      const pristine = pack.pristineChance ? `${(pack.pristineChance * 100).toFixed(0)}% pristine` : '';
      const groupFocus = pack.groupFocusChance ? `${(pack.groupFocusChance * 100).toFixed(0)}% group focus` : '';
      
      // Build details line (only show relevant stats)
      const details = [pristine, groupFocus].filter(Boolean).join(' · ');
      
      return `**${pack.cardCount} Cards** — ${price}${weekly}${details ? `\n↳ ${details}` : ''}`;
    })
    .join('\n\n');

  // Cleaner category description (strip markdown headers)
  const cleanDesc = category.description.replace(/^###\s*/gm, '');

  return {
    embed: {
      title: `${category.title}`,
      description: `${cleanDesc}\n\n${packsList}`,
      color: category.color || 0x5865F2,
      footer: { text: `Balance: ${formatNumber(userCurrency.crystals)} crystals · ${formatNumber(userCurrency.astralEssence)} essence` }
    }
  };
};

/* ========================================
   HELPER: ASSIGN PRINT NUMBER
======================================== */
const assignPrintNumber = async (cardId) => {
  try {
    const card = await Card.findOneAndUpdate(
      { cardId: cardId },
      { $inc: { printCounter: 1 } },
      { new: true, upsert: false }
    );

    if (!card) {
      console.error(`[PRINT_ASSIGN] Card not found: ${cardId}`);
      return 1;
    }

    return card.printCounter;
  } catch (error) {
    console.error(`[PRINT_ASSIGN_ERROR] cardId ${cardId}:`, error);
    return 1;
  }
};

/* ========================================
   GROUP VALIDATION FOR GROUP-FOCUSED PACKS
======================================== */
const validateGroupForPack = async (groupName, packConfig, PACK_CONFIG) => {
  if (PACK_CONFIG.isGroupBlocked(groupName)) {
    return {
      valid: false,
      error: `🚫 **Event groups are not allowed**\n\nThe group "${groupName}" cannot be used for group-focused packs (event/special cards).`
    };
  }

  const normalizedSearch = groupName.toLowerCase();
  const escapedSearch = searchUtils.escapeRegex(normalizedSearch);
  
  // Use aggregation to batch group validation - much faster than distinct + loop
  const groupAggregation = await Card.aggregate([
    {
      $match: {
        spawnable: true,
        rarity: { $in: packConfig.rarities },
        $or: [
          { group: new RegExp(`^${escapedSearch}$`, 'i') },
          { group: new RegExp(`^${escapedSearch}\\s`, 'i') },
          { group: new RegExp(`^${escapedSearch}\\[`, 'i') },
          { group: new RegExp(`(\\s|\\[)${escapedSearch}(\\s|\\[|$)`, 'i') }
        ]
      }
    },
    {
      $group: {
        _id: '$group',
        count: { $sum: 1 }
      }
    }
  ]);

  if (!groupAggregation.length) {
    // Check if group exists at all (without rarity/spawnable filter)
    const groupExists = await Card.exists({
      $or: [
        { group: new RegExp(`^${escapedSearch}$`, 'i') },
        { group: new RegExp(`^${escapedSearch}\\s`, 'i') },
        { group: new RegExp(`^${escapedSearch}\\[`, 'i') },
        { group: new RegExp(`(\\s|\\[)${escapedSearch}(\\s|\\[|$)`, 'i') }
      ]
    });

    if (!groupExists) {
      return {
        valid: false,
        error: `❌ **Group not found**\n\nNo group matching "${groupName}" exists in the database.\n\nPlease check your spelling or try another group.`
      };
    }

    return {
      valid: false,
      error: `❌ **No spawnable cards found**\n\nGroups matching "${groupName}" exist, but none have spawnable cards in the pack's rarities.\n\nPlease choose a different group.`
    };
  }

  const matchingGroupsWithCards = groupAggregation.map(g => g._id);
  const cardCount = groupAggregation.reduce((sum, g) => sum + g.count, 0);

  const minRequired = 10;
  if (cardCount < minRequired) {
    return {
      valid: false,
      error: `⚠️ **Insufficient cards**\n\nThe group "${groupName}" only has ${cardCount} available cards in the pack's rarities.\n\nMinimum required: ${minRequired} cards\n\nPlease choose a different group.`
    };
  }

  return {
    valid: true,
    matchingGroups: matchingGroupsWithCards,
    displayName: matchingGroupsWithCards.length === 1 ? matchingGroupsWithCards[0] : groupName,
    cardCount,
    multipleGroups: matchingGroupsWithCards.length > 1
  };
};

/* ========================================
   OPTIMIZED CARD GENERATION
======================================== */
const generateCards = async (packConfig, userId, targetGroup = null) => {
  const cards = [];
  const cardPools = await fetchCardPools(packConfig, targetGroup);

  if (!cardPools.normal || cardPools.normal.length === 0) {
    throw new Error(`No spawnable cards found for rarities: ${packConfig.rarities.join(', ')}`);
  }

  if (targetGroup && (!cardPools.targetGroup || cardPools.targetGroup.length === 0)) {
    console.warn(`[PACK_GEN_WARN] No cards found for target group: ${targetGroup}`);
  }

  const cardGenerationPromises = [];
  for (let i = 0; i < packConfig.cardCount; i++) {
    cardGenerationPromises.push(generateSingleCard(packConfig, cardPools, userId, targetGroup));
  }

  const generatedCards = await Promise.all(cardGenerationPromises);
  cards.push(...generatedCards);

  return cards;
};

/* ========================================
   SAVE CARDS WITH PRINT NUMBERS
======================================== */
const saveCardsToDatabase = async (cardsData) => {
  try {
    for (const cardData of cardsData) {
      cardData.printNumber = await assignPrintNumber(cardData.cardId);
    }

    await User.insertMany(cardsData, { 
      ordered: false,
      lean: true
    });

    console.log(`[PACK_CARDS_SAVED] ${cardsData.length} cards saved with print numbers`);
  } catch (error) {
    if (error.code !== 11000) {
      console.error('[PACK_BATCH_INSERT_ERR] Falling back to individual inserts:', error);
      
      for (const card of cardsData) {
        try {
          if (!card.printNumber) {
            card.printNumber = await assignPrintNumber(card.cardId);
          }
          await new User(card).save();
        } catch (saveError) {
          console.error(`[PACK_INDIVIDUAL_SAVE_ERROR] ${card.name}:`, saveError.message);
        }
      }
    }
  }
};

/* ========================================
   HELPER: FETCH ALL CARD POOLS (OPTIMIZED)
======================================== */
const fetchCardPools = async (packConfig, targetGroup = null) => {
  const pools = {};
  const fetchPromises = [];
  const poolKeys = [];

  // Prepare normal cards fetch
  const normalCacheKey = JSON.stringify({
    rarities: packConfig.rarities,
    spawnable: true
  });

  const cachedNormal = cardCache.get(normalCacheKey);
  if (!cachedNormal) {
    fetchPromises.push(
      Card.find({
        rarity: { $in: packConfig.rarities },
        ...SPAWNABLE_REGEX
      })
      .select('name group rarity imageURL cardId')
      .lean()
      .hint({ rarity: 1, spawnable: 1 })
    );
    poolKeys.push({ type: 'normal', cacheKey: normalCacheKey });
  } else {
    pools.normal = cachedNormal.data;
  }

  // Prepare target group fetch
  if (targetGroup) {
    const groupCacheKey = `group:${JSON.stringify(targetGroup)}:${JSON.stringify(packConfig.rarities)}`;
    const cachedGroup = cardCache.get(groupCacheKey);

    if (!cachedGroup) {
      const groupArray = Array.isArray(targetGroup) ? targetGroup : [targetGroup];
      const groupRegexes = groupArray.map(g => new RegExp(`^${searchUtils.escapeRegex(g)}$`, 'i'));

      fetchPromises.push(
        Card.find({
          $or: groupRegexes.map(regex => ({ group: regex })),
          rarity: { $in: packConfig.rarities },
          ...SPAWNABLE_REGEX
        })
        .select('name group rarity imageURL cardId')
        .lean()
      );
      poolKeys.push({ type: 'targetGroup', cacheKey: groupCacheKey });
    } else {
      pools.targetGroup = cachedGroup.data;
    }
  }

  // Prepare winter cards fetch
  if (packConfig.winterCardIds && packConfig.winterCardIds.length > 0) {
    const winterCacheKey = `winter:${packConfig.winterCardIds.join(',')}`;
    const cachedWinter = cardCache.get(winterCacheKey);
    
    if (!cachedWinter) {
      fetchPromises.push(
        Card.find({
          cardId: { $in: packConfig.winterCardIds },
          ...SPAWNABLE_REGEX
        })
        .select('name group rarity imageURL cardId')
        .lean()
      );
      poolKeys.push({ type: 'winter', cacheKey: winterCacheKey });
    } else {
      pools.winter = cachedWinter.data;
    }
  }

  // Prepare new cards fetch
  if (packConfig.newCardIds && packConfig.newCardIds.length > 0) {
    const newCacheKey = `new:${packConfig.newCardIds.join(',')}`;
    const cachedNew = cardCache.get(newCacheKey);
    
    if (!cachedNew) {
      fetchPromises.push(
        Card.find({
          cardId: { $in: packConfig.newCardIds },
          ...SPAWNABLE_REGEX
        })
        .select('name group rarity imageURL cardId')
        .lean()
      );
      poolKeys.push({ type: 'new', cacheKey: newCacheKey });
    } else {
      pools.new = cachedNew.data;
    }
  }

  // Execute all uncached queries in parallel
  if (fetchPromises.length > 0) {
    const results = await Promise.all(fetchPromises);
    
    results.forEach((result, index) => {
      const { type, cacheKey } = poolKeys[index];
      pools[type] = result;
      
      // Cache if we got results
      if (result.length > 0) {
        // Enforce cache size limit before adding
        if (cardCache.size >= CONFIG.MAX_CACHE_SIZE) {
          // Remove oldest entries (first 10% of cache)
          const entriesToRemove = Math.ceil(CONFIG.MAX_CACHE_SIZE * 0.1);
          const keys = Array.from(cardCache.keys()).slice(0, entriesToRemove);
          keys.forEach(k => cardCache.delete(k));
        }
        
        cardCache.set(cacheKey, {
          data: result,
          timestamp: Date.now()
        });
      }
    });
  }

  return pools;
};

/* ========================================
   HELPER: GENERATE SINGLE CARD WITH GROUP FOCUS
======================================== */
const generateSingleCard = async (packConfig, cardPools, userId, targetGroup = null) => {
  const isPristine = Math.random() < (packConfig.pristineChance || 0);
  const isWinterCard = packConfig.winterChance && Math.random() < packConfig.winterChance;
  const isNewCard = packConfig.newCardChance && Math.random() < packConfig.newCardChance;
  
  const isTargetGroupCard = targetGroup && 
                            packConfig.groupFocusChance && 
                            Math.random() < packConfig.groupFocusChance;

  let selectedPool = cardPools.normal;
  
  if (isWinterCard && cardPools.winter && cardPools.winter.length > 0) {
    selectedPool = cardPools.winter;
  } else if (isNewCard && cardPools.new && cardPools.new.length > 0) {
    selectedPool = cardPools.new;
  } else if (isTargetGroupCard && cardPools.targetGroup && cardPools.targetGroup.length > 0) {
    selectedPool = cardPools.targetGroup;
    
    if (packConfig.useWeightedRarity) {
      const PACK_CONFIG = require('../utils/packConfig');
      const targetRarity = PACK_CONFIG.getWeightedRarity(packConfig.rarities);
      
      const filteredPool = selectedPool.filter(c => c.rarity === targetRarity);
      
      if (filteredPool.length > 0) {
        selectedPool = filteredPool;
      }
    }
  } else if (packConfig.useWeightedRarity) {
    const PACK_CONFIG = require('../utils/packConfig');
    const targetRarity = PACK_CONFIG.getWeightedRarity(packConfig.rarities);
    
    const filteredPool = cardPools.normal.filter(c => c.rarity === targetRarity);
    
    if (filteredPool.length > 0) {
      selectedPool = filteredPool;
    }
  }

  const card = selectedPool[Math.floor(Math.random() * selectedPool.length)];
  const cardCode = await generateUniqueCode();

  return {
    discordId: userId,
    cardCode,
    name: card.name,
    group: card.group,
    rarity: card.rarity,
    imageURL: card.imageURL,
    condition: isPristine ? 'Pristine' : getRandomCardCondition(),
    cardWellness: getCardWellness(card.rarity),
    cardId: card.cardId,
    printNumber: null
  };
};

/* ========================================
   CACHE CLEANUP
======================================== */
const cleanupCache = () => {
  const now = Date.now();
  for (const [key, value] of cardCache.entries()) {
    if (now - value.timestamp > CONFIG.CACHE_TTL) {
      cardCache.delete(key);
    }
  }
};

setInterval(cleanupCache, CONFIG.CACHE_CLEANUP_INTERVAL);

if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    if (cardCache.size > CONFIG.MAX_CACHE_SIZE) {
      console.warn(`[PACK_UTILS] Cache size warning: ${cardCache.size} entries`);
      cleanupCache();
    }
  }, 30000);
}

/* ========================================
   EXPORTS
======================================== */
module.exports = {
  generateCards,
  saveCardsToDatabase,
  formatPrice,
  createPackDisplay,
  cardCache,
  cleanupCache,
  formatNumber,
  validateGroupForPack
};