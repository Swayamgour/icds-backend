const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const buildScopeFilter = require("../middleware/scopeFilter");
const { exportRecordsExcel, exportRecordsPdf, getHeatmapData } = require("../controllers/reportController");

router.use(protect, buildScopeFilter);

router.get("/records/excel", exportRecordsExcel);
router.get("/records/pdf", exportRecordsPdf);
router.get("/heatmap", getHeatmapData);

module.exports = router;
