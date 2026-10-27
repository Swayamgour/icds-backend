const mongoose = require("mongoose");
const {
  submissionFields,
  photoProofSchema,
} = require("./shared/submissionFields");

const recordSchema = new mongoose.Schema(
  {
    // =====================================================
    // LOCATION / SCOPE
    // =====================================================

    districtCode: {
      type: String,
      required: true,
      index: true,
    },

    blockCode: {
      type: String,
      required: true,
      index: true,
    },

    sectorCode: {
      type: String,
      required: true,
      index: true,
    },

    awcCode: {
      type: String,
      required: true,
      index: true,
    },

    blockName: {
      type: String,
    },

    sectorName: {
      type: String,
    },

    awcName: {
      type: String,
    },

    // =====================================================
    // DATE
    // =====================================================

    date: {
      type: Date,
      required: true,
      default: Date.now,
    },

    // =====================================================
    // GENERAL INFORMATION
    // =====================================================

    // Total registered children (3-6 years)
    registeredChildrenCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // NEW FIELD:
    // Number of registered children who actually attended today
    childrenAttendedCount: {
      type: Number,
      default: 0,
      min: 0,
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

    // =====================================================
    // MORNING
    // =====================================================

    morningMealChildrenCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    morningMenu: {
      type: String,
      default: "",
    },

    // Fixed photo slot - uploads/ url + latitude + longitude + capturedAt.
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
      min: 0,
    },

    // =====================================================
    // AFTERNOON
    // =====================================================

    afternoonMealGiven: {
      type: Boolean,
      default: false,
    },

    afternoonMealChildrenCount: {
      type: Number,
      default: 0,
      min: 0,
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

    // =====================================================
    // PRE-EDUCATION
    // =====================================================

    preEducationConducted: {
      type: Boolean,
      default: false,
    },

    preEducationChildrenCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    preEducationPhoto: {
      type: photoProofSchema,
    },

    // =====================================================
    // POSHAN SUDHA YOJANA
    // =====================================================

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
      min: 0,
    },

    photoBeneficiariesNutrition: {
      type: photoProofSchema,
    },

    // =====================================================
    // OTHER INFORMATION
    // =====================================================

    qualityOfMeal: {
      type: String,
      enum: ["good", "average", "bad"],
      default: "good",
    },

    remarks: {
      type: String,
      default: "",
    },

    // =====================================================
    // SHARED SUBMISSION FIELDS
    // GPS, status, review fields, photos etc.
    // =====================================================

    ...submissionFields,

    // =====================================================
    // CREATED BY
    // =====================================================

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

module.exports = mongoose.model("Record", recordSchema);