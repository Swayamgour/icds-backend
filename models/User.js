const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { ROLES } = require("../config/roles");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6 },

    role: {
      type: String,
      enum: Object.values(ROLES),
      required: true,
    },

    // Codes as seen in the sheet: 24445 / 2444501 / 244450101 / 24445010113
    // A user only needs the code(s) up to and including their own level.
    districtCode: { type: String, required: true },
    blockCode: { type: String }, // required for block, sector, awc
    sectorCode: { type: String }, // required for sector, awc
    awcCode: { type: String }, // required for awc

    isActive: { type: Boolean, default: true },
    status: { type: String, enum: ["accepted", "rejected"], default: "accepted" },
  },
  { timestamps: true }
);

// Hash password before save
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

// Never send password hash back in API responses
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model("User", userSchema);
