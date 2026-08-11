// Fixed 4-level hierarchy, top to bottom
const ROLES = {
  DISTRICT: "district", // PO / DDO - sees everything
  BLOCK: "block", // CDPO - sees own block + its sectors + its AWCs
  SECTOR: "sector", // MS / Supervisor - sees own sector + its AWCs
  AWC: "awc", // Worker - sees only own AWC data
};

// Order matters - index 0 is topmost. Used for permission comparisons.
const ROLE_ORDER = [ROLES.DISTRICT, ROLES.BLOCK, ROLES.SECTOR, ROLES.AWC];

module.exports = { ROLES, ROLE_ORDER };
