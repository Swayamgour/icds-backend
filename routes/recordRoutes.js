const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const buildScopeFilter = require("../middleware/scopeFilter");
const { recordPhotoUpload } = require("../middleware/recordPhotoUpload");
const {
  createRecord,
  updateRecordPhotos,
  getRecords,
  reviewRecord,
} = require("../controllers/recordController");

router.use(protect, buildScopeFilter);

// multipart/form-data: text fields + up to one file per photo slot
// (morningDishPhoto, childrenEatingBreakfastPhoto, afternoonDishPhoto,
// childrenEatingAfternoonPhoto, preEducationPhoto,
// photoBeneficiariesNutrition), all uploaded straight to Cloudinary.
// Photos are optional here - you can send none, some, or all 6 now and
// add the rest later.
router.post("/", recordPhotoUpload, createRecord); // awc role only

// Add/replace one or more photo slots on today's own record, one call at a
// time (e.g. morning photo now, afternoon photo a few hours later) - as
// long as the record is still "pending".
router.patch("/:id/photos", recordPhotoUpload, updateRecordPhotos); // awc role, own record only
router.get("/", getRecords); // auto-scoped, supports ?fromDate=&toDate=&status=
router.patch("/:id/review", reviewRecord); // sector/block/district approve-reject

module.exports = router;
