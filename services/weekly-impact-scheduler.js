/**
 * Weekly impact report scheduler — runs every Monday ~06:30 IST (01:00 UTC).
 * Safe no-op if already ran for the current ISO week.
 */
import {
  startOfIsoWeek,
  buildAllSchoolImpactSnapshots,
  buildDigestsForSchool,
} from './impact-report-service.js';
import { deliverPendingDigestsForWeek } from './digest-email-service.js';
import User from '../models/User.js';
import WeeklyImpactSnapshot from '../models/WeeklyImpactSnapshot.js';

let timer = null;
let running = false;

export async function runWeeklyImpactJob({ source = 'cron', force = false } = {}) {
  if (running) return { ok: false, message: 'Already running' };
  running = true;
  const weekStart = startOfIsoWeek(new Date());
  try {
    if (!force) {
      const existing = await WeeklyImpactSnapshot.countDocuments({ weekStart, source: 'cron' });
      const adminCount = await User.countDocuments({ role: 'admin', isActive: { $ne: false } });
      if (existing > 0 && existing >= Math.max(1, Math.floor(adminCount * 0.5))) {
        return { ok: true, skipped: true, message: 'Snapshots already exist for this week' };
      }
    }

    console.log(`[weekly-impact] Building school snapshots for week ${weekStart.toISOString()}`);
    const schoolResults = await buildAllSchoolImpactSnapshots(weekStart, source);

    const admins = await User.find({ role: 'admin', isActive: { $ne: false } }).select('_id').lean();
    let digestCount = 0;
    for (const a of admins) {
      const digests = await buildDigestsForSchool(a._id, weekStart);
      digestCount += digests.length;
    }

    const emailResults = await deliverPendingDigestsForWeek(weekStart);
    console.log(
      `[weekly-impact] Done schools=${schoolResults.length} digests=${digestCount} email=`,
      emailResults,
    );
    return {
      ok: true,
      weekStart,
      schools: schoolResults,
      digests: digestCount,
      email: emailResults,
    };
  } catch (err) {
    console.error('[weekly-impact] job failed:', err);
    return { ok: false, error: err.message };
  } finally {
    running = false;
  }
}

function msUntilNextMondayUtc0100() {
  const now = new Date();
  const next = startOfIsoWeek(now);
  // Next Monday 01:00 UTC
  next.setUTCDate(next.getUTCDate() + 7);
  next.setUTCHours(1, 0, 0, 0);
  // If today is Monday and before 01:00 UTC, run today
  const todayMonday = startOfIsoWeek(now);
  todayMonday.setUTCHours(1, 0, 0, 0);
  if (now.getUTCDay() === 1 && now < todayMonday) {
    return todayMonday - now;
  }
  return Math.max(60_000, next - now);
}

export function startWeeklyImpactScheduler() {
  if (process.env.WEEKLY_IMPACT_CRON === 'off') {
    console.log('[weekly-impact] Scheduler disabled (WEEKLY_IMPACT_CRON=off)');
    return;
  }
  if (timer) return;

  const tick = async () => {
    const day = new Date().getUTCDay();
    const hour = new Date().getUTCHours();
    // Monday UTC hour 1 (= ~06:30 IST)
    if (day === 1 && hour === 1) {
      await runWeeklyImpactJob({ source: 'cron' });
    }
    timer = setTimeout(tick, 60 * 60 * 1000); // check hourly
    if (typeof timer.unref === 'function') timer.unref();
  };

  const delay = msUntilNextMondayUtc0100();
  console.log(`[weekly-impact] Scheduler armed; first check in ~${Math.round(delay / 60000)} min`);
  timer = setTimeout(tick, Math.min(delay, 60 * 60 * 1000));
  // Allow Node to exit in tests / short-lived processes
  if (typeof timer.unref === 'function') timer.unref();
}
