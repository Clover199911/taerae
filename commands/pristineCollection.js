// ============================================================================
// PRISTINE COLLECTION COMMAND - Track and Reward Complete Pristine Collections
// ============================================================================
// Usage: ?pristine <group name/alias> or ?pristine available
// Example: ?pristine tbz, ?pristine disco, ?pristine available
// Supports: combined groups (disco), individual groups, available rewards view
// ============================================================================

const Eris = require("eris");
const mongoose = require("mongoose");
const User = require("../models/user");
const Card = require("../models/card");
const Currency = require("../models/currency");
const Graphic = require("../models/graphic");
const specialGroups = require("../config/specialGroups");

// ============================================================================
// DATABASE SCHEMA
// ============================================================================

const pristineRewardSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    group: { type: String, required: true },
    rarity: { type: String, required: true },
    claimedAt: { type: Date, default: Date.now }
});
const PristineReward = mongoose.model('PristineReward', pristineRewardSchema);

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

const RARITY_ORDER = ['Standard', 'Unique', 'Glyph', 'Mythic'];

const RARITY_REWARDS = {
    Standard: 700,
    Unique: 1500,
    Glyph: 2500,
    Mythic: 4000
};

const RARITY_EMOJIS = {
    'Standard': '<:x_:1256609888302272542>',
    'Unique': '<:xx:1256609884795965472>',
    'Glyph': '<:xxx:1256609893239095396>',
    'Mythic': '<:xxxx:1256609881595838636>'
};

const COOLDOWN_TIME = 10000; // 10 seconds in milliseconds
const INTERACTION_TIMEOUT = 300000; // 5 minutes
const GROUP_SELECTION_TIMEOUT = 60000; // 1 minute

const cooldowns = new Set();


// ============================================================================
// MAIN COMMAND EXPORT
// ============================================================================

module.exports = {
    name: "pristine",
    aliases: ["pt"],
    description: "Check pristine collection status for a group or view available rewards",
    
    async execute(msg, args, client) {
        const userId = msg.author.id;

        // Check user registration
        const isRegistered = await checkRegistration(userId);
        if (!isRegistered) {
            return sendRegistrationError(client, msg);
        }

        // Handle "available" command
        if (args[0] && args[0].toLowerCase() === "available") {
            return showAvailableRewards(msg, userId, client);
        }

        // Require group name
        if (args.length < 1) {
            return client.createMessage(msg.channel.id, {
                content: "Please provide a group name or use 'available' to see unclaimed rewards.",
                messageReference: { messageID: msg.id }
            });
        }

        // Search for matching groups
        const searchTerm = args.join(' ').toLowerCase();
        const groups = await searchGroups(searchTerm);

        if (groups.length === 0) {
            return client.createMessage(msg.channel.id, {
                content: "🔍 No matching groups found.",
                messageReference: { messageID: msg.id }
            });
        }

        // Check if this is a combined search
        const specialGroup = specialGroups.findBySearchTerm(searchTerm);
        const isCombinedSearch = specialGroup?.isCombined || false;

        // Single group or combined search - show directly
        if (groups.length === 1 || isCombinedSearch) {
            const displayName = isCombinedSearch 
            ? specialGroup.displayName 
            : groups[0];
            
            await displayPristineCollection(msg, groups, displayName, userId, client);
            return;
        }

        // Multiple groups - let user choose
        await createGroupDropdown(msg, groups, client);
    }
};

// ============================================================================
// SEARCH FUNCTIONS
// ============================================================================

async function searchGroups(searchTerm) {
    // Check if this is a special group
    const specialGroup = specialGroups.findBySearchTerm(searchTerm);
    
    if (specialGroup && specialGroup.isCombined) {
        const groups = await Card.distinct('group', { group: specialGroup.pattern });
        return groups;
    }

    // Regular search (exclude disco)
    const regex = new RegExp(searchTerm, 'i');
    const groups = await Card.distinct('group', { 
        group: { 
            $not: specialGroups.disco.pattern 
        }, 
        group: regex 
    });
    
    return groups;
}
// ============================================================================
// GROUP SELECTION DROPDOWN
// ============================================================================

async function createGroupDropdown(msg, groups, client) {
    const options = groups.slice(0, 25).map((group) => ({
        label: capitalizeGroup(group),
        value: group,
        description: `View pristine collection for ${capitalizeGroup(group)}`
    }));

    const dropdownMessage = await client.createMessage(msg.channel.id, {
        content: `🔍 **Found ${groups.length} matching groups:**\n\n*Select a group from the dropdown below:*`,
        components: [{
            type: 1,
            components: [{
                type: 3,
                custom_id: `pristine_group_select_${msg.author.id}_${Date.now()}`,
                options: options
            }]
        }],
        messageReference: { messageID: msg.id }
    });

    setupGroupSelectionHandler(client, msg, dropdownMessage, groups);
}

