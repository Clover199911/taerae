// scripts/migratePrintSystem.js
// Run this ONCE to migrate existing cards to the print system
// Usage: node scripts/migratePrintSystem.js

require('dotenv').config();
const mongoose = require('mongoose');
const Card = require('../models/card');
const User = require('../models/user');

async function migrateToNewCardIds() {
  console.log('🔄 Starting Card ID migration...\n');

  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/cardbot', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB\n');

    // Step 1: Ensure all Card documents have cardId
    console.log('Step 1: Checking Card collection for cardId field...');
    
    const cardsWithoutId = await Card.find({ cardId: { $exists: false } });
    
    if (cardsWithoutId.length > 0) {
      console.log(`⚠️  Found ${cardsWithoutId.length} cards without cardId`);
      console.log('Please ensure all cards in Card collection have unique cardId values');
      console.log('You can add them manually or use auto-increment\n');
      
      // Auto-assign cardIds if you want
      const maxCardId = await Card.findOne().sort({ cardId: -1 }).select('cardId');
      let nextId = maxCardId ? maxCardId.cardId + 1 : 1;
      
      for (const card of cardsWithoutId) {
        await Card.updateOne(
          { _id: card._id },
          { $set: { cardId: nextId } }
        );
        console.log(`  Assigned cardId ${nextId} to ${card.name}`);
        nextId++;
      }
      console.log('✅ All cards now have cardId\n');
    } else {
      console.log('✅ All cards already have cardId\n');
    }

    // Step 2: Add printCounter to all cards
    console.log('Step 2: Adding printCounter field to Card collection...');
    const result = await Card.updateMany(
      { printCounter: { $exists: false } },
      { $set: { printCounter: 0 } }
    );
    console.log(`✅ Updated ${result.modifiedCount} cards with printCounter field\n`);

    // Step 3: Link User cards to Card cardId and assign print numbers
    console.log('Step 3: Migrating User collection...');
    
    // Get all user cards that don't have cardId or printNumber - FAST QUERY
    const userCardsToMigrate = await User.find({
      $or: [
        { cardId: { $exists: false } },
        { printNumber: { $exists: false } }
      ]
    }).select('_id name group rarity').lean(); // Only get what we need

    console.log(`Found ${userCardsToMigrate.length} user cards to migrate\n`);

    // STEP 3A: Build a card lookup map (MUCH FASTER than repeated queries)
    console.log('Building card lookup map...');
    const allCards = await Card.find().select('cardId name group rarity').lean();
    const cardLookup = new Map();
    
    for (const card of allCards) {
      const key = `${card.name}|${card.group}|${card.rarity}`;
      cardLookup.set(key, card.cardId);
    }
    console.log(`✅ Built lookup for ${cardLookup.size} cards\n`);

    // STEP 3B: Group cards by their identity
    console.log('Grouping user cards...');
    const cardGroups = new Map();
    let notFound = 0;

    for (const userCard of userCardsToMigrate) {
      const lookupKey = `${userCard.name}|${userCard.group}|${userCard.rarity}`;
      const cardId = cardLookup.get(lookupKey);

      let groupKey;
      let cardIdValue;

      if (!cardId) {
        if (notFound < 10) { // Only show first 10 warnings
          console.log(`⚠️  No Card found for: ${userCard.name} (${userCard.group})`);
        }
        notFound++;
        groupKey = `custom_${lookupKey}`;
        cardIdValue = 0;
      } else {
        groupKey = `card_${cardId}`;
        cardIdValue = cardId;
      }

      if (!cardGroups.has(groupKey)) {
        cardGroups.set(groupKey, []);
      }

      cardGroups.get(groupKey).push({
        userCardId: userCard._id,
        cardId: cardIdValue
      });
    }

    if (notFound > 10) {
      console.log(`... and ${notFound - 10} more custom cards`);
    }
    console.log(`✅ Grouped into ${cardGroups.size} unique cards\n`);

    // STEP 3C: Assign RANDOMIZED print numbers using BULK operations
    console.log('Assigning random print numbers (this will be fast)...');
    const bulkOps = [];
    let processed = 0;

    for (const [groupKey, userCardsList] of cardGroups.entries()) {
      // Create and shuffle print numbers
      const printNumbers = Array.from({ length: userCardsList.length }, (_, i) => i + 1);
      
      for (let i = printNumbers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [printNumbers[i], printNumbers[j]] = [printNumbers[j], printNumbers[i]];
      }

      // Add to bulk operations
      for (let i = 0; i < userCardsList.length; i++) {
        bulkOps.push({
          updateOne: {
            filter: { _id: userCardsList[i].userCardId },
            update: { 
              $set: { 
                printNumber: printNumbers[i],
                cardId: userCardsList[i].cardId
              }
            }
          }
        });

        processed++;
      }
    }

    // Execute ALL updates in one go (SUPER FAST)
    console.log(`Executing ${bulkOps.length} updates...`);
    
    const batchSize = 10000; // Process 10k at a time to avoid memory issues
    for (let i = 0; i < bulkOps.length; i += batchSize) {
      const batch = bulkOps.slice(i, i + batchSize);
      await User.bulkWrite(batch, { ordered: false });
      console.log(`  ✅ Processed ${Math.min(i + batchSize, bulkOps.length)}/${bulkOps.length} updates...`);
    }

    console.log(`\n✅ Processed ${processed} user cards`);
    if (notFound > 0) {
      console.log(`⚠️  ${notFound} custom/orphan cards (no matching Card document)`);
    }

    // Step 4: Update Card printCounter to match actual counts
    console.log('\nStep 4: Updating Card printCounters...');
    
    const uniqueCards = await Card.find();
    for (const card of uniqueCards) {
      const actualCount = await User.countDocuments({ cardId: card.cardId });
      
      if (actualCount > 0) {
        await Card.updateOne(
          { cardId: card.cardId },
          { $set: { printCounter: actualCount } }
        );
        
        if (actualCount > 0) {
          console.log(`  ${card.name}: ${actualCount} prints`);
        }
      }
    }

    console.log('\n✅ Migration complete!');
    console.log('\n📊 Summary:');
    console.log(`  Cards updated: ${result.modifiedCount}`);
    console.log(`  User cards migrated: ${processed}`);
    console.log(`  Custom/orphan cards: ${notFound}`);
    console.log(`  Unique cards with prints: ${cardGroups.size}`);
    console.log(`\n🎲 Print numbers were randomly assigned!`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
  }
}

// Run migration
migrateToNewCardIds().catch(console.error);