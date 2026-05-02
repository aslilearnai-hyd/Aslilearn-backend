import mongoose from 'mongoose';

/**
 * One persisted Gemini (or offline-equivalent) performance report per student per exam.
 * Unique on (studentId, examId) — generate once, fetch forever.
 */
const geminiPerformanceReportSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    examId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Exam',
      required: true,
      index: true,
    },
    examName: { type: String, default: '' },
    totalQuestions: { type: Number, default: 0 },
    attemptedQuestions: { type: Number, default: 0 },
    correctAnswers: { type: Number, default: 0 },
    wrongAnswers: { type: Number, default: 0 },
    unattempted: { type: Number, default: 0 },
    totalMarks: { type: Number, default: 0 },
    obtainedMarks: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    overallSummary: { type: String, default: '' },
    subjectAnalysis: { type: mongoose.Schema.Types.Mixed, default: null },
    weakAreas: { type: mongoose.Schema.Types.Mixed, default: null },
    strongAreas: { type: mongoose.Schema.Types.Mixed, default: null },
    conceptualGaps: { type: mongoose.Schema.Types.Mixed, default: null },
    recommendations: { type: mongoose.Schema.Types.Mixed, default: null },
    timeManagementInsights: { type: mongoose.Schema.Types.Mixed, default: null },
    nextExamStrategy: { type: mongoose.Schema.Types.Mixed, default: null },
    finalSummary: { type: String, default: '' },
    /** Raw model output when Gemini succeeds (truncated at save if very long). */
    geminiRawResponse: { type: String, default: '' },
    /** Full API-shaped analysis object returned to clients (summary, questionInsights, …). */
    fullAnalysis: { type: mongoose.Schema.Types.Mixed, required: true },
    meta: {
      weakSubjects: { type: [String], default: [] },
      classNumber: { type: String, default: '' },
      board: { type: String, default: '' },
    },
    generatedBy: {
      type: String,
      enum: ['gemini', 'offline'],
      default: 'offline',
    },
  },
  {
    timestamps: true,
    collection: 'gemini_performance_reports',
  },
);

geminiPerformanceReportSchema.index({ studentId: 1, examId: 1 }, { unique: true });

export default mongoose.model('GeminiPerformanceReport', geminiPerformanceReportSchema);
