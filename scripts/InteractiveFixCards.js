// scripts/interactiveFixCards.js
// Interactive script to manually choose which cards to fix
// Usage: node scripts/interactiveFixCards.js

require('dotenv').config();
const mongoose = require('mongoose');
const Card = require('../models/card');
const User = require('../models/user');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function interactiveFixCards() {
  console.log('🔧 Interactive Card Fixer\n');

  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/cardbot', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB\n');

    // Build Card collection lookup
    console.log('Building Card collection lookup...');
    const allCards = await Card.find().select('cardId name group rarity imageURL').lean();
    
    const cardsByIdentity = new Map();
    for (const card of allCards) {
      const key = `${card.name.toLowerCase()}|${card.group.toLowerCase()}|${card.rarity.toLowerCase()}`;
      if (!cardsByIdentity.has(key)) {
        cardsByIdentity.set(key, []);
      }
      cardsByIdentity.get(key).push(card);
    }
    
    console.log(`✅ Found ${cardsByIdentity.size} unique card identities\n`);

    // Find user cards that need fixing
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
          userIds: { $push: '$_id' }
        }
      }
    ]);

    // Find fixable cards
    const fixableCards = [];
    
    for (const userCard of uniqueUserCards) {
      const { name, group, rarity, imageURL } = userCard._id;
      const identityKey = `${name.toLowerCase()}|${group.toLowerCase()}|${rarity.toLowerCase()}`;
      
      const matchingCards = cardsByIdentity.get(identityKey);
      
      if (matchingCards && matchingCards.length > 0) {
        const exactMatch = matchingCards.find(c => c.imageURL === imageURL);
        
        if (!exactMatch) {
          fixableCards.push({
            userCard: { name, group, rarity, imageURL },
            matches: matchingCards,
            affectedUserCards: userCard.count,
            userIds: userCard.userIds
          });
        }
      }
    }

    console.log(`\nFound ${fixableCards.length} cards that can be fixed\n`);

    if (fixableCards.length === 0) {
      console.log('🎉 No cards need fixing!');
      rl.close();
      return;
    }

    // Interactive selection
    let totalFixed = 0;
    
    for (let i = 0; i < fixableCards.length; i++) {
      const fix = fixableCards[i];
      
      console.log('═══════════════════════════════════════════════════════════════');
      console.log(`Card ${i + 1}/${fixableCards.length}`);
      console.log('═══════════════════════════════════════════════════════════════');
      console.log(`Name: ${fix.userCard.name}`);
      console.log(`Group: ${fix.userCard.group}`);
      console.log(`Rarity: ${fix.userCard.rarity}`);
      console.log(`Affects: ${fix.affectedUserCards} user cards`);
      console.log(`\nCurrent imageURL:\n${fix.userCard.imageURL}\n`);
      console.log(`Available matches in Card collection:`);
      
      fix.matches.forEach((match, idx) => {
        console.log(`\n[${idx + 1}] cardId: ${match.cardId}`);
        console.log(`    imageURL: ${match.imageURL}`);
      });
      
      console.log('\n[0] Skip this card');
      console.log('[q] Quit and exit\n');
      
      const answer = await question('Choose an option (0-' + fix.matches.length + ', or q): ');
      
      if (answer.toLowerCase() === 'q') {
        console.log('\n👋 Exiting...');
        break;
      }
      
      const choice = parseInt(answer);
      
      if (choice === 0) {
        console.log('⏭️  Skipped\n');
        continue;
      }
      
      if (choice < 1 || choice > fix.matches.length || isNaN(choice)) {
        console.log('❌ Invalid choice, skipping...\n');
        continue;
      }
      
      const selectedCard = fix.matches[choice - 1];
      
      // Confirm update
      console.log(`\n⚠️  About to update ${fix.affectedUserCards} user cards:`);
      console.log(`   → cardId: ${selectedCard.cardId}`);
      console.log(`   → imageURL: ${selectedCard.imageURL.substring(0, 80)}...\n`);
      
      const confirm = await question('Confirm update? (y/n): ');
      
      if (confirm.toLowerCase() === 'y') {
        try {
          const result = await User.updateMany(
            { _id: { $in: fix.userIds } },
            { 
              $set: { 
                imageURL: selectedCard.imageURL,
                cardId: selectedCard.cardId
              }
            }
          );
          
          console.log(`✅ Updated ${result.modifiedCount} user cards\n`);
          totalFixed += result.modifiedCount;
        } catch (error) {
          console.error('❌ Update failed:', error.message);
        }
      } else {
        console.log('❌ Cancelled\n');
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('📊 SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Total user cards updated: ${totalFixed}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    rl.close();
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
}

interactiveFixCards().catch(console.error);