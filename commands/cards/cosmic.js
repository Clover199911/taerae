// cosmic.js - Cosmic Card Generator with weighted probabilities
// ================================================================

const Currency = require("../../models/currency");
const Card = require('../../models/card');
const CardGenerationService = require('../../services/CardGenerationService');
const PACK_CONFIG = require('../../utils/packConfig');
const COSMIC_CONFIG = require('../../utils/cosmicConfig');
const { CONDITION_EMOJIS } = require('../../config/embedConstants');
const { logCardSpawn } = require('../../utils/cardSpawnLogger');

// ==================== CONSTANTS ====================
const PACK_COSTS = {
  DIVERSE: 30,
  IOTW_FOCUSED: 55
};

const PACK_PROBABILITIES = {
  DIVERSE: {
    NEW_CARD: 0.40,      // 40% new released card
    PRISTINE: 0.30,      // 30% any pristine card
    IOTW: 0.30           // 30% IOTW card
  },
  IOTW_FOCUSED: {
    IOTW_REGULAR: 0.30,  // 30% IOTW any condition
    IOTW_PRISTINE: 0.70  // 70% IOTW pristine
  }
};

const RARITY_EMOJIS = {
  'mythic': '★☆☆☆',
  'glyph': '★★☆☆',
  'unique': '★★★☆',
  'standard': '★★★★'
};

const INTERACTION_TIMEOUT = 60000; // 1 minute for pack selection
const CARD_SELECTION_TIMEOUT = 30000; // 30 seconds for card selection

// Card dimensions for combined image
const CARD_DIMENSIONS = {
  width: 225,
  height: 350,
  columns: 3
};

// Track active purchases to prevent spamming
const activePurchases = new Set();
const activeCardSelections = new Set();

