// commands/battle/battle.js - Main battle command entry (COOLDOWN FIXED)
// ============================================================================

const Cooldown = require('../../models/cooldown');
const Graphic = require('../../models/graphic');
const BattleTeam = require('../../models/battleTeam');
const User = require('../../models/user');
const { initializeBattle, resumeBattle, getActiveBattle } = require('./battleHandler');
const { EMOJI, BATTLE_CONFIG } = require('../../config/battle');

module.exports = {
  name: 'battle',
  aliases: ['btl'],
  description: 'Battle against bot cards to win new cards',

  async execute(msg, args, client) {
    const userId = msg.author.id;

    try {
      // Check registration
      const graphic = await Graphic.findOne({ userId });
      if (!graphic?.isRegistered) {
        return msg.channel.createMessage({
          embeds: [{
            title: '🚫 Registration Required',
            description: 'You need to register first! Use `?register` to start.',
            color: 0xFF6B6B
          }],
          messageReference: { messageID: msg.id }
        });
      }

      // Check if user has active battle first
      const activeBattle = getActiveBattle(userId);

      // Handle: .battle team <5 codes> - Save battle team
      if (args[0]?.toLowerCase() === 'team') {
        const teamCodes = args.slice(1);

        if (teamCodes.length !== BATTLE_CONFIG.requiredCards) {
          return msg.channel.createMessage({
            embeds: [{
              title: `${EMOJI.battle} Battle Team`,
              description: `
Please provide exactly **${BATTLE_CONFIG.requiredCards} card codes** for your battle team.

**Example:**
\`?battle team ABC123 DEF456 GHI789 JKL012 MNO345\`

Your battle team will be saved and you can start battles by simply using \`?battle\`
              `.trim(),
              color: 0x5865F2
            }],
            messageReference: { messageID: msg.id }
          });
        }

        // Validate that user owns all cards
        const userCards = await User.find({
          cardCode: { $in: teamCodes },
          discordId: userId
        }).lean();

        if (userCards.length !== BATTLE_CONFIG.requiredCards) {
          return msg.channel.createMessage({
            content: `${EMOJI.fail} You must own all 5 cards. Found ${userCards.length}/5.`,
            messageReference: { messageID: msg.id }
          });
        }

        // Save battle team
        await BattleTeam.findOneAndUpdate(
          { userId },
          { cardCodes: teamCodes },
          { upsert: true, new: true }
        );

        return msg.channel.createMessage({
          embeds: [{
            title: `${EMOJI.success} Battle Team Saved!`,
            description: `
Your battle team has been saved with these cards:
${teamCodes.map((code, i) => `${i + 1}. \`${code}\``).join('\n')}

You can now start battles by simply using \`?battle\`
            `.trim(),
            color: 0x00FF00
          }],
          messageReference: { messageID: msg.id }
        });
      }

      // Handle: .battle (no args) - Use saved team OR resume battle
      if (!args || args.length === 0) {
        // First check if there's an active battle to resume
        if (activeBattle) {
          const resumeResult = await resumeBattle(msg, client);
          
          if (!resumeResult.success) {
            return msg.channel.createMessage({
              content: resumeResult.message,
              messageReference: { messageID: msg.id }
            });
          }
          
          return; // Successfully resumed
        }

        // No active battle - check cooldown BEFORE trying to start
        const cooldownResult = await this.checkCooldown(userId);
        if (cooldownResult.isOnCooldown) {
          return msg.channel.createMessage({
            content: `${EMOJI.warning} Please wait ${cooldownResult.formattedTime} before starting a new battle.`,
            messageReference: { messageID: msg.id }
          });
        }

        // Try to use saved team
        const battleTeam = await BattleTeam.findOne({ userId });
        
        if (!battleTeam || battleTeam.cardCodes.length !== BATTLE_CONFIG.requiredCards) {
          return msg.channel.createMessage({
            embeds: [{
              title: `${EMOJI.battle} No Battle Team Found`,
              description: `
You don't have a saved battle team yet!

**To save a battle team:**
\`?battle team <5 card codes>\`

**Or start a one-time battle:**
\`?battle <5 card codes>\`
              `.trim(),
              color: 0xFF6B6B
            }],
            messageReference: { messageID: msg.id }
          });
        }

        // Use saved team
        args = battleTeam.cardCodes;
      }

      // Check cooldown for NEW battles (not resuming)
      if (!activeBattle) {
        const cooldownResult = await this.checkCooldown(userId);
        if (cooldownResult.isOnCooldown) {
          return msg.channel.createMessage({
            content: `${EMOJI.warning} Please wait ${cooldownResult.formattedTime} before starting a new battle.`,
            messageReference: { messageID: msg.id }
          });
        }
      }

      // Validate arguments for new battle
      if (args.length !== BATTLE_CONFIG.requiredCards) {
        return msg.channel.createMessage({
          embeds: [{
            title: `${EMOJI.battle} Battle Command Usage`,
            description: `
Please provide exactly **${BATTLE_CONFIG.requiredCards} card codes** to battle with.

**Quick Battle (with saved team):**
\`?battle\` - Uses your saved battle team

**Save Battle Team:**
\`?battle team <5 codes>\` - Save cards for quick battles

**One-Time Battle:**
\`?battle <5 codes>\` - Battle without saving team

**How it works:**
1. Bot generates 5 random cards
2. Select one of your cards to battle
3. Choose a bot card to fight
4. Winner takes the card!
5. Lose = your card is locked for this session
6. Can reroll bot cards (${EMOJI.crystals} ${BATTLE_CONFIG.rerollCost} each, max ${BATTLE_CONFIG.maxRerolls})

**Battle Score:**
• Rarity & Condition matter most
• +Random bonus gives weaker cards a chance!
            `.trim(),
            color: 0x5865F2,
          }],
          messageReference: { messageID: msg.id }
        });
      }

      // Initialize new battle - DON'T set cooldown here, only at battle END
      const result = await initializeBattle(msg, args, client);

      if (!result.success) {
        return msg.channel.createMessage({
          content: result.message,
          messageReference: { messageID: msg.id }
        });
      }

    } catch (error) {
      console.error(`Battle command error for user ${userId}:`, error);
      return msg.channel.createMessage({
        content: `${EMOJI.fail} An error occurred. Please try again later.`,
        messageReference: { messageID: msg.id }
      });
    }
  },

  async checkCooldown(userId) {
    const now = Date.now();
    const cooldown = await Cooldown.findOne({ user: userId, command: this.name });

    if (cooldown?.cooldownEnd > now) {
      const remaining = cooldown.cooldownEnd - now;
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.ceil((remaining % 60000) / 1000);

      return {
        isOnCooldown: true,
        formattedTime: `${minutes}m ${seconds}s`
      };
    }

    return { isOnCooldown: false };
  }
};
