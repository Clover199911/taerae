const mongoose = require("mongoose");

// Individual quest subdocument schema
const questItemSchema = new mongoose.Schema({
  questType: { type: String, required: true },
  questId: { type: String, required: true },
  description: { type: String, required: true },
  progress: { type: Number, default: 0 },
  target: { type: Number, required: true },
  status: {
    type: String,
    enum: ["incomplete", "completed", "claimed"],
    default: "incomplete"
  },
  reward: {
    type: {
      type: String,
      enum: ["crystals", "stardust", "astralEssence", "selca", "mixed"],
      required: true
    },
    amount: { type: Number, required: true },
    secondary: {
      type: { type: String },
      amount: { type: Number }
    },
    card: {
      count: { type: Number },
      rarity: { type: String }
    }
  },
  difficulty: {
    type: String,
    enum: ["easy", "medium", "hard"],
    default: "easy"
  },
  completedAt: { type: Date, default: null },
  claimedAt: { type: Date, default: null }
}, { _id: false });

// Main document: one per user per day
const dailyQuestSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  dailyResetDate: {
    type: String,
    required: true
  },
  quests: [questItemSchema],
  bonusClaimed: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Compound index for efficient lookup: one doc per user per day
dailyQuestSchema.index({ userId: 1, dailyResetDate: 1 }, { unique: true });

// TTL index to auto-delete old quest data after 7 days
dailyQuestSchema.index({ createdAt: 1 }, { expireAfterSeconds: 604800 });

module.exports = mongoose.model("DailyQuest", dailyQuestSchema);
