// commands/profile.js
const CardGenerationService = require("../services/CardGenerationService");

const Graphic       = require("../models/graphic");
const Currency      = require("../models/currency");
const CustomSetting = require("../models/customSetting");
const User          = require("../models/user");
const { CONDITION_EMOJIS, MARKETPLACE_EMOJIS, EMBED_COLORS } = require("../config/embedConstants");

const EMOJIS = {
  profile: {
    bio:     MARKETPLACE_EMOJIS.user,
    id:      "<:id:1269995999053746177>",
    crystal: MARKETPLACE_EMOJIS.crystal,
    card:    "<:cards:1268912869903437825>",
    mythic:  "<:xxxx:1256609881595838636>",
    favorite:"<:favorite:1269996041596567606>"
  }
};

const DIMENSIONS = { width: 600, height: 960 };

const DEFAULTS = {
  embedColor: "000000",
  profileDescription: "No bio set",
  favoriteCard: "No favorite card set",
  crystals: 0,
  travelerId: 0
};

class ProfileController {
  constructor() {
    this.name = "profile";
    this.description = "Shows your traveler profile";
    this.aliases = ["p", "prof", "me"];
    this.cooldown = 3000;
  }

  async execute(msg, args, client) {
    try {
      const { userId, targetUser } = await this.resolveTargetUser(msg, args, client);

      const graphic = await Graphic.findOne({ userId }).lean();
      if (!graphic?.isRegistered) return this.sendUnregistered(msg);

      // OPTIMIZED: Fetch all data in parallel including customSetting for favorite card lookup
      const [currency, customSetting, cardStats] = await Promise.all([
        Currency.findOne({ userId }).lean(),
        CustomSetting.findOne({ userId }).lean(),
        this.getCardStats(userId)
      ]);

      // Parse favorite card - can now run after we have customSetting
      const favoriteCardInfo = customSetting?.favoriteCard 
        ? await this.parseFavoriteCard(customSetting.favoriteCard)
        : null;

      const embed = this.buildEmbed({
        targetUser,
        graphic,
        currency,
        customSetting,
        cardStats,
        favoriteCardInfo
      });

      let attachment = null;

      if (customSetting?.favoriteCardImage && favoriteCardInfo?.card) {
        try {
          const overlayPromise = favoriteCardInfo.card.condition && favoriteCardInfo.card.condition.toLowerCase() !== 'good'
            ? CardGenerationService.preloadOverlay(favoriteCardInfo.card.group, favoriteCardInfo.card.rarity, favoriteCardInfo.card.condition, favoriteCardInfo.card.cardId)
            : Promise.resolve(null);

          const imageBuffer = await CardGenerationService.processCardImage(
            {
              imageURL: customSetting.favoriteCardImage,
              group:    favoriteCardInfo.card.group,
              rarity:   favoriteCardInfo.card.rarity,
              condition: favoriteCardInfo.card.condition
            },
            favoriteCardInfo.card.condition,
            overlayPromise
          );

          if (imageBuffer) {
            embed.image = { url: "attachment://favoriteCard.png" };
            attachment = { file: imageBuffer, name: "favoriteCard.png" };
          }
        } catch (err) {
          console.error("[Profile] Image generation failed:", err.message);
        }
      }

      await msg.channel.createMessage(
        { embeds: [embed], messageReference: { messageID: msg.id } },
        attachment
      );

    } catch (error) {
      console.error(`[Profile] Error:`, error);
      await msg.channel.createMessage({
        embeds: [{
          title: "Error",
          description: "Could not load profile.",
          color: 0xff4757
        }],
        messageReference: { messageID: msg.id }
      }).catch(() => {});
    }
  }

  // ── Safe avatar URL getter (works with both msg.author and getRESTUser) ──
  getAvatarURL(user) {
    if (!user) return "https://cdn.discordapp.com/embed/avatars/0.png";
    // Eris REST user → .avatarURL is a string OR function
    if (typeof user.avatarURL === "function") return user.avatarURL();
    if (user.avatarURL) return user.avatarURL;
    if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`;
    return `https://cdn.discordapp.com/embed/avatars/${(BigInt(user.id) >> 22n) % 6n}.png`;
  }