function setupGroupSelectionHandler(client, msg, dropdownMessage, groups) {
    const listener = async (interaction) => {
        if (interaction.type !== 3) return;
        
        const customId = interaction.data.custom_id;
        if (!customId.includes(`pristine_group_select_${msg.author.id}`)) return;
        
        // Verify it's the correct user
        if (interaction.member.id !== msg.author.id) {
            return interaction.createMessage({
                content: "⚠️ This is not your pristine collection view!",
                flags: 64
            }).catch(() => {});
        }

        try {
            await interaction.acknowledge();
            
            const selectedGroup = interaction.data.values[0];
            
            // Update the message with the selected group's collection
            await displayPristineCollection(
                msg, 
                [selectedGroup], 
                selectedGroup, 
                msg.author.id, 
                client,
                dropdownMessage
            );
            
            client.removeListener('interactionCreate', listener);
            
        } catch (error) {
            console.error('Group selection error:', error);
            await interaction.createMessage({
                content: "⚠️ An error occurred. Please try again.",
                flags: 64
            }).catch(() => {});
        }
    };

    client.on('interactionCreate', listener);

    // Auto-cleanup after timeout
    setTimeout(() => {
        client.removeListener('interactionCreate', listener);
        dropdownMessage.edit({ 
            content: "Group selection timed out.", 
            components: [] 
        }).catch(console.error);
    }, GROUP_SELECTION_TIMEOUT);
}

// ============================================================================
// PRISTINE COLLECTION DISPLAY
// ============================================================================

async function displayPristineCollection(msg, groupNames, displayName, userId, client, existingMessage = null) {
    const groupArray = Array.isArray(groupNames) ? groupNames : [groupNames];
    
    // Create the embed
    const embed = await createPristineEmbed(groupArray, displayName, userId);
    
    // Create the claim buttons
    const buttons = await createPristineButtons(groupArray, userId);
    
    const messagePayload = {
        embeds: [embed],
        components: buttons.length > 0 ? [{ type: 1, components: buttons }] : []
    };

    let message;
    if (existingMessage) {
        // Edit existing message (from dropdown selection)
        message = await existingMessage.edit({
            content: "",
            ...messagePayload
        });
    } else {
        // Create new message
        messagePayload.messageReference = { messageID: msg.id };
        message = await client.createMessage(msg.channel.id, messagePayload);
    }
    
    // Set up button collector for claiming rewards
    if (buttons.length > 0) {
        setupButtonCollector(message, groupArray, displayName, userId, client);
    }
}

// ============================================================================
// EMBED CREATION
// ============================================================================

async function createPristineEmbed(groupArray, displayName, userId) {
    const collectionStatus = await Promise.all(
        RARITY_ORDER.map(rarity => getDetailedCollectionStatus(groupArray, rarity, userId))
    );

    let description = '';
    let totalPotentialReward = 0;

    for (const status of collectionStatus) {
        if (status.totalCount > 0) {
            const completionPercentage = (status.pristineCount / status.totalCount) * 100;
            const progressBar = createProgressBar(completionPercentage);

            description += `${RARITY_EMOJIS[status.rarity]} **${status.rarity}**\n`;
            description += `${progressBar} (${status.pristineCount}/${status.totalCount})\n`;

            // Check if reward is claimed for this rarity across all groups in the array
            const allClaimed = await checkAllGroupsClaimed(userId, groupArray, status.rarity);
            
            if (status.pristineCount === status.totalCount) {
                description += allClaimed 
                    ? "<:checkmark:1269279366999703552> Reward Claimed\n" 
                    : "<:giftbox:1269589069357121609> Reward Available!\n";
            }

            if (status.missingCards.length > 0) {
                const displayMissing = status.missingCards.slice(0, 5).join(', ');
                const additionalCount = status.missingCards.length > 5 
                    ? ` (+${status.missingCards.length - 5} more)` 
                    : '';
                description += `<:list:1269587466441199677> Missing: ${displayMissing}${additionalCount}\n`;
            }

            description += '\n';
            totalPotentialReward += RARITY_REWARDS[status.rarity] * status.totalCount;
        }
    }

    description += `\n<:crystal:1121690506238361670> Total potential reward: ${totalPotentialReward.toLocaleString()} Crystals`;

    return {
        title: `<:collection:1269587045152587786> ${capitalizeGroup(displayName)} Pristine Collection`,
        description: description,
        color: 0x48bfe3,
        footer: { text: "✨ Complete your collection to claim rewards!" }
    };
}

function createProgressBar(percentage) {
    const filledChar = '■';
    const emptyChar = '□';
    const barLength = 10;
    const filledLength = Math.round((percentage / 100) * barLength);
    return filledChar.repeat(filledLength) + emptyChar.repeat(barLength - filledLength);
}

