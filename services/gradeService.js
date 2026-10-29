// Centralised AWC performance scoring, grading and ranking.
//
//   Controller -> gradeService (rules, ranking, recalculation) -> gradeRepository (aggregations) -> MongoDB
//
// Everything that decides a score, a grade or a rank lives in this file; controllers only
// translate HTTP <-> these functions.
const Grade = require("../models/Grade");
const Awc = require("../models/Awc");
const repo = require("./gradeRepository");
const { HttpError } = require("../utils/httpError");
const {
  WEIGHTS,
  GRADE_BANDS,
  GRADES,
  TIE_BREAKERS,
  TZ_OFFSET_MIN,
  NON_WORKING_WEEKDAYS,
  LIMITS,
} = require("../config/gradeConfig");

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const METRIC_KEYS = Object.keys(WEIGHTS);

// ----------------------------------------------------------------------------
// Pure helpers
// ----------------------------------------------------------------------------

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const clampPct = (n) => Math.max(0, Math.min(100, n));

/** The ONE place score -> grade is decided. */
const calculateGrade = (score) => {
  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw new TypeError("calculateGrade expects a finite number");
  }
  return GRADE_BANDS.find((b) => score >= b.min).grade;
};

/** Accepts "A+", "a+", "A ", (a "+" in a raw query string decodes to a space) -> "A+" or null. */
const normalizeGrade = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const g = String(value).replace(/ /g, "+").trim().toUpperCase();
  return GRADES.includes(g) ? g : undefined; // undefined => invalid
};

const istMidnightUtcMs = (y, m /* 1-12 */, d) => Date.UTC(y, m - 1, d) - TZ_OFFSET_MIN * MIN;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const periodOfMs = (ms) => {
  const d = new Date(ms + TZ_OFFSET_MIN * MIN);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

const parseDate = (value, label) => {
  const m = DATE_RE.exec(String(value));
  if (!m) throw new HttpError(400, `${label} must be YYYY-MM-DD`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) throw new HttpError(400, `${label} is not a valid date`);
  return istMidnightUtcMs(y, mo, d);
};

/**
 * Resolves ?period=YYYY-MM (monthly) or ?fromDate=&toDate= (custom, inclusive) into an IST-aligned
 * [start, end) range. With neither, defaults to the current IST month, so a request can never
 * silently rank on unrelated historical data.
 */
const resolvePeriod = (query = {}, now = new Date()) => {
  const { period, fromDate, toDate } = query;

  if (period && (fromDate || toDate)) throw new HttpError(400, "Use either period or fromDate/toDate, not both");

  if (fromDate || toDate) {
    if (!fromDate || !toDate) throw new HttpError(400, "Both fromDate and toDate are required for a custom range");
    const start = parseDate(fromDate, "fromDate");
    const end = parseDate(toDate, "toDate") + DAY;
    if (end <= start) throw new HttpError(400, "toDate must not be before fromDate");
    if ((end - start) / DAY > LIMITS.MAX_CUSTOM_RANGE_DAYS) {
      throw new HttpError(400, `Custom range cannot exceed ${LIMITS.MAX_CUSTOM_RANGE_DAYS} days`);
    }
    return {
      type: "custom",
      period: `${fromDate}_${toDate}`,
      start: new Date(start),
      end: new Date(end),
    };
  }

  const key = period || periodOfMs(now.getTime());
  const m = MONTH_RE.exec(String(key));
  if (!m) throw new HttpError(400, "period must be in YYYY-MM format (e.g. 2026-10)");
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return {
    type: "monthly",
    period: key,
    start: new Date(istMidnightUtcMs(y, mo, 1)),
    end: new Date(istMidnightUtcMs(mo === 12 ? y + 1 : y, mo === 12 ? 1 : mo + 1, 1)),
  };
};

/** Working days (IST, excluding NON_WORKING_WEEKDAYS) in [start, end), capped at today for the running period. */
const expectedWorkingDays = (start, end, now = new Date()) => {
  const startOfTomorrow = istMidnightUtcMs(
    ...(() => {
      const d = new Date(now.getTime() + TZ_OFFSET_MIN * MIN);
      return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate() + 1];
    })()
  );
  const limit = Math.min(end.getTime(), startOfTomorrow);
  let count = 0;
  for (let t = start.getTime(); t < limit; t += DAY) {
    const weekday = new Date(t + TZ_OFFSET_MIN * MIN).getUTCDay();
    if (!NON_WORKING_WEEKDAYS.includes(weekday)) count += 1;
  }
  return count;
};

