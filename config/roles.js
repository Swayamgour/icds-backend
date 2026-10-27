// Fixed 5-level hierarchy, top to bottom
const ROLES = {
  DISTRICT: "district", // PO / DDO - sees everything
  BLOCK: "block", // CDPO - sees own block + its sectors + its AWCs
  SUPERVISOR: "supervisor", // exactly 1 per sector - oversees the whole sector (incl. its Mukhya Sevika)
  SECTOR: "sector", // MS (Mukhya Sevika) - sees own sector + its AWCs
  AWC: "awc", // Worker - sees only own AWC data
};

// Order matters - index 0 is topmost. Used for permission comparisons
// (a role can only create / assign tasks to / review roles BELOW it).
const ROLE_ORDER = [ROLES.DISTRICT, ROLES.BLOCK, ROLES.SUPERVISOR, ROLES.SECTOR, ROLES.AWC];

module.exports = { ROLES, ROLE_ORDER };
