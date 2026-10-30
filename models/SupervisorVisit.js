const mongoose = require("mongoose");
const { submissionFields, photoProofSchema } = require("./shared/submissionFields");

// =====================================================================
// SUPERVISOR VISIT / INSPECTION FORM
// One document = one inspection of ONE Anganwadi by the sector's supervisor.
// The form has 4 sections that are saved/submitted one at a time
// (General, Section A, Section B, Section C) - exactly like the app's
// "Fill Form" screen where each section shows Completed + submitted time.
// Question numbers (Q5, Q14 ...) in comments are the ORIGINAL mobile-app numbers; the web form
// renumbers questions continuously (see supervisorVisitConfig.js).
// =====================================================================

const monthYear = new mongoose.Schema(
  {
    month: { type: Number, min: 1, max: 12 }, // 1 = January
    year: { type: Number, min: 2000, max: 2100 },
  },
  { _id: false }
);

const num = { type: Number, min: 0 };

// One stock row: total beneficiaries / balance stock / demand are normally
// pre-filled by the app (read-only); "found" is what the supervisor actually
// counted at the visit.
const stockLine = new mongoose.Schema(
  {
    totalBeneficiaries: num, // કુલ લાભાર્થી
    balanceStock: num, // બચત જથ્થો
    demand: num, // ડીમાન્ડ
    found: num, // હાલમાં જોવા મળેલ
  },
  { _id: false }
);

const hcmStockLine = new mongoose.Schema(
  {
    item: { type: String, required: true }, // e.g. "fortifiedFlour", "rice", ...
    totalBeneficiaries: num,
    balanceStock: num,
    demand: num,
    found: num, // in kg
  },
  { _id: false }
);

const equipmentStatus = {
  type: String,
  enum: ["working", "not_working", "not_available"], // ઉપલબ્ધ છે અને ચાલુ / બંધ / ઉપલબ્ધ નથી
};
const quality3 = { type: String, enum: ["good", "average", "poor"] }; // સારું / સરેરાશ / નબળું

const sectionMeta = new mongoose.Schema(
  {
    completed: { type: Boolean, default: false },
    submittedAt: { type: Date },
  },
  { _id: false }
);

// ---------------- General Section ----------------
const generalSchema = new mongoose.Schema(
  {
    visitDate: { type: Date }, // Q1 આંગણવાડી કેન્દ્ર મુલાકાત કર્યાની તારીખ (also copied to the visit's top-level date)
    centerOpen: Boolean, // Q2 આંગણવાડી કેન્દ્ર ખુલ્લું છે?
    arrivalTime: { type: String }, // Q4 આંગણવાડીમાં આવવાનો સમય "HH:mm"
    arrivalPhoto: { type: photoProofSchema }, // optional (not seen in the screenshots - mirrors the leaving photo)
    extra: { type: mongoose.Schema.Types.Mixed }, // any further general-section fields (e.g. Q3)
  },
  { _id: false }
);

