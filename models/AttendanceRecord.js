import mongoose from 'mongoose';

/**
 * Teacher-marked class attendance (new collection only — never deletes existing user/school data).
 */
const attendanceEntrySchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['present', 'absent', 'late'],
      required: true,
    },
  },
  { _id: false },
);

const attendanceRecordSchema = new mongoose.Schema(
  {
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true, index: true },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', index: true },
    date: { type: String, required: true, index: true }, // YYYY-MM-DD
    entries: { type: [attendanceEntrySchema], default: [] },
    presentCount: { type: Number, default: 0 },
    absentCount: { type: Number, default: 0 },
    lateCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

attendanceRecordSchema.index({ teacherId: 1, date: -1 });
attendanceRecordSchema.index({ teacherId: 1, classId: 1, date: 1 }, { unique: true, sparse: true });

export default mongoose.models.AttendanceRecord ||
  mongoose.model('AttendanceRecord', attendanceRecordSchema);
