const mongoose = require("mongoose");

const currencySchema = new mongoose.Schema({
userId: {
  type: String,
  required: true,
  unique: true,
},
crystals: {
  type: Number,
  required: true,
  default: 0,
},
fantasiaTokens: {
  type: Number,
  required: true,
  default: 0,
},
stardust: {
  type: Number,
  required: true,
  default: 0,
},
astralEssence: {
  type: Number,
  required: true,
  default: 0,
},
reverieGem: {
  type: Number,
  required: true,
  default: 0,
},
selca: {
  type: Number,
  required: true,
  default: 0,
},
candyCanes: {
  type: Number,
  required: true,
  default: 0,
}
});

currencySchema.index({ userId: 1 }, { unique: true });
module.exports = mongoose.model("Currency", currencySchema);