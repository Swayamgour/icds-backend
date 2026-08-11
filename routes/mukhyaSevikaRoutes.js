const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const buildScopeFilter = require("../middleware/scopeFilter");
const {
  createMukhyaSevikaEntry,
  getMukhyaSevikaEntries,
  reviewMukhyaSevikaEntry,
} = require("../controllers/mukhyaSevikaController");

router.use(protect, buildScopeFilter);

router.post("/", createMukhyaSevikaEntry); // sector role only
router.get("/", getMukhyaSevikaEntries); // district/block/sector, supports ?fromDate=&toDate=&status=
router.patch("/:id/review", reviewMukhyaSevikaEntry); // block/district approve-reject

module.exports = router;
