const Card = require("../../models/card");
const User = require("../../models/user");
const { conditionProbabilities, getRandomCardCondition } = require("../../utils/status");
const { generateUniqueCode } = require('../../utils/cardCodeGenerator');
const { isAdmin } = require("../../config/constants");

module.exports = {
  name: "generate",
  description: "Generates multiple cards with specified cardIDs and optional codes and conditions",
  execute: async (msg, args) => {
    if (!isAdmin(msg.author.id)) {
      return msg.channel.createMessage({ content: "You are not authorized to run this command", messageReference: { messageID: msg.id } });
    }

    const fullArgs = args.join(" ");
    
    // Extract card IDs (splitting by commas and cleaning up)
    const cardIdsMatch = fullArgs.match(/^([^code:|condition:].+?)(?=\s+code:|condition:|$)/i);
    if (!cardIdsMatch) {
      return msg.channel.createMessage({ content: "Please provide at least one card ID.", messageReference: { messageID: msg.id } });
    }
    
    const cardIds = cardIdsMatch[1].split(',').map(id => parseInt(id.trim())).filter(Boolean);
    
    if (cardIds.length === 0) {
      return msg.channel.createMessage({ content: "Invalid card IDs. Please provide valid card IDs.", messageReference: { messageID: msg.id } });
    }

    // Extract condition if specified
    const conditionMatch = fullArgs.match(/condition:\s*([^\s]+)/i);
    let specifiedCondition = null;
    if (conditionMatch) {
      const condition = conditionMatch[1].trim();
      const validCondition = conditionProbabilities.find(
        c => c.condition.toLowerCase() === condition.toLowerCase()
      );
      if (!validCondition) {
        return msg.channel.createMessage({
          content: `Invalid condition specified: ${condition}. Valid conditions are: ${conditionProbabilities
            .map(c => c.condition)
            .join(", ")}`,
          messageReference: { messageID: msg.id }
        });
      }
      specifiedCondition = validCondition.condition;
    }

    // Extract codes if specified
    const codeMatch = fullArgs.match(/code:\s*([^\s]+)/i);
    let specifiedCode = null;
    if (codeMatch) {
      specifiedCode = codeMatch[1].trim();
      const codeExists = await User.exists({ cardCode: specifiedCode });
      if (codeExists) {
        return msg.channel.createMessage({ content: `Code ${specifiedCode} already exists in a user's inventory`, messageReference: { messageID: msg.id } });
      }
    }

    const results = [];
    const errors = [];

    // Process each card
    for (let i = 0; i < cardIds.length; i++) {
      try {
        const cardId = cardIds[i];
        const closestCard = await Card.findOne({ cardId });
        
        if (!closestCard) {
          errors.push(`No card found with ID ${cardId}`);
          continue;
        }

        // Generate unique card code
        const cardCode = specifiedCode || await generateUniqueCode();

        // Get condition
        const cardCondition = specifiedCondition || getRandomCardCondition();

        // Increment print counter and get print number
        const updatedCard = await Card.findOneAndUpdate(
          { cardId },
          { $inc: { printCounter: 1 } },
          { new: true }
        );

        const printNumber = updatedCard.printCounter;

        // Create new card in user inventory
        const newCard = new User({
          discordId: msg.author.id,
          cardCode,
          name: closestCard.name,
          group: closestCard.group,
          rarity: closestCard.rarity,
          imageURL: closestCard.imageURL,
          cardWellness: calculateCardWellness(closestCard.rarity),
          condition: cardCondition,
          printNumber: printNumber,
          cardId: closestCard.cardId
        });

        await newCard.save();
        results.push({
          cardId,
          cardCode,
          name: closestCard.name,
          group: closestCard.group,
          rarity: closestCard.rarity,
          condition: cardCondition,
          printNumber: printNumber
        });
      } catch (err) {
        console.error(`Error processing card ${cardIds[i]}:`, err);
        errors.push(`Failed to generate card with ID ${cardIds[i]}: ${err.message}`);
      }
    }

    // Prepare response message
    let response = '';
    
    if (results.length > 0) {
      response += "Successfully generated the following cards:\n";
      results.forEach(result => {
        response += `• ID \`${result.cardId}\` - [#${result.printNumber}] Code: \`${result.cardCode}\`, Group: \`${result.group}\`, ` +
                   `Name: \`${result.name}\`, Rarity: \`${result.rarity}\`, Condition: \`${result.condition}\`\n`;
      });
    }

    if (errors.length > 0) {
      response += "\nErrors encountered:\n";
      errors.forEach(error => {
        response += `• ${error}\n`;
      });
    }

    return msg.channel.createMessage({ content: response, messageReference: { messageID: msg.id } });
  },
};

function calculateCardWellness(rarity) {
  switch (rarity) {
    case "Standard":
      return Math.floor(Math.random() * 50) + 1;
    case "Unique":
      return Math.floor(Math.random() * 50) + 51;
    case "Glyph":
      return Math.floor(Math.random() * 170) + 110;
    case "Mythic":
      return Math.floor(Math.random() * 250) + 300;
    default:
      return 0;
  }
}