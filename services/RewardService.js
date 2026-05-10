// ============================================================================
// REWARD SERVICE - FIXED with pack retry logic + EMOJI PATTERN SUPPORT
// ============================================================================

const User = require('../models/user');
const Pack = require('../models/pack');
const Card = require('../models/card');
const Currency = require('../models/currency');
const CardGenerationService = require('./CardGenerationService');
const { generateUniqueCode } = require('../utils/cardCodeGenerator');
const { getCardWellness } = require('../utils/cardWellness');
const { getRandomCardCondition } = require('../utils/status');
const { generatePackCode } = require('../utils/packCodeGenerator');
const { logCardSpawn } = require('../utils/cardSpawnLogger');

class RewardService {

  // ========== MAIN REWARD DISTRIBUTOR ==========
  static async distributeReward(interaction, reward) {
    try {
      const userId = interaction.member.id;

      switch (reward.type) {
        case 'CARD':
          return await this.giveCards(interaction, reward);
        
        case 'CURRENCY':
          return await this.giveCurrency(userId, reward);
        
        case 'PACK':
          return await this.givePacks(userId, reward);
        
        case 'CARD_GENERATION':
          return await this.generateCards(interaction, reward);
        
        case 'CHOICE':
          return { type: 'CHOICE', options: reward.options };
        
        case 'MEGA':
          return await this.distributeMegaReward(interaction, reward);
        
        default:
          throw new Error('Unknown reward type');
      }
    } catch (error) {
      console.error('[REWARD_SERVICE] Error distributing reward:', error);
      throw error;
    }
  }

  // ========== HELPER: BUILD GROUP QUERY ==========
  static buildGroupQuery(fromGroup) {
    if (!fromGroup) return null;

    // Check if it's an emoji pattern (contains :)
    if (fromGroup.includes(':')) {
      // Escape special regex characters for emoji patterns
      const escapedPattern = fromGroup.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return { $regex: `^${escapedPattern}` };
    } else {
      // Regular exact group match
      return new RegExp(`^${fromGroup}$`, 'i');
    }
  }

  // ========== GIVE CARDS ==========
  static async giveCards(interaction, reward) {
    try {
      const userId = interaction.member.id;
      const cards = [];

      for (let i = 0; i < reward.count; i++) {
        const query = { spawnable: true };
        if (reward.rarity) query.rarity = reward.rarity;
        if (reward.fromGroup) {
          query.group = this.buildGroupQuery(reward.fromGroup);
        }

        const availableCards = await Card.find(query).lean();
        if (!availableCards.length) {
          throw new Error(`No cards found for rarity: ${reward.rarity}${reward.fromGroup ? ` and group: ${reward.fromGroup}` : ''}`);
        }

        const card = availableCards[Math.floor(Math.random() * availableCards.length)];
        const cardCode = await generateUniqueCode();
        if (!cardCode) throw new Error('Failed to generate card code');

        const cardWellness = getCardWellness(card.rarity);
        const cardCondition = reward.condition || getRandomCardCondition();

        const overlayPromise = CardGenerationService.preloadOverlay(card.group, card.rarity, cardCondition, card.cardId);

        const imageBuffer = await CardGenerationService.processCardImage(
          card,
          cardCondition,
          overlayPromise
        );

        const newCard = new User({
          discordId: userId,
          cardCode,
          name: card.name,
          group: card.group,
          rarity: card.rarity,
          imageURL: card.imageURL,
          cardWellness,
          condition: cardCondition
        });

        await newCard.save();
        
        // Log card spawn from giveCards
        logCardSpawn({
          userId: userId,
          username: interaction.member?.username || 'Unknown',
          cardName: card.name,
          group: card.group,
          rarity: card.rarity,
          condition: cardCondition,
          cardCode: cardCode,
          printNumber: newCard.printNumber,
          command: 'tier_reward',
          channelId: interaction.channel?.id || 'N/A',
          channelName: interaction.channel?.name || 'Reward System',
          guildId: interaction.guildID || 'N/A',
          guildName: interaction.channel?.guild?.name || 'Reward System',
          isCosmic: false
        }).catch(err => console.error('[REWARD_LOG_ERROR]', err));
        
        cards.push({ ...newCard.toObject(), imageBuffer });
      }

      return { type: 'CARDS', cards };
    } catch (error) {
      console.error('[REWARD_SERVICE] Error giving cards:', error);
      throw error;
    }
  }

