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

    if (!login || !password) {
      return res.status(400).json({
        success: false,
        message: "Login code/email and password are required",
      });
    }

    console.log("LOGIN REQUEST:", {
      login,
      password,
    });

    const user = await User.findOne({
      $or: [
        { email: login },
        { districtCode: login },
        { blockCode: login },
        { sectorCode: login },
        { awcCode: login },
      ],
    });

    console.log("USER FOUND:", user);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Email/code not found",
      });
    }

    const isPasswordValid = await user.matchPassword(password);

    console.log("PASSWORD VALID:", isPasswordValid);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid password",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account is deactivated",
      });
    }

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      token,
      user,
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// @desc   Get logged-in user's own profile
// @route  GET /api/auth/me
// @access Private
const getMe = async (req, res) => {
  res.status(200).json({ success: true, user: req.user });
};

module.exports = { registerUser, loginUser, getMe };
