const fs = require("fs");
const path = require("path");

// All uploaded photos are stored inside this folder (<project>/uploads) and
// served by server.js at  <host>/uploads/<filename>
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");

const EXT_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

// Writes one multer in-memory file into the uploads/ folder.
// Returns { url, publicId }:
//   url      - full URL the frontend can use directly in <img src>
//   publicId - the file name inside uploads/ (use it to delete/replace later)
// `prefix` is only used to make file names easier to recognise
// (e.g. "morningDishPhoto-1786...-123.jpg").
async function saveUpload(req, file, { prefix = "" } = {}) {
  await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });

  const safePrefix = String(prefix).replace(/[^a-zA-Z0-9_-]/g, "");
  const ext = EXT_BY_MIME[file.mimetype] || ".jpg"; // extension comes from the mime type, never from the client's file name
  const filename = `${safePrefix ? `${safePrefix}-` : ""}${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;

  await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), file.buffer);

  // BASE_URL (optional .env) wins, e.g. https://jjc.admin.amaxjobs.com
  const base = (process.env.BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");

  return { url: `${base}/uploads/${filename}`, publicId: filename };
}

module.exports = { saveUpload, UPLOAD_DIR };
