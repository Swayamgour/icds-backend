const Record = require("../models/Record");
const Awc = require("../models/Awc");
const Block = require("../models/Block");
const Sector = require("../models/Sector");
const { ROLES } = require("../config/roles");
const { RECORD_PHOTO_FIELDS } = require("../middleware/recordPhotoUpload");
const { uploadBufferToCloudinary } = require("../utils/cloudinaryUpload");

// Uploads every photo that came in via recordPhotoUpload (in-memory buffers)
// to Cloudinary, and builds the 6 fixed-slot photo objects (url + publicId +
// lat + lng + capturedAt), falling back to the record-level GPS check-in for
// lat/lng when the client didn't send a per-photo location.
async function buildPhotoFields(req) {
  const files = req.files || {};
  const fallbackLat = req.body.checkInLatitude;
  const fallbackLng = req.body.checkInLongitude;

  const photoFields = {};

  await Promise.all(
    RECORD_PHOTO_FIELDS.map(async (fieldName) => {
      const file = files[fieldName]?.[0];
      if (!file) return;

      const result = await uploadBufferToCloudinary(file.buffer, {
        folder: `icds/records/${fieldName}`,
        publicId: `${Date.now()}-${Math.round(Math.random() * 1e9)}`,
      });

      const lat = req.body[`${fieldName}Lat`] ?? fallbackLat;
      const lng = req.body[`${fieldName}Lng`] ?? fallbackLng;
      const capturedAt = req.body[`${fieldName}CapturedAt`];

      photoFields[fieldName] = {
        url: result.secure_url,
        publicId: result.public_id,
        latitude: lat !== undefined ? Number(lat) : undefined,
        longitude: lng !== undefined ? Number(lng) : undefined,
        capturedAt: capturedAt ? new Date(capturedAt) : new Date(),
      };
    })
  );

  // Any extra photos sent under the generic "photos" field (not tied to one
  // of the 6 fixed slots) go into the shared photos[] array.
  const extraFiles = files.photos || [];
  const extraPhotos = await Promise.all(
    extraFiles.map(async (file) => {
      const result = await uploadBufferToCloudinary(file.buffer, {
        folder: "icds/records/extra",
        publicId: `${Date.now()}-${Math.round(Math.random() * 1e9)}`,
      });
      return {
        url: result.secure_url,
        publicId: result.public_id,
        latitude: fallbackLat !== undefined ? Number(fallbackLat) : undefined,
        longitude: fallbackLng !== undefined ? Number(fallbackLng) : undefined,
        capturedAt: new Date(),
      };
    })
  );

  return { photoFields, extraPhotos };
}

// The frontend (PhotoGpsCapture) uploads each photo straight to Cloudinary
// the moment it's taken, then submits the record with the resulting
// { url, latitude, longitude, capturedAt } object already sitting on each
// of the 6 named fields (morningDishPhoto, etc.) - as plain JSON, not a
// multipart file. That's a perfectly valid, already-uploaded photo and
// should be trusted, not discarded.
//
// The only thing we must NOT trust as-is is junk the frontend sometimes
// sends for a field with no photo yet, e.g. `morningDishPhoto: false`,
// which would blow up the Mongoose schema (it expects an object, not a
// boolean/string). So: keep it if it looks like a real photo object
// (has a string `url`), otherwise drop it.
//
// Returns { trustedPhotoFields } - safe to merge into the record alongside
// (and layered under) `photoFields` from buildPhotoFields, so an actual
// multipart file upload in the same request always wins over a JSON one.
function extractTrustedPhotoFields(body, fallbackLat, fallbackLng) {
  const trustedPhotoFields = {};

  RECORD_PHOTO_FIELDS.forEach((fieldName) => {
    const val = body[fieldName];

    const looksLikePhoto =
      val &&
      typeof val === "object" &&
      typeof val.url === "string" &&
      val.url.length > 0;

    if (!looksLikePhoto) return;

    const lat = val.latitude ?? fallbackLat;
    const lng = val.longitude ?? fallbackLng;

    trustedPhotoFields[fieldName] = {
      url: val.url,
      publicId: val.publicId, // present if it was uploaded via cloudinaryUpload client-side helper
      latitude: lat !== undefined && lat !== null && lat !== "" ? Number(lat) : undefined,
      longitude: lng !== undefined && lng !== null && lng !== "" ? Number(lng) : undefined,
      capturedAt: val.capturedAt ? new Date(val.capturedAt) : new Date(),
    };
  });

  return trustedPhotoFields;
}

