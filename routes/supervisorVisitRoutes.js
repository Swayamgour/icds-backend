const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const buildScopeFilter = require("../middleware/scopeFilter");
const {
  getPrefill,
  startVisit,
  saveSection,
  getVisits,
  getVisitById,
  reviewVisit,
  deleteDraft,
} = require("../controllers/supervisorVisitController");

router.use(protect, buildScopeFilter);

router.get("/prefill/:awcCode", getPrefill); // supervisor - AWC name + registered children for the form
router.post("/", startVisit); // supervisor - pick an AWC in own sector, start inspection
router.get("/", getVisits); // auto-scoped list
router.get("/:id", getVisitById);
router.put("/:id/sections/:section", saveSection); // section = general | a | b | c
router.patch("/:id/review", reviewVisit); // block/district approve-reject
router.delete("/:id", deleteDraft); // supervisor, drafts only

module.exports = router;
