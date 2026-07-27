/**
 * Recover Brainfeed deleted-student identities from leftover examresults / related docs.
 *   cd /var/www/ASLI-STUD-BACK && node scripts/recover-brainfeed-deleted-students.mjs
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const ADMIN_ID = '6a1a85d2f294f34784903681';

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection.db;
const oid = new mongoose.Types.ObjectId(ADMIN_ID);

const results = await db
  .collection('examresults')
  .find({ adminId: oid })
  .project({
    userId: 1,
    examTitle: 1,
    examId: 1,
    completedAt: 1,
    percentage: 1,
    obtainedMarks: 1,
    totalMarks: 1,
    studentName: 1,
    studentEmail: 1,
    fullName: 1,
    email: 1,
    classNumber: 1,
    createdAt: 1,
  })
  .sort({ completedAt: 1 })
  .toArray();

const byUser = new Map();
for (const r of results) {
  const uid = r.userId ? String(r.userId) : 'unknown';
  if (!byUser.has(uid)) {
    byUser.set(uid, {
      userId: uid,
      names: new Set(),
      emails: new Set(),
      classes: new Set(),
      exams: [],
      firstAt: r.completedAt || r.createdAt,
      lastAt: r.completedAt || r.createdAt,
    });
  }
  const row = byUser.get(uid);
  for (const n of [r.studentName, r.fullName]) if (n) row.names.add(String(n));
  for (const e of [r.studentEmail, r.email]) if (e) row.emails.add(String(e));
  if (r.classNumber) row.classes.add(String(r.classNumber));
  row.exams.push({
    title: r.examTitle,
    at: r.completedAt,
    pct: r.percentage,
  });
  const t = r.completedAt || r.createdAt;
  if (t && (!row.firstAt || t < row.firstAt)) row.firstAt = t;
  if (t && (!row.lastAt || t > row.lastAt)) row.lastAt = t;
}

console.log('\n=== Deleted Brainfeed students recoverable from examresults ===');
console.log('count:', byUser.size);
for (const row of byUser.values()) {
  const still = await db.collection('users').findOne({
    _id: new mongoose.Types.ObjectId(row.userId),
  });
  console.log({
    userId: row.userId,
    existsNow: Boolean(still),
    names: [...row.names],
    emails: [...row.emails],
    classes: [...row.classes],
    examAttempts: row.exams.length,
    firstExamAt: row.firstAt,
    lastExamAt: row.lastAt,
    lastExam: row.exams[row.exams.length - 1]?.title,
  });
}

// Other collections that might still hold names
const collectionsToScan = [
  'homeworksubmissions',
  'quizresults',
  'attendances',
  'chatsessions',
  'notifications',
];
console.log('\n=== Other leftover refs ===');
for (const col of collectionsToScan) {
  try {
    const exists = await db.listCollections({ name: col }).hasNext();
    if (!exists) continue;
    const sample = await db
      .collection(col)
      .find({
        $or: [{ adminId: oid }, { assignedAdmin: oid }, { schoolAdminId: oid }],
      })
      .limit(3)
      .toArray();
    const count = await db.collection(col).countDocuments({
      $or: [{ adminId: oid }, { assignedAdmin: oid }, { schoolAdminId: oid }],
    });
    if (count > 0) {
      console.log(col, 'count', count, 'sampleKeys', sample[0] ? Object.keys(sample[0]) : []);
    }
  } catch (e) {
    console.log(col, 'skip', e.message);
  }
}

console.log(`
=== Interpretation ===
- If existsNow=false for all: accounts were HARD deleted from users.
- School still exists => NOT a full school wipe.
- Likely: school admin deleted students one-by-one, or a bulk delete of students only.
- deleteStudent() does not write an audit log, so PM2 may not show "delete student".
`);

await mongoose.disconnect();
