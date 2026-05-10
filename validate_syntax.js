const fs = require('fs');
const path = require('path');
const vm = require('vm');

const files = [
  'index.js',
  'middleware/rateLimiter.js',
  'commands/configure.js',
  'commands/bot.js',
  'commands/help.js',
  'commands/balance.js',
  'services/CardGenerationService.js',
  'services/VoucherExpirationService.js'
];

console.log('Starting syntax validation...\n');

let hasErrors = false;

files.forEach(file => {
  const filePath = path.join(__dirname, file);
  console.log(`Checking ${file}...`);
  
  try {
    const code = fs.readFileSync(filePath, 'utf-8');
    
    // Try to compile the code to check for syntax errors
    new vm.Script(code, {
      filename: file,
      lineOffset: 0,
      columnOffset: 0
    });
    
    console.log(`  ✅ OK`);
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.error(`  ❌ SYNTAX ERROR: ${err.message}`);
      console.error(`     Line ${err.stack.match(/:\d+/g)?.[0] || 'unknown'}`);
      hasErrors = true;
    } else {
      console.error(`  ❌ ERROR: ${err.message}`);
      hasErrors = true;
    }
  }
});

console.log('\n' + '='.repeat(60));

if (hasErrors) {
  console.log('⚠️  Syntax errors found!');
  process.exit(1);
} else {
  console.log('✅ All files passed syntax validation!');
  process.exit(0);
}
