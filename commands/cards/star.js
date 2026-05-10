const Eris = require("eris");
const Currency = require("../../models/currency");
const Cooldown = require("../../models/cooldown");
const QuestService = require("../../services/QuestService");

/* ========================================
   CONFIGURATION - EASY TO CUSTOMIZE!
======================================== */
const CONFIG = {
  // Timeouts & Durations
  COOLDOWN_DURATION: 15 * 60 * 1000,    // 15 minutes
  INTERACTION_TIMEOUT: 5 * 60 * 1000,   // 5 minutes
  WARNING_TIMEOUT: 4 * 60 * 1000,       // 4 minutes (1 min before timeout)
  REDIS_TTL: 600,                       // 10 minutes cache
  
  // Embed Colors (customize these!)
  COLORS: {
    PRIMARY: 0x48bfe3,      // Light blue
    SUCCESS: 0x57f287,      // Green
    WARNING: 0xfee75c,      // Yellow
    ERROR: 0xed4245,        // Red
    REVEAL: 0x9d4edd,       // Purple for reveal
    TIMEOUT: 0xf4a261       // Orange for timeout
  },
  
  // Emojis (easy to change!)
  EMOJIS: {
    MOON: "<:moon:1269583874464288869>",
    SPARKLES: "<:cosmic:1461015742219550924>",
    SPARKLES_ID: "1461015742219550924",
    UNLOCKED: "<:cosmic:1461015742219550924>",
    
    // Button emojis (these show on the buttons!)
    BUTTONS: {
      BUTTON_1: { id: "1461015742219550924", name: "cosmic" },
      BUTTON_2: { id: "1461015742219550924", name: "cosmic" },
      BUTTON_3: { id: "1461015742219550924", name: "cosmic" }
    }
  },
  
  // Embed Text Templates (customize messages here!)
  MESSAGES: {
    MAIN_TITLE: "🌙 Cosmic",
    MAIN_DESCRIPTION: (author, target, isTimeout) => 
      `${author} decided to grant ${target} a star!\n### ${isTimeout ? '⚠️ **This interaction has timed out.**' : 'Choose one of the buttons to obtain cosmic:'}`,
    MAIN_FOOTER: (isTimeout) => 
      isTimeout ? "Better luck next time!" : "May the cosmos shine upon you!",
    
    REVEAL_TITLE: "✨ Cosmic Values Revealed!",
    REVEAL_DESCRIPTION: (author, target, didntParticipate, isTimeout) => {
      if (isTimeout) {
        return `Time's up! Here's what each cosmic contained:\n${didntParticipate.length > 0 ? `\n*${didntParticipate.join(' and ')} didn't choose in time.*` : ''}`;
      }
      return `${author} and ${target} have both made their choices!\nHere's what each cosmic contained:`;
    },
    REVEAL_FOOTER: (isTimeout) => 
      isTimeout ? "Better luck next time!" : "The mystery has been unveiled!",
/*************  ✨ Windsurf Command ⭐  *************/
/**
 * Generates a reveal field for a cosmic interaction
 * @param {number} index - The index of the cosmic value
 * @param {number} value - The value of the cosmic
 * @param {string[]} pickers - The users who chose the cosmic value
 * @returns {object} - A reveal field object for the interaction
 */
/*******  7754bb53-6fd7-4d3a-97d9-4d3cdabe09d7  *******/
    REVEAL_FIELD: (index, value, pickers) => ({
      name: `${CONFIG.EMOJIS.UNLOCKED} Cosmic ${index + 1}`,
      value: `**${value}** ${CONFIG.EMOJIS.SPARKLES} cosmic${pickers.length > 0 ? `\n*Chosen by: ${pickers.join(', ')}*` : ''}`,
      inline: true
    }),
    
    SUCCESS_TITLE: "✨ Cosmic Abundance Received!",
    SUCCESS_DESCRIPTION: (index, amount) => 
      `You chose **Cosmic ${index + 1}** and received ||**${amount}**|| ${CONFIG.EMOJIS.SPARKLES} cosmic${amount !== 1 ? 's' : ''}!`,
    SUCCESS_FOOTER: (total) => `Total cosmic: ${formatNumber(total)}`,
    
    WARNING_DESCRIPTION: (author, target) =>
      `${author} decided to grant ${target} a star!\nChoose one of the buttons to obtain cosmic:`,
    
    COOLDOWN_TITLE: "⏰ Cooldown Active",
    COOLDOWN_DESCRIPTION: (time, commandName) => 
      `Please wait **${time}** before using the \`${commandName}\` command again.`,
    COOLDOWN_FOOTER: "Patience brings greater cosmic rewards!",
    
    ERROR_TITLE: "❌ Error",
    ERROR_DESCRIPTION: "An error occurred while processing your selection. Please try again later.",
    COMMAND_ERROR_TITLE: "❌ Command Error",
    COMMAND_ERROR_DESCRIPTION: "An unexpected error occurred. Please try again later.",
    COMMAND_ERROR_FOOTER: "If this problem persists, please contact support.",
    
    INVALID_TITLE: "❌ Invalid Command",
    INVALID_USAGE: "**Usage:** `?star @user`\n*Grant a star to someone and both of you can receive cosmic rewards!*",
    INVALID_SELF: "You cannot give a star to yourself!\nTry mentioning someone else! ⭐",
    INVALID_BOT: "Bots don't need cosmic!\nPlease mention a human user instead. 🤖"
  }
};