// NEW: AWC daily entry can only be submitted between 9:30 AM and 1:30 PM
// (India Standard Time). This mirrors the client-side check in
// WorkerEntry.jsx, but must also be enforced here since the client check
// can be bypassed from the browser console.
const ENTRY_WINDOW_START_MIN = 9 * 60 + 30; // 9:30 AM
const ENTRY_WINDOW_END_MIN = 13 * 60 + 30; // 1:30 PM
const IST_OFFSET_MIN = 5 * 60 + 30;

function isWithinEntryWindow(d = new Date()) {
  const istMinutesOfDay = (Math.floor(d.getTime() / 60000) + IST_OFFSET_MIN) % (24 * 60);
  return istMinutesOfDay >= ENTRY_WINDOW_START_MIN && istMinutesOfDay <= ENTRY_WINDOW_END_MIN;
}




// ======================================================
// GET CHILDREN 3-6 YEARS COUNT FOR LOGGED-IN AWC
// ======================================================
const getAwcChildrenCount = async (req, res) => {
  try {
    // Only AWC user should access this
    if (req.user.role !== "awc") {
      return res.status(403).json({
        success: false,
        message: "Only AWC users can access this data",
      });
    }

    if (!req.user.awcCode) {
      return res.status(400).json({
        success: false,
        message: "AWC code not found for logged-in user",
      });
    }

    const awc = await Awc.findOne({
      code: req.user.awcCode,
    })
      .select(
        "code name districtCode blockCode sectorCode children3To6Y"
      )
      .lean();

    if (!awc) {
      return res.status(404).json({
        success: false,
        message: "AWC not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        awcCode: awc.code,
        awcName: awc.name,

        districtCode: awc.districtCode,
        blockCode: awc.blockCode,
        sectorCode: awc.sectorCode,

        children3To6Y: awc.children3To6Y || 0,
      },
    });
  } catch (err) {
    console.error("GET AWC CHILDREN COUNT ERROR:", err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

const createRecord = async (req, res) => {
  try {
    // =====================================================
    // 1. ONLY AWC USER CAN CREATE RECORD
    // =====================================================

    if (req.user.role !== ROLES.AWC) {
      return res.status(403).json({
        success: false,
        message: "Only AWC role can submit center records",
      });
    }

    // =====================================================
    // 2. CURRENT TIME - INDIA TIMEZONE
    // =====================================================

    const now = new Date();

    const indiaDateTime = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(now);

    const getPart = (type) =>
      indiaDateTime.find((item) => item.type === type)?.value;

    const year = Number(getPart("year"));
    const month = Number(getPart("month"));
    const day = Number(getPart("day"));
    const hour = Number(getPart("hour"));
    const minute = Number(getPart("minute"));
    const second = Number(getPart("second"));

    const currentMinutes =
      hour * 60 + minute + second / 60;

    // 09:30 AM = 570 minutes
    const startMinutes = 9 * 60 + 30;

    // 01:30 PM = 810 minutes
    const endMinutes = 13 * 60 + 30;

    // =====================================================
    // 3. ENTRY WINDOW
    // =====================================================

    // Enable this when you want to enforce 9:30 AM - 1:30 PM
    /*
    if (
      currentMinutes < startMinutes ||
      currentMinutes > endMinutes
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Daily entry can only be submitted between 9:30 AM and 1:30 PM.",
      });
    }
    */

    // =====================================================
    // 4. GET USER AWC SCOPE
    // =====================================================

    const {
      districtCode,
      blockCode,
      sectorCode,
      awcCode,
    } = req.user;

    if (!districtCode || !blockCode || !sectorCode || !awcCode) {
      return res.status(400).json({
        success: false,
        message:
          "User AWC scope is incomplete. District, block, sector and AWC are required.",
      });
    }

    // =====================================================
    // 5. GET MASTER DATA
    // =====================================================

    const [block, sector, awc] = await Promise.all([
      Block.findOne({
        code: blockCode,
        districtCode,
      }).lean(),

      Sector.findOne({
        code: sectorCode,
        blockCode,
        districtCode,
      }).lean(),

      Awc.findOne({
        code: awcCode,
        sectorCode,
        blockCode,
        districtCode,
      }).lean(),
    ]);

    if (!block) {
      return res.status(400).json({
        success: false,
        message: "Invalid block assigned to this AWC user.",
      });
    }

    if (!sector) {
      return res.status(400).json({
        success: false,
        message: "Invalid sector assigned to this AWC user.",
      });
    }

    if (!awc) {
      return res.status(400).json({
        success: false,
        message: "Invalid AWC assigned to this user.",
      });
    }

    // =====================================================
    // 6. CREATE INDIA DAY RANGE
    // =====================================================

    const dayStart = new Date(
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
        2,
        "0"
      )}T00:00:00+05:30`
    );

    const dayEnd = new Date(
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
        2,
        "0"
      )}T23:59:59.999+05:30`
    );

    // =====================================================
    // 7. CHECK TODAY'S EXISTING RECORD
    // =====================================================

    const existingRecord = await Record.findOne({
      awcCode,
      date: {
        $gte: dayStart,
        $lte: dayEnd,
      },
    }).lean();

    if (existingRecord) {
      return res.status(409).json({
        success: false,
        message:
          "Today's entry has already been submitted for this Anganwadi centre.",
        recordId: existingRecord._id,
      });
    }

    // =====================================================
    // 8. BUILD PHOTO FIELDS
    // =====================================================

    // Only actually uploaded photos will be returned here.
    // Example:
    //
    // {
    //   morningDishPhoto: {
    //     url: "...",
    //     publicId: "...",
    //     latitude: 26.123,
    //     longitude: 80.123,
    //     capturedAt: Date
    //   }
    // }
    //
    // If no photo was uploaded, that field will NOT exist.

    const { photoFields, extraPhotos } = await buildPhotoFields(req);

    // =====================================================
    // 9. CLEAN REQUEST BODY
    // =====================================================

    // Copy req.body so we don't modify req.body directly.
    const recordData = {
      ...req.body,
    };

    // =====================================================
    // VALIDATE CHILDREN COUNTS
    // =====================================================

    const registeredChildrenCount = Number(
      recordData.registeredChildrenCount ?? 0
    );

    const childrenAttendedCount = Number(
      recordData.childrenAttendedCount ?? 0
    );

    if (
      !Number.isFinite(registeredChildrenCount) ||
      registeredChildrenCount < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "registeredChildrenCount must be a valid non-negative number",
      });
    }

    if (
      !Number.isFinite(childrenAttendedCount) ||
      childrenAttendedCount < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "childrenAttendedCount must be a valid non-negative number",
      });
    }

    if (childrenAttendedCount > registeredChildrenCount) {
      return res.status(400).json({
        success: false,
        message:
          "Children attended count cannot be greater than registered children count",
      });
    }

    // Save normalized values
    recordData.registeredChildrenCount = registeredChildrenCount;
    recordData.childrenAttendedCount = childrenAttendedCount;

    // -----------------------------------------------------
    // IMPORTANT:
    // Pull out any already-uploaded photo objects the frontend sent as
    // JSON (PhotoGpsCapture uploads to Cloudinary client-side and sends
    // back { url, latitude, longitude, capturedAt } on each of the 6
    // named fields) BEFORE we strip those fields off recordData.
    //
    // We still strip the raw fields off recordData afterwards, because
    // the frontend may instead send junk like:
    //
    // morningDishPhoto: false
    //
    // and MongoDB schema expects an OBJECT, not a boolean. Anything that
    // doesn't look like a real photo object is simply dropped here.
    //
    // Actual multipart file uploads (from buildPhotoFields/req.files) are
    // added back below and take priority over these trusted JSON ones if
    // both were somehow sent in the same request.
    // -----------------------------------------------------

    const trustedPhotoFields = extractTrustedPhotoFields(
      req.body,
      req.body.checkInLatitude,
      req.body.checkInLongitude
    );

    RECORD_PHOTO_FIELDS.forEach((fieldName) => {
      delete recordData[fieldName];
    });

    // -----------------------------------------------------
    // Also don't allow frontend to directly control these.
    // -----------------------------------------------------

    delete recordData.districtCode;
    delete recordData.blockCode;
    delete recordData.sectorCode;
    delete recordData.awcCode;

    delete recordData.blockName;
    delete recordData.sectorName;
    delete recordData.awcName;

    delete recordData.createdBy;
    delete recordData.status;
    delete recordData.date;

    // =====================================================
    // 10. EXTRA PHOTOS
    // =====================================================

    const existingPhotos = Array.isArray(req.body.photos)
      ? req.body.photos
      : [];

    const mergedPhotos = [
      ...existingPhotos,
      ...extraPhotos,
    ];

    // =====================================================
    // 11. CREATE RECORD
    // =====================================================

    const record = await Record.create({
      ...recordData,

      // -----------------------------------------------
      // ACTUAL uploaded fixed-slot photos
      // -----------------------------------------------
      //
      // Only fields that actually contain a photo
      // will be added here. Trusted JSON-uploaded photos go in first,
      // then any multipart file uploads in the same request override
      // them field-by-field.
      //
      // No photo = field does not exist.
      //
      ...trustedPhotoFields,
      ...photoFields,

      // -----------------------------------------------
      // Extra generic photos
      // -----------------------------------------------

      photos: mergedPhotos,

      // -----------------------------------------------
      // FORCE USER SCOPE
      // -----------------------------------------------

      districtCode,
      blockCode,
      sectorCode,
      awcCode,

      blockName: block.name,
      sectorName: sector.name,
      awcName: awc.name,

      // -----------------------------------------------
      // NORMALIZED DATE
      // -----------------------------------------------

      date: dayStart,

      // -----------------------------------------------
      // ACTUAL SUBMISSION TIME
      // -----------------------------------------------

      checkInTime:
        req.body.checkInTime || now,

      // -----------------------------------------------
      // STATUS
      // -----------------------------------------------

      status: "pending",

      // -----------------------------------------------
      // CREATOR
      // -----------------------------------------------

      createdBy: req.user._id,
    });

    // =====================================================
    // 12. CHECK MISSING PHOTOS
    // =====================================================

    const missingPhotos = RECORD_PHOTO_FIELDS.filter(
      (fieldName) => !record[fieldName]
    );

    // =====================================================
    // 13. RESPONSE
    // =====================================================

    return res.status(201).json({
      success: true,

      message:
        missingPhotos.length > 0
          ? "Record created. You can add the remaining photos anytime via PATCH /api/records/:id/photos."
          : "Today's record submitted successfully.",

      missingPhotos,

      record,
    });
  } catch (err) {
    // =====================================================
    // DUPLICATE KEY
    // =====================================================

    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "Today's entry has already been submitted for this Anganwadi centre.",
      });
    }

    // =====================================================
    // VALIDATION ERROR
    // =====================================================

    console.error("Create Record Error:", err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// @desc   Add or replace one or more of the 6 photo slots on today's record,
//         one at a time or a few together - as many separate calls as you
//         like (e.g. morning photo now, afternoon photo a few hours later).
//         Only the record's own creator (AWC user) can update it, and only
//         while it's still "pending" (not yet reviewed by a supervisor).
// @route  PATCH /api/records/:id/photos  (multipart/form-data, same field
//         names as POST /api/records: morningDishPhoto, afternoonDishPhoto,
//         etc. - send only the ones you're uploading right now)
// @access Private (AWC role, own record only)
const updateRecordPhotos = async (req, res) => {
  try {
    // =====================================================
    // 1. ONLY AWC USER
    // =====================================================

    if (req.user.role !== ROLES.AWC) {
      return res.status(403).json({
        success: false,
        message: "Only AWC role can update center record photos",
      });
    }

    // =====================================================
    // 2. FIND RECORD
    // =====================================================

    const record = await Record.findById(req.params.id);

    if (!record) {
      return res.status(404).json({
        success: false,
        message: "Record not found",
      });
    }

    // =====================================================
    // 3. ONLY RECORD CREATOR CAN UPDATE
    // =====================================================

    if (String(record.createdBy) !== String(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "You can only update photos on your own record",
      });
    }

    // =====================================================
    // 4. ONLY PENDING RECORD
    // =====================================================

    if (record.status !== "pending") {
      return res.status(409).json({
        success: false,
        message: `This record has already been ${record.status} and can no longer be edited.`,
      });
    }

    // =====================================================
    // 5. CHECK FILE
    // =====================================================

    const hasAnyFile =
      req.files &&
      (
        RECORD_PHOTO_FIELDS.some(
          (fieldName) => req.files[fieldName]?.[0]
        ) ||
        (req.files.photos && req.files.photos.length > 0)
      );

    if (!hasAnyFile) {
      return res.status(400).json({
        success: false,
        message:
          "No photo file received. Send at least one of: " +
          RECORD_PHOTO_FIELDS.join(", "),
      });
    }

    // =====================================================
    // 6. BUILD ACTUAL PHOTO OBJECTS
    // =====================================================

    const { photoFields, extraPhotos } =
      await buildPhotoFields(req);

    // =====================================================
    // 7. REMOVE INVALID OLD PHOTO VALUES
    // =====================================================
    //
    // If old record contains:
    //
    // morningDishPhoto: false
    //
    // Mongoose will fail on record.save().
    //
    // So remove false/null/empty-string values.
    //

    RECORD_PHOTO_FIELDS.forEach((fieldName) => {
      const currentValue = record[fieldName];

      if (
        currentValue === false ||
        currentValue === null ||
        currentValue === ""
      ) {
        record.set(fieldName, undefined);
      }
    });

    // =====================================================
    // 8. ADD NEW UPLOADED PHOTO OBJECTS
    // =====================================================

    Object.keys(photoFields).forEach((fieldName) => {
      record.set(fieldName, photoFields[fieldName]);
    });

    // =====================================================
    // 9. ADD EXTRA PHOTOS
    // =====================================================

    if (extraPhotos.length > 0) {
      record.photos = [
        ...(record.photos || []),
        ...extraPhotos,
      ];
    }

    // =====================================================
    // 10. SAVE
    // =====================================================

    await record.save();

    // =====================================================
    // 11. CHECK MISSING PHOTOS
    // =====================================================

    const missingPhotos = RECORD_PHOTO_FIELDS.filter(
      (fieldName) => !record[fieldName]
    );

    // =====================================================
    // 12. RESPONSE
    // =====================================================

    return res.status(200).json({
      success: true,

      message:
        missingPhotos.length > 0
          ? "Photo(s) saved. Still missing: " +
          missingPhotos.join(", ")
          : "Photo(s) saved. All 6 required photos are now uploaded.",

      updatedFields: Object.keys(photoFields),

      missingPhotos,

      record,
    });
  } catch (err) {
    console.error(
      "Update Record Photos Error:",
      err
    );

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};



// Fields the AWC user is allowed to touch after creation. Scope fields
// (districtCode/blockCode/sectorCode/awcCode/*Name), date, status,
// createdBy, reviewedBy/reviewedAt/reviewRemarks are intentionally left
// out - those are either server-owned or supervisor-owned.
const UPDATABLE_RECORD_FIELDS = [
  // General
  "registeredChildrenCount",
  "childrenAttendedCount",
  "centerOpen",
  "activityStatus",

  // Morning
  "morningMealChildrenCount",
  "morningMenu",
  "milkPouchGiven",
  "milkPouchCount",

  // Afternoon
  "afternoonMealGiven",
  "afternoonMealChildrenCount",
  "afternoonMenu",

  // Pre Education
  "preEducationConducted",
  "preEducationChildrenCount",

  // Poshan Sudha
  "poshanDishGiven",
  "poshanMenu",
  "poshanBenefitGiven",
  "poshanSudhaCount",

  // Other
  "qualityOfMeal",
  "remarks",

  // Extra photos
  "photos",

  // GPS
  "checkInLatitude",
  "checkInLongitude",
];


const updateRecord = async (req, res) => {
  try {
    // =====================================================
    // 1. ONLY AWC USER
    // =====================================================

    if (req.user.role !== ROLES.AWC) {
      return res.status(403).json({
        success: false,
        message: "Only AWC role can update center records",
      });
    }

    // =====================================================
    // 2. FIND RECORD
    // =====================================================

    const record = await Record.findById(req.params.id);

    if (!record) {
      return res.status(404).json({
        success: false,
        message: "Record not found",
      });
    }

    // =====================================================
    // 3. ONLY RECORD CREATOR
    // =====================================================

    if (String(record.createdBy) !== String(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "You can only update your own record",
      });
    }

    // =====================================================
    // 4. ONLY PENDING RECORD
    // =====================================================

    if (record.status !== "pending") {
      return res.status(409).json({
        success: false,
        message: `This record has already been ${record.status} and can no longer be edited.`,
      });
    }

    // =====================================================
    // 5. BUILD UPDATES
    // =====================================================

    const updates = {};

    UPDATABLE_RECORD_FIELDS.forEach((key) => {
      if (
        Object.prototype.hasOwnProperty.call(req.body, key)
      ) {
        updates[key] = req.body[key];
      }
    });

    // =====================================================
    // 6. TRUSTED JSON PHOTO OBJECTS
    // =====================================================
    //
    // PhotoGpsCapture uploads to Cloudinary client-side and sends back
    // { url, latitude, longitude, capturedAt } on each of the 6 named
    // photo fields - a real, already-hosted photo, not a raw file. Editing
    // a record (e.g. adding a photo that was missing at first submission)
    // goes through this JSON endpoint, so those trusted objects must be
    // kept here, not silently dropped.
    //
    // Actual multipart file uploads still go through:
    //
    // PATCH /api/records/:id/photos
    //
    // and that path is untouched - callers can use either.
    //
    // Anything that isn't a real photo object (e.g. frontend sending
    // `morningDishPhoto: false`) is still ignored.
    //

    const trustedPhotoFields = extractTrustedPhotoFields(
      req.body,
      req.body.checkInLatitude,
      req.body.checkInLongitude
    );

    Object.assign(updates, trustedPhotoFields);

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No updatable fields were sent.",
      });
    }

    // =====================================================
    // VALIDATE CHILDREN COUNTS
    // =====================================================

    // Existing value or new value
    const registeredChildrenCount =
      updates.registeredChildrenCount !== undefined
        ? Number(updates.registeredChildrenCount)
        : Number(record.registeredChildrenCount ?? 0);

    const childrenAttendedCount =
      updates.childrenAttendedCount !== undefined
        ? Number(updates.childrenAttendedCount)
        : Number(record.childrenAttendedCount ?? 0);

    // Validate registered count
    if (
      !Number.isFinite(registeredChildrenCount) ||
      registeredChildrenCount < 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "registeredChildrenCount must be a valid non-negative number",
      });
    }

    // Validate attended count
    if (
      !Number.isFinite(childrenAttendedCount) ||
      childrenAttendedCount < 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "childrenAttendedCount must be a valid non-negative number",
      });
    }

    // Attended cannot exceed registered
    if (childrenAttendedCount > registeredChildrenCount) {
      return res.status(400).json({
        success: false,
        message:
          "Children attended count cannot be greater than registered children count",
      });
    }

    // Normalize values before saving
    if (updates.registeredChildrenCount !== undefined) {
      updates.registeredChildrenCount = registeredChildrenCount;
    }

    if (updates.childrenAttendedCount !== undefined) {
      updates.childrenAttendedCount = childrenAttendedCount;
    }

    // =====================================================
    // UPDATE RECORD
    // =====================================================

    Object.assign(record, updates);

    await record.save();

    // =====================================================
    // 9. CHECK MISSING PHOTOS
    // =====================================================

    const missingPhotos = RECORD_PHOTO_FIELDS.filter(
      (fieldName) => !record[fieldName]
    );

    // =====================================================
    // 10. RESPONSE
    // =====================================================

    return res.status(200).json({
      success: true,
      message: "Record updated successfully.",
      updatedFields: Object.keys(updates),
      missingPhotos,
      record,
    });
  } catch (err) {
    console.error("Update Record Error:", err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// 

const getRecords = async (req, res) => {
  try {
    const filter = { ...req.scopeFilter };

    // ==============================
    // STATUS FILTER
    // ==============================
    if (req.query.status) {
      filter.status = req.query.status;
    }

    // ==============================
    // CREATED AT DATE FILTER
    // ==============================
    if (req.query.fromDate || req.query.toDate) {
      filter.createdAt = {};

      // ==============================
      // FROM DATE
      // ==============================
      if (req.query.fromDate) {
        const fromDate = new Date(
          `${req.query.fromDate}T00:00:00.000`
        );

        filter.createdAt.$gte = fromDate;
      }

      // ==============================
      // TO DATE
      // ==============================
      if (req.query.toDate) {
        const toDate = new Date(
          `${req.query.toDate}T23:59:59.999`
        );

        filter.createdAt.$lte = toDate;
      }
    }

    console.log("QUERY:", req.query);
    console.log(
      "FINAL FILTER:",
      JSON.stringify(filter, null, 2)
    );

    const records = await Record.find(filter)
      .populate("createdBy", "name")
      .populate("reviewedBy", "name")
      .sort({ createdAt: -1 })
      .lean();

    const formattedRecords = records.map((record) => {
      const photos = [
        {
          key: "morningDishPhoto",
          label: "Morning Breakfast",
          photo: record.morningDishPhoto,
        },
        {
          key: "childrenEatingBreakfastPhoto",
          label: "Children Eating Breakfast",
          photo: record.childrenEatingBreakfastPhoto,
        },
        {
          key: "afternoonDishPhoto",
          label: "Afternoon Meal",
          photo: record.afternoonDishPhoto,
        },
        {
          key: "childrenEatingAfternoonPhoto",
          label: "Children Eating Afternoon Meal",
          photo: record.childrenEatingAfternoonPhoto,
        },
        {
          key: "preEducationPhoto",
          label: "Pre-Education",
          photo: record.preEducationPhoto,
        },
        {
          key: "photoBeneficiariesNutrition",
          label: "Nutrition Beneficiaries",
          photo: record.photoBeneficiariesNutrition,
        },
      ]
        .filter((item) => item.photo?.url)
        .map((item) => ({
          key: item.key,
          label: item.label,
          url: item.photo.url,
          latitude: item.photo.latitude,
          longitude: item.photo.longitude,
          capturedAt: item.photo.capturedAt,
        }));

      return {
        ...record,
        photos,
      };
    });

    res.status(200).json({
      success: true,
      count: formattedRecords.length,
      records: formattedRecords,
    });
  } catch (err) {
    console.error("GET RECORDS ERROR:", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
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

    // if (status === "approved") {
    //   const missingPhotos = RECORD_PHOTO_FIELDS.filter((f) => !record[f]);
    //   if (missingPhotos.length > 0) {
    //     return res.status(400).json({
    //       success: false,
    //       message: `Cannot approve - missing photo(s): ${missingPhotos.join(", ")}`,
    //       missingPhotos,
    //     });
    //   }
    // }

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

// module.exports = { createRecord, updateRecordPhotos, getRecords, reviewRecord };
module.exports = { createRecord, updateRecord, updateRecordPhotos, getRecords, reviewRecord, getAwcChildrenCount };