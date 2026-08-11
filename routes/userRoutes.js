const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const buildScopeFilter = require("../middleware/scopeFilter");
const { getUsers, createUser, updateUserStatus, deleteUser } = require("../controllers/userController");

router.use(protect, buildScopeFilter);

router.get("/", getUsers); // auto-scoped list, supports ?role=&status=&search=
router.post("/", createUser); // district/block/sector - can only create roles below their own (checked in controller)
router.patch("/:id/status", updateUserStatus); // accept/reject - district/block/sector
router.delete("/:id", deleteUser); // district/block/sector - can only delete roles below their own

module.exports = router;
