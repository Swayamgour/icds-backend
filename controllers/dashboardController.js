// controllers/dashboardController.js

const District = require("../models/District");
const Block = require("../models/Block");
const Sector = require("../models/Sector");
const Awc = require("../models/Awc");
const Record = require("../models/Record");

// NOTE: "awc" added as a 4th displayable level.
// district -> block -> sector -> awc
const LEVELS = ["district", "block", "sector", "awc"];

const HIERARCHY_FIELDS = [
  "districtCode",
  "blockCode",
  "sectorCode",
];

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------

const hasValue = (value) =>
  value !== undefined &&
  value !== null &&
  value !== "";

// Only hierarchy fields are used for Master collections.
// This prevents role-specific fields from accidentally
// breaking District / Block / Sector queries.
const pickHierarchyScope = (scope) => {
  const result = {};

  HIERARCHY_FIELDS.forEach((field) => {
    if (hasValue(scope[field])) {
      result[field] = scope[field];
    }
  });

  return result;
};

// ---------------------------------------------------------
// DATE RANGE
// ---------------------------------------------------------

// ---------------------------------------------------------
// DATE RANGE
// ---------------------------------------------------------

const buildDateMatch = (fromDate, toDate) => {
  const dateMatch = {};

  // Validate YYYY-MM-DD format
  const isValidDate = (date) => {
    return /^\d{4}-\d{2}-\d{2}$/.test(date);
  };

  // ==============================
  // FROM DATE
  // ==============================
  if (hasValue(fromDate)) {
    if (!isValidDate(fromDate)) {
      throw new Error(`Invalid fromDate: ${fromDate}`);
    }

    dateMatch.$gte = new Date(
      `${fromDate}T00:00:00.000`
    );
  }

  // ==============================
  // TO DATE
  // ==============================
  if (hasValue(toDate)) {
    if (!isValidDate(toDate)) {
      throw new Error(`Invalid toDate: ${toDate}`);
    }

    dateMatch.$lte = new Date(
      `${toDate}T23:59:59.999`
    );
  }

  return dateMatch;
};

// ---------------------------------------------------------
// Empty response
// ---------------------------------------------------------

const sendEmptyResponse = (res, level) => {
  return res.status(200).json({
    success: true,
    level,
    count: 0,
    rows: [],
  });
};

// ---------------------------------------------------------
// MAIN CONTROLLER
// ---------------------------------------------------------

