// commands/battle/battleHandler.js - Core battle logic & UI (SPAM PROTECTION + CLEANUP)
// ============================================================================

const User = require('../../models/user');
const Currency = require('../../models/currency');
const Cooldown = require('../../models/cooldown');
const CardGenerationService = require('../../services/CardGenerationService');
const { determineBattleWinner, formatBattleResult } = require('./battleCalculator');
const { createVSImage, createRerollComparisonImage } = require('./battleImage');
const { EMOJI, BATTLE_CONFIG, CARD_DIMENSIONS } = require('../../config/battle');
const { RARITY_EMOJIS, CONDITION_EMOJIS } = require('../../config/embedConstants');

// State management
const activeBattles = new Map();
const battleCollectors = new Map();
const buttonCooldowns = new Map(); // Button spam protection

// Button cooldown check (like enhance.js)
const BUTTON_COOLDOWN = 1750; // 1.75 seconds

const isOnCooldown = (userId) => {
  const lastUsed = buttonCooldowns.get(userId);
  return lastUsed && Date.now() - lastUsed < BUTTON_COOLDOWN;
};

const setButtonCooldown = (userId) => {
  buttonCooldowns.set(userId, Date.now());
};

// Cleanup button cooldowns periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of buttonCooldowns.entries()) {
    if (now - timestamp >= BUTTON_COOLDOWN) {
      buttonCooldowns.delete(key);
    }
  }
}, 5000);

/**
 * Initialize battle session
 */
async function initializeBattle(msg, userCardCodes, client) {
  const userId = msg.author.id;

  try {
    // Check if there's an existing active battle
    const existingBattle = activeBattles.get(userId);
    if (existingBattle) {
      return {
        success: false,
        message: `${EMOJI.warning} You already have an active battle! Use \`?battle\` to resume it.`,
        hasActiveBattle: true
      };
    }

    // Validate user cards
    const userCards = await User.find({
      cardCode: { $in: userCardCodes },
      discordId: userId
    }).lean();

    if (userCards.length !== BATTLE_CONFIG.requiredCards) {
      return {
        success: false,
        message: `${EMOJI.fail} You must own all 5 cards. Found ${userCards.length}/5.`
      };
    }

    // Generate user card images for collage
    const userCardImages = await Promise.all(userCards.map(async (card) => {
      const overlayPromise = card.condition && card.condition.toLowerCase() !== 'good'
        ? CardGenerationService.preloadOverlay(card.group, card.rarity, card.condition, card.cardId)
        : Promise.resolve(null);
      
      return CardGenerationService.processCardImage(
        { imageURL: card.imageURL, group: card.group, rarity: card.rarity },
        card.condition,
        overlayPromise
      );
    }));

    // Create combined image of user cards
    const combinedUserImage = await CardGenerationService.createCombinedImage(
      userCardImages,
      {
        width: CARD_DIMENSIONS.width,
        height: CARD_DIMENSIONS.height,
        columns: 5,
        padding: CARD_DIMENSIONS.padding
      }
    );

    // Generate bot's 5 cards (with conditions)
    const botRarities = Array.from({ length: 5 }, () => selectWeightedRarity());
    const botCards = await CardGenerationService.generateCards(
      '1117452463407104042', // Bot user ID
      5,
      { rarities: botRarities, skipCardCode: true }
    );

    if (!botCards || botCards.length !== 5) {
      throw new Error('Failed to generate bot cards');
    }

    // Store bot image buffers for later reveal
    const botImageBuffers = botCards.map(c => c.imageBuffer);

    // Initialize battle state
    const battleState = {
      userId,
      userCards: userCards.map((c, i) => ({
        ...c,
        locked: false,
        imageBuffer: userCardImages[i] // Store user card images
      })),
      botCards: botCards.map(c => c.cardData),
      botCardBuffers: botImageBuffers,
      userCardBuffers: userCardImages, // Store for resuming
      combinedUserImage, // Cache the combined user image
      combinedBotImage: null, // Cache bot image (generated on phase 2)
      rerollCount: 0,
      battlesWon: 0,
      battlesLost: 0,
      wonCards: [], // Track won cards with their data
      pendingReroll: false, // Prevent reroll spam
      phase: 'select_user_card' // Two-phase: 'select_user_card' -> 'select_bot_card'
    };

    activeBattles.set(userId, battleState);

    // PHASE 1: Show user cards collage + bot cards as TEXT ONLY
    const battleMessage = await msg.channel.createMessage({
      embeds: createPhaseEmbeds(battleState, msg.author),
      components: createBattleComponents(battleState),
      messageReference: { messageID: msg.id }
    }, { file: combinedUserImage, name: 'your_cards.png' });

    // Setup collector
    await setupBattleCollector(battleMessage, battleState, client, msg);

    return { success: true };

  } catch (error) {
    console.error('Battle initialization error:', error);
    activeBattles.delete(userId);
    throw error;
  }
}

