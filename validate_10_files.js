#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const files = [
  'services/CardGenerationService.js',
  'commands/show cards/info.js',
  'commands/deck.js',
  'commands/admin only/autoaddcard.js',
  'commands/admin only/scancards.js',
  'commands/admin only/addcard.js',
  'commands/admin only/fix.js',
  'commands/admin only/adminfix.js',
  'index.js',
  'scripts/migrateCardImagePaths.js'
];

console.log('Validating JavaScript files...\n');

let allValid = true;
const results = [];

files.forEach((file, index) => {
  const filePath = path.join(__dirname, file);
  
  console.log(`${index + 1}. ${file}`);
  
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`   ❌ FILE NOT FOUND`);
      results.push({ file, status: 'NOT_FOUND' });
      allValid = false;
      return;
    }
    
    const code = fs.readFileSync(filePath, 'utf-8');
    
    // Basic syntax validation: check for unmatched braces
    const openBrace = (code.match(/\{/g) || []).length;
    const closeBrace = (code.match(/\}/g) || []).length;
    const openParen = (code.match(/\(/g) || []).length;
    const closeParen = (code.match(/\)/g) || []).length;
    const openBracket = (code.match(/\[/g) || []).length;
    const closeBracket = (code.match(/\]/g) || []).length;
    
    const braceMatch = openBrace === closeBrace;
    const parenMatch = openParen === closeParen;
    const bracketMatch = openBracket === closeBracket;
    
    if (braceMatch && parenMatch && bracketMatch) {
      console.log(`   ✅ OK`);
      results.push({ file, status: 'OK' });
    } else {
      console.log(`   ❌ BRACKET MISMATCH`);
      if (!braceMatch) console.log(`      Braces: ${openBrace} open, ${closeBrace} close`);
      if (!parenMatch) console.log(`      Parens: ${openParen} open, ${closeParen} close`);
      if (!bracketMatch) console.log(`      Brackets: ${openBracket} open, ${closeBracket} close`);
      results.push({ file, status: 'BRACKET_MISMATCH' });
      allValid = false;
    }
  } catch (err) {
    console.log(`   ❌ ERROR: ${err.message}`);
    results.push({ file, status: 'ERROR', error: err.message });
    allValid = false;
  }
});

console.log('\n' + '='.repeat(70));
console.log('SUMMARY:');
console.log('='.repeat(70));

const passed = results.filter(r => r.status === 'OK').length;
const failed = results.filter(r => r.status !== 'OK').length;

console.log(`Passed: ${passed}/${files.length}`);
console.log(`Failed: ${failed}/${files.length}`);
console.log('='.repeat(70));

if (allValid) {
  console.log('\n✅ All files passed basic validation!\n');
  process.exit(0);
} else {
  console.log('\n⚠️  Some files have validation issues!\n');
  process.exit(1);
}
