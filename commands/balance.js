/* ================================================================
   BALANCE COMMAND - Display user currency and balances
   Usage: >balance / >bal / >bal @user
   Features: Real-time refresh, Redis caching, clean UI, check other users
   ================================================================ */

   const Currency = require('../models/currency');
   
   /* --------------- CONFIG --------------- */
   const CONFIG = {
     buttonTimeout: 120_000,  // 2 min
     cacheTimeout: 30_000,    // 30s cache TTL
     emojis: {
       wallet: '<:wallet:1269274208144199803>',
       refresh: '1269285228921225236',
       sparkle: '✨'
     },
     colors: {
       primary: 0xcaf0f8
     }
   };
   
   /* --------------- CURRENCY DISPLAY CONFIG --------------- */
   const CURRENCY_CONFIG = {
     crystals: { 
       emoji: 'rose:1461015415466496191',
       displayName: 'ROSE Crystals'
     },
     stardust: { 
       emoji: 'stardust:1449661267915571274' 
     },
     astralEssence: { 
       emoji: 'astralessence:1461015891138318598' 
     },
     selca: { 
       emoji: 'cosmic:1461015742219550924', 
       displayName: 'Cosmic' 
     },
     candyCanes: { 
       emoji: 'candycane:1320755924620808255', 
       displayName: 'Candy Canes' 
     }
   };
   
   /* --------------- REDIS SETUP --------------- */
   const redis = global.redisClient || {
     get: async () => null,
     setex: async () => {},
     del: async () => {}
   };
   
   /* --------------- HELPERS --------------- */
   const formatNumber = num => num.toLocaleString();
   
   const getCachedCurrency = async (userId) => {
     const key = `balance:${userId}`;
     const cached = await redis.get(key);
     if (cached) return JSON.parse(cached);
     
     const currency = await Currency.findOne({ userId }).lean() || 
       await Currency.create({ 
         userId, 
         crystals: 0, 
         fantasiaTokens: 0, 
         stardust: 0, 
         astralEssence: 0, 
         reverieGem: 0, 
         selca: 0,
         candyCanes: 0
       });
     
     await redis.setex(key, Math.floor(CONFIG.cacheTimeout / 1000), JSON.stringify(currency));
     return currency;
   };
   
   const invalidateCache = async (userId) => {
     await redis.del(`balance:${userId}`);
   };
   
   /* --------------- EMBED BUILDER --------------- */
   const buildBalanceEmbed = (username, currency) => {
     const fields = Object.entries(CURRENCY_CONFIG).map(([key, config]) => ({
       name: config.displayName || 
             key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1'),
       value: `<:${config.emoji}> ${formatNumber(currency[key] || 0)}`,
       inline: true
     }));
   
     // Add padding for 3-column grid alignment
     while (fields.length % 3 !== 0) {
       fields.push({ name: '\u200b', value: '\u200b', inline: true });
     }
   
     return {
       title: `${CONFIG.emojis.wallet} ${username}'s Balance`,
       color: CONFIG.colors.primary,
       fields,
       footer: {
         text: `${CONFIG.emojis.sparkle} Collect and spend wisely on your journey!`
       }
     };
   };
   
   /* --------------- MAIN COMMAND --------------- */
   module.exports = {
     name: 'balance',
     description: 'Displays your balance or another user\'s balance',
     aliases: ['bal'],
     
     async execute(msg, args, client) {
       const { author, id: messageId } = msg;
       
       // Check if a user was mentioned or provided
       let targetUser = author;
       let targetUserId = author.id;
       
       if (args.length > 0) {
         // Try to parse mention (format: <@!123456789> or <@123456789>)
         const mentionMatch = args[0].match(/^<@!?(\d+)>$/);
         
         if (mentionMatch) {
           targetUserId = mentionMatch[1];
           try {
             // Fetch the mentioned user from Discord
             targetUser = await client.getRESTUser(targetUserId);
           } catch (err) {
             return msg.channel.createMessage({
               embeds: [{
                 title: '❌ User Not Found',
                 description: 'Could not find that user. Make sure you\'re mentioning a valid Discord user.',
                 color: 0xED4245
               }],
               messageReference: { messageID: messageId }
             });
           }
         } else if (args[0].match(/^\d+$/)) {
           // Direct user ID provided
           targetUserId = args[0];
           try {
             targetUser = await client.getRESTUser(targetUserId);
           } catch (err) {
             return msg.channel.createMessage({
               embeds: [{
                 title: '❌ User Not Found',
                 description: 'Could not find that user. Make sure you\'re providing a valid user ID.',
                 color: 0xED4245
               }],
               messageReference: { messageID: messageId }
             });
           }
         }
       }
   
       /* ----- Generate Initial Embed ----- */
       const currency = await getCachedCurrency(targetUserId);
       const initialEmbed = buildBalanceEmbed(targetUser.username, currency);
       
       // Only show refresh button if checking own balance
       const showRefreshButton = targetUserId === author.id;
   
       const refreshButton = {
         type: 1,
         components: [{
           type: 2,
           style: 2,
           custom_id: 'refresh_balance',
           emoji: { id: CONFIG.emojis.refresh, name: 'refresh' }
         }]
       };
   
       const balanceMessage = await msg.channel.createMessage({
         embeds: [initialEmbed],
         components: showRefreshButton ? [refreshButton] : [],
         messageReference: { messageID: messageId }
       });
       
       // Only setup interaction handler if showing refresh button
       if (showRefreshButton) {
         /* ----- Interaction Handler ----- */
         const handleInteraction = async (interaction) => {
           if (
             interaction.message.id !== balanceMessage.id || 
             interaction.member.id !== author.id ||
             interaction.data.custom_id !== 'refresh_balance'
           ) return;
   
           try {
             // Invalidate cache and fetch fresh data
             await invalidateCache(targetUserId);
             const freshCurrency = await getCachedCurrency(targetUserId);
             const updatedEmbed = buildBalanceEmbed(targetUser.username, freshCurrency);
   
             await interaction.editParent({
               embeds: [updatedEmbed],
               components: [refreshButton]
             });
           } catch (err) {
             console.error('[BALANCE_REFRESH_ERR]', err);
           }
         };
   
         client.on('interactionCreate', handleInteraction);
   
         /* ----- Cleanup After Timeout ----- */
         setTimeout(() => {
           client.off('interactionCreate', handleInteraction);
           balanceMessage.edit({ 
             embeds: [initialEmbed], 
             components: [] 
           }).catch(() => {});
         }, CONFIG.buttonTimeout);
       }
     }
   };