/**
 * Select weighted rarity (same as drop.js)
 */
function selectWeightedRarity() {
  const rarities = [
    { name: 'Standard', chance: 60 },
    { name: 'Unique', chance: 25 },
    { name: 'Glyph', chance: 10 },
    { name: 'Mythic', chance: 5 }
  ];

  const random = Math.random() * 100;
  let cumulative = 0;

  for (const rarity of rarities) {
    cumulative += rarity.chance;
    if (random < cumulative) return rarity.name;
  }

  return 'Standard';
}

/**
 * Create phase-based embeds (two-phase card selection)
 * Phase 1: User cards collage + bot cards as text
 * Phase 2: Bot cards collage revealed
 */
function createPhaseEmbeds(state, author) {
  const availableUserCards = state.userCards.filter(c => !c.locked).length;
  const availableBotCards = state.botCards.filter(c => !c.defeated).length;

  // Create user cards list with numbers
  const userCardsList = state.userCards.map((card, index) => {
    const rarityEmoji = RARITY_EMOJIS[card.rarity.toLowerCase()] || card.rarity;
    const conditionEmoji = CONDITION_EMOJIS[card.condition.toLowerCase()] || card.condition;
    const status = card.locked ? '🔒 ' : '';
    
    return `${status}**${index + 1}.** ${rarityEmoji} ${conditionEmoji} ${card.group} ${card.name}`;
  }).join('\n');

  // Create bot cards list (text only in phase 1)
  const botCardsList = state.botCards.map((card, index) => {
    const rarityEmoji = RARITY_EMOJIS[card.rarity.toLowerCase()] || card.rarity;
    const conditionEmoji = CONDITION_EMOJIS[card.condition.toLowerCase()] || card.condition;
    const status = card.defeated ? '~~' : '';
    
    return `${status}**${index + 1}.** ${rarityEmoji} ${conditionEmoji} ${card.group} ${card.name}${status}`;
  }).join('\n');

  if (state.phase === 'select_user_card') {
    // PHASE 1: Bot cards shown as text first, user picks their card
    return [{
      author: {
        name: `${EMOJI.battle} Battle Arena`,
        icon_url: author.avatarURL
      },
      color: 0xED4245, // Red for bot/enemy
      description: `
🤖 **Bot's Challengers Await!**

**Opponents:** ${availableBotCards} cards ready to battle
${botCardsList}

_Their images will be revealed once you pick your fighter!_
      `.trim()
    }, {
      color: 0x57F287, // Green for user/ally
      description: `
${EMOJI.select} **Choose Your Champion!**

**Your Team:** ${availableUserCards}/${BATTLE_CONFIG.requiredCards} available
${userCardsList}
      `.trim(),
      image: { url: 'attachment://your_cards.png' },
      footer: { text: `🏆 ${state.battlesWon} wins • 💔 ${state.battlesLost} losses • 🔄 ${state.rerollCount}/${BATTLE_CONFIG.maxRerolls} rerolls` }
    }];
  } else {
    // PHASE 2: Bot cards revealed - user picks target
    return [{
      author: {
        name: `${EMOJI.battle} Battle Arena`,
        icon_url: author.avatarURL
      },
      color: 0xED4245, // Red for bot/enemy
      description: `
⚔️ **Pick Your Target!**

**Your Fighter:** ${state.selectedUserCard ? `${RARITY_EMOJIS[state.selectedUserCard.rarity.toLowerCase()] || ''} ${CONDITION_EMOJIS[state.selectedUserCard.condition.toLowerCase()] || ''} ${state.selectedUserCard.group} ${state.selectedUserCard.name}` : 'None selected'}

**Bot's Cards:** ${availableBotCards} remaining
${botCardsList}
      `.trim(),
      image: { url: 'attachment://bot_cards.png' },
      footer: { text: `🏆 ${state.battlesWon} wins • 💔 ${state.battlesLost} losses • 🔄 ${state.rerollCount}/${BATTLE_CONFIG.maxRerolls} rerolls (${EMOJI.crystals} ${BATTLE_CONFIG.rerollCost} each)` }
    }];
  }
}