/* ========================================
   COSMIC PROBABILITIES
======================================== */
const COSMIC_PROBABILITIES = [
  { value: 0, weight: 55 },
  { value: 1, weight: 40 },
  { value: 2, weight: 30 },
  { value: 3, weight: 20 },
  { value: 4, weight: 15 },
  { value: 5, weight: 10 },
  { value: 6, weight: 5 },
  { value: 7, weight: 3 },
  { value: 30, weight: 1 },
  { value: 77, weight: 1 }
];

const TOTAL_WEIGHT = COSMIC_PROBABILITIES.reduce((sum, item) => sum + item.weight, 0);

/* ========================================
   REDIS SETUP
======================================== */
const redis = global.redisClient || {
  get: async () => null,
  setex: async () => {},
  del: async () => {}
};

/* ========================================
   UTILITY FUNCTIONS
======================================== */

// Format numbers with spaces (10 000 instead of 10,000)
function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// Generate random cosmic value
function generateRandomCosmicValue() {
  let randomValue = Math.random() * TOTAL_WEIGHT;

  for (const probability of COSMIC_PROBABILITIES) {
    if (randomValue < probability.weight) {
      return probability.value;
    }
    randomValue -= probability.weight;
  }

  return COSMIC_PROBABILITIES[0].value;
}

