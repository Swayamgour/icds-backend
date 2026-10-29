// Data access for the grading engine. Every function here is ONE query/aggregation for the
// whole scope (never one query per AWC), and all of them use the app's existing mongoose
// connection through the existing models.
const Record = require("../models/Record");
const Task = require("../models/Task");
const User = require("../models/User");
const SupervisorVisit = require("../models/SupervisorVisit");
const TaskSubmission = require("../models/TaskSubmission");
const Awc = require("../models/Awc");
const Block = require("../models/Block");
const Sector = require("../models/Sector");
const { TZ_OFFSET_STRING } = require("../config/gradeConfig");

// scopeFilter keys are the same code names used on Record/Task/etc.; Awc/Block/Sector
// masters call their own code field "code".
const masterFilter = (scope) => {
  const f = { districtCode: scope.districtCode };
  if (scope.blockCode) f.blockCode = scope.blockCode;
  if (scope.sectorCode) f.sectorCode = scope.sectorCode;
  if (scope.awcCode) f.code = scope.awcCode;
  return f;
};

const recordScope = (scope) => {
  const f = { districtCode: scope.districtCode };
  ["blockCode", "sectorCode", "awcCode"].forEach((k) => {
    if (scope[k]) f[k] = scope[k];
  });
  return f;
};

// AWC master list for the scope (the universe of "eligible" AWCs) + block/sector names.
const fetchDirectory = async (scope) => {
  const awcs = await Awc.find(masterFilter(scope)).select("code name sectorCode blockCode districtCode").lean();

  const geo = { districtCode: scope.districtCode };
  if (scope.blockCode) geo.blockCode = scope.blockCode;
  const sectorFilter = { ...geo };
  if (scope.sectorCode) sectorFilter.code = scope.sectorCode;
  const blockFilter = { districtCode: scope.districtCode };
  if (scope.blockCode) blockFilter.code = scope.blockCode;

  const [sectors, blocks] = await Promise.all([
    Sector.find(sectorFilter).select("code name blockCode").lean(),
    Block.find(blockFilter).select("code name").lean(),
  ]);

  return {
    awcs,
    sectorNames: new Map(sectors.map((s) => [s.code, s.name])),
    sectorBlock: new Map(sectors.map((s) => [s.code, s.blockCode])),
    blockNames: new Map(blocks.map((b) => [b.code, b.name])),
  };
};

// One pass over the period's Record documents -> one row per AWC.
const fetchRecordStats = async (scope, start, end) => {
  const openEntry = { $ne: ["$centerOpen", false] };
  return Record.aggregate([
    { $match: { ...recordScope(scope), date: { $gte: start, $lt: end } } },
    {
      $group: {
        _id: "$awcCode",
        totalEntries: { $sum: 1 },
        approvedEntries: { $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] } },
        rejectedEntries: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
        pendingEntries: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
        attended: { $sum: { $cond: [openEntry, { $ifNull: ["$childrenAttendedCount", 0] }, 0] } },
        registered: { $sum: { $cond: [openEntry, { $ifNull: ["$registeredChildrenCount", 0] }, 0] } },
        days: { $addToSet: { $dateToString: { format: "%Y-%m-%d", date: "$date", timezone: TZ_OFFSET_STRING } } },
      },
    },
    {
      $project: {
        totalEntries: 1,
        approvedEntries: 1,
        rejectedEntries: 1,
        pendingEntries: 1,
        attended: 1,
        registered: 1,
        daysSubmitted: { $size: "$days" },
      },
    },
  ]);
};

// Tasks due in the period, expanded to "which AWC is it assigned to" in the service.
// Returns { tasks: [{ id, assignedToUser, assignedToRole, assignedToScopeCode }], userAwc: Map(userId -> awcCode),
//           completed: Map(awcCode -> Set(taskId)) }.
const fetchTaskData = async (scope, start, end) => {
  const tasks = await Task.find({
    districtCode: scope.districtCode,
    dueDate: { $gte: start, $lt: end },
    status: { $ne: "cancelled" },
  })
    .select("assignedToUser assignedToRole assignedToScopeCode")
    .lean();

  const userIds = [...new Set(tasks.filter((t) => t.assignedToUser).map((t) => String(t.assignedToUser)))];
  const [users, submissions] = await Promise.all([
    userIds.length ? User.find({ _id: { $in: userIds }, role: "awc" }).select("awcCode").lean() : [],
    tasks.length
      ? TaskSubmission.aggregate([
          { $match: { ...recordScope(scope), status: "approved", task: { $in: tasks.map((t) => t._id) } } },
          { $group: { _id: "$awcCode", tasks: { $addToSet: "$task" } } },
        ])
      : [],
  ]);

  return {
    tasks: tasks.map((t) => ({
      id: String(t._id),
      assignedToUser: t.assignedToUser ? String(t.assignedToUser) : null,
      assignedToRole: t.assignedToRole || null,
      assignedToScopeCode: t.assignedToScopeCode || null,
    })),
    userAwc: new Map(users.filter((u) => u.awcCode).map((u) => [String(u._id), u.awcCode])),
    completed: new Map(submissions.map((s) => [s._id, new Set(s.tasks.map(String))])),
  };
};

// Supervisor inspections: submitted forms that were not rejected, and whether the centre was found open.
const fetchInspectionStats = async (scope, start, end) =>
  SupervisorVisit.aggregate([
    {
      $match: {
        ...recordScope(scope),
        formStatus: "submitted",
        status: { $ne: "rejected" },
        date: { $gte: start, $lt: end },
      },
    },
    {
      $group: {
        _id: "$awcCode",
        inspections: { $sum: 1 },
        openWhenVisited: { $sum: { $cond: [{ $eq: ["$general.centerOpen", true] }, 1, 0] } },
      },
    },
  ]);

module.exports = {
  fetchDirectory,
  fetchRecordStats,
  fetchTaskData,
  fetchInspectionStats,
  masterFilter,
};