/**
 * Create battle UI components
 */
function createBattleComponents(state) {
  const components = [];

  // User card selection dropdown - ONLY in phase 1 (before card is selected)
  if (state.phase === 'select_user_card') {
    const availableUserCards = state.userCards.filter(c => !c.locked);
    if (availableUserCards.length > 0) {
      components.push({
        type: 1,
        components: [{
          type: 3,
          custom_id: 'select_user_card',
          placeholder: 'Choose your card to battle with...',
          options: availableUserCards.map((card) => {
            const rarityEmoji = RARITY_EMOJIS[card.rarity.toLowerCase()] || card.rarity;
            const conditionEmoji = CONDITION_EMOJIS[card.condition.toLowerCase()] || card.condition;
            
            return {
              label: `${card.name}`.substring(0, 100),
              description: `${rarityEmoji} | ${card.group} | ${conditionEmoji}`.substring(0, 100),
              value: card.cardCode
            };
          })
        }]
      });
    }
  }

  // Bot card selection buttons (only show in phase 2)
  if (state.phase === 'select_bot_card' && state.selectedUserCard) {
    const botButtons = state.botCards
      .map((card, index) => ({
        type: 2,
        style: card.defeated ? 4 : 1,
        custom_id: `battle_bot_${index}`,
        label: `${index + 1}`,
        emoji: { id: '1461015816869777450', name: 'cards' },
        disabled: card.defeated
      }));

    components.push({
      type: 1,
      components: botButtons
    });
  }

  // Reroll buttons (only in phase 2 and has rerolls left)
  if (state.phase === 'select_bot_card' && state.selectedUserCard && state.rerollCount < BATTLE_CONFIG.maxRerolls) {
    const rerollButtons = state.botCards
      .slice(0, 5)
      .map((card, index) => ({
        type: 2,
        style: 2,
        custom_id: `reroll_bot_${index}`,
        label: `${index + 1}`,
        emoji: { id: '1462273933997904079', name: 'reroll' },
        disabled: card.defeated
      }));

    components.push({
      type: 1,
      components: rerollButtons
    });
  }

  return components;
}

/**
 * Resume existing battle session
 */
async function resumeBattle(msg, client) {
  const userId = msg.author.id;
  const existingBattle = activeBattles.get(userId);

  if (!existingBattle) {
    return {
      success: false,
      message: `${EMOJI.fail} No active battle found. Start a new one with \`?battle <5 card codes>\``
    };
  }

  try {
    let imageBuffer, imageName;
    
    // Use cached images when available
    if (existingBattle.phase === 'select_user_card') {
      // Phase 1: Show user cards (use cache)
      imageBuffer = existingBattle.combinedUserImage || await CardGenerationService.createCombinedImage(
        existingBattle.userCardBuffers,
        {
          width: CARD_DIMENSIONS.width,
          height: CARD_DIMENSIONS.height,
          columns: 5,
          padding: CARD_DIMENSIONS.padding
        }
      );
      imageName = 'your_cards.png';
    } else {
      // Phase 2: Show bot cards (use cache)
      imageBuffer = existingBattle.combinedBotImage || await CardGenerationService.createCombinedImage(
        existingBattle.botCardBuffers,
        {
          width: CARD_DIMENSIONS.width,
          height: CARD_DIMENSIONS.height,
          columns: 5,
          padding: CARD_DIMENSIONS.padding
        }
      );
      imageName = 'bot_cards.png';
    }

    // Send battle interface again with messageReference
    const battleMessage = await msg.channel.createMessage({
      embeds: createPhaseEmbeds(existingBattle, msg.author),
      components: createBattleComponents(existingBattle),
      messageReference: { messageID: msg.id }
    }, { file: imageBuffer, name: imageName });

    // Clear old collector if exists
    const oldCollector = battleCollectors.get(userId);
    if (oldCollector) {
      client.removeListener('interactionCreate', oldCollector.handler);
      clearTimeout(oldCollector.timeout);
    }

    // Setup new collector
    await setupBattleCollector(battleMessage, existingBattle, client, msg);

    return { success: true };

  } catch (error) {
    console.error('Battle resume error:', error);
    throw error;
  }
}

