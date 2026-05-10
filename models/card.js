const mongoose = require("mongoose");

const cardSchema = new mongoose.Schema({
    cardId: { type: Number, required: true, unique: true },
    rarity: { type: String, required: true },
    name: { type: String, required: true },
    group: { type: String, required: true },
    imageURL: { type: String, required: true },
    imagePath: { type: String, default: null },
    spawnable: { type: Boolean, default: true },
    dateAdded: { type: Date, default: Date.now },
    printCounter: { type: Number, default: 0 } // NEW: tracks next print number
  });

cardSchema.index({ rarity: 1, spawnable: 1 });
cardSchema.index({ cardId: 1 });
cardSchema.index({ spawnable: 1 }); // For spawnable-only queries

// Performance indexes for search and filtering
cardSchema.index({ group: 1, spawnable: 1 }); // For group-based card spawning
cardSchema.index({ name: 'text', group: 'text' }); // Text search on name and group
cardSchema.index({ dateAdded: -1 }); // For sorting by newest

module.exports = mongoose.model("Card", cardSchema);
