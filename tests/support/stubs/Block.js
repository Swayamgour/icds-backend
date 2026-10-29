const m = require("mongoose");
module.exports = m.models.Block || m.model("Block", new m.Schema({ code: { type: String, unique: true }, name: String, districtCode: String }));
