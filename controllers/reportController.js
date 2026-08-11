const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const Record = require("../models/Record");
const Awc = require("../models/Awc");
const Grade = require("../models/Grade");

const dateFilterFromQuery = (req) => {
  const filter = { ...req.scopeFilter };
  if (req.query.fromDate || req.query.toDate) {
    filter.date = {};
    if (req.query.fromDate) filter.date.$gte = new Date(req.query.fromDate);
    if (req.query.toDate) filter.date.$lte = new Date(req.query.toDate);
  }
  return filter;
};

const RECORD_COLUMNS = [
  { header: "Date", key: "date", width: 12 },
  { header: "Block", key: "blockName", width: 16 },
  { header: "Sector", key: "sectorName", width: 16 },
  { header: "AWC", key: "awcName", width: 16 },
  { header: "Registered Children", key: "registeredChildrenCount", width: 10 },
  { header: "Center Open", key: "centerOpen", width: 10 },
  { header: "Morning Meal Count", key: "morningMealChildrenCount", width: 10 },
  { header: "Milk Pouch Count", key: "milkPouchCount", width: 10 },
  { header: "Quality", key: "qualityOfMeal", width: 10 },
  { header: "Status", key: "status", width: 10 },
];

// @desc   Export worker records as an Excel file (daily/weekly/monthly via date range)
// @route  GET /api/reports/records/excel?fromDate=&toDate=
// @access Private (any role)
const exportRecordsExcel = async (req, res) => {
  try {
    const records = await Record.find(dateFilterFromQuery(req)).sort({ date: -1 }).lean();

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Records");
    sheet.columns = RECORD_COLUMNS;
    sheet.getRow(1).font = { bold: true };

    records.forEach((r) => {
      sheet.addRow({
        ...r,
        date: new Date(r.date).toLocaleDateString("en-IN"),
        centerOpen: r.centerOpen ? "Yes" : "No",
      });
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=records-report.xlsx");
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc   Export worker records as a PDF table
// @route  GET /api/reports/records/pdf?fromDate=&toDate=
// @access Private (any role)
const exportRecordsPdf = async (req, res) => {
  try {
    const records = await Record.find(dateFilterFromQuery(req)).sort({ date: -1 }).lean();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=records-report.pdf");

    const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });
    doc.pipe(res);

    doc.fontSize(16).text("Worker Records Report", { align: "center" });
    doc.moveDown();
    doc.fontSize(9);

    const headers = ["Date", "Block", "Sector", "AWC", "Reg. Children", "Open", "Morning Meal", "Milk", "Quality", "Status"];
    doc.text(headers.join(" | "));
    doc.moveDown(0.3);

    records.forEach((r) => {
      const row = [
        new Date(r.date).toLocaleDateString("en-IN"),
        r.blockName || "-",
        r.sectorName || "-",
        r.awcName || "-",
        r.registeredChildrenCount,
        r.centerOpen ? "Yes" : "No",
        r.morningMealChildrenCount,
        r.milkPouchCount,
        r.qualityOfMeal || "-",
        r.status,
      ];
      doc.text(row.join(" | "));
    });

    doc.end();
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc   Heat map data - one point per AWC with its latest grade, for
//         plotting on a map (regional performance visualization).
// @route  GET /api/reports/heatmap?period=YYYY-MM
// @access Private (any role)
const getHeatmapData = async (req, res) => {
  try {
    const gradeFilter = { ...req.scopeFilter };
    if (req.query.period) gradeFilter.period = req.query.period;

    const grades = await Grade.find(gradeFilter).lean();
    const awcCodes = grades.map((g) => g.awcCode).filter(Boolean);
    const awcs = await Awc.find({ code: { $in: awcCodes } }).lean();
    const awcByCode = Object.fromEntries(awcs.map((a) => [a.code, a]));

    const points = grades
      .filter((g) => g.awcCode && awcByCode[g.awcCode])
      .map((g) => ({
        awcCode: g.awcCode,
        awcName: awcByCode[g.awcCode].name,
        latitude: awcByCode[g.awcCode].latitude,
        longitude: awcByCode[g.awcCode].longitude,
        totalScore: g.totalScore,
        grade: g.grade,
      }));

    res.status(200).json({ success: true, count: points.length, points });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { exportRecordsExcel, exportRecordsPdf, getHeatmapData };
