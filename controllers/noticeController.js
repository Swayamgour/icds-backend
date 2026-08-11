const Notice = require("../models/Notice");
const { ROLES } = require("../config/roles");

// @desc   List notices - auto-scoped. AWC/sector users see only their own.
// @route  GET /api/notices
// @access Private (any role)
const getNotices = async (req, res) => {
  try {
    const filter = { ...req.scopeFilter };
    if ([ROLES.AWC, ROLES.SECTOR].includes(req.user.role)) filter.user = req.user._id;
    if (req.query.acknowledged !== undefined) filter.acknowledged = req.query.acknowledged === "true";

    const notices = await Notice.find(filter).populate("user", "name email role").sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: notices.length, notices });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc   Mark a notice as acknowledged (by the worker it was issued to)
// @route  PATCH /api/notices/:id/acknowledge
// @access Private (the notice's own user)
const acknowledgeNotice = async (req, res) => {
  try {
    const notice = await Notice.findOne({ _id: req.params.id, user: req.user._id });
    if (!notice) {
      return res.status(404).json({ success: false, message: "Notice not found" });
    }
    notice.acknowledged = true;
    notice.acknowledgedAt = new Date();
    await notice.save();
    res.status(200).json({ success: true, notice });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getNotices, acknowledgeNotice };