async function setupBattleCollector(message, state, client, originalMsg) {
  const userId = state.userId;

  const timeoutId = setTimeout(() => {
    cleanup();
  }, BATTLE_CONFIG.selectionTimeout);

  const collector = async (interaction) => {
    // Allow reroll confirm/cancel from ephemeral messages (different message ID)
    const customId = interaction.data?.custom_id || '';
    const isRerollConfirmation = customId.startsWith('reroll_confirm_') || customId === 'reroll_cancel';
    
    // For reroll confirmations, only check user ID; for other interactions, also check message ID
    if (!isRerollConfirmation && interaction.message.id !== message.id) return;
    if (interaction.member.id !== userId) return;

    // Button spam protection (like enhance.js)
    if (isOnCooldown(userId)) {
      await interaction.createMessage({
        content: `${EMOJI.warning} Please wait before clicking again!`,
        flags: 64
      }).catch(() => {});
      return;
    }

    try {
      await interaction.acknowledge();
      setButtonCooldown(userId);

      // Handle user card selection
      if (customId === 'select_user_card') {
        const selectedCode = interaction.data.values[0];
        const selectedCard = state.userCards.find(c => c.cardCode === selectedCode);
        
        state.selectedUserCard = selectedCard;
        state.phase = 'select_bot_card'; // Move to phase 2

        // Generate and cache bot cards collage for reveal
        const combinedBotImage = state.combinedBotImage || await CardGenerationService.createCombinedImage(
          state.botCardBuffers,
          {
            width: CARD_DIMENSIONS.width,
            height: CARD_DIMENSIONS.height,
            columns: 5,
            padding: CARD_DIMENSIONS.padding
          }
        );
        state.combinedBotImage = combinedBotImage; // Cache for later

        // Delete old message and create new one (Eris attachment limitation)
        await message.delete().catch(() => {});
        
        const newBattleMessage = await originalMsg.channel.createMessage({
          embeds: createPhaseEmbeds(state, originalMsg.author),
          components: createBattleComponents(state),
          messageReference: { messageID: originalMsg.id }
        }, { file: combinedBotImage, name: 'bot_cards.png' });

        // Update collector to watch new message
        const collector = battleCollectors.get(state.userId);
        if (collector) {
          client.removeListener('interactionCreate', collector.handler);
          clearTimeout(collector.timeout);
        }
        await setupBattleCollector(newBattleMessage, state, client, originalMsg);

        return;
      }

      // Handle bot card battle
      if (customId.startsWith('battle_bot_')) {
        const botIndex = parseInt(customId.split('_')[2]);
        await handleBattle(interaction, message, state, botIndex, originalMsg, client);
        return;
      }

      // Handle reroll - show confirmation first
      if (customId.startsWith('reroll_bot_')) {
        const botIndex = parseInt(customId.split('_')[2]);
        await showRerollConfirmation(interaction, state, botIndex);
        return;
      }

      // Handle reroll confirmation
      if (customId.startsWith('reroll_confirm_')) {
        // Prevent reroll spam - check if already processing
        if (state.pendingReroll) {
          // Edit the confirmation message to show "processing" instead of creating followup
          await interaction.editParent({
            embeds: [{
              title: `${EMOJI.reroll} Processing Reroll...`,
              description: `${EMOJI.warning} Reroll already in progress, please wait!`,
              color: 0xFFAA00
            }],
            components: [] // Remove buttons
          }).catch(() => {});
          return;
        }
        state.pendingReroll = true; // Lock immediately
        
        // Immediately edit the confirmation to disable buttons and show processing
        await interaction.editParent({
          embeds: [{
            title: `${EMOJI.reroll} Processing Reroll...`,
            description: `⏳ Rerolling card, please wait...`,
            color: 0xFFAA00
          }],
          components: [] // Remove buttons to prevent spam
        }).catch(() => {});
        
        const botIndex = parseInt(customId.split('_')[2]);
        await handleReroll(interaction, message, state, botIndex, originalMsg, client);
        return;
      }

      // Handle reroll cancel
      if (customId === 'reroll_cancel') {
        // Edit the confirmation message instead of creating followup
        await interaction.editParent({
          embeds: [{
            title: `${EMOJI.fail} Reroll Cancelled`,
            description: `You cancelled the reroll.`,
            color: 0xFF6B6B
          }],
          components: [] // Remove buttons
        }).catch(() => {});
        return;
      }

    } catch (error) {
      console.error('Battle collector error:', error);
    }
  };

  const cleanup = () => {
    client.removeListener('interactionCreate', collector);
    battleCollectors.delete(userId);
    clearTimeout(timeoutId);

    // Only disable buttons/dropdowns on timeout
    message.edit({
      components: message.components.map(row => ({
        ...row,
        components: row.components.map(c => ({ ...c, disabled: true }))
      }))
    }).catch(() => {});
  };

  client.on('interactionCreate', collector);
  battleCollectors.set(userId, { cleanup, timeout: timeoutId, handler: collector });
}

