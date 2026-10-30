const SupervisorVisit = require("../models/SupervisorVisit");
const Block = require("../models/Block");
const Sector = require("../models/Sector");
const Awc = require("../models/Awc");
const { ROLES } = require("../config/roles");

// URL slug -> document field
const SECTION_MAP = { general: "general", a: "sectionA", b: "sectionB", c: "sectionC" };
const SECTION_KEYS = Object.values(SECTION_MAP);
const STOCK_FIELDS = ["totalBeneficiaries", "balanceStock", "demand", "found"];

// EVERY field of the form is required (except Remarks) - same list as the web
// form (supervisorVisitConfig.js). Checked only when a section is submitted as
// completed (markComplete !== false).
const REQUIRED = {
  general: ["visitDate", "centerOpen", "arrivalTime"],
  sectionA: [
    "building.ownership",
    "building.isDilapidated",
    "building.repairNeeded",
    "building.upgradationNeeded",
    "building.toiletWorking",
    "building.drinkingWater",
    "building.electricity",
    "building.compoundWall",
    "supplementaryNutrition.registeredChildren3To6",
    "supplementaryNutrition.presentChildren",
    "supplementaryNutrition.hotBreakfastAsPerMenu",
    "supplementaryNutrition.purnaRegisteredGirls15To18",
    "supplementaryNutrition.purnaGirlsTookThr",
    "supplementaryNutrition.thrDistributionComplete",
    // THR stock: 3 blocks x 4 numbers
    ...["balshakti", "matrushakti", "purnashakti"].flatMap((b) =>
      STOCK_FIELDS.map((f) => `supplementaryNutrition.thrStock.${b}.${f}`)
    ),
    // HCM stock: 3 items x 4 numbers (stored as an array of { item, ... })
    ...["fortifiedFlour", "rice", "oil"].flatMap((b) =>
      STOCK_FIELDS.map((f) => `supplementaryNutrition.hcmStock.${b}.${f}`)
    ),
  ],
  sectionB: [
    "poshanSudha.registeredBeneficiaries",
    "poshanSudha.presentBeneficiaries",
    "poshanSudha.psyMealAsPerMenu",
    "poshanSudha.localPurchaseBillsPaidTill.month",
    "poshanSudha.localPurchaseBillsPaidTill.year",
    "poshanSudha.dailyAttendanceFilled",
    "milkReceivedToday",
    "milkPacketsDemanded",
    "milkPacketsReceived",
    "registeredBeneficiaries.pregnantLactating",
    "registeredBeneficiaries.children7mTo3y",
    "registeredBeneficiaries.children3To6y",
    "beneficiariesServedInPresence.pregnantLactating",
    "beneficiariesServedInPresence.children7mTo3y",
    "beneficiariesServedInPresence.children3To6y",
  ],
  sectionC: [
    "preSchool.kitUsed",
    "preSchool.activitiesAsPerThemeTimetable",
    "preSchool.childDetailsAndPlayActivities",
    "preSchool.vikasyatraFilledMonth",
    "mangalDivas.suposhanSamvad",
    "mangalDivas.baltulaDivas",
    "mangalDivas.annaprashanBalDivas",
    "mangalDivas.annaVitaranDivas",
    "growthEquipment.infantometer",
    "growthEquipment.salterScale",
    "growthEquipment.stadiometer",
    "growthEquipment.weighingScale",
    "adolescentWeightHeightDone",
    "heightWeightCheck.childName",
    "heightWeightCheck.heightCm",
    "heightWeightCheck.weightKg",
    "heightWeightCheck.photo",
    "observation.anganwadiClean",
    "observation.surroundingsClean",
    "observation.hotBreakfastQuality",
    "observation.workerKnowledge",
    "observation.anganwadiRanking",
    "mealPlatePhoto",
    "leavingPhoto",
    "leavingTime",
  ],
};

