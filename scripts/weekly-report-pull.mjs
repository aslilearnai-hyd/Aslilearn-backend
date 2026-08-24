/**
 * One-off: pull client weekly report numbers from MongoDB.
 * Usage: node scripts/weekly-report-pull.mjs
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';
import {
  buildAllSchoolImpactSnapshots,
  listSchoolSnapshots,
  resolveImpactPeriod,
} from '../services/impact-report-service.js';

dotenv.config();

function sumSnaps(snaps) {
  const t = {
    schools: snaps.length,
    schoolsWithActivity: 0,
    teachersIssued: 0,
    teachersLoggedIn: 0,
    teachersActive: 0,
    studentsIssued: 0,
    studentsAccessed: 0,
    studentsActive: 0,
    sessions: 0,
    minutes: 0,
    exams: 0,
    homework: 0,
    videos: 0,
    vidya: 0,
  };
  for (const s of snaps) {
    const active =
      (s.studentsAccessed || 0) > 0 ||
      (s.teachersLoggedIn || 0) > 0 ||
      (s.totalLearningSessions || 0) > 0;
    if (active) t.schoolsWithActivity += 1;
    t.teachersIssued += s.teachersIssued || 0;
    t.teachersLoggedIn += s.teachersLoggedIn || 0;
    t.teachersActive += s.teachersActive || 0;
    t.studentsIssued += s.studentsIssued || 0;
    t.studentsAccessed += s.studentsAccessed || 0;
    t.studentsActive += s.studentsActive3Plus || 0;
    t.sessions += s.totalLearningSessions || 0;
    t.minutes += s.totalMinutesSpent || 0;
    t.exams += s.examAttemptsCount || 0;
    t.homework += s.homeworkSubmissions || 0;
    t.videos += s.videosWatchedCount || 0;
    t.vidya += s.aiExplanationsCount || 0;
  }
  t.hours = Math.round((t.minutes / 60) * 10) / 10;
  return t;
}

function pctChange(cur, prev) {
  if (!prev) return cur > 0 ? 100 : 0;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 20000,
  });

  const thisWeekStart = new Date('2026-08-11T00:00:00.000Z');
  const lastWeekStart = new Date('2026-08-04T00:00:00.000Z');

  const thisPeriod = resolveImpactPeriod({ weekStart: thisWeekStart });
  const lastPeriod = resolveImpactPeriod({ weekStart: lastWeekStart });

  // Rebuild live snapshots for accuracy
  await buildAllSchoolImpactSnapshots(thisWeekStart, 'weekly-report-script');
  await buildAllSchoolImpactSnapshots(lastWeekStart, 'weekly-report-script');

  const thisSnaps = await listSchoolSnapshots(thisWeekStart);
  const lastSnaps = await listSchoolSnapshots(lastWeekStart);

  const thisTotals = sumSnaps(thisSnaps);
  const lastTotals = sumSnaps(lastSnaps);

  const schoolHighlights = thisSnaps
    .filter(
      (s) =>
        (s.studentsAccessed || 0) > 0 ||
        (s.teachersLoggedIn || 0) > 0 ||
        (s.totalLearningSessions || 0) > 0
    )
    .slice(0, 8)
    .map((s) => ({
      schoolName: s.schoolName,
      teachersActive: s.teachersActive || 0,
      teachersIssued: s.teachersIssued || 0,
      studentsActive: s.studentsActive3Plus || 0,
      studentsIssued: s.studentsIssued || 0,
      studentsAccessed: s.studentsAccessed || 0,
      highlight: s.keyObservation || '',
      sessions: s.totalLearningSessions || 0,
      exams: s.examAttemptsCount || 0,
      vidya: s.aiExplanationsCount || 0,
    }));

  console.log(
    JSON.stringify(
      {
        thisPeriod: thisPeriod.periodLabel,
        lastPeriod: lastPeriod.periodLabel,
        thisTotals,
        lastTotals,
        activityChangePct: pctChange(thisTotals.studentsAccessed, lastTotals.studentsAccessed),
        schoolHighlights,
        allSchoolsThisWeek: thisSnaps.map((s) => ({
          schoolName: s.schoolName,
          teachersLoggedIn: s.teachersLoggedIn,
          teachersIssued: s.teachersIssued,
          teachersActive: s.teachersActive,
          studentsAccessed: s.studentsAccessed,
          studentsIssued: s.studentsIssued,
          studentsActive3Plus: s.studentsActive3Plus,
          sessions: s.totalLearningSessions,
          minutes: s.totalMinutesSpent,
          exams: s.examAttemptsCount,
          homework: s.homeworkSubmissions,
          videos: s.videosWatchedCount,
          vidya: s.aiExplanationsCount,
        })),
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('FAILED', err.message);
  process.exit(1);
});
