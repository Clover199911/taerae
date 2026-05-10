// scripts/verifyMissingCards.js
// Finds user cards that don't match any Card in the collection
// Usage: node scripts/verifyMissingCards.js

require('dotenv').config();
const mongoose = require('mongoose');
const Card = require('../models/card');
const User = require('../models/user');

async function verifyMissingCards() {
  console.log('🔍 Finding missing cards...\n');

  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/cardbot', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB\n');

    // Get all unique user cards
    console.log('Analyzing User collection...');
    const uniqueUserCards = await User.aggregate([
      {
        $group: {
          _id: {
            name: '$name',
            group: '$group',
            rarity: '$rarity',
            imageURL: '$imageURL'
          },
          count: { $sum: 1 },
          sampleCardCode: { $first: '$cardCode' }
        }
      }
    ]);

    console.log(`Found ${uniqueUserCards.length} unique card variants in User collection\n`);

    // Build Card collection lookup
    console.log('Building Card collection lookup...');
    const allCards = await Card.find().select('cardId name group rarity imageURL').lean();
    const cardLookup = new Map();
    
    for (const card of allCards) {
      const key = `${card.name}|${card.group}|${card.rarity}|${card.imageURL}`;
      cardLookup.set(key, card);
    }
    console.log(`Card collection has ${cardLookup.size} unique cards\n`);

    // Find missing cards
    console.log('🔎 Checking for missing cards...\n');
    const missingCards = [];
    const possibleMatches = [];

    for (const userCard of uniqueUserCards) {
      const { name, group, rarity, imageURL } = userCard._id;
      const lookupKey = `${name}|${group}|${rarity}|${imageURL}`;
      
      if (!cardLookup.has(lookupKey)) {
        // Card not found - check for possible matches
        const similarCards = allCards.filter(c => 
          c.name.toLowerCase() === name.toLowerCase() &&
          c.group.toLowerCase() === group.toLowerCase() &&
          c.rarity.toLowerCase() === rarity.toLowerCase()
        );

        missingCards.push({
          name,
          group,
          rarity,
          imageURL,
          ownedBy: userCard.count,
          sampleCardCode: userCard.sampleCardCode,
          similarCards: similarCards.length
        });

        if (similarCards.length > 0) {
          possibleMatches.push({
            userCard: { name, group, rarity, imageURL: imageURL.substring(0, 80) },
            matches: similarCards.map(c => ({
              cardId: c.cardId,
              imageURL: c.imageURL.substring(0, 80)
            }))
          });
        }
      }
    }

    // Display results
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`📊 SUMMARY`);
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Total unique user cards: ${uniqueUserCards.length}`);
    console.log(`Cards in Card collection: ${cardLookup.size}`);
    console.log(`Missing from Card collection: ${missingCards.length}`);
    console.log(`With possible matches (same name/group/rarity): ${possibleMatches.length}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (missingCards.length === 0) {
      console.log('🎉 All user cards have matching entries in Card collection!');
      return;
    }

    // Show missing cards by category
    console.log('❌ MISSING CARDS (Top 20):\n');
    const sortedMissing = missingCards.sort((a, b) => b.ownedBy - a.ownedBy).slice(0, 20);
    
    for (const card of sortedMissing) {
      console.log(`┌─ ${card.name} (${card.group})`);
      console.log(`├─ Rarity: ${card.rarity}`);
      console.log(`├─ Owned by ${card.ownedBy} users`);
      console.log(`├─ Sample code: ${card.sampleCardCode}`);
      console.log(`├─ ImageURL: ${card.imageURL.substring(0, 100)}...`);
      console.log(`└─ Similar cards in DB: ${card.similarCards}\n`);
    }

    if (missingCards.length > 20) {
      console.log(`... and ${missingCards.length - 20} more missing cards\n`);
    }

    // Show possible matches
    if (possibleMatches.length > 0) {
      console.log('\n═══════════════════════════════════════════════════════════════');
      console.log('🔗 POSSIBLE MATCHES (Same name/group/rarity, different imageURL)');
      console.log('═══════════════════════════════════════════════════════════════\n');

      for (const match of possibleMatches.slice(0, 10)) {
        console.log(`USER CARD: ${match.userCard.name} (${match.userCard.group})`);
        console.log(`  User imageURL: ${match.userCard.imageURL}`);
        console.log(`  Possible matches in Card collection:`);
        for (const m of match.matches) {
          console.log(`    - cardId ${m.cardId}: ${m.imageURL}`);
        }
        console.log('');
      }

      if (possibleMatches.length > 10) {
        console.log(`... and ${possibleMatches.length - 10} more possible matches\n`);
      }
    }

    // Export to JSON for easier analysis
    const fs = require('fs');
    const reportData = {
      summary: {
        totalUserCards: uniqueUserCards.length,
        cardsInCollection: cardLookup.size,
        missingCards: missingCards.length,
        possibleMatches: possibleMatches.length
      },
      missingCards,
      possibleMatches
    };

    fs.writeFileSync('missing_cards_report.json', JSON.stringify(reportData, null, 2));
    console.log('\n💾 Full report saved to: missing_cards_report.json');

    // Recommendations
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('💡 RECOMMENDATIONS');
    console.log('═══════════════════════════════════════════════════════════════');
    
    if (possibleMatches.length > 0) {
      console.log(`\n1. ${possibleMatches.length} cards might have imageURL mismatches`);
      console.log('   → Check if Card imageURLs were updated');
      console.log('   → Run a script to update User imageURLs to match');
    }
    
    const orphanedCards = missingCards.filter(c => c.similarCards === 0);
    if (orphanedCards.length > 0) {
      console.log(`\n2. ${orphanedCards.length} cards have no matches at all`);
      console.log('   → These might be deleted/custom/event cards');
      console.log('   → Consider adding them back to Card collection');
    }

    console.log('\n3. During migration, these cards will be assigned cardId: 0');
    console.log('   → They will still get print numbers');
    console.log('   → But won\'t be linked to Card collection');

  } catch (error) {
    console.error('❌ Verification failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
  }
}

verifyMissingCards().catch(console.error);