const Card = require("../../models/card");
const { isAdmin, EMOJI_IDS } = require("../../config/constants");
const sharp = require("sharp");
const fs = require("fs").promises;
const path = require("path");
const {
    IMAGE_ROOT_ABSOLUTE,
    buildImagePath,
    buildPublicImageUrl,
    isImageFilename,
    readImageBufferFromCard
} = require("../../utils/cardImageSource");

const BASE_PATH = IMAGE_ROOT_ABSOLUTE;

// Valid rarities
const VALID_RARITIES = ["Standard", "Unique", "Glyph", "Mythic", "Event"];

// Collage configuration
const COLLAGE_CONFIG = {
    maxCardsPerRow: 5,
    cardWidth: 200,
    cardHeight: 320,
    padding: 8,
    backgroundColor: { r: 30, g: 30, b: 30, alpha: 1 }
};

// Store pending scans per user
const pendingScans = new Map();

/**
 * Scans local Taerae Images folder for files modified in the last 7 days
 * Returns list of recently added/updated image files
 */
async function fetchRecentlyAddedFiles() {
    try {
        const oneWeekAgoMs = Date.now() - (7 * 24 * 60 * 60 * 1000);
        const groups = await fs.readdir(BASE_PATH, { withFileTypes: true });
        const addedFiles = [];

        for (const groupDir of groups) {
            if (!groupDir.isDirectory()) continue;
            const group = groupDir.name;
            const rarityDirPath = path.join(BASE_PATH, group);
            const rarityDirs = await fs.readdir(rarityDirPath, { withFileTypes: true });

            for (const rarityDir of rarityDirs) {
                if (!rarityDir.isDirectory()) continue;
                const rarity = rarityDir.name;
                if (!VALID_RARITIES.includes(rarity)) continue;

                const cardsPath = path.join(rarityDirPath, rarity);
                const files = await fs.readdir(cardsPath, { withFileTypes: true });

                for (const file of files) {
                    if (!file.isFile() || !isImageFilename(file.name)) continue;
                    const fullPath = path.join(cardsPath, file.name);
                    const stats = await fs.stat(fullPath);
                    if (stats.mtimeMs < oneWeekAgoMs) continue;

                    const imagePath = buildImagePath(group, rarity, file.name);
                    const imageURL = buildPublicImageUrl(imagePath);
                    if (!imageURL) {
                        throw new Error("PUBLIC_BASE_URL (or HEROKU_APP_NAME) is required to generate local image URLs.");
                    }

                    addedFiles.push({
                        group,
                        rarity,
                        name: file.name.replace(/\.(png|jpg|jpeg|gif|webp)$/i, ''),
                        filename: file.name,
                        imagePath,
                        imageURL,
                        modifiedAt: new Date(stats.mtimeMs).toISOString()
                    });
                }
            }
        }

        return addedFiles;
    } catch (error) {
        console.error('Error scanning local images:', error.message);
        return [];
    }
}

/**
 * Fetches member list from Kprofiles.com
 * URL pattern: https://kprofiles.com/{group-name}-members-profile/
 * Returns: { found, members, officialName, url }
 * 
 * If cardNames provided, picks the result with best member match
 */
