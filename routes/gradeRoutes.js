const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const buildScopeFilter = require("../middleware/scopeFilter");
const { generateGrades, getGrades, updateGrade } = require("../controllers/gradeController");

router.use(protect, buildScopeFilter);

router.post("/generate", generateGrades); // district, block, sector
router.get("/", getGrades); // auto-scoped, awc sees only its own grade
router.patch("/:id", updateGrade); // manual override

module.exports = router;
