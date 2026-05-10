//  pay.js — crystal transfer system between users
// -----------------------------------------------------------------------------
const Currency = require("../models/currency");
const Graphic  = require("../models/graphic");
const Eris     = require("eris");

/* --------------- CONSTANTS --------------- */
const CONSTANTS = {
  TIMEOUT_DURATION : 30000,
  
  COLORS : {
    ERROR   : 0xFF6B6B,
    PRIMARY : 0xcaf0f8,
    SUCCESS : 0x4ade80,
    CANCEL  : 0xff4d6d
  },
  
  EMOJI_IDS : {
    CHECKMARK : "1269279366999703552",
    CROSS     : "1269279369256239245"
  }
};

const activeCollectors = new Map();

/* --------------- EMBED TEMPLATES --------------- */
const createEmbed = {
  error: (title, description) => ({
    title       : `🚫 ${title}`,
    description,
    color       : CONSTANTS.COLORS.ERROR,
    footer      : { text : "Your epic saga awaits!" }
  }),

  confirmation: (amount, recipientId) => ({
    title       : "<:crystal:1121690506238361670> Crystal Payment",
    description : `Are you sure you want to transfer ${amount.toLocaleString()} crystals to <@${recipientId}>?`,
    color       : CONSTANTS.COLORS.PRIMARY,
    footer      : { text : "This request will expire in 30 seconds" }
  }),

  success: (author, recipientId, amount) => ({
    author : {
      name     : author.username,
      icon_url : author.avatarURL
    },
    title       : "<:zerose:1449661246407311455>  Payment Successful",
    description : `### You've transferred ${amount.toLocaleString()} crystals to <@${recipientId}>!`,
    color       : CONSTANTS.COLORS.SUCCESS,
    timestamp   : new Date(),
    footer      : { text : "Transaction completed" }
  }),

  cancelled: () => ({
    title       : "Payment Cancelled",
    description : "The crystal transfer has been cancelled.",
    color       : CONSTANTS.COLORS.CANCEL,
    timestamp   : new Date()
  }),

  timeout: () => ({
    title       : "Payment Expired",
    description : "The crystal transfer request has expired.",
    color       : CONSTANTS.COLORS.CANCEL,
    timestamp   : new Date()
  })
};

const createButtons = (disabled = false) => [
  {
    type      : 2,
    style     : 3,
    custom_id : "confirm_payment",
    label     : "Confirm",
    emoji     : { id : CONSTANTS.EMOJI_IDS.CHECKMARK, name : "checkmark" },
    disabled
  },
  {
    type      : 2,
    style     : 4,
    custom_id : "cancel_payment",
    label     : "Cancel",
    emoji     : { id : CONSTANTS.EMOJI_IDS.CROSS, name : "wrong" },
    disabled
  }
];

/* --------------- MAIN COMMAND --------------- */
module.exports = {
  name        : "pay",
  description : "Transfer crystals to another user",
  
  async execute(msg, args, client) {
    try {
      // Validate user registration
      const userId = msg.author.id;


      // Validate command arguments
      if (!args?.length || args.length < 2) {
        return msg.channel.createMessage({
          embeds           : [createEmbed.error(
            "Invalid Command",
            "Please provide a user mention or Discord ID and the amount to pay.\n\nExample: `?pay @user 100`"
          )],
          messageReference : { messageID : msg.id }
        });
      }

      // Parse recipient and amount
      const recipientMention = msg.mentions[0];
      const recipientId = recipientMention?.id || args[0].replace(/[<@!>]/g, "");
      const amount = parseInt(args[1]);

      // Validate Discord ID format (snowflake: 17-20 digits)
      if (!/^\d{17,20}$/.test(recipientId)) {
        return msg.channel.createMessage({
          embeds           : [createEmbed.error(
            "Invalid User",
            "Please provide a valid user mention or Discord ID."
          )],
          messageReference : { messageID : msg.id }
        });
      }

      if (!Number.isInteger(amount) || amount <= 0) {
        return msg.channel.createMessage({
          embeds           : [createEmbed.error(
            "Invalid Amount",
            "Please provide a valid positive number of crystals to transfer."
          )],
          messageReference : { messageID : msg.id }
        });
      }

      // Validate sender's balance
      const senderId = msg.author.id;
      
      if (senderId === recipientId) {
        return msg.channel.createMessage({
          embeds           : [createEmbed.error(
            "Invalid Recipient",
            "You cannot transfer crystals to yourself!"
          )],
          messageReference : { messageID : msg.id }
        });
      }

      const [senderCurrency, recipientCurrency] = await Promise.all([
        Currency.findOne({ userId : senderId }).lean(),
        Currency.findOne({ userId : recipientId }).lean()
      ]);

      if (!senderCurrency || senderCurrency.crystals < amount) {
        return msg.channel.createMessage({
          embeds : [createEmbed.error(
            "Insufficient Balance",
            `You need ${amount.toLocaleString()} crystals to make this transfer, but you only have ${(senderCurrency?.crystals || 0).toLocaleString()} crystals.`
          )],
          messageReference : { messageID : msg.id }
        });
      }

      if (!recipientCurrency) {
        return msg.channel.createMessage({
          embeds           : [createEmbed.error(
            "Invalid Recipient",
            "The recipient needs to register first before receiving crystals."
          )],
          messageReference : { messageID : msg.id }
        });
      }

      // Create confirmation message
      const confirmationMessage = await msg.channel.createMessage({
        embeds           : [createEmbed.confirmation(amount, recipientId)],
        messageReference : { messageID : msg.id },
        components       : [{ type : 1, components : createButtons() }]
      });

      await handlePaymentConfirmation(
        client, 
        confirmationMessage, 
        msg, 
        senderId, 
        recipientId, 
        amount
      );

    } catch (error) {
      console.error("Pay command error:", error);
      
      return msg.channel.createMessage({
        embeds           : [createEmbed.error(
          "Error",
          "An error occurred while processing the payment. Please try again."
        )],
        messageReference : { messageID : msg.id }
      });
    }
  }
};

