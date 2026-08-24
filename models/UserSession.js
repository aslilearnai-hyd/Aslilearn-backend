import mongoose from 'mongoose';

const userSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    startTime: {
      type: Date,
      required: true,
      default: Date.now,
    },
    endTime: {
      type: Date,
    },
    duration: {
      type: Number, // in minutes
      default: 0,
    },
    date: {
      type: String, // Date string for easy querying (YYYY-MM-DD format)
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

userSessionSchema.index({ userId: 1, date: 1 });
userSessionSchema.index({ userId: 1, startTime: -1 });
userSessionSchema.index({ date: 1 });

/** Soft cap for one calendar day of tracked foreground time (minutes). */
export const MAX_SESSION_DURATION_MINUTES = 12 * 60;

/**
 * Normalize duration for daily session rows.
 * Prefer explicit tracked minutes; never use (endTime - startTime) when duration
 * is already set — that becomes "minutes since midnight" and inflates reports.
 */
export function normalizeSessionDuration({ duration, startTime, endTime } = {}) {
  const raw = Number(duration);
  if (duration !== undefined && duration !== null && Number.isFinite(raw)) {
    return Math.min(MAX_SESSION_DURATION_MINUTES, Math.max(0, Math.round(raw)));
  }
  if (endTime && startTime) {
    const durationMs = new Date(endTime) - new Date(startTime);
    return Math.min(
      MAX_SESSION_DURATION_MINUTES,
      Math.max(0, Math.round(durationMs / 60000)),
    );
  }
  return 0;
}

/**
 * Daily session-time API stores cumulative foreground minutes in `duration`
 * and uses startTime=midnight + endTime=last sync as markers.
 *
 * IMPORTANT: never recompute duration from (endTime - startTime) when duration
 * is already set. Presence pings only touch endTime; recomputing turns that into
 * "minutes since midnight" and inflates weekly reports (often tens of hours).
 */
userSessionSchema.pre('save', function (next) {
  this.duration = normalizeSessionDuration({
    duration: this.duration,
    startTime: this.startTime,
    endTime: this.endTime,
  });
  next();
});

export default mongoose.model('UserSession', userSessionSchema);
