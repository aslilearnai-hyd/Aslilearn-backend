import mongoose from 'mongoose';

/** Daily work log written by teachers; visible to their students (same school/class) and school admin */
const teacherWorkDiarySchema = new mongoose.Schema(
  {
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Teacher',
      required: true,
      index: true,
    },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
      index: true,
    },
    /** Denormalized label for lists (e.g. "Class 7 - B") */
    classDisplay: {
      type: String,
      trim: true,
      default: '',
    },
    /** Calendar day this entry describes (stored as UTC midnight for stable queries) */
    forDate: {
      type: Date,
      required: true,
      index: true,
    },
    title: {
      type: String,
      trim: true,
      default: '',
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true }
);

teacherWorkDiarySchema.index({ teacherId: 1, forDate: -1 });
teacherWorkDiarySchema.index({ adminId: 1, forDate: -1 });
teacherWorkDiarySchema.index({ teacherId: 1, forDate: 1, classId: 1 });

const TeacherWorkDiary = mongoose.model('TeacherWorkDiary', teacherWorkDiarySchema);

export default TeacherWorkDiary;
