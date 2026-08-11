const mongoose = require("mongoose");

const blockSchema = new mongoose.Schema(
  {
    districtId: { type: mongoose.Schema.Types.ObjectId, ref: "District", required: true },
    districtCode: { type: String, required: true }, // denormalized for fast filtering
    code: { type: String, required: true, unique: true }, // e.g. 2444501
    name: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Block", blockSchema);
