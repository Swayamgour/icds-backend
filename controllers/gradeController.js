// Thin HTTP layer: all rules live in services/gradeService.js.
const gradeService = require("../services/gradeService");
const { HttpError } = require("../utils/httpError");

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    console.error(err);
    // Never leak internals/stack in production
    const message = process.env.NODE_ENV === "production" ? "Server error" : err.message;
    res.status(500).json({ success: false, message });
  }
};

// @route  GET /api/grades/ranking  (alias: GET /api/grades)
// @query  period=YYYY-MM | fromDate&toDate, districtCode?, blockCode?, sectorCode?, grade?, search?, page?, limit?
// @access Private (district, block, supervisor, sector) - always limited to req.scopeFilter
const getRanking = handle(async (req, res) => {
  const data = await gradeService.getRanking(req.scopeFilter, req.query);
  res.status(200).json({ success: true, data });
});

// @route  GET /api/grades/top?period=YYYY-MM&limit=10
const getTopPerformers = handle(async (req, res) => {
  const data = await gradeService.getTopPerformers(req.scopeFilter, req.query);
  res.status(200).json({ success: true, data });
});

// @route  GET /api/grades/awc/:awcCode?months=6&to=YYYY-MM&stored=true
// @access Private (all roles; scopeFilter restricts an AWC user to its own centre)
const getAwcHistory = handle(async (req, res) => {
  const data = await gradeService.getAwcHistory(req.scopeFilter, req.params.awcCode, req.query);
  res.status(200).json({ success: true, data });
});

// @route  POST /api/grades/recalculate  (alias: POST /api/grades/generate)  body: { period: "YYYY-MM", awcCode? }
// Recomputes and stores the monthly snapshot - for the whole district, or one AWC when awcCode is given.
const recalculate = handle(async (req, res) => {
  const { period, awcCode } = req.body || {};
  if (!period) throw new HttpError(400, "period is required (YYYY-MM)");

  if (awcCode) {
    // Must be inside the caller's scope (404 otherwise - same as every other scoped lookup)
    await gradeService.assertAwcInScope(req.scopeFilter, awcCode);
    const grade = await gradeService.recalculateAWCGrade(awcCode, period);
    return res.status(200).json({ success: true, data: { period, awcCode, grade } });
  }

  const data = await gradeService.recalculateDistrictRanking(req.scopeFilter.districtCode, period);
  res.status(200).json({ success: true, data });
});

module.exports = { getRanking, getTopPerformers, getAwcHistory, recalculate };
