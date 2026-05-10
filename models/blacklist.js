const mongoose = require("mongoose");

const blacklistSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  reason: { type: String, default: "No reason provided" },
  blacklistedBy: { type: String, required: true },
  blacklistedAt: { type: Date, default: Date.now }
});

// Index for fast lookups
blacklistSchema.index({ userId: 1 });

module.exports = mongoose.model("Blacklist", blacklistSchema);
