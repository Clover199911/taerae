/**
 * Centralized configuration constants
 * Move hardcoded values here for easier maintenance
 */

// Admin user IDs - can override with ADMIN_IDS env var (comma-separated)
const ADMIN_IDS = process.env.ADMIN_IDS 
  ? process.env.ADMIN_IDS.split(',').map(id => id.trim())
  : ["1113226226300104808", "748920911498838129", "1109364775604977756", "493289044319666176"];

// Guild/Server IDs
const GUILD_IDS = {
  MAIN: process.env.MAIN_GUILD_ID || "1117452284784300095",
  SECONDARY: process.env.SECONDARY_GUILD_ID || "1233812943108444291"
};

const ALLOWED_GUILDS = new Set([GUILD_IDS.MAIN, GUILD_IDS.SECONDARY]);

// Channel IDs
const CHANNEL_IDS = {
  VOUCHER_EXPIRATION: process.env.VOUCHER_CHANNEL_ID || "1264128062681780234",
  MARKETPLACE_NOTIFICATIONS: process.env.MARKETPLACE_CHANNEL_ID || "1264128083364151359"
};

// Bot IDs
const BOT_USER_ID = process.env.BOT_USER_ID || "1117452463407104042";

// Custom emoji IDs for embeds
const EMOJI_IDS = {
  CARDS: "1461015416869777450",
  COSMIC: "1461015742219550924",
  CHECK: "1461015775266603110",
  CROSS: "1461015696954753034",
  ROSE: "1461015415466496191",
  STARDUST: "1449661267915571274",
  ASTRA_ESSENCE: "1461015891138318598",
  REROLL: "1462273933997904079",
  CHECKMARK_ALT: "1269279366999703552",
  CROSS_ALT: "1269279369256239245",
  REFRESH: "1269285228921225236",
  FLEFT: "1255876906058776668",
  LEFT: "1255876721752936521",
  RIGHT: "1255876719626289223",
  FRIGHT: "1255876908378357771"
};

// Helper function to format emoji for Discord
const formatEmoji = (emojiId, emojiName = 'emoji') => `<:${emojiName}:${emojiId}>`;

// Webhook URLs (should be in .env for security)
const WEBHOOKS = {
  MARKETPLACE: process.env.MARKETPLACE_WEBHOOK_URL || null
};

// Helper to check if user is admin
const isAdmin = (userId) => ADMIN_IDS.includes(userId);

// Helper to check if guild is allowed
const isAllowedGuild = (guildId) => ALLOWED_GUILDS.has(guildId);

module.exports = {
  ADMIN_IDS,
  GUILD_IDS,
  ALLOWED_GUILDS,
  CHANNEL_IDS,
  BOT_USER_ID,
  EMOJI_IDS,
  WEBHOOKS,
  formatEmoji,
  isAdmin,
  isAllowedGuild
};