async function fetchKprofilesMembers(groupName, cardNames = []) {
    try {
        // Generate multiple URL variations to try
        const urlVariations = generateKprofilesURLs(groupName);
        console.log(`[Kprofiles] URLs to try for "${groupName}":`, urlVariations);
        
        // Collect all valid results
        const validResults = [];
        
        for (const url of urlVariations) {
            try {
                const response = await fetch(url, {
                    headers: { 'User-Agent': 'TaeraeBot/1.0' }
                });
                
                if (!response.ok) continue;
                
                const html = await response.text();
                
                // Extract official group name from page title
                // Format: <h1 class="entry-title h1">tripleS Moon Members Profile</h1>
                let officialName = groupName; // fallback to folder name
                const titleMatch = html.match(/<h1[^>]*class="entry-title[^"]*"[^>]*>([^<]+)\s+Members Profile<\/h1>/i);
                if (titleMatch) {
                    officialName = titleMatch[1].trim();
                }
                
                // Parse member names from the profile page
                const members = [];
                
                // Pattern: </span> Stage Name (Korean/Japanese) - capture English name before Korean
                // HTML format: <span>Stage Name:</span> Sullin (설린 / ソルリン)
                const stageNameMatches = html.matchAll(/>Stage Name:<\/span>\s*([A-Za-z]+(?:\s[A-Za-z]+)?)/gi);
                for (const match of stageNameMatches) {
                    let name = match[1].trim();
                    // Remove any trailing parentheses content
                    name = name.split('(')[0].trim();
                    // Just get the first name if it's a full name
                    if (name.includes(' ')) {
                        // Check if it looks like "Park Shion" format - keep just the stage name part
                        const parts = name.split(' ');
                        if (['Park', 'Lee', 'Kim', 'Choi', 'Jung', 'Kang', 'Yoon', 'Shin'].includes(parts[0])) {
                            name = parts.slice(1).join('');
                        } else {
                            name = parts[0];
                        }
                    }
                    if (name && name.length > 1 && !members.includes(name)) {
                        members.push(name);
                    }
                }
                
                if (members.length > 0) {
                    validResults.push({ found: true, members, officialName, url });
                    console.log(`[Kprofiles] Found "${officialName}" with members:`, members);
                }
            } catch (err) {
                // Skip failed URLs
            }
        }
        
        if (validResults.length === 0) {
            return { found: false, members: [], officialName: groupName };
        }
        
        // If only one result or no card names to compare, return first
        if (validResults.length === 1 || cardNames.length === 0) {
            return validResults[0];
        }
        
        // Compare each result against card names and pick best match
        const cardNamesLower = cardNames.map(n => n.toLowerCase());
        let bestResult = validResults[0];
        let bestMatchCount = 0;
        
        for (const result of validResults) {
            const matchCount = result.members.filter(m => 
                cardNamesLower.includes(m.toLowerCase())
            ).length;
            
            console.log(`[Kprofiles] "${result.officialName}" matches ${matchCount}/${cardNames.length} card names`);
            
            if (matchCount > bestMatchCount) {
                bestMatchCount = matchCount;
                bestResult = result;
            }
        }
        
        console.log(`[Kprofiles] Best match: "${bestResult.officialName}" with ${bestMatchCount} matches`);
        return bestResult;
        
    } catch (error) {
        console.error(`Kprofiles error for ${groupName}:`, error.message);
        return { found: false, members: [], officialName: groupName };
    }
}

/**
 * Generates multiple URL variations for Kprofiles
 * Handles: camelCase, spaces, parentheses, etc.
 */
function generateKprofilesURLs(groupName) {
    const urls = [];
    const base = 'https://kprofiles.com/';
    const suffix = '-members-profile/';
    
    // Variation 1: Simple lowercase with spaces to hyphens
    const simple = groupName.toLowerCase().replace(/[()]/g, '').replace(/\s+/g, '-').replace(/--+/g, '-');
    urls.push(base + simple + suffix);
    
    // Variation 2: Split camelCase (e.g., "BlackPink" -> "black-pink")
    const camelSplit = groupName
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .toLowerCase()
        .replace(/[()]/g, '')
        .replace(/\s+/g, '-')
        .replace(/--+/g, '-');
    if (camelSplit !== simple) {
        urls.push(base + camelSplit + suffix);
    }
    
    // Variation 3: Handle tripleS specifically (tripleSmoon -> triples-moon)
    // tripleS sub-units often use format: tripleS + SubUnitName (no space)
    if (groupName.toLowerCase().startsWith('triples')) {
        const afterTriples = groupName.substring(7); // Remove "tripleS"
        if (afterTriples) {
            const subUnit = afterTriples.toLowerCase().replace(/\s+/g, '-');
            urls.push(base + 'triples-' + subUnit + suffix);
        }
    }
    
    // Variation 4: For sub-units with space like "tripleS Moon"
    const subunitMatch = groupName.match(/^(tripleS|TWICE|BLACKPINK|BTS|EXO|NCT|SEVENTEEN|Stray Kids|aespa|ITZY|IVE|NewJeans|LE SSERAFIM)\s*(.+)$/i);
    if (subunitMatch) {
        const mainGroup = subunitMatch[1].toLowerCase().replace(/\s+/g, '');
        const subUnit = subunitMatch[2].toLowerCase().replace(/\s+/g, '-');
        urls.push(base + mainGroup + '-' + subUnit + suffix);
    }
    
    // Variation 5: Just the sub-unit name
    if (groupName.includes(' ')) {
        const parts = groupName.split(' ');
        const lastPart = parts[parts.length - 1].toLowerCase();
        urls.push(base + lastPart + suffix);
    }
    
    console.log(`[Kprofiles] URLs to try for "${groupName}":`, urls);
    return [...new Set(urls)]; // Remove duplicates
}

