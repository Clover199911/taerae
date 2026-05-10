const Eris = require("eris");
const Cooldown = require("../../models/cooldown");
const Graphic = require("../../models/graphic");
const CardGenerationService = require('../../services/CardGenerationService');
const CONFIG = require('../../config/commands/drop');
const COSMIC_CONFIG = require('../../utils/cosmicConfig');
const { RARITY_EMOJIS, CONDITION_EMOJIS } = require('../../config/embedConstants');
const QuestService = require('../../services/QuestService');
const { logCardSpawn } = require('../../utils/cardSpawnLogger');

const activeDrops = new Set();

const dropCommand = {
  name: "drop",
  aliases: ["dp"],
  description: "Drops 3 cards for you to choose from",

  async execute(msg, args, client) {
    const userId = msg.author.id;

    try {
      if (activeDrops.has(userId)) {
        return msg.channel.createMessage({
          content: `<@${userId}> ⏳ You already have a drop in progress! Please select a card first.`,
          messageReference: { messageID: msg.id }
        });
      }

      const graphic = await Graphic.findOne({ userId });
      if (!graphic?.isRegistered) {
        return this.sendRegistrationMessage(msg);
      }

      const cooldownResult = await this.checkCooldown(userId);
      if (cooldownResult.isOnCooldown) {
        return msg.channel.createMessage({
          content: `<@${userId}>, please wait ${cooldownResult.formattedTime} before using this command again.`,
          messageReference: { messageID: msg.id }
        });
      }

      activeDrops.add(userId);

      // Generate 5 cards with cosmic chance
      const cardOptions = Array.from({ length: 5 }, () => this.determineCardType());
      console.log('Generated card options:', cardOptions);

      // OPTIMIZED: Generate cards in parallel with concurrency limit
      const cards = await CardGenerationService.generateCards(userId, 5, { 
        cardOptions: cardOptions,
        skipCardCode: true
      });

      if (!cards.length) {
        throw new Error("Failed to generate cards");
      }

      // Create combined image
      const imageBuffers = cards.map(c => c.imageBuffer);
      const combinedImage = await CardGenerationService.createCombinedImage(imageBuffers, {
        width: CONFIG.cardDimensions.width,
        height: CONFIG.cardDimensions.height,
        columns: 5,
        padding: 5
      });

      // Save cards temporarily
      await CardGenerationService.saveTempCards(userId, cards);

      // Fetch tentative print numbers for dropdown display
      await this.fetchTentativePrints(cards);

      // Send selection message
      const message = await this.sendCardSelection(msg, cards, combinedImage);
      await this.setupSelectionCollector(message, cards, userId, client);

      await this.updateCooldown(userId);

    } catch (error) {
      activeDrops.delete(userId);
      console.error(`Drop command error for user ${userId}:`, error);
      return msg.channel.createMessage({
        content: "❌ An error occurred while generating cards. Please try again later.",
        messageReference: { messageID: msg.id }
      });
    }
  },

  determineCardType() {
    const roll = Math.random() * 100;
    
    if (roll < 3) {
      const cosmicCards = COSMIC_CONFIG.getAllCosmicCards();
      if (cosmicCards.length > 0) {
        console.log('🌟 Cosmic card rolled!');
        return {
          type: 'cosmic',
          cardIds: cosmicCards
        };
      }
    }
    
    const rarity = this.selectWeightedRarity();
    return {
      type: 'normal',
      rarity: rarity
    };
  },

  async fetchTentativePrints(cards) {
    const Card = require('../../models/card');
    
    // Batch fetch all card documents to avoid N+1 query
    const cardIds = cards.map(c => c.cardData.cardId);
    const cardDocs = await Card.find({ cardId: { $in: cardIds } }).lean();
    const cardDocMap = new Map(cardDocs.map(doc => [doc.cardId, doc]));
    
    cards.forEach((card) => {
      let tentativePrint = '???';
      const cardDoc = cardDocMap.get(card.cardData.cardId);
      if (cardDoc) {
        tentativePrint = (cardDoc.printCounter || 0) + 1;
      }
      card.tentativePrint = tentativePrint;
    });
  },

  selectWeightedRarity() {
    const random = Math.random() * 100;
    let cumulative = 0;

    for (const rarity of CONFIG.rarities) {
      cumulative += rarity.chance;
      if (random < cumulative) {
        return rarity.name;
      }
    }

    return "Standard";
  },

  async checkCooldown(userId) {
    const now = Date.now();
    const cooldown = await Cooldown.findOne({ user: userId, command: this.name });

    if (cooldown?.cooldownEnd > now) {
      const remaining = cooldown.cooldownEnd - now;
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.ceil((remaining % 60000) / 1000);
      
      return {
        isOnCooldown: true,
        formattedTime: `${minutes}m ${seconds}s`
      };
    }

    return { isOnCooldown: false };
  },

  async updateCooldown(userId) {
    await Cooldown.findOneAndUpdate(
      { user: userId, command: this.name },
      { cooldownEnd: Date.now() + CONFIG.cooldownDuration },
      { upsert: true }
    );
  },

  async sendCardSelection(msg, cards, imageBuffer) {
    return msg.channel.createMessage({
      content: `-# <@${msg.author.id}>, select a card below. Print numbers are tentative.`,
      messageReference: { messageID: msg.id },
      components: [this.createDropdown(cards)]
    }, { file: imageBuffer, name: "cards.png" });
  },

  createDropdown(cards, disabled = false, expired = false) {
    // Extract emoji ID from custom emoji format like "<:pristinee:1272529510696222842>"
    const extractEmojiId = (emojiStr) => {
      const match = emojiStr.match(/<:(\w+):(\d+)>/);
      if (match) {
        return { name: match[1], id: match[2] };
      }
      return null;
    };

    return {
      type: 1,
      components: [{
        type: 3,
        custom_id: "card_select",
        placeholder: expired ? "Selection expired" : "Select your card...",
        disabled: disabled || expired,
        options: cards.map((card, index) => {
          const rarityStars = RARITY_EMOJIS[card.cardData.rarity.toLowerCase()] || card.cardData.rarity;
          const rarityName = card.cardData.rarity.charAt(0).toUpperCase() + card.cardData.rarity.slice(1).toLowerCase();
          const cosmicIndicator = card.isCosmic ? '🌟 ' : '';
          const conditionEmojiStr = CONDITION_EMOJIS[card.cardData.condition.toLowerCase()];
          const emojiData = extractEmojiId(conditionEmojiStr);
          const printNum = card.tentativePrint || '???';
          
          const option = {
            label: `${rarityStars} ${rarityName}${cosmicIndicator ? ' ' + cosmicIndicator : ''}`.substring(0, 100),
            description: `${card.cardData.group} ${card.cardData.name} #${printNum}`.substring(0, 100),
            value: `${index}`
          };
          
          // Add emoji if available
          if (emojiData) {
            option.emoji = { name: emojiData.name, id: emojiData.id };
          }
          
          return option;
        })
      }]
    };
  },

  async setupSelectionCollector(message, cards, userId, client) {
    let collectorActive = true;
    
    const collector = async (interaction) => {
      if (!collectorActive) return;
      if (interaction.message.id !== message.id || interaction.member.id !== userId) return;

      try {
        await interaction.acknowledge();
        
        await message.edit({
          content: `<@${userId}> ⏳ Generating card...`,
          components: [this.createDropdown(cards, true)]
        }).catch(err => console.error("Failed to show loading state:", err));

        const index = parseInt(interaction.data.values[0]);
        
        // Validate bounds
        if (isNaN(index) || index < 0 || index >= cards.length) {
          return interaction.createMessage({
            content: "❌ Invalid selection.",
            flags: 64
          }).catch(() => {});
        }
        
        const selectedCard = cards[index];

        // Generate card code for selected card only
        const { generateUniqueCode } = require('../../utils/cardCodeGenerator');
        selectedCard.cardData.cardCode = await generateUniqueCode();
        console.log(`Generated card code for selected card: ${selectedCard.cardData.cardCode}`);

        // Apply selection overlay
        let selectedImageWithOverlay;
        try {
          selectedImageWithOverlay = await CardGenerationService.applySelectionOverlay(
            selectedCard.imageBuffer,
            selectedCard.cardData.group,
            selectedCard.cardData.rarity
          );
        } catch (overlayError) {
          console.error("Selection overlay error:", overlayError);
          selectedImageWithOverlay = selectedCard.imageBuffer;
        }

        // Create updated combined image
        const updatedBuffers = cards.map((card, i) => 
          i === index ? selectedImageWithOverlay : card.imageBuffer
        );

        const updatedCombinedImage = await CardGenerationService.createCombinedImage(updatedBuffers, {
          width: CONFIG.cardDimensions.width,
          height: CONFIG.cardDimensions.height,
          columns: 5,
          padding: 5
        });

        // Save selected card
        await CardGenerationService.saveCardsToDatabase([selectedCard.cardData]);

        // Log the card spawn
        logCardSpawn({
          userId: userId,
          username: interaction.member.username,
          cardName: selectedCard.cardData.name,
          group: selectedCard.cardData.group,
          rarity: selectedCard.cardData.rarity,
          condition: selectedCard.cardData.condition,
          cardCode: selectedCard.cardData.cardCode,
          printNumber: selectedCard.cardData.printNumber,
          command: 'drop',
          channelId: interaction.channel.id,
          channelName: interaction.channel.name || 'DM',
          guildId: interaction.channel.guild?.id || 'DM',
          guildName: interaction.channel.guild?.name || 'DM',
          isCosmic: selectedCard.isCosmic
        }).catch(err => console.error('[DROP_LOG_ERROR]', err));

        // Update quest progress for drop command and card collection
        const cardRarity = selectedCard.cardData.rarity.toLowerCase();
        const cardCondition = selectedCard.cardData.condition.toLowerCase();
        const questTypes = ['drop'];
        
        // Add rarity-specific quest types
        if (cardRarity === 'standard') questTypes.push('collect_standard');
        else if (cardRarity === 'unique') questTypes.push('collect_unique');
        else if (cardRarity === 'glyph') questTypes.push('collect_glyph');
        else if (cardRarity === 'mythic') questTypes.push('collect_mythic');
        
        // Add condition-specific quest types
        if (cardCondition === 'pristine') questTypes.push('collect_pristine');
        else if (cardCondition === 'mint') questTypes.push('collect_mint');
        else if (cardCondition === 'good') questTypes.push('collect_good');
        else if (cardCondition === 'worn') questTypes.push('collect_worn');
        else if (cardCondition === 'damaged') questTypes.push('collect_damaged');
        
        QuestService.updateQuestProgress(userId, questTypes, 1).catch(err => 
          console.error('[DROP_QUEST_UPDATE_ERROR]', err)
        );

        // Remove temp cards
        await CardGenerationService.removeTempCards(userId);

        // Cleanup
        collectorActive = false;
        clearTimeout(collectorTimeout);
        client.removeListener("interactionCreate", collector);
        activeDrops.delete(userId);

        await message.edit({
          content: `-# <@${userId}> selected a card!`,
          embeds: [],
          components: [this.createDropdown(cards, true)],
          attachments: [],
          file: { file: updatedCombinedImage, name: "cards_selected.png" }
        });

        await interaction.createMessage({
          embeds: [this.createCardEmbed(selectedCard, interaction.member)],
          file: { file: selectedCard.imageBuffer, name: "selected_card.png" },
          flags: 64
        });

      } catch (error) {
        collectorActive = false;
        clearTimeout(collectorTimeout);
        client.removeListener("interactionCreate", collector);
        activeDrops.delete(userId);
        console.error("Selection interaction error:", error);
        await interaction.createMessage({
          content: "❌ An error occurred. Please try again.",
          flags: 64
        }).catch(() => {});
      }
    };

    const collectorTimeout = setTimeout(() => {
      if (!collectorActive) return;
      collectorActive = false;
      client.removeListener("interactionCreate", collector);
      this.handleSelectionTimeout(message, cards, userId);
    }, CONFIG.selectionTimeout);

    client.on("interactionCreate", collector);
  },

  async handleSelectionTimeout(message, cards, userId) {
    try {
      activeDrops.delete(userId);
      await message.edit({
        content: "⏰ Card selection timed out. No cards were added to your collection.",
        components: [this.createDropdown(cards, true, true)]
      });
    } catch (error) {
      console.error("Timeout edit error:", error);
    }
  },

  createCardEmbed(selectedCard, member) {
    const rarityConfig = CONFIG.rarities.find(r => r.name === selectedCard.cardData.rarity);
    const rarityEmoji = RARITY_EMOJIS[selectedCard.cardData.rarity.toLowerCase()] || "⭐";
    const conditionEmoji = CONDITION_EMOJIS[selectedCard.cardData.condition.toLowerCase()] || selectedCard.cardData.condition;
    const cosmicIndicator = selectedCard.isCosmic ? '🌟 ' : '';

    return {
      title: "Card Added to your collection!",
      description: `${cosmicIndicator}${rarityEmoji}\n- [#${selectedCard.cardData.printNumber || '???'}] ${conditionEmoji} ${selectedCard.cardData.group} ${selectedCard.cardData.name} - \`${selectedCard.cardData.cardCode}\``,
      color: rarityConfig?.color || 0x888888,
      thumbnail: {
        url: "attachment://selected_card.png"
      },
      footer: {
        text: member.username,
        icon_url: member.avatarURL
      },
      timestamp: new Date()
    };
  },

  async sendRegistrationMessage(msg) {
    return msg.channel.createMessage({
      embeds: [{
        title: "🚫 Registration Required",
        description: "You need to register first! Use `?register` to start your journey.",
        color: 0xFF6B6B
      }],
      messageReference: { messageID: msg.id }
    });
  }
};

module.exports = dropCommand;