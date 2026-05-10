// ============================================================================
// USER PROGRESS MODEL - UPDATED with unlockedAchievements field
// ============================================================================

const mongoose = require("mongoose");

const userProgressSchema = new mongoose.Schema({
  userId: { 
    type: String, 
    required: true, 
    unique: true 
  },
  
  // Tier tracking
  claimedTiers: [{ 
    type: String 
  }],
  
  // Achievement tracking
  claimedAchievements: [{ 
    type: String 
  }],
  
  // Unlocked but not yet claimed achievements (NEW!)
  unlockedAchievements: [{
    type: String
  }],
  
  lastUpdated: { 
    type: Date, 
    default: Date.now 
  }
});

// Index for faster lookups
userProgressSchema.index({ userId: 1 });

const UserProgress = mongoose.model("UserProgress", userProgressSchema);

module.exports = { UserProgress };