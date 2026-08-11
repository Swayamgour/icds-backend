const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const buildScopeFilter = require("../middleware/scopeFilter");
const { createTask, getTasks, cancelTask } = require("../controllers/taskController");

router.use(protect, buildScopeFilter);

router.post("/", createTask); // district, block, sector
router.get("/", getTasks); // auto-scoped: my individual + group tasks, or all I created
router.patch("/:id/cancel", cancelTask);

module.exports = router;
