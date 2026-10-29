const m = require("mongoose");
module.exports = m.models.TaskSubmission || m.model("TaskSubmission", new m.Schema({
  task: { type: m.Schema.Types.ObjectId, ref: "Task" }, submittedBy: m.Schema.Types.ObjectId,
  districtCode: String, blockCode: String, sectorCode: String, awcCode: String,
  status: { type: String, default: "pending" },
}, { timestamps: true }));
