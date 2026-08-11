const { ROLES } = require("../config/roles");

/**
 * Builds a MongoDB filter based on the logged-in user's role + codes.
 * This is what enforces "role X can only see its own branch of the tree".
 *
 *   district -> sees everything under districtCode           (all blocks/sectors/awcs)
 *   block    -> sees everything under blockCode              (own block's sectors/awcs)
 *   sector   -> sees everything under sectorCode              (own sector's awcs)
 *   awc      -> sees only its own awcCode                     (own data only)
 *
 * Attaches the filter to req.scopeFilter so any controller can just do
 * Model.find(req.scopeFilter) and get correctly scoped data automatically.
 */
const buildScopeFilter = (req, res, next) => {
  const { role, districtCode, blockCode, sectorCode, awcCode } = req.user;

  let filter = {};

  switch (role) {
    case ROLES.DISTRICT:
      filter = { districtCode };
      break;
    case ROLES.BLOCK:
      filter = { districtCode, blockCode };
      break;
    case ROLES.SECTOR:
      filter = { districtCode, blockCode, sectorCode };
      break;
    case ROLES.AWC:
      filter = { districtCode, blockCode, sectorCode, awcCode };
      break;
    default:
      filter = { _id: null }; // unknown role -> sees nothing
  }

  req.scopeFilter = filter;
  next();
};

module.exports = buildScopeFilter;