/**
 * Weighted score over the metrics that apply to this AWC. A metric that is null (no tasks assigned,
 * nothing reviewed yet, no inspection) is dropped and the remaining weights are re-normalised.
 */
const computeScore = (metrics) => {
  let weighted = 0;
  let totalWeight = 0;
  const used = [];
  for (const key of METRIC_KEYS) {
    const v = metrics[key];
    if (v === null || v === undefined) continue;
    weighted += WEIGHTS[key] * v;
    totalWeight += WEIGHTS[key];
    used.push(key);
  }
  if (totalWeight === 0) return { score: null, used };
  return { score: round2(weighted / totalWeight), used };
};

const tieValue = (item, key) => {
  const v = item.metrics[key];
  return v === null || v === undefined ? -1 : v;
};

/** Deterministic ordering: score, then TIE_BREAKERS (all DESC), then awcCode ASC. */
const compareAwc = (a, b) => {
  if (a.score !== b.score) return b.score - a.score;
  for (const key of TIE_BREAKERS) {
    const diff = tieValue(b, key) - tieValue(a, key);
    if (diff !== 0) return diff;
  }
  return a.awcCode < b.awcCode ? -1 : a.awcCode > b.awcCode ? 1 : 0;
};

const pct = (num, den) => (den > 0 ? round2(clampPct((num / den) * 100)) : null);

/**
 * Pure: turns the raw aggregation output into scored, graded AWC rows (unranked).
 * AWCs with no entry in the period are NOT scored (no fake zero) and are returned separately.
 */
const buildScoredItems = ({ directory, recordStats, taskData, inspectionStats, range, now }) => {
  const expectedDays = expectedWorkingDays(range.start, range.end, now);
  const records = new Map(recordStats.map((r) => [r._id, r]));
  const inspections = new Map(inspectionStats.map((r) => [r._id, r]));

  // Task -> AWCs it applies to, bucketed by the scope code it was assigned to.
  const byScopeCode = new Map();
  const individually = new Map(); // awcCode -> [taskId]
  const push = (map, key, id) => map.set(key, [...(map.get(key) || []), id]);
  for (const t of taskData.tasks) {
    if (t.assignedToUser) {
      const awcCode = taskData.userAwc.get(t.assignedToUser);
      if (awcCode) push(individually, awcCode, t.id);
    } else if (t.assignedToRole === "awc" && t.assignedToScopeCode) {
      push(byScopeCode, t.assignedToScopeCode, t.id);
    }
  }

  const scored = [];
  const withoutSubmissions = [];

  for (const awc of directory.awcs) {
    const base = {
      awcCode: awc.code,
      awcName: awc.name,
      districtCode: awc.districtCode,
      blockCode: awc.blockCode,
      blockName: directory.blockNames.get(awc.blockCode) || null,
      sectorCode: awc.sectorCode,
      sectorName: directory.sectorNames.get(awc.sectorCode) || null,
    };

    const rec = records.get(awc.code);
    if (!rec) {
      withoutSubmissions.push(base);
      continue;
    }

    const assigned = new Set([
      ...(individually.get(awc.code) || []),
      ...(byScopeCode.get(awc.code) || []),
      ...(byScopeCode.get(awc.sectorCode) || []),
      ...(byScopeCode.get(awc.blockCode) || []),
      ...(byScopeCode.get(awc.districtCode) || []),
    ]);
    const done = taskData.completed.get(awc.code) || new Set();
    const tasksCompleted = [...assigned].filter((id) => done.has(id)).length;
    const insp = inspections.get(awc.code);
    const reviewed = rec.approvedEntries + rec.rejectedEntries;

    const metrics = {
      completionRate: pct(rec.daysSubmitted, Math.max(expectedDays, rec.daysSubmitted, 1)),
      approvalRate: pct(rec.approvedEntries, reviewed),
      beneficiaryRate: pct(rec.attended, rec.registered),
      taskCompletionRate: pct(tasksCompleted, assigned.size),
      inspectionScore: insp ? pct(insp.openWhenVisited, insp.inspections) : null,
    };
    const { score, used } = computeScore(metrics);

    scored.push({
      ...base,
      score,
      grade: calculateGrade(score),
      metrics,
      metricsUsed: used,
      counts: {
        totalEntries: rec.totalEntries,
        approvedEntries: rec.approvedEntries,
        rejectedEntries: rec.rejectedEntries,
        pendingEntries: rec.pendingEntries,
        daysSubmitted: rec.daysSubmitted,
        expectedDays,
        tasksAssigned: assigned.size,
        tasksCompleted,
        inspections: insp ? insp.inspections : 0,
      },
    });
  }

  scored.sort(compareAwc);
  scored.forEach((item, i) => {
    item.overallRank = i + 1; // rank across the caller's whole scope
  });

  return { scored, withoutSubmissions, totalRegisteredAWCs: directory.awcs.length };
};

