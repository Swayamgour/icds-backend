/**
 * Adds the REAL supervisors (Mukhya Sevika list from MS_Details.xlsx) to the database.
 *
 *   npm run seed:supervisors                 -> one supervisor per sector (role "supervisor")
 *   npm run seed:supervisors -- --dry-run    -> show what would happen, write nothing
 *   npm run seed:supervisors -- --role=sector            -> add them as the "sector" (MS) role instead
 *   npm run seed:supervisors -- --reset-passwords        -> set the password again for already-added supervisors
 *   npm run seed:supervisors -- --random-passwords       -> a different random password for each supervisor
 *
 * - Does NOT touch districts / blocks / sectors / AWCs (run `npm run seed` first if the hierarchy is empty).
 * - Safe to run again: supervisors are matched by sector, nothing is duplicated.
 * - A demo supervisor created by `npm run seed` for the same sector is REPLACED by the real one.
 * - A manually created supervisor (different email) is never overwritten - it is reported and skipped.
 * - Every supervisor gets the default password "pass1234" (same as the demo seed). Set
 *   SUPERVISOR_DEFAULT_PASSWORD in .env to use another common password, or run with --random-passwords to give
 *   each supervisor a different one. The login list is written to seed/supervisor-credentials.csv.
 *
 * Login: SUP<sectorCode> (e.g. SUP244450105) or the email, + password (default pass1234).
 */
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ROLES } = require("../config/roles");

const DEMO_DOMAIN = "@dahod-demo.local"; // users created by seed.js - safe to replace
const DEFAULT_PASSWORD = "pass1234"; // same default as the demo seed
const CREDENTIALS_FILE = path.join(__dirname, "supervisor-credentials.csv");

// readable random password: no 0/O/1/l/I look-alikes
function randomPassword(length = 8) {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/**
 * Core logic - models are passed in so it can be tested without a database.
 * Returns { created, replaced, updated, skipped, missingSector, credentials }.
 */
async function seedSupervisors({ User, Sector, data, options = {} }) {
  const role = options.role || ROLES.SUPERVISOR;
  const isSupervisor = role === ROLES.SUPERVISOR;
  const result = { created: 0, replaced: 0, updated: 0, skipped: [], missingSector: [], credentials: [] };

  for (const row of data) {
    const sector = await Sector.findOne({ code: row.sectorCode });
    if (!sector) {
      result.missingSector.push(row.sectorCode);
      continue;
    }

    const email = isSupervisor ? row.email : row.email.replace("supervisor-", "ms-");
    const base = {
      name: row.name,
      email,
      role,
      districtCode: sector.districtCode,
      blockCode: sector.blockCode,
      sectorCode: sector.code,
      ...(isSupervisor ? { supervisorCode: row.supervisorCode } : {}),
      isActive: true,
    };

    const existing = await User.findOne({ role, sectorCode: sector.code });
    const makePassword = () =>
      options.randomPasswords ? randomPassword() : process.env.SUPERVISOR_DEFAULT_PASSWORD || DEFAULT_PASSWORD;
    let password = null;
    let action;

    if (!existing) {
      password = makePassword();
      action = "created";
    } else if (existing.email.endsWith(DEMO_DOMAIN)) {
      password = makePassword(); // replace the demo account with the real person
      action = "replaced";
    } else if (existing.email === email) {
      if (options.resetPasswords) password = makePassword();
      action = "updated";
    } else {
      result.skipped.push({ sectorCode: sector.code, existingEmail: existing.email });
      continue;
    }

    if (options.dryRun) {
      result[action] += 1;
      continue;
    }

    const doc = existing || new User();
    doc.set(base);
    if (password) doc.password = password; // hashed by the User pre-save hook
    await doc.save();

    result[action] += 1;
    if (password) {
      result.credentials.push({
        sectorCode: sector.code,
        sectorName: row.sectorName,
        blockName: row.blockName,
        name: row.name,
        loginCode: isSupervisor ? row.supervisorCode : sector.code,
        email,
        password,
      });
    }
  }
  return result;
}

function writeCredentialsCsv(credentials, file = CREDENTIALS_FILE) {
  const header = ["Block", "Sector", "Sector Code", "Name", "Login Code", "Email", "Password"];
  const lines = credentials.map((c) =>
    [c.blockName, c.sectorName, c.sectorCode, c.name, c.loginCode, c.email, c.password].map(csvCell).join(",")
  );
  // BOM so Excel shows the Gujarati names correctly
  fs.writeFileSync(file, "\uFEFF" + [header.map(csvCell).join(","), ...lines].join("\r\n"), "utf8");
}

async function main() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: args.includes("--dry-run"),
    resetPasswords: args.includes("--reset-passwords"),
    randomPasswords: args.includes("--random-passwords"),
    role: (args.find((a) => a.startsWith("--role=")) || "").split("=")[1] || ROLES.SUPERVISOR,
  };
  if (![ROLES.SUPERVISOR, ROLES.SECTOR].includes(options.role)) {
    console.error('--role must be "supervisor" or "sector"');
    process.exit(1);
  }

  const mongoose = require("mongoose");
  const connectDB = require("../config/db");
  const User = require("../models/User");
  const Sector = require("../models/Sector");
  const data = require("./supervisorData.json");

  await connectDB();
  try {
    console.log(`\nAdding ${data.length} supervisors as role "${options.role}"${options.dryRun ? "  [DRY RUN]" : ""}...`);
    const r = await seedSupervisors({ User, Sector, data, options });

    console.log("\n========================================");
    console.log(`  created : ${r.created}`);
    console.log(`  replaced demo supervisors : ${r.replaced}`);
    console.log(`  updated (already added)   : ${r.updated}`);
    console.log(`  skipped (manual account)  : ${r.skipped.length}`);
    console.log(`  sector not in DB          : ${r.missingSector.length}`);
    console.log("========================================");
    r.skipped.forEach((s) => console.log(`  SKIPPED ${s.sectorCode}: already has ${s.existingEmail}`));
    if (r.missingSector.length) console.log(`  Sectors missing (run "npm run seed" first): ${r.missingSector.join(", ")}`);

    if (!options.dryRun && r.credentials.length) {
      writeCredentialsCsv(r.credentials);
      console.log(`\nLogin list saved to ${CREDENTIALS_FILE} (delete it once shared).`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().then(
    () => process.exit(0),
    (err) => {
      console.error(err);
      process.exit(1);
    }
  );
}

module.exports = { seedSupervisors, writeCredentialsCsv, randomPassword };