/**
 * Handle battle between user and bot card
 */
async function handleBattle(interaction, message, state, botIndex, originalMsg, client) {
  try {
    const userCard = state.selectedUserCard;
    const botCard = state.botCards[botIndex];

    if (!userCard || botCard.defeated) {
      return;
    }

    // Generate card images for VS display
    // Pre-load overlay if needed
    const overlayPromise = userCard.condition && userCard.condition.toLowerCase() !== 'good'
      ? CardGenerationService.preloadOverlay(userCard.group, userCard.rarity, userCard.condition, userCard.cardId)
      : Promise.resolve(null);

    const userCardImage = await CardGenerationService.processCardImage(
      { imageURL: userCard.imageURL, group: userCard.group, rarity: userCard.rarity },
      userCard.condition,
      overlayPromise
    );

    const botCardImage = state.botCardBuffers[botIndex];

    // Create VS image
    const vsImage = await createVSImage(userCardImage, botCardImage);

    // Send VS screen as REGULAR message so everyone can see it
    const vsMessage = await originalMsg.channel.createMessage({
      embeds: [{
        title: `${EMOJI.vs} Battle in Progress...`,
        description: `<@${state.userId}> **${userCard.rarity} ${userCard.group} ${userCard.name}** vs **${botCard.rarity} ${botCard.group} ${botCard.name}**`,
        color: 0xFFFF00,
        image: { url: 'attachment://vs.png' }
      }],
      messageReference: { messageID: originalMsg.id }
    }, { file: vsImage, name: 'vs.png' });

    // Calculate winner
    const battleResult = determineBattleWinner(userCard, botCard);

    // Wait for dramatic effect
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Process result
    if (battleResult.winner === 'user') {
      // User wins - gets bot card
      state.battlesWon++;
      botCard.defeated = true;

      // Generate card code for bot card and save it to user
      const { generateUniqueCode } = require('../../utils/cardCodeGenerator');
      botCard.cardCode = await generateUniqueCode();
      botCard.discordId = state.userId;

      await CardGenerationService.saveCardsToDatabase([botCard]);

      // Store won card data with image buffer
      state.wonCards.push({
        cardData: botCard,
        imageBuffer: state.botCardBuffers[botIndex]
      });

      const rarityEmoji = RARITY_EMOJIS[botCard.rarity.toLowerCase()] || botCard.rarity;
      const conditionEmoji = CONDITION_EMOJIS[botCard.condition.toLowerCase()] || botCard.condition;

      // Edit VS message to remove image but keep result text
      await vsMessage.edit({
        embeds: [{
          ...formatBattleResult(battleResult),
          description: `<@${state.userId}> ${formatBattleResult(battleResult).description}

**Won Card:**
${rarityEmoji} ${conditionEmoji} **${botCard.group} ${botCard.name}**
Code: \`${botCard.cardCode}\``,
          footer: { text: `Bot card added to your collection!` }
        }],
        attachments: [] // Remove the VS image
      });

    } else {
      // User loses - card locked for session
      state.battlesLost++;
      userCard.locked = true;
      state.selectedUserCard = null;

      // Edit VS message to remove image but keep result text
      await vsMessage.edit({
        embeds: [{
          ...formatBattleResult(battleResult),
          description: `<@${state.userId}> ${formatBattleResult(battleResult).description}`,
          footer: { text: `Your card is locked for this battle session.` }
        }],
        attachments: [] // Remove the VS image
      });
    }

    // Wait before updating main UI
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check if battle session is over
    const availableUserCards = state.userCards.filter(c => !c.locked).length;
    const availableBotCards = state.botCards.filter(c => !c.defeated).length;

    if (availableUserCards === 0 || availableBotCards === 0) {
      // End session - SET COOLDOWN HERE (30 minutes after battle ends)
      await Cooldown.findOneAndUpdate(
        { user: state.userId, command: 'battle' },
        { cooldownEnd: Date.now() + BATTLE_CONFIG.cooldownDuration },
        { upsert: true }
      );

      activeBattles.delete(state.userId);
      buttonCooldowns.delete(state.userId); // Cleanup button cooldown
      
      const collector = battleCollectors.get(state.userId);
      if (collector) {
        client.removeListener('interactionCreate', collector.handler);
        clearTimeout(collector.timeout);
        battleCollectors.delete(state.userId);
      }

      // DELETE the main battle message completely
      await message.delete().catch(() => {});

      // Send battle summary with won cards
      await sendBattleSummary(originalMsg, state);

      return;
    }

    // Continue battle based on result
    if (battleResult.winner === 'user') {
      // WON - Keep using same card, stay in phase 2 (bot selection)
      // state.selectedUserCard stays the same, phase stays 'select_bot_card'
      
      // Use cached bot image (already has correct buffers)
      const combinedBotImage = state.combinedBotImage || await CardGenerationService.createCombinedImage(
        state.botCardBuffers,
        {
          width: CARD_DIMENSIONS.width,
          height: CARD_DIMENSIONS.height,
          columns: 5,
          padding: CARD_DIMENSIONS.padding
        }
      );

      // Delete old and create new
      await message.delete().catch(() => {});
      
      const newBattleMessage = await originalMsg.channel.createMessage({
        embeds: createPhaseEmbeds(state, originalMsg.author),
        components: createBattleComponents(state),
        messageReference: { messageID: originalMsg.id }
      }, { file: combinedBotImage, name: 'bot_cards.png' });

      // Update collector for new message
      const existingCollector = battleCollectors.get(state.userId);
      if (existingCollector) {
        client.removeListener('interactionCreate', existingCollector.handler);
        clearTimeout(existingCollector.timeout);
      }
      await setupBattleCollector(newBattleMessage, state, client, originalMsg);

    } else {
      // LOST - Card locked, go back to phase 1 to pick new card
      state.phase = 'select_user_card';
      // state.selectedUserCard already set to null above when user lost

      // Show user cards again for next selection
      const combinedUserImage = state.combinedUserImage || await CardGenerationService.createCombinedImage(
        state.userCardBuffers,
        {
          width: CARD_DIMENSIONS.width,
          height: CARD_DIMENSIONS.height,
          columns: 5,
          padding: CARD_DIMENSIONS.padding
        }
      );

      // Delete old and create new (Eris attachment limitation)
      await message.delete().catch(() => {});
      
      const newBattleMessage = await originalMsg.channel.createMessage({
        embeds: createPhaseEmbeds(state, originalMsg.author),
        components: createBattleComponents(state),
        messageReference: { messageID: originalMsg.id }
      }, { file: combinedUserImage, name: 'your_cards.png' });

      // Update collector for new message
      const existingCollector = battleCollectors.get(state.userId);
      if (existingCollector) {
        client.removeListener('interactionCreate', existingCollector.handler);
        clearTimeout(existingCollector.timeout);
      }
      await setupBattleCollector(newBattleMessage, state, client, originalMsg);
    }

  } catch (error) {
    console.error('Battle handling error:', error);
    // Notify user of error
    await interaction.createFollowup({
      content: `${EMOJI.fail} An error occurred during battle. Please try again.`,
      flags: 64
    }).catch(() => {});
  }
}

