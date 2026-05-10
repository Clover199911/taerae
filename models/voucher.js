const mongoose = require("mongoose");

const voucherSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true
    // Case-sensitive by default in MongoDB
  },
  createdBy: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true
  },
  maxClaims: {
    type: Number,
    default: null // null = unlimited
  },
  claimedBy: {
    type: [String], // Array of Discord user IDs
    default: []
  },
  rewards: {
    packs: [{
      type: {
        type: String,
        required: true
      },
      quantity: {
        type: Number,
        required: true,
        min: 1
      },
      targetGroup: {
        type: String,
        required: false // Only for group-focused packs
      }
    }],
    currency: {
      crystals: {
        type: Number,
        default: 0
      },
      astralEssence: {
        type: Number,
        default: 0
      },
      stardust: {
        type: Number,
        default: 0
      }
    },
    cards: [{
      quantity: {
        type: Number,
        required: true,
        min: 1
      },
      rarity: {
        type: String,
        required: false // If not specified, random
      },
      condition: {
        type: String,
        required: false // If not specified, random
      },
      group: {
        type: String,
        required: false // If not specified, random
      }
    }]
  },
  isActive: {
    type: Boolean,
    default: true
  },
  expirationWarned: {
    type: Boolean,
    default: false // Track if we've warned about expiration
  }
});

// Indexes for faster queries
voucherSchema.index({ code: 1 });
voucherSchema.index({ isActive: 1, expiresAt: 1 });
voucherSchema.index({ createdBy: 1 });

// Virtual to check if voucher is expired
voucherSchema.virtual('isExpired').get(function() {
  return Date.now() > this.expiresAt.getTime();
});

// Virtual to check if voucher is claimable
voucherSchema.virtual('isClaimable').get(function() {
  if (!this.isActive || this.isExpired) return false;
  if (this.maxClaims === null) return true;
  return this.claimedBy.length < this.maxClaims;
});

// Virtual to get remaining claims
voucherSchema.virtual('remainingClaims').get(function() {
  if (this.maxClaims === null) return null; // Unlimited
  return Math.max(0, this.maxClaims - this.claimedBy.length);
});

// Ensure virtuals are included in JSON
voucherSchema.set('toJSON', { virtuals: true });
voucherSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model("Voucher", voucherSchema);