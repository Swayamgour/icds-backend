// @desc   Upload one or more photos (form-data field name: "photos"). Client
//         then attaches GPS lat/lng + capturedAt alongside each returned url
//         when submitting a Record / MukhyaSevikaEntry / TaskSubmission.
// @route  POST /api/upload
// @access Private (any role)
const uploadPhotos = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: "No files uploaded" });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const files = req.files.map((f) => ({
      url: `${baseUrl}/uploads/${f.filename}`,
      originalName: f.originalname,
      size: f.size,
    }));

    res.status(201).json({ success: true, files });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { uploadPhotos };
