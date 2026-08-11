const Task = require("../models/Task");
const User = require("../models/User");
const { ROLES, ROLE_ORDER } = require("../config/roles");

// @desc   Create a task, assigned either to one user (assignedToUser) or to an
//         entire group (assignedToRole + assignedToScopeCode, e.g. every AWC
//         worker in sector 244450101).
// @route  POST /api/tasks
// @access Private (district, block, sector - not awc)
const createTask = async (req, res) => {
  try {
    if (req.user.role === ROLES.AWC) {
      return res.status(403).json({ success: false, message: "AWC role cannot assign tasks" });
    }

    const { title, description, dueDate, assignedToUser, assignedToRole, assignedToScopeCode } = req.body;

    if (!title || !dueDate) {
      return res.status(400).json({ success: false, message: "title and dueDate are required" });
    }
    if (!assignedToUser && !assignedToRole) {
      return res.status(400).json({ success: false, message: "Provide either assignedToUser or assignedToRole" });
    }

    // A creator can only assign to roles below their own level
    if (assignedToRole) {
      const creatorIdx = ROLE_ORDER.indexOf(req.user.role);
      const targetIdx = ROLE_ORDER.indexOf(assignedToRole);
      if (targetIdx <= creatorIdx) {
        return res.status(403).json({ success: false, message: "Can only assign tasks to roles below your own" });
      }
    }

    if (assignedToUser) {
      const target = await User.findOne({ _id: assignedToUser, ...req.scopeFilter });
      if (!target) {
        return res.status(404).json({ success: false, message: "Target user not found in your scope" });
      }
    }

    const task = await Task.create({
      title,
      description,
      dueDate,
      districtCode: req.user.districtCode,
      blockCode: req.user.blockCode,
      sectorCode: req.user.sectorCode,
      assignedToUser,
      assignedToRole,
      assignedToScopeCode,
      assignedBy: req.user._id,
    });

    res.status(201).json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc   List tasks - assigned-to-me tasks (individual + matching group tasks)
//         for field staff, or all tasks created/visible within scope for admins.
// @route  GET /api/tasks
// @access Private (any role)
const getTasks = async (req, res) => {
  try {
    const { role, _id, blockCode, sectorCode, awcCode } = req.user;

    const myScopeCode = { block: blockCode, sector: sectorCode, awc: awcCode }[role];

    const filter = {
      ...req.scopeFilter,
      $or: [
        { assignedToUser: _id },
        { assignedToRole: role, assignedToScopeCode: myScopeCode },
        { assignedBy: _id }, // creators can always see tasks they made
      ],
    };

    if (req.query.status) filter.status = req.query.status;

    const tasks = await Task.find(filter).populate("assignedToUser", "name email role").sort({ dueDate: 1 });

    // Mark anything past due and still open as overdue (read-time, no cron needed for the demo)
    const now = new Date();
    const withStatus = tasks.map((t) => {
      const obj = t.toObject();
      if (obj.status === "open" && new Date(obj.dueDate) < now) obj.status = "overdue";
      return obj;
    });

    res.status(200).json({ success: true, count: withStatus.length, tasks: withStatus });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc   Cancel a task
// @route  PATCH /api/tasks/:id/cancel
// @access Private (whoever created it)
const cancelTask = async (req, res) => {
  try {
    const task = await Task.findOne({ _id: req.params.id, assignedBy: req.user._id });
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found or you are not the assigner" });
    }
    task.status = "cancelled";
    await task.save();
    res.status(200).json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { createTask, getTasks, cancelTask };
