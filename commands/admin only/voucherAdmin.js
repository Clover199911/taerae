// commands/admin/voucherAdmin.js
const Voucher = require('../../models/voucher');
const { ADMIN_IDS, isAdmin } = require('../../config/constants');
const { 
  parseRewards, 
  parseExpiration, 
  validatePackGroups,
  formatRewardsDisplay,
  formatExpirationDisplay
} = require('../../utils/voucherUtils');

const voucherAdminCommand = {
  name: "voucher-admin",
  description: "Admin voucher management (called from admin.js)",

  /* ========================================
     CREATE VOUCHER
  ======================================== */
  async handleCreate(msg, args) {
    if (args.length < 2) {
      return msg.channel.createMessage({
        content: "❌ Usage: `?admin voucher create CODE REWARDS expires:TIME [limit:NUM]`\n\n" +
                 "**Examples:**\n" +
                 "```\n" +
                 "?admin voucher create WINTER2026 pack:winter-5:3,crystals:5000 expires:7d limit:100\n" +
                 "?admin voucher create GROUPGIFT pack:group-focus-10:2:TWICE,essence:50 expires:24h\n" +
                 "?admin voucher create CARDPACK cards:5:Mythic:pristine,crystals:1000 expires:3d limit:50\n" +
                 "```\n\n" +
                 "**Reward formats:**\n" +
                 "• `pack:TYPE:QTY` or `pack:TYPE:QTY:GROUP`\n" +
                 "• `crystals:AMOUNT`, `essence:AMOUNT`, `stardust:AMOUNT`\n" +
                 "• `cards:QTY` or `cards:QTY:RARITY:CONDITION:GROUP`",
        messageReference: { messageID: msg.id }
      });
    }

    const code = args[0];
    
    // Check if code already exists
    const existing = await Voucher.findOne({ code });
    if (existing) {
      return msg.channel.createMessage({
        content: `❌ Voucher code \`${code}\` already exists.`,
        messageReference: { messageID: msg.id }
      });
    }

    // Find expires and limit parameters
    let rewardString = '';
    let expiresString = null;
    let limitString = null;

    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg.toLowerCase().startsWith('expires:')) {
        expiresString = arg.substring(8);
      } else if (arg.toLowerCase().startsWith('limit:')) {
        limitString = arg.substring(6);
      } else {
        rewardString += (rewardString ? ' ' : '') + arg;
      }
    }

    if (!expiresString) {
      return msg.channel.createMessage({
        content: "❌ Missing `expires:TIME` parameter (e.g., expires:7d)",
        messageReference: { messageID: msg.id }
      });
    }

    try {
      // Parse rewards
      const rewards = parseRewards(rewardString);
      
      // Parse expiration
      const expiresAt = parseExpiration(expiresString);

      // Parse limit
      let maxClaims = null;
      if (limitString) {
        maxClaims = parseInt(limitString);
        if (isNaN(maxClaims) || maxClaims < 1) {
          return msg.channel.createMessage({
            content: "❌ Invalid limit value. Must be a positive number.",
            messageReference: { messageID: msg.id }
          });
        }
      }

      // Validate group-focused packs
      const groupErrors = await validatePackGroups(rewards.packs);
      if (groupErrors.length > 0) {
        return msg.channel.createMessage({
          content: `❌ **Group validation failed:**\n${groupErrors.map(e => `• ${e}`).join('\n')}`,
          messageReference: { messageID: msg.id }
        });
      }

      // Create confirmation message
      const confirmMsg = await msg.channel.createMessage({
        embeds: [{
          title: "🎫 Confirm Voucher Creation",
          description: `**Code:** \`${code}\`\n\n` +
                       `${formatRewardsDisplay(rewards)}\n\n` +
                       `**Expires:** ${formatExpirationDisplay(expiresAt)}\n` +
                       `**Max Claims:** ${maxClaims === null ? 'Unlimited' : maxClaims.toLocaleString()}`,
          color: 0xFFAA00,
          footer: { text: "Click Confirm to create this voucher" }
        }],
        messageReference: { messageID: msg.id },
        components: [{
          type: 1,
          components: [
            {
              type: 2,
              style: 3,
              label: "Confirm",
              custom_id: "confirm_voucher_create",
              emoji: { name: "✅" }
            },
            {
              type: 2,
              style: 4,
              label: "Cancel",
              custom_id: "cancel_voucher_create",
              emoji: { name: "❌" }
            }
          ]
        }]
      });

      // Wait for confirmation
      try {
        const interaction = await this.awaitButton(msg._client, confirmMsg, msg.author.id, 30000);

        if (interaction.data.custom_id === 'cancel_voucher_create') {
          await interaction.acknowledge();
          return confirmMsg.edit({
            embeds: [{
              title: "❌ Cancelled",
              description: "Voucher creation cancelled.",
              color: 0xFF0000
            }],
            components: []
          });
        }

        // Create voucher
        await interaction.acknowledge();
        
        const voucher = await Voucher.create({
          code,
          createdBy: msg.author.id,
          expiresAt,
          maxClaims,
          rewards
        });

        return confirmMsg.edit({
          embeds: [{
            title: "✅ Voucher Created!",
            description: `**Code:** \`${code}\`\n\n` +
                         `${formatRewardsDisplay(rewards)}\n\n` +
                         `**Expires:** ${formatExpirationDisplay(expiresAt)}\n` +
                         `**Max Claims:** ${maxClaims === null ? 'Unlimited' : maxClaims.toLocaleString()}\n\n` +
                         `Users can claim with: \`?claim ${code}\``,
            color: 0x00FF00,
            footer: { text: `Voucher ID: ${voucher._id}` }
          }],
          components: []
        });

      } catch (timeoutError) {
        return confirmMsg.edit({
          embeds: [{
            title: "⏱️ Timeout",
            description: "Voucher creation timed out.",
            color: 0xFF0000
          }],
          components: []
        });
      }

    } catch (error) {
      console.error('[VOUCHER_CREATE_ERR]', error);
      return msg.channel.createMessage({
        content: `❌ Error creating voucher: ${error.message}`,
        messageReference: { messageID: msg.id }
      });
    }
  },

  /* ========================================
     LIST VOUCHERS
  ======================================== */
  async handleList(msg, args) {
    const filter = args[0]?.toLowerCase() || 'active';
    
    let query = {};
    if (filter === 'active') {
      query = { isActive: true, expiresAt: { $gt: new Date() } };
    } else if (filter === 'expired') {
      query = { $or: [{ isActive: false }, { expiresAt: { $lte: new Date() } }] };
    }
    // 'all' = no filter

    const vouchers = await Voucher.find(query)
      .sort({ createdAt: -1 })
      .limit(25)
      .lean();

    if (vouchers.length === 0) {
      return msg.channel.createMessage({
        embeds: [{
          title: "🎫 Vouchers",
          description: `No ${filter} vouchers found.`,
          color: 0x95A5A6
        }],
        messageReference: { messageID: msg.id }
      });
    }

    const fields = vouchers.slice(0, 10).map(v => {
      const status = v.isActive && v.expiresAt > new Date() ? '🟢' : '🔴';
      const claims = v.maxClaims === null 
        ? `${v.claimedBy.length} claims` 
        : `${v.claimedBy.length}/${v.maxClaims} claims`;
      
      return {
        name: `${status} \`${v.code}\``,
        value: `Claims: ${claims}\nExpires: <t:${Math.floor(v.expiresAt.getTime() / 1000)}:R>`,
        inline: true
      };
    });

    return msg.channel.createMessage({
      embeds: [{
        title: `🎫 ${filter.charAt(0).toUpperCase() + filter.slice(1)} Vouchers`,
        description: `Showing ${Math.min(vouchers.length, 10)} of ${vouchers.length} vouchers`,
        fields,
        color: 0x3498DB,
        footer: { text: `Use ?admin voucher info CODE for details` }
      }],
      messageReference: { messageID: msg.id }
    });
  },

  /* ========================================
     VOUCHER INFO
  ======================================== */
  async handleInfo(msg, args) {
    if (args.length === 0) {
      return msg.channel.createMessage({
        content: "❌ Usage: `?admin voucher info CODE`",
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

    const status = voucher.isActive && voucher.expiresAt > new Date() ? '🟢 Active' : '🔴 Inactive/Expired';
    const claims = voucher.maxClaims === null 
      ? `${voucher.claimedBy.length} (Unlimited)` 
      : `${voucher.claimedBy.length}/${voucher.maxClaims}`;

    return msg.channel.createMessage({
      embeds: [{
        title: `🎫 Voucher: \`${code}\``,
        description: `**Status:** ${status}\n` +
                     `**Claims:** ${claims}\n` +
                     `**Created:** <t:${Math.floor(voucher.createdAt.getTime() / 1000)}:F>\n` +
                     `**Expires:** ${formatExpirationDisplay(voucher.expiresAt)}\n\n` +
                     `${formatRewardsDisplay(voucher.rewards)}`,
        color: voucher.isActive && voucher.expiresAt > new Date() ? 0x00FF00 : 0xFF0000,
        footer: { text: `Created by ${voucher.createdBy} • ID: ${voucher._id}` }
      }],
      messageReference: { messageID: msg.id }
    });
  },

  /* ========================================
     DELETE VOUCHER
  ======================================== */
  async handleDelete(msg, args) {
    if (args.length === 0) {
      return msg.channel.createMessage({
        content: "❌ Usage: `?admin voucher delete CODE`",
        messageReference: { messageID: msg.id }
      });
    }

    const code = args[0];
    const voucher = await Voucher.findOne({ code });

    if (!voucher) {
      return msg.channel.createMessage({
        content: `❌ Voucher \`${code}\` not found.`,
        messageReference: { messageID: msg.id }
      });
    }

    // Confirmation
    const confirmMsg = await msg.channel.createMessage({
      embeds: [{
        title: "⚠️ Confirm Deletion",
        description: `**Code:** \`${code}\`\n` +
                     `**Claims:** ${voucher.claimedBy.length}${voucher.maxClaims ? `/${voucher.maxClaims}` : ''}\n\n` +
                     `This action cannot be undone!`,
        color: 0xFF0000,
        footer: { text: "Click Confirm to delete this voucher" }
      }],
      messageReference: { messageID: msg.id },
      components: [{
        type: 1,
        components: [
          {
            type: 2,
            style: 4,
            label: "Confirm Delete",
            custom_id: "confirm_voucher_delete",
            emoji: { name: "🗑️" }
          },
          {
            type: 2,
            style: 2,
            label: "Cancel",
            custom_id: "cancel_voucher_delete",
            emoji: { name: "❌" }
          }
        ]
      }]
    });

    try {
      const interaction = await this.awaitButton(msg._client, confirmMsg, msg.author.id, 30000);

      if (interaction.data.custom_id === 'cancel_voucher_delete') {
        await interaction.acknowledge();
        return confirmMsg.edit({
          embeds: [{
            title: "❌ Cancelled",
            description: "Voucher deletion cancelled.",
            color: 0xFF0000
          }],
          components: []
        });
      }

      await interaction.acknowledge();
      await Voucher.deleteOne({ code });

      return confirmMsg.edit({
        embeds: [{
          title: "✅ Voucher Deleted",
          description: `Voucher \`${code}\` has been deleted.`,
          color: 0x00FF00
        }],
        components: []
      });

    } catch (timeoutError) {
      return confirmMsg.edit({
        embeds: [{
          title: "⏱️ Timeout",
          description: "Deletion cancelled due to timeout.",
          color: 0xFF0000
        }],
        components: []
      });
    }
  },

  /* ========================================
     VOUCHER CLAIMS
  ======================================== */
  async handleClaims(msg, args) {
    if (args.length === 0) {
      return msg.channel.createMessage({
        content: "❌ Usage: `?admin voucher claims CODE`",
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

    if (voucher.claimedBy.length === 0) {
      return msg.channel.createMessage({
        embeds: [{
          title: `🎫 Claims for \`${code}\``,
          description: "No claims yet.",
          color: 0x95A5A6
        }],
        messageReference: { messageID: msg.id }
      });
    }

    const claimsList = voucher.claimedBy.slice(0, 25).map((userId, i) => {
      return `${i + 1}. <@${userId}>`;
    }).join('\n');

    const remaining = voucher.claimedBy.length > 25 ? `\n...and ${voucher.claimedBy.length - 25} more` : '';

    return msg.channel.createMessage({
      embeds: [{
        title: `🎫 Claims for \`${code}\``,
        description: `**Total Claims:** ${voucher.claimedBy.length}${voucher.maxClaims ? `/${voucher.maxClaims}` : ''}\n\n${claimsList}${remaining}`,
        color: 0x3498DB,
        footer: { text: `Showing up to 25 claims` }
      }],
      messageReference: { messageID: msg.id }
    });
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

module.exports = voucherAdminCommand;