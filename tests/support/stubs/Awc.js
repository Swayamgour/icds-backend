const m = require("mongoose");
module.exports = m.models.Awc || m.model("Awc", new m.Schema({ code: { type: String, unique: true }, name: String, sectorCode: String, blockCode: String, districtCode: String }));
