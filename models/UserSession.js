import mongoose from 'mongoose';

const userSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  startTime: {
    type: Date,
    required: true,
    default: Date.now
  },
  endTime: {
    type: Date
  },
  duration: {
    type: Number, // in minutes
    default: 0
  },
  date: {
    type: String, // Date string for easy querying (YYYY-MM-DD format)
    required: true
  }
}, {
  timestamps: true
});

// Indexes for better performance
userSessionSchema.index({ userId: 1, date: 1 });
userSessionSchema.index({ userId: 1, startTime: -1 });
userSessionSchema.index({ date: 1 });

/**
 * Daily session-time API stores cumulative foreground minutes in `duration`
 * and uses startTime=midnight + endTime=last sync as markers.
 * Never overwrite an explicitly set duration with (endTime - startTime),
 * or minutes become "minutes since midnight" and look wrong (often ~hours).
 */
userSessionSchema.pre('save', function(next) {
  if (this.isModified('duration') && Number.isFinite(Number(this.duration))) {
    return next();
  }
  if (this.endTime && this.startTime) {
    const durationMs = this.endTime - this.startTime;
    this.duration = Math.max(0, Math.round(durationMs / 60000));
  }
  next();
});

export default mongoose.model('UserSession', userSessionSchema);