// Format cooldown time
function formatCooldownTime(remainingTime) {
  const minutes = Math.floor(remainingTime / 60000);
  const seconds = Math.floor((remainingTime % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

// Cache management
async function cacheCosmicValues(messageId, cosmicValues) {
  const key = `star:${messageId}`;
  await redis.setex(key, CONFIG.REDIS_TTL, JSON.stringify(cosmicValues));
}

async function clearCosmicCache(messageId) {
  await redis.del(`star:${messageId}`);
}

/* ========================================
   EMBED CREATORS
======================================== */

function createStarEmbed(author, targetUser, client, isTimedOut = false) {
  return {
    title: CONFIG.MESSAGES.MAIN_TITLE,
    description: CONFIG.MESSAGES.MAIN_DESCRIPTION(author.mention, targetUser.mention, isTimedOut),
    color: isTimedOut ? CONFIG.COLORS.WARNING : CONFIG.COLORS.PRIMARY,
    footer: {
      text: CONFIG.MESSAGES.MAIN_FOOTER(isTimedOut),
      icon_url: client.user.avatarURL
    },
    timestamp: new Date()
  };
}

function createRevealEmbed(author, targetUser, cosmicValues, selectedButtons, client, isTimeout = false) {
  const authorChoice = selectedButtons.get(author.id);
  const targetChoice = selectedButtons.get(targetUser.id);

  // Build reveal fields
  const revealFields = cosmicValues.map((value, index) => {
    const pickers = [];
    if (authorChoice === index) pickers.push(author.username);
    if (targetChoice === index) pickers.push(targetUser.username);
    
    return CONFIG.MESSAGES.REVEAL_FIELD(index, value, pickers);
  });

  // Build description
  const didntParticipate = [];
  if (isTimeout) {
    if (authorChoice === undefined) didntParticipate.push(author.mention);
    if (targetChoice === undefined) didntParticipate.push(targetUser.mention);
  }

  return {
    title: CONFIG.MESSAGES.REVEAL_TITLE,
    description: CONFIG.MESSAGES.REVEAL_DESCRIPTION(
      author.mention, 
      targetUser.mention, 
      didntParticipate, 
      isTimeout
    ),
    color: isTimeout ? CONFIG.COLORS.TIMEOUT : CONFIG.COLORS.REVEAL,
    fields: revealFields,
    footer: {
      text: CONFIG.MESSAGES.REVEAL_FOOTER(isTimeout),
      icon_url: client.user.avatarURL
    },
    timestamp: new Date()
  };
}

function createSuccessEmbed(chosenIndex, cosmicAmount, totalCosmic, client) {
  return {
    title: CONFIG.MESSAGES.SUCCESS_TITLE,
    description: CONFIG.MESSAGES.SUCCESS_DESCRIPTION(chosenIndex, cosmicAmount),
    color: CONFIG.COLORS.SUCCESS,
    footer: {
      text: CONFIG.MESSAGES.SUCCESS_FOOTER(totalCosmic),
      icon_url: client.user.avatarURL
    },
    timestamp: new Date()
  };
}

/* ========================================
   BUTTON CREATORS
======================================== */

function createCosmicButtons(cosmicValues, disabledIndices = []) {
  const buttonKeys = ['BUTTON_1', 'BUTTON_2', 'BUTTON_3'];
  
  return cosmicValues.map((value, index) => ({
    type: 2,
    style: disabledIndices.includes(index) ? 2 : 1, // Secondary for disabled
    custom_id: `star_${index}`,
    emoji: CONFIG.EMOJIS.BUTTONS[buttonKeys[index]],
    disabled: disabledIndices.includes(index)
  }));
}

/* ========================================
   INTERACTION HANDLER
======================================== */

async function handleCosmicInteraction(interaction, context) {
  const { authorId, targetUserId, cosmicValues, starReceivers, initialMessage, client, cleanup } = context;

  // Validate interaction
  if (interaction.message.id !== initialMessage.id || 
      ![authorId, targetUserId].includes(interaction.member.id) ||
      starReceivers.has(interaction.member.id)) {
    return;
  }

  try {
    // Show loading state (ephemeral)
    await interaction.defer(64);

    const chosenIndex = parseInt(interaction.data.custom_id.split('_')[1]);
    const cosmicAmount = cosmicValues[chosenIndex];

    // Update user currency
    const updatedUser = await Currency.findOneAndUpdate(
      { userId: interaction.member.id },
      { $inc: { selca: cosmicAmount } },
      { new: true, upsert: true }
    );

    // Track user selection
    starReceivers.set(interaction.member.id, chosenIndex);

    // Send ephemeral success message
    await interaction.createFollowup({
      embeds: [createSuccessEmbed(chosenIndex, cosmicAmount, updatedUser.selca, client)],
      flags: 64
    });

    // Get disabled button indices
    const disabledIndices = Array.from(starReceivers.values());

    // Check if both users have participated
    if (starReceivers.size === 2) {
      // THE REVEAL MOMENT
      const authorUser = await client.users.get(authorId);
      const targetUser = await client.users.get(targetUserId);

      await initialMessage.edit({
        embeds: [createRevealEmbed(
          { id: authorId, mention: `<@${authorId}>`, username: authorUser.username },
          { id: targetUserId, mention: `<@${targetUserId}>`, username: targetUser.username },
          cosmicValues,
          starReceivers,
          client,
          false
        )],
        components: []
      });

      // Clear cache and cleanup
      await clearCosmicCache(initialMessage.id);
      cleanup();
    } else {
      // Update message with selected buttons disabled
      await initialMessage.edit({
        embeds: [createStarEmbed({ mention: `<@${authorId}>` }, { mention: `<@${targetUserId}>` }, client)],
        components: [{
          type: 1,
          components: createCosmicButtons(cosmicValues, disabledIndices)
        }]
      });
    }

  } catch (error) {
    console.error("[COSMIC_INTERACTION_ERR]", error);

    try {
      await interaction.createFollowup({
        embeds: [{
          title: CONFIG.MESSAGES.ERROR_TITLE,
          description: CONFIG.MESSAGES.ERROR_DESCRIPTION,
          color: CONFIG.COLORS.ERROR
        }],
        flags: 64
      });
    } catch (followupError) {
      console.error("[ERROR_FOLLOWUP_ERR]", followupError);
    }
  }
}

/* ========================================
   VALIDATION & COOLDOWN
======================================== */

function validateCommand(message, args) {
  if (!args.length || !message.mentions[0]) {
    return {
      error: "missing_mention",
      content: CONFIG.MESSAGES.INVALID_USAGE
    };
  }

  if (message.mentions[0].id === message.author.id) {
    return {
      error: "self_mention",
      content: CONFIG.MESSAGES.INVALID_SELF
    };
  }

  if (message.mentions[0].bot) {
    return {
      error: "bot_mention",
      content: CONFIG.MESSAGES.INVALID_BOT
    };
  }

  return null;
}

async function checkAndUpdateCooldown(userId, commandName) {
  const now = Date.now();

  const existingCooldown = await Cooldown.findOne({ 
    user: userId, 
    command: commandName 
  });

  if (existingCooldown?.cooldownEnd > now) {
    const remainingTime = existingCooldown.cooldownEnd - now;
    return {
      remaining: remainingTime,
      formatted: formatCooldownTime(remainingTime)
    };
  }

  await Cooldown.findOneAndUpdate(
    { user: userId, command: commandName },
    { cooldownEnd: now + CONFIG.COOLDOWN_DURATION },
    { upsert: true }
  );

  return null;
}

/* ========================================
   MAIN COMMAND
======================================== */

module.exports = {
  name: "star",
  description: "Give a star to a user and receive cosmic rewards",
  category: "fun",
  cooldown: CONFIG.COOLDOWN_DURATION / 1000,
  usage: "star @user",

  async execute(message, args, client) {
    try {
      // Validate command input
      const validation = validateCommand(message, args);
      if (validation) {
        return message.channel.createMessage({
          embeds: [{
            title: CONFIG.MESSAGES.INVALID_TITLE,
            description: validation.content,
            color: CONFIG.COLORS.ERROR
          }],
          messageReference: { messageID: message.id }
        });
      }

      const authorId = message.author.id;
      const targetUser = message.mentions[0];

      // Check cooldown
      const cooldownInfo = await checkAndUpdateCooldown(authorId, this.name);
      if (cooldownInfo) {
        return message.channel.createMessage({
          embeds: [{
            title: CONFIG.MESSAGES.COOLDOWN_TITLE,
            description: CONFIG.MESSAGES.COOLDOWN_DESCRIPTION(cooldownInfo.formatted, this.name),
            color: CONFIG.COLORS.WARNING,
            footer: {
              text: CONFIG.MESSAGES.COOLDOWN_FOOTER,
              icon_url: client.user.avatarURL
            }
          }],
          messageReference: { messageID: message.id }
        });
      }

      // Generate cosmic values
      const cosmicValues = Array(3).fill().map(() => generateRandomCosmicValue());
      const starReceivers = new Map();
      let timeoutHandle;
      let warningHandle;

      // Create context
      const context = {
        authorId,
        targetUserId: targetUser.id,
        cosmicValues,
        starReceivers,
        initialMessage: null,
        client,
        cleanup: () => {
          client.removeListener("interactionCreate", interactionHandler);
          clearTimeout(timeoutHandle);
          clearTimeout(warningHandle);
        }
      };

      // Create and send initial message
      const initialMessage = await message.channel.createMessage({
        embeds: [createStarEmbed(message.author, targetUser, client)],
        components: [{
          type: 1,
          components: createCosmicButtons(cosmicValues)
        }],
        messageReference: { messageID: message.id }
      });

      context.initialMessage = initialMessage;

      // Update quest progress for star command (author is the one giving the star)
      QuestService.updateQuestProgress(authorId, ['star'], 1).catch(err =>
        console.error('[STAR_QUEST_UPDATE_ERROR]', err)
      );

      // Cache cosmic values
      await cacheCosmicValues(initialMessage.id, cosmicValues);

      // Set up interaction handler
      const interactionHandler = (interaction) => {
        if (interaction.type === 3) {
          handleCosmicInteraction(interaction, context);
        }
      };

      client.on("interactionCreate", interactionHandler);

      // Set warning timeout (1 minute before expiry)
      warningHandle = setTimeout(async () => {
        if (starReceivers.size < 2) {
          try {
            const disabledIndices = Array.from(starReceivers.values());
            await initialMessage.edit({
              embeds: [{
                title: CONFIG.MESSAGES.MAIN_TITLE,
                description: CONFIG.MESSAGES.WARNING_DESCRIPTION(message.author.mention, targetUser.mention),
                color: CONFIG.COLORS.PRIMARY,
                footer: {
                  text: CONFIG.MESSAGES.MAIN_FOOTER(false),
                  icon_url: client.user.avatarURL
                },
                timestamp: new Date()
              }],
              components: [{
                type: 1,
                components: createCosmicButtons(cosmicValues, disabledIndices)
              }]
            });
          } catch (error) {
            console.error("[WARNING_TIMEOUT_ERR]", error);
          }
        }
      }, CONFIG.WARNING_TIMEOUT);

      // Set main timeout
      timeoutHandle = setTimeout(async () => {
        try {
          if (starReceivers.size < 2) {
            const authorUser = await client.users.get(authorId);
            const targetUserFull = await client.users.get(targetUser.id);

            await initialMessage.edit({
              embeds: [createRevealEmbed(
                { id: authorId, mention: `<@${authorId}>`, username: authorUser.username },
                { id: targetUser.id, mention: `<@${targetUser.id}>`, username: targetUserFull.username },
                cosmicValues,
                starReceivers,
                client,
                true
              )],
              components: []
            });
          }
        } catch (error) {
          console.error("[MAIN_TIMEOUT_ERR]", error);
        } finally {
          await clearCosmicCache(initialMessage.id);
          context.cleanup();
        }
      }, CONFIG.INTERACTION_TIMEOUT);

    } catch (error) {
      console.error(`[STAR_COMMAND_ERR]`, error);

      try {
        await message.channel.createMessage({
          embeds: [{
            title: CONFIG.MESSAGES.COMMAND_ERROR_TITLE,
            description: CONFIG.MESSAGES.COMMAND_ERROR_DESCRIPTION,
            color: CONFIG.COLORS.ERROR,
            footer: {
              text: CONFIG.MESSAGES.COMMAND_ERROR_FOOTER,
              icon_url: client.user.avatarURL
            }
          }],
          messageReference: { messageID: message.id }
        });
      } catch (replyError) {
        console.error("[ERROR_REPLY_ERR]", replyError);
      }
    }
  }
};