const mongoose = require("mongoose");
const Currency = require("../models/currency");
const Card = require("../models/card");
const UpdateCard = require("../models/updatecards");

class EnhancedEconomyMonitor {
  constructor() {
    this.PACK_PRICE_RATIO = 0.4;
    this.CARD_RARITY_WEIGHTS = {
      standard: 1,
      unique: 3,
      glyph: 6,
      mythic: 12
    };
    
    // Base prices for different pack types
    this.BASE_PACK_PRICES = {
      normal: 1000,
      premium: 2500,
      new_update: 5000,
      mythic: 10000
    };
  }

  getCurrentPackPrice(packType) {
    return this.BASE_PACK_PRICES[packType] || this.BASE_PACK_PRICES.normal;
  }

  generateCommandRecommendations(commandAnalysis) {
    // Example implementation that processes commandAnalysis data
    return Object.entries(commandAnalysis).map(([command, data]) => ({
        command,
        suggestedChange: data.recommendedAdjustment,
        averageReward: data.averageReward
    }));
}


  calculateRecommendedPackPrice(averageUserWealth, packType) {
    const priceModifiers = {
      normal: 0.2,
      premium: 0.4,
      new_update: 0.6,
      mythic: 0.8
    };

    const modifier = priceModifiers[packType] || priceModifiers.normal;
    return Math.round(averageUserWealth * modifier * this.PACK_PRICE_RATIO);
  }

  // Rest of the existing methods remain the same
  async analyzeCardEconomy() {
    const analysis = {
      cardMetrics: await this.analyzeCardMetrics(),
      packAnalysis: await this.analyzePackPricing(),
      currencyFlow: await this.analyzeCurrencyFlow(),
      commandRecommendations: await this.analyzeCommands(),
      pricingRecommendations: await this.generatePricingRecommendations(),
      balanceActions: []
    };

    

    await this.generateBalanceRecommendations(analysis);
    return analysis;
  }

  async analyzeCardMetrics() {
    const cardStats = await Card.aggregate([
        {
            $group: {
                _id: "$rarity",
                count: { $sum: 1 },
                averagePrice: { $avg: "$value" },
                totalCards: { $sum: 1 }
            }
        }
    ]);

    const totalCards = await Card.countDocuments();
    const uniqueCards = await Card.distinct("cardId").length;

    if (!totalCards || !uniqueCards) {
        console.error("Card metrics data is incomplete.");
    }

    return {
        rarityDistribution: cardStats,
        totalCards,
        uniqueCards,
        rarityPercentages: cardStats.map(stat => ({
            rarity: stat._id || "Unknown",
            percentage: ((stat.count / totalCards) * 100).toFixed(2) || 0
        }))
    };
}


async analyzePackPricing() {
  const averageUserWealth = await this.getAverageUserWealth();
  const packTypes = ['normal', 'premium', 'new_update', 'mythic'];
  
  const recommendations = {};
  
  for (const packType of packTypes) {
    const currentPrice = this.getCurrentPackPrice(packType);
    const recommendedPrice = this.calculateRecommendedPackPrice(
      averageUserWealth,
      packType
    );

    recommendations[packType] = {
      currentPrice,
      recommendedPrice,
      adjustment: recommendedPrice - currentPrice,
      adjustmentPercentage: ((recommendedPrice - currentPrice) / currentPrice * 100).toFixed(2)
    };
  }

  return recommendations;
}

async analyzeCurrencyFlow() {
  const currencies = [
    "crystals",
    "fantasiaTokens",
    "stardust",
    "astralEssence",
    "reverieGem",
    "selca",
  ];
  const flow = {};

  for (const currency of currencies) {
    const stats = await Currency.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: `$${currency}` },
          average: { $avg: `$${currency}` },
          max: { $max: `$${currency}` },
          min: { $min: `$${currency}` },
        },
      },
    ]);

    flow[currency] = {
      ...stats[0],
      velocity: await this.estimateCurrencyVelocity(currency),
      inflation: await this.estimateInflationRate(currency),
    };
  }

  return flow;
}


async analyzeCommands() {
  const commandAnalysis = {
      daily: {
          averageReward: 100,
          usageFrequency: "daily",
          recommendedAdjustment: 0
      },
      weekly: {
          averageReward: 500,
          usageFrequency: "weekly",
          recommendedAdjustment: -50
      }
  };
  return commandAnalysis;
}


async generatePricingRecommendations() {
  const averageWealth = await this.getAverageUserWealth();
  const cardMetrics = await this.analyzeCardMetrics();

  return {
    packPrices: {
      normal: Math.round(averageWealth * 0.2),
      premium: Math.round(averageWealth * 0.4),
      new_update: Math.round(averageWealth * 0.6),
      mythic: Math.round(averageWealth * 0.8)
    },
    cardValues: {
      standard: Math.round(averageWealth * 0.1),
      unique: Math.round(averageWealth * 0.2),
      glyph: Math.round(averageWealth * 0.4),
      mythic: Math.round(averageWealth * 0.5)
    }
  };
}

async generateBalanceRecommendations(analysis) {
  const actions = [];

  // Check for currency inflation
  Object.entries(analysis.currencyFlow).forEach(([currency, stats]) => {
    if (stats.inflation > 0.1) {
      actions.push({
        type: 'currency',
        currency,
        action: 'reduce_rewards',
        suggestion: `Reduce ${currency} rewards by ${Math.round(stats.inflation * 100)}%`
      });
    }
  });

  // Check pack pricing
  Object.entries(analysis.packAnalysis).forEach(([packType, data]) => {
    if (Math.abs(data.adjustmentPercentage) > 10) {
      actions.push({
        type: 'pack_price',
        packType,
        action: data.adjustment > 0 ? 'increase' : 'decrease',
        suggestion: `${data.adjustment > 0 ? 'Increase' : 'Decrease'} ${packType} pack price by ${Math.abs(data.adjustmentPercentage)}%`
      });
    }
  });

  analysis.balanceActions = actions;
}

// Helper methods
async getAverageUserWealth() {
  const stats = await Currency.aggregate([
    {
      $group: {
        _id: null,
        averageWealth: {
          $avg: {
            $add: [
              "$crystals",
              { $multiply: ["$fantasiaTokens", 5] },
              { $multiply: ["$stardust", 3] },
              { $multiply: ["$astralEssence", 2] },
              { $multiply: ["$reverieGem", 10] }
            ]
          }
        }
      }
    }
  ]);

  return stats[0]?.averageWealth || 0;
}

async estimateCurrencyVelocity(currency) {
  // Implement based on transaction history if available
  return 1.0; // Placeholder
}

async estimateInflationRate(currency) {
  // Implement based on historical data if available
  return 0.05; // Placeholder
}
}

module.exports = EnhancedEconomyMonitor;