// ============================================================================
// COLLECTION STATUS CHECKING
// ============================================================================
async function getDetailedCollectionStatus(groupArray, rarity, userId) {
    // Create regex patterns for all groups (exactly like groupt)
    const groupRegexes = groupArray.map(g => new RegExp(`^${escapeRegex(g)}$`, 'i'));
    
    // Create query for MongoDB
    const groupQuery = groupArray.length === 1 
        ? { group: groupRegexes[0] }
        : { $or: groupRegexes.map(regex => ({ group: regex })) };

        const userQuery = {
            discordId: userId,
            $or: groupRegexes.map(regex => ({ group: regex })),
            rarity,
            condition: { $regex: /^pristine$/i }  // ← Make it case-insensitive
        };
    
        const [allCards, userPristineCards] = await Promise.all([
            Card.find({ ...groupQuery, rarity }).lean(),
            User.find(userQuery).lean()
        ]);

    // Get unique imageURLs from all cards
    const allUniqueURLs = new Set(allCards.map(card => card.imageURL));
    
    // Get unique imageURLs from user's pristine collection
    const pristineURLs = new Set(userPristineCards.map(card => card.imageURL));
    
    const totalCount = allUniqueURLs.size;
    const pristineCount = pristineURLs.size;

    // Find missing cards by imageURL, then map to names for display
    const missingCardMap = new Map();
    allCards.forEach(card => {
        if (!pristineURLs.has(card.imageURL) && !missingCardMap.has(card.imageURL)) {
            missingCardMap.set(card.imageURL, card.name);
        }
    });
    
    const missingCards = Array.from(missingCardMap.values());

    return { 
        rarity, 
        totalCount, 
        pristineCount, 
        missingCards 
    };
}
async function checkAllGroupsClaimed(userId, groupArray, rarity) {
    // For combined groups, check if reward is claimed for ANY of the groups
    const claimedPromises = groupArray.map(group => 
        PristineReward.findOne({ userId, group, rarity })
    );
    
    const results = await Promise.all(claimedPromises);
    return results.some(result => result !== null);
}

// ============================================================================
// BUTTON CREATION
// ============================================================================

async function createPristineButtons(groupArray, userId) {
    const buttons = await Promise.all(
        RARITY_ORDER.map(async (rarity) => {
            const { totalCount, pristineCount } = await getDetailedCollectionStatus(
                groupArray, 
                rarity, 
                userId
            );

            if (totalCount > 0) {
                const isComplete = pristineCount === totalCount;
                const isClaimed = await checkAllGroupsClaimed(userId, groupArray, rarity);

                return {
                    type: 2,
                    style: isComplete && !isClaimed ? 1 : 2, // Green if claimable, gray otherwise
                    label: rarity,
                    custom_id: `pristine_claim_${rarity}_${Date.now()}`,
                    disabled: !isComplete || isClaimed
                };
            }
            return null;
        })
    );

    return buttons.filter(button => button !== null);
}

// ============================================================================
// BUTTON INTERACTION HANDLING
// ============================================================================

function setupButtonCollector(message, groupArray, displayName, userId, client) {
    const listener = async (interaction) => {
        if (interaction.type !== 2) return;
        if (interaction.message.id !== message.id) return;
        if (!interaction.data.custom_id.startsWith('pristine_claim_')) return;
        
        // Verify it's the correct user
        if (interaction.member.id !== userId) {
            return interaction.createMessage({
                content: "⚠️ This is not your pristine collection!",
                flags: 64
            }).catch(() => {});
        }

        await interaction.acknowledge();

        // Check cooldown
        if (cooldowns.has(userId)) {
            return interaction.createFollowup({ 
                content: "Please wait 10 seconds before trying again.",
                flags: 64
            });
        }

        // Extract rarity from custom_id
        const rarity = interaction.data.custom_id.split('_')[2];
        
        // Attempt to claim reward
        const result = await claimPristineReward(groupArray, rarity, userId);

        if (result.success) {
            cooldowns.add(userId);
            setTimeout(() => cooldowns.delete(userId), COOLDOWN_TIME);
        }

        // Send feedback
        await interaction.createFollowup({ 
            content: result.message,
            flags: 64
        });

        // Update the embed and buttons
        const updatedEmbed = await createPristineEmbed(groupArray, displayName, userId);
        const updatedButtons = await createPristineButtons(groupArray, userId);
        
        await message.edit({ 
            embeds: [updatedEmbed],
            components: updatedButtons.length > 0 ? [{ type: 1, components: updatedButtons }] : []
        });
    };

    client.on('interactionCreate', listener);

    // Cleanup after timeout
    setTimeout(() => {
        client.removeListener('interactionCreate', listener);
        message.edit({ components: [] }).catch(console.error);
    }, INTERACTION_TIMEOUT);
}

