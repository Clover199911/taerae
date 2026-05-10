const mongoose = require("mongoose");

const packWeeklyCooldownSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true
  },
  packType: {
    type: String,
    required: true
  },
  lastPurchase: {
    type: Date,
    required: true,
    default: Date.now
  }
});

module.exports = mongoose.model("PackCooldown", packWeeklyCooldownSchema);