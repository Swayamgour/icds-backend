const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const buildScopeFilter = require("../middleware/scopeFilter");
const {
  createTaskSubmission,
  getTaskSubmissions,
  reviewTaskSubmission,
} = require("../controllers/taskSubmissionController");

router.use(protect, buildScopeFilter);

router.post("/", createTaskSubmission); // sector, awc
router.get("/", getTaskSubmissions); // auto-scoped
router.patch("/:id/review", reviewTaskSubmission); // district, block, sector

module.exports = router;
