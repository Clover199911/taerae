const PACK_CONFIG = require('./packConfig');
const { validateGroupForPack } = require('./packUtils');

/* ========================================
   VOUCHER PARSING & VALIDATION
======================================== */

/**
 * Parse reward string into structured object
 * Format: pack:TYPE:QTY:GROUP,crystals:AMT,essence:AMT,cards:QTY:RARITY:CONDITION:GROUP
 * @param {string} rewardString - Raw reward string from command
 * @returns {Object} Parsed rewards object
 */
const parseRewards = (rewardString) => {
  const rewards = {
    packs: [],
    currency: {
      crystals: 0,
      astralEssence: 0,
      stardust: 0
    },
    cards: []
  };

  if (!rewardString) {
    throw new Error('No rewards specified');
  }

  const parts = rewardString.split(',').map(p => p.trim());

  for (const part of parts) {
    const segments = part.split(':').map(s => s.trim());
    const type = segments[0].toLowerCase();

    try {
      if (type === 'pack') {
        // Format: pack:TYPE:QTY or pack:TYPE:QTY:GROUP
        if (segments.length < 3) {
          throw new Error(`Invalid pack format: ${part}. Use pack:TYPE:QTY or pack:TYPE:QTY:GROUP`);
        }

        const packType = segments[1];
        const quantity = parseInt(segments[2]);
        const targetGroup = segments[3] || null;

        if (!PACK_CONFIG[packType]) {
          throw new Error(`Invalid pack type: ${packType}`);
        }

        if (isNaN(quantity) || quantity < 1 || quantity > 1000) {
          throw new Error(`Invalid pack quantity: ${segments[2]} (must be 1-1000)`);
        }

        rewards.packs.push({
          type: packType,
          quantity,
          targetGroup
        });

      } else if (type === 'crystals' || type === 'crystal') {
        // Format: crystals:AMT
        if (segments.length < 2) {
          throw new Error(`Invalid crystals format: ${part}. Use crystals:AMOUNT`);
        }

        const amount = parseInt(segments[1]);
        if (isNaN(amount) || amount < 1) {
          throw new Error(`Invalid crystals amount: ${segments[1]}`);
        }

        rewards.currency.crystals += amount;

      } else if (type === 'essence' || type === 'astralessence') {
        // Format: essence:AMT
        if (segments.length < 2) {
          throw new Error(`Invalid essence format: ${part}. Use essence:AMOUNT`);
        }

        const amount = parseInt(segments[1]);
        if (isNaN(amount) || amount < 1) {
          throw new Error(`Invalid essence amount: ${segments[1]}`);
        }

        rewards.currency.astralEssence += amount;

      } else if (type === 'stardust') {
        // Format: stardust:AMT
        if (segments.length < 2) {
          throw new Error(`Invalid stardust format: ${part}. Use stardust:AMOUNT`);
        }

        const amount = parseInt(segments[1]);
        if (isNaN(amount) || amount < 1) {
          throw new Error(`Invalid stardust amount: ${segments[1]}`);
        }

        rewards.currency.stardust += amount;

      } else if (type === 'cards' || type === 'card') {
        // Format: cards:QTY or cards:QTY:RARITY or cards:QTY:RARITY:CONDITION or cards:QTY:RARITY:CONDITION:GROUP
        if (segments.length < 2) {
          throw new Error(`Invalid cards format: ${part}. Use cards:QTY[:RARITY][:CONDITION][:GROUP]`);
        }

        const quantity = parseInt(segments[1]);
        if (isNaN(quantity) || quantity < 1 || quantity > 100) {
          throw new Error(`Invalid card quantity: ${segments[1]} (must be 1-100)`);
        }

        const rarity = segments[2] || null;
        const condition = segments[3] || null;
        const group = segments[4] || null;

        // Validate rarity if specified
        if (rarity) {
          const validRarities = ['Standard', 'Unique', 'Glyph', 'Mythic'];
          if (!validRarities.includes(rarity)) {
            throw new Error(`Invalid rarity: ${rarity}. Valid: ${validRarities.join(', ')}`);
          }
        }

        // Validate condition if specified
        if (condition) {
          const validConditions = ['Pristine', 'Mint', 'Good', 'Worn', 'Damaged'];
          if (!validConditions.find(c => c.toLowerCase() === condition.toLowerCase())) {
            throw new Error(`Invalid condition: ${condition}. Valid: ${validConditions.join(', ')}`);
          }
        }

        rewards.cards.push({
          quantity,
          rarity,
          condition: condition ? condition.charAt(0).toUpperCase() + condition.slice(1).toLowerCase() : null,
          group
        });

      } else {
        throw new Error(`Unknown reward type: ${type}. Valid: pack, crystals, essence, stardust, cards`);
      }
    } catch (err) {
      throw new Error(`Error parsing "${part}": ${err.message}`);
    }
  }

  // Validate at least one reward
  if (rewards.packs.length === 0 && 
      rewards.currency.crystals === 0 && 
      rewards.currency.astralEssence === 0 && 
      rewards.currency.stardust === 0 && 
      rewards.cards.length === 0) {
    throw new Error('At least one reward must be specified');
  }

  return rewards;
};

