const User = require("../models/User");
const { ROLES, ROLE_ORDER } = require("../config/roles");

// @desc   List users under the logged-in user's scope (district sees all, block sees
//         its block's users, sector sees its sector's users, awc sees only itself).
//         Mirrors the reference app's "Application User List": name/email, role, status.
// @route  GET /api/users
// @access Private (any role)
const getUsers = async (req, res) => {
  try {
    const filter = { ...req.scopeFilter };
    if (req.query.role) filter.role = req.query.role;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.search) {
      filter.$or = [
        { name: { $regex: req.query.search, $options: "i" } },
        { email: { $regex: req.query.search, $options: "i" } },
      ];
    }

    const users = await User.find(filter).select("-password").sort({ role: 1, name: 1 });
    res.status(200).json({ success: true, count: users.length, users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc   Create a user directly (with password). Hierarchical delegation:
//         each role can only create roles BELOW its own level, and only
//         within its own branch of the hierarchy - e.g. a Block (CDPO) user
//         can create Sector or AWC users, but only inside their own block;
//         a District (Manager) can create any role, anywhere in the
//         district. AWC role cannot create anyone (it's the bottom level).
//         Scope codes at-or-above the creator's own level are always taken
//         from the creator's own account, never from the request body, so a
//         Block user can never plant a user into a different block.
// @route  POST /api/users
// @access Private (district, block, sector)
const createUser = async (req, res) => {
  try {
    if (req.user.role === ROLES.AWC) {
      return res.status(403).json({ success: false, message: "AWC role cannot create users" });
    }

    const { name, email, password, role, blockCode, sectorCode, awcCode } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ success: false, message: "name, email, password and role are required" });
    }
    if (!Object.values(ROLES).includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role" });
    }

    const creatorRank = ROLE_ORDER.indexOf(req.user.role);
    const targetRank = ROLE_ORDER.indexOf(role);
    if (targetRank <= creatorRank) {
      return res.status(403).json({ success: false, message: `Your role (${req.user.role}) can only create roles below itself` });
    }

    // Scope codes at-or-above the creator's own level are locked to the
    // creator's own account; only codes strictly below the creator's level
    // (down to the target role) are taken from the request body.
    const resolvedBlockCode = creatorRank >= ROLE_ORDER.indexOf(ROLES.BLOCK) ? req.user.blockCode : blockCode;
    const resolvedSectorCode = creatorRank >= ROLE_ORDER.indexOf(ROLES.SECTOR) ? req.user.sectorCode : sectorCode;
    const resolvedAwcCode = awcCode;

    if (role === ROLES.BLOCK && !resolvedBlockCode) {
      return res.status(400).json({ success: false, message: "blockCode is required for block role" });
    }
    if (role === ROLES.SECTOR && (!resolvedBlockCode || !resolvedSectorCode)) {
      return res.status(400).json({ success: false, message: "blockCode and sectorCode are required for sector role" });
    }
    if (role === ROLES.AWC && (!resolvedBlockCode || !resolvedSectorCode || !resolvedAwcCode)) {
      return res.status(400).json({ success: false, message: "blockCode, sectorCode and awcCode are required for awc role" });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ success: false, message: "Email already registered" });
    }

    const user = await User.create({
      name,
      email,
      password,
      role,
      districtCode: req.user.districtCode, // new user always belongs to the creator's own district
      blockCode: resolvedBlockCode,
      sectorCode: resolvedSectorCode,
      awcCode: resolvedAwcCode,
      status: "accepted", // created directly, so no pending step
    });

    res.status(201).json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc   Accept or reject a user under the caller's scope
// @route  PATCH /api/users/:id/status
// @access Private (district, block, sector - not awc)
const updateUserStatus = async (req, res) => {
  try {
    if (req.user.role === ROLES.AWC) {
      return res.status(403).json({ success: false, message: "AWC role cannot manage other users" });
    }

    const { status } = req.body;
    if (!["accepted", "rejected"].includes(status)) {
      return res.status(400).json({ success: false, message: "status must be 'accepted' or 'rejected'" });
    }

    const user = await User.findOne({ _id: req.params.id, ...req.scopeFilter });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found in your scope" });
    }

    user.status = status;
    await user.save();

    res.status(200).json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc   Delete a user under the caller's scope. Same hierarchy rule as
//         creation: you can only delete roles below your own level.
// @route  DELETE /api/users/:id
// @access Private (district, block, sector)
const deleteUser = async (req, res) => {
  try {
    if (req.user.role === ROLES.AWC) {
      return res.status(403).json({ success: false, message: "AWC role cannot delete users" });
    }

    const target = await User.findOne({ _id: req.params.id, ...req.scopeFilter });
    if (!target) {
      return res.status(404).json({ success: false, message: "User not found in your scope" });
    }

    const creatorRank = ROLE_ORDER.indexOf(req.user.role);
    const targetRank = ROLE_ORDER.indexOf(target.role);
    if (targetRank <= creatorRank) {
      return res.status(403).json({ success: false, message: "You can only delete roles below your own" });
    }

    await target.deleteOne();
    res.status(200).json({ success: true, message: "User deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getUsers, createUser, updateUserStatus, deleteUser };
