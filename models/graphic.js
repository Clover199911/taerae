const mongoose = require("mongoose");
const { Schema } = mongoose;

const graphicSchema = new Schema({
  userId: String,
  isRegistered: Boolean,
  travelerId: {
    type: Number,
    unique: true,
  },
});

module.exports = mongoose.model("Graphic", graphicSchema);
