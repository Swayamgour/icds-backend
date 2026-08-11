const jwt = require("jsonwebtoken");

const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
      districtCode: user.districtCode,
      blockCode: user.blockCode,
      sectorCode: user.sectorCode,
      awcCode: user.awcCode,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
};

module.exports = generateToken;
