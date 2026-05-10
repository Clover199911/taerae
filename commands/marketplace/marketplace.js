// marketplace.js – Main marketplace command handler
// Handles routing to buy/sell/remove/view subcommands
// ============================================================================

const Graphic = require("../../models/graphic");
const { EMBED_COLORS, MARKETPLACE_EMOJIS } = require("../../config/embedConstants");
const buyHandler = require("../marketplace/buy");
const sellHandler = require("../marketplace/sell");
const removeHandler = require("../marketplace/remove");
const viewHandler = require("../marketplace/view");
const notifyHandler = require("../marketplace/notify");

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Creates a standardized error embed
 */
const createErrorEmbed = (description, title = "Error") => ({
  title: `${MARKETPLACE_EMOJIS.error} ${title}`,
  description,
  color: EMBED_COLORS.ERROR
});

/**
 * Checks if user is registered before allowing marketplace access
 */
const checkRegistration = async (userId, msg, client) => {
  const isRegistered = await Graphic.exists({ userId, isRegistered: true });
  
  if (!isRegistered) {
    await client.createMessage(msg.channel.id, {
      embeds: [{
        title: `${MARKETPLACE_EMOJIS.locked} Registration Required`,
        description: "You must register using `?register` before accessing the marketplace.\n\n" +
                     `${MARKETPLACE_EMOJIS.tip} **Tip:** Registration is quick and unlocks all marketplace features!`,
        color: EMBED_COLORS.ERROR
      }],
      messageReference: { messageID: msg.id }
    });
    return false;
  }
  
  return true;
};

// ============================================================================
// MAIN COMMAND
// ============================================================================

module.exports = {
  name: "marketplace",
  description: "Buy, sell, or browse cards on the marketplace",
  aliases: ["market", "mp"],
  
  async execute(msg, args, client) {
    try {
      // If no args OR first arg looks like a search term, default to view
      if (args.length === 0 || !this.isValidSubcommand(args[0])) {
        // Pass all args to view (they're search terms)
        return viewHandler.execute(msg, args, client);
      }

      const subcommand = args.shift().toLowerCase();
      
      // Show help if explicitly requested
      if (subcommand === "help" || subcommand === "?") {
        return this.showHelp(msg, client);
      }

      // Route to appropriate handler
      switch (subcommand) {
        case "buy":
          await buyHandler.execute(msg, args, client, checkRegistration);
          break;
        case "sell":
          await sellHandler.execute(msg, args, client, checkRegistration);
          break;
        case "remove":
          await removeHandler.execute(msg, args, client, checkRegistration);
          break;
        case "view":
        case "browse":
          await viewHandler.execute(msg, args, client);
          break;
        case "notify":
        case "notif":
          await notifyHandler.execute(msg, args, client, checkRegistration);
          break;
        default:
          return msg.channel.createMessage({
            embeds: [createErrorEmbed(
              `Unknown command: \`${subcommand}\`\n\n` +
              `${MARKETPLACE_EMOJIS.tip} **Did you mean:**\n` +
              `• \`?market view ${subcommand}\` - Search for "${subcommand}"\n` +
              `• \`?market help\` - Show all commands`,
              "Unknown Command"
            )],
            messageReference: { messageID: msg.id }
          });
      }
      
    } catch (error) {
      console.error("Marketplace error:", error);
      msg.channel.createMessage({
        embeds: [createErrorEmbed(
          "An unexpected error occurred. Please try again later.\n\n" +
          `${MARKETPLACE_EMOJIS.tip} If this persists, contact a server admin.`
        )],
        messageReference: { messageID: msg.id }
      });
    }
  },

  /**
   * Checks if the argument is a valid subcommand
   */
  isValidSubcommand(arg) {
    const validCommands = ["buy", "sell", "remove", "view", "browse", "notify", "notif", "help", "?"];
    return validCommands.includes(arg.toLowerCase());
  },

  /**
   * Shows the help menu
   */
  async showHelp(msg, client) {
    return msg.channel.createMessage({
      embeds: [{
        title: `${MARKETPLACE_EMOJIS.marketplace} Marketplace Commands`,
        description: 
          `${MARKETPLACE_EMOJIS.tip} **Quick Start:** Just type \`?market\` to browse!\n\n` +
          "**Commands:**\n" +
          `${MARKETPLACE_EMOJIS.view} \`view [filters]\` - Browse marketplace listings\n` +
          `${MARKETPLACE_EMOJIS.buy} \`buy <code>\` - Purchase a card\n` +
          `${MARKETPLACE_EMOJIS.sell} \`sell <code> <price>\` - List a card for sale\n` +
          `${MARKETPLACE_EMOJIS.remove} \`remove <code>\` - Remove your listing\n` +
          `${MARKETPLACE_EMOJIS.notify} \`notify <term>\` - Get alerts for new listings\n\n` +
          
          "**View Filters:** (same as cabinet)\n" +
          `${MARKETPLACE_EMOJIS.search} Search: \`?market dreamcatcher jiu\`\n` +
          `${MARKETPLACE_EMOJIS.filter} Filter: \`?market mythic\`\n` +
          `${MARKETPLACE_EMOJIS.exclude} Exclude: \`?market -standard\`\n` +
          `${MARKETPLACE_EMOJIS.user} By user: \`?market @user\`\n` +
          `${MARKETPLACE_EMOJIS.print} By print: \`?market p#123\`\n\n` +
          
          "**Examples:**\n" +
          `${MARKETPLACE_EMOJIS.example} \`?market\` - View all listings\n` +
          `${MARKETPLACE_EMOJIS.example} \`?market dreamcatcher\` - Search Dreamcatcher\n` +
          `${MARKETPLACE_EMOJIS.example} \`?market buy ABC123\` - Buy a card\n` +
          `${MARKETPLACE_EMOJIS.example} \`?market sell ABC123 5000\` - List for 5000 crystals`,
        color: EMBED_COLORS.DEFAULT,
        footer: { text: "💡 Tip: You can skip 'view' - just type your search directly!" }
      }],
      messageReference: { messageID: msg.id }
    });
  }
};