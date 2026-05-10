// commands/print.js
const CardPrintService = require('../services/CardPrintService');
const User = require('../models/user');
const Card = require('../models/card');

const printCommand = {
  name: "print",
  aliases: ["pr"],
  description: "View print information for your cards or specific card codes",

  async execute(msg, args, client) {
    const userId = msg.author.id;

    try {
      // If no args, show user's first prints
      if (!args.length) {
        return await this.showUserFirstPrints(msg, userId);
      }

      const subcommand = args[0].toLowerCase();

      switch (subcommand) {
        case 'info':
        case 'i':
          return await this.showPrintInfo(msg, args[1]);
        
        case 'card':
        case 'c':
          return await this.showCardPrints(msg, args.slice(1).join(' '));
        
        case 'first':
        case 'f':
          return await this.showUserFirstPrints(msg, userId);
        
        case 'stats':
        case 's':
          return await this.showCardStats(msg, args.slice(1).join(' '));

        case 'migrate':
          // Admin only - migrate existing cards
          if (!this.isAdmin(userId)) {
            return msg.channel.createMessage({ content: "❌ Admin only command", messageReference: { messageID: msg.id } });
          }
          return await this.migrateExistingCards(msg);

        default:
          // Treat as card code
          return await this.showPrintInfo(msg, args[0]);
      }

    } catch (error) {
      console.error('Print command error:', error);
      return msg.channel.createMessage({
        embeds: [{
          title: "❌ Error",
          description: "An error occurred while fetching print information.",
          color: 0xFF0000
        }],
        messageReference: { messageID: msg.id }
      });
    }
  },

  async showPrintInfo(msg, cardCode) {
    if (!cardCode) {
      return msg.channel.createMessage({ content: "Usage: `?print info <card_code>`", messageReference: { messageID: msg.id } });
    }

    const printInfo = await CardPrintService.getPrintInfo(cardCode);
    
    if (!printInfo) {
      return msg.channel.createMessage({
        embeds: [{
          title: "❌ Card Not Found",
          description: `No card found with code \`${cardCode}\``,
          color: 0xFF0000
        }],
        messageReference: { messageID: msg.id }
      });
    }

    const badge = CardPrintService.getPrintBadge(printInfo.printNumber);

    return msg.channel.createMessage({
      embeds: [{
        title: `📄 ${printInfo.cardName}`,
        description: badge ? `**${badge}**` : '',
        fields: [
          {
            name: "Print Number",
            value: CardPrintService.formatPrintNumber(printInfo.printNumber),
            inline: true
          },
          {
            name: "Total Prints",
            value: printInfo.totalPrints.toString(),
            inline: true
          },
          {
            name: "Card Code",
            value: `\`${cardCode}\``,
            inline: true
          }
        ],
        color: printInfo.isFirstPrint ? 0xFFD700 : 0x3498db,
        footer: {
          text: printInfo.isFirstPrint ? "🥇 You own the first print!" : `Print ${printInfo.printNumber} of ${printInfo.totalPrints}`
        }
      }],
      messageReference: { messageID: msg.id }
    });
  },

  async showCardPrints(msg, cardName) {
    if (!cardName) {
      return msg.channel.createMessage({ content: "Usage: `?print card <card_name>`", messageReference: { messageID: msg.id } });
    }

    // Find the card
    const card = await Card.findOne({ 
      name: new RegExp(cardName, 'i') 
    });

    if (!card) {
      return msg.channel.createMessage({
        embeds: [{
          title: "❌ Card Not Found",
          description: `No card found matching "${cardName}"`,
          color: 0xFF0000
        }],
        messageReference: { messageID: msg.id }
      });
    }

    const prints = await CardPrintService.getAllPrints(card.cardId, 10);

    if (!prints.length) {
      return msg.channel.createMessage({
        embeds: [{
          title: `📄 ${card.name}`,
          description: "This card hasn't been claimed yet!",
          color: 0x95a5a6
        }],
        messageReference: { messageID: msg.id }
      });
    }

    const printList = prints.map(p => 
      `${CardPrintService.formatPrintNumber(p.printNumber)} - <@${p.discordId}> (${p.condition})`
    ).join('\n');

    return msg.channel.createMessage({
      embeds: [{
        title: `📄 ${card.name} - Print History`,
        description: printList,
        fields: [
          {
            name: "Total Prints",
            value: card.printCounter.toString(),
            inline: true
          },
          {
            name: "First Owner",
            value: prints[0] ? `<@${prints[0].discordId}>` : 'Unknown',
            inline: true
          }
        ],
        color: 0x3498db,
        footer: {
          text: prints.length >= 10 ? "Showing first 10 prints" : `Showing all ${prints.length} prints`
        }
      }],
      messageReference: { messageID: msg.id }
    });
  },

  async showUserFirstPrints(msg, userId) {
    const firstPrints = await User.find({
      discordId: userId,
      printNumber: 1
    }).select('name group printNumber cardCode').limit(10).lean();

    if (!firstPrints.length) {
      return msg.channel.createMessage({
        embeds: [{
          title: "🥇 Your First Prints",
          description: "You don't own any first prints yet!",
          color: 0x95a5a6
        }],
        messageReference: { messageID: msg.id }
      });
    }

    const printList = firstPrints.map(card => 
      `🥇 **${card.name}** (${card.group}) - \`${card.cardCode}\``
    ).join('\n');

    return msg.channel.createMessage({
      embeds: [{
        title: "🥇 Your First Prints",
        description: printList,
        color: 0xFFD700,
        footer: {
          text: `You own ${firstPrints.length} first print${firstPrints.length !== 1 ? 's' : ''}!`
        }
      }],
      messageReference: { messageID: msg.id }
    });
  },

  async showCardStats(msg, cardName) {
    if (!cardName) {
      return msg.channel.createMessage({ content: "Usage: `?print stats <card_name>`", messageReference: { messageID: msg.id } });
    }

    const card = await Card.findOne({ 
      name: new RegExp(cardName, 'i') 
    });

    if (!card) {
      return msg.channel.createMessage({
        embeds: [{
          title: "❌ Card Not Found",
          description: `No card found matching "${cardName}"`,
          color: 0xFF0000
        }],
        messageReference: { messageID: msg.id }
      });
    }

    const stats = await CardPrintService.getPrintStats(card.cardId);

    if (!stats) {
      return msg.channel.createMessage({ content: "❌ Failed to fetch stats", messageReference: { messageID: msg.id } });
    }

    const conditionFields = Object.entries(stats.conditionBreakdown).map(([condition, count]) => ({
      name: condition.charAt(0).toUpperCase() + condition.slice(1),
      value: count.toString(),
      inline: true
    }));

    return msg.channel.createMessage({
      embeds: [{
        title: `📊 ${card.name} - Print Statistics`,
        fields: [
          {
            name: "Total Prints",
            value: stats.totalPrints.toString(),
            inline: true
          },
          {
            name: "Rarity",
            value: card.rarity,
            inline: true
          },
          {
            name: "Group",
            value: card.group,
            inline: true
          },
          ...conditionFields
        ],
        color: 0x9b59b6
      }],
      messageReference: { messageID: msg.id }
    });
  },

  async migrateExistingCards(msg) {
    const statusMsg = await msg.channel.createMessage({
      embeds: [{
        title: "🔄 Migration In Progress",
        description: "Migrating existing cards to print system...",
        color: 0xFFA500
      }],
      messageReference: { messageID: msg.id }
    });

    try {
      // Step 1: Add printCounter to all cards that don't have it
      const cardsUpdated = await Card.updateMany(
        { printCounter: { $exists: false } },
        { $set: { printCounter: 0 } }
      );

      console.log(`Updated ${cardsUpdated.modifiedCount} cards with printCounter field`);

      // Step 2: Get all user cards grouped by cardId
      const userCards = await User.find({ 
        printNumber: { $exists: false } 
      }).sort({ _id: 1 }); // Sort by creation order (oldest first)

      if (!userCards.length) {
        return statusMsg.edit({
          embeds: [{
            title: "✅ Migration Complete",
            description: "All cards already have print numbers!",
            color: 0x00FF00
          }]
        });
      }

      // Step 3: Group cards by cardId to assign sequential prints
      const cardGroups = {};
      
      for (const userCard of userCards) {
        // Find the matching Card document to get cardId
        const card = await Card.findOne({ 
          name: userCard.name, 
          group: userCard.group,
          rarity: userCard.rarity
        });

        if (!card) {
          console.warn(`No matching Card found for user card: ${userCard.name}`);
          continue;
        }

        if (!cardGroups[card.cardId]) {
          cardGroups[card.cardId] = [];
        }

        cardGroups[card.cardId].push({
          userCardId: userCard._id,
          cardId: card.cardId
        });
      }

      // Step 4: Assign print numbers sequentially per card
      let totalUpdated = 0;

      for (const [cardId, userCardsList] of Object.entries(cardGroups)) {
        for (let i = 0; i < userCardsList.length; i++) {
          const printNumber = i + 1;
          
          await User.updateOne(
            { _id: userCardsList[i].userCardId },
            { 
              $set: { 
                printNumber: printNumber,
                cardId: parseInt(cardId)
              }
            }
          );

          totalUpdated++;
        }

        // Update the card's printCounter to reflect total prints
        await Card.updateOne(
          { cardId: parseInt(cardId) },
          { $set: { printCounter: userCardsList.length } }
        );
      }

      return statusMsg.edit({
        embeds: [{
          title: "✅ Migration Complete",
          description: `Successfully migrated ${totalUpdated} user cards!`,
          fields: [
            {
              name: "Cards Updated",
              value: cardsUpdated.modifiedCount.toString(),
              inline: true
            },
            {
              name: "User Cards Migrated",
              value: totalUpdated.toString(),
              inline: true
            },
            {
              name: "Unique Cards",
              value: Object.keys(cardGroups).length.toString(),
              inline: true
            }
          ],
          color: 0x00FF00
        }]
      });

    } catch (error) {
      console.error('Migration error:', error);
      return statusMsg.edit({
        embeds: [{
          title: "❌ Migration Failed",
          description: `Error: ${error.message}`,
          color: 0xFF0000
        }]
      });
    }
  },

  isAdmin(userId) {
    // Add your admin user IDs here
    const adminIds = JSON.parse(process.env.MAINTENANCE_WHITELIST || '[]');
    return adminIds.includes(userId);
  }
};

module.exports = printCommand;