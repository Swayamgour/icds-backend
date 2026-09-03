
require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const connectDB = require("../config/db");

const District = require("../models/District");
const Block = require("../models/Block");
const Sector = require("../models/Sector");
const Awc = require("../models/Awc");
const User = require("../models/User");

const awcData = require("./dahodData.json");

const DISTRICT_CODE = "24445";
const DISTRICT_NAME = "Dahod";

// Every seeded login shares this password
const DEFAULT_PASSWORD = "pass1234";
const SALT_ROUNDS = 10;

// Drops blank rows
const cleanAwcData = awcData.filter(
  (r) =>
    r.awcCode &&
    r.blockCode &&
    r.sectorCode &&
    r.blockName &&
    r.sectorName &&
    r.awcName
);

const slugify = (str) =>
  str
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const seed = async () => {
  try {
    await connectDB();

    console.log("\n========================================");
    console.log("USER MODEL DEBUG");
    console.log("========================================");

    console.log(
      "Model file path:",
      require.resolve("../models/User")
    );

    console.log(
      "Schema has children3To6Y:",
      !!User.schema.paths.children3To6Y
    );

    console.log(
      "User schema paths:",
      Object.keys(User.schema.paths)
    );

    console.log("========================================\n");

    // ==============================================
    // CLEAR EXISTING DATA
    // ==============================================

    console.log("Clearing existing hierarchy + demo users...");

    await Promise.all([
      District.deleteMany({}),
      Block.deleteMany({}),
      Sector.deleteMany({}),
      Awc.deleteMany({}),

      User.deleteMany({
        email: {
          $regex: "@dahod-demo\\.local$",
        },
      }),
    ]);

    // ==============================================
    // DISTRICT
    // ==============================================

    const district = await District.create({
      code: DISTRICT_CODE,
      name: DISTRICT_NAME,
    });

    console.log(
      `District created: ${district.name} (${district.code})`
    );

    // ==============================================
    // DERIVE BLOCKS AND SECTORS
    // ==============================================

    const blockMap = new Map();
    const sectorMap = new Map();

    for (const row of cleanAwcData) {
      if (!blockMap.has(row.blockCode)) {
        blockMap.set(row.blockCode, {
          code: row.blockCode,
          name: row.blockName,
        });
      }

      if (!sectorMap.has(row.sectorCode)) {
        sectorMap.set(row.sectorCode, {
          code: row.sectorCode,
          name: row.sectorName,
          blockCode: row.blockCode,
        });
      }
    }

    // ==============================================
    // BLOCKS
    // ==============================================

    const blockDocs = await Block.insertMany(
      [...blockMap.values()].map((b) => ({
        code: b.code,
        name: b.name,

        districtCode: DISTRICT_CODE,
        districtId: district._id,
      }))
    );

    const blockIdByCode = new Map(
      blockDocs.map((b) => [b.code, b._id])
    );

    console.log(`Blocks created: ${blockDocs.length} `);

    // ==============================================
    // SECTORS
    // ==============================================

    const sectorDocs = await Sector.insertMany(
      [...sectorMap.values()].map((s) => ({
        code: s.code,
        name: s.name,

        blockCode: s.blockCode,
        districtCode: DISTRICT_CODE,

        blockId: blockIdByCode.get(s.blockCode),
      }))
    );

    const sectorIdByCode = new Map(
      sectorDocs.map((s) => [s.code, s._id])
    );

    console.log(`Sectors created: ${sectorDocs.length} `);

    // ==============================================
    // AWCS
    // ==============================================

    const awcDocs = await Awc.insertMany(
      cleanAwcData.map((a) => ({
        code: a.awcCode,
        name: a.awcName,

        sectorCode: a.sectorCode,
        blockCode: a.blockCode,
        districtCode: DISTRICT_CODE,

        sectorId: sectorIdByCode.get(a.sectorCode),

        // 3-6 Years Children Count
        children3To6Y: Number(a.children3To6Y ?? 0),
      }))
    );

    console.log(`AWCs created: ${awcDocs.length} `);

    // ==============================================
    // PASSWORD HASH
    // ==============================================

    const passwordHash = await bcrypt.hash(
      DEFAULT_PASSWORD,
      SALT_ROUNDS
    );

    const users = [];

    // ==============================================
    // DISTRICT USER
    // ==============================================

    users.push({
      name: "District Manager - Dahod",
      email: "district@dahod-demo.local",
      password: passwordHash,

      role: "district",

      districtCode: DISTRICT_CODE,
    });

    // ==============================================
    // BLOCK USERS
    // ==============================================

    for (const b of blockMap.values()) {
      users.push({
        name: `Block CDPO - ${b.name} `,
        email: `block - ${slugify(
          b.code
        )
          } @dahod-demo.local`,

        password: passwordHash,

        role: "block",

        districtCode: DISTRICT_CODE,
        blockCode: b.code,
      });
    }

    // ==============================================
    // SECTOR USERS
    // ==============================================

    for (const s of sectorMap.values()) {
      users.push({
        name: `Sector Supervisor - ${s.name} `,

        email: `sector - ${slugify(
          s.code
        )
          } @dahod-demo.local`,

        password: passwordHash,

        role: "sector",

        districtCode: DISTRICT_CODE,
        blockCode: s.blockCode,
        sectorCode: s.code,
      });
    }

    // ==============================================
    // AWC USERS
    // ==============================================

    console.log("\n========================================");
    console.log("CREATING AWC USERS...");
    console.log("========================================");

    for (const a of cleanAwcData) {
      // Raw value from JSON
      const rawChildren3To6Y = a.children3To6Y;

      // Convert safely to Number
      const children3To6Y = Number(
        rawChildren3To6Y ?? 0
      );

      // ==========================================
      // DEBUG SPECIFIC PATELA AWC
      // ==========================================

      if (String(a.awcCode) === "24445210521") {
        console.log("\n========== PATELA DEBUG ==========");

        console.log("AWC CODE:", a.awcCode);
        console.log("AWC NAME:", a.awcName);

        console.log(
          "RAW children3To6Y:",
          rawChildren3To6Y
        );

        console.log(
          "RAW TYPE:",
          typeof rawChildren3To6Y
        );

        console.log(
          "FINAL children3To6Y:",
          children3To6Y
        );

        console.log("==================================\n");
      }

      users.push({
        name: `AWC Worker - ${a.awcName} `,

        email: `awc - ${slugify(
          a.awcCode
        )
          } @dahod-demo.local`,

        password: passwordHash,

        role: "awc",

        districtCode: DISTRICT_CODE,
        blockCode: a.blockCode,
        sectorCode: a.sectorCode,

        awcCode: a.awcCode,

        // 3-6 Years Children
        children3To6Y: children3To6Y,
      });
    }

    // ==============================================
    // CHECK BEFORE DATABASE INSERT
    // ==============================================

    const patelaUserBeforeInsert = users.find(
      (user) =>
        String(user.awcCode) === "24445210521"
    );

    console.log("\n========================================");
    console.log("PATELA USER BEFORE INSERT:");
    console.log(patelaUserBeforeInsert);

    console.log(
      "children3To6Y BEFORE INSERT:",
      patelaUserBeforeInsert?.children3To6Y
    );

    console.log("========================================\n");

    // ==============================================
    // INSERT USERS
    // ==============================================

    console.log("\n========================================");
    console.log("INSERTING USERS INTO DATABASE...");
    console.log("========================================\n");

    const insertedUsers = await User.insertMany(users);

    console.log(
      `TOTAL USERS INSERTED: ${insertedUsers.length} `
    );

    // ==============================================
    // CHECK INSERTMANY RETURN VALUE
    // ==============================================

    const patelaFromReturn = insertedUsers.find(
      (user) =>
        String(user.awcCode) === "24445210521"
    );

    console.log("\n========================================");
    console.log("PATELA USER FROM INSERTMANY RETURN:");
    console.log(patelaFromReturn);

    console.log(
      "children3To6Y FROM INSERTMANY:",
      patelaFromReturn?.children3To6Y
    );

    console.log("========================================\n");

    // ==============================================
    // FRESH DATABASE QUERY - USER
    // ==============================================

    const patelaFromDB = await User.findOne({
      awcCode: "24445210521",
    }).lean();

    console.log("\n========================================");
    console.log("PATELA USER FROM FRESH DATABASE QUERY:");
    console.log(patelaFromDB);

    console.log(
      "children3To6Y FROM USER DATABASE:",
      patelaFromDB?.children3To6Y
    );

    console.log("========================================\n");

    // ==============================================
    // FRESH DATABASE QUERY - AWC
    // ==============================================

    const patelaAwcFromDB = await Awc.findOne({
      code: "24445210521",
    }).lean();

    console.log("\n========================================");
    console.log("PATELA AWC FROM FRESH DATABASE QUERY:");
    console.log(patelaAwcFromDB);

    console.log(
      "children3To6Y FROM AWC DATABASE:",
      patelaAwcFromDB?.children3To6Y
    );

    console.log("========================================\n");

    // ==============================================
    // USER COUNTS
    // ==============================================

    const counts = users.reduce((acc, u) => {
      acc[u.role] = (acc[u.role] || 0) + 1;
      return acc;
    }, {});

    console.log("\nUsers created:");
    console.log(`  password: ${DEFAULT_PASSWORD} `);
    console.log(`  district: ${counts.district} `);
    console.log(`  block: ${counts.block} `);
    console.log(`  sector: ${counts.sector} `);
    console.log(`  awc: ${counts.awc} `);
    console.log(`  total: ${users.length} `);

    // ==============================================
    // SAMPLE LOGINS
    // ==============================================

    console.log(
      "\nSample logins:\n" +
      `  district @dahod-demo.local\n` +
      `  block - ${slugify(
        blockDocs[0].code
      )
      } @dahod-demo.local\n` +
      `  sector - ${slugify(
        sectorDocs[0].code
      )
      } @dahod-demo.local\n` +
      `  awc - ${slugify(
        cleanAwcData[0].awcCode
      )
      } @dahod-demo.local\n`
    );

    console.log("\n========================================");
    console.log("SEED COMPLETE");
    console.log("========================================\n");

    await mongoose.disconnect();

    process.exit(0);

  } catch (error) {

    console.error("\n========================================");
    console.error("SEED FAILED");
    console.error("========================================");

    console.error(error);

    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      console.error(
        "Disconnect error:",
        disconnectError
      );
    }

    process.exit(1);
  }
};

seed();

