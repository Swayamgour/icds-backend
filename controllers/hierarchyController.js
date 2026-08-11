const District = require("../models/District");
const Block = require("../models/Block");
const Sector = require("../models/Sector");
const Awc = require("../models/Awc");

// ---------- DISTRICT (create/list - district role only creates) ----------

const createDistrict = async (req, res) => {
  try {
    const { code, name } = req.body;
    const district = await District.create({ code, name });
    res.status(201).json({ success: true, district });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDistricts = async (req, res) => {
  try {
    // Every role can only ever belong to one district, so this is always scoped.
    const districts = await District.find({ code: req.user.districtCode });
    res.status(200).json({ success: true, count: districts.length, districts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------- BLOCK ----------

const createBlock = async (req, res) => {
  try {
    const { code, name, districtCode } = req.body;
    const district = await District.findOne({ code: districtCode });
    if (!district) return res.status(404).json({ success: false, message: "District not found" });

    const block = await Block.create({ code, name, districtCode, districtId: district._id });
    res.status(201).json({ success: true, block });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// district -> all blocks in its district | block -> only its own block
const getBlocks = async (req, res) => {
  try {
    const filter = { districtCode: req.scopeFilter.districtCode };
    if (req.scopeFilter.blockCode) filter.code = req.scopeFilter.blockCode;

    const blocks = await Block.find(filter);
    res.status(200).json({ success: true, count: blocks.length, blocks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------- SECTOR ----------

const createSector = async (req, res) => {
  try {
    const { code, name, blockCode } = req.body;
    const block = await Block.findOne({ code: blockCode });
    if (!block) return res.status(404).json({ success: false, message: "Block not found" });

    const sector = await Sector.create({
      code,
      name,
      blockCode,
      districtCode: block.districtCode,
      blockId: block._id,
    });
    res.status(201).json({ success: true, sector });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// district -> all sectors | block -> sectors in its block | sector -> only its own sector
const getSectors = async (req, res) => {
  try {
    const filter = { districtCode: req.scopeFilter.districtCode };
    if (req.scopeFilter.blockCode) filter.blockCode = req.scopeFilter.blockCode;
    if (req.scopeFilter.sectorCode) filter.code = req.scopeFilter.sectorCode;

    const sectors = await Sector.find(filter);
    res.status(200).json({ success: true, count: sectors.length, sectors });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------- AWC ----------

const createAwc = async (req, res) => {
  try {
    const { code, name, sectorCode } = req.body;
    const sector = await Sector.findOne({ code: sectorCode });
    if (!sector) return res.status(404).json({ success: false, message: "Sector not found" });

    const awc = await Awc.create({
      code,
      name,
      sectorCode,
      blockCode: sector.blockCode,
      districtCode: sector.districtCode,
      sectorId: sector._id,
    });
    res.status(201).json({ success: true, awc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// district -> all awcs | block -> awcs in its block | sector -> awcs in its sector | awc -> only itself
const getAwcs = async (req, res) => {
  try {
    const filter = { districtCode: req.scopeFilter.districtCode };
    if (req.scopeFilter.blockCode) filter.blockCode = req.scopeFilter.blockCode;
    if (req.scopeFilter.sectorCode) filter.sectorCode = req.scopeFilter.sectorCode;
    if (req.scopeFilter.awcCode) filter.code = req.scopeFilter.awcCode;

    const awcs = await Awc.find(filter);
    res.status(200).json({ success: true, count: awcs.length, awcs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createDistrict,
  getDistricts,
  createBlock,
  getBlocks,
  createSector,
  getSectors,
  createAwc,
  getAwcs,
};