const gradeDistribution = (items) => {
  const dist = Object.fromEntries(GRADES.map((g) => [g, 0]));
  items.forEach((i) => {
    dist[i.grade] += 1;
  });
  return dist;
};

const flatGradeCounts = (dist) => ({
  aPlus: dist["A+"],
  a: dist.A,
  bPlus: dist["B+"],
  b: dist.B,
  c: dist.C,
  d: dist.D,
});

// ----------------------------------------------------------------------------
// Ranking (live, always from current data)
// ----------------------------------------------------------------------------

/** Scores + ranks every eligible AWC inside `scope` (the caller's already-authorised scope). */
const computeRanking = async (scope, range, now = new Date()) => {
  const [directory, recordStats, taskData, inspectionStats] = await Promise.all([
    repo.fetchDirectory(scope),
    repo.fetchRecordStats(scope, range.start, range.end),
    repo.fetchTaskData(scope, range.start, range.end),
    repo.fetchInspectionStats(scope, range.start, range.end),
  ]);
  const result = buildScoredItems({ directory, recordStats, taskData, inspectionStats, range, now });
  return { ...result, directory };
};

const parsePagination = (query) => {
  const parse = (raw, fallback, name, max) => {
    if (raw === undefined || raw === "") return fallback;
    if (!/^\d+$/.test(String(raw))) throw new HttpError(400, `${name} must be a positive integer`);
    const n = Number(raw);
    if (n < 1) throw new HttpError(400, `${name} must be a positive integer`);
    if (max && n > max) throw new HttpError(400, `${name} cannot exceed ${max}`);
    return n;
  };
  return {
    page: parse(query.page, 1, "page"),
    limit: parse(query.limit, LIMITS.DEFAULT_PAGE_SIZE, "limit", LIMITS.MAX_PAGE_SIZE),
  };
};

const toRow = (item) => ({
  rank: item.rank,
  overallRank: item.overallRank,
  awcCode: item.awcCode,
  awcName: item.awcName,
  blockCode: item.blockCode,
  blockName: item.blockName,
  sectorCode: item.sectorCode,
  sectorName: item.sectorName,
  score: item.score,
  grade: item.grade,
  metrics: item.metrics,
  metricsUsed: item.metricsUsed,
  counts: item.counts,
});

/**
 * District/block/sector ranking.
 *   scope  = req.scopeFilter (set by the existing scopeFilter middleware; never widened here)
 *   query  = period | fromDate/toDate | districtCode | blockCode | sectorCode | grade | search | page | limit
 * With no sector/block filter the ranking covers EVERY sector in the caller's scope.
 * `rank` is the position inside the geography being viewed (selected sector/block, else the whole
 * scope) and is a GLOBAL rank across pages; `overallRank` is the position in the caller's whole scope.
 */
