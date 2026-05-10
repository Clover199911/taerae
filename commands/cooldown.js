/* ================================================================
   COOLDOWN COMMAND - Display command cooldown statuses
   Usage: >cooldown / >cd
   Features: Real-time updates, Redis caching, clean UI
   ================================================================ */

   const Cooldown = require('../models/cooldown');
   
   /* --------------- CONFIG --------------- */
   const CONFIG = {
     commands: ['drop', 'fortune', 'travel', 'star', 'battle'],
     cacheTimeout: 15_000,  // 15s cache TTL
     emojis: {
       checkmark: '<:check:1461015775266603110>',
       wrong: '<:cross:1461015696954753034>',
       cooldown: '<:cooldown:1269551887246692364>',
       sparkle: '✨'
     },
     colors: {
       primary: 0xcaf0f8
     },
     messages: {
       footer: "Use available abilities to progress in your journey!"
     }
   };
   
   /* --------------- REDIS SETUP --------------- */
   const redis = global.redisClient || {
     get: async () => null,
     setex: async () => {},
     del: async () => {}
   };
   
   /* --------------- HELPERS --------------- */
   const formatTime = (ms) => {
     const seconds = Math.floor(ms / 1000);
     return {
       hours: Math.floor(seconds / 3600),
       minutes: Math.floor((seconds % 3600) / 60),
       seconds: seconds % 60
     };
   };
   
   const getCooldownStatus = (cooldown) => {
     if (!cooldown || cooldown.cooldownEnd <= Date.now()) {
       return `${CONFIG.emojis.checkmark} Available!`;
     }
   
     const { hours, minutes, seconds } = formatTime(cooldown.cooldownEnd - Date.now());
     return `${CONFIG.emojis.wrong} ${hours}h ${minutes}m ${seconds}s`;
   };
   
   /* --------------- CACHE FUNCTIONS --------------- */
   const getCachedCooldowns = async (userId) => {
     const key = `cooldowns:${userId}`;
     const cached = await redis.get(key);
     if (cached) return JSON.parse(cached);
   
     const cooldowns = await Cooldown.find({ 
       user: userId, 
       command: { $in: CONFIG.commands } 
     }).lean();
   
     const cooldownMap = new Map(cooldowns.map(cd => [cd.command, cd]));
     const data = Object.fromEntries(cooldownMap);
     
     await redis.setex(key, Math.floor(CONFIG.cacheTimeout / 1000), JSON.stringify(data));
     return data;
   };
   
   const invalidateCache = async (userId) => {
     await redis.del(`cooldowns:${userId}`);
   };
   
   /* --------------- EMBED BUILDER --------------- */
   const buildCooldownEmbed = (username, cooldownData) => {
     const fields = CONFIG.commands.map(command => ({
       name: `${command[0].toUpperCase()}${command.slice(1)}`,
       value: getCooldownStatus(cooldownData[command]),
       inline: true
     }));
   
     // Add padding for 3-column grid alignment
     const paddingNeeded = (3 - (fields.length % 3)) % 3;
     if (paddingNeeded > 0) {
       fields.push(...Array(paddingNeeded).fill({ 
         name: '\u200b', 
         value: '\u200b', 
         inline: true 
       }));
     }
   
     return {
       title: `${CONFIG.emojis.cooldown} ${username}'s Cooldowns`,
       color: CONFIG.colors.primary,
       fields,
       footer: { 
         text: `${CONFIG.emojis.sparkle} ${CONFIG.messages.footer}` 
       }
     };
   };
   
   /* --------------- MAIN COMMAND --------------- */
   module.exports = {
     name: 'cooldown',
     description: 'Displays your remaining cooldown time',
     aliases: ['cd'],
   
     async execute(msg) {
       const { author, id: messageId } = msg;
       const { username, id: userId } = author;
   

       /* ----- Fetch Cooldowns ----- */
       const cooldownData = await getCachedCooldowns(userId);
       const embed = buildCooldownEmbed(username, cooldownData);
   
       /* ----- Send Response ----- */
       return msg.channel.createMessage({
         embed,
         messageReference: { messageID: messageId }
       });
     }
   };