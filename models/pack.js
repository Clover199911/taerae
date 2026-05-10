const mongoose = require("mongoose");

const packSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true
  },
  packCode: {
    type: String,
    required: true,
    unique: true
  },
  packType: {
    type: String,
    required: true,
    enum: [
      'normal-5', 'normal-10',
      'premium-5', 'premium-10',
      'ascent-1', 'ascent-2', 'ascent-3',
      'new-update-1', 'new-update-5', 'new-update-10', 
      'winter-1', 'winter-5', 'winter-10',
      // 🎯 NEW: Group-focused pack types
      'group-focus-5', 'group-focus-10', 'group-premium-10'
    ]
  },
  purchaseDate: {
    type: Date,
    default: Date.now
  },
  isOpened: {
    type: Boolean,
    default: false
  },
  // 🎯 NEW: Target group for group-focused packs
  targetGroup: {
    type: String,
    required: false,  // Only required for group-focused packs
    trim: true
  }
});

// Index for faster queries
packSchema.index({ userId: 1, isOpened: 1 });
packSchema.index({ packCode: 1 });

module.exports = mongoose.model("Pack", packSchema);