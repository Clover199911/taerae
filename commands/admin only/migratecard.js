// migrateCardTag.js - One-time migration script to add cardTag field to existing cards
const User = require("../../models/user");
const { EMBED_COLORS } = require('../../config/embedConstants');

const COLLECTOR_TIMEOUT = 30000; // 30 seconds
const activeCollectors = new Map();

module.exports = {
  name: "migrate-cardtag",
  description: "Add cardTag field to all existing cards (Admin only)",
  
  async execute(msg, args, client) {
    // Optional: Add admin check here
    // const adminIds = ['YOUR_ADMIN_ID_HERE'];
    // if (!adminIds.includes(msg.author.id)) {
    //   return msg.channel.createMessage("❌ This command is admin-only.");
    // }

    const components = [{
      type: 1,
      components: [
        {
          type: 2,
          style: 3,
          custom_id: 'confirm_migration',
          label: 'Confirm Migration',
          emoji: { name: '✅' }
        },
        {
          type: 2,
          style: 4,
          custom_id: 'cancel_migration',
          label: 'Cancel',
          emoji: { name: '❌' }
        }
      ]
    }];

    const message = await client.createMessage(msg.channel.id, {
      embeds: [{
        title: "⚠️ Database Migration",
        description: "This will add the `cardTag` field to all existing cards in the database.\n" +
                     "Cards without tags will have `cardTag: null`.\n\n" +
                     "**This is safe to run and won't affect existing data.**",
        color: EMBED_COLORS.DEFAULT,
        footer: { text: "Click Confirm to proceed or Cancel to abort" }
      }],
      components,
      messageReference: { messageID: msg.id }
    });

    this.setupInteractionHandler(client, message, msg.author.id);
  },

  setupInteractionHandler(client, message, authorId) {
    const existing = activeCollectors.get(message.id);
    if (existing) {
      client.removeListener('interactionCreate', existing.handler);
      clearTimeout(existing.timeout);
    }

    const handler = async (interaction) => {
      if (interaction.message.id !== message.id || interaction.member?.id !== authorId) return;

      try {
        await interaction.defer();

        if (interaction.data.custom_id === 'cancel_migration') {
          await interaction.editParent({
            embeds: [{
              title: "❌ Migration Cancelled",
              description: "No changes were made to the database.",
              color: EMBED_COLORS.ERROR || 0xff0000
            }],
            components: []
          });

          activeCollectors.delete(message.id);
          client.removeListener('interactionCreate', handler);
          return;
        }

        // Perform migration
        await interaction.editParent({
          embeds: [{
            title: "🔄 Running Migration",
            description: "Please wait... This may take a moment for large databases.",
            color: EMBED_COLORS.DEFAULT
          }],
          components: []
        });

        const result = await User.updateMany(
          { cardTag: { $exists: false } },
          { $set: { cardTag: null } }
        );

        await interaction.editParent({
          embeds: [{
            title: "✅ Migration Complete",
            description: `• **${result.matchedCount}** cards found without cardTag field\n` +
                        `• **${result.modifiedCount}** cards updated\n\n` +
                        `All cards now have the cardTag field (set to null by default).`,
            color: EMBED_COLORS.SUCCESS || 0x00ff00,
            footer: { text: "You can now use the ?tag command!" }
          }]
        });

        activeCollectors.delete(message.id);
        client.removeListener('interactionCreate', handler);

      } catch (error) {
        console.error('Migration error:', error);
        try {
          await interaction.editParent({
            embeds: [{
              title: "❌ Migration Failed",
              description: "An error occurred during migration. Please check logs.",
              color: EMBED_COLORS.ERROR || 0xff0000
            }],
            components: []
          });
        } catch (e) {
          console.error('Failed to send error message:', e);
        }
      }
    };

    const timeout = setTimeout(() => {
      activeCollectors.delete(message.id);
      client.removeListener('interactionCreate', handler);
      message.edit({
        embeds: [{
          title: "⏱️ Migration Timed Out",
          description: "No response received. Please run the command again.",
          color: EMBED_COLORS.ERROR || 0xff0000
        }],
        components: []
      }).catch(() => {});
    }, COLLECTOR_TIMEOUT);

    activeCollectors.set(message.id, { handler, timeout });
    client.on('interactionCreate', handler);
  }
};