const getDashboard = async (req, res) => {
  try {
    // =====================================================
    // 1. DISPLAY LEVEL
    // =====================================================

    const level = LEVELS.includes(req.query.level)
      ? req.query.level
      : "sector";

    const groupField = `$${level}Code`;

    // =====================================================
    // 2. ROLE BASED SCOPE
    // =====================================================

    // IMPORTANT:
    // req.scopeFilter must NEVER be overridden by query params.
    //
    // Example:
    // User is allowed only in block 2444510
    //
    // Query:
    // ?blockCode=9999999
    //
    // This must NOT give access to 9999999.

    const roleScope = {
      ...req.scopeFilter,
    };

    const scope = {
      ...roleScope,
    };

    // -----------------------------------------------------
    // Query narrowing
    // -----------------------------------------------------

    const requestedHierarchy = {};

    for (const field of HIERARCHY_FIELDS) {
      if (hasValue(req.query[field])) {
        requestedHierarchy[field] = req.query[field];
      }
    }

    // -----------------------------------------------------
    // Prevent query from overriding role scope
    // -----------------------------------------------------

    for (const field of HIERARCHY_FIELDS) {
      if (
        hasValue(roleScope[field]) &&
        hasValue(requestedHierarchy[field]) &&
        roleScope[field] !== requestedHierarchy[field]
      ) {
        return sendEmptyResponse(res, level);
      }

      if (hasValue(requestedHierarchy[field])) {
        scope[field] = requestedHierarchy[field];
      }
    }

    // =====================================================
    // 3. RESOLVE HIERARCHY
    // =====================================================
    //
    // If only sectorCode is provided:
    //
    // sector
    //   ↓
    // blockCode
    //   ↓
    // districtCode
    //
    // If only blockCode is provided:
    //
    // block
    //   ↓
    // districtCode
    //
    // If awcCode is provided:
    //
    // AWC
    //   ↓
    // sector
    //   ↓
    // block
    //   ↓
    // district
    //
    // This makes all filters consistent.
    // =====================================================

    let selectedAwcCode = null;

    // If role scope itself contains awcCode,
    // keep it as a restricted AWC.
    if (hasValue(roleScope.awcCode)) {
      selectedAwcCode = roleScope.awcCode;
    }

    // Query awcCode can narrow role scope.
    if (hasValue(req.query.awcCode)) {
      if (
        selectedAwcCode &&
        selectedAwcCode !== req.query.awcCode
      ) {
        return sendEmptyResponse(res, level);
      }

      selectedAwcCode = req.query.awcCode;
    }

    // =====================================================
    // 3A. RESOLVE AWC
    // =====================================================

    if (selectedAwcCode) {
      const awcMatch = {
        code: selectedAwcCode,
      };

      // Only use hierarchy constraints here.
      if (hasValue(scope.districtCode)) {
        awcMatch.districtCode = scope.districtCode;
      }

      if (hasValue(scope.blockCode)) {
        awcMatch.blockCode = scope.blockCode;
      }

      if (hasValue(scope.sectorCode)) {
        awcMatch.sectorCode = scope.sectorCode;
      }

      const awc = await Awc.findOne(awcMatch)
        .select(
          "code name districtCode blockCode sectorCode"
        )
        .lean();

      // AWC does not exist inside allowed scope.
      if (!awc) {
        return sendEmptyResponse(res, level);
      }

      // Resolve complete hierarchy from AWC.
      scope.districtCode = awc.districtCode;
      scope.blockCode = awc.blockCode;
      scope.sectorCode = awc.sectorCode;
    }

    // =====================================================
    // 3B. RESOLVE SECTOR
    // =====================================================

    if (!selectedAwcCode && hasValue(scope.sectorCode)) {
      const sectorMatch = {
        code: scope.sectorCode,
      };

      if (hasValue(roleScope.districtCode)) {
        sectorMatch.districtCode =
          roleScope.districtCode;
      }

      if (hasValue(roleScope.blockCode)) {
        sectorMatch.blockCode =
          roleScope.blockCode;
      }

      const sector = await Sector.findOne(sectorMatch)
        .select(
          "code name blockCode districtCode"
        )
        .lean();

      if (!sector) {
        return sendEmptyResponse(res, level);
      }

      scope.districtCode = sector.districtCode;
      scope.blockCode = sector.blockCode;
      scope.sectorCode = sector.code;
    }

    // =====================================================
    // 3C. RESOLVE BLOCK
    // =====================================================

    if (
      !selectedAwcCode &&
      !hasValue(requestedHierarchy.sectorCode) &&
      hasValue(scope.blockCode)
    ) {
      const blockMatch = {
        code: scope.blockCode,
      };

      if (hasValue(roleScope.districtCode)) {
        blockMatch.districtCode =
          roleScope.districtCode;
      }

      const block = await Block.findOne(blockMatch)
        .select(
          "code name districtCode"
        )
        .lean();

      if (!block) {
        return sendEmptyResponse(res, level);
      }

      scope.districtCode = block.districtCode;
      scope.blockCode = block.code;
    }

    // =====================================================
    // 4. FINAL RECORD FILTER
    // =====================================================

    const recordMatch = {
      ...scope,
    };

    // Record collection uses awcCode.
    if (selectedAwcCode) {
      recordMatch.awcCode = selectedAwcCode;
    }

    // =====================================================
    // DATE FILTER
    // =====================================================

    const createdAtMatch = buildDateMatch(
      req.query.fromDate,
      req.query.toDate
    );

    if (Object.keys(createdAtMatch).length > 0) {
      recordMatch.createdAt = createdAtMatch;
    }

    // =====================================================
    // 5. HIERARCHY MASTER FILTER
    // =====================================================

    const hierarchyScope =
      pickHierarchyScope(scope);

    // =====================================================
    // 6. MASTER ROWS
    // =====================================================

    let masterRows = [];

    // -----------------------------------------------------
    // DISTRICT
    // -----------------------------------------------------

    if (level === "district") {
      const districtFilter = {};

      if (hasValue(scope.districtCode)) {
        districtFilter.code =
          scope.districtCode;
      }

      masterRows = await District.find(
        districtFilter
      )
        .select("code name")
        .lean();
    }

    // -----------------------------------------------------
    // BLOCK
    // -----------------------------------------------------

    if (level === "block") {
      const blockFilter = {};

      if (hasValue(scope.districtCode)) {
        blockFilter.districtCode =
          scope.districtCode;
      }

      if (hasValue(scope.blockCode)) {
        blockFilter.code =
          scope.blockCode;
      }

      masterRows = await Block.find(
        blockFilter
      )
        .select(
          "code name districtCode"
        )
        .lean();
    }

    // -----------------------------------------------------
    // SECTOR
    // -----------------------------------------------------

    if (level === "sector") {
      const sectorFilter = {};

      if (hasValue(scope.districtCode)) {
        sectorFilter.districtCode =
          scope.districtCode;
      }

      if (hasValue(scope.blockCode)) {
        sectorFilter.blockCode =
          scope.blockCode;
      }

      if (hasValue(scope.sectorCode)) {
        sectorFilter.code =
          scope.sectorCode;
      }

      masterRows = await Sector.find(
        sectorFilter
      )
        .select(
          "code name blockCode districtCode"
        )
        .lean();
    }

    // -----------------------------------------------------
    // AWC  (NEW — leaf level)
    // -----------------------------------------------------

    if (level === "awc") {
      const awcMasterFilter = {};

      if (hasValue(scope.districtCode)) {
        awcMasterFilter.districtCode =
          scope.districtCode;
      }

      if (hasValue(scope.blockCode)) {
        awcMasterFilter.blockCode =
          scope.blockCode;
      }

      if (hasValue(scope.sectorCode)) {
        awcMasterFilter.sectorCode =
          scope.sectorCode;
      }

      // Awc model uses `code`, not `awcCode`.
      if (selectedAwcCode) {
        awcMasterFilter.code =
          selectedAwcCode;
      }

      masterRows = await Awc.find(
        awcMasterFilter
      )
        .select(
          "code name districtCode blockCode sectorCode"
        )
        .lean();
    }

    // =====================================================
    // 7. STRUCTURAL TOTALS
    // =====================================================

    const totalBlockMap = {};
    const totalSectorMap = {};
    const totalAwcMap = {};

    // -----------------------------------------------------
    // DISTRICT LEVEL
    // -----------------------------------------------------

    if (level === "district") {
      // -------------------------------
      // Total Blocks
      // -------------------------------

      const blockFilter = {};

      if (hasValue(scope.districtCode)) {
        blockFilter.districtCode =
          scope.districtCode;
      }

      if (hasValue(scope.blockCode)) {
        blockFilter.code =
          scope.blockCode;
      }

      if (hasValue(scope.sectorCode)) {
        blockFilter.code = {
          $in: await Sector.distinct(
            "blockCode",
            {
              districtCode:
                scope.districtCode,
              code: scope.sectorCode,
            }
          ),
        };
      }

      if (selectedAwcCode) {
        blockFilter.code =
          scope.blockCode;
      }

      const blockAgg =
        await Block.aggregate([
          {
            $match: blockFilter,
          },
          {
            $group: {
              _id: "$districtCode",
              count: {
                $sum: 1,
              },
            },
          },
        ]);

      blockAgg.forEach((item) => {
        totalBlockMap[item._id] =
          item.count;
      });

      // -------------------------------
      // Total Sectors
      // -------------------------------

      const sectorFilter = {
        ...hierarchyScope,
      };

      const sectorAgg =
        await Sector.aggregate([
          {
            $match: sectorFilter,
          },
          {
            $group: {
              _id: "$districtCode",
              count: {
                $sum: 1,
              },
            },
          },
        ]);

      sectorAgg.forEach((item) => {
        totalSectorMap[item._id] =
          item.count;
      });
    }

    // -----------------------------------------------------
    // BLOCK LEVEL
    // -----------------------------------------------------

    if (level === "block") {
      const sectorFilter = {};

      if (hasValue(scope.districtCode)) {
        sectorFilter.districtCode =
          scope.districtCode;
      }

      if (hasValue(scope.blockCode)) {
        sectorFilter.blockCode =
          scope.blockCode;
      }

      if (hasValue(scope.sectorCode)) {
        sectorFilter.code =
          scope.sectorCode;
      }

      const sectorAgg =
        await Sector.aggregate([
          {
            $match: sectorFilter,
          },
          {
            $group: {
              _id: "$blockCode",
              count: {
                $sum: 1,
              },
            },
          },
        ]);

      sectorAgg.forEach((item) => {
        totalSectorMap[item._id] =
          item.count;
      });
    }

    // -----------------------------------------------------
    // TOTAL AWCs
    // -----------------------------------------------------
    // NOTE: this grouping is generic — for level === "awc" it will
    // simply count 1 per AWC (since groupField becomes $awcCode).
    // The frontend does not render this column at the "awc" level,
    // so it is harmless to compute it the same way for every level.

    const awcFilter = {};

    if (hasValue(scope.districtCode)) {
      awcFilter.districtCode =
        scope.districtCode;
    }

    if (hasValue(scope.blockCode)) {
      awcFilter.blockCode =
        scope.blockCode;
    }

    if (hasValue(scope.sectorCode)) {
      awcFilter.sectorCode =
        scope.sectorCode;
    }

    // IMPORTANT:
    // Awc model uses `code`, not `awcCode`.
    if (selectedAwcCode) {
      awcFilter.code =
        selectedAwcCode;
    }

    const awcAgg =
      await Awc.aggregate([
        {
          $match: awcFilter,
        },
        {
          $group: {
            _id: groupField,
            count: {
              $sum: 1,
            },
          },
        },
      ]);

    awcAgg.forEach((item) => {
      totalAwcMap[item._id] =
        item.count;
    });

    // =====================================================
    // 8. RECORD AGGREGATION
    // =====================================================

    const recordAgg = await Record.aggregate([
      // =====================================================
      // 1. APPLY HIERARCHY / DATE FILTER
      // =====================================================
      {
        $match: recordMatch,
      },

      // =====================================================
      // 2. LATEST RECORD FIRST
      // =====================================================
      {
        $sort: {
          awcCode: 1,
          date: -1,
          updatedAt: -1,
          createdAt: -1,
        },
      },

      // =====================================================
      // 3. TAKE ONLY ONE (LATEST) RECORD PER AWC
      // =====================================================
      {
        $group: {
          _id: "$awcCode",
          record: {
            $first: "$$ROOT",
          },
        },
      },

      // =====================================================
      // 4. RESTORE RECORD DATA
      // =====================================================
      {
        $replaceRoot: {
          newRoot: "$record",
        },
      },

      // =====================================================
      // 5. NOW GROUP BY DISTRICT / BLOCK / SECTOR / AWC
      // =====================================================
      {
        $group: {
          _id: groupField,

          // =================================================
          // AWC STATUS
          // =================================================

          awcOpenYes: {
            $sum: {
              $cond: [
                { $eq: ["$centerOpen", true] },
                1,
                0,
              ],
            },
          },

          awcOpenNo: {
            $sum: {
              $cond: [
                { $eq: ["$centerOpen", false] },
                1,
                0,
              ],
            },
          },

          // =================================================
          // MORNING
          // =================================================

          morningMealChildrenCount: {
            $sum: {
              $ifNull: [
                "$morningMealChildrenCount",
                0,
              ],
            },
          },

          morningDishPhotoYes: {
            $sum: {
              $cond: [
                {
                  $ne: [
                    { $ifNull: ["$morningDishPhoto", null] },
                    null,
                  ],
                },
                1,
                0,
              ],
            },
          },

          morningDishPhotoNo: {
            $sum: {
              $cond: [
                {
                  $eq: [
                    { $ifNull: ["$morningDishPhoto", null] },
                    null,
                  ],
                },
                1,
                0,
              ],
            },
          },

          childrenEatingPhotoYes: {
            $sum: {
              $cond: [
                {
                  $ne: [
                    {
                      $ifNull: [
                        "$childrenEatingBreakfastPhoto",
                        null,
                      ],
                    },
                    null,
                  ],
                },
                1,
                0,
              ],
            },
          },

          childrenEatingPhotoNo: {
            $sum: {
              $cond: [
                {
                  $eq: [
                    {
                      $ifNull: [
                        "$childrenEatingBreakfastPhoto",
                        null,
                      ],
                    },
                    null,
                  ],
                },
                1,
                0,
              ],
            },
          },

          // =================================================
          // MILK SANJIVANI
          // =================================================

          milkPouchCount: {
            $sum: {
              $ifNull: ["$milkPouchCount", 0],
            },
          },

          milkPouchPhotoYes: {
            $sum: {
              $cond: [
                { $eq: ["$milkPouchGiven", true] },
                1,
                0,
              ],
            },
          },

          milkPouchPhotoNo: {
            $sum: {
              $cond: [
                { $eq: ["$milkPouchGiven", false] },
                1,
                0,
              ],
            },
          },

          // =================================================
          // AFTERNOON
          // =================================================

          afternoonMealChildrenCount: {
            $sum: {
              $ifNull: [
                "$afternoonMealChildrenCount",
                0,
              ],
            },
          },

          afternoonDishPhotoYes: {
            $sum: {
              $cond: [
                {
                  $ne: [
                    { $ifNull: ["$afternoonDishPhoto", null] },
                    null,
                  ],
                },
                1,
                0,
              ],
            },
          },

          afternoonDishPhotoNo: {
            $sum: {
              $cond: [
                {
                  $eq: [
                    { $ifNull: ["$afternoonDishPhoto", null] },
                    null,
                  ],
                },
                1,
                0,
              ],
            },
          },

          childrenEatingAfternoonPhotoYes: {
            $sum: {
              $cond: [
                {
                  $ne: [
                    {
                      $ifNull: [
                        "$childrenEatingAfternoonPhoto",
                        null,
                      ],
                    },
                    null,
                  ],
                },
                1,
                0,
              ],
            },
          },

          childrenEatingAfternoonPhotoNo: {
            $sum: {
              $cond: [
                {
                  $eq: [
                    {
                      $ifNull: [
                        "$childrenEatingAfternoonPhoto",
                        null,
                      ],
                    },
                    null,
                  ],
                },
                1,
                0,
              ],
            },
          },

          // =================================================
          // POSHAN SUDHA
          // =================================================

          poshanSudhaCount: {
            $sum: {
              $ifNull: ["$poshanSudhaCount", 0],
            },
          },

          poshanBenefitPhotoYes: {
            $sum: {
              $cond: [
                { $eq: ["$poshanBenefitGiven", true] },
                1,
                0,
              ],
            },
          },

          poshanBenefitPhotoNo: {
            $sum: {
              $cond: [
                { $eq: ["$poshanBenefitGiven", false] },
                1,
                0,
              ],
            },
          },

          // =================================================
          // PRE-PRIMARY EDUCATION
          // =================================================

          preEducationChildrenCount: {
            $sum: {
              $ifNull: [
                "$preEducationChildrenCount",
                0,
              ],
            },
          },

          preEducationPhotoYes: {
            $sum: {
              $cond: [
                { $eq: ["$preEducationConducted", true] },
                1,
                0,
              ],
            },
          },

          preEducationPhotoNo: {
            $sum: {
              $cond: [
                { $eq: ["$preEducationConducted", false] },
                1,
                0,
              ],
            },
          },

          // =================================================
          // MEAL QUALITY
          // =================================================

          mealQualityGood: {
            $sum: {
              $cond: [
                { $eq: ["$qualityOfMeal", "good"] },
                1,
                0,
              ],
            },
          },

          mealQualityAverage: {
            $sum: {
              $cond: [
                { $eq: ["$qualityOfMeal", "average"] },
                1,
                0,
              ],
            },
          },

          mealQualityBad: {
            $sum: {
              $cond: [
                { $eq: ["$qualityOfMeal", "bad"] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    // =====================================================
    // 9. RECORD MAP
    // =====================================================

    const recordMap = Object.fromEntries(
      recordAgg.map((item) => [
        item._id,
        item,
      ])
    );

    // =====================================================
    // 10. MERGE MASTER + RECORD + TOTALS
    // =====================================================

    const rows = masterRows.map((master) => {
      const record =
        recordMap[master.code] || {};

      const totalAwc = totalAwcMap[master.code] || 0;

      const awcOpenYes = record.awcOpenYes || 0;

      const awcOpenNo = Math.max(
        0,
        totalAwc - awcOpenYes
      );

      const row = {
        code: master.code,
        name: master.name,

        // ---------------------------------------------
        // AWC
        // ---------------------------------------------

        totalAwc,
        awcOpenYes,
        awcOpenNo,


        // ---------------------------------------------
        // MORNING
        // ---------------------------------------------

        morningMealChildrenCount:
          record.morningMealChildrenCount || 0,

        morningDishPhotoYes:
          record.morningDishPhotoYes || 0,

        morningDishPhotoNo:
          record.morningDishPhotoNo || 0,

        childrenEatingPhotoYes:
          record.childrenEatingPhotoYes || 0,

        childrenEatingPhotoNo:
          record.childrenEatingPhotoNo || 0,

        // ---------------------------------------------
        // MILK
        // ---------------------------------------------

        milkPouchCount:
          record.milkPouchCount || 0,

        milkPouchPhotoYes:
          record.milkPouchPhotoYes || 0,

        milkPouchPhotoNo:
          record.milkPouchPhotoNo || 0,

        // ---------------------------------------------
        // AFTERNOON
        // ---------------------------------------------

        afternoonMealChildrenCount:
          record.afternoonMealChildrenCount || 0,

        afternoonDishPhotoYes:
          record.afternoonDishPhotoYes || 0,

        afternoonDishPhotoNo:
          record.afternoonDishPhotoNo || 0,

        childrenEatingAfternoonPhotoYes:
          record.childrenEatingAfternoonPhotoYes || 0,

        childrenEatingAfternoonPhotoNo:
          record.childrenEatingAfternoonPhotoNo || 0,

        // ---------------------------------------------
        // POSHAN SUDHA
        // ---------------------------------------------

        poshanSudhaCount:
          record.poshanSudhaCount || 0,

        poshanBenefitPhotoYes:
          record.poshanBenefitPhotoYes || 0,

        poshanBenefitPhotoNo:
          record.poshanBenefitPhotoNo || 0,

        // ---------------------------------------------
        // PRE-PRIMARY
        // ---------------------------------------------

        preEducationChildrenCount:
          record.preEducationChildrenCount || 0,

        preEducationPhotoYes:
          record.preEducationPhotoYes || 0,

        preEducationPhotoNo:
          record.preEducationPhotoNo || 0,

        // ---------------------------------------------
        // MEAL QUALITY
        // ---------------------------------------------

        mealQualityGood:
          record.mealQualityGood || 0,

        mealQualityAverage:
          record.mealQualityAverage || 0,

        mealQualityBad:
          record.mealQualityBad || 0,
      };

      // -----------------------------------------------
      // DISTRICT TOTALS
      // -----------------------------------------------

      if (level === "district") {
        row.totalBlock =
          totalBlockMap[master.code] || 0;

        row.totalSector =
          totalSectorMap[master.code] || 0;
      }

      // -----------------------------------------------
      // BLOCK TOTALS
      // -----------------------------------------------

      if (level === "block") {
        row.totalSector =
          totalSectorMap[master.code] || 0;
      }

      return row;
    });

    // =====================================================
    // 11. SORT
    // =====================================================

    rows.sort((a, b) =>
      String(a.name || "").localeCompare(
        String(b.name || "")
      )
    );

    // =====================================================
    // 12. RESPONSE
    // =====================================================

    return res.status(200).json({
      success: true,

      level,

      filters: {
        districtCode:
          scope.districtCode || null,

        blockCode:
          scope.blockCode || null,

        sectorCode:
          scope.sectorCode || null,

        awcCode:
          selectedAwcCode || null,

        fromDate:
          req.query.fromDate || null,

        toDate:
          req.query.toDate || null,
      },

      count: rows.length,

      rows,
    });
  } catch (err) {
    console.error(
      "Dashboard Error:",
      err
    );

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

module.exports = {
  getDashboard,
};