/**
 * Send battle summary with all won cards
 */
async function sendBattleSummary(originalMsg, state) {
  try {
    if (state.wonCards.length === 0) {
      // No wins
      await originalMsg.channel.createMessage({
        embeds: [{
          title: `${EMOJI.battle} Battle Session Complete!`,
          description: `
**Final Stats:**
${EMOJI.win} Wins: ${state.battlesWon}
${EMOJI.lose} Losses: ${state.battlesLost}

You didn't win any cards this time. Better luck next battle!

Cooldown: ${BATTLE_CONFIG.cooldownDuration / 60000} minutes
          `.trim(),
          color: 0xFF6B6B
        }],
        messageReference: { messageID: originalMsg.id }
      });
      return;
    }

    // Create combined image of won cards
    const wonCardBuffers = state.wonCards.map(c => c.imageBuffer);
    const wonCardsImage = await CardGenerationService.createCombinedImage(
      wonCardBuffers,
      {
        width: CARD_DIMENSIONS.width,
        height: CARD_DIMENSIONS.height,
        columns: Math.min(5, wonCardBuffers.length),
        padding: CARD_DIMENSIONS.padding
      }
    );

    // Create list of won cards
    const wonCardsList = state.wonCards.map((card, index) => {
      const rarityEmoji = RARITY_EMOJIS[card.cardData.rarity.toLowerCase()] || card.cardData.rarity;
      const conditionEmoji = CONDITION_EMOJIS[card.cardData.condition.toLowerCase()] || card.cardData.condition;
      
      return `**${index + 1}.** ${rarityEmoji} ${conditionEmoji} [#${card.cardData.printNumber}] ${card.cardData.group} ${card.cardData.name} - \`${card.cardData.cardCode}\``;
    }).join('\n');

    await originalMsg.channel.createMessage({
      embeds: [{
        title: `${EMOJI.battle} Battle Session Complete!`,
        description: `
**Final Stats:**
${EMOJI.win} Wins: ${state.battlesWon}
${EMOJI.lose} Losses: ${state.battlesLost}

**Cards Won:**
${wonCardsList}

Cooldown: ${BATTLE_CONFIG.cooldownDuration / 60000} minutes
        `.trim(),
        color: 0x00FF00,
        image: { url: 'attachment://won_cards.png' }
      }],
      messageReference: { messageID: originalMsg.id }
    }, { file: wonCardsImage, name: 'won_cards.png' });

  } catch (error) {
    console.error('Battle summary error:', error);
  }
}

