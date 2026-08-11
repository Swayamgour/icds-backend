const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const buildScopeFilter = require("../middleware/scopeFilter");
const { createRecord, getRecords, reviewRecord } = require("../controllers/recordController");

router.use(protect, buildScopeFilter);

router.post("/", createRecord); // awc role only
router.get("/", getRecords); // auto-scoped, supports ?fromDate=&toDate=&status=
router.patch("/:id/review", reviewRecord); // sector/block/district approve-reject

module.exports = router;
