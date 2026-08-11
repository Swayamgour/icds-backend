const mongoose = require("mongoose");

// Auto-created by the grading engine when a user's monthly grade is poor
// (C or D). Admin can also see and acknowledge these on the dashboard.
const noticeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    grade: { type: mongoose.Schema.Types.ObjectId, ref: "Grade", required: true },
    period: { type: String, required: true },

    districtCode: { type: String, required: true, index: true },
    blockCode: { type: String, index: true },
    sectorCode: { type: String, index: true },
    awcCode: { type: String, index: true },

    message: { type: String, required: true },
    acknowledged: { type: Boolean, default: false },
    acknowledgedAt: { type: Date },
  },
  { timestamps: true }
);

// One notice per user per period
noticeSchema.index({ user: 1, period: 1 }, { unique: true });

module.exports = mongoose.model("Notice", noticeSchema);
