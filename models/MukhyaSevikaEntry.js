const mongoose = require("mongoose");
const { submissionFields } = require("./shared/submissionFields");

// Submitted by SECTOR (Mukhya Sevika / MS / Supervisor) role - one entry per
// AWC visit. Different from a Worker's own daily entry: this is the
// supervisor's independent record of visiting and checking a center.
const mukhyaSevikaEntrySchema = new mongoose.Schema(
  {
    districtCode: { type: String, required: true, index: true },
    blockCode: { type: String, required: true, index: true },
    sectorCode: { type: String, required: true, index: true },
    awcCode: { type: String, required: true, index: true },

    blockName: { type: String },
    sectorName: { type: String },
    awcName: { type: String },
    mukhyaSevikaName: { type: String },

    date: { type: Date, required: true, default: Date.now },

    registeredChildrenCount: { type: Number, default: 0 },
    arrivalTime: { type: String }, // e.g. "10:30 AM" - free text, checkInTime below is the real GPS timestamp

    remarks: { type: String },

    // GPS check-in/out, photo proof, and approval workflow
    ...submissionFields,

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MukhyaSevikaEntry", mukhyaSevikaEntrySchema);
