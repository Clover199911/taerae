#!/usr/bin/env node
const { spawnSync } = require('child_process');
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

console.log('Running syntax validation checks...\n');

let hasErrors = false;
const results = [];

files.forEach((file, index) => {
  const filePath = path.join(__dirname, file);
  console.log(`${index + 1}. Checking ${file}...`);
  
  const result = spawnSync('node', ['--check', filePath], {
    encoding: 'utf-8',
    stdio: 'pipe'
  });
  
  if (result.error) {
    console.error(`   ❌ ERROR: ${result.error.message}`);
    results.push({ file, status: 'ERROR', error: result.error.message });
    hasErrors = true;
  } else if (result.status !== 0) {
    console.error(`   ❌ SYNTAX ERROR`);
    if (result.stderr) {
      console.error(`   ${result.stderr.trim()}`);
    }
    results.push({ file, status: 'SYNTAX_ERROR', error: result.stderr });
    hasErrors = true;
  } else {
    console.log(`   ✅ OK`);
    results.push({ file, status: 'OK' });
  }
});

console.log('\n' + '='.repeat(70));
console.log('SUMMARY:');
console.log('='.repeat(70));

const passed = results.filter(r => r.status === 'OK').length;
const failed = results.filter(r => r.status !== 'OK').length;

results.forEach(r => {
  if (r.status === 'OK') {
    console.log(`✅ ${r.file}`);
  } else {
    console.log(`❌ ${r.file}`);
    if (r.error) {
      console.log(`   Error: ${r.error.trim()}`);
    }
  }
});

console.log('='.repeat(70));
console.log(`Passed: ${passed}/${files.length}`);
console.log(`Failed: ${failed}/${files.length}`);

if (hasErrors) {
  process.exit(1);
} else {
  console.log('\n✅ All files passed syntax check!');
  process.exit(0);
}
