import mongoose from 'mongoose';

const subjectScoreSchema = new mongoose.Schema(
  {
    r: { type: Number, default: 0 },
    w: { type: Number, default: 0 },
    l: { type: Number, default: 0 },
    marks: { type: Number, default: 0 },
  },
  { _id: false },
);

const omrResultRowSchema = new mongoose.Schema(
  {
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OmrResultBatch',
      required: true,
      index: true,
    },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    candidateId: { type: String, trim: true, required: true, index: true },
    candidateName: { type: String, trim: true, default: '' },
    fatherName: { type: String, trim: true, default: '' },
    group: { type: String, trim: true, default: '' },
    other: { type: String, trim: true, default: '' },
    maths: { type: subjectScoreSchema, default: () => ({}) },
    physics: { type: subjectScoreSchema, default: () => ({}) },
    chemistry: { type: subjectScoreSchema, default: () => ({}) },
    biology: { type: subjectScoreSchema, default: () => ({}) },
    totalQuestions: { type: Number, default: 0 },
    attempted: { type: Number, default: 0 },
    correct: { type: Number, default: 0 },
    wrong: { type: Number, default: 0 },
    left: { type: Number, default: 0 },
    rightPct: { type: Number, default: 0 },
    wrongPct: { type: Number, default: 0 },
    totalMarks: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    testRank: { type: Number, default: null },
    finalRank: { type: Number, default: null },
    groupRank: { type: Number, default: null },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    assignedAt: { type: Date, default: null },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

omrResultRowSchema.index({ batchId: 1, candidateId: 1 }, { unique: true });
omrResultRowSchema.index({ adminId: 1, userId: 1 });
omrResultRowSchema.index({ adminId: 1, batchId: 1 });

const OmrResultRow =
  mongoose.models.OmrResultRow || mongoose.model('OmrResultRow', omrResultRowSchema);

export default OmrResultRow;
