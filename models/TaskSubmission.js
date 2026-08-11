const mongoose = require("mongoose");
const { submissionFields } = require("./shared/submissionFields");

// Field staff's completion record for a Task - GPS check-in, photo proof,
// and goes through the same approve/reject workflow as other submissions.
const taskSubmissionSchema = new mongoose.Schema(
  {
    task: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    districtCode: { type: String, required: true, index: true },
    blockCode: { type: String, index: true },
    sectorCode: { type: String, index: true },
    awcCode: { type: String, index: true },

    notes: { type: String },
    submittedLate: { type: Boolean, default: false }, // computed at creation: submittedAt vs task.dueDate

    // GPS check-in/out, photo proof, and approval workflow
    ...submissionFields,
  },
  { timestamps: true }
);

module.exports = mongoose.model("TaskSubmission", taskSubmissionSchema);
