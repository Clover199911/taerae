/*  ========================================
UNIFIED PACK COMMAND WITH GROUP-FOCUSED PACKS
========================================
>pack               – open first unopened pack
>pack shop          – open the shop browser
>pack available     – list unopened packs
>pack open [code]   – open specific pack
>pack open          – same as first line
======================================== */

const Eris = require('eris');
const Pack = require('../../models/pack');
const Currency = require('../../models/currency');
const PackCooldown = require('../../models/packCooldown');
const PACK_CONFIG = require('../../utils/packConfig');
const { generatePackCode } = require('../../utils/packCodeGenerator');
const { formatPrice, createPackDisplay, generateCards, saveCardsToDatabase, formatNumber, validateGroupForPack } = require('../../utils/packUtils');
const { RARITY_EMOJIS, CONDITION_EMOJIS } = require('../../config/embedConstants');
const searchAliases = require('../../config/searchAliases');
const { generatePackCollage } = require('../../utils/packCollageGenerator');

/* ========================================
    CONFIGURATION
======================================== */
const CONFIG = {
  shopTimeout: 300000,
  openTimeout: 30000,
  rateLimitWin: 2000,
  maxUnopened: 50,
  groupInputTimeout: 60000,
  
  emojis: {
    crystals: '<:rose:1461015415466496191>',
    essence: '<:astralessence:1461015891138318598>',
    pack: '<:packs:1461015450396921961>',
    ok: '✅',
    err: '❌',
    pristine: '<:pristinee:1272529510696222842>',
    time: '⏰',
    warn: '⚠️',
    target: '🎯',
    hit: '🎯'
  },
  
  colors: {
    success: 0x57F287,
    error: 0xED4245,
    warning: 0xFEE75C,
    info: 0x4ECDC4,
    loading: 0xFFD93D,
    details: 0x9370DB,
    groupFocus: 0xE67E22
  }
};

/* ========================================
    HELPER FUNCTIONS
======================================== */
const parseEmoji = (emojiString) => {
  const match = emojiString.match(/<:(\w+):(\d+)>|<a:(\w+):(\d+)>/);
  if (match) {
    return {
      id: match[2] || match[4],
      name: match[1] || match[3]
    };
  }
  return { name: emojiString };
};

const getConditionEmoji = (condition) => {
  return CONDITION_EMOJIS[condition.toLowerCase()] || '▪';
};

const getRarityStars = (rarity) => {
  return RARITY_EMOJIS[rarity.toLowerCase()] || '☆☆☆☆';
};

/* ========================================
    OPTIMIZED RATE LIMITING (Sliding Window)
======================================== */
const rateLimiter = {
  map: new Map(),
  window: CONFIG.rateLimitWin,
  maxRequests: 5,
  
  check(uid) {
    const now = Date.now();
    const userTimestamps = this.map.get(uid);
    
    if (!userTimestamps) {
      this.map.set(uid, [now]);
      return false;
    }
    
    const valid = [];
    for (const t of userTimestamps) {
      if (now - t < this.window) valid.push(t);
    }
    
    if (valid.length >= this.maxRequests) {
      this.map.set(uid, valid);
      return true;
    }
    
    valid.push(now);
    this.map.set(uid, valid);
    
    if (Math.random() < 0.01) this.cleanup();
    return false;
  },
  
  cleanup() {
    const now = Date.now();
    for (const [uid, timestamps] of this.map.entries()) {
      const valid = timestamps.filter(t => now - t < this.window);
      if (valid.length === 0) this.map.delete(uid);
      else this.map.set(uid, valid);
    }
  }
};

const isRateLimited = uid => rateLimiter.check(uid);

/* ========================================
    OPTIMIZED PACK LOCKING (Timestamp-based)
======================================== */
const packLocks = new Map();

const acquireLock = (key, ttl = 30000) => {
  const now = Date.now();
  
  let cleaned = 0;
  for (const [k, expiry] of packLocks.entries()) {
    if (now > expiry) {
      packLocks.delete(k);
      cleaned++;
    }
    if (cleaned >= 10) break;
  }
  
  const existing = packLocks.get(key);
  if (existing && now < existing) return false;
  
  packLocks.set(key, now + ttl);
  return true;
};

const releaseLock = (key) => {
  packLocks.delete(key);
};

const openingPacks = new Set();

/* ========================================
    GROUP INPUT COLLECTORS (Memory-safe)
======================================== */
const groupInputCollectors = new Map();

