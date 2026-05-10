// commands/admin/admin.js - UPDATED WITH VOUCHER & GROUP PACK SUPPORT & CURRENCY GIFTING
const Card = require('../../models/card');
const User = require('../../models/user');
const Pack = require('../../models/pack');
const Currency = require('../../models/currency');
const { generatePackCode } = require('../../utils/packCodeGenerator');
const { validateGroupForPack } = require('../../utils/packUtils');
const PACK_CONFIG = require('../../utils/packConfig');
const voucherAdmin = require('./voucherAdmin');
const { ADMIN_IDS, isAdmin } = require('../../config/constants');
const { CURRENCY_EMOJIS } = require('../../config/embedConstants');

const MAX_UNOPENED = 50;

const adminCommand = {
  name: "admin",
  aliases: ["adm"],
  description: "Admin command for card updates, pack gifting, and voucher management",
  adminOnly: true,

  async execute(msg, args, client) {
    const userId = msg.author.id;

    // Admin check
    if (!isAdmin(userId)) {
      return msg.channel.createMessage({
        content: "❌ This command is admin-only.",
        messageReference: { messageID: msg.id }
      });
    }

    if (args.length === 0) {
      return this.sendUsageMessage(msg);
    }

    const action = args[0].toLowerCase();

    // Route to appropriate handler
    if (action === 'give') {
      return this.handlePackGift(msg, args, client);
    } else if (action === 'voucher') {
      return this.handleVoucher(msg, args.slice(1), client);
    } else if (action === 'currency' || action === 'curr') {
      return this.handleCurrencyGift(msg, args.slice(1), client);
    } else {
      return this.handleCardUpdate(msg, args, client);
    }
  },

  /* ========================================
     VOUCHER MANAGEMENT (NEW)
  ======================================== */
  async handleVoucher(msg, args, client) {
    if (args.length === 0) {
      return msg.channel.createMessage({
        content: "❌ Usage: `?admin voucher <create|list|info|delete|claims> ...`\n\n" +
                 "Use `?admin` to see full command help.",
        messageReference: { messageID: msg.id }
      });
    }

    const subcommand = args[0].toLowerCase();

    switch (subcommand) {
      case 'create':
        return voucherAdmin.handleCreate(msg, args.slice(1));
      case 'list':
        return voucherAdmin.handleList(msg, args.slice(1));
      case 'info':
        return voucherAdmin.handleInfo(msg, args.slice(1));
      case 'delete':
        return voucherAdmin.handleDelete(msg, args.slice(1));
      case 'claims':
        return voucherAdmin.handleClaims(msg, args.slice(1));
      default:
        return msg.channel.createMessage({
          content: `❌ Unknown voucher subcommand: \`${subcommand}\`\n\n` +
                   "Valid subcommands: create, list, info, delete, claims",
          messageReference: { messageID: msg.id }
        });
    }
  },

  /* ========================================
     PACK GIFTING FLOW (UPDATED WITH GROUP SUPPORT)
  ======================================== */
  async handlePackGift(msg, args, client) {
    // Parse: give @user pack-type [group:GROUP] [xQuantity]
    if (args.length < 3) {
      return msg.channel.createMessage({
        content: "❌ Usage: `?admin give @user pack-type [group:GROUP] [x5]`\n\n" +
                 "**Examples:**\n" +
                 "```\n" +
                 "?admin give @user winter-5 x3\n" +
                 "?admin give @user group-focus-10 group:TWICE x5\n" +
                 "?admin give @user normal-10\n" +
                 "```",
        messageReference: { messageID: msg.id }
      });
    }

    // Get recipient
    const userMention = args[1];
    const recipientId = userMention.replace(/[<@!>]/g, '');
    
    if (!recipientId || recipientId.length < 17) {
      return msg.channel.createMessage({
        content: "❌ Invalid user mention.",
        messageReference: { messageID: msg.id }
      });
    }

    // Get pack type
    const packType = args[2];
    const packConfig = PACK_CONFIG[packType];
    
    if (!packConfig) {
      return msg.channel.createMessage({
        content: `❌ Invalid pack type: \`${packType}\`\n\nAvailable types: ${Object.keys(PACK_CONFIG).filter(k => !k.startsWith('_') && k !== 'CATEGORIES').join(', ')}`,
        messageReference: { messageID: msg.id }
      });
    }

    // Parse group and quantity from remaining args
    let targetGroup = null;
    let quantity = 1;

    for (let i = 3; i < args.length; i++) {
      const arg = args[i];
      
      if (arg.toLowerCase().startsWith('group:')) {
        targetGroup = arg.substring(6);
      } else {
        const qtyMatch = arg.match(/^x?(\d+)$/i);
        if (qtyMatch) {
          quantity = parseInt(qtyMatch[1]);
          if (quantity < 1 || quantity > 1000) {
            return msg.channel.createMessage({
              content: "❌ Quantity must be between 1 and 1000.",
              messageReference: { messageID: msg.id }
            });
          }
        }
      }
    }

    // Validate group for group-focused packs
    if (packConfig.groupFocusChance && packConfig.groupFocusChance > 0) {
      if (!targetGroup) {
        return msg.channel.createMessage({
          content: `❌ Pack type \`${packType}\` is a group-focused pack and requires a target group.\n\n` +
                   `Use: \`?admin give @user ${packType} group:GROUP_NAME [xQUANTITY]\``,
          messageReference: { messageID: msg.id }
        });
      }

      // Validate the group
      const validation = await validateGroupForPack(targetGroup, packConfig, PACK_CONFIG);
      if (!validation.valid) {
        return msg.channel.createMessage({
          content: `❌ **Group validation failed:**\n${validation.error}`,
          messageReference: { messageID: msg.id }
        });
      }

      // Use the validated group(s) - store as JSON array for multiple variations
      targetGroup = validation.multipleGroups 
        ? JSON.stringify(validation.matchingGroups)
        : validation.matchingGroups[0];
    } else {
      // Non-group pack shouldn't have a group specified
      if (targetGroup) {
        return msg.channel.createMessage({
          content: `❌ Pack type \`${packType}\` is not a group-focused pack. Remove the group parameter.`,
          messageReference: { messageID: msg.id }
        });
      }
    }

    // Check current unopened packs
    const currentUnopened = await Pack.countDocuments({ userId: recipientId, isOpened: false });
    const newTotal = currentUnopened + quantity;
    const willExceed = newTotal > MAX_UNOPENED;

    // Try to get recipient user object for display name
    let recipientName = `<@${recipientId}>`;
    try {
      const recipient = await client.getRESTUser(recipientId);
      recipientName = recipient.username;
    } catch (e) {
      // User not found, use mention
    }

    // Format group display
    let groupDisplay = '';
    if (targetGroup) {
      try {
        const parsed = JSON.parse(targetGroup);
        if (Array.isArray(parsed)) {
          groupDisplay = `\n**Target Group:** ${parsed.length} variation${parsed.length > 1 ? 's' : ''} (${parsed.slice(0, 2).join(', ')}${parsed.length > 2 ? '...' : ''})`;
        } else {
          groupDisplay = `\n**Target Group:** ${targetGroup}`;
        }
      } catch (e) {
        groupDisplay = `\n**Target Group:** ${targetGroup}`;
      }
    }

    // Confirmation message
    const confirmMsg = await msg.channel.createMessage({
      embeds: [{
        title: "🎁 Confirm Pack Gift",
        description: `**Recipient:** ${recipientName}\n**Pack Type:** ${packType}${groupDisplay}\n**Quantity:** ${quantity}\n\n**Current unopened:** ${currentUnopened}\n**After gift:** ${newTotal}${willExceed ? ` ⚠️ **(Over ${MAX_UNOPENED} limit)**` : ''}`,
        color: willExceed ? 0xFFAA00 : 0x00FF00,
        footer: { text: willExceed ? "User will exceed pack limit. Continue anyway?" : "Click Confirm to send packs" }
      }],
      messageReference: { messageID: msg.id },
      components: [{
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: "Confirm",
            custom_id: "confirm_gift",
            emoji: { name: "✅" }
          },
          {
            type: 2,
            style: 4,
            label: "Cancel",
            custom_id: "cancel_gift",
            emoji: { name: "❌" }
          }
        ]
      }]
    });

    // Wait for confirmation
    try {
      const interaction = await this.awaitButton(client, confirmMsg, msg.author.id, 30000);

      if (interaction.data.custom_id === 'cancel_gift') {
        await interaction.acknowledge();
        return confirmMsg.edit({
          embeds: [{
            title: "❌ Cancelled",
            description: "Pack gift cancelled.",
            color: 0xFF0000
          }],
          components: []
        });
      }

      // Process gift
      await interaction.acknowledge();
      await confirmMsg.edit({
        embeds: [{
          title: "⏳ Processing...",
          description: `Generating ${quantity} pack code${quantity !== 1 ? 's' : ''}...`,
          color: 0xFFAA00
        }],
        components: []
      });

      // Generate pack codes
      const packPromises = [];
      for (let i = 0; i < quantity; i++) {
        packPromises.push(
          generatePackCode().then(code => 
            Pack.create({
              userId: recipientId,
              packCode: code,
              packType: packType,
              targetGroup: targetGroup || null,
              isOpened: false
            })
          )
        );
      }

      await Promise.all(packPromises);

      // Try to DM the user
      let dmSuccess = false;
      try {
        const dmChannel = await client.getDMChannel(recipientId);
        const dmContent = targetGroup 
          ? `You received **${quantity}x ${packType}** pack${quantity !== 1 ? 's' : ''} from an admin!\n\n${groupDisplay.replace('**Target Group:**', 'Target Group:')}\n\nUse \`?pack available\` to see your packs.`
          : `You received **${quantity}x ${packType}** pack${quantity !== 1 ? 's' : ''} from an admin!\n\nUse \`?pack available\` to see your packs.`;

        await dmChannel.createMessage({
          embeds: [{
            title: "🎁 You received packs!",
            description: dmContent,
            color: 0x00FF00,
            footer: { text: "Good luck!" }
          }]
        });
        dmSuccess = true;
      } catch (e) {
        console.log(`[ADMIN_GIFT] DM failed for user ${recipientId}`);
      }

      // Success message
      return confirmMsg.edit({
        embeds: [{
          title: "✅ Gift Sent!",
          description: `**${quantity}x ${packType}** pack${quantity !== 1 ? 's' : ''} sent to ${recipientName}${groupDisplay}\n\n${dmSuccess ? '✅ User notified via DM' : '⚠️ DM failed (user has DMs closed), but packs were added'}`,
          color: 0x00FF00,
          footer: { text: `New total: ${newTotal} unopened packs` }
        }]
      });

    } catch (timeoutError) {
      return confirmMsg.edit({
        embeds: [{
          title: "⏱️ Timeout",
          description: "Confirmation timed out. No packs sent.",
          color: 0xFF0000
        }],
        components: []
      });
    }
  },

  /* ========================================
     CURRENCY GIFTING (NEW)
  ======================================== */
  async handleCurrencyGift(msg, args, client) {
    // Parse: currency @user crystals:5000 stardust:100 [selca:5]
    if (args.length < 2) {
      return msg.channel.createMessage({
        content: "❌ Usage: `?admin currency @user <currency:amount> [currency:amount] ...`\n\n" +
                 "**Available currencies:**\n" +
                 `• \`crystals\` ${CURRENCY_EMOJIS.crystals} - Main currency\n` +
                 `• \`stardust\` ${CURRENCY_EMOJIS.stardust} - Premium currency\n` +
                 `• \`astralEssence\` ${CURRENCY_EMOJIS.astralEssence} - Rare currency\n` +
                 `• \`fantasiaTokens\` 🎫 - Token currency (deprecated)\n` +
                 `• \`reverieGem\` 💠 - Gem currency (deprecated)\n` +
                 `• \`selca\` ${CURRENCY_EMOJIS.selca || CURRENCY_EMOJIS.cosmic} - Cosmic currency\n\n` +
                 "**Examples:**\n" +
                 "```\n" +
                 "?admin currency @user crystals:5000\n" +
                 "?admin currency @user crystals:10000 stardust:50 selca:3\n" +
                 "?admin curr @user astralEssence:100 fantasiaTokens:25\n" +
                 "```",
        messageReference: { messageID: msg.id }
      });
    }

    // Get recipient
    const userMention = args[0];
    const recipientId = userMention.replace(/[<@!>]/g, '');
    
    if (!recipientId || recipientId.length < 17) {
      return msg.channel.createMessage({
        content: "❌ Invalid user mention or ID.",
        messageReference: { messageID: msg.id }
      });
    }

    // Parse currency amounts
    const validCurrencies = ['crystals', 'stardust', 'astralEssence', 'astralessence', 'fantasiaTokens', 'fantasiatokens', 'reverieGem', 'reveriegem', 'selca'];
    const currencyUpdates = {};
    
    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      const match = arg.match(/^(\w+):(-?\d+)$/);
      
      if (!match) {
        return msg.channel.createMessage({
          content: `❌ Invalid format: \`${arg}\`. Use: \`currency:amount\``,
          messageReference: { messageID: msg.id }
        });
      }

      const [, currency, amountStr] = match;
      const amount = parseInt(amountStr);
      const currencyLower = currency.toLowerCase();

      // Map aliases to proper field names
      let properField;
      if (currencyLower === 'crystals') properField = 'crystals';
      else if (currencyLower === 'stardust') properField = 'stardust';
      else if (currencyLower === 'astralEssence' || currencyLower === 'astralessence') properField = 'astralEssence';
      else if (currencyLower === 'fantasiaTokens' || currencyLower === 'fantasiatokens') properField = 'fantasiaTokens';
      else if (currencyLower === 'reverieGem' || currencyLower === 'reveriegem') properField = 'reverieGem';
      else if (currencyLower === 'selca') properField = 'selca';
      else {
        return msg.channel.createMessage({
          content: `❌ Invalid currency: \`${currency}\`\n\nValid: crystals, stardust, astralEssence, fantasiaTokens, reverieGem, selca`,
          messageReference: { messageID: msg.id }
        });
      }

      currencyUpdates[properField] = amount;
    }

    if (Object.keys(currencyUpdates).length === 0) {
      return msg.channel.createMessage({
        content: "❌ No valid currency amounts specified.",
        messageReference: { messageID: msg.id }
      });
    }

    // Check if user has currency record
    let recipientCurrency = await Currency.findOne({ userId: recipientId });
    if (!recipientCurrency) {
      return msg.channel.createMessage({
        content: `❌ User <@${recipientId}> does not have a currency balance. They may need to register first.`,
        messageReference: { messageID: msg.id }
      });
    }

    // Try to get recipient user object for display name
    let recipientName = `<@${recipientId}>`;
    try {
      const recipient = await client.getRESTUser(recipientId);
      recipientName = recipient.username;
    } catch (e) {
      // User not found, use mention
    }

    // Build currency display with emoji from config
    const currencyNames = {
      crystals: 'Crystals',
      stardust: 'Stardust',
      astralEssence: 'Astral Essence',
      fantasiaTokens: 'Fantasia Tokens',
      reverieGem: 'Reverie Gems',
      selca: 'Selca (Cosmic)'
    };

    const currencyDisplay = Object.entries(currencyUpdates)
      .map(([curr, amt]) => {
        const emoji = CURRENCY_EMOJIS[curr] || CURRENCY_EMOJIS.cosmic || '💰';
        const name = currencyNames[curr] || curr;
        return `• ${emoji} **${name}**: ${amt >= 0 ? '+' : ''}${amt.toLocaleString()}`;
      })
      .join('\n');

    // Confirmation message
    const confirmMsg = await msg.channel.createMessage({
      embeds: [{
        title: "💰 Confirm Currency Gift",
        description: `**Recipient:** ${recipientName}\n\n**Amounts to give:**\n${currencyDisplay}`,
        color: 0x00FF00,
        footer: { text: "Click Confirm to send currency" }
      }],
      messageReference: { messageID: msg.id },
      components: [{
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: "Confirm",
            custom_id: "confirm_currency_gift",
            emoji: { name: "✅" }
          },
          {
            type: 2,
            style: 4,
            label: "Cancel",
            custom_id: "cancel_currency_gift",
            emoji: { name: "❌" }
          }
        ]
      }]
    });

    // Wait for confirmation
    try {
      const interaction = await this.awaitButton(client, confirmMsg, msg.author.id, 30000);

      if (interaction.data.custom_id === 'cancel_currency_gift') {
        await interaction.acknowledge();
        return confirmMsg.edit({
          embeds: [{
            title: "❌ Cancelled",
            description: "Currency gift cancelled.",
            color: 0xFF0000
          }],
          components: []
        });
      }

      // Process gift
      await interaction.acknowledge();
      await confirmMsg.edit({
        embeds: [{
          title: "⏳ Processing...",
          description: "Updating currency balances...",
          color: 0xFFAA00
        }],
        components: []
      });

      // Update currency
      await Currency.findOneAndUpdate(
        { userId: recipientId },
        { $inc: currencyUpdates },
        { upsert: true }
      );

      // Get updated balances for display
      const updatedCurrency = await Currency.findOne({ userId: recipientId });
      const newBalances = Object.entries(currencyUpdates)
        .map(([curr, amt]) => {
          const newBalance = updatedCurrency[curr] || 0;
          const emoji = CURRENCY_EMOJIS[curr] || CURRENCY_EMOJIS.cosmic || '💰';
          const name = currencyNames[curr] || curr;
          return `• ${emoji} **${name}**: ${newBalance.toLocaleString()} (${amt >= 0 ? '+' : ''}${amt.toLocaleString()})`;
        })
        .join('\n');

      // Try to DM the user
      let dmSuccess = false;
      try {
        const dmChannel = await client.getDMChannel(recipientId);
        await dmChannel.createMessage({
          embeds: [{
            title: "💰 You received currency!",
            description: `An admin has gifted you:\n\n${currencyDisplay}`,
            color: 0x00FF00,
            footer: { text: "Use ?bal to check your balance!" }
          }]
        });
        dmSuccess = true;
      } catch (e) {
        console.log(`[ADMIN_CURRENCY_GIFT] DM failed for user ${recipientId}`);
      }

      // Success message
      return confirmMsg.edit({
        embeds: [{
          title: "✅ Currency Sent!",
          description: `Currency gifted to ${recipientName}\n\n**New balances:**\n${newBalances}\n\n${dmSuccess ? '✅ User notified via DM' : '⚠️ DM failed (user has DMs closed), but currency was added'}`,
          color: 0x00FF00,
          footer: { text: `Gift sent by ${msg.author.username}` }
        }]
      });

    } catch (timeoutError) {
      return confirmMsg.edit({
        embeds: [{
          title: "⏱️ Timeout",
          description: "Confirmation timed out. No currency sent.",
          color: 0xFF0000
        }],
        components: []
      });
    }
  },

  /* ========================================
     CARD UPDATE FLOW (same as before)
  ======================================== */
  async handleCardUpdate(msg, args, client) {
    const userId = msg.author.id;

    if (args.length < 2) {
      return this.sendUsageMessage(msg);
    }

    try {
      // Parse cardIds
      const cardIdsInput = args[0];
      const cardIds = this.parseCardIds(cardIdsInput);

      if (cardIds.length === 0) {
        return msg.channel.createMessage({
          content: "❌ Invalid cardId format. Use: `?admin 1,2,3 field:value` or `?admin 100-111 field:value`",
          messageReference: { messageID: msg.id }
        });
      }

      // Parse field updates
      const updates = {};
      const remainingArgs = args.slice(1).join(' ');
      const fieldMatches = remainingArgs.match(/(\w+):([^]+?)(?=\s+\w+:|$)/g);

      if (!fieldMatches || fieldMatches.length === 0) {
        return msg.channel.createMessage({
          content: `❌ No valid field updates found. Use: \`field:value\``,
          messageReference: { messageID: msg.id }
        });
      }

      for (const match of fieldMatches) {
        const colonIndex = match.indexOf(':');
        const field = match.substring(0, colonIndex).trim();
        const value = match.substring(colonIndex + 1).trim();

        if (!field || !value) {
          return msg.channel.createMessage({
            content: `❌ Invalid format: \`${match}\`. Use: \`field:value\``,
            messageReference: { messageID: msg.id }
          });
        }

        const fieldLower = field.toLowerCase();
        const allowedFields = ['name', 'group', 'rarity', 'imageurl', 'imagepath', 'spawnable'];

        if (!allowedFields.includes(fieldLower)) {
          return msg.channel.createMessage({
            content: `❌ Invalid field: \`${field}\`. Allowed: name, group, rarity, imageurl, imagepath, spawnable`,
            messageReference: { messageID: msg.id }
          });
        }

        if (fieldLower === 'spawnable') {
          updates.spawnable = value.toLowerCase() === 'true';
        } else if (fieldLower === 'imageurl') {
          updates.imageURL = value;
        } else if (fieldLower === 'imagepath') {
          updates.imagePath = value;
        } else {
          updates[fieldLower] = value;
        }
      }

      // Check existing cards
      const existingCards = await Card.countDocuments({ cardId: { $in: cardIds } });
      const existingUserCards = await User.countDocuments({ cardId: { $in: cardIds } });

      // Confirmation
      const confirmMsg = await msg.channel.createMessage({
        embeds: [{
          title: "⚠️ Confirm Card Update",
          description: `**CardIDs:** ${this.formatCardIdDisplay(cardIds)}\n**Updates:**\n${Object.entries(updates).map(([k, v]) => `• ${k}: \`${v}\``).join('\n')}\n\n**This will update:**\n• Card collection: ${existingCards} cards\n• User collection: ${existingUserCards} cards`,
          color: 0xFFAA00,
          footer: { text: "Click Confirm or Cancel (30s timeout)" }
        }],
        messageReference: { messageID: msg.id },
        components: [{
          type: 1,
          components: [
            {
              type: 2,
              style: 3,
              label: "Confirm",
              custom_id: "confirm_fix",
              emoji: { name: "✅" }
            },
            {
              type: 2,
              style: 4,
              label: "Cancel",
              custom_id: "cancel_fix",
              emoji: { name: "❌" }
            }
          ]
        }]
      });

      try {
        const interaction = await this.awaitButton(client, confirmMsg, userId, 30000);

        if (interaction.data.custom_id === 'cancel_fix') {
          await interaction.acknowledge();
          return confirmMsg.edit({
            embeds: [{
              title: "❌ Cancelled",
              description: "Card update cancelled.",
              color: 0xFF0000
            }],
            components: []
          });
        }

        await interaction.acknowledge();
        await confirmMsg.edit({
          embeds: [{
            title: "⏳ Updating...",
            description: "Please wait...",
            color: 0xFFAA00
          }],
          components: []
        });

        const result = await this.updateCards(cardIds, updates);

        return confirmMsg.edit({
          embeds: [{
            title: "✅ Update Complete",
            description: `**Card Collection:**\n• Updated: ${result.cardCount} cards\n\n**User Collection:**\n• Updated: ${result.userCount} cards\n\n**Changes Applied:**\n${Object.entries(updates).map(([k, v]) => `• ${k}: \`${v}\``).join('\n')}`,
            color: 0x00FF00,
            footer: { text: `Affected cardIDs: ${this.formatCardIdDisplay(cardIds)}` }
          }],
          components: []
        });

      } catch (timeoutError) {
        return confirmMsg.edit({
          embeds: [{
            title: "⏱️ Timeout",
            description: "Confirmation timed out. No changes made.",
            color: 0xFF0000
          }],
          components: []
        });
      }

    } catch (error) {
      console.error('[ADMIN_UPDATE_ERR]', error);
      return msg.channel.createMessage({
        content: `❌ An error occurred: ${error.message}`,
        messageReference: { messageID: msg.id }
      });
    }
  },

  /* ========================================
     HELPER FUNCTIONS
  ======================================== */
  parseCardIds(input) {
    const cardIds = [];
    const parts = input.split(',');

    for (const part of parts) {
      const trimmed = part.trim();
      
      if (trimmed.includes('-')) {
        const [start, end] = trimmed.split('-').map(n => parseInt(n.trim()));
        
        if (!isNaN(start) && !isNaN(end) && start <= end) {
          for (let i = start; i <= end; i++) {
            cardIds.push(i);
          }
        }
      } else {
        const num = parseInt(trimmed);
        if (!isNaN(num)) {
          cardIds.push(num);
        }
      }
    }

    return cardIds;
  },

  formatCardIdDisplay(cardIds) {
    if (cardIds.length <= 10) {
      return cardIds.join(', ');
    }
    return `${cardIds.slice(0, 10).join(', ')} ... (${cardIds.length} total)`;
  },

  async updateCards(cardIds, updates) {
    const cardResult = await Card.updateMany(
      { cardId: { $in: cardIds } },
      { $set: updates }
    );

    const userResult = await User.updateMany(
      { cardId: { $in: cardIds } },
      { $set: updates }
    );

    return {
      cardCount: cardResult.modifiedCount,
      userCount: userResult.modifiedCount
    };
  },

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
  },

  sendUsageMessage(msg) {
    return msg.channel.createMessage({
      embeds: [{
        title: "🔧 Admin Command Usage",
        description: "Unified admin command for card updates, pack gifting, currency gifting, and voucher management",
        fields: [
          {
            name: `💰 Currency Gifting`,
            value: `Give any currency to users:\n\n` +
                   `${CURRENCY_EMOJIS.crystals} Crystals • ${CURRENCY_EMOJIS.stardust} Stardust • ${CURRENCY_EMOJIS.astralEssence} Astral Essence\n` +
                   `${CURRENCY_EMOJIS.selca || CURRENCY_EMOJIS.cosmic} Selca (Cosmic) • 🎫 Fantasia • 💠 Reverie\n\n` +
                   "```\n" +
                   "?admin currency @user crystals:5000\n" +
                   "?admin currency @user crystals:10000 stardust:50\n" +
                   "?admin curr @user astralEssence:100 selca:5\n" +
                   "```"
          },
          {
            name: "🎫 Voucher Management",
            value: "```\n?admin voucher create CODE REWARDS expires:TIME\n?admin voucher list [active/expired/all]\n?admin voucher info CODE\n```"
          },
          {
            name: "📦 Pack Gifting",
            value: "```\n?admin give @user winter-5 x3\n?admin give @user group-focus-10 group:TWICE x5\n```"
          },
          {
            name: "🎴 Card Updates",
            value: "```\n?admin 13 group:DreamNote\n?admin 1,2,3 group:TWICE\n?admin 100-111 group:(G)I-DLE\n```"
          }
        ],
        color: 0x3498db,
        footer: { text: "All subcommands require admin permissions" }
      }],
      messageReference: { messageID: msg.id }
    });
  }
};

module.exports = adminCommand;
