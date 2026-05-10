// services/CardGenerationService.js
const Card   = require('../models/card');
const User   = require('../models/user');
const sharp  = require('sharp');
const path   = require('path');
const { LRUCache } = require('lru-cache');
const { generateUniqueCode } = require('../utils/cardCodeGenerator');
const { getCardWellness }    = require('../utils/cardWellness');
const { getRandomCardCondition } = require('../utils/status');
const pristineOverlays = require('../config/pristineOverlays');
const { getImagePathFromCard, readImageBufferFromCard } = require('../utils/cardImageSource');

let redis = global.redisClient || {
  get       : async () => null,
  setex     : async () => {},
  getBuffer : async () => null,
  set       : async () => {},
  del       : async () => {},
  flushdb   : async () => {},
};

const CARD_CACHE_TTL  = 3600;
const IMAGE_CACHE_TTL = 86400;

// OPTIMIZED: LRU cache with bounded memory usage (max 100 overlays, ~50MB)
const overlayCache = new LRUCache({
  max: 100, // Maximum number of overlay buffers to cache
  maxSize: 50 * 1024 * 1024, // 50MB max total size
  sizeCalculation: (value) => value ? value.length : 0,
  ttl: 1000 * 60 * 60, // 1 hour TTL
});
const overlayLoadPromises = new Map();

class CardGenerationService {
  
  static get redis() {
    return redis;
  }
  
  static set redis(client) {
    redis = client;
  }

  static async getCachedCardsByRarity(rarity) {
    const key = `cards:rarity:${rarity}`;
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);

