const mongoose = require("mongoose");
const { GRADES } = require("../config/gradeConfig");

// Persisted snapshot of one AWC's monthly performance (one document per AWC per "YYYY-MM").
// Live rankings are always computed from Record/Task/SupervisorVisit data; this collection
// stores the result of recalculateAWCGrade / recalculateDistrictRanking so history, exports
// and notices can read it cheaply. Hierarchy data is NOT duplicated beyond the codes already
// used on every other collection (Record, Task, ...), so no second hierarchy exists.
const metricsSchema = new mongoose.Schema(
  {
    completionRate: { type: Number, default: null },
    approvalRate: { type: Number, default: null },
    beneficiaryRate: { type: Number, default: null },
    taskCompletionRate: { type: Number, default: null },
    inspectionScore: { type: Number, default: null },
  },
  { _id: false }
);

const countsSchema = new mongoose.Schema(
  {
    totalEntries: Number,
    approvedEntries: Number,
    rejectedEntries: Number,
    pendingEntries: Number,
    daysSubmitted: Number,
    expectedDays: Number,
    tasksAssigned: Number,
    tasksCompleted: Number,
    inspections: Number,
  },
  { _id: false }
);

const gradeSchema = new mongoose.Schema(
  {
    districtCode: { type: String, required: true },
    blockCode: { type: String, required: true },
    sectorCode: { type: String, required: true },
    awcCode: { type: String, required: true },
    awcName: { type: String },

    period: { type: String, required: true }, // "YYYY-MM"
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true }, // exclusive

    metrics: { type: metricsSchema, default: () => ({}) },
    counts: { type: countsSchema, default: () => ({}) },
    metricsUsed: { type: [String], default: [] },

    totalScore: { type: Number, required: true, min: 0, max: 100 },
    grade: { type: String, enum: GRADES, required: true },

    rank: { type: Number, min: 1 }, // district-wide rank for this period
    totalRanked: { type: Number, min: 0 },

    calculatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

gradeSchema.index({ awcCode: 1, period: 1 }, { unique: true });
gradeSchema.index({ districtCode: 1, period: 1 });
gradeSchema.index({ districtCode: 1, period: 1, totalScore: -1 });
gradeSchema.index({ sectorCode: 1, period: 1 });

module.exports = mongoose.model("Grade", gradeSchema);
