const { uploadBufferToCloudinary } = require("../utils/cloudinaryUpload");

// @desc   Upload one or more photos (form-data field name: "photos") straight
//         to Cloudinary. Client then attaches GPS lat/lng + capturedAt
//         alongside each returned url when submitting a Record /
//         MukhyaSevikaEntry / TaskSubmission.
// @route  POST /api/upload
// @access Private (any role)
const uploadPhotos = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: "No files uploaded" });
    }

    const results = await Promise.all(
      req.files.map((f) =>
        uploadBufferToCloudinary(f.buffer, {
          folder: "icds/uploads",
          publicId: `${Date.now()}-${Math.round(Math.random() * 1e9)}`,
        })
      )
    );

    const files = results.map((r, i) => ({
      url: r.secure_url,
      publicId: r.public_id,
      originalName: req.files[i].originalname,
      size: req.files[i].size,
    }));

    res.status(201).json({ success: true, files });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { uploadPhotos };
