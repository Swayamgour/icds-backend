require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");

const District = require("../models/District");
const Block = require("../models/Block");
const Sector = require("../models/Sector");
const Awc = require("../models/Awc");
const User = require("../models/User");

const awcData = require("../data/dahodAwcData.json");

const DISTRICT_CODE = "24445";
const DISTRICT_NAME = "Dahod";

// Default login for every seeded demo user. Change after first login in production.
const DEFAULT_PASSWORD = "Password@123";

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

  for (const row of awcData) {
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
    awcData.map((a) => ({
      code: a.awcCode,
      name: a.awcName,
      sectorCode: a.sectorCode,
      blockCode: a.blockCode,
      districtCode: DISTRICT_CODE,
      sectorId: sectorIdByCode.get(a.sectorCode),
    }))
  );
  console.log(`AWCs created: ${awcDocs.length}`);

  // ---------- One demo user per role ----------
  // Picks the first block/sector/awc from the sheet so the demo users are
  // guaranteed to reference real, existing hierarchy entries.
  const firstAwc = awcData[0]; // has blockCode, sectorCode, awcCode all consistent

  const demoUsers = [
    {
      name: "Demo District Manager",
      email: "district@dahod-demo.local",
      password: DEFAULT_PASSWORD,
      role: "district",
      districtCode: DISTRICT_CODE,
    },
    {
      name: "Demo Block CDPO",
      email: "block@dahod-demo.local",
      password: DEFAULT_PASSWORD,
      role: "block",
      districtCode: DISTRICT_CODE,
      blockCode: firstAwc.blockCode,
    },
    {
      name: "Demo Sector Mukhya Sevika",
      email: "sector@dahod-demo.local",
      password: DEFAULT_PASSWORD,
      role: "sector",
      districtCode: DISTRICT_CODE,
      blockCode: firstAwc.blockCode,
      sectorCode: firstAwc.sectorCode,
    },
    {
      name: "Demo AWC Worker",
      email: "awc@dahod-demo.local",
      password: DEFAULT_PASSWORD,
      role: "awc",
      districtCode: DISTRICT_CODE,
      blockCode: firstAwc.blockCode,
      sectorCode: firstAwc.sectorCode,
      awcCode: firstAwc.awcCode,
    },
  ];

  // Created one by one (not insertMany) so the User model's pre-save password hash runs
  for (const u of demoUsers) {
    await User.create(u);
  }

  console.log("\nDemo users created (all share the same password):");
  console.log(`  password: ${DEFAULT_PASSWORD}`);
  demoUsers.forEach((u) => console.log(`  ${u.role.padEnd(8)} -> ${u.email}`));

  console.log(
    `\nDemo AWC user's location: Block ${firstAwc.blockName} (${firstAwc.blockCode}) > Sector ${firstAwc.sectorName} (${firstAwc.sectorCode}) > AWC ${firstAwc.awcName} (${firstAwc.awcCode})`
  );

  console.log("\nSeed complete.");
  await mongoose.disconnect();
  process.exit(0);
};

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
