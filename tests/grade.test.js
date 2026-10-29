const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { connect, disconnect } = require("./support/bootstrap"); // must load before the app modules
const express = require("express");
const request = require("supertest");
const mongoose = require("mongoose");

const Awc = require("../models/Awc");
const Block = require("../models/Block");
const Sector = require("../models/Sector");
const Record = require("../models/Record");
const Task = require("../models/Task");
const SupervisorVisit = require("../models/SupervisorVisit");
const TaskSubmission = require("../models/TaskSubmission");
const Grade = require("../models/Grade");
const gradeRoutes = require("../routes/gradeRoutes");
const svc = require("../services/gradeService");

// ---------------------------------------------------------------- fixtures
// District 24445 -> B1(2444501): S1, S2 | B2(2444502): S3, S4 ; plus an unrelated district 99999.
const D = "24445";
const B1 = "2444501";
const B2 = "2444502";
const S1 = "244450101";
const S2 = "244450102";
const S3 = "244450201";
const S4 = "244450202";
const A = {
  a1: "24445010101", a2: "24445010102", a3: "24445010201", a4: "24445010202",
  a5: "24445020101", a6: "24445020102", a7: "24445020201", a8: "24445020202", a9: "99999010101",
};
const P = "2026-09"; // a complete past month: 30 days, 4 Sundays -> 26 expected working days
const userId = () => new mongoose.Types.ObjectId();

const istDate = (day, hour = 10) => new Date(Date.UTC(2026, 8, day, hour, 0) - 330 * 60 * 1000);
const WORKING_DAYS = Array.from({ length: 30 }, (_, i) => i + 1).filter((d) => ![6, 13, 20, 27].includes(d));

const awcDoc = (code, sectorCode, blockCode, name) => ({ code, name, sectorCode, blockCode, districtCode: code.startsWith("99999") ? "99999" : D });

const sectorOf = { [A.a1]: [S1, B1], [A.a2]: [S1, B1], [A.a3]: [S2, B1], [A.a4]: [S2, B1], [A.a5]: [S3, B2], [A.a6]: [S3, B2], [A.a7]: [S4, B2], [A.a8]: [S4, B2] };
const loc = (code) =>
  code === A.a9
    ? { districtCode: "99999", blockCode: "9999901", sectorCode: "999990101" }
    : { districtCode: D, blockCode: sectorOf[code][1], sectorCode: sectorOf[code][0] };

const recs = (awcCode, days, { status = "approved", attended = 20, registered = 20, rejectedDays = [] } = {}) =>
  days.map((day) => ({
    ...loc(awcCode),
    awcCode,
    date: istDate(day),
    registeredChildrenCount: registered,
    childrenAttendedCount: attended,
    centerOpen: true,
    status: rejectedDays.includes(day) ? "rejected" : status,
    createdBy: userId(),
  }));

const asUser = (u) => ({ "x-test-user": JSON.stringify(u) });
const users = {
  district: { role: "district", districtCode: D },
  block1: { role: "block", districtCode: D, blockCode: B1 },
  sector1: { role: "sector", districtCode: D, blockCode: B1, sectorCode: S1 },
  supervisor1: { role: "supervisor", districtCode: D, blockCode: B1, sectorCode: S1 },
  awc1: { role: "awc", districtCode: D, blockCode: B1, sectorCode: S1, awcCode: A.a1 },
  otherDistrict: { role: "district", districtCode: "99999" },
};

let app;
const get = (path, user = users.district) => request(app).get(path).set(asUser(user));

