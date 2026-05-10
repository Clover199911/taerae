

module.exports = {
name: "dreamwalkplaces",
description: "Displays a list of enchanting places to visit within the dreamscapes",
async execute(msg, args) {
const userId = msg.author.id;

const embed = {
title: "Dreamwalk Places",
description: `Here are some enchanting places you can visit within the dreamscapes:
### 1. Crystal Falls [crystals]
- A cascading waterfall with crystalline waters that shimmer and refract the light. Surrounding the falls are sparkling caves filled with hidden treasures.
- Ethereal Wellness Requirement: 100

### 2. Echoing Peaks [fantasia tokens]
- Towering peaks that pierce the sky, adorned with swirling mists and glowing runes. The air resonates with whispers and secrets waiting to be discovered.
- Ethereal Wellness Requirement: 250

### 3. Stardust Sanctuary [stardust]
- An otherworldly sanctuary bathed in celestial light. This tranquil space is inhabited by ethereal creatures and offers a sense of serenity and rejuvenation.
- Ethereal Wellness Requirement: 350

### 4. Twilight Labyrinth [reverie gem]
- An intricate labyrinth shrouded in the hues of twilight. Mysterious and ever-changing, it tests the wit and determination of those who venture within.
- Ethereal Wellness Requirement: 600

### 5. Moonlit Grove [astral essence]
- A serene and mystical grove adorned with glowing flowers and ancient trees. Moonlight cascades through the branches, creating an ethereal atmosphere.
- Ethereal Wellness Requirement: 800`,
color: 0x00ff00,
footer: {
text: "Use ?dreamwalk (code) to start.",
},
};

msg.channel.createMessage({ 
    embeds: [embed],
    messageReference: { messageID: msg.id },
});
},
};
