const mongoose = require("mongoose");

const districtSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true }, // e.g. 24445
    name: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("District", districtSchema);
