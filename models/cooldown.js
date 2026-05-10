const mongoose = require("mongoose");

const cooldownSchema = new mongoose.Schema({
  user: { type: String, required: true },
  command: { type: String, required: true },
  lastClaimDate: { type: String, required: true },
  cooldownEnd: { type: Date },
  // Streak tracking for daily command
  streak: { type: Number, default: 0 },
  maxStreak: { type: Number, default: 0 }
});

cooldownSchema.index({ user: 1, command: 1 });
cooldownSchema.index({ cooldownEnd: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model("Cooldown", cooldownSchema);