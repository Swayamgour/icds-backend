const Record = require("../models/Record");
const Awc = require("../models/Awc");
const Block = require("../models/Block");
const Sector = require("../models/Sector");
const { ROLES } = require("../config/roles");

const createRecord = async (req, res) => {
  try {
    if (req.user.role !== ROLES.AWC) {
      return res.status(403).json({ success: false, message: "Only AWC role can submit center records" });
    }

    const { districtCode, blockCode, sectorCode, awcCode } = req.user;

    const [block, sector, awc] = await Promise.all([
      Block.findOne({ code: blockCode }),
      Sector.findOne({ code: sectorCode }),
      Awc.findOne({ code: awcCode }),
    ]);

    const record = await Record.create({
      ...req.body,
      districtCode,
      blockCode,
      sectorCode,
      awcCode,
      blockName: block?.name,
      sectorName: sector?.name,
      awcName: awc?.name,
      checkInTime: req.body.checkInTime || new Date(),
      status: "pending",
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getRecords = async (req, res) => {
  try {
    const filter = { ...req.scopeFilter };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.fromDate || req.query.toDate) {
      filter.date = {};
      if (req.query.fromDate) filter.date.$gte = new Date(req.query.fromDate);
      if (req.query.toDate) filter.date.$lte = new Date(req.query.toDate);
    }

    const records = await Record.find(filter)
      .populate("createdBy", "name")
      .populate("reviewedBy", "name")
      .sort({ date: -1 });

    res.status(200).json({ success: true, count: records.length, records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const reviewRecord = async (req, res) => {
  try {
    if (req.user.role === ROLES.AWC) {
      return res.status(403).json({ success: false, message: "AWC role cannot review records" });
    }

    const { status, remarks } = req.body;
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ success: false, message: "status must be 'approved' or 'rejected'" });
    }

    const record = await Record.findOne({ _id: req.params.id, ...req.scopeFilter });
    if (!record) {
      return res.status(404).json({ success: false, message: "Record not found in your scope" });
    }

    record.status = status;
    record.reviewedBy = req.user._id;
    record.reviewedAt = new Date();
    record.reviewRemarks = remarks;
    await record.save();

    res.status(200).json({ success: true, record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { createRecord, getRecords, reviewRecord };