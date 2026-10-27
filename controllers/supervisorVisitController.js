const SupervisorVisit = require("../models/SupervisorVisit");
const Block = require("../models/Block");
const Sector = require("../models/Sector");
const Awc = require("../models/Awc");
const { ROLES } = require("../config/roles");

// URL slug -> document field
const SECTION_MAP = { general: "general", a: "sectionA", b: "sectionB", c: "sectionC" };
const SECTION_KEYS = Object.values(SECTION_MAP);

// Fields marked * (required) in the app. Checked only when a section is
// submitted as completed (markComplete !== false).
const REQUIRED = {
  general: [],
  sectionA: [
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
  ],
  sectionB: [],
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
    "observation.anganwadiClean",
    "observation.surroundingsClean",
    "observation.hotBreakfastQuality",
    "observation.workerKnowledge",
    "observation.anganwadiRanking",
    "leavingTime",
  ],
};

const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
const isMissing = (v) => v === undefined || v === null || v === "";

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

    if (markComplete !== false) {
      const missing = REQUIRED[key].filter((p) => isMissing(getPath(data, p)));
      if (missing.length > 0) {
        return res.status(400).json({ success: false, message: "Required fields missing", missing });
      }
    }

    visit.set(key, data);
    if (key === "general" && data.visitDate) visit.date = new Date(data.visitDate); // Q1
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
    // AWC role is not allowed to access supervisor visits
    if (req.user.role === ROLES.AWC) {
      return res.status(403).json({
        success: false,
        message: "AWC role does not have access to supervisor visits",
      });
    }

    // -----------------------------------------
    // Build scope + query filters
    // -----------------------------------------
    const filter = { ...req.scopeFilter };

    if (req.query.awcCode) {
      filter.awcCode = req.query.awcCode;
    }

    if (req.query.status) {
      filter.status = req.query.status;
    }

    if (req.query.formStatus) {
      filter.formStatus = req.query.formStatus;
    }

    if (req.query.fromDate || req.query.toDate) {
      filter.date = {};

      if (req.query.fromDate) {
        filter.date.$gte = new Date(req.query.fromDate);
      }

      if (req.query.toDate) {
        filter.date.$lte = new Date(req.query.toDate);
      }
    }

    // -----------------------------------------
    // Non-supervisor users only see submitted
    // visits unless formStatus is explicitly given
    // -----------------------------------------
    if (
      req.user.role !== ROLES.SUPERVISOR &&
      !req.query.formStatus
    ) {
      filter.formStatus = "submitted";
    }

    // -----------------------------------------
    // Full mode
    //
    // GET /api/supervisor-visits?full=true
    //
    // Returns complete visit including all sections
    // and all images.
    // -----------------------------------------
    if (req.query.full === "true") {
      const visits = await SupervisorVisit
        .find(filter)
        .sort({ date: -1 })
        .lean();

      return res.status(200).json({
        success: true,
        count: visits.length,
        visits,
      });
    }

    // -----------------------------------------
    // Normal list mode
    //
    // Don't return complete section data because
    // sections can be large.
    //
    // But explicitly return photo information.
    // -----------------------------------------
    const visits = await SupervisorVisit
      .find(filter)
      .select([
        "districtCode",
        "blockCode",
        "sectorCode",
        "awcCode",

        "districtName",
        "blockName",
        "sectorName",
        "awcName",
        "supervisorName",

        "date",
        "status",
        "formStatus",

        "sectionStatus",

        "submittedAt",
        "checkInTime",
        "checkInLatitude",
        "checkInLongitude",

        "checkOutTime",
        "checkOutLatitude",
        "checkOutLongitude",

        "reviewedBy",
        "reviewedAt",
        "reviewRemarks",

        "createdBy",
        "createdAt",
        "updatedAt",

        // -------------------------------------
        // Photos
        // -------------------------------------

        "general.arrivalPhoto",

        "sectionC.heightWeightCheck.childName",
        "sectionC.heightWeightCheck.heightCm",
        "sectionC.heightWeightCheck.weightKg",
        "sectionC.heightWeightCheck.photo",

        "sectionC.mealPlatePhoto",

        "sectionC.leavingPhoto",
      ])
      .sort({ date: -1 })
      .lean();

    // -----------------------------------------
    // Normalize photos into a simple array
    // -----------------------------------------
    const formattedVisits = visits.map((visit) => {
      const photos = [];

      // General - Arrival Photo
      if (visit.general?.arrivalPhoto?.url) {
        photos.push({
          type: "arrival",
          section: "general",
          label: "Arrival Photo",
          ...visit.general.arrivalPhoto,
        });
      }

      // Section C - Height / Weight Photo
      if (visit.sectionC?.heightWeightCheck?.photo?.url) {
        photos.push({
          type: "heightWeight",
          section: "sectionC",
          label: "Height & Weight Photo",

          childName:
            visit.sectionC.heightWeightCheck.childName || null,

          heightCm:
            visit.sectionC.heightWeightCheck.heightCm ?? null,

          weightKg:
            visit.sectionC.heightWeightCheck.weightKg ?? null,

          ...visit.sectionC.heightWeightCheck.photo,
        });
      }

      // Section C - Meal Plate Photo
      if (visit.sectionC?.mealPlatePhoto?.url) {
        photos.push({
          type: "mealPlate",
          section: "sectionC",
          label: "Meal Plate Photo",
          ...visit.sectionC.mealPlatePhoto,
        });
      }

      // Section C - Leaving Photo
      if (visit.sectionC?.leavingPhoto?.url) {
        photos.push({
          type: "leaving",
          section: "sectionC",
          label: "Leaving Photo",
          ...visit.sectionC.leavingPhoto,
        });
      }

      return {
        ...visit,

        // Don't expose the big section objects
        // in normal list response.
        general: undefined,
        sectionA: undefined,
        sectionB: undefined,
        sectionC: undefined,

        // All photos in one simple array
        photos,
      };
    });

    return res.status(200).json({
      success: true,
      count: formattedVisits.length,
      visits: formattedVisits,
    });
  } catch (err) {
    console.error("getVisits error:", err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
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