// ============================================================================
// REWARD CLAIMING
// ============================================================================

async function claimPristineReward(groupArray, rarity, userId) {
    // Verify completion
    const { totalCount, pristineCount } = await getDetailedCollectionStatus(
        groupArray, 
        rarity, 
        userId
    );

    if (pristineCount !== totalCount) {
        return { 
            success: false, 
            message: "You haven't completed this pristine collection yet." 
        };
    }

    // Check if already claimed for any group in the array
    const alreadyClaimed = await checkAllGroupsClaimed(userId, groupArray, rarity);
    if (alreadyClaimed) {
        return { 
            success: false, 
            message: "You've already claimed the reward for this pristine collection." 
        };
    }

    // Calculate reward (base reward × number of cards)
    const baseReward = RARITY_REWARDS[rarity];
    const totalReward = baseReward * totalCount;

    // Award crystals
    await Currency.findOneAndUpdate(
        { userId }, 
        { $inc: { crystals: totalReward } }, 
        { upsert: true }
    );

    // Save claim record for each group in the array
    await Promise.all(
        groupArray.map(group => 
            new PristineReward({ userId, group, rarity }).save()
        )
    );

    const groupDisplayName = groupArray.length === 1 
        ? capitalizeGroup(groupArray[0])
        : `${capitalizeGroup(groupArray[0])} collection`;

    return { 
        success: true, 
        message: `🎉 Congratulations! You've claimed **${totalReward.toLocaleString()} Crystals** for your ${groupDisplayName} ${rarity} pristine collection!` 
    };
}

// ============================================================================
// AVAILABLE REWARDS VIEW
// ============================================================================

async function showAvailableRewards(msg, userId, client) {
    const allGroups = await Card.distinct('group');
    let availableRewards = [];

    // Check all groups individually
    for (const group of allGroups) {
        for (const rarity of RARITY_ORDER) {
            const { totalCount, pristineCount } = await getDetailedCollectionStatus(
                [group], 
                rarity, 
                userId
            );
            
            if (totalCount > 0 && pristineCount === totalCount) {
                const claimed = await PristineReward.findOne({ userId, group, rarity });
                if (!claimed) {
                    availableRewards.push({ 
                        group, 
                        rarity,
                        reward: RARITY_REWARDS[rarity] * totalCount
                    });
                }
            }
        }
    }

    // No available rewards
    if (availableRewards.length === 0) {
        return client.createMessage(msg.channel.id, {
            embeds: [{
                title: "<:collection:1269587045152587786> Pristine Collection Rewards",
                description: "Your journey continues! No unclaimed rewards at the moment. Keep collecting to unlock new treasures!",
                color: 0x48bfe3,
                footer: { text: "✨ Every card brings you closer to completion!" }
            }],
            messageReference: { messageID: msg.id }
        });
    }

    // Build the embed with available rewards
    const embed = {
        title: "<:collection:1269587045152587786> Available Pristine Rewards",
        description: "🎁 Behold, collector! Your dedication has unlocked these rewards:",
        fields: [],
        color: 0x48bfe3,
        footer: { text: "💡 Use '?pristine [group]' to claim your reward!" }
    };

    availableRewards.forEach(({ group, rarity, reward }) => {
        embed.fields.push({
            name: `${RARITY_EMOJIS[rarity]} ${capitalizeGroup(group)}`,
            value: `${rarity} - ${reward.toLocaleString()} Crystals`,
            inline: true
        });
    });

    return client.createMessage(msg.channel.id, {
        embeds: [embed],
        messageReference: { messageID: msg.id }
    });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function checkRegistration(userId) {
    try {
        const graphic = await Graphic.findOne({ userId }).lean();
        return graphic && graphic.isRegistered;
    } catch (error) {
        console.error('Registration check error:', error);
        return false;
    }
}

function sendRegistrationError(client, msg) {
    return client.createMessage(msg.channel.id, {
        embeds: [{
            title: "🚫 Uncharted Territory",
            description: "Oops! It seems you haven't registered for this grand adventure yet. Fear not, brave soul! Simply use the `?register` command to begin your journey and unlock a world of possibilities!",
            color: 0x48bfe3,
            footer: { text: "Your epic saga awaits!" }
        }],
        messageReference: { messageID: msg.id }
    });
}

function capitalizeGroup(group) {
    // Check for IOTW pattern
    const iotwPattern = /^<:iotw(\d+):\d+>\s*(.*)/i;
    const match = group.match(iotwPattern);

    if (match) {
        const weekNumber = match[1];
        const restOfName = match[2].trim() || 'Idol of the Week';
        return `${restOfName} ${weekNumber}`;
    }

    // Standard capitalization
    return group
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}