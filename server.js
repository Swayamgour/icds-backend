require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const connectDB = require("./config/db");

const authRoutes = require("./routes/authRoutes");
const hierarchyRoutes = require("./routes/hierarchyRoutes");
const recordRoutes = require("./routes/recordRoutes");
const mukhyaSevikaRoutes = require("./routes/mukhyaSevikaRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const userRoutes = require("./routes/userRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const taskRoutes = require("./routes/taskRoutes");
const taskSubmissionRoutes = require("./routes/taskSubmissionRoutes");
const gradeRoutes = require("./routes/gradeRoutes");
const reportRoutes = require("./routes/reportRoutes");
const noticeRoutes = require("./routes/noticeRoutes");

connectDB();

const app = express();
app.use(cors());
app.use(express.json());


// Uploaded photos are served statically from here (URLs returned by POST /api/upload)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/", (req, res) => {
  res.send("Field Workforce Monitoring API is running");
});

app.use("/api/auth", authRoutes);
app.use("/api/hierarchy", hierarchyRoutes);
app.use("/api/records", recordRoutes);
app.use("/api/mukhya-sevika", mukhyaSevikaRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/users", userRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/task-submissions", taskSubmissionRoutes);
app.use("/api/grades", gradeRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/notices", noticeRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// Global error handler (also catches multer file-type/size errors)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: err.message || "Server error" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
