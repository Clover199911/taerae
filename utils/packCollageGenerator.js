// utils/packCollageGenerator.js
const sharp = require('sharp');
const CardGenerationService = require('../services/CardGenerationService');

const GRID_CONFIG = {
  maxCardsPerRow: 5,
  cardWidth: 300,
  cardHeight: 480,
  padding: 5,
  backgroundColor: { r: 0, g: 0, b: 0, alpha: 0 } // Transparent
};

/**
 * Generate a collage image for pack opening
 * All cards are shown in full color (no grayscale)
 * @param {Array} cards - Array of card objects from pack opening
 * @returns {Promise<Buffer>} - WebP image buffer
 */
async function generatePackCollage(cards) {
  const imagePromises = cards.map(async (card) => {
    try {
      // Load overlay for the card's condition
      const overlayPromise = CardGenerationService.loadOverlayBuffer(card.group, card.rarity, card.condition, card.cardId);
      
      // Process the card image with its condition and overlay
      return await CardGenerationService.processCardImage(card, card.condition, overlayPromise);
    } catch (error) {
      console.error(`Failed to process card ${card.name}:`, error);
      return null;
    }
  });

  const processedImages = await Promise.all(imagePromises);
  const validImages = processedImages.filter(Boolean);

  if (!validImages.length) {
    throw new Error('No valid card images to display');
  }

  const { rows, rowLayout, totalWidth, totalHeight } = calculateGridLayout(validImages.length);
  const compositeOps = buildCompositeOperations(validImages, rowLayout, totalWidth);

  if (!compositeOps.length) {
    throw new Error('No images to composite');
  }

  return sharp({
    create: {
      width: totalWidth,
      height: totalHeight,
      channels: 4,
      background: GRID_CONFIG.backgroundColor
    }
  })
  .composite(compositeOps)
  .webp({ quality: 100, effort: 3 })
  .toBuffer();
}

function calculateGridLayout(numCards) {
  const { maxCardsPerRow, cardWidth, cardHeight, padding } = GRID_CONFIG;

  // Single row
  if (numCards <= maxCardsPerRow) {
    return {
      rows: 1,
      rowLayout: [numCards],
      totalWidth: (cardWidth * numCards) + (padding * (numCards - 1)),
      totalHeight: cardHeight
    };
  }

  // Two rows for 6-10 cards
  if (numCards <= 10) {
    const firstRow = Math.ceil(numCards / 2);
    const secondRow = numCards - firstRow;
    const maxCardsInRow = Math.max(firstRow, secondRow);

    return {
      rows: 2,
      rowLayout: [firstRow, secondRow],
      totalWidth: (cardWidth * maxCardsInRow) + (padding * (maxCardsInRow - 1)),
      totalHeight: (cardHeight * 2) + padding
    };
  }

  // Multiple rows
  const rows = Math.ceil(numCards / maxCardsPerRow);
  const cardsPerRow = Math.ceil(numCards / rows);
  const rowLayout = [];
  let remainingCards = numCards;

  for (let i = 0; i < rows; i++) {
    const cardsForThisRow = Math.min(cardsPerRow, remainingCards);
    rowLayout.push(cardsForThisRow);
    remainingCards -= cardsForThisRow;
  }

  const maxCardsInRow = Math.max(...rowLayout);

  return {
    rows,
    rowLayout,
    totalWidth: (cardWidth * maxCardsInRow) + (padding * (maxCardsInRow - 1)),
    totalHeight: (cardHeight * rows) + (padding * (rows - 1))
  };
}

function buildCompositeOperations(validImages, rowLayout, totalWidth) {
  const { cardWidth, cardHeight, padding } = GRID_CONFIG;
  const compositeOps = [];
  let currentImageIndex = 0;

  for (let rowIndex = 0; rowIndex < rowLayout.length; rowIndex++) {
    const cardsInRow = rowLayout[rowIndex];
    const rowWidth = (cardWidth * cardsInRow) + (padding * (cardsInRow - 1));
    const rowOffset = Math.round((totalWidth - rowWidth) / 2);

    for (let colIndex = 0; colIndex < cardsInRow; colIndex++) {
      if (currentImageIndex >= validImages.length) break;
      
      compositeOps.push({
        input: validImages[currentImageIndex],
        left: Math.round(rowOffset + (colIndex * (cardWidth + padding))),
        top: Math.round(rowIndex * (cardHeight + padding))
      });
      
      currentImageIndex++;
    }
  }

  return compositeOps;
}

module.exports = {
  generatePackCollage
};
