// commands/user/claim.js
const Voucher = require('../../models/voucher');
const Currency = require('../../models/currency');
const Pack = require('../../models/pack');
const CardGenerationService = require('../../services/CardGenerationService');
const { generatePackCode } = require('../../utils/packCodeGenerator');
const { formatRewardsDisplay, formatExpirationDisplay } = require('../../utils/voucherUtils');
const { CONDITION_EMOJIS } = require('../../config/embedConstants');
const { logCardSpawn } = require('../../utils/cardSpawnLogger');

const claimCommand = {
  name: "claim",
  aliases: ["redeem", "voucher"],
  description: "Claim voucher rewards or view voucher info",
  cooldown: 3,

  async execute(msg, args, client) {
    if (args.length === 0) {
      return msg.channel.createMessage({
        content: "❌ Usage: `?claim CODE` or `?claim info CODE`",
        messageReference: { messageID: msg.id }
      });
    }

    const subcommand = args[0].toLowerCase();
    
    // Handle info subcommand
    if (subcommand === 'info') {
      return this.handleInfo(msg, args.slice(1));
    }

    // Handle claim
    return this.handleClaim(msg, args, client);
  },

  /* ========================================
     INFO: VIEW VOUCHER WITHOUT CLAIMING
  ======================================== */
  async handleInfo(msg, args) {
    if (args.length === 0) {
      return msg.channel.createMessage({
        content: "❌ Usage: `?claim info CODE`",
        messageReference: { messageID: msg.id }
      });
    }

    const code = args[0];
    const voucher = await Voucher.findOne({ code }).lean();

    if (!voucher) {
      return msg.channel.createMessage({
        content: `❌ Voucher \`${code}\` not found.`,
        messageReference: { messageID: msg.id }
      });
    }

    const isExpired = voucher.expiresAt <= new Date();
    const isClaimable = voucher.isActive && !isExpired;
    const remainingClaims = voucher.maxClaims === null 
      ? 'Unlimited' 
      : Math.max(0, voucher.maxClaims - voucher.claimedBy.length);

    return msg.channel.createMessage({
      embeds: [{
        title: `🎫 Voucher: \`${code}\``,
        description: `**Status:** ${isClaimable ? '🟢 Claimable' : '🔴 Not Claimable'}\n` +
                     `**Expires:** ${formatExpirationDisplay(voucher.expiresAt)}\n` +
                     `**Remaining Claims:** ${remainingClaims}\n\n` +
                     `${formatRewardsDisplay(voucher.rewards)}\n\n` +
                     `Use \`?claim ${code}\` to redeem!`,
        color: isClaimable ? 0x00FF00 : 0xFF0000,
        footer: { text: isClaimable ? 'Claim this voucher now!' : 'This voucher cannot be claimed' }
      }],
      messageReference: { messageID: msg.id }
    });
  },

  /* ========================================
     CLAIM: REDEEM VOUCHER REWARDS
  ======================================== */
  async handleClaim(msg, args, client) {
    const userId = msg.author.id;
    const code = args[0];

    try {
      // Find voucher
      const voucher = await Voucher.findOne({ code });

      if (!voucher) {
        return msg.channel.createMessage({
          content: `❌ Voucher \`${code}\` not found.`,
          messageReference: { messageID: msg.id }
        });
      }

      // Check if already claimed by user
      if (voucher.claimedBy.includes(userId)) {
        return msg.channel.createMessage({
          content: `❌ You have already claimed voucher \`${code}\`.`,
          messageReference: { messageID: msg.id }
        });
      }

      // Check if voucher is active
      if (!voucher.isActive) {
        return msg.channel.createMessage({
          content: `❌ Voucher \`${code}\` is no longer active.`,
          messageReference: { messageID: msg.id }
        });
      }

      // Check if expired
      if (voucher.expiresAt <= new Date()) {
        return msg.channel.createMessage({
          content: `❌ Voucher \`${code}\` has expired.`,
          messageReference: { messageID: msg.id }
        });
      }

      // Check if max claims reached
      if (voucher.maxClaims !== null && voucher.claimedBy.length >= voucher.maxClaims) {
        return msg.channel.createMessage({
          content: `❌ Voucher \`${code}\` has reached its maximum number of claims.`,
          messageReference: { messageID: msg.id }
        });
      }

      // Show confirmation
      const confirmMsg = await msg.channel.createMessage({
        embeds: [{
          title: "🎫 Confirm Voucher Claim",
          description: `**Code:** \`${code}\`\n\n` +
                       `${formatRewardsDisplay(voucher.rewards)}\n\n` +
                       `**⚠️ You can only claim this voucher once!**`,
          color: 0xFFAA00,
          footer: { text: "Click Claim to receive your rewards" }
        }],
        messageReference: { messageID: msg.id },
        components: [{
          type: 1,
          components: [
            {
              type: 2,
              style: 3,
              label: "Claim",
              custom_id: "confirm_claim",
              emoji: { name: "🎁" }
            },
            {
              type: 2,
              style: 4,
              label: "Cancel",
              custom_id: "cancel_claim",
              emoji: { name: "❌" }
            }
          ]
        }]
      });

      // Wait for confirmation
      try {
        const interaction = await this.awaitButton(client, confirmMsg, userId, 30000);

        if (interaction.data.custom_id === 'cancel_claim') {
          await interaction.acknowledge();
          return confirmMsg.edit({
            embeds: [{
              title: "❌ Cancelled",
              description: "Voucher claim cancelled.",
              color: 0xFF0000
            }],
            components: []
          });
        }

        await interaction.acknowledge();
        await confirmMsg.edit({
          embeds: [{
            title: "⏳ Processing...",
            description: "Please wait while we process your rewards...",
            color: 0xFFAA00
          }],
          components: []
        });

        // Use atomic findOneAndUpdate to prevent concurrent claims
        const claimResult = await Voucher.findOneAndUpdate(
          {
            code,
            isActive: true,
            expiresAt: { $gt: new Date() },
            claimedBy: { $ne: userId },
            $expr: {
              $or: [
                { $eq: ['$maxClaims', null] },
                { $lt: [{ $size: '$claimedBy' }, '$maxClaims'] }
              ]
            }
          },
          { $push: { claimedBy: userId } },
          { new: true }
        );

        if (!claimResult) {
          return confirmMsg.edit({
            embeds: [{
              title: "❌ Claim Failed",
              description: "This voucher is no longer available, has been claimed by you, or has reached its limit.",
              color: 0xFF0000
            }],
            components: []
          });
        }

        // Process rewards
        const rewardsSummary = await this.processRewards(userId, claimResult.rewards, client, msg);

        // Success message
        return confirmMsg.edit({
          embeds: [{
            title: "✅ Voucher Claimed!",
            description: `**Code:** \`${code}\`\n\n${rewardsSummary}`,
            color: 0x00FF00,
            footer: { text: "Rewards have been added to your account!" }
          }]
        });

      } catch (timeoutError) {
        return confirmMsg.edit({
          embeds: [{
            title: "⏱️ Timeout",
            description: "Claim cancelled due to timeout.",
            color: 0xFF0000
          }],
          components: []
        });
      }

    } catch (error) {
      console.error('[CLAIM_ERR]', error);
      return msg.channel.createMessage({
        content: `❌ Error claiming voucher: ${error.message}`,
        messageReference: { messageID: msg.id }
      });
    }
  },

  /* ========================================
     PROCESS REWARDS
  ======================================== */
  async processRewards(userId, rewards, client, msg) {
    const summary = [];

    // Process currency
    if (rewards.currency) {
      const currencyUpdates = {};
      if (rewards.currency.crystals > 0) {
        currencyUpdates.crystals = rewards.currency.crystals;
        summary.push(`✅ **${rewards.currency.crystals.toLocaleString()}** <:zerose:1449661246407311455>`);
      }
      if (rewards.currency.astralEssence > 0) {
        currencyUpdates.astralEssence = rewards.currency.astralEssence;
        summary.push(`✅ **${rewards.currency.astralEssence.toLocaleString()}** <:astral_essence:1129023606542839819>`);
      }
      if (rewards.currency.stardust > 0) {
        currencyUpdates.stardust = rewards.currency.stardust;
        summary.push(`✅ **${rewards.currency.stardust.toLocaleString()}** <:stardust:1125059156785762436>`);
      }

      if (Object.keys(currencyUpdates).length > 0) {
        await Currency.updateOne(
          { userId },
          { $inc: currencyUpdates },
          { upsert: true }
        );
      }
    }

    // Process packs
    if (rewards.packs && rewards.packs.length > 0) {
      for (const packReward of rewards.packs) {
        const packCodes = [];
        
        for (let i = 0; i < packReward.quantity; i++) {
          const code = await generatePackCode();
          await Pack.create({
            userId,
            packCode: code,
            packType: packReward.type,
            targetGroup: packReward.targetGroup || null,
            isOpened: false
          });
          packCodes.push(code);
        }

        const groupInfo = packReward.targetGroup ? ` (${packReward.targetGroup})` : '';
        summary.push(`✅ **${packReward.quantity}x ${packReward.type}**${groupInfo}`);
      }
    }

    // Process cards (generate immediately and show details)
    if (rewards.cards && rewards.cards.length > 0) {
      for (const cardReward of rewards.cards) {
        const options = {
          applyPristineOverlay: true
        };

        if (cardReward.rarity) {
          options.rarity = cardReward.rarity;
        }
        if (cardReward.condition) {
          options.condition = cardReward.condition;
        }
        if (cardReward.group) {
          options.groupPattern = cardReward.group;
        }

        // Generate cards
        const generatedCards = await CardGenerationService.generateCards(
          userId, 
          cardReward.quantity, 
          options
        );

        // Save cards to database with print numbers
        const cardsData = generatedCards.map(c => c.cardData);
        await CardGenerationService.saveCardsToDatabase(cardsData);

        // Log card spawns
        for (const card of generatedCards) {
          logCardSpawn({
            userId: userId,
            username: msg?.author?.username || 'Unknown',
            cardName: card.cardData.name,
            group: card.cardData.group,
            rarity: card.cardData.rarity,
            condition: card.cardData.condition,
            cardCode: card.cardData.cardCode,
            printNumber: card.cardData.printNumber,
            command: 'claim',
            channelId: msg?.channel?.id || 'Unknown',
            channelName: msg?.channel?.name || 'DM',
            guildId: msg?.guildID || 'DM',
            guildName: msg?.channel?.guild?.name || 'DM',
            isCosmic: card.isCosmic || false
          }).catch(err => console.error('[CLAIM_LOG_ERROR]', err));
        }

        // Build detailed card list (similar to cabinet format)
        const cardsList = generatedCards.map(card => {
          const c = card.cardData;
          const conditionEmoji = CONDITION_EMOJIS[c.condition.toLowerCase()] || '';
          const printInfo = c.printNumber ? `#${c.printNumber}` : '';
          return `${conditionEmoji} **${c.group} ${c.name}** [${printInfo}] — \`${c.cardCode}\``;
        }).join('\n');

        // Add header for this card reward batch
        const rewardDesc = [
          cardReward.rarity || 'Random',
          cardReward.condition || 'Random',
          cardReward.group ? `(${cardReward.group})` : ''
        ].filter(Boolean).join(' ');

        summary.push(`✅ **${cardReward.quantity}x ${rewardDesc} cards:**\n${cardsList}`);
      }
    }

    return summary.join('\n\n');
  },

  /* ========================================
     HELPER: AWAIT BUTTON
  ======================================== */
  awaitButton(client, message, userId, time) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.removeListener('interactionCreate', buttonHandler);
        reject(new Error('Timeout'));
      }, time);

      const buttonHandler = (interaction) => {
        if (interaction.message.id !== message.id) return;
        if (interaction.member.id !== userId) return;
        if (interaction.type !== 3) return;

        clearTimeout(timeout);
        client.removeListener('interactionCreate', buttonHandler);
        resolve(interaction);
      };

      client.on('interactionCreate', buttonHandler);
    });
  }
};

module.exports = claimCommand;