/**
 * Reads and resizes an image for collage
 */
async function fetchAndResizeImage(card) {
    try {
        const buffer = await readImageBufferFromCard(card, { timeout: 20000 });
        const resized = await sharp(buffer)
            .resize(COLLAGE_CONFIG.cardWidth, COLLAGE_CONFIG.cardHeight, { fit: 'cover' })
            .png()
            .toBuffer();
        return { buffer: resized, success: true };
    } catch (error) {
        console.error(`Failed to read image for ${card.name}:`, error.message);
        return { buffer: null, success: false };
    }
}

/**
 * Generates a collage from card images
 */
async function generateCollage(cards) {
    const { maxCardsPerRow, cardWidth, cardHeight, padding, backgroundColor } = COLLAGE_CONFIG;
    
    // Fetch all images (max 15)
    const results = await Promise.all(cards.slice(0, 15).map((card) => fetchAndResizeImage(card)));
    const validImages = results.filter(r => r.success).map(r => r.buffer);
    const brokenCount = results.filter(r => !r.success).length;
    
    if (validImages.length === 0) {
        return { buffer: null, brokenCount };
    }
    
    // Calculate grid layout
    const numCards = validImages.length;
    const rows = Math.ceil(numCards / maxCardsPerRow);
    const cardsInLastRow = numCards % maxCardsPerRow || maxCardsPerRow;
    
    const totalWidth = Math.min(numCards, maxCardsPerRow) * (cardWidth + padding) - padding;
    const totalHeight = rows * (cardHeight + padding) - padding;
    
    // Build composite operations
    const compositeOps = [];
    let idx = 0;
    
    for (let row = 0; row < rows; row++) {
        const cardsInThisRow = row === rows - 1 ? cardsInLastRow : maxCardsPerRow;
        const rowWidth = cardsInThisRow * (cardWidth + padding) - padding;
        const rowOffset = Math.floor((totalWidth - rowWidth) / 2);
        
        for (let col = 0; col < cardsInThisRow; col++) {
            if (idx >= validImages.length) break;
            compositeOps.push({
                input: validImages[idx],
                left: rowOffset + col * (cardWidth + padding),
                top: row * (cardHeight + padding)
            });
            idx++;
        }
    }
    
    const buffer = await sharp({
        create: {
            width: totalWidth,
            height: totalHeight,
            channels: 4,
            background: backgroundColor
        }
    })
    .composite(compositeOps)
    .png()
    .toBuffer();
    
    return { buffer, brokenCount };
}

/**
 * Groups cards by group name and checks against database
 */
async function processNewCards(recentFiles) {
    // Get all existing image paths/urls from database
    const existingCards = await Card.find({}, "imageURL imagePath").lean();
    const existingSources = new Set(
        existingCards.flatMap((card) => [card.imagePath, card.imageURL].filter(Boolean))
    );
    
    // Filter out cards that already exist
    const newCards = recentFiles.filter((file) => !existingSources.has(file.imagePath) && !existingSources.has(file.imageURL));
    
    // Group by group name
    const grouped = new Map();
    for (const card of newCards) {
        if (!grouped.has(card.group)) {
            grouped.set(card.group, []);
        }
        grouped.get(card.group).push(card);
    }
    
    return grouped;
}

