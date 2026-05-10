//  fortune.js  –  Moon Button Card Game
// ------------------------------------------------------------------
const Cooldown = require("../../models/cooldown");
const Card = require("../../models/card");
const CardGenerationService = require('../../services/CardGenerationService');
const { RARITY_EMOJIS, CONDITION_EMOJIS } = require('../../config/embedConstants');
const { logCardSpawn } = require('../../utils/cardSpawnLogger');

// ----------  CONFIG  ----------
const COOLDOWN_DURATION = 5 * 60 * 1000; // 5 min
const INTERACTION_TIMEOUT = 30 * 1000;     // 30 s

// ----------  CARD DISTRIBUTION CHANCES  ----------
const DISTRIBUTION_CHANCES = {
  ONE_CARD: 0.89,    // 89% - only 1 button has a card
  TWO_CARDS: 0.07,   // 7% - 2 buttons have cards
  THREE_CARDS: 0.04  // 4% - all 3 buttons have cards (jackpot!)
};

// ----------  CARD RARITY CHANCES  ----------
const RARITY_CHANCES = {
  Standard: { chance: 0.55, possibleCards: ["Standard"] },
  Unique: { chance: 0.30, possibleCards: ["Unique", "Standard"] },
  Glyph: { chance: 0.12, possibleCards: ["Glyph", "Unique", "Standard"] },
  Mythic: { chance: 0.03, possibleCards: ["Mythic", "Glyph", "Unique"] }
};

// ----------  CACHE  ----------
const cooldownCache = new Map();
const cardCache = new Map();

// ----------  HELPERS  ----------
function determineCardDistribution() {
  const random = Math.random();
  
  if (random < DISTRIBUTION_CHANCES.ONE_CARD) {
    // One card - random position
    const position = Math.floor(Math.random() * 3);
    return [position];
  } else if (random < DISTRIBUTION_CHANCES.ONE_CARD + DISTRIBUTION_CHANCES.TWO_CARDS) {
    // Two cards - random positions
    const positions = [0, 1, 2];
    const shuffled = positions.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 2);
  } else {
    // Jackpot - all three
    return [0, 1, 2];
  }
}

function selectWeightedRarity() {
  const random = Math.random();
  let cumulativeChance = 0;
  let selectedRarity = "Standard";
  
  const rarities = Object.keys(RARITY_CHANCES);
  for (const rarity of rarities) {
    cumulativeChance += RARITY_CHANCES[rarity].chance;
    if (random <= cumulativeChance) {
      selectedRarity = rarity;
      break;
    }
  }
  
  const possibleRarities = RARITY_CHANCES[selectedRarity].possibleCards;
  return possibleRarities[Math.floor(Math.random() * possibleRarities.length)];
}

