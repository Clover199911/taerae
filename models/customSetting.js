const mongoose = require("mongoose");

const CustomSettingSchema = new mongoose.Schema({
userId: {
  type: String,
  required: true,
  unique: true,
},
profileDescription: {
  type: String,
  default: "",
},
embedColor: {
  type: String,
  default: "0x00ff00",
},
favoriteCard: {
  type: String,
  default: "",
},
favoriteCardImage: {
  type: String,
  default: "",
},
});

module.exports = mongoose.model("CustomSetting", CustomSettingSchema);
