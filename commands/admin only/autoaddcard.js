const Card = require("../../models/card");
const { isAdmin } = require("../../config/constants");
const fs = require("fs").promises;
const path = require("path");
const {
    IMAGE_ROOT_ABSOLUTE,
    buildImagePath,
    buildPublicImageUrl,
    isImageFilename
} = require("../../utils/cardImageSource");

const BASE_PATH = IMAGE_ROOT_ABSOLUTE;

// Valid rarities
const VALID_RARITIES = ["Standard", "Unique", "Glyph", "Mythic", "Event"];

/**
 * Reads directory entries from local Taerae Images directory
 */
async function readDirectoryEntries(dirPath) {
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        return entries.map((entry) => ({
            type: entry.isDirectory() ? "dir" : "file",
            name: entry.name
        }));
    } catch {
        return null;
    }
}

/**
 * Gets all group names from local image directory
 */
async function getAvailableGroups() {
    const contents = await readDirectoryEntries(BASE_PATH);
    if (!contents || !Array.isArray(contents)) return [];
    
    return contents
        .filter(item => item.type === 'dir')
        .map(item => item.name);
}

/**
 * Gets available rarities for a specific group
 */
async function getAvailableRarities(group) {
    const contents = await readDirectoryEntries(path.join(BASE_PATH, group));
    if (!contents || !Array.isArray(contents)) return [];
    
    return contents
        .filter(item => item.type === 'dir')
        .map(item => item.name);
}

/**
 * Gets available card images for a specific group and rarity
 */
async function getAvailableCards(group, rarity) {
    const contents = await readDirectoryEntries(path.join(BASE_PATH, group, rarity));
    if (!contents || !Array.isArray(contents)) return [];
    
    return contents
        .filter(item => item.type === 'file' && isImageFilename(item.name))
        .map(item => ({
            name: item.name.replace(/\.(png|jpg|jpeg|gif|webp)$/i, ''),
            filename: item.name
        }));
}

/**
 * Finds the closest match for a string in an array (case-insensitive)
 */
function findClosestMatch(input, options) {
    const lowerInput = input.toLowerCase();
    
    // Exact match (case-insensitive)
    const exactMatch = options.find(opt => opt.toLowerCase() === lowerInput);
    if (exactMatch) return { match: exactMatch, exact: true };
    
    // Partial match
    const partialMatch = options.find(opt => opt.toLowerCase().includes(lowerInput) || lowerInput.includes(opt.toLowerCase()));
    if (partialMatch) return { match: partialMatch, exact: false };
    
    // Levenshtein distance for close matches
    let closestMatch = null;
    let closestDistance = Infinity;
    
    for (const option of options) {
        const distance = levenshteinDistance(lowerInput, option.toLowerCase());
        if (distance < closestDistance && distance <= 3) { // Max 3 edits
            closestDistance = distance;
            closestMatch = option;
        }
    }
    
    return closestMatch ? { match: closestMatch, exact: false } : null;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a, b) {
    const matrix = [];
    
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    
    return matrix[b.length][a.length];
}

/**
 * Builds local/public image metadata from group/rarity/filename
 */
function buildImageMetadata(group, rarity, filename) {
    const imagePath = buildImagePath(group, rarity, filename);
    const imageURL = buildPublicImageUrl(imagePath);
    if (!imageURL) {
        throw new Error("PUBLIC_BASE_URL (or HEROKU_APP_NAME) is required for local image URLs.");
    }
    return { imagePath, imageURL };
}

// Store pending confirmations
const pendingConfirmations = new Map();