const cleanupGroupCollector = (uid, client, handler) => {
  if (handler) {
    client.off('messageCreate', handler);
  }
  groupInputCollectors.delete(uid);
};

/* ========================================
    🎯 GROUP INPUT FLOW (Optimized)
======================================== */
const groupInputFlow = async (msg, uid, packType, shopMsg, client) => {
  const cfg = PACK_CONFIG[packType];

  await shopMsg.edit({
    embeds: [{
      title: 'Select Target Group',
      description: `Type a group name (e.g. \`BOYNEXTDOOR\`, \`bnd\`, \`THE BOYZ\`)\n\nSome event groups are blocked.`,
      color: CONFIG.colors.groupFocus,
      footer: { text: `${packType.replace(/-/g, ' ').toUpperCase()} · ${(cfg.groupFocusChance * 100).toFixed(0)}% focus · Type "cancel" to cancel` }
    }],
    components: []
  });

  return new Promise((resolve) => {
    let resolved = false;
    
    const collector = async (collectedMsg) => {
      if (collectedMsg.author.id !== uid || collectedMsg.channel.id !== msg.channel.id) return;
      if (resolved) return;

      const input = collectedMsg.content.trim();

      if (input.toLowerCase() === 'cancel') {
        resolved = true;
        cleanupGroupCollector(uid, client, collector);
        
        await shopMsg.edit({
          embeds: [{
            title: `${CONFIG.emojis.err} Purchase cancelled`,
            description: 'Group pack purchase was cancelled.',
            color: CONFIG.colors.error
          }],
          components: []
        });

        collectedMsg.delete().catch(() => {});
        return resolve(null);
      }

      let searchTerm = input;
      if (searchAliases.groups && searchAliases.groups[input.toLowerCase()]) {
        searchTerm = searchAliases.groups[input.toLowerCase()];
      }

      const validation = await validateGroupForPack(searchTerm, cfg, PACK_CONFIG);

      if (!validation.valid) {
        await shopMsg.edit({
          embeds: [{
            title: `${CONFIG.emojis.err} Invalid Group`,
            description: validation.error + `\n\n**Please try again or type "cancel" to cancel.**`,
            color: CONFIG.colors.error
          }]
        });

        collectedMsg.delete().catch(() => {});
        return;
      }

      resolved = true;
      cleanupGroupCollector(uid, client, collector);
      collectedMsg.delete().catch(() => {});

      const groupDisplay = validation.multipleGroups 
        ? `${validation.displayName} (${validation.matchingGroups.length} variations found)`
        : validation.displayName;

      const groupsInfo = validation.multipleGroups
        ? `\nMatched: ${validation.matchingGroups.slice(0, 3).join(', ')}${validation.matchingGroups.length > 3 ? ` +${validation.matchingGroups.length - 3} more` : ''}`
        : '';

      const groupDetails = [
        `${cfg.cardCount} cards`,
        `${(cfg.groupFocusChance * 100).toFixed(0)}% group focus`,
        `${(cfg.pristineChance * 100).toFixed(0)}% pristine`
      ];

      await shopMsg.edit({
        embeds: [{
          title: `Confirm: ${groupDisplay}`,
          description: `${formatPrice(cfg.price)}\n${groupDetails.join(' · ')}${groupsInfo}\n\n${validation.cardCount} cards available for this group`,
          color: CONFIG.colors.groupFocus,
          footer: { text: packType.replace(/-/g, ' ').toUpperCase() }
        }],
        components: [{
          type: 1,
          components: [
            { 
              type: 2, 
              style: 3, 
              custom_id: 'confirmGroupBuy', 
              label: 'Confirm'
            },
            { 
              type: 2, 
              style: 4, 
              custom_id: 'cancelGroupBuy', 
              label: 'Cancel'
            }
          ]
        }]
      });

      resolve(validation.matchingGroups);
    };

    groupInputCollectors.set(uid, collector);
    client.on('messageCreate', collector);

    setTimeout(() => {
      if (!resolved && groupInputCollectors.has(uid)) {
        cleanupGroupCollector(uid, client, collector);

        shopMsg.edit({
          embeds: [{
            title: `${CONFIG.emojis.time} Input timeout`,
            description: 'Group selection timed out. Please try again.',
            color: CONFIG.colors.warning
          }],
          components: []
        }).catch(() => {});

        resolve(null);
      }
    }, CONFIG.groupInputTimeout);
  });
};

