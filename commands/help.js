const Eris = require("eris");
const fs = require('fs');
const path = require('path');

module.exports = {
name: 'help',
description: 'Displays a help message with available commands',

async execute(msg, args, bot) {
const userId = msg.author.id;

    function getAllCommandFiles(dir, fileList = []) {
      const files = fs.readdirSync(dir);
      
      files.forEach(file => {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
          getAllCommandFiles(filePath, fileList);
        } else if (file.endsWith('.js')) {
          fileList.push(filePath);
        }
      });
      
      return fileList;
    }

const commandsPath = path.join(__dirname, '../commands');
    const commandFiles = getAllCommandFiles(commandsPath);

const categories = {
  'Getting Started': ['register'],
  'Card Commands': ['gift', 'drop', 'daily', 'fortune'],
  'Currency Commands': ['balance', 'pay', 'melt', 'travel', 'star'],
  'Marketplace Commands': ['marketplace'],
  'Profile Commands': ['profile', 'configure'],
  'Collection Commands': ['group', 'pristine', 'cabinet', 'cards'],
  'Other Commands': ['enhance', 'leaderboard', 'view', 'info', 'tier']
};

const commandData = {};

for (const filePath of commandFiles) {
  try {
    const command = require(filePath);
    if (!command.name) continue;
    
    const aliases = command.aliases ? ` (${command.aliases.map(a => `?${a}`).join(', ')})` : '';
    commandData[command.name] = `\`?${command.name}\`${aliases} - ${command.description || 'No description'}`;
  } catch (err) {
    console.error(`Error loading ${file}:`, err);
  }
} 

const commands = Object.entries(categories).map(([category, cmdNames]) => {
  const cmdList = cmdNames
    .filter(name => commandData[name])
    .map(name => commandData[name])
    .join('\n');
  
  return {
    label: category,
    value: cmdList || 'No commands in this category'
  };
}).filter(cat => cat.value !== 'No commands in this category');

const options = commands.map((command, index) => ({
  label: command.label,
  value: index.toString(),
  description: command.value.split('\n')[0].split(' - ')[1]?.substring(0, 50) || 'View commands'
}));

const components = [{
  type: 1,
  components: [{
    type: 3,
    custom_id: 'select_help_command',
    placeholder: 'Select a command category',
    options: options
  }]
}];

const embed = {
  color: 0xB9B0AE,
  title: 'Taerae Bot Commands',
  description: 'Please select a category from the dropdown menu below to see the available commands.',
  footer: {
    text: `Requested by ${msg.author.username}`,
    icon_url: msg.author.avatarURL
  },
  timestamp: new Date()
};

const botMsg = await bot.createMessage(msg.channel.id, {
  embeds: [embed],
  components: components
});

const handleInteraction = async (interaction) => {
  if (interaction.type !== Eris.Constants.InteractionTypes.MESSAGE_COMPONENT) return;
  if (interaction.message.id !== botMsg.id) return;
  if (interaction.member.id !== msg.author.id) return;

  const selectedIndex = parseInt(interaction.data.values[0]);
  const selectedCommand = commands[selectedIndex];

  const updatedEmbed = {
    color: 0xB9B0AE,
    title: 'Taerae Bot Commands',
    description: selectedCommand.value,
    footer: {
      text: `Requested by ${msg.author.username}`,
      icon_url: msg.author.avatarURL
    },
    timestamp: new Date()
  };

  await bot.editMessage(msg.channel.id, botMsg.id, { embeds: [updatedEmbed] });
  await interaction.acknowledge();
};

bot.on('interactionCreate', handleInteraction);

setTimeout(() => {
  bot.off('interactionCreate', handleInteraction);
  
  const disabledComponents = [{
    type: 1,
    components: [{
      type: 3,
      custom_id: 'disabled',
      placeholder: 'This help menu has expired',
      options: [],
      disabled: true
    }]
  }];
  
  bot.editMessage(msg.channel.id, botMsg.id, { 
    components: disabledComponents 
  }).catch(() => {});
}, 60000);

}
};