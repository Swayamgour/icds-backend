const mongoose = require("mongoose");

// One photo captured on a phone - geo-tagged and timestamped automatically at upload time.
const photoProofSchema = new mongoose.Schema(
  {
    url: { type: String, required: true }, // returned by POST /api/upload
    latitude: { type: Number },
    longitude: { type: Number },
    capturedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// Reusable fields for any field-staff submission that needs GPS check-in/out,
// photo proof, and an admin approve/reject workflow.
const submissionFields = {
  checkInTime: { type: Date },
  checkInLatitude: { type: Number },
  checkInLongitude: { type: Number },
  checkOutTime: { type: Date },
  checkOutLatitude: { type: Number },
  checkOutLongitude: { type: Number },

  photos: { type: [photoProofSchema], default: [] },

  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending",
  },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  reviewedAt: { type: Date },
  reviewRemarks: { type: String },
};

module.exports = { photoProofSchema, submissionFields };
