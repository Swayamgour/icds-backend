const m = require("mongoose");
module.exports = m.models.Sector || m.model("Sector", new m.Schema({ code: { type: String, unique: true }, name: String, blockCode: String, districtCode: String }));
