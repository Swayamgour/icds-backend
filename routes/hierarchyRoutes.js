const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/auth");
const buildScopeFilter = require("../middleware/scopeFilter");
const { ROLES } = require("../config/roles");
const {
  createDistrict,
  getDistricts,
  createBlock,
  getBlocks,
  createSector,
  getSectors,
  createAwc,
  getAwcs,
} = require("../controllers/hierarchyController");

router.use(protect, buildScopeFilter);

// Only district-level users can create master hierarchy entries
router.post("/district", authorize(ROLES.DISTRICT), createDistrict);
router.get("/district", getDistricts);

router.post("/block", authorize(ROLES.DISTRICT), createBlock);
router.get("/block", getBlocks);

router.post("/sector", authorize(ROLES.DISTRICT, ROLES.BLOCK), createSector);
router.get("/sector", getSectors);

router.post("/awc", authorize(ROLES.DISTRICT, ROLES.BLOCK, ROLES.SECTOR), createAwc);
router.get("/awc", getAwcs);

module.exports = router;
