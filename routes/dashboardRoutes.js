const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const buildScopeFilter = require("../middleware/scopeFilter");
const { getDashboard } = require("../controllers/dashboardController");

router.use(protect, buildScopeFilter);

router.get("/", getDashboard);

module.exports = router;
