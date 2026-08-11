const TaskSubmission = require("../models/TaskSubmission");
const Task = require("../models/Task");
const { ROLES } = require("../config/roles");

// @desc   Submit completion of an assigned task, with GPS check-in and photos[]
// @route  POST /api/task-submissions
// @access Private (sector, awc - field staff)
const createTaskSubmission = async (req, res) => {
  try {
    if (![ROLES.SECTOR, ROLES.AWC].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Only field staff (sector, awc) can submit task completion" });
    }

    const { taskId } = req.body;
    if (!taskId) {
      return res.status(400).json({ success: false, message: "taskId is required" });
    }

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    const myScopeCode = { sector: req.user.sectorCode, awc: req.user.awcCode }[req.user.role];
    const isMine =
      String(task.assignedToUser) === String(req.user._id) ||
      (task.assignedToRole === req.user.role && task.assignedToScopeCode === myScopeCode);

    if (!isMine) {
      return res.status(403).json({ success: false, message: "This task is not assigned to you" });
    }

    const submittedLate = new Date() > new Date(task.dueDate);

    const submission = await TaskSubmission.create({
      ...req.body,
      task: taskId,
      submittedBy: req.user._id,
      districtCode: req.user.districtCode,
      blockCode: req.user.blockCode,
      sectorCode: req.user.sectorCode,
      awcCode: req.user.awcCode,
      submittedLate,
      checkInTime: req.body.checkInTime || new Date(),
      status: "pending",
    });

    // Individual assignment is considered done as soon as it's submitted for review
    if (task.assignedToUser) {
      task.status = "completed";
      await task.save();
    }

    res.status(201).json({ success: true, submission });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc   List task submissions - auto-scoped
// @route  GET /api/task-submissions
// @access Private (any role)
const getTaskSubmissions = async (req, res) => {
  try {
    const filter = { ...req.scopeFilter };
    if (req.query.taskId) filter.task = req.query.taskId;
    if (req.query.status) filter.status = req.query.status;

    const submissions = await TaskSubmission.find(filter)
      .populate("task", "title dueDate")
      .populate("submittedBy", "name email role")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: submissions.length, submissions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc   Approve or reject a task submission
// @route  PATCH /api/task-submissions/:id/review
// @access Private (district, block, sector - must outrank submitter)
const reviewTaskSubmission = async (req, res) => {
  try {
    if (req.user.role === ROLES.AWC) {
      return res.status(403).json({ success: false, message: "AWC role cannot review task submissions" });
    }

    const { status, remarks } = req.body;
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ success: false, message: "status must be 'approved' or 'rejected'" });
    }

    const submission = await TaskSubmission.findOne({ _id: req.params.id, ...req.scopeFilter });
    if (!submission) {
      return res.status(404).json({ success: false, message: "Submission not found in your scope" });
    }

    submission.status = status;
    submission.reviewedBy = req.user._id;
    submission.reviewedAt = new Date();
    submission.reviewRemarks = remarks;
    await submission.save();

    res.status(200).json({ success: true, submission });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { createTaskSubmission, getTaskSubmissions, reviewTaskSubmission };
