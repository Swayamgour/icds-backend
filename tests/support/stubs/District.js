const m = require("mongoose");
module.exports = m.models.District || m.model("District", new m.Schema({ code: { type: String, unique: true }, name: String }));
