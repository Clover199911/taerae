const Graphic = require("../models/graphic");
const Currency = require("../models/currency");

let nextId = 1;

module.exports = {
  name: "register",
  description: "Registers the user",
  async execute(msg, args) {
    const userId = msg.author.id;
    const graphic = await Graphic.findOne({ userId });

    if (graphic && graphic.isRegistered) {
      return msg.channel.createMessage({ content: "You're already a registered traveler, ready to step on your exciting journey with the bot! Enjoy exploring and making the most of your adventures!", messageReference: { messageID: msg.id } });
    }

    if (graphic) {
      graphic.isRegistered = true;
      await graphic.save(); // 👈 THIS WAS MISSING!
    } else {
      const maxTravelerId = await Graphic.find().sort({ travelerId: -1 }).limit(1).then(result => result[0]?.travelerId ?? 0);
      nextId = maxTravelerId + 1;

      const newGraphic = new Graphic({
        userId,
        isRegistered: true,
        travelerId: nextId,
      });

      await newGraphic.save();
    }

// Create currency record ONLY if it doesn't exist
let currency = await Currency.findOne({ userId: msg.author.id });
if (!currency) {
  currency = new Currency({
    userId: msg.author.id,
    crystals: 0,
    fantasiaTokens: 0,
    stardust: 0,
    astralEssence: 0,
    reverieGem: 0,
  });
  await currency.save();
}

    const number = graphic ? graphic.travelerId : nextId;
    const paddedNumber = number.toString().padStart(5, '0');

    const message = `Behold! your **traveler ID:** \`${paddedNumber}\`.\nMay your dreams unfold into the exciting adventures!`;
    return msg.channel.createMessage({
      content: `Welcome to the ethereal realm, ${msg.author.mention}! ${message}`,
      messageReference: { messageID: msg.id }
    });
  },
};