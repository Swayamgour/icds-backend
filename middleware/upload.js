const multer = require("multer");

// Files are kept in memory (never written to local disk) and uploaded to
// Cloudinary by the controller. Used by POST /api/upload (generic single/
// multi photo upload used by MukhyaSevikaEntry / TaskSubmission flows).
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

module.exports = upload;
