const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema({
userId: {
type: String,
required: true,
unique: true,
},
ticket: {
type: Number,
required: true,
default: 0,
},
});

module.exports = mongoose.model("Event", eventSchema);