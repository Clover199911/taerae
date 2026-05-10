const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  discordId: { type: String, required: true},
  cardCode: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  group: { type: String, required: true },
  rarity: { type: String, required: true },
  imageURL: { type: String, required: true },
  condition: { type: String, required: true },
  cardWellness: { type: Number, required: true, default: 0 },
  printNumber: { type: Number, required: true, unique: true },
  cardId: { type: Number, required: true },
  cardLocked: { type: Boolean, default: false },
  cardTag: { type: String, default: null } // NEW FIELD for emoji tags
});

// Compound indexes for common queries
userSchema.index({ cardId: 1, printNumber: 1 }, { unique: true });
userSchema.index({ discordId: 1, cardCode: 1 }, { unique: true });
userSchema.index({ rarity: 1, condition: 1 });
userSchema.index({ cardTag: 1 });

// Performance indexes for frequent query patterns
userSchema.index({ discordId: 1, rarity: 1 }); // For filtered user card queries
userSchema.index({ discordId: 1, group: 1 }); // For group filtering
userSchema.index({ cardLocked: 1, discordId: 1 }); // For lock commands
userSchema.index({ condition: 1 }); // For condition-based searches
userSchema.index({ group: 1, rarity: 1 }); // For group+rarity queries

module.exports = mongoose.model("User", userSchema);