/* ========================================
    SHOP FLOW (Optimized)
======================================== */
const shopFlow = async (msg, client) => {
  const uid = msg.author.id;

  const currency = await Currency.findOne({ userId: uid }).lean()
              || { crystals: 0, astralEssence: 0 };

  const category = Object.keys(PACK_CONFIG.CATEGORIES)[0];

  const m = await msg.channel.createMessage({
    ...createPackDisplay(category, currency, PACK_CONFIG),
    components: [
      { 
        type: 1, 
        components: [{
          type: 3, 
          custom_id: 'shop_cat', 
          placeholder: 'Select category',
          options: Object.keys(PACK_CONFIG.CATEGORIES).map(k => ({
            label: PACK_CONFIG.CATEGORIES[k].title,
            value: k
          }))
        }]
      },
      { 
        type: 1, 
        components: PACK_CONFIG.CATEGORIES[category].packs.slice(0, 5).map(p => ({
          type: 2, 
          style: 2, 
          custom_id: `buy_${p}`,
          label: `${PACK_CONFIG[p].cardCount} cards`
        }))
      }
    ],
    messageReference: { messageID: msg.id }
  });

  const handlerRef = { active: true };
  
  const handler = async i => {
    if (!handlerRef.active) return;
    if (i.message.id !== m.id || i.member.id !== uid) return;
    
    try {
      if (i.data.custom_id === 'shop_cat') {
        const cat = i.data.values[0];
        
        const fresh = await Currency.findOne({ userId: uid }).lean()
                    || { crystals: 0, astralEssence: 0 };
        
        const newEmbed = createPackDisplay(cat, fresh, PACK_CONFIG);
        
        const newComponents = [
          {
            type: 1,
            components: [{
              type: 3,
              custom_id: 'shop_cat',
              placeholder: 'Select category',
              options: Object.keys(PACK_CONFIG.CATEGORIES).map(k => ({
                label: PACK_CONFIG.CATEGORIES[k].title,
                value: k
              }))
            }]
          },
          {
            type: 1,
            components: PACK_CONFIG.CATEGORIES[cat].packs.slice(0, 5).map(p => ({
              type: 2,
              style: 2,
              custom_id: `buy_${p}`,
              label: `${PACK_CONFIG[p].cardCount} cards`
            }))
          }
        ];
        
        return i.editParent({
          embeds: [newEmbed.embed],
          components: newComponents
        });
      }
      
      if (i.data.custom_id.startsWith('buy_')) {
        await purchaseFlow(i, uid, i.data.custom_id.split('_')[1], m, client, msg);
      }
    } catch (e) {
      console.error('[SHOP_INTERACTION_ERR]', e);
    }
  };

  client.on('interactionCreate', handler);
  
  setTimeout(() => {
    handlerRef.active = false;
    client.off('interactionCreate', handler);
    m.edit({ components: [] }).catch(() => {});
  }, CONFIG.shopTimeout);
};

