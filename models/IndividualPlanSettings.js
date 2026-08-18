import mongoose from 'mongoose';

const numberOrNull = {
  type: Number,
  default: null,
  min: 0,
};

const individualPlanSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'individual', unique: true },
    studentBoardMonth: { type: Number, default: 99, min: 0 },
    studentIitMonth: { type: Number, default: 249, min: 0 },
    studentBothMonth: numberOrNull,
    studentBoardYear: numberOrNull,
    studentIitYear: numberOrNull,
    studentBothYear: numberOrNull,
    studentYearlyDiscountPercent: { type: Number, default: 0, min: 0, max: 90 },
    teacherBoardMonth: { type: Number, default: 99, min: 0 },
    teacherBoardYear: numberOrNull,
    teacherIitYear: { type: Number, default: 3999, min: 0 },
    teacherBothYear: numberOrNull,
    teacherYearlyDiscountPercent: { type: Number, default: 0, min: 0, max: 90 },
    updatedBy: { type: String, default: '' },
  },
  { timestamps: true },
);

export default mongoose.model('IndividualPlanSettings', individualPlanSettingsSchema);
