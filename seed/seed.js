require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs"); // swap for require("bcrypt") if that's what User.js uses
const connectDB = require("../config/db");

const District = require("../models/District");
const Block = require("../models/Block");
const Sector = require("../models/Sector");
const Awc = require("../models/Awc");
const User = require("../models/User");

const awcData = require("../data/dahodAwcData.json");

const DISTRICT_CODE = "24445";
const DISTRICT_NAME = "Dahod";

// Every seeded login (district/block/sector/awc) shares this password.
// Change it after first login in production.
const DEFAULT_PASSWORD = "Pass1234";
const SALT_ROUNDS = 10;

// Drops the 1 blank row present in the source sheet (no block/sector/awc code)
const cleanAwcData = awcData.filter(
  (r) => r.awcCode && r.blockCode && r.sectorCode && r.blockName && r.sectorName && r.awcName
);

const slugify = (str) =>
  str
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const seed = async () => {
  await connectDB();

  console.log("Clearing existing hierarchy + demo users...");
  await Promise.all([
    District.deleteMany({}),
    Block.deleteMany({}),
    Sector.deleteMany({}),
    Awc.deleteMany({}),
    User.deleteMany({ email: { $regex: "@dahod-demo\\.local$" } }),
  ]);

  // ---------- District ----------
  const district = await District.create({ code: DISTRICT_CODE, name: DISTRICT_NAME });
  console.log(`District created: ${district.name} (${district.code})`);

  // ---------- Derive unique Blocks and Sectors from the AWC sheet ----------
  const blockMap = new Map(); // blockCode -> { code, name }
  const sectorMap = new Map(); // sectorCode -> { code, name, blockCode }

  for (const row of cleanAwcData) {
    if (!blockMap.has(row.blockCode)) {
      blockMap.set(row.blockCode, { code: row.blockCode, name: row.blockName });
    }
    if (!sectorMap.has(row.sectorCode)) {
      sectorMap.set(row.sectorCode, { code: row.sectorCode, name: row.sectorName, blockCode: row.blockCode });
    }
  }

  // ---------- Blocks ----------
  const blockDocs = await Block.insertMany(
    [...blockMap.values()].map((b) => ({
      code: b.code,
      name: b.name,
      districtCode: DISTRICT_CODE,
      districtId: district._id,
    }))
  );
  const blockIdByCode = new Map(blockDocs.map((b) => [b.code, b._id]));
  console.log(`Blocks created: ${blockDocs.length}`);

  // ---------- Sectors ----------
  const sectorDocs = await Sector.insertMany(
    [...sectorMap.values()].map((s) => ({
      code: s.code,
      name: s.name,
      blockCode: s.blockCode,
      districtCode: DISTRICT_CODE,
      blockId: blockIdByCode.get(s.blockCode),
    }))
  );
  const sectorIdByCode = new Map(sectorDocs.map((s) => [s.code, s._id]));
  console.log(`Sectors created: ${sectorDocs.length}`);

  // ---------- AWCs ----------
  const awcDocs = await Awc.insertMany(
    cleanAwcData.map((a) => ({
      code: a.awcCode,
      name: a.awcName,
      sectorCode: a.sectorCode,
      blockCode: a.blockCode,
      districtCode: DISTRICT_CODE,
      sectorId: sectorIdByCode.get(a.sectorCode),
    }))
  );
  console.log(`AWCs created: ${awcDocs.length}`);

  // ---------- Users: 1 District login + 1 login per Block + 1 login per Sector + 1 login per AWC ----------
  // Password is hashed ONCE and reused across every user document, then written
  // with insertMany. Looping User.create() ~3200 times would re-run bcrypt's
  // pre-save hook 3200 times and take several minutes; this takes seconds.
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, SALT_ROUNDS);

  const users = [];

  // District
  users.push({
    name: "District Manager - Dahod",
    email: "district@dahod-demo.local",
    password: passwordHash,
    role: "district",
    districtCode: DISTRICT_CODE,
  });

  // One CDPO login per Block (21 blocks)
  for (const b of blockMap.values()) {
    users.push({
      name: `Block CDPO - ${b.name}`,
      email: `block-${slugify(b.code)}@dahod-demo.local`,
      password: passwordHash,
      role: "block",
      districtCode: DISTRICT_CODE,
      blockCode: b.code,
    });
  }

  // One Mukhya Sevika login per Sector (122 sectors)
  for (const s of sectorMap.values()) {
    users.push({
      name: `Sector Supervisor - ${s.name}`,
      email: `sector-${slugify(s.code)}@dahod-demo.local`,
      password: passwordHash,
      role: "sector",
      districtCode: DISTRICT_CODE,
      blockCode: s.blockCode,
      sectorCode: s.code,
    });
  }

  // One Worker login per AWC (~3046 AWCs) — awcCode is stored on the user so
  // it can double as a login identifier (see note below).
  for (const a of cleanAwcData) {
    users.push({
      name: `AWC Worker - ${a.awcName}`,
      email: `awc-${slugify(a.awcCode)}@dahod-demo.local`,
      password: passwordHash,
      role: "awc",
      districtCode: DISTRICT_CODE,
      blockCode: a.blockCode,
      sectorCode: a.sectorCode,
      awcCode: a.awcCode,
    });
  }

  await User.insertMany(users);

  const counts = users.reduce((acc, u) => {
    acc[u.role] = (acc[u.role] || 0) + 1;
    return acc;
  }, {});

  console.log("\nUsers created (all share the same password):");
  console.log(`  password: ${DEFAULT_PASSWORD}`);
  console.log(`  district : ${counts.district}`);
  console.log(`  block    : ${counts.block}`);
  console.log(`  sector   : ${counts.sector}`);
  console.log(`  awc      : ${counts.awc}`);
  console.log(`  total    : ${users.length}`);

  console.log(
    "\nSample logins:\n" +
      `  district@dahod-demo.local\n` +
      `  block-${slugify(blockDocs[0].code)}@dahod-demo.local\n` +
      `  sector-${slugify(sectorDocs[0].code)}@dahod-demo.local\n` +
      `  awc-${slugify(cleanAwcData[0].awcCode)}@dahod-demo.local  (awcCode: ${cleanAwcData[0].awcCode})`
  );

  console.log("\nSeed complete.");
  await mongoose.disconnect();
  process.exit(0);
};

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});