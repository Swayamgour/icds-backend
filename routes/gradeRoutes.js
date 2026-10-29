const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/auth");
const buildScopeFilter = require("../middleware/scopeFilter");
const { ROLES } = require("../config/roles");
const { getRanking, getTopPerformers, getAwcHistory, recalculate } = require("../controllers/gradeController");

// Same guard chain as every other protected resource: JWT -> role scope filter.
router.use(protect, buildScopeFilter);

const managers = [ROLES.DISTRICT, ROLES.BLOCK, ROLES.SUPERVISOR, ROLES.SECTOR];

router.get("/ranking", authorize(...managers), getRanking);
router.get("/top", authorize(...managers), getTopPerformers);
router.get("/awc/:awcCode", getAwcHistory); // awc role -> only its own centre (scopeFilter)

router.post("/recalculate", authorize(...managers), recalculate);
router.post("/generate", authorize(...managers), recalculate); // documented in README

router.get("/", authorize(...managers), getRanking); // documented in README: GET /api/grades?period=YYYY-MM

module.exports = router;
