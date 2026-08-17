const mongoose = require("mongoose");
const { submissionFields, photoProofSchema } = require("./shared/submissionFields");

const recordSchema = new mongoose.Schema(
  {
    districtCode: { type: String, required: true, index: true },
    blockCode: { type: String, required: true, index: true },
    sectorCode: { type: String, required: true, index: true },
    awcCode: { type: String, required: true, index: true },

    blockName: { type: String },
    sectorName: { type: String },
    awcName: { type: String },

    date: {
      type: Date,
      required: true,
      default: Date.now,
    },

    registeredChildrenCount: {
      type: Number,
      default: 0,
    },

    centerOpen: {
      type: Boolean,
      default: true,
    },

    // Today's activity
    activityStatus: {
      type: String,
      enum: ["present", "meeting", "leave"],
      default: "present",
    },

    // Morning
    morningMealChildrenCount: {
      type: Number,
      default: 0,
    },

    morningMenu: {
      type: String,
      default: "",
    },

    // Fixed photo slot - Cloudinary url + latitude + longitude + capturedAt.
    // Undefined/absent means no photo was captured for this record.
    morningDishPhoto: {
      type: photoProofSchema,
    },

    childrenEatingBreakfastPhoto: {
      type: photoProofSchema,
    },

    milkPouchGiven: {
      type: Boolean,
      default: false,
    },

    milkPouchCount: {
      type: Number,
      default: 0,
    },

    // Afternoon
    afternoonMealGiven: {
      type: Boolean,
      default: false,
    },

    afternoonMealChildrenCount: {
      type: Number,
      default: 0,
    },

    afternoonMenu: {
      type: String,
      default: "",
    },

    afternoonDishPhoto: {
      type: photoProofSchema,
    },

    childrenEatingAfternoonPhoto: {
      type: photoProofSchema,
    },

    // Pre-education
    preEducationConducted: {
      type: Boolean,
      default: false,
    },

    preEducationChildrenCount: {
      type: Number,
      default: 0,
    },

    preEducationPhoto: {
      type: photoProofSchema,
    },

    // Poshan Sudha Yojana
    poshanDishGiven: {
      type: Boolean,
      default: false,
    },

    poshanMenu: {
      type: String,
      default: "",
    },

    poshanBenefitGiven: {
      type: Boolean,
      default: false,
    },

    poshanSudhaCount: {
      type: Number,
      default: 0,
    },

    photoBeneficiariesNutrition: {
      type: photoProofSchema,
    },

    qualityOfMeal: {
      type: String,
      enum: ["good", "average", "bad"],
    },

    remarks: {
      type: String,
    },

    ...submissionFields,

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// =====================================================
// ONE AWC = ONE RECORD PER DAY
// =====================================================

recordSchema.index(
  {
    awcCode: 1,
    date: 1,
  },
  {
    unique: true,
    name: "unique_awc_daily_record",
  }
);

module.exports = mongoose.model(
  "Record",
  recordSchema
);