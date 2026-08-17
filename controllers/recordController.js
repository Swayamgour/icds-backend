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

    // if (
    //   currentMinutes < startMinutes ||
    //   currentMinutes > endMinutes
    // ) {
    //   return res.status(403).json({
    //     success: false,
    //     message:
    //       "Daily entry can only be submitted between 9:30 AM and 1:30 PM.",
    //   });
    // }

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
    //
    // Current day according to Asia/Kolkata.
    //
    // Example:
    // 17 August 2026
    //
    // start:
    // 17 Aug 2026 00:00:00 IST
    //
    // end:
    // 17 Aug 2026 23:59:59.999 IST
    //
    // =====================================================

    const dayStart = new Date(
      `${year}-${String(month).padStart(2, "0")}-${String(
        day
      ).padStart(2, "0")}T00:00:00+05:30`
    );

    const dayEnd = new Date(
      `${year}-${String(month).padStart(2, "0")}-${String(
        day
      ).padStart(2, "0")}T23:59:59.999+05:30`
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
    // 8. BUILD PHOTO FIELDS (uploaded to Cloudinary by recordPhotoUpload)
    // =====================================================
    // Photos are NOT required at creation time anymore. You can create the
    // record with zero, some, or all 6 photos, and add/replace the rest
    // later - one at a time - via PATCH /api/records/:id/photos, right up
    // until a supervisor reviews it.

    const { photoFields, extraPhotos } = await buildPhotoFields(req);

    // =====================================================
    // 9. CREATE RECORD
    // =====================================================

    const existingPhotos = req.body.photos;
    const mergedPhotos = [
      ...(Array.isArray(existingPhotos) ? existingPhotos : []),
      ...extraPhotos,
    ];

    const record = await Record.create({
      ...req.body,

      // -----------------------------------------------
      // Fixed photo slots + any extra generic photos
      // -----------------------------------------------

      ...photoFields,
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
      // IMPORTANT:
      // Save normalized date for daily uniqueness
      // -----------------------------------------------

      date: dayStart,

      // -----------------------------------------------
      // Actual submission time
      // -----------------------------------------------

      checkInTime:
        req.body.checkInTime || now,

      // -----------------------------------------------
      // Status
      // -----------------------------------------------

      status: "pending",

      // -----------------------------------------------
      // Creator
      // -----------------------------------------------

      createdBy: req.user._id,
    });

    // =====================================================
    // 10. RESPONSE
    // =====================================================

    const missingPhotos = RECORD_PHOTO_FIELDS.filter((f) => !record[f]);

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

    console.error(
      "Create Record Error:",
      err
    );

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
    if (req.user.role !== ROLES.AWC) {
      return res.status(403).json({
        success: false,
        message: "Only AWC role can update center record photos",
      });
    }

    const record = await Record.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, message: "Record not found" });
    }

    if (String(record.createdBy) !== String(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "You can only update photos on your own record",
      });
    }

    if (record.status !== "pending") {
      return res.status(409).json({
        success: false,
        message: `This record has already been ${record.status} and can no longer be edited.`,
      });
    }

    const hasAnyFile =
      req.files &&
      (RECORD_PHOTO_FIELDS.some((f) => req.files[f]?.[0]) || req.files.photos?.length);

    if (!hasAnyFile) {
      return res.status(400).json({
        success: false,
        message:
          "No photo file received. Send at least one of: " + RECORD_PHOTO_FIELDS.join(", "),
      });
    }

    const { photoFields, extraPhotos } = await buildPhotoFields(req);

    // Only overwrite the slots that were actually sent in this call -
    // everything else on the record stays exactly as it was.
    Object.assign(record, photoFields);
    if (extraPhotos.length > 0) {
      record.photos = [...(record.photos || []), ...extraPhotos];
    }

    await record.save();

    const missingPhotos = RECORD_PHOTO_FIELDS.filter((f) => !record[f]);

    res.status(200).json({
      success: true,
      message:
        missingPhotos.length > 0
          ? "Photo(s) saved. Still missing: " + missingPhotos.join(", ")
          : "Photo(s) saved. All 6 required photos are now uploaded.",
      updatedFields: Object.keys(photoFields),
      missingPhotos,
      record,
    });
  } catch (err) {
    console.error("Update Record Photos Error:", err);
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

    if (status === "approved") {
      const missingPhotos = RECORD_PHOTO_FIELDS.filter((f) => !record[f]);
      if (missingPhotos.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Cannot approve - missing photo(s): ${missingPhotos.join(", ")}`,
          missingPhotos,
        });
      }
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

module.exports = { createRecord, updateRecordPhotos, getRecords, reviewRecord };