before(async () => {
  await connect("icds_grade_tests");
  app = express();
  app.use(express.json());
  app.use("/api/grades", gradeRoutes);

  await Block.insertMany([
    { code: B1, name: "Block One", districtCode: D },
    { code: B2, name: "Block Two", districtCode: D },
    { code: "9999901", name: "Other Block", districtCode: "99999" },
  ]);
  await Sector.insertMany([
    { code: S1, name: "Sector One", blockCode: B1, districtCode: D },
    { code: S2, name: "Sector Two", blockCode: B1, districtCode: D },
    { code: S3, name: "Sector Three", blockCode: B2, districtCode: D },
    { code: S4, name: "Sector Four", blockCode: B2, districtCode: D },
    { code: "999990101", name: "Other Sector", blockCode: "9999901", districtCode: "99999" },
  ]);
  await Awc.insertMany([
    awcDoc(A.a1, S1, B1, "Chandpur AWC 1"),
    awcDoc(A.a2, S1, B1, "Ramgarh AWC 2"),
    awcDoc(A.a3, S2, B1, "Sundarpur AWC 3"),
    awcDoc(A.a4, S2, B1, "Lakhpur AWC 4"),
    awcDoc(A.a5, S3, B2, "Devgadh AWC 5"),
    awcDoc(A.a6, S3, B2, "Silent AWC 6 (no entries)"),
    awcDoc(A.a7, S4, B2, "Falna AWC 7"),
    awcDoc(A.a8, S4, B2, "Garbada AWC 8"),
    awcDoc(A.a9, "999990101", "9999901", "Other District AWC"),
  ]);

  await Record.insertMany([
    // a1: perfect -> 100
    ...recs(A.a1, WORKING_DAYS),
    // a2: 20 days, 2 rejected, attendance 80% -> 82.10
    ...recs(A.a2, WORKING_DAYS.slice(0, 20), { attended: 16, rejectedDays: [WORKING_DAYS[0], WORKING_DAYS[1]] }),
    // a3: 26 days, attendance 90% -> 97.33
    ...recs(A.a3, WORKING_DAYS, { attended: 18 }),
    // a4: 10 days all still pending (nothing reviewed), attendance 50% -> 43.08
    ...recs(A.a4, WORKING_DAYS.slice(0, 10), { status: "pending", attended: 10 }),
    // a5: perfect, identical to a1 -> exact tie, broken by awcCode
    ...recs(A.a5, WORKING_DAYS),
    // a6: NO entries at all
    // a7: perfect entries + 1 of 2 tasks done + inspection ok -> 92.5
    ...recs(A.a7, WORKING_DAYS),
    // a8: 24 days, attendance 95%, 0 of 2 tasks, inspection found centre closed -> 71.69
    ...recs(A.a8, WORKING_DAYS.slice(0, 24), { attended: 19 }),
    // a9: other district, perfect
    ...recs(A.a9, WORKING_DAYS),
  ]);

  const [t1, t2] = await Task.insertMany(
    [15, 20].map((d) => ({
      title: `Task ${d}`,
      dueDate: istDate(d),
      districtCode: D,
      blockCode: B2,
      sectorCode: S4,
      assignedToRole: "awc",
      assignedToScopeCode: S4, // group task: every AWC in sector S4
      assignedBy: userId(),
    }))
  );
  await TaskSubmission.create({ task: t1._id, submittedBy: userId(), ...loc(A.a7), awcCode: A.a7, status: "approved" });
  await TaskSubmission.create({ task: t2._id, submittedBy: userId(), ...loc(A.a7), awcCode: A.a7, status: "pending" }); // not approved -> not counted

  const visit = (awcCode, open) => ({
    ...loc(awcCode),
    awcCode,
    date: istDate(12),
    general: { centerOpen: open },
    formStatus: "submitted",
    status: "approved",
    createdBy: userId(),
  });
  await SupervisorVisit.insertMany([visit(A.a7, true), visit(A.a8, false)]);
});

after(async () => {
  await disconnect();
});