// ==================== COMMAND ====================
module.exports = {
  name: "cosmic",
  description: "Generates cards with weighted probabilities - new cards, pristine cards, or idol of the week cards",
  
  async execute(msg, args, client) {
    const userId = msg.author.id;

    // Check currency balance
    const currency = await Currency.findOne({ userId });
    if (!currency) {
      return msg.channel.createMessage({
        content: "You don't have any cosmic. Please check your balance.",
        messageReference: { messageID: msg.id }
      });
    }

    // Send option menu
    const embed = this.createOptionEmbed(msg.author, currency.selca);
    const buttons = this.createOptionButtons();

    const optionMessage = await msg.channel.createMessage({
      embeds: [embed],
      components: [{ type: 1, components: buttons }],
      messageReference: { messageID: msg.id }
    });

    // Setup interaction handler
    this.setupPackSelectionHandler(client, optionMessage, msg.author, currency);
  },

  // ==================== UI BUILDERS ====================
  createOptionEmbed(author, balance) {
    return {
      author: {
        name: `Cosmic Card Generator`,
        icon_url: author.avatarURL,
      },
      description: `Choose your cosmic card option:`,
      fields: [
        {
          name: "__Diverse Pack__",
          value: `**Cost:** ${PACK_COSTS.DIVERSE}<:cosmic:1461015742219550924> cosmic\n` +
                 `**40%** New Released Card\n` +
                 `**30%** Any Pristine Card\n` +
                 `**30%** IOTW Card`,
          inline: true
        },
        {
          name: "__IOTW Focused__",
          value: `**Cost:** ${PACK_COSTS.IOTW_FOCUSED}<:cosmic:1461015742219550924> cosmic\n` +
                 `**30%** IOTW Card\n` +
                 `**70%** IOTW Pristine Card`,
          inline: true
        },
        {
          name: "Your Balance",
          value: `${balance}<:cosmic:1461015742219550924> cosmic`,
          inline: false
        }
      ],
      color: 0xa6e6f2,
    };
  },

  createOptionButtons() {
    return [
      {
        type: 2,
        style: 2,
        custom_id: "cosmic_30",
        label: `Diverse Pack (${PACK_COSTS.DIVERSE})`,
        emoji: { name: "cards", id: "1461015816869777450" },
      },
      {
        type: 2,
        style: 2,
        custom_id: "cosmic_55",
        label: `IOTW Focused (${PACK_COSTS.IOTW_FOCUSED})`,
        emoji: { name: "cards", id: "1461015816869777450" },
      }
    ];
  },

  createCardSelectionButtons(disabled = false) {
    return [
      {
        type: 2,
        style: 2,
        custom_id: "select_card_0",
        emoji: { name: "cards", id: "1461015816869777450" },
        disabled: disabled
      },
      {
        type: 2,
        style: 2,
        custom_id: "select_card_1",
        emoji: { name: "cards", id: "1461015816869777450" },
        disabled: disabled
      },
      {
        type: 2,
        style: 2,
        custom_id: "select_card_2",
        emoji: { name: "cards", id: "1461015816869777450" },
        disabled: disabled
      }
    ];
  },

  createCardEmbed(author, cardData, cost, cardType) {
    const rarityEmojis = {
      standard: "☆☆☆☆",
      unique: "★★☆☆",
      glyph: "★★★☆",
      mythic: "★★★★",
    };

    return {
      author: {
        name: `Cosmic`,
        icon_url: author.avatarURL,
      },
      description: `### Card Type: ${cardType}
${rarityEmojis[cardData.rarity.toLowerCase()]} ${cardData.name}
**Status:** ${cardData.condition}
**Ethereal Wellness:** ${cardData.cardWellness}
**Print:** #${cardData.printNumber || '???'}
**Code:** \`${cardData.cardCode}\` 
-# ${cost} cosmic deducted from your balance.
`,
      thumbnail: {
        url: "attachment://cosmic_card.png",
      },
      color: 0xa6e6f2,
    };
  },

  // Create card preview text with tentative print number
  async createCardPreviewText(cards) {
    const previews = await Promise.all(cards.map(async (card, index) => {
      const rarityEmoji = RARITY_EMOJIS[card.cardData.rarity.toLowerCase()] || '⭐';
      const conditionEmoji = CONDITION_EMOJIS[card.cardData.condition.toLowerCase()] || '';
      const tentativePrint = await this.getTentativePrintNumber(card.cardData.cardId);
      
      // Store tentative print on card object for later use
      card.tentativePrint = tentativePrint;
      
      return `**${index + 1}.** ${rarityEmoji} ${conditionEmoji} - **${card.cardData.group}** ${card.cardData.name} [#${tentativePrint}]`;
    }));

    return previews.join('\n');
  },

  // NEW: Create selected card text with -# on selected
  createSelectedCardText(cards, selectedIndex) {
    const lines = cards.map((card, index) => {
      const rarityEmoji = RARITY_EMOJIS[card.cardData.rarity.toLowerCase()] || '⭐';
      const conditionEmoji = CONDITION_EMOJIS[card.cardData.condition.toLowerCase()] || '';
      // Use real print for selected, tentative for others
      const printNum = index === selectedIndex ? card.cardData.printNumber : card.tentativePrint;
      const line = `${index + 1}. ${rarityEmoji} ${conditionEmoji} - **${card.cardData.group}** ${card.cardData.name} [#${printNum || '???'}]`;
      
      // Add -# prefix only to selected card
      if (index === selectedIndex) {
        return `__${line}__`;
      }
      return line;
    });

    return lines.join('\n');
  },

  // Get tentative print number (current + 1)
  async getTentativePrintNumber(cardId) {
    try {
      const card = await Card.findOne({ cardId });
      if (!card) return '???';
      return (card.printCounter || 0) + 1;
    } catch (error) {
      console.error('Error getting tentative print:', error);
      return '???';
    }
  },

  // ==================== PACK SELECTION HANDLING ====================
  setupPackSelectionHandler(client, optionMessage, author, currency) {
    const filter = (i) => 
      i.message.id === optionMessage.id && 
      i.member.id === author.id;

    const collector = async (interaction) => {
      if (!filter(interaction)) return;

      const userId = author.id;

      // Check if user already has an active purchase
      if (activePurchases.has(userId)) {
        await interaction.createMessage({
          content: "⏳ Hold up! You already have a card generation in progress. Wait for it to finish!",
          flags: 64
        }).catch(console.error);
        return;
      }

      // Mark user as having active purchase
      activePurchases.add(userId);

      await interaction.acknowledge();

      try {
        let cost;
        let packType;
        
        if (interaction.data.custom_id === "cosmic_30") {
          cost = PACK_COSTS.DIVERSE;
          packType = "diverse";
        } else if (interaction.data.custom_id === "cosmic_55") {
          cost = PACK_COSTS.IOTW_FOCUSED;
          packType = "iotw_focused";
        }

        // Check balance (don't deduct yet)
        const currentCurrency = await Currency.findOne({ userId });
        if (!currentCurrency || currentCurrency.selca < cost) {
          activePurchases.delete(userId);
          return interaction.createFollowup({
            content: `❌ You don't have enough cosmic! You need ${cost} but only have ${currentCurrency?.selca || 0}.`,
            flags: 64
          });
        }

        // Generate 3 cards with separate rolls
        const cards = await this.generate3Cards(userId, packType);

        if (!cards || cards.length !== 3) {
          activePurchases.delete(userId);
          return interaction.createFollowup({
            content: "❌ Cards unavailable at this time. Please try again later.",
            flags: 64
          });
        }

        // Create preview text with tentative prints
        const previewText = await this.createCardPreviewText(cards);

        // Create combined image
        const imageBuffers = cards.map(c => c.imageBuffer);
        const combinedImage = await CardGenerationService.createCombinedImage(imageBuffers, CARD_DIMENSIONS);

        // Send card selection message with preview
        const selectionMessage = await interaction.createFollowup({
          embeds: [{
            author: {
              name: "Choose your cosmic card",
              icon_url: author.avatarURL
            },
            description: previewText + '\n-# Print numbers are tentative and may change if someone else claims a card before you select.',
            color: 0xa6e6f2,
            image: {
              url: "attachment://cosmic_cards.png"
            }
          }],
          file: { file: combinedImage, name: "cosmic_cards.png" },
          components: [{ type: 1, components: this.createCardSelectionButtons() }]
        });

        // Setup card selection handler
        this.setupCardSelectionHandler(client, selectionMessage, author, cards, cost, packType);

        // Disable pack selection buttons
        await optionMessage.edit({
          components: [{
            type: 1,
            components: this.createOptionButtons().map(b => ({ ...b, disabled: true }))
          }]
        });

      } catch (error) {
        console.error("Pack selection error:", error);
        activePurchases.delete(userId);
        await interaction.createFollowup({
          content: "❌ An error occurred. Please try again.",
          flags: 64
        }).catch(console.error);
      }
    };

    client.on("interactionCreate", collector);

    // Cleanup after timeout
    setTimeout(() => {
      client.removeListener("interactionCreate", collector);
      activePurchases.delete(author.id);
      optionMessage.edit({
        components: [{
          type: 1,
          components: this.createOptionButtons().map(b => ({ ...b, disabled: true }))
        }]
      }).catch(console.error);
    }, INTERACTION_TIMEOUT);
  },

  // ==================== CARD SELECTION HANDLING ====================
  setupCardSelectionHandler(client, selectionMessage, author, cards, cost, packType) {
    const userId = author.id;
    let hasSelected = false;
    let currentInteraction = null;

    const filter = (i) => 
      i.message.id === selectionMessage.id && 
      i.member.id === userId;

    const handleSelection = async (selectedIndex, isAutoSelect = false, interaction = null) => {
      if (hasSelected) return;
      hasSelected = true;

      try {
        const selectedCard = cards[selectedIndex];

        // Generate card code for selected card only
        const { generateUniqueCode } = require('../../utils/cardCodeGenerator');
        selectedCard.cardData.cardCode = await generateUniqueCode();

        // Deduct cosmic NOW
        const currentCurrency = await Currency.findOne({ userId });
        if (!currentCurrency || currentCurrency.selca < cost) {
          activePurchases.delete(userId);
          activeCardSelections.delete(userId);
          throw new Error("Insufficient cosmic");
        }

        currentCurrency.selca -= cost;
        await currentCurrency.save();

        // Save selected card to database (this assigns the REAL print number)
        await CardGenerationService.saveCardsToDatabase([selectedCard.cardData]);

        // Log card spawn
        logCardSpawn({
          userId: userId,
          username: author.username,
          cardName: selectedCard.cardData.name,
          group: selectedCard.cardData.group,
          rarity: selectedCard.cardData.rarity,
          condition: selectedCard.cardData.condition,
          cardCode: selectedCard.cardData.cardCode,
          printNumber: selectedCard.cardData.printNumber,
          command: 'cosmic',
          channelId: selectionMessage.channel.id,
          channelName: selectionMessage.channel.name || 'DM',
          guildId: selectionMessage.channel.guild?.id || 'DM',
          guildName: selectionMessage.channel.guild?.name || 'DM',
          isCosmic: true
        }).catch(err => console.error('[COSMIC_LOG_ERROR]', err));

        console.log(
          `[COSMIC] User: ${userId} | ` +
          `Pack: ${packType} | ` +
          `Selected: Card ${selectedIndex + 1} | ` +
          `Auto: ${isAutoSelect} | ` +
          `Rarity: ${selectedCard.cardData.rarity} | ` +
          `Print: #${selectedCard.cardData.printNumber} | ` +
          `Code: ${selectedCard.cardData.cardCode}`
        );

        // Update buttons - selected one green, others disabled
        const updatedButtons = this.createCardSelectionButtons(true).map((btn, idx) => {
          if (idx === selectedIndex) {
            return { ...btn, style: 3 }; // Green for selected
          }
          return btn;
        });

        // Create selected card text with -# on selected
        const selectedCardText = this.createSelectedCardText(cards, selectedIndex);

        await selectionMessage.edit({
          embeds: [{
            author: {
              name: isAutoSelect ? "Time's up! Card auto-selected" : "Card selected successfully!",
              icon_url: author.avatarURL
            },
            description: selectedCardText,
            color: isAutoSelect ? 0xFEE75C : 0x57F287,
            image: {
              url: "attachment://cosmic_cards.png"
            }
          }],
          components: [{ type: 1, components: updatedButtons }]
        });

        // Send card info as ephemeral message
        if (interaction && !isAutoSelect) {
          // User clicked a button - send ephemeral followup
          await interaction.createFollowup({
            embeds: [this.createCardEmbed(author, selectedCard.cardData, cost, `${packType === 'diverse' ? 'Diverse Pack' : 'IOTW Focused'}`)],
            file: { file: selectedCard.imageBuffer, name: "cosmic_card.png" },
            flags: 64 // Ephemeral
          });
        } else {
          // Auto-selected - send regular message since there's no interaction
          await selectionMessage.channel.createMessage({
            content: `<@${userId}>`,
            embeds: [this.createCardEmbed(author, selectedCard.cardData, cost, `${packType === 'diverse' ? 'Diverse Pack' : 'IOTW Focused'}`)],
            file: { file: selectedCard.imageBuffer, name: "cosmic_card.png" }
          });
        }

      } catch (error) {
        console.error("Card selection error:", error);
        await selectionMessage.edit({
          content: `<@${userId}> ❌ An error occurred. Please try again.`,
          components: [{ type: 1, components: this.createCardSelectionButtons(true) }]
        }).catch(console.error);
      } finally {
        activePurchases.delete(userId);
        activeCardSelections.delete(userId);
      }
    };

    const collector = async (interaction) => {
      if (!filter(interaction)) return;
      if (hasSelected) return;

      // Prevent spam during card selection
      if (activeCardSelections.has(userId)) {
        await interaction.createMessage({
          content: "⏳ Processing your selection...",
          flags: 64
        }).catch(console.error);
        return;
      }

      activeCardSelections.add(userId);

      await interaction.acknowledge();

      const cardIndex = parseInt(interaction.data.custom_id.split('_')[2]);
      await handleSelection(cardIndex, false, interaction);
    };

    client.on("interactionCreate", collector);

    // Auto-select after timeout
    const timeout = setTimeout(async () => {
      client.removeListener("interactionCreate", collector);
      if (!hasSelected) {
        const randomIndex = Math.floor(Math.random() * 3);
        await handleSelection(randomIndex, true, null);
      }
    }, CARD_SELECTION_TIMEOUT);
  },

  // ==================== CARD GENERATION ====================
  async generate3Cards(userId, packType) {
    try {
      const cards = [];

      for (let i = 0; i < 3; i++) {
        let cardResult;
        
        if (packType === "diverse") {
          cardResult = await this.generateDiversePackCard(userId);
        } else if (packType === "iotw_focused") {
          cardResult = await this.generateIOTWFocusedCard(userId);
        }

        if (!cardResult) {
          throw new Error(`Failed to generate card ${i + 1}`);
        }

        cards.push(cardResult);
      }

      return cards;

    } catch (error) {
      console.error("Error generating 3 cards:", error);
      return null;
    }
  },

  async generateDiversePackCard(userId) {
    const roll = Math.random();
    const probs = PACK_PROBABILITIES.DIVERSE;

    if (roll < probs.NEW_CARD) {
      return await this.generateNewReleasedCard(userId);
    } else if (roll < probs.NEW_CARD + probs.PRISTINE) {
      return await this.generateAnyPristineCard(userId);
    } else {
      return await this.generateIOTWCard(userId, false);
    }
  },

  async generateIOTWFocusedCard(userId) {
    const roll = Math.random();
    const probs = PACK_PROBABILITIES.IOTW_FOCUSED;

    if (roll < probs.IOTW_REGULAR) {
      return await this.generateIOTWCard(userId, false);
    } else {
      return await this.generateIOTWCard(userId, true);
    }
  },

  // ==================== CARD TYPE GENERATORS ====================
  async generateNewReleasedCard(userId) {
    const newCardIds = PACK_CONFIG['new-update-10']?.newCardIds;
    
    if (!newCardIds || newCardIds.length === 0) {
      console.warn("[COSMIC] No new cards defined, falling back to any card");
      const result = await CardGenerationService.generateCard(userId, { skipCardCode: true });
      return {
        ...result,
        type: "Random Card (Fallback)"
      };
    }

    const result = await CardGenerationService.generateCard(userId, {
      cardIds: newCardIds,
      skipCardCode: true
    });

    return {
      ...result,
      type: "New Released Card"
    };
  },

  async generateAnyPristineCard(userId) {
    const result = await CardGenerationService.generateCard(userId, {
      condition: 'Pristine',
      skipCardCode: true
    });

    return {
      ...result,
      type: "Pristine Card"
    };
  },

  async generateIOTWCard(userId, forcePristine = false) {
    const iotwCardIds = COSMIC_CONFIG.getCurrentIOTWCards();
    
    // Fallback if no IOTW cards are configured
    if (!iotwCardIds || iotwCardIds.length === 0) {
      console.warn("[COSMIC] No IOTW cards defined in cosmicConfig, generating random card");
      const result = await CardGenerationService.generateCard(userId, {
        condition: forcePristine ? 'Pristine' : undefined,
        skipCardCode: true
      });
      return {
        ...result,
        type: forcePristine ? "Pristine Card (IOTW Fallback)" : "Random Card (IOTW Fallback)"
      };
    }

    const result = await CardGenerationService.generateCard(userId, {
      cardIds: iotwCardIds,
      condition: forcePristine ? 'Pristine' : undefined,
      skipCardCode: true
    });

    return {
      ...result,
      type: forcePristine ? "IOTW Pristine Card" : "IOTW Card"
    };
  }
};