  async resolveTargetUser(msg, args, client) {
    let userId = msg.author.id;
    let targetUser = msg.author;

    const userArg = args.find(a => /^u(ser)?:/.test(a));
    if (userArg) {
      const id = userArg.split(":")[1]?.replace(/[<@!>]/g, "");
      if (id) {
        try {
          targetUser = await client.getRESTUser(id);
          userId = id;
        } catch {
          targetUser = msg.author; // fallback
        }
      }
    }

    return { userId, targetUser };
  }

  async getCardStats(discordId) {
    const result = await User.aggregate([
      { $match: { discordId } },
      {
        $group: {
          _id: null,
          overall: { $sum: 1 },
          mythic:  { $sum: { $cond: [{ $eq: ["$rarity", "Mythic"] }, 1, 0] } }
        }
      }
    ]);

    return result[0] || { overall: 0, mythic: 0 };
  }

  async parseFavoriteCard(json) {
    if (!json) return null;
    try {
      const data = JSON.parse(json);
      const card = await User.findOne({ cardCode: data.cardCode }).lean();
      if (!card) return { error: true };
      return {
        card,
        name: data.name || card.name,
        group: data.group || card.group,
        rarity: data.rarity || card.rarity
      };
    } catch {
      return { error: true };
    }
  }

  buildEmbed(d) {
    const { targetUser, graphic, currency, customSetting, cardStats, favoriteCardInfo } = d;

    const crystals   = currency?.crystals ?? DEFAULTS.crystals;
    const travelerId = (graphic?.travelerId ?? DEFAULTS.travelerId).toString().padStart(5, "0");
    const bio        = customSetting?.profileDescription || DEFAULTS.profileDescription;
    const color      = parseInt(customSetting?.embedColor || DEFAULTS.embedColor, 16) || 0x000000;

    const conditionEmoji = favoriteCardInfo?.card?.condition 
      ? CONDITION_EMOJIS[favoriteCardInfo.card.condition.toLowerCase()] || ""
      : "";
    
    const favText = favoriteCardInfo?.error
      ? "*Error loading card*"
      : !favoriteCardInfo
      ? `*${DEFAULTS.favoriteCard}*`
      : `${conditionEmoji} **${favoriteCardInfo.name}**\n\`${favoriteCardInfo.group}\` · \`${favoriteCardInfo.rarity}\``;

    const avatarURL = this.getAvatarURL(targetUser);

    return {
      author: {
        name: `${targetUser.username}'s Profile`,
        icon_url: avatarURL
      },
      description: `*"${bio}"*`,
      fields: [
        {
          name: `${EMOJIS.profile.id} Traveler ID`,
          value: `<@${targetUser.id}> · \`#${travelerId}\``,
          inline: true
        },
        {
          name: `${EMOJIS.profile.crystal} Crystals`,
          value: `\`${crystals.toLocaleString()}\``,
          inline: true
        },
        {
          name: `${EMOJIS.profile.card} Cards`,
          value: `\`${cardStats.overall.toLocaleString()}\``,
          inline: true
        },
        {
          name: `★★★★ Mythic`,
          value: `\`${cardStats.mythic.toLocaleString()}\``,
          inline: true
        },
        {
          name: `${EMOJIS.profile.favorite} Favorite Card`,
          value: favText,
          inline: false
        }
      ],
      color,
      timestamp: new Date(),
      thumbnail: { url: avatarURL }
    };
  }

  sendUnregistered(msg) {
    msg.channel.createMessage({
      embeds: [{
        title: "Registration Required",
        description: "Use `?register` to create your profile first!",
        color: 0xff6b6b
      }],
      messageReference: { messageID: msg.id }
    }).catch(() => {});
  }
}

module.exports = new ProfileController();