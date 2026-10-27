const User = require("../models/User");
const generateToken = require("../utils/generateToken");
const { ROLES } = require("../config/roles");




// @desc   Register a new user (any role)


// @route  POST /api/auth/register
// @access Public (in production, restrict this to admin/district only)
const registerUser = async (req, res) => {
  try {
    const { name, email, password, role, districtCode, blockCode, sectorCode, awcCode } = req.body;

    if (!name || !email || !password || !role || !districtCode) {
      return res.status(400).json({
        success: false,
        message: "name, email, password, role and districtCode are required",
      });
    }

    if (!Object.values(ROLES).includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role" });
    }

    // Enforce that the correct codes are present for each role level
    if (role === ROLES.BLOCK && !blockCode) {
      return res.status(400).json({ success: false, message: "blockCode is required for block role" });
    }
    if (role === ROLES.SUPERVISOR && (!blockCode || !sectorCode)) {
      return res.status(400).json({ success: false, message: "blockCode and sectorCode are required for supervisor role" });
    }
    if (role === ROLES.SECTOR && (!blockCode || !sectorCode)) {
      return res.status(400).json({ success: false, message: "blockCode and sectorCode are required for sector role" });
    }
    if (role === ROLES.AWC && (!blockCode || !sectorCode || !awcCode)) {
      return res.status(400).json({ success: false, message: "blockCode, sectorCode and awcCode are required for awc role" });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ success: false, message: "Email already registered" });
    }

    // Only ONE supervisor per sector
    if (role === ROLES.SUPERVISOR) {
      const supervisorExists = await User.findOne({ role: ROLES.SUPERVISOR, sectorCode });
      if (supervisorExists) {
        return res.status(400).json({ success: false, message: "This sector already has a supervisor" });
      }
    }

    const user = await User.create({
      name,
      email,
      password,
      role,
      districtCode,
      blockCode,
      sectorCode,
      awcCode,
    });

    const token = generateToken(user);

    res.status(201).json({ success: true, token, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc   Login
// @route  POST /api/auth/login
// @access Public
const loginUser = async (req, res) => {
  try {
    const { login, password } = req.body;
    console.log("STEP 1 - Request body:", { ...req.body, password: "***" });

    if (!login || !password) {
      console.log("STEP 1 FAIL - login or password missing");
      return res.status(400).json({
        success: false,
        message: "Login code/email and password are required",
      });
    }

    console.log("STEP 2 - Searching user with login value:", login, "| typeof:", typeof login);

    const query = {
      $or: [
        { email: login },
        { role: "district", districtCode: login },
        { role: "block", blockCode: login },
        { role: "supervisor", supervisorCode: login }, // e.g. SUP244450101
        { role: "sector", sectorCode: login },
        { role: "awc", awcCode: login },
      ],
    };
    console.log("STEP 2 - Query used:", JSON.stringify(query));

    const user = await User.findOne(query);

    console.log("STEP 3 - User found?:", !!user);
    if (user) {
      console.log("STEP 3 - User details:", {
        id: user._id,
        role: user.role,
        email: user.email,
        districtCode: user.districtCode,
        blockCode: user.blockCode,
        sectorCode: user.sectorCode,
        supervisorCode: user.supervisorCode,
        awcCode: user.awcCode,
        isActive: user.isActive,
      });
    } else {
      console.log("STEP 3 FAIL - No user matched this login value in DB");
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Email/code not found",
      });
    }

    console.log("STEP 4 - Checking password...");
    const isPasswordValid = await user.matchPassword(password);
    console.log("STEP 4 - Password valid?:", isPasswordValid);

    if (!isPasswordValid) {
      console.log("STEP 4 FAIL - Password did not match");
      return res.status(401).json({
        success: false,
        message: "Invalid password",
      });
    }

    console.log("STEP 5 - Checking isActive:", user.isActive);
    if (!user.isActive) {
      console.log("STEP 5 FAIL - Account inactive");
      return res.status(403).json({
        success: false,
        message: "Account is deactivated",
      });
    }

    console.log("STEP 6 - Generating token...");
    const token = generateToken(user);
    console.log("STEP 6 - Token generated:", token ? "YES" : "NO");

    console.log("STEP 7 - Login successful for:", user.role, user.email);

    return res.status(200).json({
      success: true,
      token,
      user,
    });
  } catch (err) {
    console.error("LOGIN ERROR (catch block):", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// @desc   Get logged-in user's own profile
// @route  GET /api/auth/me
// @access Private
const getMe = async (req, res) => {
  res.status(200).json({ success: true, user: req.user });
};

module.exports = { registerUser, loginUser, getMe };
