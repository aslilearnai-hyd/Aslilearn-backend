import mongoose from 'mongoose';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const timetableSchema = new mongoose.Schema(
  {
    schoolAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    date: { type: Date, required: true },
    day: { type: String, trim: true },
    startTime: { type: String, required: true, trim: true },
    endTime: { type: String, required: true, trim: true },
    durationMinutes: { type: Number, default: 0 },

    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
      required: true,
    },
    sectionId: { type: String, trim: true, uppercase: true },
    subjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
      required: true,
    },
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Teacher',
      required: true,
    },

    room: { type: String, trim: true, default: '' },
    building: { type: String, trim: true, default: '' },

    repeatRule: {
      type: String,
      enum: ['none', 'daily', 'weekly', 'monthly'],
      default: 'none',
    },
    repeatGroupId: { type: String, index: true },
    effectiveFrom: { type: Date },
    effectiveTo: { type: Date },

    sessionType: {
      type: String,
      enum: ['Lecture', 'Lab', 'Exam', 'Workshop', 'Activity', 'Holiday', 'Special Class'],
      default: 'Lecture',
    },

    attendanceRequired: { type: Boolean, default: true },
    expectedStudents: { type: Number },
    capacity: { type: Number },

    status: {
      type: String,
      enum: ['Scheduled', 'Completed', 'Cancelled'],
      default: 'Scheduled',
    },
    priority: { type: Number, default: 0 },
    notes: { type: String, trim: true, default: '' },
    colorTag: { type: String, trim: true, default: '' },
    attachment: { type: String, trim: true, default: '' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

timetableSchema.index({ schoolAdminId: 1, date: 1, startTime: 1 });
timetableSchema.index({ teacherId: 1, date: 1 });
timetableSchema.index({ classId: 1, date: 1 });
timetableSchema.index({ room: 1, date: 1, startTime: 1 });

function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

timetableSchema.pre('save', function preSave(next) {
  const start = parseTimeToMinutes(this.startTime);
  const end = parseTimeToMinutes(this.endTime);
  this.durationMinutes = Math.max(0, end - start);

  if (this.date) {
    const d = new Date(this.date);
    if (!this.day) {
      this.day = DAY_NAMES[d.getDay()] || '';
    }
    this.date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }
  next();
});

export default mongoose.model('Timetable', timetableSchema);
export { parseTimeToMinutes, DAY_NAMES };