/**
 * Show reroll confirmation dialog
 */
async function showRerollConfirmation(interaction, state, botIndex) {
  try {
    const botCard = state.botCards[botIndex];

    // Pre-validation checks
    if (botCard.defeated) {
      await interaction.createFollowup({
        content: `${EMOJI.fail} This card is already defeated!`,
        flags: 64
      });
      return;
    }

    if (state.rerollCount >= BATTLE_CONFIG.maxRerolls) {
      await interaction.createFollowup({
        content: `${EMOJI.fail} No rerolls remaining!`,
        flags: 64
      });
      return;
    }

    // Show confirmation with card info and cost
    await interaction.createFollowup({
      embeds: [{
        title: `${EMOJI.reroll} Confirm Reroll?`,
        description: `Are you sure you want to reroll **Card ${botIndex + 1}**?\n\n**Current Card:** ${botCard.rarity} ${botCard.group} ${botCard.name}\n\n${EMOJI.crystals} **Cost:** ${BATTLE_CONFIG.rerollCost} Crystals\n🔄 **Rerolls Used:** ${state.rerollCount}/${BATTLE_CONFIG.maxRerolls}`,
        color: 0xFFAA00
      }],
      components: [{
        type: 1,
        components: [
          {
            type: 2,
            style: 3, // Green/Success
            custom_id: `reroll_confirm_${botIndex}`,
            label: 'Yes, Reroll',
            emoji: { name: '✅' }
          },
          {
            type: 2,
            style: 4, // Red/Danger
            custom_id: 'reroll_cancel',
            label: 'Cancel',
            emoji: { name: '❌' }
          }
        ]
      }],
      flags: 64
    });
  } catch (error) {
    console.error('Reroll confirmation error:', error);
    // Send error feedback to user
    await interaction.createFollowup({
      content: `${EMOJI.fail} An error occurred. Please try again.`,
      flags: 64
    }).catch(() => {});
  }
}

/**
 * Handle card reroll - FIXED ATTACHMENT HANDLING + SPAM PROTECTION
 */
