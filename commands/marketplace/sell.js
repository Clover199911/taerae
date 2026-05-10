// marketplace/sell.js – Card listing handler
// Handles creating marketplace listings with validation
// ============================================================================

const Marketplace = require("../../models/marketplace");
const User = require("../../models/user");
const { EMBED_COLORS, RARITY_EMOJIS, CONDITION_EMOJIS, MARKETPLACE_EMOJIS } = require("../../config/embedConstants");
const ConfirmationHandler = require("../marketplace/utils/confirmationHandler");
const { sendListingNotifications } = require("../marketplace/utils/notificationSender");
const CardGenerationService = require("../../services/CardGenerationService");

// Thumbnail dimensions for marketplace
const THUMBNAIL_DIMENSIONS = { width: 300, height: 480 };

// ============================================================================
// VALIDATION
// ============================================================================

const validateInput = {
  cardCode: (code) => {
    if (!code || typeof code !== 'string' || code.trim().length === 0) {
      return { 
        valid: false, 
        error: `${MARKETPLACE_EMOJIS.error} Please provide a card code.\n\n` +
               `${MARKETPLACE_EMOJIS.tip} **Example:** \`?market sell ABC123 5000\`\n` +
               `${MARKETPLACE_EMOJIS.help} Find codes in \`?cabinet\``
      };
    }
    return { valid: true };
  },

  price: (price) => {
    if (!price) {
      return { 
        valid: false, 
        error: `${MARKETPLACE_EMOJIS.error} Please provide a price.\n\n` +
               `${MARKETPLACE_EMOJIS.tip} **Example:** \`?market sell ABC123 5000\`\n` +
               `${MARKETPLACE_EMOJIS.help} Price must be in crystals (whole number)`
      };
    }

    const numPrice = parseFloat(price);
    
    if (isNaN(numPrice) || numPrice <= 0) {
      return { 
        valid: false, 
        error: `${MARKETPLACE_EMOJIS.error} Price must be a positive number.\n\n` +
               `${MARKETPLACE_EMOJIS.tip} **Example:** \`?market sell ABC123 5000\``
      };
    }
    
    if (numPrice > 1000000) {
      return { 
        valid: false, 
        error: `${MARKETPLACE_EMOJIS.error} Maximum price is 1,000,000 crystals.\n\n` +
               `${MARKETPLACE_EMOJIS.tip} Try a lower price!`
      };
    }
    
    // Ensure whole numbers only
    if (!Number.isInteger(numPrice)) {
      return { 
        valid: false, 
        error: `${MARKETPLACE_EMOJIS.error} Price must be a whole number (no decimals).\n\n` +
               `${MARKETPLACE_EMOJIS.tip} **Example:** \`5000\` not \`5000.50\``
      };
    }
    
    return { valid: true, value: numPrice };
  }
};

// ============================================================================
// SELL HANDLER
// ============================================================================

