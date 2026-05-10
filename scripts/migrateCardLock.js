// migrateCardLock.js - Run this once to add cardLocked field to all existing cards
const mongoose = require("mongoose");
require("dotenv").config();

const User = require("../models/user"); // Adjust path as needed

async function migrate() {
  try {
    // Use MONGODB_URI (matches your .env file)
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to database");

    const result = await User.updateMany(
      { cardLocked: { $exists: false } }, // Only update cards without the field
      { $set: { cardLocked: false } }     // Set default value
    );

    console.log(`✅ Migration complete! Updated ${result.modifiedCount} cards.`);
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

migrate();