/* ========================================
    🎯 PURCHASE FLOW WITH GROUP SELECTION
======================================== */
const purchaseFlow = async (i, uid, packType, shopMsg, client, originalMsg) => {
  const cfg = PACK_CONFIG[packType];
  
  if (!cfg) {
    return i.editParent({ 
      embeds: [{
        title: `${CONFIG.emojis.err} Config missing`, 
        color: CONFIG.colors.error
      }]
    });
  }

  // Get balance FIRST before any other checks
  const bal = await Currency.findOne({ userId: uid }).lean()
            || { crystals: 0, astralEssence: 0 };

  // CHECK IF USER CAN AFFORD THE PACK
  const canBuy = bal.crystals >= (cfg.price.crystals || 0)
              && bal.astralEssence >= (cfg.price.astralEssence || 0);
  
  // If cannot afford, show error and return early
  if (!canBuy) {
    return i.editParent({ 
      embeds: [{
        title: `${CONFIG.emojis.err} Insufficient Balance`,
        description: `You don't have enough currency to purchase this pack.\n\n` +
                      `**Price:** ${formatPrice(cfg.price)}\n` +
                      `**Your Balance:** ${formatNumber(bal.crystals)} ${CONFIG.emojis.crystals} • ${formatNumber(bal.astralEssence)} ${CONFIG.emojis.essence}`,
        color: CONFIG.colors.error,
        footer: { text: 'Earn more crystals or astral essence to purchase this pack' }
      }],
      components: [] // Clear buttons
    });
  }

  // Now check pack limit
  const unopened = await Pack.countDocuments({ userId: uid, isOpened: false });
  if (unopened >= CONFIG.maxUnopened) {
    return i.editParent({ 
      embeds: [{
        title: `${CONFIG.emojis.warn} Pack limit reached`,
        description: `You have ${unopened} unopened packs. Open some first!\n\nUse \`?pack available\` to see your packs.`,
        color: CONFIG.colors.warning
      }]
    });
  }

  if (cfg.weeklyLimit) {
    const cd = await PackCooldown.findOne({ userId: uid, packType }).lean();
    if (cd && (Date.now() - cd.lastPurchase.getTime()) < 604800000) {
      const resetTime = new Date(cd.lastPurchase.getTime() + 604800000);
      return i.editParent({ 
        embeds: [{
          title: `${CONFIG.emojis.time} Weekly limit reached`,
          description: `You can purchase this pack again:\n<t:${Math.floor(resetTime.getTime() / 1000)}:R>`,
          color: CONFIG.colors.warning
        }]
      });
    }
  }

  if (cfg.groupFocusChance && cfg.groupFocusChance > 0) {
    await i.acknowledge();
    
    const targetGroup = await groupInputFlow(originalMsg, uid, packType, shopMsg, client);
    
    if (!targetGroup) return;

    const confirmHandlerRef = { active: true };
    
    const confirmHandler = async (ix) => {
      if (!confirmHandlerRef.active) return;
      if (ix.message.id !== shopMsg.id || ix.member.id !== uid) return;
      
      confirmHandlerRef.active = false;
      client.off('interactionCreate', confirmHandler);

      try {
        if (ix.data.custom_id === 'confirmGroupBuy') {
          // DOUBLE CHECK BALANCE before purchasing (in case it changed)
          const freshBal = await Currency.findOne({ userId: uid }).lean()
                        || { crystals: 0, astralEssence: 0 };
          
          const stillCanBuy = freshBal.crystals >= (cfg.price.crystals || 0)
                          && freshBal.astralEssence >= (cfg.price.astralEssence || 0);
          
          if (!stillCanBuy) {
            return ix.editParent({ 
              embeds: [{
                title: `${CONFIG.emojis.err} Insufficient Balance`,
                description: `Your balance changed and you can no longer afford this pack.\n\n` +
                              `**Price:** ${formatPrice(cfg.price)}\n` +
                              `**Your Balance:** ${formatNumber(freshBal.crystals)} ${CONFIG.emojis.crystals} • ${formatNumber(freshBal.astralEssence)} ${CONFIG.emojis.essence}`,
                color: CONFIG.colors.error
              }],
              components: []
            });
          }

          const code = await generatePackCode();

          const targetGroupData = Array.isArray(targetGroup) 
            ? JSON.stringify(targetGroup) 
            : targetGroup;

          await Promise.all([
            Currency.updateOne(
              { userId: uid },
              { 
                $inc: { 
                  crystals: -(cfg.price.crystals || 0),
                  astralEssence: -(cfg.price.astralEssence || 0)
                }
              }
            ),
            cfg.weeklyLimit
              ? PackCooldown.updateOne(
                  { userId: uid, packType },
                  { $set: { lastPurchase: new Date() } },
                  { upsert: true }
                )
              : Promise.resolve(),
            Pack.create({ 
              userId: uid, 
              packCode: code, 
              packType,
              targetGroup: targetGroupData,
              isOpened: false 
            })
          ]);

          const displayGroup = Array.isArray(targetGroup)
            ? `${targetGroup.length} group variation${targetGroup.length > 1 ? 's' : ''}`
            : targetGroup;

          return ix.editParent({ 
            embeds: [{
              title: 'Purchase successful',
              description: `Pack code: \`${code}\`\nTarget: ${displayGroup}\n\nUse \`?pack\` or \`?pack open ${code}\` to open`,
              color: CONFIG.colors.success
            }], 
            components: [] 
          });
        }

        if (ix.data.custom_id === 'cancelGroupBuy') {
          const currency = await Currency.findOne({ userId: uid }).lean()
                      || { crystals: 0, astralEssence: 0 };
          const category = Object.keys(PACK_CONFIG.CATEGORIES)[0];
          const newEmbed = createPackDisplay(category, currency, PACK_CONFIG);

          return ix.editParent({
            embeds: [newEmbed.embed],
            components: [
              { 
                type: 1, 
                components: [{
                  type: 3, 
                  custom_id: 'shop_cat', 
                  placeholder: 'Select category',
                  options: Object.keys(PACK_CONFIG.CATEGORIES).map(k => ({
                    label: PACK_CONFIG.CATEGORIES[k].title,
                    value: k
                  }))
                }]
              },
              { 
                type: 1, 
                components: PACK_CONFIG.CATEGORIES[category].packs.slice(0, 5).map(p => ({
                  type: 2, 
                  style: 2, 
                  custom_id: `buy_${p}`,
                  label: `${PACK_CONFIG[p].cardCount} cards`
                }))
              }
            ]
          });
        }
      } catch (e) {
        console.error('[GROUP_PURCHASE_CONFIRM_ERR]', e);
      }
    };

    client.on('interactionCreate', confirmHandler);
    
    setTimeout(() => {
      confirmHandlerRef.active = false;
      client.off('interactionCreate', confirmHandler);
    }, 30000);

    return;
  }

  // REGULAR PACK (no group focus) - Show purchase confirmation
  const packDetails = [`${cfg.cardCount} cards`, `${(cfg.pristineChance * 100).toFixed(0)}% pristine`];
  if (cfg.winterChance) packDetails.push(`${(cfg.winterChance * 100).toFixed(0)}% winter`);
  if (cfg.newCardChance) packDetails.push(`${(cfg.newCardChance * 100).toFixed(0)}% new cards`);

  await i.editParent({
    embeds: [{
      title: `Purchase ${packType.replace(/-/g, ' ').toUpperCase()}`,
      description: `${formatPrice(cfg.price)}\n${packDetails.join(' · ')}`,
      color: CONFIG.colors.success,
      footer: { text: `Balance: ${formatNumber(bal.crystals)} crystals · ${formatNumber(bal.astralEssence)} essence` }
    }],
    components: [{
      type: 1,
      components: [
        { 
          type: 2, 
          style: 3, 
          custom_id: 'confirmBuy', 
          label: 'Confirm'
        },
        { 
          type: 2, 
          style: 4, 
          custom_id: 'cancelBuy', 
          label: 'Cancel'
        }
      ]
    }]
  });

  const confirmHandlerRef = { active: true };
  
  const filter = x => x.message.id === shopMsg.id && x.member.id === uid;
  
  const confirmHandler = async ix => {
    if (!confirmHandlerRef.active) return;
    if (!filter(ix)) return;
    
    confirmHandlerRef.active = false;
    client.off('interactionCreate', confirmHandler);
    
    try {
      if (ix.data.custom_id === 'confirmBuy') {
        // DOUBLE CHECK BALANCE before purchasing
        const freshBal = await Currency.findOne({ userId: uid }).lean()
                      || { crystals: 0, astralEssence: 0 };
        
        const stillCanBuy = freshBal.crystals >= (cfg.price.crystals || 0)
                        && freshBal.astralEssence >= (cfg.price.astralEssence || 0);
        
        if (!stillCanBuy) {
          return ix.editParent({ 
            embeds: [{
              title: `${CONFIG.emojis.err} Insufficient Balance`,
              description: `Your balance changed and you can no longer afford this pack.\n\n` +
                            `**Price:** ${formatPrice(cfg.price)}\n` +
                            `**Your Balance:** ${formatNumber(freshBal.crystals)} ${CONFIG.emojis.crystals} • ${formatNumber(freshBal.astralEssence)} ${CONFIG.emojis.essence}`,
              color: CONFIG.colors.error
            }],
            components: []
          });
        }

        const code = await generatePackCode();
        
        await Promise.all([
          Currency.updateOne(
            { userId: uid },
            { 
              $inc: { 
                crystals: -(cfg.price.crystals || 0),
                astralEssence: -(cfg.price.astralEssence || 0)
              }
            }
          ),
          cfg.weeklyLimit
            ? PackCooldown.updateOne(
                { userId: uid, packType },
                { $set: { lastPurchase: new Date() } },
                { upsert: true }
              )
            : Promise.resolve(),
          Pack.create({ 
            userId: uid, 
            packCode: code, 
            packType, 
            isOpened: false 
          })
        ]);
        
        return ix.editParent({ 
          embeds: [{
            title: 'Purchase successful',
            description: `Pack code: \`${code}\`\n\nUse \`?pack\` or \`?pack open ${code}\` to open`,
            color: CONFIG.colors.success
          }], 
          components: [] 
        });
      }
      
      if (ix.data.custom_id === 'cancelBuy') {
        const currency = await Currency.findOne({ userId: uid }).lean()
                    || { crystals: 0, astralEssence: 0 };
        const category = Object.keys(PACK_CONFIG.CATEGORIES)[0];
        const newEmbed = createPackDisplay(category, currency, PACK_CONFIG);
        
        return ix.editParent({
          embeds: [newEmbed.embed],
          components: [
            { 
              type: 1, 
              components: [{
                type: 3, 
                custom_id: 'shop_cat', 
                placeholder: 'Select category',
                options: Object.keys(PACK_CONFIG.CATEGORIES).map(k => ({
                  label: PACK_CONFIG.CATEGORIES[k].title,
                  value: k
                }))
              }]
            },
            { 
              type: 1, 
              components: PACK_CONFIG.CATEGORIES[category].packs.slice(0, 5).map(p => ({
                type: 2, 
                style: 2, 
                custom_id: `buy_${p}`,
                label: `${PACK_CONFIG[p].cardCount} cards`
              }))
            }
          ]
        });
      }
    } catch (e) {
      console.error('[PURCHASE_CONFIRM_ERR]', e);
    }
  };
  
  client.on('interactionCreate', confirmHandler);
  
  setTimeout(() => {
    confirmHandlerRef.active = false;
    client.off('interactionCreate', confirmHandler);
  }, 30000);
};

