const mongoose = require("mongoose");

const awcSchema = new mongoose.Schema(
  {
    sectorId: { type: mongoose.Schema.Types.ObjectId, ref: "Sector", required: true },
    districtCode: { type: String, required: true },
    blockCode: { type: String, required: true },
    sectorCode: { type: String, required: true }, // denormalized
    code: { type: String, required: true, unique: true }, // e.g. 24445010113
    name: { type: String, required: true },
    latitude: { type: Number },
    longitude: { type: Number },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Awc", awcSchema);
