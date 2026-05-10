// marketplace/buy.js – Card purchase handler
// Handles buying cards from the marketplace with confirmation
// ============================================================================

const Marketplace = require("../../models/marketplace");
const Currency = require("../../models/currency");
const User = require("../../models/user");
const { EMBED_COLORS, RARITY_EMOJIS, CONDITION_EMOJIS, MARKETPLACE_EMOJIS } = require("../../config/embedConstants");
const ConfirmationHandler = require("../marketplace/utils/confirmationHandler");
const { sendSellerNotification, sendGuildNotification } = require("../marketplace/utils/notifications");
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
             `${MARKETPLACE_EMOJIS.tip} **Example:** \`?market buy ABC123\`\n` +
             `${MARKETPLACE_EMOJIS.help} Find codes with \`?market view\``
    };
  }
  return { valid: true };
};

// ============================================================================
// BUY HANDLER
// ============================================================================

module.exports = {
  async execute(msg, args, client, checkRegistration) {
    // Validate card code input
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

    // Check registration
    if (!await checkRegistration(msg.author.id, msg, client)) return;

    const cardCode = args[0];
    const buyerId = msg.author.id;

    try {
      // Fetch listing and buyer currency in parallel for performance
      const [listing, buyerCurrency, cardDetails] = await Promise.all([
        Marketplace.findOne({ code: cardCode }).lean(),
        Currency.findOne({ userId: buyerId }).lean(),
        User.findOne({ cardCode }).lean()
      ]);

      // Validation checks
      if (!listing) {
        return msg.channel.createMessage({
          embeds: [{
            title: `${MARKETPLACE_EMOJIS.error} Not Listed`,
            description: 
              `Card \`${cardCode}\` is not on the marketplace.\n\n` +
              `${MARKETPLACE_EMOJIS.tip} **What to try:**\n` +
              `• Check the code is correct\n` +
              `• Browse with \`?market view\`\n` +
              `• Search for it: \`?market <card name>\``,
            color: EMBED_COLORS.ERROR
          }],
          messageReference: { messageID: msg.id }
        });
      }

      if (!buyerCurrency) {
        return msg.channel.createMessage({
          embeds: [{
            title: `${MARKETPLACE_EMOJIS.error} No Currency`,
            description: 
              `You don't have any crystals yet!\n\n` +
              `${MARKETPLACE_EMOJIS.tip} **How to earn:**\n` +
              `• Complete daily tasks\n` +
              `• Participate in events\n` +
              `• Trade with other players`,
            color: EMBED_COLORS.ERROR
          }],
          messageReference: { messageID: msg.id }
        });
      }

      if (listing.sellerId === buyerId) {
        return msg.channel.createMessage({
          embeds: [{
            title: `${MARKETPLACE_EMOJIS.warning} Your Own Listing`,
            description: 
              `You can't buy your own card!\n\n` +
              `${MARKETPLACE_EMOJIS.tip} **Want to remove it?**\n` +
              `Use \`?market remove ${cardCode}\``,
            color: EMBED_COLORS.ERROR
          }],
          messageReference: { messageID: msg.id }
        });
      }

      if (buyerCurrency.crystals < listing.amount) {
        const needed = listing.amount - buyerCurrency.crystals;
        return msg.channel.createMessage({
          embeds: [{
            title: `${MARKETPLACE_EMOJIS.error} Insufficient Funds`,
            description: 
              `**Required:** ${listing.amount.toLocaleString()} ${MARKETPLACE_EMOJIS.crystal}\n` +
              `**You have:** ${buyerCurrency.crystals.toLocaleString()} ${MARKETPLACE_EMOJIS.crystal}\n` +
              `**Need:** ${needed.toLocaleString()} ${MARKETPLACE_EMOJIS.crystal} more\n\n` +
              `${MARKETPLACE_EMOJIS.tip} Keep earning crystals and come back!`,
            color: EMBED_COLORS.ERROR
          }],
          messageReference: { messageID: msg.id }
        });
      }

      // Format card display line with print number
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

      // Show confirmation dialog
      const confirmation = new ConfirmationHandler(
        client,
        msg,
        {
          title: `Confirm Purchase`,
          description: 
            `${cardLine}\n\n` +
            `${MARKETPLACE_EMOJIS.crystal} **Price:** ${listing.amount.toLocaleString()} crystals\n` +
            `${MARKETPLACE_EMOJIS.crystal} **Your Balance:** ${buyerCurrency.crystals.toLocaleString()} crystals\n` +
            `${MARKETPLACE_EMOJIS.crystal} **After Purchase:** ${(buyerCurrency.crystals - listing.amount).toLocaleString()} crystals`,
          color: EMBED_COLORS.DEFAULT,
          thumbnail: { url: 'attachment://thumbnail.png' }
        },
        async () => {
          // Re-validate before transaction (prevent race conditions)
          const [currentListing, currentBuyerCurrency] = await Promise.all([
            Marketplace.findOne({ code: cardCode, sellerId: listing.sellerId }).lean(),
            Currency.findOne({ userId: buyerId }).lean()
          ]);

          if (!currentListing) {
            throw new Error("This listing is no longer available (someone else may have bought it)");
          }

          if (currentBuyerCurrency.crystals < listing.amount) {
            throw new Error("You no longer have enough crystals");
          }

          // Execute atomic transaction
          await Promise.all([
            Currency.updateOne({ userId: buyerId }, { $inc: { crystals: -listing.amount } }),
            Currency.updateOne({ userId: listing.sellerId }, { $inc: { crystals: listing.amount } }),
            User.findOneAndUpdate({ cardCode }, { discordId: buyerId }),
            Marketplace.deleteOne({ _id: listing._id })
          ]);

          // Send notifications (non-blocking)
          Promise.all([
            sendSellerNotification(client, listing, listing.amount),
            sendGuildNotification(client, listing, buyerId, listing.amount)
          ]).catch(err => console.error("Notification error:", err));

          return {
            embeds: [{
              title: `${MARKETPLACE_EMOJIS.success} Purchase Complete!`,
              description: 
                `### ${cardLine}\n\n` +
                `Successfully purchased for **${listing.amount.toLocaleString()}** ${MARKETPLACE_EMOJIS.crystal}\n\n` +
                `-# The card has been added to your cabinet.`,
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
      console.error("Buy error:", error);
      return msg.channel.createMessage({
        embeds: [{
          title: `${MARKETPLACE_EMOJIS.error} Purchase Failed`,
          description: 
            `${error.message || "An unexpected error occurred."}\n\n` +
            `${MARKETPLACE_EMOJIS.tip} **What to do:**\n` +
            `• Try again\n` +
            `• Check your balance with \`?balance\`\n` +
            `• Contact support if this continues`,
          color: EMBED_COLORS.ERROR
        }],
        messageReference: { messageID: msg.id }
      });
    }
  }
};