/* ========================================
    🎯 OPEN FLOW WITH TARGET GROUP SUPPORT
    NO IMAGES - TEXT ONLY WITH SPOILER HITS
======================================== */
const openFlow = async (msg, code) => {
  const uid = msg.author.id;
  
  const packQuery = code
    ? { userId: uid, packCode: code, isOpened: false }
    : { userId: uid, isOpened: false };
  
  const pack = await Pack.findOne(packQuery)
    .select('packCode packType targetGroup _id')
    .lean();
  
  if (!pack) {
    return msg.channel.createMessage({ 
      embeds: [{ 
        title: `${CONFIG.emojis.err} No unopened pack found`,
        description: code 
          ? `Pack code \`${code}\` not found or already opened.`
          : 'You have no unopened packs.\n\nUse `?pack shop` to buy packs!',
        color: CONFIG.colors.error
      }], 
      messageReference: { messageID: msg.id }
    });
  }
  
  const lockKey = `${uid}-${pack.packCode}`;
  if (!acquireLock(lockKey, 60000)) {
    return msg.channel.createMessage({ 
      embeds: [{ 
        title: `${CONFIG.emojis.warn} Pack already opening`, 
        description: 'Please wait for the current pack to finish opening.',
        color: CONFIG.colors.warning
      }], 
      messageReference: { messageID: msg.id }
    });
  }
  
  openingPacks.add(lockKey);
  
  const cfg = PACK_CONFIG[pack.packType];
  if (!cfg) {
    releaseLock(lockKey);
    openingPacks.delete(lockKey);
    return msg.channel.createMessage({ 
      embeds: [{ 
        title: `${CONFIG.emojis.err} Config error`,
        description: 'Pack configuration not found. Please contact support.',
        color: CONFIG.colors.error
      }], 
      messageReference: { messageID: msg.id }
    });
  }
  
  // Parse target group
  let targetGroups = [];
  let displayGroup = pack.targetGroup;
  const isGroupPack = !!pack.targetGroup;
  
  if (pack.targetGroup) {
    try {
      const parsed = JSON.parse(pack.targetGroup);
      targetGroups = Array.isArray(parsed) ? parsed : [parsed];
      displayGroup = targetGroups.length === 1 
        ? targetGroups[0]
        : `${targetGroups.length} group variations`;
    } catch (e) {
      targetGroups = [pack.targetGroup];
    }
  }

  const openingDesc = isGroupPack
    ? `Pack: \`${pack.packCode}\`\nTarget Group: **${displayGroup}**\nGenerating ${cfg.cardCount} cards...`
    : `Pack: \`${pack.packCode}\`\nGenerating ${cfg.cardCount} cards...`;

  const m = await msg.channel.createMessage({ 
    embeds: [{ 
      title: '🎲 Opening pack...',
      description: openingDesc,
      color: CONFIG.colors.loading
    }], 
    messageReference: { messageID: msg.id }
  });
  
  try {
    // Generate cards
    const cards = await generateCards(cfg, uid, targetGroups.length ? targetGroups : undefined);
    
    // Save to database
    await saveCardsToDatabase(cards);
    await Pack.deleteOne({ _id: pack._id });
    
    // Update quest progress for pack opening
    const QuestService = require('../../services/QuestService');
    const questTypes = ['open_pack'];
    
    // Add pack-type-specific quest types
    const packType = pack.packType;
    if (packType.startsWith('normal-')) questTypes.push('open_normal');
    else if (packType.startsWith('premium-')) questTypes.push('open_premium');
    else if (packType.startsWith('ascent-')) questTypes.push('open_ascent');
    else if (packType.startsWith('group-')) questTypes.push('open_group');
    
    QuestService.updateQuestProgress(uid, questTypes, 1).catch(err =>
      console.error('[PACK_QUEST_UPDATE_ERROR]', err)
    );
    
    // Track rarity-based collection quests
    const rarityQuestUpdates = {};
    for (const card of cards) {
      const rarity = card.rarity.toLowerCase();
      const questType = `collect_${rarity}`;
      rarityQuestUpdates[questType] = (rarityQuestUpdates[questType] || 0) + 1;
    }
    
    for (const [questType, count] of Object.entries(rarityQuestUpdates)) {
      QuestService.updateQuestProgress(uid, [questType], count).catch(err =>
        console.error('[PACK_RARITY_QUEST_UPDATE_ERROR]', err)
      );
    }
    
    // Track condition-based collection quests
    const conditionQuestUpdates = {};
    for (const card of cards) {
      const condition = card.condition.toLowerCase();
      const questType = `collect_${condition}`;
      conditionQuestUpdates[questType] = (conditionQuestUpdates[questType] || 0) + 1;
    }
    
    for (const [questType, count] of Object.entries(conditionQuestUpdates)) {
      QuestService.updateQuestProgress(uid, [questType], count).catch(err =>
        console.error('[PACK_CONDITION_QUEST_UPDATE_ERROR]', err)
      );
    }
    
    // Count stats
    const pristineCount = cards.filter(c => c.condition.toLowerCase() === 'pristine').length;
    
    // Count target group matches and prepare target group lookup
    let targetGroupCount = 0;
    const targetGroupsLower = targetGroups.map(g => g.toLowerCase());
    
    // Build card lines with spoiler tags for group hits (for the detailed embed)
    const cardLines = cards.map(c => {
      const conditionEmoji = getConditionEmoji(c.condition);
      const rarityStars = getRarityStars(c.rarity);
      const isTargetGroupHit = targetGroups.length > 0 && 
        targetGroupsLower.includes(c.group.toLowerCase());
      
      if (isTargetGroupHit) targetGroupCount++;
      
      const cardText = `[#${c.printNumber}] ${conditionEmoji} ${rarityStars} **${c.group} ${c.name}** — \`${c.cardCode}\``;
      
      return isTargetGroupHit ? `||${cardText}|| ${CONFIG.emojis.hit}` : cardText;
    });
    
    // Generate collage
    const collageBuffer = await generatePackCollage(cards);
    
    // Build brief message content for the public message (no embed)
    let briefContent;
    if (isGroupPack) {
      const groupNameDisplay = targetGroups.length === 1 
        ? targetGroups[0]
        : targetGroups.slice(0, 2).join(', ') + (targetGroups.length > 2 ? ` +${targetGroups.length - 2} more` : '');
      
      briefContent = `🎉 **Pack opened!** — \`${pack.packCode}\`\n` +
                     `${CONFIG.emojis.target} **${targetGroupCount}/${cards.length}** from ${groupNameDisplay}\n` +
                     `${CONFIG.emojis.pristine} **${pristineCount}** pristine`;
    } else {
      briefContent = `🎉 **Pack opened!** — \`${pack.packCode}\`\n` +
                     `${CONFIG.emojis.pristine} **${pristineCount}** pristine`;
    }
    
    // Build full detailed description for the button click
    let fullDescription;
    if (isGroupPack) {
      const groupNameDisplay = targetGroups.length === 1 
        ? targetGroups[0]
        : targetGroups.slice(0, 2).join(', ') + (targetGroups.length > 2 ? ` +${targetGroups.length - 2} more` : '');
      
      fullDescription = `**${cards.length}** cards received\n` +
                       `${CONFIG.emojis.target} **${targetGroupCount}/${cards.length}** from ${groupNameDisplay}\n` +
                       `${CONFIG.emojis.pristine} **${pristineCount}** pristine\n\n` +
                       cardLines.join('\n');
    } else {
      fullDescription = `**${cards.length}** cards received\n` +
                       `${CONFIG.emojis.pristine} **${pristineCount}** pristine\n\n` +
                       cardLines.join('\n');
    }

    const detailedEmbed = {
      title: '🎉 Pack opened!',
      description: fullDescription,
      color: CONFIG.colors.info,
      footer: { text: `Pack ${pack.packCode}` }
    };
    
    // Create button component
    const button = {
      type: 1, // Action Row
      components: [{
        type: 2, // Button
        style: 1, // Primary (blurple)
        custom_id: `pack_details_${msg.author.id}_${Date.now()}`,
        label: 'Show Details'
      }]
    };
    
    // Store the detailed embed for the button interaction
    const customId = button.components[0].custom_id;
    global.packDetailsCache = global.packDetailsCache || new Map();
    global.packDetailsCache.set(customId, {
      embed: detailedEmbed,
      userId: msg.author.id,
      expiresAt: Date.now() + 600000 // 10 minutes
    });
    
    // Clean up old entries
    for (const [key, value] of global.packDetailsCache.entries()) {
      if (value.expiresAt < Date.now()) {
        global.packDetailsCache.delete(key);
      }
    }
    
    // Send the message with collage and button (no embed, just content + image)
    await m.edit({ 
      content: briefContent,
      embeds: [],
      components: [button],
      file: {
        file: collageBuffer,
        name: 'pack_collage.webp'
      }
    });
    
  } catch (err) {
    console.error('[PACK_OPEN_ERR]', err);
    releaseLock(lockKey);
    openingPacks.delete(lockKey);
    return m.edit({
      embeds: [{
        title: `${CONFIG.emojis.err} Error opening pack`,
        description: 'Something went wrong. Please try again or contact support.',
        color: CONFIG.colors.error
      }]
    });
  } finally {
    setTimeout(() => {
      releaseLock(lockKey);
      openingPacks.delete(lockKey);
    }, 1000);
  }
};

