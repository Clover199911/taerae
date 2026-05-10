// models/marketplace.js – Marketplace listings schema
// Stores active card listings with optimized indexes
// ============================================================================

const mongoose = require("mongoose");

const marketplaceSchema = new mongoose.Schema({
  sellerId: {
    type: String,
    required: true,
    index: true // Index for filtering by seller
  },
  code: {
    type: String,
    required: true,
    unique: true, // Each card code can only be listed once
    index: true // Index for fast lookups when buying
  },
  name: {
    type: String,
    required: true
  },
  group: {
    type: String,
    required: true
  },
  rarity: {
    type: String,
    required: true,
    index: true // Index for rarity filtering
  },
  amount: {
    type: Number,
    required: true,
    min: 1 // Prevent negative or zero prices
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true // Index for sorting by date (newest first)
  }
});

// Compound indexes for common query patterns
marketplaceSchema.index({ rarity: 1, amount: 1 }); // Sort by rarity + price
marketplaceSchema.index({ sellerId: 1, code: 1 }); // Remove listing lookup

module.exports = mongoose.model("Marketplace", marketplaceSchema);