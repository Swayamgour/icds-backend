// Test-only stand-in for the project's JWT middleware: the "logged-in user" comes from the x-test-user header.
const protect = (req, res, next) => {
  try {
    const raw = req.headers["x-test-user"];
    if (!raw) return res.status(401).json({ success: false, message: "Not authorized, no token" });
    req.user = JSON.parse(raw);
    next();
  } catch (e) {
    res.status(401).json({ success: false, message: "Not authorized" });
  }
};
const authorize = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ success: false, message: "Role not permitted" });
module.exports = { protect, authorize };
