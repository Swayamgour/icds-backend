// controllers/dashboardController.js

const District = require("../models/District");
const Block = require("../models/Block");
const Sector = require("../models/Sector");
const Awc = require("../models/Awc");
const Record = require("../models/Record");

const LEVELS = ["district", "block", "sector"];

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

const buildDateMatch = (fromDate, toDate) => {
  const dateMatch = {};

  if (hasValue(fromDate)) {
    const from = new Date(fromDate);

    if (Number.isNaN(from.getTime())) {
      throw new Error(`Invalid fromDate: ${fromDate}`);
    }

    from.setHours(0, 0, 0, 0);

    dateMatch.$gte = from;
  }

  if (hasValue(toDate)) {
    const to = new Date(toDate);

    if (Number.isNaN(to.getTime())) {
      throw new Error(`Invalid toDate: ${toDate}`);
    }

    to.setHours(23, 59, 59, 999);

    dateMatch.$lte = to;
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

    const dateMatch = buildDateMatch(
      req.query.fromDate,
      req.query.toDate
    );

    if (Object.keys(dateMatch).length > 0) {
      recordMatch.date = dateMatch;
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

    const recordAgg =
      await Record.aggregate([
        {
          $match: recordMatch,
        },

        {
          $group: {
            _id: groupField,

            // =================================================
            // AWC STATUS
            // =================================================

            awcOpenYes: {
              $sum: {
                $cond: [
                  "$centerOpen",
                  1,
                  0,
                ],
              },
            },

            awcOpenNo: {
              $sum: {
                $cond: [
                  "$centerOpen",
                  0,
                  1,
                ],
              },
            },

            // =================================================
            // MORNING
            // =================================================

            morningMealChildrenCount: {
              $sum:
                "$morningMealChildrenCount",
            },

            morningDishPhotoYes: {
              $sum: {
                $cond: [
                  "$morningDishPhoto",
                  1,
                  0,
                ],
              },
            },

            morningDishPhotoNo: {
              $sum: {
                $cond: [
                  "$morningDishPhoto",
                  0,
                  1,
                ],
              },
            },

            childrenEatingPhotoYes: {
              $sum: {
                $cond: [
                  "$childrenEatingBreakfastPhoto",
                  1,
                  0,
                ],
              },
            },

            childrenEatingPhotoNo: {
              $sum: {
                $cond: [
                  "$childrenEatingBreakfastPhoto",
                  0,
                  1,
                ],
              },
            },

            // =================================================
            // MILK SANJIVANI
            // =================================================

            milkPouchCount: {
              $sum: "$milkPouchCount",
            },

            milkPouchPhotoYes: {
              $sum: {
                $cond: [
                  "$milkPouchGiven",
                  1,
                  0,
                ],
              },
            },

            milkPouchPhotoNo: {
              $sum: {
                $cond: [
                  "$milkPouchGiven",
                  0,
                  1,
                ],
              },
            },

            // =================================================
            // AFTERNOON
            // =================================================

            afternoonMealChildrenCount: {
              $sum:
                "$afternoonMealChildrenCount",
            },

            afternoonDishPhotoYes: {
              $sum: {
                $cond: [
                  "$afternoonDishPhoto",
                  1,
                  0,
                ],
              },
            },

            afternoonDishPhotoNo: {
              $sum: {
                $cond: [
                  "$afternoonDishPhoto",
                  0,
                  1,
                ],
              },
            },

            childrenEatingAfternoonPhotoYes: {
              $sum: {
                $cond: [
                  "$childrenEatingAfternoonPhoto",
                  1,
                  0,
                ],
              },
            },

            childrenEatingAfternoonPhotoNo: {
              $sum: {
                $cond: [
                  "$childrenEatingAfternoonPhoto",
                  0,
                  1,
                ],
              },
            },

            // =================================================
            // POSHAN SUDHA
            // =================================================

            poshanSudhaCount: {
              $sum: "$poshanSudhaCount",
            },

            poshanBenefitPhotoYes: {
              $sum: {
                $cond: [
                  "$photoBeneficiariesNutrition",
                  1,
                  0,
                ],
              },
            },

            poshanBenefitPhotoNo: {
              $sum: {
                $cond: [
                  "$photoBeneficiariesNutrition",
                  0,
                  1,
                ],
              },
            },

            // =================================================
            // PRE-PRIMARY EDUCATION
            // =================================================

            preEducationChildrenCount: {
              $sum:
                "$preEducationChildrenCount",
            },

            preEducationPhotoYes: {
              $sum: {
                $cond: [
                  "$preEducationPhoto",
                  1,
                  0,
                ],
              },
            },

            preEducationPhotoNo: {
              $sum: {
                $cond: [
                  "$preEducationPhoto",
                  0,
                  1,
                ],
              },
            },

            // =================================================
            // MEAL QUALITY
            // =================================================

            mealQualityGood: {
              $sum: {
                $cond: [
                  {
                    $eq: [
                      "$qualityOfMeal",
                      "good",
                    ],
                  },
                  1,
                  0,
                ],
              },
            },

            mealQualityAverage: {
              $sum: {
                $cond: [
                  {
                    $eq: [
                      "$qualityOfMeal",
                      "average",
                    ],
                  },
                  1,
                  0,
                ],
              },
            },

            mealQualityBad: {
              $sum: {
                $cond: [
                  {
                    $eq: [
                      "$qualityOfMeal",
                      "bad",
                    ],
                  },
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

      const row = {
        code: master.code,
        name: master.name,

        // ---------------------------------------------
        // AWC
        // ---------------------------------------------

        totalAwc:
          totalAwcMap[master.code] || 0,

        // ---------------------------------------------
        // AWC OPEN
        // ---------------------------------------------

        awcOpenYes:
          record.awcOpenYes || 0,

        awcOpenNo:
          record.awcOpenNo || 0,

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