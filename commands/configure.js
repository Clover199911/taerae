const Eris = require("eris");
const CustomSetting = require("../models/customSetting");
const User = require("../models/user");

// Modal configurations for each profile option
const MODAL_CONFIG = {
  embedColor: {
    title: "🎨 Set Embed Color",
    label: "Hex Color Code",
    placeholder: "FF5733",
    style: 1, // Short input
    maxLength: 6,
    minLength: 6,
    required: true
  },
  profileDescription: {
    title: "📝 Set Your Bio",
    label: "Bio",
    placeholder: "Write your traveler's tale here...",
    style: 2, // Paragraph input
    maxLength: 256,
    minLength: 1,
    required: true
  },
  favoriteCard: {
    title: "⭐ Set Favorite Card",
    label: "Card Code",
    placeholder: "Enter the card code from your collection",
    style: 1, // Short input
    maxLength: 20,
    minLength: 1,
    required: true
  }
};

module.exports = {
  name: "configure",
  description: "Personalize your traveler's profile",
  async execute(msg, args, bot) {
    const userId = msg.author.id;

    const options = [
      { label: "Embed Color", value: "embedColor", description: "Paint your profile with a unique hue", emoji: { name: "🎨" } },
      { label: "Bio", value: "profileDescription", description: "Craft your traveler's tale", emoji: { name: "📝" } },
      { label: "Favorite Card", value: "favoriteCard", description: "Choose your most treasured card", emoji: { name: "⭐" } },
    ];

    const components = [{
      type: 1,
      components: [{
        type: 3,
        custom_id: `configure_select_${msg.id}`,
        placeholder: "Select an aspect of your profile to enhance",
        options: options
      }]
    }];

    const botMsg = await bot.createMessage(msg.channel.id, {
      embeds: [{
        title: "🎨 Profile Customization Studio",
        description: [
          "Welcome, esteemed traveler! Which aspect of your profile shall we configure today?",
          "",
          "**Available Options:**",
          "🎨 **Embed Color** - Customize your profile's color theme",
          "📝 **Bio** - Write a description about yourself",
          "⭐ **Favorite Card** - Showcase your most treasured card"
        ].join("\n"),
        color: 0x4ECDC4,
        footer: { text: "Select an option below to open the configuration modal" }
      }],
      components: components,
      messageReference: { messageID: msg.id }
    });

    // Handler for dropdown selection -> opens modal
    const handleSelectInteraction = async (interaction) => {
      try {
        if (interaction.type !== Eris.Constants.InteractionTypes.MESSAGE_COMPONENT) return;
        if (interaction.message.id !== botMsg.id) return;
        
        const interactionUserId = interaction.member?.id || interaction.user?.id;
        if (interactionUserId !== msg.author.id) return;

        const selectedOption = interaction.data.values[0];
        const modalConfig = MODAL_CONFIG[selectedOption];

        // Respond with a modal
        await interaction.createModal({
          title: modalConfig.title,
          custom_id: `configure_modal_${selectedOption}_${msg.id}`,
          components: [{
            type: 1,
            components: [{
              type: 4, // Text Input
              custom_id: "input_value",
              label: modalConfig.label,
              style: modalConfig.style,
              placeholder: modalConfig.placeholder,
              max_length: modalConfig.maxLength,
              min_length: modalConfig.minLength,
              required: modalConfig.required
            }]
          }]
        });
      } catch (error) {
        console.error("[Configure] Error opening modal:", error);
      }
    };

    // Handler for modal submission
    const handleModalSubmit = async (interaction) => {
      if (interaction.type !== Eris.Constants.InteractionTypes.MODAL_SUBMIT) return;
      
      const interactionUserId = interaction.member?.id || interaction.user?.id;
      if (interactionUserId !== msg.author.id) return;
      if (!interaction.data.custom_id.startsWith(`configure_modal_`) || !interaction.data.custom_id.endsWith(`_${msg.id}`)) return;

      // Extract the option type from custom_id
      const customIdParts = interaction.data.custom_id.split("_");
      const selectedOption = customIdParts[2]; // configure_modal_[OPTION]_msgId
      const newValue = interaction.data.components[0].components[0].value;

      try {
        if (selectedOption === "favoriteCard") {
          const card = await User.findOne({ discordId: userId, cardCode: newValue });
          if (!card) {
            await interaction.createMessage({
              embeds: [{
                title: "🕵️ Card Not Found",
                description: "Hmm, it seems this card is playing hide and seek! Please make sure you've entered a valid card code from your collection.",
                color: 0xFF6B6B
              }],
              flags: 64 // Ephemeral
            });
            return;
          }
          
          const favoriteCardString = JSON.stringify({
            cardCode: card.cardCode,
            name: card.name,
            group: card.group,
            rarity: card.rarity,
            condition: card.condition
          });
          
          await CustomSetting.findOneAndUpdate(
            { userId: userId },
            { 
              favoriteCard: favoriteCardString,
              favoriteCardImage: card.imageURL
            },
            { new: true, upsert: true }   
          );

          await interaction.createMessage({
            embeds: [{
              title: "🎉 Favorite Card Set!",
              description: `Your favorite card has been set to **${card.name}** from **${card.group}**!`,
              color: 0x45B7D1,
              footer: { text: "This card will now be displayed on your profile" }
            }],
            flags: 64
          });
        } else if (selectedOption === "embedColor") {
          // Validate hex color
          const hexRegex = /^[0-9A-Fa-f]{6}$/;
          if (!hexRegex.test(newValue)) {
            await interaction.createMessage({
              embeds: [{
                title: "❌ Invalid Color",
                description: "Please enter a valid 6-character hex code (e.g., FF5733, 4ECDC4).",
                color: 0xFF6B6B
              }],
              flags: 64
            });
            return;
          }

          await CustomSetting.findOneAndUpdate(
            { userId: userId },
            { embedColor: newValue.toUpperCase() },
            { new: true, upsert: true }
          );

          await interaction.createMessage({
            embeds: [{
              title: "🎨 Embed Color Updated!",
              description: `Your profile color has been set to \`#${newValue.toUpperCase()}\``,
              color: parseInt(newValue, 16),
              footer: { text: "Your profile now shines with a new hue!" }
            }],
            flags: 64
          });
        } else if (selectedOption === "profileDescription") {
          await CustomSetting.findOneAndUpdate(
            { userId: userId },
            { profileDescription: newValue },
            { new: true, upsert: true }
          );

          await interaction.createMessage({
            embeds: [{
              title: "📝 Bio Updated!",
              description: `Your bio has been set to:\n\n*"${newValue}"*`,
              color: 0x45B7D1,
              footer: { text: "Your story continues to unfold!" }
            }],
            flags: 64
          });
        }
      } catch (error) {
        console.error("Error updating user profile:", error);
        await interaction.createMessage({
          embeds: [{
            title: "🌋 A Wild Error Appeared!",
            description: "Oh no! It seems the cosmic forces are not aligning at the moment. Please try again later.",
            color: 0xFF6B6B
          }],
          flags: 64
        });
      }
    };

    // Register both handlers
    bot.on("interactionCreate", handleSelectInteraction);
    bot.on("interactionCreate", handleModalSubmit);

    // Cleanup after timeout
    setTimeout(() => {
      bot.off("interactionCreate", handleSelectInteraction);
      bot.off("interactionCreate", handleModalSubmit);
      
      const disabledComponents = components.map(row => ({
        ...row,
        components: row.components.map(component => ({
          ...component,
          disabled: true
        }))
      }));
      bot.editMessage(msg.channel.id, botMsg.id, { components: disabledComponents }).catch(() => {});
    }, 120000); // 2 minute timeout for modal interactions
  },
};