// Follow-up questions: required (and kept) only while their Yes/No answer is true.
const CONDITIONAL = {
  sectionA: [
    { path: "building.repairType", when: "building.repairNeeded" },
    { path: "building.upgradationReason", when: "building.upgradationNeeded" },
  ],
};

// photo fields are "filled" only when they carry an uploaded url
const PHOTO_PATHS = new Set(["heightWeightCheck.photo", "mealPlatePhoto", "leavingPhoto"]);

const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
const isMissing = (v) => v === undefined || v === null || v === "" || (typeof v === "string" && v.trim() === "");

// value of a required path - knows about the HCM stock array and photo objects
const getValue = (data, path) => {
  const m = path.match(/^(.*\.hcmStock)\.(\w+)\.(\w+)$/);
  if (m) {
    const arr = getPath(data, m[1]);
    const row = Array.isArray(arr) ? arr.find((r) => r && r.item === m[2]) : null;
    return row ? row[m[3]] : undefined;
  }
  const v = getPath(data, path);
  return PHOTO_PATHS.has(path) ? v?.url : v;
};

// required paths for a section given what was actually sent
const requiredFor = (key, data) => [
  ...REQUIRED[key],
  ...(CONDITIONAL[key] || []).filter((c) => getPath(data, c.when) === true).map((c) => c.path),
];

// India time (IST) - the arrival time is taken from the server, never typed by the user
const nowTimeIST = () =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date()
  );

