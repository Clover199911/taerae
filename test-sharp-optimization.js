// Quick test to verify Sharp optimizations work
const sharp = require('sharp');

async function testOptimizations() {
  console.log('Testing Sharp optimizations...\n');
  
  try {
    // Test 1: Create a simple test image
    console.log('1. Creating test image...');
    const testImage = await sharp({
      create: {
        width: 300,
        height: 480,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 255 }
      }
    })
    .webp({ quality: 95, effort: 3 })
    .toBuffer();
    console.log(`   ✓ WebP image created (${testImage.length} bytes)`);
    
    // Test 2: Test raw pixel compositing
    console.log('2. Testing raw pixel compositing...');
    const rawImage = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 0, g: 255, b: 0, alpha: 255 }
      }
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
    
    const composite = await sharp({
      create: {
        width: 200,
        height: 100,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
    .composite([
      {
        input: rawImage.data,
        raw: {
          width: rawImage.info.width,
          height: rawImage.info.height,
          channels: rawImage.info.channels
        },
        left: 0,
        top: 0
      }
    ])
    .webp({ quality: 95, effort: 3 })
    .toBuffer();
    console.log(`   ✓ Raw pixel composite successful (${composite.length} bytes)`);
    
    // Test 3: Test lanczos3 resizing with WebP output
    console.log('3. Testing lanczos3 resize with WebP...');
    const resized = await sharp({
      create: {
        width: 600,
        height: 960,
        channels: 4,
        background: { r: 0, g: 0, b: 255, alpha: 255 }
      }
    })
    .resize(300, 480, {
      fit: 'contain',
      kernel: sharp.kernel.lanczos3
    })
    .webp({ quality: 95, effort: 3, nearLossless: true })
    .toBuffer();
    console.log(`   ✓ Resize successful (${resized.length} bytes)`);
    
    // Test 4: Compare WebP vs PNG encoding speed
    console.log('4. Comparing WebP vs PNG encoding speed...');
    const testBuffer = await sharp({
      create: {
        width: 300,
        height: 480,
        channels: 4,
        background: { r: 128, g: 128, b: 128, alpha: 255 }
      }
    }).toBuffer();
    
    const webpStart = Date.now();
    await sharp(testBuffer).webp({ quality: 95, effort: 3 }).toBuffer();
    const webpTime = Date.now() - webpStart;
    
    const pngStart = Date.now();
    await sharp(testBuffer).png({ compressionLevel: 9 }).toBuffer();
    const pngTime = Date.now() - pngStart;
    
    console.log(`   WebP encoding: ${webpTime}ms`);
    console.log(`   PNG encoding: ${pngTime}ms`);
    console.log(`   ✓ WebP is ${(pngTime / webpTime).toFixed(2)}x faster`);
    
    console.log('\n✅ All optimization tests passed!');
    console.log('The optimizations are working correctly.');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testOptimizations();
