// Quick test to check if our pack collage implementation loads correctly
try {
  console.log('Testing packCollageGenerator...');
  const packCollage = require('./utils/packCollageGenerator');
  console.log('✅ packCollageGenerator loaded successfully');
  
  console.log('Testing pack.js...');
  const pack = require('./commands/packs/pack');
  console.log('✅ pack.js loaded successfully');
  
  console.log('Testing index.js syntax...');
  require('./index.js');
  console.log('✅ index.js loaded successfully');
  
  console.log('🎉 All files passed syntax check!');
  process.exit(0);
} catch (err) {
  console.error('❌ Syntax error found:', err.message);
  console.error(err.stack);
  process.exit(1);
}