const dayRange = (d) => {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

// Only the supervisor who created the visit can edit it
const loadOwnVisit = async (req, res) => {
  const visit = await SupervisorVisit.findOne({ _id: req.params.id, ...req.scopeFilter });
  if (!visit) {
    res.status(404).json({ success: false, message: "Visit not found in your scope" });
    return null;
  }
  if (String(visit.createdBy) !== String(req.user._id)) {
    res.status(403).json({ success: false, message: "Only the supervisor who started this visit can edit it" });
    return null;
  }
  return visit;
};

// @desc   Pre-fill data for the form (AWC name + registered children) - call
//         right after the supervisor picks an Anganwadi.
// @route  GET /api/supervisor-visits/prefill/:awcCode
// @access Private (supervisor)
const getPrefill = async (req, res) => {
  try {
    if (req.user.role !== ROLES.SUPERVISOR) {
      return res.status(403).json({ success: false, message: "Only Supervisor role can use this" });
    }
    const awc = await Awc.findOne({ code: req.params.awcCode, sectorCode: req.user.sectorCode }).lean();
    if (!awc) return res.status(404).json({ success: false, message: "AWC not found in your sector" });

    res.status(200).json({
      success: true,
      prefill: {
        awcCode: awc.code,
        awcName: awc.name,
        sectorCode: awc.sectorCode,
        blockCode: awc.blockCode,
        registeredChildren3To6: awc.children3To6Y || 0,
        latitude: awc.latitude,
        longitude: awc.longitude,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc   Start an inspection of any AWC in the supervisor's own sector.
//         If this supervisor already has an unfinished (draft) visit for the
//         same AWC on the same day, that one is returned instead of a new one.
// @route  POST /api/supervisor-visits
// @access Private (supervisor only)
const startVisit = async (req, res) => {
  try {
    if (req.user.role !== ROLES.SUPERVISOR) {
      return res.status(403).json({ success: false, message: "Only Supervisor role can start a visit" });
    }

    const { awcCode, checkInLatitude, checkInLongitude } = req.body;
    if (!awcCode) return res.status(400).json({ success: false, message: "awcCode is required" });

    const { districtCode, blockCode, sectorCode } = req.user;

    const awc = await Awc.findOne({ code: awcCode, sectorCode });
    if (!awc) return res.status(404).json({ success: false, message: "AWC not found in your sector" });

    const date = req.body.date ? new Date(req.body.date) : new Date();
    const { start, end } = dayRange(date);

    const existing = await SupervisorVisit.findOne({
      createdBy: req.user._id,
      awcCode,
      formStatus: "draft",
      date: { $gte: start, $lt: end },
    });
    if (existing) return res.status(200).json({ success: true, resumed: true, visit: existing });

    const [block, sector] = await Promise.all([Block.findOne({ code: blockCode }), Sector.findOne({ code: sectorCode })]);

    const visit = await SupervisorVisit.create({
      districtCode,
      blockCode,
      sectorCode,
      awcCode,
      blockName: block?.name,
      sectorName: sector?.name,
      awcName: awc.name,
      supervisorName: req.user.name,
      date,
      checkInTime: new Date(),
      checkInLatitude,
      checkInLongitude,
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, resumed: false, visit });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc   Save one section of the form. Body = that section's fields (see
//         models/SupervisorVisit.js). Photos must be uploaded first through
//         POST /api/upload and sent as { url, publicId, latitude, longitude }.
//         Send "markComplete": false to save progress without marking the
//         section Completed (no required-field check then).
// @route  PUT /api/supervisor-visits/:id/sections/:section   (general | a | b | c)
// @access Private (supervisor who started the visit)
const saveSection = async (req, res) => {
  try {
    const key = SECTION_MAP[String(req.params.section).toLowerCase()];
    if (!key) {
      return res.status(400).json({ success: false, message: "section must be one of: general, a, b, c" });
    }

    const visit = await loadOwnVisit(req, res);
    if (!visit) return;

    const locked = visit.formStatus === "submitted" && visit.status !== "rejected";
    if (locked) {
      return res.status(400).json({ success: false, message: "This visit is already submitted and can no longer be edited" });
    }

    const { markComplete = true, ...data } = req.body || {};
    if (typeof data !== "object" || Array.isArray(data)) {
      return res.status(400).json({ success: false, message: "Section body must be a JSON object" });
    }

    // Sections open step by step: General -> A -> B -> C
    const idx = SECTION_KEYS.indexOf(key);
    if (idx > 0 && !visit.sectionStatus[SECTION_KEYS[idx - 1]]?.completed) {
      return res.status(400).json({
        success: false,
        message: `Complete the previous section first (${SECTION_KEYS[idx - 1]})`,
      });
    }

    // General section: date + arrival time are auto - the client cannot change them
    if (key === "general") {
      data.visitDate = visit.date;
      data.arrivalTime = visit.general?.arrivalTime || nowTimeIST();
    }

    // Follow-up boxes only count while their answer is "Yes" - wipe stale text
    (CONDITIONAL[key] || []).forEach((c) => {
      if (getPath(data, c.when) !== true) {
        const keys = c.path.split(".");
        const parent = keys.slice(0, -1).reduce((o, k) => (o == null ? undefined : o[k]), data);
        if (parent && typeof parent === "object") delete parent[keys[keys.length - 1]];
      }
    });

    if (markComplete !== false) {
      const missing = requiredFor(key, data).filter((p) => isMissing(getValue(data, p)));
      if (missing.length > 0) {
        return res.status(400).json({ success: false, message: "Required fields missing", missing });
      }
    }

    visit.set(key, data);
    if (markComplete !== false) {
      visit.sectionStatus[key] = { completed: true, submittedAt: new Date() };
    }

    // A rejected visit that is being corrected goes back to the review queue
    if (visit.status === "rejected") {
      visit.status = "pending";
      visit.formStatus = "draft";
      visit.reviewRemarks = undefined;
    }

    const allDone = SECTION_KEYS.every((k) => visit.sectionStatus[k]?.completed);
    if (allDone && visit.formStatus !== "submitted") {
      visit.formStatus = "submitted";
      visit.submittedAt = new Date();
      visit.checkOutTime = new Date();
      const lp = visit.sectionC?.leavingPhoto;
      if (lp?.latitude != null) visit.checkOutLatitude = lp.latitude;
      if (lp?.longitude != null) visit.checkOutLongitude = lp.longitude;
    }

    await visit.save();
    res.status(200).json({ success: true, visit });
  } catch (err) {
    const code = err.name === "ValidationError" ? 400 : 500;
    res.status(code).json({ success: false, message: err.message });
  }
};

// @desc   List visits - auto-scoped. Filters: ?awcCode=&status=&formStatus=&fromDate=&toDate=
//         Supervisor sees all visits in own sector, block/district see theirs.
//         Returns a light summary (no big section bodies) unless ?full=true.
// @route  GET /api/supervisor-visits
// @access Private (district, block, supervisor, sector)
const getVisits = async (req, res) => {
  try {
    if (req.user.role === ROLES.AWC) {
      return res.status(403).json({ success: false, message: "AWC role does not have access to supervisor visits" });
    }

    const filter = { ...req.scopeFilter };
    if (req.query.awcCode) filter.awcCode = req.query.awcCode;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.formStatus) filter.formStatus = req.query.formStatus;
    if (req.query.fromDate || req.query.toDate) {
      filter.date = {};
      if (req.query.fromDate) filter.date.$gte = new Date(req.query.fromDate);
      if (req.query.toDate) filter.date.$lte = new Date(req.query.toDate);
    }

    // block/district/sector only ever see finished visits; supervisor also sees own drafts
    if (req.user.role !== ROLES.SUPERVISOR && !req.query.formStatus) filter.formStatus = "submitted";

    let q = SupervisorVisit.find(filter).sort({ date: -1 });
    if (req.query.full !== "true") q = q.select("-general -sectionA -sectionB -sectionC");

    const visits = await q;
    res.status(200).json({ success: true, count: visits.length, visits });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @route  GET /api/supervisor-visits/:id
// @access Private (any non-AWC role, in scope)
const getVisitById = async (req, res) => {
  try {
    if (req.user.role === ROLES.AWC) {
      return res.status(403).json({ success: false, message: "AWC role does not have access to supervisor visits" });
    }
    const visit = await SupervisorVisit.findOne({ _id: req.params.id, ...req.scopeFilter });
    if (!visit) return res.status(404).json({ success: false, message: "Visit not found in your scope" });
    res.status(200).json({ success: true, visit });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc   Approve / reject a submitted visit
// @route  PATCH /api/supervisor-visits/:id/review
// @access Private (block, district) - a supervisor cannot review their own visits
const reviewVisit = async (req, res) => {
  try {
    if (![ROLES.DISTRICT, ROLES.BLOCK].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Only block/district can review supervisor visits" });
    }

    const { status, remarks } = req.body;
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ success: false, message: "status must be 'approved' or 'rejected'" });
    }

    const visit = await SupervisorVisit.findOne({ _id: req.params.id, ...req.scopeFilter });
    if (!visit) return res.status(404).json({ success: false, message: "Visit not found in your scope" });
    if (visit.formStatus !== "submitted") {
      return res.status(400).json({ success: false, message: "Only fully submitted visits can be reviewed" });
    }

    visit.status = status;
    visit.reviewedBy = req.user._id;
    visit.reviewedAt = new Date();
    visit.reviewRemarks = remarks;
    await visit.save();

    res.status(200).json({ success: true, visit });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc   Delete an unfinished draft visit
// @route  DELETE /api/supervisor-visits/:id
// @access Private (supervisor who started it)
const deleteDraft = async (req, res) => {
  try {
    const visit = await loadOwnVisit(req, res);
    if (!visit) return;
    if (visit.formStatus !== "draft") {
      return res.status(400).json({ success: false, message: "Only draft visits can be deleted" });
    }
    await visit.deleteOne();
    res.status(200).json({ success: true, message: "Draft deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getPrefill, startVisit, saveSection, getVisits, getVisitById, reviewVisit, deleteDraft };