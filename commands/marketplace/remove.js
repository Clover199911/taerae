// marketplace/remove.js – Listing removal handler
// Handles removing user's own listings from marketplace
// ============================================================================

const Marketplace = require("../../models/marketplace");
const User = require("../../models/user");
const { EMBED_COLORS, RARITY_EMOJIS, CONDITION_EMOJIS, MARKETPLACE_EMOJIS } = require("../../config/embedConstants");
const ConfirmationHandler = require("../marketplace/utils/confirmationHandler");
const CardGenerationService = require("../../services/CardGenerationService");

// Thumbnail dimensions for marketplace
const THUMBNAIL_DIMENSIONS = { width: 300, height: 480 };

// ============================================================================
// VALIDATION
// ============================================================================

const validateCardCode = (code) => {
  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    return { 
      valid: false, 
      error: `${MARKETPLACE_EMOJIS.error} Please provide a card code.\n\n` +
             `${MARKETPLACE_EMOJIS.tip} **Example:** \`?market remove ABC123\`\n` +
             `${MARKETPLACE_EMOJIS.help} Find your listings with \`?market view @me\``
    };
  }
  return { valid: true };
};

// ============================================================================
// REMOVE HANDLER
// ============================================================================

module.exports = {
  async execute(msg, args, client, checkRegistration) {
    // Validate card code
    const validation = validateCardCode(args[0]);
    if (!validation.valid) {
      return msg.channel.createMessage({
        embeds: [{
          title: "Invalid Input",
          description: validation.error,
          color: EMBED_COLORS.ERROR
        }],
        messageReference: { messageID: msg.id }
      });
    }

    const cardCode = args[0];
    const userId = msg.author.id;

    try {
      // Find the listing and card details
      const [listing, cardDetails] = await Promise.all([
        Marketplace.findOne({ code: cardCode, sellerId: userId }).lean(),
        User.findOne({ cardCode }).lean()
      ]);

      // Validation checks
      if (!listing) {
        // Check if listing exists at all
        const anyListing = await Marketplace.findOne({ code: cardCode }).lean();
        
        if (anyListing) {
          return msg.channel.createMessage({
            embeds: [{
              title: `${MARKETPLACE_EMOJIS.error} Not Your Listing`,
              description: 
                `This card is listed by someone else.\n\n` +
                `${MARKETPLACE_EMOJIS.tip} **You can only remove your own listings!**\n` +
                `View your listings: \`?market view <@${userId}>\``,
              color: EMBED_COLORS.ERROR
            }],
            messageReference: { messageID: msg.id }
          });
        }

        return msg.channel.createMessage({
          embeds: [{
            title: `${MARKETPLACE_EMOJIS.error} Not Listed`,
            description: 
              `Card \`${cardCode}\` is not on the marketplace.\n\n` +
              `${MARKETPLACE_EMOJIS.tip} **Check:**\n` +
              `• The code is correct\n` +
              `• You have it listed (\`?market view <@${userId}>\`)\n` +
              `• It hasn't been bought already`,
            color: EMBED_COLORS.ERROR
          }],
          messageReference: { messageID: msg.id }
        });
      }

      if (!cardDetails) {
        // Listing exists but card not found (shouldn't happen, but handle it)
        return msg.channel.createMessage({
          embeds: [{
            title: `${MARKETPLACE_EMOJIS.error} Card Error`,
            description: 
              `Could not find card details.\n\n` +
              `${MARKETPLACE_EMOJIS.tip} Contact support - this shouldn't happen!`,
            color: EMBED_COLORS.ERROR
          }],
          messageReference: { messageID: msg.id }
        });
      }

      // Format card display with print number
      const conditionEmoji = CONDITION_EMOJIS[cardDetails.condition.toLowerCase()] || '';
      const rarityStars = RARITY_EMOJIS[cardDetails.rarity.toLowerCase()] || '☆☆☆☆';
      const printInfo = cardDetails.printNumber ? `#${cardDetails.printNumber}` : '';
      const cardLine = `${conditionEmoji} ${rarityStars} **${cardDetails.group} ${cardDetails.name}** [${printInfo}] – \`${cardCode}\``;

      // Process thumbnail with condition overlay
      let thumbnailBuffer = null;
      try {
        const overlayPromise = cardDetails.condition && cardDetails.condition.toLowerCase() !== 'good'
          ? CardGenerationService.preloadOverlay(cardDetails.group, cardDetails.rarity, cardDetails.condition, cardDetails.cardId)
          : Promise.resolve(null);

        thumbnailBuffer = await CardGenerationService.processCardImage(
          cardDetails,
          cardDetails.condition,
          overlayPromise
        );
      } catch (imgError) {
        console.error("Thumbnail processing failed:", imgError.message);
      }

      // Show confirmation
      const confirmation = new ConfirmationHandler(
        client,
        msg,
        {
          title: `${MARKETPLACE_EMOJIS.remove} Confirm Removal`,
          description: 
            `${cardLine}\n\n` +
            `${MARKETPLACE_EMOJIS.crystal} **Listed Price:** ${listing.amount.toLocaleString()} crystals\n\n` +
            `Remove this listing from the marketplace?\n\n` +
            `${MARKETPLACE_EMOJIS.tip} You can relist it anytime!`,
          color: EMBED_COLORS.DEFAULT,
          thumbnail: { url: 'attachment://thumbnail.png' }
        },
        async () => {
          // Remove listing
          await Marketplace.deleteOne({ _id: listing._id });

          return {
            embeds: [{
              title: `${MARKETPLACE_EMOJIS.success} Listing Removed`,
              description: 
                `${cardLine}\n\n` +
                `Removed from marketplace successfully!\n\n` +
                `${MARKETPLACE_EMOJIS.tip} **Relist it:** \`?market sell ${cardCode} <price>\``,
              color: 0x57F287,
              thumbnail: { url: 'attachment://thumbnail.png' }
            }],
            file: thumbnailBuffer ? { file: thumbnailBuffer, name: 'thumbnail.png' } : undefined
          };
        },
        thumbnailBuffer
      );

      await confirmation.show();

    } catch (error) {
      console.error("Remove error:", error);
      return msg.channel.createMessage({
        embeds: [{
          title: `${MARKETPLACE_EMOJIS.error} Removal Failed`,
          description: 
            `${error.message || "An unexpected error occurred."}\n\n` +
            `${MARKETPLACE_EMOJIS.tip} **What to do:**\n` +
            `• Try again\n` +
            `• Check if it's still listed\n` +
            `• Contact support if this continues`,
          color: EMBED_COLORS.ERROR
        }],
        messageReference: { messageID: msg.id }
      });
    }
  }
};