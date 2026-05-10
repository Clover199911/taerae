// models/battleTeam.js - Battle Team Schema
// ============================================================================

const mongoose = require('mongoose');

const battleTeamSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  cardCodes: {
    type: [String],
    required: true,
    validate: {
      validator: function(arr) {
        return arr.length === 5;
      },
      message: 'Battle team must have exactly 5 cards'
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt timestamp before saving
battleTeamSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('BattleTeam', battleTeamSchema);