const Card = require("../../models/card");

moduleexports = {
  name: "assigncardids",
  description: "Assigns cardIds to existing cards",
  async execute(msg, args) {
    try {
      const cardsWithoutCardId = await Card.find({ cardId: { $exists: false } });
      let nextCardId = 1;

      for (const card of cardsWithoutCardId) {
        card.cardId = nextCardId;
        await card.save();
        nextCardId++;
      }

      return msg.channel.createMessage({ content: "CardIds assigned successfully.", messageReference: { messageID: msg.id } });
    } catch (error) {
      console.error("An error occurred while assigning CardIds:", error);
      return msg.channel.createMessage({ content: "An error occurred while assigning CardIds.", messageReference: { messageID: msg.id } });
    }
  },
};
