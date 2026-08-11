const mongoose = require("mongoose");

// A task can be assigned either to one specific user, or to an entire group
// (every user of a role within a scope - e.g. "every AWC worker in sector X").
const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    dueDate: { type: Date, required: true },

    // Scope the task was created in (always the assigner's own scope)
    districtCode: { type: String, required: true, index: true },
    blockCode: { type: String, index: true },
    sectorCode: { type: String, index: true },

    // Assignment target - EITHER a single user OR a role+scope group, not both
    assignedToUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    assignedToRole: { type: String, enum: ["district", "block", "sector", "awc"] },
    assignedToScopeCode: { type: String }, // blockCode/sectorCode/awcCode the group filter applies to

    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    status: {
      type: String,
      enum: ["open", "completed", "overdue", "cancelled"],
      default: "open",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Task", taskSchema);