const getRanking = async (scope, query = {}, { now = new Date() } = {}) => {
  const range = resolvePeriod(query, now);
  const { page, limit } = parsePagination(query);

  if (query.districtCode && String(query.districtCode) !== scope.districtCode) {
    throw new HttpError(403, "You can only view your own district");
  }
  const blockCode = query.blockCode ? String(query.blockCode) : null;
  const sectorCode = query.sectorCode ? String(query.sectorCode) : null;
  if (blockCode && scope.blockCode && blockCode !== scope.blockCode) {
    throw new HttpError(403, "This block is outside your scope");
  }
  if (sectorCode && scope.sectorCode && sectorCode !== scope.sectorCode) {
    throw new HttpError(403, "This sector is outside your scope");
  }

  const gradeFilter = normalizeGrade(query.grade);
  if (gradeFilter === undefined) throw new HttpError(400, `grade must be one of: ${GRADES.join(", ")}`);
  const search = query.search ? String(query.search).trim().toLowerCase() : "";

  const { scored, withoutSubmissions, totalRegisteredAWCs, directory } = await computeRanking(scope, range, now);

  if (blockCode && !directory.blockNames.has(blockCode)) throw new HttpError(404, "Block not found in your scope");
  if (sectorCode) {
    if (!directory.sectorNames.has(sectorCode)) throw new HttpError(404, "Sector not found in your scope");
    if (blockCode && directory.sectorBlock.get(sectorCode) !== blockCode) {
      throw new HttpError(400, "sectorCode does not belong to blockCode");
    }
  }

  const inGeo = (x) => (!blockCode || x.blockCode === blockCode) && (!sectorCode || x.sectorCode === sectorCode);
  const geoItems = scored.filter(inGeo); // already sorted -> positions are the geography rank
  geoItems.forEach((item, i) => {
    item.rank = i + 1;
  });

  const dist = gradeDistribution(geoItems);
  const averageScore = geoItems.length ? round2(geoItems.reduce((s, i) => s + i.score, 0) / geoItems.length) : 0;

  const filtered = geoItems.filter(
    (i) =>
      (!gradeFilter || i.grade === gradeFilter) &&
      (!search || i.awcName?.toLowerCase().includes(search) || i.awcCode.toLowerCase().includes(search))
  );

  const total = filtered.length;
  const totalPages = Math.ceil(total / limit);
  const pageItems = filtered.slice((page - 1) * limit, page * limit);

  return {
    period: range.period,
    periodType: range.type,
    periodStart: range.start,
    periodEnd: range.end,
    scope: {
      districtCode: scope.districtCode,
      blockCode: blockCode || scope.blockCode || null,
      sectorCode: sectorCode || scope.sectorCode || null,
    },
    filters: { grade: gradeFilter, search: search || null },
    summary: {
      totalAWCs: geoItems.length,
      totalRegisteredAWCs: blockCode || sectorCode ? geoItems.length + withoutSubmissions.filter(inGeo).length : totalRegisteredAWCs,
      awcsWithoutSubmissions: withoutSubmissions.filter(inGeo).length,
      averageScore,
      ...flatGradeCounts(dist),
    },
    gradeDistribution: dist,
    ranking: pageItems.map(toRow),
    pagination: { page, limit, total, totalPages },
  };
};

/** Top N of the same ranking (reuses getRanking, never re-implements it). */
const getTopPerformers = async (scope, query = {}, opts = {}) => {
  let limit = LIMITS.DEFAULT_TOP;
  if (query.limit !== undefined && query.limit !== "") {
    if (!/^\d+$/.test(String(query.limit)) || Number(query.limit) < 1) throw new HttpError(400, "limit must be a positive integer");
    if (Number(query.limit) > LIMITS.MAX_TOP) throw new HttpError(400, `limit cannot exceed ${LIMITS.MAX_TOP}`);
    limit = Number(query.limit);
  }
  const data = await getRanking(scope, { ...query, page: 1, limit }, opts);
  return {
    period: data.period,
    periodType: data.periodType,
    scope: data.scope,
    top: data.ranking.map((r) => ({
      rank: r.rank,
      awcCode: r.awcCode,
      awcName: r.awcName,
      sectorCode: r.sectorCode,
      sectorName: r.sectorName,
      blockCode: r.blockCode,
      blockName: r.blockName,
      score: r.score,
      grade: r.grade,
    })),
  };
};

