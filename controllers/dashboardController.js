const Awc = require("../models/Awc");
const Sector = require("../models/Sector");
const Record = require("../models/Record");


const getDashboard = async (req, res) => {
  try {
    const filter = { ...req.scopeFilter };

    const dateMatch = {};
    if (req.query.fromDate) dateMatch.$gte = new Date(req.query.fromDate);
    if (req.query.toDate) dateMatch.$lte = new Date(req.query.toDate);
    const recordMatch = { ...filter };
    if (Object.keys(dateMatch).length) recordMatch.date = dateMatch;

    // Total AWC centers per sector (independent of date range)
    const totalAwcAgg = await Awc.aggregate([
      { $match: filter },
      { $group: { _id: "$sectorCode", totalAwc: { $sum: 1 } } },
    ]);
    const totalAwcMap = Object.fromEntries(totalAwcAgg.map((r) => [r._id, r.totalAwc]));

    // Rolled-up counts from worker records within the date range
    const recordAgg = await Record.aggregate([
      { $match: recordMatch },
      {
        $group: {
          _id: "$sectorCode",
          sectorName: { $first: "$sectorName" },
          awcOpenYes: { $sum: { $cond: ["$centerOpen", 1, 0] } },
          awcOpenNo: { $sum: { $cond: ["$centerOpen", 0, 1] } },

          // Morning
          morningMealChildrenCount: { $sum: "$morningMealChildrenCount" },
          morningDishPhotoYes: { $sum: { $cond: ["$morningDishPhoto", 1, 0] } },
          morningDishPhotoNo: { $sum: { $cond: ["$morningDishPhoto", 0, 1] } },
          childrenEatingPhotoYes: { $sum: { $cond: ["$childrenEatingBreakfastPhoto", 1, 0] } },
          childrenEatingPhotoNo: { $sum: { $cond: ["$childrenEatingBreakfastPhoto", 0, 1] } },

          // Milk Sanjivani
          milkPouchCount: { $sum: "$milkPouchCount" },
          milkPouchPhotoYes: { $sum: { $cond: ["$milkPouchGiven", 1, 0] } },
          milkPouchPhotoNo: { $sum: { $cond: ["$milkPouchGiven", 0, 1] } },

          // Afternoon
          afternoonMealChildrenCount: { $sum: "$afternoonMealChildrenCount" },
          afternoonDishPhotoYes: { $sum: { $cond: ["$afternoonDishPhoto", 1, 0] } },
          afternoonDishPhotoNo: { $sum: { $cond: ["$afternoonDishPhoto", 0, 1] } },
          childrenEatingAfternoonPhotoYes: { $sum: { $cond: ["$childrenEatingAfternoonPhoto", 1, 0] } },
          childrenEatingAfternoonPhotoNo: { $sum: { $cond: ["$childrenEatingAfternoonPhoto", 0, 1] } },

          // Poshan Sudha Yojana
          poshanSudhaCount: { $sum: "$poshanSudhaCount" },
          poshanBenefitPhotoYes: { $sum: { $cond: ["$photoBeneficiariesNutrition", 1, 0] } },
          poshanBenefitPhotoNo: { $sum: { $cond: ["$photoBeneficiariesNutrition", 0, 1] } },

          // Pre-primary education
          preEducationChildrenCount: { $sum: "$preEducationChildrenCount" },
          preEducationPhotoYes: { $sum: { $cond: ["$preEducationPhoto", 1, 0] } },
          preEducationPhotoNo: { $sum: { $cond: ["$preEducationPhoto", 0, 1] } },

          // Meal quality
          mealQualityGood: { $sum: { $cond: [{ $eq: ["$qualityOfMeal", "good"] }, 1, 0] } },
          mealQualityAverage: { $sum: { $cond: [{ $eq: ["$qualityOfMeal", "average"] }, 1, 0] } },
          mealQualityBad: { $sum: { $cond: [{ $eq: ["$qualityOfMeal", "bad"] }, 1, 0] } },
        },
      },
      { $sort: { sectorName: 1 } },
    ]);

    // Sectors that have masters but zero records yet still show up with zero counts
    const allSectors = await Sector.find(filter).select("code name");
    const recordMap = Object.fromEntries(recordAgg.map((r) => [r._id, r]));

    const sectors = allSectors.map((s) => {
      const r = recordMap[s.code] || {};
      return {
        sectorCode: s.code,
        sectorName: s.name,
        totalAwc: totalAwcMap[s.code] || 0,
        awcOpenYes: r.awcOpenYes || 0,
        awcOpenNo: r.awcOpenNo || 0,

        morningMealChildrenCount: r.morningMealChildrenCount || 0,
        morningDishPhotoYes: r.morningDishPhotoYes || 0,
        morningDishPhotoNo: r.morningDishPhotoNo || 0,
        childrenEatingPhotoYes: r.childrenEatingPhotoYes || 0,
        childrenEatingPhotoNo: r.childrenEatingPhotoNo || 0,

        milkPouchCount: r.milkPouchCount || 0,
        milkPouchPhotoYes: r.milkPouchPhotoYes || 0,
        milkPouchPhotoNo: r.milkPouchPhotoNo || 0,

        afternoonMealChildrenCount: r.afternoonMealChildrenCount || 0,
        afternoonDishPhotoYes: r.afternoonDishPhotoYes || 0,
        afternoonDishPhotoNo: r.afternoonDishPhotoNo || 0,
        childrenEatingAfternoonPhotoYes: r.childrenEatingAfternoonPhotoYes || 0,
        childrenEatingAfternoonPhotoNo: r.childrenEatingAfternoonPhotoNo || 0,

        poshanSudhaCount: r.poshanSudhaCount || 0,
        poshanBenefitPhotoYes: r.poshanBenefitPhotoYes || 0,
        poshanBenefitPhotoNo: r.poshanBenefitPhotoNo || 0,

        preEducationChildrenCount: r.preEducationChildrenCount || 0,
        preEducationPhotoYes: r.preEducationPhotoYes || 0,
        preEducationPhotoNo: r.preEducationPhotoNo || 0,

        mealQualityGood: r.mealQualityGood || 0,
        mealQualityAverage: r.mealQualityAverage || 0,
        mealQualityBad: r.mealQualityBad || 0,
      };
    });

    res.status(200).json({ success: true, count: sectors.length, sectors });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getDashboard };

// module.exports = { getDashboard };
