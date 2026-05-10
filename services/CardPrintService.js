// services/CardPrintService.js
const Card = require('../models/card');
const User = require('../models/user');

class CardPrintService {
  /**
   * Assigns a print number to a card when it's claimed
   * Uses atomic MongoDB operation to prevent duplicate prints
   * Handles both regular cards (by cardId) and custom cards (by name+group+rarity)
   */
  static async assignPrintNumber(cardId, cardData = null) {
    try {
      // If cardId is provided, use it
      if (cardId) {
        const card = await Card.findOneAndUpdate(
          { cardId: cardId },
          { $inc: { printCounter: 1 } },
          { 
            new: true,
            upsert: false
          }
        );

        if (!card) {
          throw new Error(`Card with ID ${cardId} not found`);
        }

        return card.printCounter;
      }

      // For custom cards or when cardId is not available
      // Use name + group + rarity as unique identifier
      if (cardData && cardData.name && cardData.group && cardData.rarity) {
        const card = await Card.findOneAndUpdate(
          { 
            name: cardData.name,
            group: cardData.group,
            rarity: cardData.rarity
          },
          { $inc: { printCounter: 1 } },
          { 
            new: true,
            upsert: false
          }
        );

        if (!card) {
          // Card doesn't exist in Card collection - this might be a custom card
          // Count existing user cards with same name+group+rarity
          const existingCount = await User.countDocuments({
            name: cardData.name,
            group: cardData.group,
            rarity: cardData.rarity
          });

          return existingCount + 1; // Next print number
        }

        return card.printCounter;
      }

      throw new Error('Either cardId or complete cardData (name, group, rarity) must be provided');

    } catch (error) {
      console.error(`[PRINT_SERVICE] Error assigning print:`, error);
      throw error;
    }
  }

  /**
   * Get print information for a specific user card
   */
  static async getPrintInfo(cardCode) {
    try {
      const userCard = await User.findOne({ cardCode }).lean();
      if (!userCard) return null;

      const card = await Card.findOne({ cardId: userCard.cardId }).lean();
      if (!card) return null;

      return {
        printNumber: userCard.printNumber,
        totalPrints: card.printCounter,
        cardName: userCard.name,
        isFirstPrint: userCard.printNumber === 1
      };
    } catch (error) {
      console.error(`[PRINT_SERVICE] Error getting print info for ${cardCode}:`, error);
      return null;
    }
  }

  /**
   * Get the first print owner of a card
   */
  static async getFirstPrintOwner(cardId) {
    try {
      const firstPrint = await User.findOne({ 
        cardId: cardId, 
        printNumber: 1 
      }).select('discordId name group printNumber').lean();

      return firstPrint;
    } catch (error) {
      console.error(`[PRINT_SERVICE] Error getting first print for card ${cardId}:`, error);
      return null;
    }
  }

  /**
   * Get all print numbers for a specific card
   */
  static async getAllPrints(cardId, limit = 10) {
    try {
      const prints = await User.find({ cardId: cardId })
        .select('discordId name printNumber condition')
        .sort({ printNumber: 1 })
        .limit(limit)
        .lean();

      return prints;
    } catch (error) {
      console.error(`[PRINT_SERVICE] Error getting prints for card ${cardId}:`, error);
      return [];
    }
  }

  /**
   * Get print statistics for a card
   */
  static async getPrintStats(cardId) {
    try {
      const card = await Card.findOne({ cardId: cardId }).lean();
      if (!card) return null;

      const conditions = await User.aggregate([
        { $match: { cardId: cardId } },
        { $group: { 
          _id: '$condition', 
          count: { $sum: 1 } 
        }}
      ]);

      return {
        totalPrints: card.printCounter,
        conditionBreakdown: conditions.reduce((acc, c) => {
          acc[c._id] = c.count;
          return acc;
        }, {})
      };
    } catch (error) {
      console.error(`[PRINT_SERVICE] Error getting print stats for card ${cardId}:`, error);
      return null;
    }
  }

  /**
   * Check if a user owns a specific print number
   */
  static async userOwnsPrint(userId, cardId, printNumber) {
    try {
      const card = await User.findOne({
        discordId: userId,
        cardId: cardId,
        printNumber: printNumber
      });

      return !!card;
    } catch (error) {
      console.error(`[PRINT_SERVICE] Error checking print ownership:`, error);
      return false;
    }
  }

  /**
   * Format print number for display (e.g., "#1", "#42")
   */
  static formatPrintNumber(printNumber) {
    if (!printNumber || printNumber < 1) return '#0';
    return `#${printNumber}`;
  }

  /**
   * Get print rarity badge (for special prints like #1, #100, etc.)
   */
  static getPrintBadge(printNumber) {
    if (printNumber === 1) return '🥇 First Print';
    if (printNumber % 100 === 0) return '💯 Century Print';
    if (printNumber % 50 === 0) return '⭐ Milestone Print';
    return null;
  }
}

module.exports = CardPrintService;