// ----------  COMMAND  ----------
module.exports = {
  name: "fortune",
  aliases: ["ft"],
  description: "Test your fortune with the moon buttons",

  async execute(msg, args, client) {
    const userId = msg.author.id;

    try {
      // Cooldown check
      const cooldown = await this.checkCooldown(userId);
      if (cooldown.active) {
        return msg.channel.createMessage({
          content: `<@${userId}>, please wait ${cooldown.time} before seeking fortune again.`,
          messageReference: { messageID: msg.id }
        });
      }

      // Determine which buttons have cards
      const cardPositions = determineCardDistribution();
      console.log(`[FORTUNE] User ${userId} - Card positions:`, cardPositions);

      // Create moon buttons with different moon phases
      const moonEmojis = ["🌔", "🌓", "🌒"];
      const buttons = [0, 1, 2].map(idx => ({
        type: 2,
        style: 2, // Grey style
        custom_id: `fortune_${idx}`,
        emoji: { name: moonEmojis[idx] }
      }));

      const fortuneEmbed = {
        title: "🔮 Fortune Telling",
        description: `Choose a moon to reveal your fate...`,
        color: 0x9b59b6,
        footer: { text: `${msg.author.username}'s Fortune` },
        timestamp: new Date()
      };

      const fortuneMsg = await msg.channel.createMessage({
        embeds: [fortuneEmbed],
        components: [{ type: 1, components: buttons }],
        messageReference: { messageID: msg.id }
      });

      // Setup collector
      const filter = i => i.message.id === fortuneMsg.id && i.member?.id === userId;
      let handled = false;

      const collector = async i => {
        if (!filter(i) || handled) return;
        handled = true;

        await i.acknowledge();

        const chosenIdx = parseInt(i.data.custom_id.split("_")[1]);
        const hasCard = cardPositions.includes(chosenIdx);

        // Update buttons to show results
        const moonEmojis = ["🌔", "🌓", "🌒"];
        const resultButtons = [0, 1, 2].map(idx => ({
          type: 2,
          style: cardPositions.includes(idx) ? 3 : 4, // Green if has card, Red if empty
          custom_id: `fortune_${idx}`,
          emoji: { name: moonEmojis[idx] },
          disabled: true
        }));

        if (hasCard) {
          // Generate and save card
          const rarity = selectWeightedRarity();
          const generatedCard = await CardGenerationService.generateCard(userId, { rarity });
          
          if (generatedCard) {
            await CardGenerationService.saveCardsToDatabase([generatedCard.cardData]);
            
            // Log card spawn
            logCardSpawn({
              userId: userId,
              username: msg.author.username,
              cardName: generatedCard.cardData.name,
              group: generatedCard.cardData.group,
              rarity: generatedCard.cardData.rarity,
              condition: generatedCard.cardData.condition,
              cardCode: generatedCard.cardData.cardCode,
              printNumber: generatedCard.cardData.printNumber,
              command: 'fortune',
              channelId: msg.channel.id,
              channelName: msg.channel.name || 'DM',
              guildId: msg.guildID || 'DM',
              guildName: msg.channel.guild?.name || 'DM',
              isCosmic: false
            }).catch(err => console.error('[FORTUNE_LOG_ERROR]', err));

            const rarityEmoji = RARITY_EMOJIS[generatedCard.cardData.rarity.toLowerCase()] || "⭐";
            const conditionEmoji = CONDITION_EMOJIS[generatedCard.cardData.condition.toLowerCase()] || generatedCard.cardData.condition;

            const successEmbed = {
              title: "✨ Fortune Smiles Upon You!",
              description: `${rarityEmoji}\n- [#${generatedCard.cardData.printNumber || '???'}] ${conditionEmoji} ${generatedCard.cardData.group} ${generatedCard.cardData.name} - \`${generatedCard.cardData.cardCode}\``,
              color: 0x57f287, // Green
              thumbnail: { url: "attachment://fortune_card.png" }, // Reference the attachment
              footer: {
                text: msg.author.username,
                icon_url: msg.author.avatarURL
              },
              timestamp: new Date()
            };

            // Edit message with embed AND file attachment (like drop.js)
            await fortuneMsg.edit({
              embeds: [successEmbed],
              components: [{ type: 1, components: resultButtons }]
            }, { 
              file: generatedCard.imageBuffer, 
              name: "fortune_card.png" 
            });
          }
        } else {
          // No card - better luck message
          const failEmbed = {
            title: "🌑 Fortune Eludes You",
            description: `The moon you chose was empty... Better luck next time!\n\n*Green moons ${cardPositions.length > 1 ? 'were' : 'was'} the winning ${cardPositions.length > 1 ? 'choices' : 'choice'}.*`,
            color: 0xe74c3c, // Red
            footer: { text: `${msg.author.username}'s Fortune` },
            timestamp: new Date()
          };

          await fortuneMsg.edit({
            embeds: [failEmbed],
            components: [{ type: 1, components: resultButtons }]
          });
        }

        await this.setCooldown(userId);
        client.removeListener("interactionCreate", collector);
      };

      client.on("interactionCreate", collector);

      // Timeout handler
      setTimeout(() => {
        if (!handled) {
          client.removeListener("interactionCreate", collector);
          fortuneMsg.edit({
            embeds: [{
              title: "⏰ Fortune Telling Expired",
              description: "You took too long to choose. The fortune teller has left.",
              color: 0xe74c3c
            }],
            components: []
          }).catch(() => {});
        }
      }, INTERACTION_TIMEOUT);

    } catch (err) {
      console.error("Fortune error:", err);
      msg.channel.createMessage({
        content: "⚠️ An error occurred. Please try again later.",
        messageReference: { messageID: msg.id }
      });
    }
  },

  // ----------  Cooldown Management  ----------
  async checkCooldown(userId) {
    const cached = cooldownCache.get(userId);
    if (cached && cached.expires > Date.now()) {
      const remaining = Math.ceil((cached.expires - Date.now()) / 1000);
      return { active: true, time: `${remaining}s` };
    }

    const cd = await Cooldown.findOne({ user: userId, command: "fortune" })
                             .select("cooldownEnd")
                             .lean();
    if (cd && cd.cooldownEnd > Date.now()) {
      const minutes = Math.floor((cd.cooldownEnd - Date.now()) / 60000);
      const seconds = Math.floor((cd.cooldownEnd - Date.now()) / 1000) % 60;
      return { active: true, time: `${minutes}m ${seconds}s` };
    }
    return { active: false };
  },

  async setCooldown(userId) {
    const expires = Date.now() + COOLDOWN_DURATION;
    cooldownCache.set(userId, { expires });
    await Cooldown.findOneAndUpdate(
      { user: userId, command: "fortune" },
      { cooldownEnd: new Date(expires) },
      { upsert: true }
    );
  }
};

// Periodic cache cleanup
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cooldownCache.entries()) {
    if (v.expires < now) cooldownCache.delete(k);
  }
  if (cardCache.size > 500) cardCache.clear();
}, 60000);