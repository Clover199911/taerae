// commands/battle/battleImage.js - Image generation for battles
// ============================================================================

const sharp = require('sharp');
const { CARD_DIMENSIONS } = require('../../config/battle');

/**
 * Create VS comparison image (user card vs bot card)
 * Similar to enhance.js arrow style but with VS
 */
async function createVSImage(userCardBuffer, botCardBuffer) {
  try {
    const width = CARD_DIMENSIONS.width;
    const height = CARD_DIMENSIONS.height;

    // Create VS text SVG
    const vsText = Buffer.from(`
      <svg width="120" height="${height}">
        <rect width="120" height="${height}" fill="rgba(0,0,0,0)"/>
        <text 
          x="60" 
          y="${height / 2}" 
          font-size="48" 
          font-weight="bold"
          text-anchor="middle" 
          dominant-baseline="middle"
          fill="white"
          font-family="Arial, sans-serif"
        >VS</text>
      </svg>
    `);

    // Composite: User card | VS | Bot card
    const vsImage = await sharp({
      create: {
        width: (width * 2) + 120, // Two cards + VS space
        height: height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
    .composite([
      { input: userCardBuffer, left: 0, top: 0 },
      { input: vsText, left: width, top: 0 },
      { input: botCardBuffer, left: width + 120, top: 0 }
    ])
    .webp({ quality: 100, effort: 2 }) // FAST: effort 2 for quick battles
    .toBuffer();

    return vsImage;
  } catch (error) {
    console.error('VS image creation error:', error);
    // FALLBACK: Return a simple side-by-side composite without VS text
    try {
      return await createFallbackComposite(userCardBuffer, botCardBuffer);
    } catch (fallbackError) {
      console.error('Fallback composite also failed:', fallbackError);
      throw error; // Re-throw original error if fallback also fails
    }
  }
}

/**
 * Fallback composite when VS image fails - simple side-by-side
 */
async function createFallbackComposite(leftBuffer, rightBuffer) {
  const width = CARD_DIMENSIONS.width;
  const height = CARD_DIMENSIONS.height;
  const gap = 20;

  return sharp({
    create: {
      width: (width * 2) + gap,
      height: height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
  .composite([
    { input: leftBuffer, left: 0, top: 0 },
    { input: rightBuffer, left: width + gap, top: 0 }
  ])
  .webp({ quality: 100, effort: 1 })
  .toBuffer();
}

/**
 * Create reroll comparison image (before -> after)
 * Shows old card and new card with arrow
 */
async function createRerollComparisonImage(oldCardBuffer, newCardBuffer) {
  try {
    const width = CARD_DIMENSIONS.width;
    const height = CARD_DIMENSIONS.height;

    // Create arrow SVG
    const arrow = Buffer.from(`
      <svg width="80" height="${height}">
        <text 
          x="40" 
          y="${height / 2}" 
          font-size="60" 
          text-anchor="middle" 
          dominant-baseline="middle"
          fill="white"
        >→</text>
      </svg>
    `);

    const comparisonImage = await sharp({
      create: {
        width: (width * 2) + 80, // Two cards + arrow
        height: height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
    .composite([
      { input: oldCardBuffer, left: 0, top: 0 },
      { input: arrow, left: width, top: 0 },
      { input: newCardBuffer, left: width + 80, top: 0 }
    ])
    .webp({ quality: 100, effort: 2 })
    .toBuffer();

    return comparisonImage;
  } catch (error) {
    console.error('Reroll comparison image error:', error);
    throw error;
  }
}

module.exports = {
  createVSImage,
  createRerollComparisonImage,
  createFallbackComposite
};