const multer = require("multer");

// The 6 fixed photo slots for a Worker's Daily Record (matches the fields
// on models/Record.js).
const RECORD_PHOTO_FIELDS = [
  "morningDishPhoto",
  "childrenEatingBreakfastPhoto",
  "afternoonDishPhoto",
  "childrenEatingAfternoonPhoto",
  "preEducationPhoto",
  "photoBeneficiariesNutrition",
];

// Files are kept in memory here; recordController uploads each buffer to
// Cloudinary (into a per-slot folder) before saving the record.
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error("Only JPEG, PNG or WEBP images are allowed"), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB per photo
});

// Accepts multipart/form-data with up to one file per named slot above.
// Also accepts an optional "photos" field (up to 5) for any extra/misc
// photos that don't belong to one of the 6 fixed slots.
const recordPhotoUpload = upload.fields([
  ...RECORD_PHOTO_FIELDS.map((name) => ({ name, maxCount: 1 })),
  { name: "photos", maxCount: 5 },
]);

module.exports = { recordPhotoUpload, RECORD_PHOTO_FIELDS };
