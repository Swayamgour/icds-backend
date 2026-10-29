// Single place to tune the AWC performance grading + ranking rules.
// Nothing else in the codebase hard-codes weights, grade bands or tie-breakers.

// Weights must describe the 5 metrics below; they are re-normalised per AWC
// when a metric has no applicable data (e.g. no tasks were assigned that month),
// so an AWC is never penalised for something that did not apply to it.
const WEIGHTS = {
  completionRate: 30, // Entry completion / punctuality: days with an entry / expected working days
  approvalRate: 25, // Entry quality: approved / (approved + rejected) reviewed entries
  beneficiaryRate: 20, // Beneficiaries: children attended / registered, on days the centre was open
  taskCompletionRate: 15, // Tasks assigned to the AWC that have an approved submission
  inspectionScore: 10, // Supervisor inspections (submitted, not rejected) where the centre was found open
};

// Highest band first. `min` is inclusive.
const GRADE_BANDS = [
  { grade: "A+", min: 90 },
  { grade: "A", min: 80 },
  { grade: "B+", min: 70 },
  { grade: "B", min: 60 },
  { grade: "C", min: 50 },
  { grade: "D", min: -Infinity },
];

// Order used for filters/summary. Derived so it can never drift from the bands.
const GRADES = GRADE_BANDS.map((b) => b.grade);

// Tie-breakers applied after totalScore (all DESC), then awcCode ASC as the final stable order.
const TIE_BREAKERS = ["approvalRate", "completionRate", "taskCompletionRate", "inspectionScore"];

// All reporting periods are cut on Indian Standard Time (entries are only accepted 9:30-13:30 IST).
const TZ_OFFSET_MIN = 5 * 60 + 30;
const TZ_OFFSET_STRING = "+05:30";

// Weekdays (0 = Sunday, IST) that do not count as expected working days.
const NON_WORKING_WEEKDAYS = [0];

const LIMITS = {
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 200,
  DEFAULT_TOP: 10,
  MAX_TOP: 100,
  DEFAULT_HISTORY_MONTHS: 6,
  MAX_HISTORY_MONTHS: 24,
  MAX_CUSTOM_RANGE_DAYS: 366,
};

module.exports = {
  WEIGHTS,
  GRADE_BANDS,
  GRADES,
  TIE_BREAKERS,
  TZ_OFFSET_MIN,
  TZ_OFFSET_STRING,
  NON_WORKING_WEEKDAYS,
  LIMITS,
};
