import mongoose from 'mongoose';

const calendarEventSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    eventKind: {
      type: String,
      enum: ['holiday', 'custom'],
      default: 'custom',
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    createdByRole: {
      type: String,
      enum: ['super-admin'],
      default: 'super-admin',
    },
  },
  { timestamps: true }
);

calendarEventSchema.index({ schoolId: 1, startDate: 1, endDate: 1 });

const CalendarEvent =
  mongoose.models.CalendarEvent || mongoose.model('CalendarEvent', calendarEventSchema);

export default CalendarEvent;