module.exports = {
  async execute(msg, args, client, checkRegistration) {
    // Validate inputs
    const codeValidation = validateInput.cardCode(args[0]);
    const priceValidation = validateInput.price(args[1]);

    if (!codeValidation.valid) {
      return msg.channel.createMessage({
        embeds: [{
          title: "Invalid Card Code",
          description: codeValidation.error,
          color: EMBED_COLORS.ERROR
        }],
        messageReference: { messageID: msg.id }
      });
    }

    if (!priceValidation.valid) {
      return msg.channel.createMessage({
        embeds: [{
          title: "Invalid Price",
          description: priceValidation.error,
          color: EMBED_COLORS.ERROR
        }],
        messageReference: { messageID: msg.id }
      });
    }

    // Check registration
    if (!await checkRegistration(msg.author.id, msg, client)) return;

    const userId = msg.author.id;
    const cardCode = args[0];
    const price = priceValidation.value;

    try {
      // Check ownership and existing listings in parallel
      const [cardDetails, existingListing] = await Promise.all([
        User.findOne({ discordId: userId, cardCode })
          .select('name group rarity imageURL condition printNumber cardLocked cardCode')
          .lean(),
        Marketplace.findOne({ code: cardCode }).lean()
      ]);

      // Validation checks
      if (!cardDetails) {
        return msg.channel.createMessage({
          embeds: [{
            title: `${MARKETPLACE_EMOJIS.error} Card Not Found`,
            description: 
              `You don't own a card with code \`${cardCode}\`.\n\n` +
              `${MARKETPLACE_EMOJIS.tip} **Double check:**\n` +
              `• The code is correct\n` +
              `• You own this card (\`?cabinet\`)\n` +
              `• You haven't already sold it`,
            color: EMBED_COLORS.ERROR
          }],
          messageReference: { messageID: msg.id }
        });
      }

      // Check if card is locked
      if (cardDetails.cardLocked) {
        return msg.channel.createMessage({
          embeds: [{
            title: `${MARKETPLACE_EMOJIS.locked} Card Locked`,
            description: 
              `This card is locked and cannot be sold.\n` +
              `\`${cardCode}\`\n\n` +
              `${MARKETPLACE_EMOJIS.tip} **Locked cards** are protected from trading and cannot be listed.`,
            color: EMBED_COLORS.ERROR
          }],
          messageReference: { messageID: msg.id }
        });
      }

      if (existingListing) {
        const isYours = existingListing.sellerId === userId;
        const ownerText = isYours 
          ? `You already have this card listed for **${existingListing.amount.toLocaleString()}** ${MARKETPLACE_EMOJIS.crystal}\n\n${MARKETPLACE_EMOJIS.tip} Remove it first: \`?market remove ${cardCode}\``
          : `This card is already on the marketplace by someone else.\n\n${MARKETPLACE_EMOJIS.tip} You can't list a card that's already being sold.`;
        
        return msg.channel.createMessage({
          embeds: [{
            title: `${MARKETPLACE_EMOJIS.warning} Already Listed`,
            description: ownerText,
            color: EMBED_COLORS.ERROR
          }],
          messageReference: { messageID: msg.id }
        });
      }

      // Format card display with print number
      const conditionEmoji = CONDITION_EMOJIS[cardDetails.condition.toLowerCase()] || '';
      const rarityStars = RARITY_EMOJIS[cardDetails.rarity.toLowerCase()] || '☆☆☆☆';
      const printInfo = cardDetails.printNumber ? `#${cardDetails.printNumber}` : '#???';
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
          title: `${MARKETPLACE_EMOJIS.sell} Confirm Listing`,
          description: 
            `${cardLine}\n\n` +
            `${MARKETPLACE_EMOJIS.crystal} **Listing Price:** ${price.toLocaleString()} crystals\n\n` +
            `This card will be visible to all players on the marketplace.\n\n` +
            `${MARKETPLACE_EMOJIS.tip} Other players can buy it immediately at this price!`,
          color: EMBED_COLORS.DEFAULT,
          thumbnail: { url: 'attachment://thumbnail.png' }
        },
        async () => {
          // Re-validate ownership before listing
          const stillOwned = await User.findOne({ 
            discordId: userId, 
            cardCode 
          })
          .select('name group rarity imageURL condition printNumber cardLocked')
          .lean();

          if (!stillOwned) {
            throw new Error("You no longer own this card");
          }

          if (stillOwned.cardLocked) {
            throw new Error("This card has been locked and cannot be listed");
          }

          // Create listing
          const newListing = await Marketplace.create({
            sellerId: userId,
            code: cardCode,
            name: stillOwned.name,
            group: stillOwned.group,
            rarity: stillOwned.rarity,
            amount: price
          });

          // Send notifications to watchers (non-blocking)
          sendListingNotifications(client, newListing, stillOwned)
            .catch(err => console.error("Notification error:", err));

          return {
            embeds: [{
              title: `${MARKETPLACE_EMOJIS.success} Listed Successfully!`,
              description: 
                `${cardLine}\n\n` +
                `Listed for **${price.toLocaleString()}** ${MARKETPLACE_EMOJIS.crystal}\n` +
                `Your listing is now visible to all players!\n\n` +
                `${MARKETPLACE_EMOJIS.tip} **Remove it:** \`?market remove ${cardCode}\``,
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
      console.error("Sell error:", error);
      return msg.channel.createMessage({
        embeds: [{
          title: `${MARKETPLACE_EMOJIS.error} Listing Failed`,
          description: 
            `${error.message || "An unexpected error occurred."}\n\n` +
            `${MARKETPLACE_EMOJIS.tip} **What to do:**\n` +
            `• Try again\n` +
            `• Verify you still own the card\n` +
            `• Contact support if this continues`,
          color: EMBED_COLORS.ERROR
        }],
        messageReference: { messageID: msg.id }
      });
    }
  }
};