// ---------------------------------------------------------------- unit: rules
describe("calculateGrade (single source of truth)", () => {
  it("maps the documented examples", () => {
    const cases = [[96.4, "A+"], [84.2, "A"], [73.5, "B+"], [61.8, "B"], [53.4, "C"], [42.7, "D"]];
    for (const [score, grade] of cases) assert.equal(svc.calculateGrade(score), grade);
  });
  it("respects band edges", () => {
    const edges = [[100, "A+"], [90, "A+"], [89.99, "A"], [80, "A"], [79.99, "B+"], [70, "B+"], [69.99, "B"], [60, "B"], [59.99, "C"], [50, "C"], [49.99, "D"], [0, "D"]];
    for (const [score, grade] of edges) assert.equal(svc.calculateGrade(score), grade, String(score));
  });
  it("rejects non-numbers", () => {
    assert.throws(() => svc.calculateGrade(NaN), TypeError);
    assert.throws(() => svc.calculateGrade("90"), TypeError);
  });
});

describe("tie-breakers (Test 4, unit)", () => {
  const mk = (awcCode, score, m = {}) => ({ awcCode, score, metrics: { approvalRate: 0, completionRate: 0, taskCompletionRate: null, inspectionScore: null, ...m } });
  it("orders by score, approval, completion, task, inspection, then awcCode", () => {
    const rows = [
      mk("Z", 95, { approvalRate: 90 }),
      mk("Y", 95, { approvalRate: 100 }),
      mk("X", 95, { approvalRate: 90, completionRate: 80 }),
      mk("W", 95, { approvalRate: 90, completionRate: 80, taskCompletionRate: 10 }),
      mk("V", 95, { approvalRate: 90, completionRate: 80, taskCompletionRate: 10, inspectionScore: 50 }),
      mk("U", 95, { approvalRate: 90, completionRate: 80, taskCompletionRate: 10, inspectionScore: 50 }),
      mk("T", 96),
    ];
    const order = (arr) => [...arr].sort(svc.compareAwc).map((r) => r.awcCode).join("");
    assert.equal(order(rows), "TYUVWXZ");
    assert.equal(order([...rows].reverse()), "TYUVWXZ"); // input order never matters
  });
});

describe("periods", () => {
  it("counts IST working days (Sept 2026 = 26)", () => {
    const r = svc.resolvePeriod({ period: P });
    assert.equal(svc.expectedWorkingDays(r.start, r.end, new Date("2026-10-29T06:00:00Z")), 26);
  });
  it("caps the running month at today", () => {
    const r = svc.resolvePeriod({ period: "2026-10" });
    // Oct 1-8 2026: Thu..Thu, Sunday = Oct 4 -> 7 working days
    assert.equal(svc.expectedWorkingDays(r.start, r.end, new Date("2026-10-08T06:00:00Z")), 7);
  });
  it("month boundaries are IST midnight", () => {
    const r = svc.resolvePeriod({ period: P });
    assert.equal(r.start.toISOString(), "2026-08-31T18:30:00.000Z");
    assert.equal(r.end.toISOString(), "2026-09-30T18:30:00.000Z");
  });
});

