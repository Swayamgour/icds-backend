const { saveUpload } = require("../utils/localUpload");

// @desc   Upload one or more photos (form-data field name: "photos"). Files
//         are saved inside the project's uploads/ folder and served at
//         /uploads/<filename>. Client then attaches GPS lat/lng + capturedAt
//         alongside each returned url when submitting a Record /
//         MukhyaSevikaEntry / TaskSubmission / SupervisorVisit.
// @route  POST /api/upload
// @access Private (any role)
const uploadPhotos = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: "No files uploaded" });
    }

    const results = await Promise.all(req.files.map((f) => saveUpload(req, f)));

    const files = results.map((r, i) => ({
      url: r.url,
      publicId: r.publicId,
      originalName: req.files[i].originalname,
      size: req.files[i].size,
    }));

    res.status(201).json({ success: true, files });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { uploadPhotos };
