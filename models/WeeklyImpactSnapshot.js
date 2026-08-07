import mongoose from 'mongoose';

/**
 * One document per school (admin) per ISO week — School Impact Snapshot.
 */
const teacherRowSchema = new mongoose.Schema(
  {
    teacherId: { type: mongoose.Schema.Types.ObjectId },
    name: { type: String, default: '' },
    email: { type: String, default: '' },
    status: { type: String, enum: ['active', 'occasional', 'inactive'], default: 'inactive' },
    totalLoginsApprox: { type: Number, default: 0 },
    activeDays: { type: Number, default: 0 },
    generationsCreated: { type: Number, default: 0 },
    lastActiveAt: { type: Date },
  },
  { _id: false },
);

const subjectRowSchema = new mongoose.Schema(
  {
    subject: { type: String, default: '' },
    sessions: { type: Number, default: 0 },
    pct: { type: Number, default: 0 },
  },
  { _id: false },
);

const weeklyImpactSnapshotSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    schoolName: { type: String, default: '' },
    schoolEmail: { type: String, default: '' },
    location: { type: String, default: '' },
    weekStart: { type: Date, required: true, index: true },
    weekEnd: { type: Date, required: true },
    periodLabel: { type: String, default: '' },

    freeTeacherLicenses: { type: Number, default: 0 },
    teachersIssued: { type: Number, default: 0 },
    teachersLoggedIn: { type: Number, default: 0 },
    teachersActive: { type: Number, default: 0 },
    teachersOccasional: { type: Number, default: 0 },
    teachersInactive: { type: Number, default: 0 },

    studentsIssued: { type: Number, default: 0 },
    studentsAccessed: { type: Number, default: 0 },
    studentsActive3Plus: { type: Number, default: 0 },
    totalLearningSessions: { type: Number, default: 0 },
    totalMinutesSpent: { type: Number, default: 0 },
    avgSessionsPerActiveStudent: { type: Number, default: 0 },
    repeatPracticeStudentPct: { type: Number, default: 0 },
    aiExplanationsCount: { type: Number, default: 0 },
    practiceAttempts: { type: Number, default: 0 },
    practiceCorrectRate: { type: Number, default: 0 },
    videosWatchedCount: { type: Number, default: 0 },
    studentsWatchedVideos: { type: Number, default: 0 },
    examAttemptsCount: { type: Number, default: 0 },
    studentsTookExams: { type: Number, default: 0 },
    homeworkSubmissions: { type: Number, default: 0 },
    iqQuizAttempts: { type: Number, default: 0 },
    contentProgressTouches: { type: Number, default: 0 },

    topSubjects: { type: [subjectRowSchema], default: [] },
    teachers: { type: [teacherRowSchema], default: [] },

    keyObservation: { type: String, default: '' },
    generatedAt: { type: Date, default: Date.now },
    source: { type: String, enum: ['cron', 'manual', 'api'], default: 'api' },
  },
  { timestamps: true },
);

weeklyImpactSnapshotSchema.index({ adminId: 1, weekStart: -1 }, { unique: true });

export default mongoose.models.WeeklyImpactSnapshot ||
  mongoose.model('WeeklyImpactSnapshot', weeklyImpactSnapshotSchema);
