const mongoose = require("mongoose");

const updateCardSchema = new mongoose.Schema({
startId: { type: Number, required: true },
endId: { type: Number, required: true },
dateAdded: { type: Date, default: Date.now }
});

module.exports = mongoose.model("UpdateCard", updateCardSchema);