  // ========== GIVE CURRENCY ==========
  static async giveCurrency(userId, reward) {
    try {
      const updates = {};
      if (reward.crystals) updates.crystals = reward.crystals;
      if (reward.astralEssence) updates.astralEssence = reward.astralEssence;
      if (reward.stardust) updates.stardust = reward.stardust;
      if (reward.fantasiaTokens) updates.fantasiaTokens = reward.fantasiaTokens;
      if (reward.reverieGem) updates.reverieGem = reward.reverieGem;
      if (reward.selca) updates.selca = reward.selca;
      if (reward.candyCanes) updates.candyCanes = reward.candyCanes;

      const currency = await Currency.findOne({ userId });
      
      if (currency) {
        for (const [key, value] of Object.entries(updates)) {
          currency[key] = (currency[key] || 0) + value;
        }
        await currency.save();
      } else {
        await new Currency({ userId, ...updates }).save();
      }

      return { type: 'CURRENCY', updates };
    } catch (error) {
      console.error('[REWARD_SERVICE] Error giving currency:', error);
      throw error;
    }
  }

  // ========== GIVE PACKS (WITH RETRY LOGIC - FIXED!) ==========
  static async givePacks(userId, reward) {
    try {
      const packs = [];
      const maxRetries = 5;

      for (let i = 0; i < reward.count; i++) {
        let packCreated = false;
        let attempts = 0;

        while (!packCreated && attempts < maxRetries) {
          try {
            const packCode = await generatePackCode();
            
            const newPack = await Pack.create({
              userId,
              packCode,
              packType: reward.packType,
              isOpened: false
            });

            packs.push(newPack);
            packCreated = true;
          } catch (error) {
            attempts++;
            if (error.code === 11000) {
              // Duplicate pack code, retry with new code
              console.log(`[REWARD_SERVICE] Duplicate pack code, retrying... (${attempts}/${maxRetries})`);
              await new Promise(resolve => setTimeout(resolve, 100));
            } else {
              throw error;
            }
          }
        }

        if (!packCreated) {
          throw new Error('Failed to generate unique pack code after multiple attempts');
        }
      }

      return { type: 'PACKS', packs };
    } catch (error) {
      console.error('[REWARD_SERVICE] Error giving packs:', error);
      throw error;
    }
  }

  // ========== GENERATE CARDS ==========
  static async generateCards(interaction, reward) {
    try {
      const userId = interaction.member.id;
      const cards = [];

      const rarities = reward.rarities || [reward.rarity];

      for (let i = 0; i < reward.count; i++) {
        const rarity = rarities[Math.floor(Math.random() * rarities.length)];
        
        const query = { spawnable: true, rarity };
        if (reward.fromGroup) {
          query.group = this.buildGroupQuery(reward.fromGroup);
        }

        const availableCards = await Card.find(query).lean();
        if (!availableCards.length) {
          console.error(`No cards found for rarity: ${rarity}${reward.fromGroup ? ` and group: ${reward.fromGroup}` : ''}`);
          continue;
        }

        const card = availableCards[Math.floor(Math.random() * availableCards.length)];
        const cardCode = await generateUniqueCode();
        if (!cardCode) continue;

        const isPristine = reward.condition === 'pristine' ||
                          (reward.pristineChance && Math.random() < reward.pristineChance);
        const cardCondition = isPristine ? 'Pristine' : getRandomCardCondition();
        const cardWellness = getCardWellness(card.rarity);

        const overlayPromise = CardGenerationService.preloadOverlay(card.group, card.rarity, cardCondition, card.cardId);

        const imageBuffer = await CardGenerationService.processCardImage(
          card,
          cardCondition,
          overlayPromise
        );

        const newCard = new User({
          discordId: userId,
          cardCode,
          name: card.name,
          group: card.group,
          rarity: card.rarity,
          imageURL: card.imageURL,
          cardWellness,
          condition: cardCondition
        });

        await newCard.save();
        
        // Log card spawn from generateCards
        logCardSpawn({
          userId: userId,
          username: interaction.member?.username || 'Unknown',
          cardName: card.name,
          group: card.group,
          rarity: card.rarity,
          condition: cardCondition,
          cardCode: cardCode,
          printNumber: newCard.printNumber,
          command: 'tier_reward',
          channelId: interaction.channel?.id || 'N/A',
          channelName: interaction.channel?.name || 'Reward System',
          guildId: interaction.guildID || 'N/A',
          guildName: interaction.channel?.guild?.name || 'Reward System',
          isCosmic: false
        }).catch(err => console.error('[REWARD_LOG_ERROR]', err));
        
        cards.push({ ...newCard.toObject(), imageBuffer });
      }

      return { type: 'CARDS', cards };
    } catch (error) {
      console.error('[REWARD_SERVICE] Error generating cards:', error);
      throw error;
    }
  }