/* ========================================
    LIST FLOW (Optimized)
======================================== */
const listFlow = async msg => {
  const uid = msg.author.id;
  
  const list = await Pack.find({ userId: uid, isOpened: false })
    .select('packCode packType targetGroup purchaseDate')
    .sort({ purchaseDate: -1 })
    .lean();
    
  if (!list.length) {
    return msg.channel.createMessage({ 
      embeds: [{ 
        title: '📦 No unopened packs',
        description: 'Use `?pack shop` to purchase packs!',
        color: CONFIG.colors.error
      }], 
      messageReference: { messageID: msg.id }
    });
  }
  
  const grouped = new Map();
  
  for (const p of list) {
    const key = p.targetGroup ? `${p.packType} (${p.targetGroup})` : p.packType;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(p.packCode);
  }
  
  const fields = [];
  for (const [t, codes] of grouped.entries()) {
    const displayCodes = codes.slice(0, 15);
    const remaining = codes.length - 15;
    
    fields.push({ 
      name: `${t.replace(/-/g, ' ').toUpperCase()} (${codes.length})`, 
      value: '`' + displayCodes.join('` `') + '`' + 
              (remaining > 0 ? `\n...${remaining} more` : ''), 
      inline: true 
    });
  }
  
  msg.channel.createMessage({ 
    embeds: [{ 
      title: '📦 Your unopened packs',
      description: `Total: **${list.length}** pack${list.length !== 1 ? 's' : ''}\n\nUse \`?pack open [code]\` to open a specific pack.`,
      fields,
      color: CONFIG.colors.info,
      footer: { text: `${CONFIG.maxUnopened - list.length} slots remaining` }
    }], 
    messageReference: { messageID: msg.id }
  });
};

/* ========================================
    MAIN ENTRY POINT
======================================== */
module.exports = {
  name: 'pack',
  aliases: ['packs'],
  description: 'Shop, open and manage card packs. >pack / >pack shop / >pack open / >pack available',
  cooldown: 2,
  
  async execute(msg, args, client) {
    if (isRateLimited(msg.author.id)) {
      return msg.channel.createMessage({ 
        content: `Slow down! ${CONFIG.emojis.time}`, 
        messageReference: { messageID: msg.id }
      });
    }
    
    const sub = args[0]?.toLowerCase();
    
    if (!sub || sub === 'shop') return shopFlow(msg, client);
    if (sub === 'open') return openFlow(msg, args[1]);
    if (sub === 'available') return listFlow(msg);
    
    return openFlow(msg, args[0]);
  }
};