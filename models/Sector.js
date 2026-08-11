const mongoose = require("mongoose");

const sectorSchema = new mongoose.Schema(
  {
    blockId: { type: mongoose.Schema.Types.ObjectId, ref: "Block", required: true },
    districtCode: { type: String, required: true },
    blockCode: { type: String, required: true }, // denormalized
    code: { type: String, required: true, unique: true }, // e.g. 244450101
    name: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Sector", sectorSchema);
