const fs = require('fs');
const path = require('path');

const files = [
  'commands/configure.js',
  'commands/bot.js',
  'commands/exchange.js',
  'commands/enhance.js',
  'commands/dreamwalkplaces.js',
  'commands/cards/claim.js',
  'commands/leaderboard.js',
  'commands/battle/battleHandler.js',
  'commands/help.js',
  'commands/cards/drop.js',
  'commands/cards/factory.js',
  'commands/cards/star.js',
  'commands/admin only/adminpay.js',
  'commands/cards/tier.js',
  'commands/admin only/adminfix.js',
  'commands/balance.js',
  'commands/battle/battle.js',
  'commands/print.js',
  'commands/admin only/voucherAdmin.js',
  'commands/profile.js',
  'commands/packs/pack.js',
  'commands/pristineCollection.js',
  'commands/travel.js',
  'commands/show cards/duplicates.js',
  'commands/show cards/cards.js',
];

const skipFiles = ['commands/bot.js', 'commands/help.js'];
let updatedCount = 0;

function replaceEmbedInFile(content) {
  let result = content;
  
  // Helper function to find matching closing brace
  function findMatchingBrace(str, openIndex) {
    let count = 1;
    let i = openIndex + 1;
    while (i < str.length && count > 0) {
      if (str[i] === '{') count++;
      else if (str[i] === '}') count--;
      i++;
    }
    return i;
  }
  
  // Replace patterns like: embed: someValue
  // This handles variables, function calls, and objects
  let changed = true;
  let iterations = 0;
  
  while (changed && iterations < 50) {
    changed = false;
    iterations++;
    const embedMatch = result.match(/embed:\s*({|\w|\.|\[|\()/);
    
    if (!embedMatch) break;
    
    const matchIndex = embedMatch.index;
    const startChar = embedMatch[1];
    let endIndex = matchIndex + 'embed:'.length;
    let valueStart = -1;
    
    // Find start of the value (skip whitespace)
    while (endIndex < result.length && /\s/.test(result[endIndex])) {
      endIndex++;
    }
    valueStart = endIndex;
    
    // Find end of the value
    if (result[endIndex] === '{') {
      // It's an object literal
      endIndex = findMatchingBrace(result, endIndex);
    } else if (result[endIndex] === '[') {
      // It's an array literal
      let count = 1;
      endIndex++;
      while (endIndex < result.length && count > 0) {
        if (result[endIndex] === '[') count++;
        else if (result[endIndex] === ']') count--;
        endIndex++;
      }
    } else {
      // It's a variable or function call - find next comma, closing brace, or newline
      while (endIndex < result.length) {
        const char = result[endIndex];
        if (char === ',' || char === '}' || char === ']' || char === '\n') {
          break;
        }
        endIndex++;
      }
    }
    
    // Extract the value
    const value = result.substring(valueStart, endIndex).trim();
    
    // Check if value is already wrapped in array
    if (!value.startsWith('[')) {
      const before = result.substring(0, matchIndex);
      const after = result.substring(endIndex);
      result = before + 'embeds: [' + value + ']' + after;
      changed = true;
    }
  }
  
  return result;
}

for (const file of files) {
  if (skipFiles.includes(file)) {
    console.log(`⊘ Skipping ${file}`);
    continue;
  }
  
  if (!fs.existsSync(file)) {
    console.log(`✗ Not found: ${file}`);
    continue;
  }
  
  let content = fs.readFileSync(file, 'utf8');
  const originalContent = content;
  
  // Apply the replacement function
  content = replaceEmbedInFile(content);
  
  if (content !== originalContent) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`✓ Updated: ${file}`);
    updatedCount++;
  } else {
    console.log(`○ No changes: ${file}`);
  }
}

console.log(`\nTotal files updated: ${updatedCount}`);