module.exports = {
    name: "scancards",
    aliases: ["sc"],
    description: "Scan local Taerae Images for recently added cards (last 7 days)",
    
    async execute(msg, args, client) {
        try {
            // Admin check
            if (!isAdmin(msg.author.id)) {
                return msg.channel.createMessage({
                    content: "❌ You are not authorized to use this command.",
                    messageReference: { messageID: msg.id }
                });
            }
            
            const userId = msg.author.id;
            
            // Check for existing scan
            if (pendingScans.has(userId)) {
                return msg.channel.createMessage({
                    content: "⏳ You already have a scan in progress.",
                    messageReference: { messageID: msg.id }
                });
            }
            
            // Send initial status
            const statusMsg = await msg.channel.createMessage({
                content: "🔍 Scanning local Taerae Images for recently added images (last 7 days)...",
                messageReference: { messageID: msg.id }
            });
            
            // Fetch recently modified files from local directory
            const recentFiles = await fetchRecentlyAddedFiles();
            
            if (recentFiles.length === 0) {
                return statusMsg.edit({
                    content: "📭 No new local images found in the last 7 days."
                });
            }
            
            await statusMsg.edit({
                content: `📁 Found ${recentFiles.length} recent images. Checking database...`
            });
            
            // Filter against database and group by group name
            const groupedCards = await processNewCards(recentFiles);
            
            if (groupedCards.size === 0) {
                return statusMsg.edit({
                    content: "✅ All recent images are already in the database!"
                });
            }
            
            // Convert to array of summaries with Kprofiles data
            const summaries = [];
            for (const [group, cards] of groupedCards) {
                // Get card names for matching against Kprofiles
                const cardNames = cards.map(c => c.name);
                
                // Fetch Kprofiles data - pass card names for best match selection
                const kprofilesData = await fetchKprofilesMembers(group, cardNames);
                
                // Group cards by rarity
                const byRarity = new Map();
                for (const card of cards) {
                    if (!byRarity.has(card.rarity)) {
                        byRarity.set(card.rarity, []);
                    }
                    byRarity.get(card.rarity).push(card);
                }
                
                summaries.push({
                    group,  // folder name (for image path/url)
                    officialName: kprofilesData.officialName || group,  // proper name from Kprofiles
                    kprofilesData,  // members data already fetched
                    cards,
                    byRarity
                });
            }
            
            // Store pending scan
            pendingScans.set(userId, {
                summaries,
                currentIndex: 0,
                timestamp: Date.now()
            });
            
            // Delete status and show first group
            await statusMsg.delete().catch(() => {});
            await this.showGroupSummary(msg, client, summaries[0], 0, summaries.length);
            
        } catch (error) {
            console.error("Error in scancards:", error);
            return msg.channel.createMessage({
                content: `❌ Error: ${error.message}`,
                messageReference: { messageID: msg.id }
            });
        }
    },
    
    /**
     * Shows a group summary with collage and buttons
     */
    async showGroupSummary(msg, client, summary, index, total) {
        const userId = msg.author.id;
        
        // Use pre-fetched Kprofiles data
        const wikiData = summary.kprofilesData;
        
        // Build rarity list
        let rarityList = "";
        for (const [rarity, cards] of summary.byRarity) {
            const names = cards.map(c => c.name).join(", ");
            rarityList += `**${rarity}:**\n• ${names}\n\n`;
        }
        
        // Build wiki comparison
        let wikiText = "";
        if (wikiData.found) {
            wikiText += `\n📚 **Kprofiles Members:** ${wikiData.members.join(", ")}\n`;
            
            // Find which card names match wiki members (case-insensitive)
            const cardNames = summary.cards.map(c => c.name.toLowerCase());
            const matchedMembers = wikiData.members.filter(m => 
                cardNames.some(cn => cn === m.toLowerCase())
            );
            const missingMembers = wikiData.members.filter(m => 
                !cardNames.some(cn => cn === m.toLowerCase())
            );
            
            if (matchedMembers.length > 0) {
                wikiText += `✅ **Matched:** ${matchedMembers.join(", ")}\n`;
            }
            if (missingMembers.length > 0) {
                wikiText += `❓ **Not uploaded:** ${missingMembers.join(", ")}\n`;
            }
        } else {
            wikiText = "\n⚠️ *Could not find this group on Kprofiles*\n";
        }
        
        // Generate collage
        const { buffer: collageBuffer, brokenCount } = await generateCollage(summary.cards);
        
        let imageWarning = "";
        if (brokenCount > 0) {
            imageWarning = `\n❌ **${brokenCount} image(s) failed to load**`;
        }
        
        // Build embed - use officialName for display, show folder name if different
        const displayName = summary.officialName !== summary.group 
            ? `${summary.officialName} (folder: ${summary.group})`
            : summary.officialName;
        
        const embed = {
            title: `📦 ${displayName}`,
            color: brokenCount > 0 ? 0xED4245 : 0x57F287,
            description: `**New Cards: ${summary.cards.length}**\n\n${rarityList}${wikiText}${imageWarning}`,
            footer: { text: `Group ${index + 1} of ${total} • Will save as "${summary.officialName}" • Expires in 10 minutes` }
        };
        
        // Add image to embed if collage was generated
        if (collageBuffer) {
            embed.image = { url: "attachment://preview.png" };
        }
        
        // Build buttons
        const buttons = [
            {
                type: 2,
                style: 3, // Green
                custom_id: `sc_add_${index}`,
                label: `Add All (${summary.cards.length})`,
                emoji: { id: EMOJI_IDS.CHECK, name: 'check' }
            },
            {
                type: 2,
                style: 4, // Red
                custom_id: `sc_skip_${index}`,
                label: "Skip",
                emoji: { id: EMOJI_IDS.CROSS, name: 'cross' }
            }
        ];
        
        // Add navigation if multiple groups
        if (total > 1) {
            if (index > 0) {
                buttons.unshift({
                    type: 2,
                    style: 2,
                    custom_id: `sc_prev_${index}`,
                    emoji: { id: EMOJI_IDS.LEFT, name: 'left' }
                });
            }
            if (index < total - 1) {
                buttons.push({
                    type: 2,
                    style: 2,
                    custom_id: `sc_next_${index}`,
                    emoji: { id: EMOJI_IDS.RIGHT, name: 'right' }
                });
            }
        }
        
        // Send message with collage attachment
        const messagePayload = {
            embeds: [embed],
            components: [{ type: 1, components: buttons }],
            messageReference: { messageID: msg.id }
        };
        
        let sentMsg;
        if (collageBuffer) {
            sentMsg = await msg.channel.createMessage(messagePayload, { file: collageBuffer, name: "preview.png" });
        } else {
            sentMsg = await msg.channel.createMessage(messagePayload);
        }
        
        // Update pending scan with message reference
        const pending = pendingScans.get(userId);
        if (pending) {
            pending.messageId = sentMsg.id;
        }
        
        // Set up interaction handler
        const handler = async (interaction) => {
            if (interaction.type !== 3) return;
            if (interaction.message.id !== sentMsg.id) return;
            if (interaction.member?.id !== userId) {
                return interaction.createMessage({
                    content: "❌ Only the person who ran the scan can use these buttons.",
                    flags: 64
                });
            }
            
            const customId = interaction.data.custom_id;
            const pending = pendingScans.get(userId);
            if (!pending) return;
            
            if (customId.startsWith("sc_add_")) {
                client.removeListener("interactionCreate", handler);
                await this.handleAddCards(interaction, msg, client, summary, pending, index);
            } else if (customId.startsWith("sc_skip_")) {
                client.removeListener("interactionCreate", handler);
                await this.handleSkipGroup(interaction, msg, client, pending, index);
            } else if (customId.startsWith("sc_next_")) {
                await interaction.acknowledge();
                await sentMsg.delete().catch(() => {});
                client.removeListener("interactionCreate", handler);
                await this.showGroupSummary(msg, client, pending.summaries[index + 1], index + 1, total);
            } else if (customId.startsWith("sc_prev_")) {
                await interaction.acknowledge();
                await sentMsg.delete().catch(() => {});
                client.removeListener("interactionCreate", handler);
                await this.showGroupSummary(msg, client, pending.summaries[index - 1], index - 1, total);
            }
        };
        
        client.on("interactionCreate", handler);
        
        // Auto-cleanup after 10 minutes
        setTimeout(() => {
            client.removeListener("interactionCreate", handler);
            if (pendingScans.get(userId)?.messageId === sentMsg.id) {
                pendingScans.delete(userId);
                sentMsg.edit({
                    components: [],
                    embeds: [{ ...embed, footer: { text: "⏰ Scan expired" }, color: 0x95A5A6 }]
                }).catch(() => {});
            }
        }, 10 * 60 * 1000);
    },
    
    /**
     * Handles adding all cards from a group
     */
    async handleAddCards(interaction, msg, client, summary, pending, index) {
        await interaction.acknowledge();
        
        const userId = msg.author.id;
        let addedCount = 0;
        const errors = [];
        
        // Get next card ID
        const lastCard = await Card.findOne({}, {}, { sort: { cardId: -1 } });
        let nextCardId = lastCard ? lastCard.cardId + 1 : 1;
        
        // Use official name from Kprofiles for the group field
        const groupName = summary.officialName || summary.group;
        
        for (const card of summary.cards) {
            try {
                // Double-check it doesn't exist (by imagePath/imageURL)
                const existing = await Card.findOne({
                    $or: [{ imagePath: card.imagePath }, { imageURL: card.imageURL }]
                });
                if (existing) {
                    errors.push(`${card.name}: Already exists`);
                    continue;
                }
                
                const newCard = new Card({
                    cardId: nextCardId++,
                    rarity: card.rarity,
                    name: card.name,
                    group: groupName,  // Use official name from Kprofiles
                    imageURL: card.imageURL,
                    imagePath: card.imagePath,
                    spawnable: true,
                    dateAdded: new Date(),
                    printCounter: 0
                });
                
                await newCard.save();
                addedCount++;
            } catch (error) {
                errors.push(`${card.name}: ${error.message}`);
            }
        }
        
        // Update message
        const resultEmbed = {
            title: `✅ Added ${groupName} Cards`,
            color: 0x57F287,
            description: `Successfully added **${addedCount}** of ${summary.cards.length} cards.${errors.length > 0 ? `\n\n⚠️ **Errors:**\n${errors.slice(0, 5).join('\n')}` : ''}`,
            footer: { text: `Added by ${msg.author.username}` }
        };
        
        await interaction.editOriginalMessage({
            embeds: [resultEmbed],
            components: []
        });
        
        // Move to next group or finish
        const total = pending.summaries.length;
        if (index < total - 1) {
            setTimeout(async () => {
                await this.showGroupSummary(msg, client, pending.summaries[index + 1], index + 1, total);
            }, 1500);
        } else {
            pendingScans.delete(userId);
            await msg.channel.createMessage({
                content: "🎉 **Scan complete!** All groups processed."
            });
        }
    },
    
    /**
     * Handles skipping a group
     */
    async handleSkipGroup(interaction, msg, client, pending, index) {
        await interaction.acknowledge();
        
        const userId = msg.author.id;
        const total = pending.summaries.length;
        
        await interaction.editOriginalMessage({
            embeds: [{
                title: `⏭️ Skipped ${pending.summaries[index].group}`,
                color: 0x95A5A6
            }],
            components: []
        });
        
        if (index < total - 1) {
            setTimeout(async () => {
                await this.showGroupSummary(msg, client, pending.summaries[index + 1], index + 1, total);
            }, 1000);
        } else {
            pendingScans.delete(userId);
            await msg.channel.createMessage({
                content: "📋 **Scan complete!** All groups reviewed."
            });
        }
    }
};