  // ========== MEGA REWARD ==========
  static async distributeMegaReward(interaction, reward) {
    try {
      const results = [];

      for (const item of reward.items) {
        const result = await this.distributeReward(interaction, item);
        results.push(result);
      }

      return { type: 'MEGA', results };
    } catch (error) {
      console.error('[REWARD_SERVICE] Error distributing mega reward:', error);
      throw error;
    }
  }

  // ========== FORMAT REWARD MESSAGE ==========
  static formatRewardMessage(result) {
    const messages = [];

    switch (result.type) {
      case 'CARDS':
        const conditionIcons = {
          damaged: "<:damaged:1268950803830407249>",
          worn: "<:worn:1268950805633826868>",
          good: "<:good:1268950807340908687>",
          mint: "<:mint:1268950809404641401>",
          pristine: "<:pristinee:1272529510696222842>"
        };
        
        messages.push(`🎴 **Received ${result.cards.length} card${result.cards.length > 1 ? 's' : ''}:**\n`);
        result.cards.forEach(card => {
          const icon = conditionIcons[card.condition.toLowerCase()] || '▪';
          messages.push(`${icon} **${card.group}** • ${card.name} - \`${card.cardCode}\``);
        });
        break;
      
      case 'CURRENCY':
        const currencies = [];
        if (result.updates.crystals) currencies.push(`${result.updates.crystals} <:rose:1461015415466496191> Crystals`);
        if (result.updates.astralEssence) currencies.push(`${result.updates.astralEssence} ✨ Astral Essence`);
        if (result.updates.stardust) currencies.push(`${result.updates.stardust} ⭐ Stardust`);
        if (result.updates.fantasiaTokens) currencies.push(`${result.updates.fantasiaTokens} 🎫 Fantasia Tokens`);
        if (result.updates.reverieGem) currencies.push(`${result.updates.reverieGem} 💠 Reverie Gems`);
        if (result.updates.selca) currencies.push(`${result.updates.selca} 📸 Selca`);
        if (result.updates.candyCanes) currencies.push(`${result.updates.candyCanes} 🍬 Candy Canes`);
        messages.push(`💰 Received:\n${currencies.map(c => `+ ${c}`).join('\n')}`);
        break;
      
      case 'PACKS':
        const packCodes = result.packs.map(p => `\`${p.packCode}\``).join(', ');
        messages.push(`📦 Received ${result.packs.length} pack${result.packs.length > 1 ? 's' : ''}!\nCodes: ${packCodes}`);
        break;
      
      case 'MEGA':
        messages.push('🎉 **MEGA REWARD!**');
        result.results.forEach(r => messages.push(this.formatRewardMessage(r)));
        break;
    }

    return messages.join('\n\n');
  }

  // ========== CREATE CARD EMBED ==========
  static createCardEmbed(user, cards) {
    const conditionIcons = {
      damaged: "<:damaged:1268950803830407249>",
      worn: "<:worn:1268950805633826868>",
      good: "<:good:1268950807340908687>",
      mint: "<:mint:1268950809404641401>",
      pristine: "<:pristinee:1272529510696222842>"
    };

    const embed = {
      author: {
        name: `${user.username}'s Reward`,
        icon_url: user.avatarURL,
      },
      fields: [],
      color: 0x9966CC
    };

    cards.forEach(card => {
      embed.fields.push({
        name: `[${conditionIcons[card.condition.toLowerCase()]}] ${card.group} ${card.name}`,
        value: `**Rarity:** ${card.rarity}\n**Wellness:** ${card.cardWellness}\n**Code:** \`${card.cardCode}\``,
        inline: true
      });
    });

    return embed;
  }

  // ========== COMBINE CARD IMAGES ==========
  static async createCombinedImage(cards) {
    const buffers = cards.map(c => c.imageBuffer);
    return await CardGenerationService.createCombinedImage(buffers, {
      width: 300,
      height: 480,
      columns: Math.min(5, cards.length),
      padding: 0
    });
  }
}

module.exports = RewardService;