/**
 * Parse expiration time string
 * Format: 7d, 24h, 30m
 * @param {string} timeString - Time string
 * @returns {Date} Expiration date
 */
const parseExpiration = (timeString) => {
  if (!timeString) {
    throw new Error('Expiration time required');
  }

  const match = timeString.match(/^(\d+)([dhm])$/i);
  if (!match) {
    throw new Error('Invalid time format. Use: 7d, 24h, or 30m');
  }

  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();

  const now = Date.now();
  let milliseconds = 0;

  switch (unit) {
    case 'd':
      milliseconds = value * 24 * 60 * 60 * 1000;
      break;
    case 'h':
      milliseconds = value * 60 * 60 * 1000;
      break;
    case 'm':
      milliseconds = value * 60 * 1000;
      break;
  }

  if (milliseconds < 60000) { // Less than 1 minute
    throw new Error('Expiration must be at least 1 minute');
  }

  return new Date(now + milliseconds);
};

/**
 * Validate group for group-focused packs in voucher
 * @param {Array} packs - Array of pack rewards
 * @returns {Promise<Array>} Array of validation errors
 */
const validatePackGroups = async (packs) => {
  const errors = [];

  for (const pack of packs) {
    const packConfig = PACK_CONFIG[pack.type];
    
    // Check if pack requires group
    if (packConfig.groupFocusChance && packConfig.groupFocusChance > 0) {
      if (!pack.targetGroup) {
        errors.push(`Pack ${pack.type} requires a target group (it's a group-focused pack)`);
        continue;
      }

      // Validate group exists and has enough cards
      try {
        const validation = await validateGroupForPack(pack.targetGroup, packConfig, PACK_CONFIG);
        if (!validation.valid) {
          errors.push(`Pack ${pack.type} group validation failed: ${validation.error}`);
        }
      } catch (err) {
        errors.push(`Pack ${pack.type} group validation error: ${err.message}`);
      }
    } else {
      // Non-group pack shouldn't have targetGroup
      if (pack.targetGroup) {
        errors.push(`Pack ${pack.type} is not a group-focused pack, remove the group parameter`);
      }
    }
  }

  return errors;
};

/**
 * Format rewards for display
 * @param {Object} rewards - Rewards object
 * @returns {string} Formatted reward string
 */
const formatRewardsDisplay = (rewards) => {
  const lines = [];

  // Packs
  if (rewards.packs && rewards.packs.length > 0) {
    lines.push('**Packs:**');
    rewards.packs.forEach(pack => {
      const groupInfo = pack.targetGroup ? ` (${pack.targetGroup})` : '';
      lines.push(`• ${pack.quantity}x ${pack.type}${groupInfo}`);
    });
  }

  // Currency
  const currencyItems = [];
  if (rewards.currency.crystals > 0) {
    currencyItems.push(`${rewards.currency.crystals.toLocaleString()} <:rose:1461015415466496191>`);
  }
  if (rewards.currency.astralEssence > 0) {
    currencyItems.push(`${rewards.currency.astralEssence.toLocaleString()} <:astralessence:1461015891138318598>`);
  }
  if (rewards.currency.stardust > 0) {
    currencyItems.push(`${rewards.currency.stardust.toLocaleString()} <:stardust:1125059156785762436>`);
  }
  if (currencyItems.length > 0) {
    lines.push('**Currency:**');
    lines.push(`• ${currencyItems.join(' • ')}`);
  }

  // Cards
  if (rewards.cards && rewards.cards.length > 0) {
    lines.push('**Cards:**');
    rewards.cards.forEach(cardReward => {
      const parts = [`${cardReward.quantity}x`];
      if (cardReward.rarity) parts.push(cardReward.rarity);
      if (cardReward.condition) parts.push(cardReward.condition);
      if (cardReward.group) parts.push(`(${cardReward.group})`);
      lines.push(`• ${parts.join(' ')}`);
    });
  }

  return lines.join('\n');
};

/**
 * Format expiration time for display
 * @param {Date} expiresAt - Expiration date
 * @returns {string} Formatted time string
 */
const formatExpirationDisplay = (expiresAt) => {
  const timestamp = Math.floor(expiresAt.getTime() / 1000);
  return `<t:${timestamp}:R> (<t:${timestamp}:F>)`;
};

/**
 * Check if voucher expires within the next 24 hours
 * @param {Date} expiresAt - Expiration date
 * @returns {boolean} True if expires within 24h
 */
const expiresWithin24Hours = (expiresAt) => {
  const now = Date.now();
  const expiration = expiresAt.getTime();
  const twentyFourHours = 24 * 60 * 60 * 1000;
  
  return expiration - now <= twentyFourHours && expiration > now;
};

/* ========================================
   EXPORTS
======================================== */
module.exports = {
  parseRewards,
  parseExpiration,
  validatePackGroups,
  formatRewardsDisplay,
  formatExpirationDisplay,
  expiresWithin24Hours
};