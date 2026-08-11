const mongoose = require("mongoose");
const { submissionFields } = require("./shared/submissionFields");

const recordSchema = new mongoose.Schema(
  {
    districtCode: { type: String, required: true, index: true },
    blockCode: { type: String, required: true, index: true },
    sectorCode: { type: String, required: true, index: true },
    awcCode: { type: String, required: true, index: true },

    blockName: { type: String },
    sectorName: { type: String },
    awcName: { type: String },

    date: { type: Date, required: true, default: Date.now },

    registeredChildrenCount: { type: Number, default: 0 },
    centerOpen: { type: Boolean, default: true },

    // Morning
    morningMealChildrenCount: { type: Number, default: 0 },
    morningMenu: { type: String, default: "" },
    morningDishPhoto: { type: Boolean, default: false },
    childrenEatingBreakfastPhoto: { type: Boolean, default: false },
    milkPouchGiven: { type: Boolean, default: false },
    milkPouchCount: { type: Number, default: 0 },

    // Afternoon
    afternoonMealGiven: { type: Boolean, default: false },
    afternoonMealChildrenCount: { type: Number, default: 0 },
    afternoonMenu: { type: String, default: "" },
    afternoonDishPhoto: { type: Boolean, default: false },
    childrenEatingAfternoonPhoto: { type: Boolean, default: false },

    // Pre-education
    preEducationConducted: { type: Boolean, default: false },
    preEducationChildrenCount: { type: Number, default: 0 },
    preEducationPhoto: { type: Boolean, default: false },

    // Poshan Sudha Yojana
    poshanDishGiven: { type: Boolean, default: false },
    poshanMenu: { type: String, default: "" },
    poshanBenefitGiven: { type: Boolean, default: false },
    poshanSudhaCount: { type: Number, default: 0 },
    photoBeneficiariesNutrition: { type: Boolean, default: false },

    qualityOfMeal: { type: String, enum: ["good", "average", "bad"] },
    remarks: { type: String },

    ...submissionFields,

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Record", recordSchema);