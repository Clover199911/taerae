#!/usr/bin/env node
// Quick syntax check script
const { spawnSync } = require('child_process');
const path = require('path');

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

console.log('Starting syntax checks...\n');

let hasErrors = false;
const results = [];

files.forEach(file => {
  const filePath = path.join(__dirname, file);
  console.log(`Checking ${file}...`);
  
  const result = spawnSync('node', ['--check', filePath], {
    encoding: 'utf-8',
    stdio: 'pipe'
  });
  
  if (result.error) {
    console.error(`  ❌ ERROR: ${result.error.message}`);
    results.push({ file, status: 'ERROR', error: result.error.message });
    hasErrors = true;
  } else if (result.status !== 0) {
    console.error(`  ❌ SYNTAX ERROR:\n${result.stderr}`);
    results.push({ file, status: 'SYNTAX_ERROR', error: result.stderr });
    hasErrors = true;
  } else {
    console.log(`  ✅ OK`);
    results.push({ file, status: 'OK' });
  }
});

console.log('\n' + '='.repeat(60));
console.log('SUMMARY:');
console.log('='.repeat(60));

results.forEach(r => {
  if (r.status === 'OK') {
    console.log(`✅ ${r.file}`);
  } else {
    console.log(`❌ ${r.file}: ${r.status}`);
    if (r.error) {
      console.log(`   ${r.error}`);
    }
  }
});

if (hasErrors) {
  console.log('\n⚠️  Syntax errors found!');
  process.exit(1);
} else {
  console.log('\n✅ All files passed syntax check!');
  process.exit(0);
}
