const { Readable } = require("stream");
const cloudinary = require("../config/cloudinary");

// Pipes an in-memory file buffer (from multer.memoryStorage()) straight to
// Cloudinary - nothing ever touches local disk. Resolves with Cloudinary's
// upload result ({ secure_url, public_id, ... }).
function uploadBufferToCloudinary(buffer, { folder, publicId, resourceType = "image" } = {}) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: resourceType,
        allowed_formats: ["jpg", "jpeg", "png", "webp"],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    Readable.from(buffer).pipe(uploadStream);
  });
}

module.exports = { uploadBufferToCloudinary };