// ---------------------------------------------------------------- API
describe("district ranking across ALL sectors (Test 1, 3)", () => {
  it("ranks every sector of the district together, no sector needed", async () => {
    const res = await get(`/api/grades/ranking?period=${P}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const { data } = res.body;
    assert.equal(res.body.success, true);
    assert.equal(data.scope.sectorCode, null);
    assert.deepEqual(data.ranking.map((r) => r.awcCode), [A.a1, A.a5, A.a3, A.a7, A.a2, A.a8, A.a4]);
    assert.deepEqual(data.ranking.map((r) => r.rank), [1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual([...new Set(data.ranking.map((r) => r.sectorCode))].sort(), [S1, S2, S3, S4]);
    assert.ok(!data.ranking.some((r) => r.awcCode === A.a9), "other district must not leak in");
  });

  it("scores come from real data with the documented weights", async () => {
    const { data } = (await get(`/api/grades/ranking?period=${P}`)).body;
    const by = Object.fromEntries(data.ranking.map((r) => [r.awcCode, r]));
    assert.equal(by[A.a1].score, 100);
    assert.equal(by[A.a3].score, 97.33);
    assert.equal(by[A.a7].score, 92.5); // (30*100+25*100+20*100+15*50+10*100)/100
    assert.equal(by[A.a2].score, 82.1);
    assert.equal(by[A.a8].score, 71.69);
    assert.equal(by[A.a4].score, 43.08);
    assert.deepEqual(by[A.a1].counts.totalEntries, 26);
    assert.equal(by[A.a7].metrics.taskCompletionRate, 50); // only the APPROVED submission counts
    assert.equal(by[A.a8].metrics.inspectionScore, 0);
    assert.equal(by[A.a4].metrics.approvalRate, null); // nothing reviewed -> dropped, not zero
    assert.ok(!by[A.a4].metricsUsed.includes("approvalRate"));
    assert.equal(by[A.a1].grade, "A+");
    assert.equal(by[A.a2].grade, "A");
    assert.equal(by[A.a8].grade, "B+");
    assert.equal(by[A.a4].grade, "D");
  });

  it("returns summary + grade distribution and separates AWCs with no entries (Test 9)", async () => {
    const { data } = (await get(`/api/grades/ranking?period=${P}`)).body;
    assert.deepEqual(data.gradeDistribution, { "A+": 4, A: 1, "B+": 1, B: 0, C: 0, D: 1 });
    assert.equal(data.summary.totalAWCs, 7);
    assert.equal(data.summary.totalRegisteredAWCs, 8);
    assert.equal(data.summary.awcsWithoutSubmissions, 1);
    assert.equal(data.summary.aPlus, 4);
    assert.equal(data.summary.averageScore, 83.81);
    assert.ok(!data.ranking.some((r) => r.awcCode === A.a6), "no entries => no fake score/rank");
  });

  it("tie on every metric is stable (Test 4, API)", async () => {
    const first = (await get(`/api/grades/ranking?period=${P}`)).body.data.ranking.map((r) => r.awcCode);
    for (let i = 0; i < 3; i += 1) {
      assert.deepEqual((await get(`/api/grades/ranking?period=${P}`)).body.data.ranking.map((r) => r.awcCode), first);
    }
    assert.deepEqual(first.slice(0, 2), [A.a1, A.a5]);
  });
});

describe("optional filters (Test 2, 7, 10)", () => {
  it("sector filter ranks only that sector, keeping overallRank", async () => {
    const { data } = (await get(`/api/grades/ranking?period=${P}&sectorCode=${S1}`)).body;
    assert.deepEqual(data.ranking.map((r) => [r.awcCode, r.rank, r.overallRank]), [[A.a1, 1, 1], [A.a2, 2, 5]]);
    assert.equal(data.scope.sectorCode, S1);
    assert.equal(data.summary.totalAWCs, 2);
  });
  it("block filter", async () => {
    const { data } = (await get(`/api/grades/ranking?period=${P}&blockCode=${B2}`)).body;
    assert.deepEqual(data.ranking.map((r) => r.awcCode), [A.a5, A.a7, A.a8]);
    assert.deepEqual(data.ranking.map((r) => r.rank), [1, 2, 3]);
  });
  it("grade filter, including a raw unescaped '+' (which URLs decode to a space)", async () => {
    for (const q of ["grade=A%2B", "grade=A+", "grade=a%2b"]) {
      const { data } = (await get(`/api/grades/ranking?period=${P}&${q}`)).body;
      assert.equal(data.ranking.length, 4, q);
      assert.ok(data.ranking.every((r) => r.grade === "A+"));
      assert.deepEqual(data.ranking.map((r) => r.rank), [1, 2, 3, 4]); // ranks are not renumbered by the grade filter
    }
    assert.deepEqual((await get(`/api/grades/ranking?period=${P}&grade=D`)).body.data.ranking.map((r) => r.awcCode), [A.a4]);
  });
  it("filters combine", async () => {
    const { data } = (await get(`/api/grades/ranking?period=${P}&sectorCode=${S4}&grade=A%2B`)).body;
    assert.deepEqual(data.ranking.map((r) => r.awcCode), [A.a7]);
    assert.equal(data.ranking[0].rank, 1); // 1st within sector S4
    assert.equal(data.ranking[0].overallRank, 4);
  });
  it("search by name and code", async () => {
    let r = (await get(`/api/grades/ranking?period=${P}&search=chandpur`)).body.data.ranking;
    assert.deepEqual(r.map((x) => x.awcCode), [A.a1]);
    r = (await get(`/api/grades/ranking?period=${P}&search=${A.a7}`)).body.data.ranking;
    assert.deepEqual(r.map((x) => x.awcCode), [A.a7]);
    r = (await get(`/api/grades/ranking?period=${P}&search=nomatch`)).body.data;
    assert.equal(r.ranking.length, 0);
    assert.equal(r.pagination.total, 0);
  });
});

describe("pagination keeps the GLOBAL rank (Test 6)", () => {
  it("page 2 continues the ranking", async () => {
    const p1 = (await get(`/api/grades/ranking?period=${P}&page=1&limit=3`)).body.data;
    const p2 = (await get(`/api/grades/ranking?period=${P}&page=2&limit=3`)).body.data;
    const p3 = (await get(`/api/grades/ranking?period=${P}&page=3&limit=3`)).body.data;
    assert.deepEqual(p1.ranking.map((r) => r.rank), [1, 2, 3]);
    assert.deepEqual(p2.ranking.map((r) => r.rank), [4, 5, 6]);
    assert.deepEqual(p3.ranking.map((r) => r.rank), [7]);
    assert.deepEqual(p2.pagination, { page: 2, limit: 3, total: 7, totalPages: 3 });
    assert.equal(p2.summary.totalAWCs, 7); // summary is not page-sized
  });
  it("rejects bad pagination", async () => {
    for (const q of ["page=0", "page=abc", "limit=-1", "limit=1000", "limit=1.5"]) {
      assert.equal((await get(`/api/grades/ranking?period=${P}&${q}`)).status, 400, q);
    }
  });
});

describe("hierarchy security (Test 5)", () => {
  it("district user cannot request another district", async () => {
    assert.equal((await get(`/api/grades/ranking?period=${P}&districtCode=99999`)).status, 403);
  });
  it("a different district only ever sees its own AWCs", async () => {
    const { data } = (await get(`/api/grades/ranking?period=${P}`, users.otherDistrict)).body;
    assert.deepEqual(data.ranking.map((r) => r.awcCode), [A.a9]);
  });
  it("block user is limited to their block (ranks inside the block)", async () => {
    const { data } = (await get(`/api/grades/ranking?period=${P}`, users.block1)).body;
    assert.deepEqual(data.ranking.map((r) => r.awcCode), [A.a1, A.a3, A.a2, A.a4]);
    assert.deepEqual(data.ranking.map((r) => r.rank), [1, 2, 3, 4]);
  });
  it("block user cannot reach other blocks or sectors", async () => {
    assert.equal((await get(`/api/grades/ranking?period=${P}&blockCode=${B2}`, users.block1)).status, 403);
    assert.equal((await get(`/api/grades/ranking?period=${P}&sectorCode=${S3}`, users.block1)).status, 404);
  });
  it("sector/supervisor user is limited to their sector", async () => {
    for (const u of [users.sector1, users.supervisor1]) {
      const { data } = (await get(`/api/grades/ranking?period=${P}`, u)).body;
      assert.deepEqual(data.ranking.map((r) => r.awcCode), [A.a1, A.a2]);
      assert.equal((await get(`/api/grades/ranking?period=${P}&sectorCode=${S2}`, u)).status, 403);
    }
  });
  it("is protected: no token -> 401, awc role cannot see the ranking", async () => {
    assert.equal((await request(app).get(`/api/grades/ranking?period=${P}`)).status, 401);
    assert.equal((await get(`/api/grades/ranking?period=${P}`, users.awc1)).status, 403);
    assert.equal((await get(`/api/grades/top?period=${P}`, users.awc1)).status, 403);
  });
  it("unknown sector/block -> 404", async () => {
    assert.equal((await get(`/api/grades/ranking?period=${P}&sectorCode=000`)).status, 404);
    assert.equal((await get(`/api/grades/ranking?period=${P}&blockCode=000`)).status, 404);
  });
  it("sector must belong to block", async () => {
    assert.equal((await get(`/api/grades/ranking?period=${P}&blockCode=${B1}&sectorCode=${S3}`)).status, 400);
  });
});

describe("validation + empty data (Test 9)", () => {
  it("invalid period / grade / range -> 400", async () => {
    for (const q of ["period=2026-13", "period=abc", "period=2026-9", "grade=Z", `period=${P}&fromDate=2026-09-01&toDate=2026-09-30`, "fromDate=2026-09-01", "fromDate=2026-09-30&toDate=2026-09-01", "fromDate=2026-02-30&toDate=2026-03-01"]) {
      const res = await get(`/api/grades/ranking?${q}`);
      assert.equal(res.status, 400, q);
      assert.equal(res.body.success, false);
      assert.ok(!/\n\s+at /.test(JSON.stringify(res.body)) && !res.body.stack, "no stack trace");
    }
  });
  it("a month with no entries gives an empty ranking, not zero-scored AWCs", async () => {
    const { data } = (await get(`/api/grades/ranking?period=2026-01`)).body;
    assert.equal(data.summary.totalAWCs, 0);
    assert.deepEqual(data.ranking, []);
    assert.equal(data.summary.awcsWithoutSubmissions, 8);
    assert.equal(data.summary.averageScore, 0);
  });
  it("period never silently falls back to other months", async () => {
    // entries exist only in 2026-09, so any other month must be empty
    for (const p of ["2026-08", "2026-10"]) {
      assert.equal((await get(`/api/grades/ranking?period=${p}`)).body.data.ranking.length, 0, p);
    }
  });
  it("custom date range works and matches the month", async () => {
    const m = (await get(`/api/grades/ranking?period=${P}`)).body.data;
    const c = (await get(`/api/grades/ranking?fromDate=2026-09-01&toDate=2026-09-30`)).body.data;
    assert.equal(c.periodType, "custom");
    assert.deepEqual(c.ranking.map((r) => [r.awcCode, r.score]), m.ranking.map((r) => [r.awcCode, r.score]));
    const half = (await get(`/api/grades/ranking?fromDate=2026-09-01&toDate=2026-09-07`)).body.data;
    assert.ok(half.ranking.every((r) => r.counts.totalEntries <= 6)); // 6 working days in Sep 1-7
  });
});

describe("top performers + AWC history", () => {
  it("top reuses the ranking", async () => {
    const { data } = (await get(`/api/grades/top?period=${P}&limit=2`)).body;
    assert.deepEqual(data.top.map((t) => [t.rank, t.awcCode, t.score, t.grade, t.sectorName, t.blockName]), [
      [1, A.a1, 100, "A+", "Sector One", "Block One"],
      [2, A.a5, 100, "A+", "Sector Three", "Block Two"],
    ]);
    assert.equal((await get(`/api/grades/top?period=${P}&limit=0`)).status, 400);
    assert.equal((await get(`/api/grades/top?period=${P}&limit=101`)).status, 400);
  });
  it("history gives score, grade, district rank and metrics per month", async () => {
    const { data } = (await get(`/api/grades/awc/${A.a2}?months=3&to=${P}`)).body;
    assert.equal(data.history.length, 3);
    assert.deepEqual(data.history.map((h) => h.period), ["2026-09", "2026-08", "2026-07"]);
    const sep = data.history[0];
    assert.deepEqual([sep.hasData, sep.score, sep.grade, sep.rank, sep.totalRanked], [true, 82.1, "A", 5, 7]);
    assert.equal(sep.metrics.approvalRate, 90);
    assert.equal(data.history[1].hasData, false);
  });
  it("AWC user sees only their own history", async () => {
    assert.equal((await get(`/api/grades/awc/${A.a1}?months=1&to=${P}`, users.awc1)).status, 200);
    assert.equal((await get(`/api/grades/awc/${A.a2}?months=1&to=${P}`, users.awc1)).status, 404);
  });
  it("AWC outside the caller's scope -> 404", async () => {
    assert.equal((await get(`/api/grades/awc/${A.a5}?months=1&to=${P}`, users.sector1)).status, 404);
    assert.equal((await get(`/api/grades/awc/${A.a9}?months=1&to=${P}`)).status, 404);
    assert.equal((await get(`/api/grades/awc/nope`)).status, 404);
  });
});

describe("recalculation (Test 8)", () => {
  it("snapshots match the live ranking, then follow new approved entries", async () => {
    const live = async () => (await get(`/api/grades/ranking?period=${P}`)).body.data.ranking;

    // 1) district-wide recalculation stores one snapshot per ranked AWC
    const res = await request(app).post("/api/grades/recalculate").set(asUser(users.district)).send({ period: P });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.totalRanked, 7);
    let snaps = await Grade.find({ period: P }).sort({ rank: 1 }).lean();
    assert.deepEqual(snaps.map((s) => [s.awcCode, s.rank, s.totalScore, s.grade]), (await live()).map((r) => [r.awcCode, r.rank, r.score, r.grade]));

    // 2) a4 submits the rest of the month and every one is approved -> live rank moves with no manual edit
    const lastBefore = (await live()).find((r) => r.awcCode === A.a4);
    assert.equal(lastBefore.rank, 7);
    await Record.insertMany(recs(A.a4, WORKING_DAYS.slice(10), { attended: 20 }));
    const after = (await live()).find((r) => r.awcCode === A.a4);
    assert.equal(after.rank, 4);
    assert.equal(after.score, 94.87); // (30*100 + 25*100 + 20*80.77)/75
    assert.equal((await Grade.findOne({ awcCode: A.a4, period: P }).lean()).rank, 7); // snapshot is stale until recalculated

    // 3) recalculate just that AWC: its snapshot is refreshed and everyone's stored rank is re-derived
    const grade = await svc.recalculateAWCGrade(A.a4, P);
    assert.equal(grade.totalScore, 94.87);
    assert.equal(grade.rank, 4);
    snaps = await Grade.find({ period: P }).sort({ rank: 1 }).lean();
    assert.deepEqual(snaps.map((s) => [s.awcCode, s.rank]), (await live()).map((r) => [r.awcCode, r.rank]));
    assert.ok(snaps.every((s) => s.totalRanked === 7));

    // 4) stored history reads the snapshot
    const h = (await get(`/api/grades/awc/${A.a4}?months=1&to=${P}&stored=true`)).body.data;
    assert.equal(h.source, "stored");
    assert.deepEqual([h.history[0].score, h.history[0].rank], [94.87, 4]);
  });

  it("recalculating an AWC with no entries removes any stale snapshot", async () => {
    await Grade.create({ districtCode: D, blockCode: B2, sectorCode: S3, awcCode: A.a6, period: P, periodStart: new Date(), periodEnd: new Date(), totalScore: 10, grade: "D", rank: 8 });
    assert.equal(await svc.recalculateAWCGrade(A.a6, P), null);
    assert.equal(await Grade.countDocuments({ awcCode: A.a6, period: P }), 0);
  });

  it("recalculate endpoint validates input and scope", async () => {
    const post = (body, u = users.district) => request(app).post("/api/grades/recalculate").set(asUser(u)).send(body);
    assert.equal((await post({})).status, 400);
    assert.equal((await post({ period: "2026-9" })).status, 400);
    assert.equal((await post({ period: "2026-09", awcCode: A.a5 }, users.sector1)).status, 404);
    assert.equal((await post({ period: "2026-09", awcCode: A.a1 }, users.awc1)).status, 403);
    assert.equal((await post({ period: "2026-09", awcCode: A.a1 }, users.sector1)).status, 200);
  });
});
