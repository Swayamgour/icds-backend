const MukhyaSevikaEntry = require("../models/MukhyaSevikaEntry");
const Block = require("../models/Block");
const Sector = require("../models/Sector");
const Awc = require("../models/Awc");
const { ROLES } = require("../config/roles");

// @desc   Submit a visit entry for one AWC - Sector (MS/Supervisor) only.
//         Include GPS check-in and photos[] (from POST /api/upload).
// @route  POST /api/mukhya-sevika
// @access Private (sector only)
const createMukhyaSevikaEntry = async (req, res) => {
  try {
    if (req.user.role !== ROLES.SECTOR) {
      return res.status(403).json({ success: false, message: "Only Sector (Mukhya Sevika) role can submit visit entries" });
    }

    const { awcCode } = req.body;
    if (!awcCode) {
      return res.status(400).json({ success: false, message: "awcCode is required" });
    }

    const { districtCode, blockCode, sectorCode } = req.user;

    const [block, sector, awc] = await Promise.all([
      Block.findOne({ code: blockCode }),
      Sector.findOne({ code: sectorCode }),
      Awc.findOne({ code: awcCode, sectorCode }), // must belong to this supervisor's own sector
    ]);

    if (!awc) {
      return res.status(404).json({ success: false, message: "AWC not found in your sector" });
    }

    const entry = await MukhyaSevikaEntry.create({
      ...req.body,
      districtCode,
      blockCode,
      sectorCode,
      awcCode,
      blockName: block?.name,
      sectorName: sector?.name,
      awcName: awc?.name,
      mukhyaSevikaName: req.user.name,
      checkInTime: req.body.checkInTime || new Date(),
      status: "pending",
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, entry });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc   List visit entries - auto-scoped. Filter by ?fromDate=&toDate=&status=
// @route  GET /api/mukhya-sevika
// @access Private (district, block, sector)
const getMukhyaSevikaEntries = async (req, res) => {
  try {
    if (req.user.role === ROLES.AWC) {
      return res.status(403).json({ success: false, message: "AWC role does not have access to Mukhya Sevika entries" });
    }

    const filter = { ...req.scopeFilter };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.fromDate || req.query.toDate) {
      filter.date = {};
      if (req.query.fromDate) filter.date.$gte = new Date(req.query.fromDate);
      if (req.query.toDate) filter.date.$lte = new Date(req.query.toDate);
    }

    const entries = await MukhyaSevikaEntry.find(filter).sort({ date: -1 });
    res.status(200).json({ success: true, count: entries.length, entries });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc   Approve or reject a supervisor's visit entry
// @route  PATCH /api/mukhya-sevika/:id/review
// @access Private (block, district only)
const reviewMukhyaSevikaEntry = async (req, res) => {
  try {
    if (req.user.role === ROLES.AWC || req.user.role === ROLES.SECTOR) {
      return res.status(403).json({ success: false, message: "Only block/district can review Mukhya Sevika entries" });
    }

    const { status, remarks } = req.body;
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ success: false, message: "status must be 'approved' or 'rejected'" });
    }

    const entry = await MukhyaSevikaEntry.findOne({ _id: req.params.id, ...req.scopeFilter });
    if (!entry) {
      return res.status(404).json({ success: false, message: "Entry not found in your scope" });
    }

    entry.status = status;
    entry.reviewedBy = req.user._id;
    entry.reviewedAt = new Date();
    entry.reviewRemarks = remarks;
    await entry.save();

    res.status(200).json({ success: true, entry });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { createMukhyaSevikaEntry, getMukhyaSevikaEntries, reviewMukhyaSevikaEntry };