// ---------------- Section A ----------------
const sectionASchema = new mongoose.Schema(
  {
    // 2. બાંધકામની સ્થિતિ (Building condition)
    building: {
      ownership: { type: String }, // Q5 આંગણવાડી કોના મકાનમાં ચાલે છે (e.g. "own", "rented", ...)
      rentPaidTill: { type: monthYear }, // Q6
      isDilapidated: Boolean, // Q7
      repairNeeded: Boolean, // Q8
      repairType: { type: String, trim: true }, // follow-up of repairNeeded - what kind of repairing (only when repairNeeded = true)
      upgradationNeeded: Boolean, // Q9
      upgradationReason: { type: String, trim: true }, // follow-up of upgradationNeeded - reason / type of renovation (only when upgradationNeeded = true)
      toiletWorking: Boolean, // Q10
      drinkingWater: Boolean, // Q11
      electricity: Boolean, // Q12
      compoundWall: Boolean, // Q13
    },

    // 3. પૂરક પોષણ (Supplementary nutrition)
    supplementaryNutrition: {
      registeredChildren3To6: num, // Q14 નોંધાયેલ બાળકો
      presentChildren: num, // Q14 હાજર બાળકો
      hotBreakfastAsPerMenu: Boolean, // Q15
      hcmLocalPurchasePaidTill: { type: monthYear }, // Q16
      gasBillPaidTill: { type: monthYear }, // Q17
      purnaRegisteredGirls15To18: num, // Q18
      purnaGirlsTookThr: num, // Q19
      thrReceivedThisMonth: Boolean, // Q20
      thrDistributionComplete: Boolean, // Q21
      // Q22 THR stock (packets)
      thrStock: {
        balshakti: { type: stockLine }, // બાલશક્તિ
        matrushakti: { type: stockLine }, // માતૃશક્તિ
        purnashakti: { type: stockLine }, // પૂર્ણાશક્તિ
      },
      // Q23 HCM stock (kg). Items seen so far: fortifiedFlour (ફોર્ટીફાઈડ આટા), rice (ચોખા), oil (તેલ)
      hcmStock: { type: [hcmStockLine], default: undefined },
    },

    extra: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

// ---------------- Section B (Milk Sanjivani) ----------------
const beneficiaryCounts = new mongoose.Schema(
  {
    pregnantLactating: num, // સગર્ભા અને ધાત્રી
    children7mTo3y: num, // ૭ માસથી ૩ વર્ષનાં બાળકો
    children3To6y: num, // ૩ વર્ષથી ૬ વર્ષનાં બાળકો
  },
  { _id: false }
);

const sectionBSchema = new mongoose.Schema(
  {
    // 4. પોષણ સુધા (Poshan Sudha)
    poshanSudha: {
      registeredBeneficiaries: num, // Q24 નોંધાયેલ લાભાર્થી
      presentBeneficiaries: num, // Q24 હાજર રહેલ લાભાર્થી
      psyMealAsPerMenu: Boolean, // Q25 PSY - mothers' meal as per menu
      localPurchaseBillsPaidTill: { type: monthYear }, // Q26
      dailyAttendanceFilled: Boolean, // Q27 daily attendance filled in the Poshan Sudha app
    },

    // 5. દૂધ સંજીવની (Milk Sanjivani)
    milkReceivedToday: Boolean, // Q28 આજે દૂધ મેળવ્યું
    milkPacketsDemanded: num, // Q29
    milkPacketsReceived: num, // Q29
    milkDemandFrequency: { type: String }, // Q30 e.g. "weekly"
    registeredBeneficiaries: { type: beneficiaryCounts }, // Q31 નોંધાયેલ
    beneficiariesServedInPresence: { type: beneficiaryCounts }, // Q31 આપની હાજરીમાં દૂધ આપવામાં આવેલ
    milkReceivedInInsulatedBox: Boolean, // Q32
    extra: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

// ---------------- Section C ----------------
const sectionCSchema = new mongoose.Schema(
  {
    // 6. પૂર્વ પ્રાથમિક શિક્ષણ (Pre-primary education)
    preSchool: {
      kitUsed: Boolean, // Q33 pre-school kit used for pre-primary activities
      activitiesAsPerThemeTimetable: Boolean, // Q34
      childDetailsAndPlayActivities: Boolean, // Q35 names/age/DOB/gender, play-based part 1,2 & chitrapothi done
      vikasyatraFilledMonth: { type: String }, // Q36 month in which "Mari Vikasyatra" of all 3-6y children is filled (e.g. "September")
    },

    childDevelopmentDataCorrect: Boolean, // Q37
    portfoliosProper: Boolean, // Q38
    hasWhatsappGroup: Boolean, // Q39
    whatsappSharedItems: {
      type: [
        {
          type: String,
          enum: ["monthlyCalendar", "setcomInfo", "digitalCalendar", "balDiwasCelebration", "dailyActivityPhotos"],
        },
      ],
      default: undefined,
    },

    // Q40 મંગળદિવસની ઉજવણી - are the four Tuesday celebrations held?
    mangalDivas: {
      suposhanSamvad: Boolean,
      baltulaDivas: Boolean,
      annaprashanBalDivas: Boolean,
      annaVitaranDivas: Boolean,
    },

    // Q41 7. પોષણ અભિયાન - growth measuring equipment
    growthEquipment: {
      infantometer: equipmentStatus,
      salterScale: equipmentStatus,
      stadiometer: equipmentStatus,
      weighingScale: equipmentStatus,
    },
    adolescentWeightHeightDone: Boolean, // Q42
    // Photo taken while measuring a child's height & weight, with the child's name
    heightWeightCheck: {
      childName: { type: String },
      heightCm: num,
      weightKg: num,
      photo: { type: photoProofSchema },
    },
    bmiAwareness: Boolean, // Q43

    // અવલોકન (Observation)
    observation: {
      anganwadiClean: Boolean, // Q44
      surroundingsClean: Boolean, // Q45 inside/outside
      hotBreakfastQuality: quality3, // Q46
      workerKnowledge: quality3, // Q47
      anganwadiRanking: { type: String, enum: ["A", "B", "C", "D"] }, // Q48 Very Good / Good / Average / Poor
    },

    remarks: { type: String }, // Q49 (optional)
    mealPlatePhoto: { type: photoProofSchema }, // Q50 HCM / PSY meal plate photo
    leavingTime: { type: String }, // Q51 "HH:mm"
    leavingPhoto: { type: photoProofSchema }, // Q51

    extra: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

// =====================================================================

const supervisorVisitSchema = new mongoose.Schema(
  {
    // scope
    districtCode: { type: String, required: true, index: true },
    blockCode: { type: String, required: true, index: true },
    sectorCode: { type: String, required: true, index: true },
    awcCode: { type: String, required: true, index: true },

    blockName: String,
    sectorName: String,
    awcName: String,
    supervisorName: String,

    date: { type: Date, required: true, default: Date.now, index: true },

    general: { type: generalSchema, default: () => ({}) },
    sectionA: { type: sectionASchema, default: () => ({}) },
    sectionB: { type: sectionBSchema, default: () => ({}) },
    sectionC: { type: sectionCSchema, default: () => ({}) },

    // per-section "Completed / Submitted on" (drives the Fill Form screen)
    sectionStatus: {
      general: { type: sectionMeta, default: () => ({}) },
      sectionA: { type: sectionMeta, default: () => ({}) },
      sectionB: { type: sectionMeta, default: () => ({}) },
      sectionC: { type: sectionMeta, default: () => ({}) },
    },

    // draft until all 4 sections are completed, then submitted for review
    formStatus: { type: String, enum: ["draft", "submitted"], default: "draft", index: true },
    submittedAt: { type: Date },

    // GPS check-in/out + approve/reject workflow (status: pending/approved/rejected)
    ...submissionFields,

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  },
  { timestamps: true }
);

supervisorVisitSchema.index({ awcCode: 1, date: -1 });
supervisorVisitSchema.index({ districtCode: 1, date: 1 }, { name: "district_date" }); // grading/ranking period queries

module.exports = mongoose.model("SupervisorVisit", supervisorVisitSchema);