/* --------------- CONFIRMATION HANDLER --------------- */
async function handlePaymentConfirmation(
  client, 
  confirmationMessage, 
  msg, 
  senderId, 
  recipientId, 
  amount
) {
  // Clean up any existing collector for this user
  const existingCollector = activeCollectors.get(msg.author.id);
  if (existingCollector) {
    client.removeListener("interactionCreate", existingCollector.handler);
    clearTimeout(existingCollector.timeout);
  }

  let isCollectorActive = true;

  const handleInteraction = async (interaction) => {
    if (!isCollectorActive) return;
    if (interaction.message.id !== confirmationMessage.id) return;
    if (interaction.member.id !== msg.author.id) return;

    isCollectorActive = false;

    try {
      // Acknowledge immediately
      await interaction.acknowledge();

      if (interaction.data.custom_id === "confirm_payment") {
        // Use atomic operation with balance check to prevent double-spend
        const senderUpdate = await Currency.findOneAndUpdate(
          { 
            userId   : senderId,
            crystals : { $gte : amount }
          },
          { $inc : { crystals : -amount } },
          { new : true }
        );

        if (!senderUpdate) {
          await client.editMessage(
            confirmationMessage.channel.id,
            confirmationMessage.id,
            {
              embeds     : [createEmbed.error(
                "Transaction Failed",
                "Insufficient balance. Your balance may have changed since starting this transaction."
              )],
              components : []
            }
          );
          
          cleanup();
          return;
        }

        // Sender deducted successfully, now credit recipient
        const recipientUpdate = await Currency.findOneAndUpdate(
          { userId : recipientId },
          { $inc : { crystals : amount } },
          { new : true }
        );

        if (!recipientUpdate) {
          // Rollback sender deduction
          await Currency.findOneAndUpdate(
            { userId : senderId },
            { $inc : { crystals : amount } }
          );

          await client.editMessage(
            confirmationMessage.channel.id,
            confirmationMessage.id,
            {
              embeds     : [createEmbed.error(
                "Transaction Failed",
                "Failed to credit recipient. Your crystals have been refunded."
              )],
              components : []
            }
          );
          
          cleanup();
          return;
        }

        await client.editMessage(
          confirmationMessage.channel.id,
          confirmationMessage.id,
          {
            embeds     : [createEmbed.success(msg.author, recipientId, amount)],
            components : []
          }
        );

      } else {
        await client.editMessage(
          confirmationMessage.channel.id,
          confirmationMessage.id,
          {
            embeds     : [createEmbed.cancelled()],
            components : []
          }
        );
      }

    } catch (error) {
      console.error("Payment interaction error:", error);
      
      await client.editMessage(
        confirmationMessage.channel.id,
        confirmationMessage.id,
        {
          embeds     : [createEmbed.error(
            "Transaction Failed",
            "An error occurred while processing the payment. Please try again."
          )],
          components : []
        }
      ).catch(() => {});
    } finally {
      cleanup();
    }
  };

  const timeoutId = setTimeout(async () => {
    if (isCollectorActive) {
      cleanup();
      
      await client.editMessage(
        confirmationMessage.channel.id,
        confirmationMessage.id,
        {
          embeds     : [createEmbed.timeout()],
          components : [{ type : 1, components : createButtons(true) }]
        }
      ).catch(() => {});
    }
  }, CONSTANTS.TIMEOUT_DURATION);

  const cleanup = () => {
    if (!isCollectorActive) return;
    
    isCollectorActive = false;
    clearTimeout(timeoutId);
    client.removeListener("interactionCreate", handleInteraction);
    activeCollectors.delete(msg.author.id);
  };

  client.on("interactionCreate", handleInteraction);
  
  activeCollectors.set(msg.author.id, {
    handler : handleInteraction,
    timeout : timeoutId,
    cleanup
  });
}

/* --------------- CLEANUP --------------- */
process.on("SIGINT", () => {
  activeCollectors.forEach(({ cleanup }) => cleanup());
  activeCollectors.clear();
});