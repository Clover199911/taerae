const Card = require("../models/card");
const Graphic = require("../models/graphic");
const sharp = require("sharp");
const { readImageBufferFromCard } = require("../utils/cardImageSource");

module.exports = {
    name: "deck",
    description: "Shows a collage of cards from a specific group and rarity",
    async execute(msg, args, bot) {
        // Validate arguments
        if (!args.length) {
            return bot.createMessage(msg.channel.id, {
                content: "Please specify a group name. Usage: `?deck <group> [rarity]`",
                messageReference: { messageID: msg.id }
            });
        }

        // Parse group and rarity from args
        const rarity = ['standard', 'unique', 'glyph', 'mythic'].find(r => 
            args[args.length - 1].toLowerCase() === r
        );
        const groupTerms = rarity ? args.slice(0, -1) : args;
        const groupQuery = groupTerms.join(' ');

        try {
            // Try exact match first
            let cards = await findCards(groupQuery, rarity, true);
            
            // If no exact match found, try lenient search
            if (!cards.length) {
                cards = await findCards(groupQuery, rarity, false);
            }

            if (!cards.length) {
                return bot.createMessage(msg.channel.id, {
                    content: `No cards found for group: \`${groupQuery}\`${rarity ? ` with rarity: \`${rarity}\`` : ''}`,
                    messageReference: { messageID: msg.id }
                });
            }

            // Get the matched group name for consistency
            const matchedGroup = cards[0].group;
            
            // Filter to ensure all cards are from the same group
            cards = cards.filter(card => card.group === matchedGroup);

            // Create loading message
            const loadingMsg = await bot.createMessage(msg.channel.id, {
                content: "Generating deck collage...",
                messageReference: { messageID: msg.id }
            });

            // Get stats for the specific group
            const stats = await getGroupStats(matchedGroup);

            // Group images by rarity
            const cardsByRarity = cards.reduce((acc, card) => {
                if (!acc[card.rarity]) acc[card.rarity] = [];
                acc[card.rarity].push(card);
                return acc;
            }, {});

            // Download and process images - ALL rarities in parallel
            const allDownloads = [];
            const rarityIndices = {}; // Track which indices belong to which rarity
            let currentIndex = 0;

            for (const [rarity, rarityCards] of Object.entries(cardsByRarity)) {
                rarityIndices[rarity] = { start: currentIndex, count: rarityCards.length };
                rarityCards.forEach(card => {
                    allDownloads.push(
                        readImageBufferFromCard(card, { timeout: 20000 })
                    );
                });
                currentIndex += rarityCards.length;
            }

            // Download all images in parallel (much faster)
            const allBuffers = await Promise.all(allDownloads);

            // Reorganize back by rarity
            const imageBuffersByRarityProcessed = {};
            for (const [rarity, { start, count }] of Object.entries(rarityIndices)) {
                imageBuffersByRarityProcessed[rarity] = allBuffers.slice(start, start + count);
            }

            // Create collage
            const collage = await createCollage(imageBuffersByRarityProcessed);

            // Create embed
            const embed = {
                title: `${matchedGroup} Collection ${rarity ? `(${rarity.toUpperCase()})` : ''}`,
                description: generateStatsText(stats),
                color: 0xcaf0f8,
                image: { url: "attachment://deck.webp" }, // Changed from .png
                footer: {
                    text: `Requested by ${msg.author.username}`,
                    icon_url: msg.author.avatarURL
                }
            };

            // Send final message
            await bot.createMessage(msg.channel.id, { embed }, {
                file: collage,
                name: "deck.webp" // Changed from .png
            });

            // Delete loading message
            await loadingMsg.delete();

        } catch (error) {
            console.error("Error in deck command:", error);
            return bot.createMessage(msg.channel.id, {
                content: "An error occurred while generating the deck collage.",
                messageReference: { messageID: msg.id }
            });
        }
    }
};

async function findCards(groupQuery, rarity, exactMatch) {
    const query = {
        group: exactMatch 
            ? new RegExp(`^${groupQuery}$`, 'i')  // Exact match (case-insensitive)
            : new RegExp(groupQuery, 'i')         // Partial match
    };

    if (rarity) {
        query.rarity = rarity;
    }

    return Card.find(query).sort({ rarity: -1, name: 1 });
}

async function getGroupStats(group) {
    const stats = await Card.aggregate([
        { $match: { group: group } },
        { $group: {
            _id: "$rarity",
            count: { $sum: 1 }
        }},
        { $sort: { _id: 1 } }
    ]);

    return stats;
}

function generateStatsText(stats) {
    const total = stats.reduce((sum, stat) => sum + stat.count, 0);

    const rarityLines = stats
        .map(stat => `${stat._id.charAt(0).toUpperCase() + stat._id.slice(1)}: ${stat.count}`)
        .join('\n');

    return `Total Cards: ${total}\n\n${rarityLines}`;
}

async function createCollage(imageBuffersByRarity) {
    const CARD_WIDTH = 300;
    const CARD_HEIGHT = 480;
    const SPACING = 20; // Space between rarity sections
    const MAX_WIDTH = 1920; // Adjust based on the desired width

    const composites = [];
    let currentTop = 0;

    for (const [rarity, buffers] of Object.entries(imageBuffersByRarity)) {
        const cardsPerRow = Math.floor(MAX_WIDTH / CARD_WIDTH);
        let rows = Math.ceil(buffers.length / cardsPerRow);
        const sectionHeight = rows * CARD_HEIGHT + SPACING;

        // Adjust if there is only one card in the last row
        if (buffers.length % cardsPerRow === 1 && rows > 1) {
            rows -= 1; // Remove the last row
        }

        // OPTIMIZED: Process with raw pixel data for faster compositing
        const processedImages = await Promise.all(
            buffers.map(buffer =>
                sharp(buffer)
                    .resize(CARD_WIDTH, CARD_HEIGHT, {
                        fit: "contain",
                        background: { r: 0, g: 0, b: 0, alpha: 0 },
                        kernel: sharp.kernel.lanczos3
                    })
                    .raw()
                    .toBuffer({ resolveWithObject: true })
            )
        );

        // Add images to the composite array
        processedImages.forEach((obj, index) => {
            const rowPosition = Math.floor(index / cardsPerRow);
            const itemsInRow = Math.min(cardsPerRow, buffers.length - rowPosition * cardsPerRow);
            const leftOffset = ((cardsPerRow - itemsInRow) * CARD_WIDTH) / 2;

            composites.push({
                input: obj.data,
                raw: {
                    width: obj.info.width,
                    height: obj.info.height,
                    channels: obj.info.channels
                },
                left: leftOffset + (index % cardsPerRow) * CARD_WIDTH,
                top: currentTop + rowPosition * CARD_HEIGHT
            });
        });

        // Update the top position for the next rarity section
        currentTop += sectionHeight;
    }

    const collageWidth = MAX_WIDTH;
    const collageHeight = currentTop;

    // OPTIMIZED: Generate final image with WebP
    return sharp({
        create: {
            width: collageWidth,
            height: collageHeight,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    })
        .composite(composites)
        .webp({ quality: 100, effort: 3 })
        .toBuffer();
}
