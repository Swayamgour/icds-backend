// Test bootstrap.
//  * Stubs ONLY the project files that are absent from the uploaded ZIP (hierarchy models,
//    TaskSubmission, middleware/auth). If your full project has the real files they are used instead.
//  * Connects mongoose to GRADE_TEST_MONGO_URI (default: local FerretDB/MongoDB on 27017).
//  * Unless GRADE_TEST_REAL_MONGO=1 (a real mongod is available), Model.aggregate() is executed with
//    `mingo`, a JS implementation of the MongoDB aggregation language, over the collection's documents.
const path = require("path");
const fs = require("fs");
const Module = require("module");
const mongoose = require("mongoose");

const ROOT = path.resolve(__dirname, "../..");
const stubs = {
  "models/Awc": "./stubs/Awc",
  "models/Block": "./stubs/Block",
  "models/Sector": "./stubs/Sector",
  "models/District": "./stubs/District",
  "models/TaskSubmission": "./stubs/TaskSubmission",
  "middleware/auth": "./stubs/auth",
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent && parent.filename && parent.filename.startsWith(ROOT) && request.startsWith(".")) {
    const abs = path.resolve(path.dirname(parent.filename), request);
    const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
    if (stubs[rel] && !fs.existsSync(abs + ".js")) {
      return originalLoad.call(this, path.join(__dirname, stubs[rel]), parent, isMain);
    }
  }
  return originalLoad.apply(this, arguments);
};

if (process.env.GRADE_TEST_REAL_MONGO !== "1") {
  const { Aggregator } = require("mingo");
  mongoose.Model.aggregate = async function (pipeline) {
    const docs = await this.find({}).lean();
    return new Aggregator(pipeline).run(docs);
  };
}

const connect = async (dbName) => {
  const base = process.env.GRADE_TEST_MONGO_URI || "mongodb://127.0.0.1:27017";
  await mongoose.connect(`${base}/${dbName}`, { serverSelectionTimeoutMS: 5000 });
  await mongoose.connection.dropDatabase();
};

const disconnect = async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
};

module.exports = { connect, disconnect };