// ----------------------------------------------------------------------------
// History
// ----------------------------------------------------------------------------

const lastMonths = (toPeriod, n) => {
  const [y, m] = toPeriod.split("-").map(Number);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const idx = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`);
  }
  return out; // newest first
};

/** 404 unless the AWC exists inside the caller's scope. */
const assertAwcInScope = async (scope, awcCode) => {
  // $and so a requested code can never override the scope's own constraint (an AWC user's scope pins `code`).
  const awc = await Awc.findOne({ $and: [repo.masterFilter(scope), { code: String(awcCode) }] }).lean();
  if (!awc) throw new HttpError(404, "AWC not found in your scope");
  return awc;
};

/**
 * Month-by-month performance of one AWC (newest first). Rank = the AWC's DISTRICT rank that month.
 * Live by default; `?stored=true` reads the persisted snapshots instead (cheap, as of last recalculation).
 */
const getAwcHistory = async (scope, awcCode, query = {}, { now = new Date() } = {}) => {
  const awc = await assertAwcInScope(scope, awcCode);

  let months = LIMITS.DEFAULT_HISTORY_MONTHS;
  if (query.months !== undefined && query.months !== "") {
    if (!/^\d+$/.test(String(query.months)) || Number(query.months) < 1) throw new HttpError(400, "months must be a positive integer");
    if (Number(query.months) > LIMITS.MAX_HISTORY_MONTHS) throw new HttpError(400, `months cannot exceed ${LIMITS.MAX_HISTORY_MONTHS}`);
    months = Number(query.months);
  }
  const to = query.to || periodOfMs(now.getTime());
  if (!MONTH_RE.test(String(to))) throw new HttpError(400, "to must be in YYYY-MM format");
  const periods = lastMonths(String(to), months);

  const history = [];
  if (String(query.stored) === "true") {
    const snaps = await Grade.find({ awcCode: awc.code, period: { $in: periods } }).lean();
    const byPeriod = new Map(snaps.map((s) => [s.period, s]));
    for (const period of periods) {
      const s = byPeriod.get(period);
      history.push(
        s
          ? {
              period,
              hasData: true,
              score: s.totalScore,
              grade: s.grade,
              rank: s.rank ?? null,
              totalRanked: s.totalRanked ?? null,
              metrics: s.metrics,
              counts: s.counts,
              calculatedAt: s.calculatedAt,
            }
          : { period, hasData: false }
      );
    }
  } else {
    for (const period of periods) {
      const range = resolvePeriod({ period }, now);
      // District-wide universe so the rank is the AWC's real district rank, independent of who is asking.
      const { scored } = await computeRanking({ districtCode: awc.districtCode }, range, now);
      const me = scored.find((i) => i.awcCode === awc.code);
      history.push(
        me
          ? {
              period,
              hasData: true,
              score: me.score,
              grade: me.grade,
              rank: me.overallRank,
              totalRanked: scored.length,
              metrics: me.metrics,
              counts: me.counts,
            }
          : { period, hasData: false }
      );
    }
  }

  return {
    awc: {
      awcCode: awc.code,
      awcName: awc.name,
      sectorCode: awc.sectorCode,
      blockCode: awc.blockCode,
      districtCode: awc.districtCode,
    },
    source: String(query.stored) === "true" ? "stored" : "live",
    history,
  };
};

// ----------------------------------------------------------------------------
// Recalculation (persisted snapshots)
// ----------------------------------------------------------------------------

const requireMonthly = (period, now) => {
  if (!MONTH_RE.test(String(period))) throw new HttpError(400, "period must be in YYYY-MM format (e.g. 2026-10)");
  return resolvePeriod({ period }, now);
};

const snapshotDoc = (item, range, { rank, totalRanked, calculatedAt }) => ({
  districtCode: item.districtCode,
  blockCode: item.blockCode,
  sectorCode: item.sectorCode,
  awcCode: item.awcCode,
  awcName: item.awcName,
  period: range.period,
  periodStart: range.start,
  periodEnd: range.end,
  metrics: item.metrics,
  counts: item.counts,
  metricsUsed: item.metricsUsed,
  totalScore: item.score,
  grade: item.grade,
  ...(rank !== undefined && { rank, totalRanked }),
  calculatedAt,
});

const upsertOps = (docs) =>
  docs.map((doc) => ({
    updateOne: { filter: { awcCode: doc.awcCode, period: doc.period }, update: { $set: doc }, upsert: true },
  }));

/** Recomputes every AWC in the district for a month, re-ranks, and stores the snapshots. */
const recalculateDistrictRanking = async (districtCode, period, { now = new Date() } = {}) => {
  const range = requireMonthly(period, now);
  const { scored } = await computeRanking({ districtCode }, range, now);
  const calculatedAt = new Date();

  const docs = scored.map((item) =>
    snapshotDoc(item, range, { rank: item.overallRank, totalRanked: scored.length, calculatedAt })
  );
  if (docs.length) await Grade.bulkWrite(upsertOps(docs), { ordered: false });

  // AWCs that no longer have entries for this month must not keep a stale snapshot.
  const stale = await Grade.deleteMany({ districtCode, period: range.period, awcCode: { $nin: scored.map((s) => s.awcCode) } });

  return { districtCode, period: range.period, totalRanked: scored.length, removedStale: stale.deletedCount || 0, calculatedAt };
};

/** Re-assigns snapshot ranks from stored scores using the same comparator as live ranking. */
const reRankSnapshots = async (districtCode, period) => {
  const snaps = await Grade.find({ districtCode, period }).select("awcCode totalScore metrics").lean();
  const sorted = snaps
    .map((s) => ({ awcCode: s.awcCode, score: s.totalScore, metrics: s.metrics || {} }))
    .sort(compareAwc);
  if (sorted.length) {
    await Grade.bulkWrite(
      sorted.map((s, i) => ({
        updateOne: { filter: { awcCode: s.awcCode, period }, update: { $set: { rank: i + 1, totalRanked: sorted.length } } },
      })),
      { ordered: false }
    );
  }
  return sorted.length;
};

/**
 * Recomputes ONE AWC's month (cheap: only that AWC's data is read), upserts its snapshot, then
 * refreshes the district ranks from the stored scores. Returns null (and removes any snapshot)
 * if the AWC has no entries for the month.
 */
const recalculateAWCGrade = async (awcCode, period, { now = new Date() } = {}) => {
  const range = requireMonthly(period, now);
  const awc = await Awc.findOne({ code: String(awcCode) }).lean();
  if (!awc) throw new HttpError(404, "AWC not found");

  const { scored } = await computeRanking({ districtCode: awc.districtCode, awcCode: awc.code }, range, now);
  const item = scored[0];

  if (!item) {
    await Grade.deleteOne({ awcCode: awc.code, period: range.period });
    await reRankSnapshots(awc.districtCode, range.period);
    return null;
  }

  await Grade.bulkWrite(upsertOps([snapshotDoc(item, range, { rank: undefined, totalRanked: undefined, calculatedAt: new Date() })]));
  await reRankSnapshots(awc.districtCode, range.period);
  return Grade.findOne({ awcCode: awc.code, period: range.period }).lean();
};

module.exports = {
  // rules
  calculateGrade,
  computeScore,
  compareAwc,
  resolvePeriod,
  expectedWorkingDays,
  normalizeGrade,
  // queries
  computeRanking,
  getRanking,
  getTopPerformers,
  getAwcHistory,
  assertAwcInScope,
  // recalculation
  recalculateAWCGrade,
  recalculateDistrictRanking,
  // exposed for unit tests
  _internal: { buildScoredItems, lastMonths, round2 },
};
