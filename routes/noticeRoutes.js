const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const buildScopeFilter = require("../middleware/scopeFilter");
const { getNotices, acknowledgeNotice } = require("../controllers/noticeController");

router.use(protect, buildScopeFilter);

router.get("/", getNotices); // auto-scoped
router.patch("/:id/acknowledge", acknowledgeNotice);

module.exports = router;
