// models/marketNotification.js – Market notification subscriptions
// Stores user preferences for marketplace listing alerts
// ============================================================================

const mongoose = require("mongoose");

const marketNotificationSchema = new mongoose.Schema({
  userId: { 
    type: String, 
    required: true,
    index: true 
  },
  
  // What the user is watching for
  watchType: { 
    type: String, 
    required: true,
    enum: ['group', 'member', 'rarity', 'specific', 'print']
  },
  
  // The actual search term (lowercase for matching)
  searchTerm: { 
    type: String, 
    required: true,
    lowercase: true
  },
  
  // Optional: specific print number to watch
  printNumber: { 
    type: Number,
    default: null
  },
  
  // When this notification was created
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Compound index for efficient lookups
marketNotificationSchema.index({ userId: 1, searchTerm: 1 });

// Index for checking matches when new listings appear
marketNotificationSchema.index({ searchTerm: 1, watchType: 1 });

module.exports = mongoose.model("MarketNotification", marketNotificationSchema);