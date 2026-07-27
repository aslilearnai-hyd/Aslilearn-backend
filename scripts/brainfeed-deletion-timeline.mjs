/**
 * Infer when Brainfeed students were deleted (no audit log exists).
 *   cd /var/www/ASLI-STUD-BACK && node scripts/brainfeed-deletion-timeline.mjs
 *
 * Uses:
 *  - last exam activity per deleted userId
 *  - ObjectId creation time
 *  - school/admin updatedAt
 *  - optional local nginx/pm2 log scan for DELETE /students
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import mongoose from 'mongoose';

const ADMIN_ID = '6a1a85d2f294f34784903681';

function oidTime(id) {
  try {
    return new mongoose.Types.ObjectId(id).getTimestamp();
  } catch {
    return null;
  }
}

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection.db;
const oid = new mongoose.Types.ObjectId(ADMIN_ID);

const admin = await db.collection('users').findOne(
  { _id: oid },
  { projection: { email: 1, schoolName: 1, updatedAt: 1, createdAt: 1 } },
);
const school = await db.collection('schools').findOne(
  { adminUserId: oid },
  { projection: { name: 1, updatedAt: 1, createdAt: 1 } },
);

const results = await db
  .collection('examresults')
  .find({ adminId: oid })
  .project({
    userId: 1,
    examTitle: 1,
    completedAt: 1,
    createdAt: 1,
    updatedAt: 1,
    studentName: 1,
    studentEmail: 1,
  })
  .toArray();

const byUser = new Map();
for (const r of results) {
  if (!r.userId) continue;
  const uid = String(r.userId);
  if (!byUser.has(uid)) {
    byUser.set(uid, {
      userId: uid,
      createdFromOid: oidTime(uid),
      names: new Set(),
      emails: new Set(),
      lastExamAt: null,
      lastExamTitle: null,
      attemptCount: 0,
    });
  }
  const row = byUser.get(uid);
  if (r.studentName) row.names.add(String(r.studentName));
  if (r.studentEmail) row.emails.add(String(r.studentEmail));
  row.attemptCount += 1;
  const t = r.completedAt || r.createdAt;
  if (t && (!row.lastExamAt || t > row.lastExamAt)) {
    row.lastExamAt = t;
    row.lastExamTitle = r.examTitle || null;
  }
}

const deleted = [];
for (const row of byUser.values()) {
  const exists = await db.collection('users').findOne(
    { _id: new mongoose.Types.ObjectId(row.userId) },
    { projection: { _id: 1 } },
  );
  if (!exists) deleted.push(row);
}

deleted.sort((a, b) => {
  const ta = a.lastExamAt ? new Date(a.lastExamAt).getTime() : 0;
  const tb = b.lastExamAt ? new Date(b.lastExamAt).getTime() : 0;
  return ta - tb;
});

const lastActivity = deleted.reduce((max, row) => {
  if (!row.lastExamAt) return max;
  const t = new Date(row.lastExamAt);
  return !max || t > max ? t : max;
}, null);

console.log('\n=== School / admin timestamps ===');
console.log({
  adminEmail: admin?.email,
  adminCreatedAt: admin?.createdAt,
  adminUpdatedAt: admin?.updatedAt,
  schoolName: school?.name,
  schoolCreatedAt: school?.createdAt,
  schoolUpdatedAt: school?.updatedAt,
});

console.log('\n=== Deleted students last-seen (from examresults) ===');
for (const row of deleted) {
  console.log({
    userId: row.userId,
    accountCreatedApprox: row.createdFromOid,
    names: [...row.names],
    emails: [...row.emails],
    attempts: row.attemptCount,
    lastExamAt: row.lastExamAt,
    lastExamTitle: row.lastExamTitle,
  });
}

console.log('\n=== Best deletion-time estimate ===');
if (lastActivity) {
  console.log({
    earliestPossibleDelete: lastActivity.toISOString(),
    meaning:
      'Students still existed at this time (last exam attempt). Deletion happened AFTER this timestamp.',
    schoolUpdatedAt: school?.updatedAt || null,
    adminUpdatedAt: admin?.updatedAt || null,
    note:
      'App does not store exact deleteAt. If school/admin updatedAt is after last exam, deletion likely between lastExam and that update — or later.',
  });
} else {
  console.log('No exam activity found; cannot bound delete time from results.');
}

// Try local access logs for DELETE /api/admin/students
console.log('\n=== Scanning local logs for DELETE /students (if present) ===');
const candidates = [
  '/var/log/nginx/access.log',
  '/var/log/nginx/access.log.1',
  '/root/.pm2/logs/asli-api-out.log',
  '/root/.pm2/logs/asli-api-error.log',
];
let foundLogHits = 0;
for (const file of candidates) {
  if (!fs.existsSync(file)) continue;
  try {
    const out = execSync(
      `grep -iE "DELETE.*/api/admin/students|delete student|Starting deletion of school|Deleted: .* students" ${JSON.stringify(file)} | tail -n 50`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (out) {
      foundLogHits += 1;
      console.log(`\n--- hits in ${file} ---`);
      console.log(out);
    }
  } catch {
    // grep exit 1 = no matches
  }
}
if (!foundLogHits) {
  console.log('No DELETE student lines found in common log files (rotated logs may be gone).');
}

console.log(`
Also try manually:
  grep -RIn --include='*.log*' -E 'DELETE.*/api/admin/students|brainfeed' /var/log/nginx /root/.pm2/logs 2>/dev/null | tail -n 100
`);

await mongoose.disconnect();