module.exports = {
    name: "autoaddcard",
    description: "Automatically adds a card by scanning local Taerae Images with validation",
    async execute(msg, args) {
        try {
            // Check admin permissions
            if (!msg.webhookID && !isAdmin(msg.author.id)) {
                return msg.channel.createMessage({ 
                    content: "You are not authorized to run this command", 
                    messageReference: { messageID: msg.id } 
                });
            }

            const argString = args.join(" ").trim();

            // Handle confirmation responses
            if (argString.toLowerCase() === "confirm" || argString.toLowerCase() === "yes") {
                const pending = pendingConfirmations.get(msg.author.id);
                if (!pending) {
                    return msg.channel.createMessage({
                        content: "No pending card to confirm. Use `?autoaddcard group, rarity, name` first.",
                        messageReference: { messageID: msg.id }
                    });
                }

                // Check if confirmation is still valid (5 minute timeout)
                if (Date.now() - pending.timestamp > 300000) {
                    pendingConfirmations.delete(msg.author.id);
                    return msg.channel.createMessage({
                        content: "Confirmation expired. Please run the command again.",
                        messageReference: { messageID: msg.id }
                    });
                }

                // Add the card
                const { group, rarity, name, imageURL, imagePath } = pending;
                
                const existingCard = await Card.findOne({
                    name,
                    group,
                    rarity,
                    $or: [{ imagePath }, { imageURL }]
                });
                if (existingCard) {
                    pendingConfirmations.delete(msg.author.id);
                    return msg.channel.createMessage({ 
                        content: "This card is already in the database!", 
                        messageReference: { messageID: msg.id } 
                    });
                }

                const lastCard = await Card.findOne({}, {}, { sort: { cardId: -1 } });
                const nextCardId = lastCard ? lastCard.cardId + 1 : 1;

                const card = new Card({
                    cardId: nextCardId,
                    rarity,
                    name,
                    group,
                    imageURL,
                    imagePath,
                    spawnable: true,
                    dateAdded: new Date(),
                    printCounter: 0
                });

                await card.save();
                pendingConfirmations.delete(msg.author.id);

                const embed = {
                    author: {
                        name: msg.author ? msg.author.username : "Webhook",
                        icon_url: msg.author ? msg.author.avatarURL : null,
                    },
                    color: 0x00FF00,
                    description: `## ✅ Card Added Successfully!
**Rarity**
- ${card.rarity}
**Group**
- ${card.group}
**Name**
- ${card.name}
**Card Id**
- ${card.cardId}
**Spawnable**
- ${card.spawnable}
**Date Added**
- ${card.dateAdded.toISOString().split('T')[0]}
`,
                    thumbnail: {
                        url: card.imageURL,
                    },
                };

                return msg.channel.createMessage({ embed, messageReference: { messageID: msg.id } });
            }

            // Handle cancel
            if (argString.toLowerCase() === "cancel" || argString.toLowerCase() === "no") {
                if (pendingConfirmations.has(msg.author.id)) {
                    pendingConfirmations.delete(msg.author.id);
                    return msg.channel.createMessage({
                        content: "Card addition cancelled.",
                        messageReference: { messageID: msg.id }
                    });
                }
                return msg.channel.createMessage({
                    content: "No pending card to cancel.",
                    messageReference: { messageID: msg.id }
                });
            }

            // Parse arguments: group, rarity, name
            const parts = argString.split(",").map(p => p.trim()).filter(p => p);
            
            if (parts.length < 3) {
                return msg.channel.createMessage({
                    content: `**Usage:** \`?autoaddcard group, rarity, name\`
                    
**Example:** \`?autoaddcard Dreamcatcher, Mythic, Dami\`

The command will:
1. Verify the group exists in Taerae Images
2. Verify the rarity folder exists
3. Find the card image and validate spelling
4. Show you a preview for confirmation

**Valid Rarities:** ${VALID_RARITIES.join(", ")}`,
                    messageReference: { messageID: msg.id }
                });
            }

            const [inputGroup, inputRarity, inputName] = parts;

            // Step 1: Fetch and validate group
            await msg.channel.createMessage({
                content: "🔍 Scanning local Taerae Images folder...",
                messageReference: { messageID: msg.id }
            });

            const availableGroups = await getAvailableGroups();
            if (availableGroups.length === 0) {
                return msg.channel.createMessage({
                    content: "❌ Could not read local Taerae Images folder. Please verify the folder exists on the server.",
                    messageReference: { messageID: msg.id }
                });
            }

            const groupMatch = findClosestMatch(inputGroup, availableGroups);
            if (!groupMatch) {
                return msg.channel.createMessage({
                    content: `❌ Group "${inputGroup}" not found. No close matches found.\n\nAvailable groups include: ${availableGroups.slice(0, 10).join(", ")}...`,
                    messageReference: { messageID: msg.id }
                });
            }

            const group = groupMatch.match;
            const groupWarning = !groupMatch.exact ? `⚠️ Group corrected: "${inputGroup}" → **${group}**\n` : "";

            // Step 2: Validate rarity
            const rarityMatch = findClosestMatch(inputRarity, VALID_RARITIES);
            if (!rarityMatch) {
                return msg.channel.createMessage({
                    content: `❌ Invalid rarity "${inputRarity}".\n\n**Valid rarities:** ${VALID_RARITIES.join(", ")}`,
                    messageReference: { messageID: msg.id }
                });
            }

            const rarity = rarityMatch.match;
            const rarityWarning = !rarityMatch.exact ? `⚠️ Rarity corrected: "${inputRarity}" → **${rarity}**\n` : "";

            // Step 3: Check if rarity folder exists for this group
            const availableRarities = await getAvailableRarities(group);
            if (!availableRarities.includes(rarity)) {
                return msg.channel.createMessage({
                    content: `❌ No ${rarity} cards found for ${group}.\n\n**Available rarities for ${group}:** ${availableRarities.join(", ") || "None"}`,
                    messageReference: { messageID: msg.id }
                });
            }

            // Step 4: Find the card in the folder
            const availableCards = await getAvailableCards(group, rarity);
            if (availableCards.length === 0) {
                return msg.channel.createMessage({
                    content: `❌ No card images found in ${group}/${rarity}`,
                    messageReference: { messageID: msg.id }
                });
            }

            const cardNames = availableCards.map(c => c.name);
            const cardMatch = findClosestMatch(inputName, cardNames);
            
            if (!cardMatch) {
                return msg.channel.createMessage({
                    content: `❌ Card "${inputName}" not found in ${group}/${rarity}.\n\n**Available cards:** ${cardNames.join(", ")}`,
                    messageReference: { messageID: msg.id }
                });
            }

            const cardInfo = availableCards.find(c => c.name === cardMatch.match);
            const name = cardMatch.match;
            const nameWarning = !cardMatch.exact ? `⚠️ Name corrected: "${inputName}" → **${name}**\n` : "";

            // Build local image metadata
            const { imageURL, imagePath } = buildImageMetadata(group, rarity, cardInfo.filename);

            // Check if card already exists
            const existingCard = await Card.findOne({
                name,
                group,
                rarity,
                $or: [{ imagePath }, { imageURL }]
            });
            if (existingCard) {
                return msg.channel.createMessage({ 
                    content: `❌ This card is already in the database!\n\n**Card ID:** ${existingCard.cardId}`, 
                    messageReference: { messageID: msg.id } 
                });
            }

            // Store pending confirmation
            pendingConfirmations.set(msg.author.id, {
                group,
                rarity,
                name,
                imageURL,
                imagePath,
                timestamp: Date.now()
            });

            // Show confirmation preview
            const warnings = groupWarning + rarityWarning + nameWarning;
            
            const confirmEmbed = {
                author: {
                    name: msg.author.username,
                    icon_url: msg.author.avatarURL,
                },
                color: 0xFFAA00,
                title: "📋 Card Preview - Confirm Addition",
                description: `${warnings}
**Group:** ${group}
**Rarity:** ${rarity}
**Name:** ${name}

**Image URL (Local):**
\`${imageURL}\`

Reply with \`?autoaddcard confirm\` to add this card
Reply with \`?autoaddcard cancel\` to cancel`,
                thumbnail: {
                    url: imageURL,
                },
                footer: {
                    text: "This confirmation expires in 5 minutes"
                }
            };

            return msg.channel.createMessage({ embed: confirmEmbed, messageReference: { messageID: msg.id } });

        } catch (error) {
            console.error("Error in autoaddcard command:", error);
            return msg.channel.createMessage({ 
                content: `❌ An error occurred: ${error.message}`, 
                messageReference: { messageID: msg.id } 
            });
        }
    },
};