async function handleReroll(interaction, message, state, botIndex, originalMsg, client) {
  try {
    const botCard = state.botCards[botIndex];

    if (botCard.defeated) {
      state.pendingReroll = false;
      await interaction.createFollowup({
        content: `${EMOJI.fail} This card is already defeated!`,
        flags: 64
      });
      return;
    }

    if (state.rerollCount >= BATTLE_CONFIG.maxRerolls) {
      state.pendingReroll = false;
      await interaction.createFollowup({
        content: `${EMOJI.fail} No rerolls remaining!`,
        flags: 64
      });
      return;
    }

    // Check if battle is still active
    if (!activeBattles.has(state.userId)) {
      state.pendingReroll = false;
      await interaction.createFollowup({
        content: `${EMOJI.fail} This battle session has ended.`,
        flags: 64
      });
      return;
    }

    // Atomically deduct crystals to prevent race conditions
    const result = await Currency.findOneAndUpdate(
      { userId: state.userId, crystals: { $gte: BATTLE_CONFIG.rerollCost } },
      { $inc: { crystals: -BATTLE_CONFIG.rerollCost } },
      { new: true }
    );

    if (!result) {
      state.pendingReroll = false;
      // Either currency doc doesn't exist or insufficient crystals
      const currency = await Currency.findOne({ userId: state.userId });
      await interaction.createFollowup({
        content: `${EMOJI.fail} Not enough crystals! Need ${BATTLE_CONFIG.rerollCost}, you have ${currency?.crystals || 0}.`,
        flags: 64
      });
      return;
    }

    // Save old card image and data
    const oldCardImage = state.botCardBuffers[botIndex];
    const oldCardData = { ...botCard };

    // Generate new card
    const newRarity = selectWeightedRarity();
    const newCards = await CardGenerationService.generateCards(
      '1117452463407104042',
      1,
      { rarities: [newRarity], skipCardCode: true }
    );

    if (!newCards || !newCards[0]) {
      // Refund crystals since card generation failed
      await Currency.findOneAndUpdate(
        { userId: state.userId },
        { $inc: { crystals: BATTLE_CONFIG.rerollCost } }
      );
      throw new Error('Failed to generate reroll card');
    }

    const newCard = newCards[0];

    // Update state FIRST
    state.botCards[botIndex] = newCard.cardData;
    state.botCardBuffers[botIndex] = newCard.imageBuffer;
    state.rerollCount++;
    state.combinedBotImage = null; // Invalidate cache - bot cards changed

    // Create comparison image
    const comparisonImage = await createRerollComparisonImage(
      oldCardImage,
      newCard.imageBuffer
    );

    // Send comparison as ephemeral
    await interaction.createFollowup({
      embeds: [{
        title: `${EMOJI.reroll} Card ${botIndex + 1} Rerolled`,
        description: `${EMOJI.crystals} -${BATTLE_CONFIG.rerollCost} Crystals

**Old Card:** ${oldCardData.rarity} ${oldCardData.group} ${oldCardData.name}
**New Card:** ${newCard.cardData.rarity} ${newCard.cardData.group} ${newCard.cardData.name}`,
        color: 0x00AAFF,
        image: { url: 'attachment://reroll.png' }
      }],
      flags: 64
    }, { 
      file: comparisonImage, 
      name: 'reroll.png' 
    });

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Regenerate combined bot image with UPDATED buffers and cache it
    const newCombinedImage = await CardGenerationService.createCombinedImage(
      state.botCardBuffers,
      {
        width: CARD_DIMENSIONS.width,
        height: CARD_DIMENSIONS.height,
        columns: 5,
        padding: CARD_DIMENSIONS.padding
      }
    );
    state.combinedBotImage = newCombinedImage; // Cache the new image

    // Delete old message and create new one (Eris can't edit attachments)
    await message.delete().catch(() => {});
    
    // Create new message with updated state (using phase embeds)
    const newBattleMessage = await originalMsg.channel.createMessage({
      embeds: createPhaseEmbeds(state, originalMsg.author),
      components: createBattleComponents(state),
      messageReference: { messageID: originalMsg.id }
    }, { 
      file: newCombinedImage, 
      name: 'bot_cards.png' 
    });

    // Update collector to watch new message
    const collector = battleCollectors.get(state.userId);
    if (collector) {
      client.removeListener('interactionCreate', collector.handler);
      clearTimeout(collector.timeout);
    }

    // Re-setup collector for new message
    await setupBattleCollector(newBattleMessage, state, client, originalMsg);
    
    // Clear pending reroll flag on success
    state.pendingReroll = false;

  } catch (error) {
    console.error('Reroll error:', error);
    // Clear pending reroll flag on error too
    state.pendingReroll = false;
    // Send error feedback to user
    await interaction.createFollowup({
      content: `${EMOJI.fail} An error occurred while rerolling. Please try again.`,
      flags: 64
    }).catch(() => {});
  }
}

module.exports = {
  initializeBattle,
  resumeBattle,
  getActiveBattle: (userId) => activeBattles.get(userId)
};
