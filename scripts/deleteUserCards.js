// scripts/deleteUserCards.js
// Deletes all cards owned by a specific user
// Usage: node scripts/deleteUserCards.js <userId>

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/user');

async function deleteUserCards(userId) {
  console.log(`🗑️  Starting card deletion for user: ${userId}\n`);

  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/cardbot', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB\n');

    // Count cards first
    const count = await User.countDocuments({ discordId: userId });
    
    if (count === 0) {
      console.log(`ℹ️  No cards found for user ${userId}`);
      await mongoose.connection.close();
      return;
    }

    console.log(`⚠️  Found ${count} cards owned by user ${userId}`);
    console.log('Deleting in 3 seconds... (Ctrl+C to cancel)\n');
    
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Delete all cards
    const result = await User.deleteMany({ discordId: userId });

    console.log(`✅ Successfully deleted ${result.deletedCount} cards`);

  } catch (error) {
    console.error('❌ Error deleting cards:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
  }
}

// Get userId from command line argument
const userId = process.argv[2];

if (!userId) {
  console.log('Usage: node scripts/deleteUserCards.js <userId>');
  console.log('Example: node scripts/deleteUserCards.js 1117452463407104042');
  process.exit(1);
}

deleteUserCards(userId).catch(console.error);