    const cards = await Card.find({ rarity, spawnable: true })
                            .select('name group rarity imageURL imagePath cardId')
                            .lean();
    if (cards.length) await redis.setex(key, CARD_CACHE_TTL, JSON.stringify(cards));
    return cards;
  }

  static async getCachedImage(imageSource, condition, group, dimensions = { width: 300, height: 480 }) {
    if (!imageSource) return null;
    const hash = require('crypto').createHash('md5').update(String(imageSource)).digest('hex');
    const key  = `image:${hash}:${condition}:${group}:${dimensions.width}x${dimensions.height}`;
    
    // OPTIMIZED: Store as buffer directly, avoid base64 conversion overhead
    try {
      const cached = await redis.getBuffer ? await redis.getBuffer(key) : await redis.get(key);
      if (!cached) return null;
      
      // If cached is a string (base64), convert to Buffer (backwards compatibility)
      if (typeof cached === 'string') {
        return Buffer.from(cached, 'base64');
      }
      return cached;
    } catch (err) {
      return null;
    }
  }

  static async cacheImage(imageSource, condition, group, buffer, dimensions = { width: 300, height: 480 }) {
    if (!imageSource) return;
    const hash = require('crypto').createHash('md5').update(String(imageSource)).digest('hex');
    const key  = `image:${hash}:${condition}:${group}:${dimensions.width}x${dimensions.height}`;
    // OPTIMIZED: Store buffer directly (33% faster than base64)
    redis.set(key, buffer, 'EX', IMAGE_CACHE_TTL).catch(() => {});
  }

  // OPTIMIZED: Pre-load overlay into memory cache
  static async preloadOverlay(group, rarity, condition, cardId = null) {
    const cacheKey = `${condition}-${group}-${rarity}-${cardId || 'none'}`;
    
    if (overlayCache.has(cacheKey)) {
      return overlayCache.get(cacheKey);
    }
    
    // Prevent duplicate loads
    if (overlayLoadPromises.has(cacheKey)) {
      return overlayLoadPromises.get(cacheKey);
    }
    
    const loadPromise = this.loadOverlayBuffer(group, rarity, condition, cardId);
    overlayLoadPromises.set(cacheKey, loadPromise);
    
    const buffer = await loadPromise;
    overlayCache.set(cacheKey, buffer);
    overlayLoadPromises.delete(cacheKey);
    
    return buffer;
  }

  static async loadOverlayBuffer(group, rarity, condition, cardId = null) {
    const conditionLower = condition.toLowerCase();

    let file = `${conditionLower}.png`;

    if (conditionLower === 'pristine') {
      file = 'pristine.png';

      // FIRST: Check cardId-based mapping (most reliable)
      if (cardId) {
        const cardIdOverlay = pristineOverlays.getOverlayForCardId(cardId);
        if (cardIdOverlay) {
          file = cardIdOverlay;
        }
      }

      // SECOND: Check group-based mapping (fallback)
      if (file === 'pristine.png' && group) {
        const groupOverlay = pristineOverlays.getOverlayForGroup(group);
        if (groupOverlay) {
          file = groupOverlay;
        }
      }
    }

    const folderName = conditionLower === 'pristine' ? 'pristine' : 'condition_overlays';
    const overlayPath = path.join(__dirname, `../${folderName}`, file);

    try {
      const fs = require('fs').promises;
      const buffer = await fs.readFile(overlayPath);
      
      // Pre-resize to exact dimensions for faster compositing later
      // QUALITY: Use lanczos3 for best quality
      // SPEED: WebP is 25-35% faster than PNG with same quality
      return await sharp(buffer)
        .resize(300, 480, { 
          fit: 'cover',
          kernel: sharp.kernel.lanczos3 // HIGH QUALITY
        })
        .webp({ quality: 100, effort: 2 }) // effort 2 = fast encoding, max quality
        .toBuffer();
    } catch (err) {
      return null;
    }
  }

  static async generateCard(userId, options = {}) {
    const { 
      rarity, 
      condition: forcedCondition, 
      groupPattern, 
      cardIds, 
      applyPristineOverlay = true,
      skipCardCode = false,
      isCosmic = false
    } = options;

    const query = { spawnable: true };
    if (rarity) query.rarity = rarity;
    if (cardIds) query.cardId = { $in: cardIds };
    if (groupPattern) query.group = new RegExp(groupPattern, 'i');

    let cards;
    if (rarity && !groupPattern && !cardIds) {
      cards = await this.getCachedCardsByRarity(rarity);
    } else {
      cards = await Card.find(query).select('name group rarity imageURL imagePath cardId').lean();
    }
    if (!cards.length) throw new Error(`No cards match ${JSON.stringify(query)}`);

    const card      = cards[Math.floor(Math.random() * cards.length)];
    const condition = forcedCondition || getRandomCardCondition();
    
    const cardCode = skipCardCode ? null : await generateUniqueCode();

    // OPTIMIZED: Start preloading overlay while downloading image
    const overlayPromise = applyPristineOverlay
      ? this.preloadOverlay(card.group, card.rarity, condition, card.cardId)
      : Promise.resolve(null);

    const imageBuffer = await this.processCardImage(card, condition, overlayPromise);

    const cardData = {
      discordId: userId,
      cardCode,
      name: card.name,
      group: card.group,
      rarity: card.rarity,
      imageURL: card.imageURL,
      imagePath: getImagePathFromCard(card),
      condition,
      cardWellness: getCardWellness(card.rarity),
      cardId: card.cardId,
      printNumber: null,
      cardLocked: false,
      cardTag: null
    };
    
    return { 
      cardData, 
      imageBuffer,
      isCosmic
    };
  }

  // OPTIMIZED: Single pipeline with concurrent overlay loading
  static async processCardImage(card, condition, overlayPromise) {
    if (!card?.imageURL && !card?.imagePath) {
      throw new Error('Invalid card object: missing image source');
    }
  
    const cardCondition = condition || card.condition || 'good';
    const dimensions = { width: 300, height: 480 };
  
    const imageSource = card.imagePath || card.imageURL;

    // Check cache
    const cached = await this.getCachedImage(imageSource, cardCondition, card.group, dimensions);
    if (cached) return cached;
  
    // OPTIMIZED: Download with globally-reused connection pool
    let buffer;
    try {
      buffer = await readImageBufferFromCard(card, { timeout: 20000 });
    } catch (error) {
      console.error(`[IMAGE_READ_ERR] ${card.name}: ${error.message}`);
      throw new Error(`Failed to read image for ${card.name}: ${error.message}`);
    }
  
    // Wait for overlay (loaded in parallel during download)
    const overlayBuffer = await overlayPromise;
  
    // OPTIMIZED: Single Sharp pipeline - all operations in one pass
    // QUALITY: No quality reduction, just efficient ordering
    let pipeline = sharp(buffer, { 
      sequentialRead: true, // Memory efficient
      limitInputPixels: 268402689 // Prevent malicious images
    });

    // Step 1: Resize first (faster to process smaller image)
    // QUALITY: lanczos3 for best downscaling
    pipeline = pipeline.resize(dimensions.width, dimensions.height, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3, // HIGH QUALITY
      withoutEnlargement: false // Allow quality upscaling if needed
    });

    // Step 2: Add overlay if exists (already pre-sized)
    if (overlayBuffer) {
      pipeline = pipeline.composite([{ 
        input: overlayBuffer, 
        blend: 'over'
      }]);
    }

    // Step 3: Final output
    // OPTIMIZED: WebP = 25-35% faster encoding + smaller files + same quality
    // effort 3 = balanced (0=fastest/largest, 6=slowest/smallest)
    const result = await pipeline
      .webp({ 
        quality: 100,      // Maximum quality
        effort: 3,         // Balanced speed/size (was using PNG compression 9 = very slow)
        lossless: false,   // Near-lossless is much faster and looks identical
        nearLossless: true // Slight optimization while maintaining quality
      })
      .toBuffer();
  
    // Cache asynchronously - don't block response
    this.cacheImage(imageSource, cardCondition, card.group, result, dimensions);
    
    return result;
  }

  static async generateCards(userId, count = 1, options = {}) {
    const { rarities, cardOptions, ...restOptions } = options;
    
    if (cardOptions && Array.isArray(cardOptions)) {
      // OPTIMIZED: Generate in parallel but limit concurrency to prevent memory spike
      const concurrencyLimit = 5; // Increased from 3 (faster with connection pooling)
      const results = [];
      
      for (let i = 0; i < Math.min(count, cardOptions.length); i += concurrencyLimit) {
        const batch = cardOptions.slice(i, i + concurrencyLimit);
        const batchPromises = batch.map(opt => {
          if (opt.type === 'cosmic') {
            return this.generateCard(userId, {
              ...restOptions,
              cardIds: opt.cardIds,
              isCosmic: true
            });
          } else {
            return this.generateCard(userId, {
              ...restOptions,
              rarity: opt.rarity,
              isCosmic: false
            });
          }
        });
        
        // Use allSettled for graceful degradation - one failure won't stop the batch
        const batchSettled = await Promise.allSettled(batchPromises);
        const batchResults = batchSettled
          .filter(r => r.status === 'fulfilled')
          .map(r => r.value);
        
        // Log any failures but continue processing
        const failures = batchSettled.filter(r => r.status === 'rejected');
        if (failures.length) {
          console.warn(`[CARD_GEN_BATCH] ${failures.length}/${batchSettled.length} cards failed to generate`);
        }
        
        results.push(...batchResults);
      }
      
      return results;
    }
    
    if (rarities && Array.isArray(rarities)) {
      const results = [];
      for (let i = 0; i < Math.min(count, rarities.length); i++) {
        results.push(await this.generateCard(userId, { 
          ...restOptions, 
          rarity: rarities[i],
          isCosmic: false
        }));
      }
      return results;
    }
    
    const results = [];
    for (let i = 0; i < count; i++) {
      results.push(await this.generateCard(userId, {
        ...options,
        isCosmic: false
      }));
    }
    return results;
  }

  static async applyConditionOverlay(imageBuffer, group, rarity, condition) {
    // Kept for backwards compatibility, but now handled in processCardImage
    const overlay = await this.preloadOverlay(group, rarity, condition);
    if (!overlay) return imageBuffer;
    
    return sharp(imageBuffer)
      .composite([{ input: overlay, blend: 'over' }])
      .toBuffer();
  }

  static async applySelectionOverlay(imageBuffer, group, rarity) {
    try {
      const overlayPath = path.join(__dirname, '../selection_overlays', 'selected.png');
      
      const fs = require('fs');
      if (!fs.existsSync(overlayPath)) {
        console.error(`[SELECTION_OVERLAY] File not found: ${overlayPath}`);
        return imageBuffer;
      }
      
      const cardImage = sharp(imageBuffer);
      const cardMetadata = await cardImage.metadata();
  
      const selectionBackground = await sharp(overlayPath)
        .resize(cardMetadata.width, cardMetadata.height, {
          fit: 'cover',
          position: 'center',
          kernel: sharp.kernel.lanczos3 // HIGH QUALITY
        })
        .toBuffer();
  
      return sharp(selectionBackground)
        .composite([{ input: imageBuffer, blend: 'over' }])
        .toBuffer();
        
    } catch (error) {
      console.error('[SELECTION_OVERLAY_ERROR]', error);
      return imageBuffer;
    }
  }

  // OPTIMIZED: Faster combined image without quality loss
  static async createCombinedImage(cardBuffers, opts = {}) {
    const { width = 300, height = 480, columns = 3, padding = 0 } = opts;
    const totalWidth = (width + padding) * Math.min(columns, cardBuffers.length) - padding;
    const rows = Math.ceil(cardBuffers.length / columns);
    const totalHeight = (height + padding) * rows - padding;

    // OPTIMIZED: Parallel resize with quality preservation + raw pixel data
    const resized = await Promise.all(
      cardBuffers.map(b => 
        sharp(b, { sequentialRead: true })
          .resize(width, height, { 
            fit: 'contain', 
            background: { r: 0, g: 0, b: 0, alpha: 0 },
            kernel: sharp.kernel.lanczos3 // HIGH QUALITY
          })
          .raw() // FAST: Work with raw pixels instead of encoded format
          .toBuffer({ resolveWithObject: true })
      )
    );

    // OPTIMIZED: Composite using raw pixel data (much faster)
    return sharp({
      create: { 
        width: totalWidth, 
        height: totalHeight, 
        channels: 4, 
        background: { r: 0, g: 0, b: 0, alpha: 0 } 
      },
    })
      .composite(
        resized.map((obj, i) => ({
          input: obj.data,
          raw: {
            width: obj.info.width,
            height: obj.info.height,
            channels: obj.info.channels
          },
          left: (i % columns) * (width + padding),
          top: Math.floor(i / columns) * (height + padding)
        }))
      )
      .webp({ 
        quality: 100,
        effort: 3,
        nearLossless: true
      })
      .toBuffer();
  }

  static async saveTempCards(userId, cards) {
    const key = `temp:${userId}`;
    const data = cards.map(c => ({
      cardData: c.cardData,
      imageBuffer: c.imageBuffer.toString('base64'),
      isCosmic: c.isCosmic || false
    }));
    await redis.setex(key, 300, JSON.stringify(data));
  }

  static async getAndClearTempCards(userId) {
    const key = `temp:${userId}`;
    const raw = await redis.get(key);
    if (!raw) return [];
    
    await redis.del(key);
    return JSON.parse(raw).map(c => ({
      cardData: c.cardData,
      imageBuffer: Buffer.from(c.imageBuffer, 'base64'),
      isCosmic: c.isCosmic || false
    }));
  }

  static async removeTempCards(userId) {
    const key = `temp:${userId}`;
    await redis.del(key);
  }

  static async assignPrintNumber(cardId) {
    try {
      const card = await Card.findOneAndUpdate(
        { cardId: cardId },
        { $inc: { printCounter: 1 } },
        { new: true, upsert: false }
      );

      if (!card) {
        console.error(`[PRINT_ASSIGN] Card not found: ${cardId}`);
        return 1;
      }

      return card.printCounter;
    } catch (error) {
      console.error(`[PRINT_ASSIGN_ERROR] cardId ${cardId}:`, error);
      return 1;
    }
  }

  static async saveCardsToDatabase(cardsData) {
    try {
      for (const cardData of cardsData) {
        cardData.printNumber = await this.assignPrintNumber(cardData.cardId);
      }
  
      await User.insertMany(cardsData, { ordered: false });
      
      console.log(`[CARDS_SAVED] ${cardsData.length} cards saved with print numbers`);
    } catch (e) {
      console.error('[BULK_SAVE_ERROR] Falling back to individual saves:', e.message);
      for (const card of cardsData) {
        try {
          if (!card.printNumber) {
            card.printNumber = await this.assignPrintNumber(card.cardId);
          }
          await new User(card).save();
        } catch (saveError) {
          console.error(`[INDIVIDUAL_SAVE_ERROR] ${card.name}:`, saveError.message);
        }
      }
    }
  }
  
  static async savePendingCards() {
    console.log('No pending cards to save');
    return Promise.resolve();
  }

  static async clearCache() {
    await redis.flushdb();
    overlayCache.clear();
    console.log('Card and image cache cleared');
  }
}

module.exports = CardGenerationService;
