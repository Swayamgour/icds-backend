const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const upload = require("../middleware/upload");
const { uploadPhotos } = require("../controllers/uploadController");

router.post("/", protect, upload.array("photos", 10), uploadPhotos);

module.exports = router;
