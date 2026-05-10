/**
 * Card Spawn Logger
 * Logs all spawned/claimed cards to a dedicated log file
 */
const fs = require('fs');
const path = require('path');

const SPAWN_LOG_PATH = path.join(__dirname, '..', 'logs', 'card_spawns.log');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB max log size before rotation

/**
 * Logs a card spawn event
 * @param {Object} params - Spawn details
 * @param {string} params.userId - Discord user ID
 * @param {string} params.username - Discord username
 * @param {string} params.cardName - Card name
 * @param {string} params.group - Card group
 * @param {string} params.rarity - Card rarity
 * @param {string} params.condition - Card condition
 * @param {string} params.cardCode - Unique card code
 * @param {string} params.command - Command used (drop, daily, claim, etc.)
 * @param {string} params.channelId - Discord channel ID
 * @param {string} params.channelName - Discord channel name
 * @param {string} params.guildId - Discord guild/server ID
 * @param {string} params.guildName - Discord guild/server name
 * @param {number} [params.printNumber] - Card print number
 * @param {boolean} [params.isCosmic] - Whether the card is cosmic
 */
async function logCardSpawn(params) {
  try {
    const {
      userId,
      username,
      cardName,
      group,
      rarity,
      condition,
      cardCode,
      command,
      channelId,
      channelName,
      guildId,
      guildName,
      printNumber,
      isCosmic = false
    } = params;

    const timestamp = new Date().toISOString();
    
    const logEntry = {
      timestamp,
      userId,
      username,
      cardName,
      group,
      rarity,
      condition,
      cardCode,
      printNumber: printNumber || 'N/A',
      command,
      channelId,
      channelName,
      guildId,
      guildName,
      isCosmic
    };

    const logLine = JSON.stringify(logEntry) + '\n';

    // Ensure logs directory exists
    const logsDir = path.dirname(SPAWN_LOG_PATH);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Check if log rotation is needed
    await rotateLogIfNeeded();

    // Append to log file
    fs.appendFileSync(SPAWN_LOG_PATH, logLine);
  } catch (error) {
    console.error('[CARD_SPAWN_LOGGER] Error logging spawn:', error);
  }
}

/**
 * Rotate log file if it exceeds max size
 */
async function rotateLogIfNeeded() {
  try {
    if (!fs.existsSync(SPAWN_LOG_PATH)) return;

    const stats = fs.statSync(SPAWN_LOG_PATH);
    if (stats.size >= MAX_LOG_SIZE) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedPath = SPAWN_LOG_PATH.replace('.log', `_${timestamp}.log`);
      fs.renameSync(SPAWN_LOG_PATH, rotatedPath);
      console.log(`[CARD_SPAWN_LOGGER] Rotated log to ${rotatedPath}`);
    }
  } catch (error) {
    console.error('[CARD_SPAWN_LOGGER] Error rotating log:', error);
  }
}

/**
 * Read recent spawn logs
 * @param {Object} options - Query options
 * @param {number} [options.limit=25] - Max entries to return
 * @param {string} [options.userId] - Filter by user ID
 * @param {string} [options.cardName] - Filter by card name (partial match)
 * @param {string} [options.startDate] - Filter by start date (ISO string)
 * @param {string} [options.endDate] - Filter by end date (ISO string)
 * @returns {Array} - Array of log entries
 */
function readSpawnLogs(options = {}) {
  const { limit = 25, userId, cardName, startDate, endDate } = options;

  try {
    if (!fs.existsSync(SPAWN_LOG_PATH)) {
      return [];
    }

    const content = fs.readFileSync(SPAWN_LOG_PATH, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line);
    
    let entries = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(entry => entry !== null);

    // Apply filters
    if (userId) {
      entries = entries.filter(e => e.userId === userId);
    }

    if (cardName) {
      const searchTerm = cardName.toLowerCase();
      entries = entries.filter(e => 
        e.cardName.toLowerCase().includes(searchTerm) ||
        e.group.toLowerCase().includes(searchTerm)
      );
    }

    if (startDate) {
      const start = new Date(startDate);
      entries = entries.filter(e => new Date(e.timestamp) >= start);
    }

    if (endDate) {
      const end = new Date(endDate);
      entries = entries.filter(e => new Date(e.timestamp) <= end);
    }

    // Return most recent entries (reverse to get newest first)
    return entries.reverse().slice(0, limit);
  } catch (error) {
    console.error('[CARD_SPAWN_LOGGER] Error reading logs:', error);
    return [];
  }
}

/**
 * Get spawn statistics
 * @returns {Object} - Stats object
 */
function getSpawnStats() {
  try {
    if (!fs.existsSync(SPAWN_LOG_PATH)) {
      return { totalSpawns: 0, byRarity: {}, byCommand: {}, cosmicCount: 0 };
    }

    const content = fs.readFileSync(SPAWN_LOG_PATH, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line);
    
    const stats = {
      totalSpawns: 0,
      byRarity: {},
      byCommand: {},
      cosmicCount: 0
    };

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        stats.totalSpawns++;
        
        const rarity = entry.rarity || 'Unknown';
        stats.byRarity[rarity] = (stats.byRarity[rarity] || 0) + 1;
        
        const command = entry.command || 'Unknown';
        stats.byCommand[command] = (stats.byCommand[command] || 0) + 1;
        
        if (entry.isCosmic) stats.cosmicCount++;
      } catch {
        // Skip malformed entries
      }
    }

    return stats;
  } catch (error) {
    console.error('[CARD_SPAWN_LOGGER] Error getting stats:', error);
    return { totalSpawns: 0, byRarity: {}, byCommand: {}, cosmicCount: 0 };
  }
}

module.exports = {
  logCardSpawn,
  readSpawnLogs,
  getSpawnStats,
  SPAWN_LOG_PATH
};
