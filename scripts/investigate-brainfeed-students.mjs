/**
 * Investigate missing Brainfeed students.
 * Run on the API server (or any machine that can reach Atlas):
 *   cd /var/www/ASLI-STUD-BACK && node scripts/investigate-brainfeed-students.mjs
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const SCHOOL_RE = /brainfeed/i;

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection.db;

const schools = await db.collection('schools').find({ name: SCHOOL_RE }).toArray();
const admins = await db
  .collection('users')
  .find({
    role: 'admin',
    $or: [
      { schoolName: SCHOOL_RE },
      { fullName: SCHOOL_RE },
      { email: SCHOOL_RE },
    ],
  })
  .project({ email: 1, fullName: 1, schoolName: 1, isActive: 1, createdAt: 1, updatedAt: 1 })
  .toArray();

console.log('\n=== Brainfeed school rows ===');
console.log(
  schools.map((s) => ({
    id: String(s._id),
    name: s.name,
    adminUserId: s.adminUserId ? String(s.adminUserId) : null,
    isActive: s.isActive,
    updatedAt: s.updatedAt,
  })),
);

console.log('\n=== Brainfeed admin logins ===');
console.log(
  admins.map((a) => ({
    id: String(a._id),
    email: a.email,
    schoolName: a.schoolName,
    fullName: a.fullName,
    isActive: a.isActive,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  })),
);

const adminIds = [
  ...new Set([
    ...admins.map((a) => String(a._id)),
    ...schools.map((s) => (s.adminUserId ? String(s.adminUserId) : null)).filter(Boolean),
  ]),
];

if (!adminIds.length) {
  console.log('\nNo Brainfeed admin found. School may have been fully deleted.');
  await mongoose.disconnect();
  process.exit(0);
}

for (const id of adminIds) {
  const oid = new mongoose.Types.ObjectId(id);
  const students = await db
    .collection('users')
    .find({ role: 'student', assignedAdmin: oid })
    .project({
      email: 1,
      fullName: 1,
      classNumber: 1,
      isActive: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    .sort({ updatedAt: -1 })
    .toArray();

  const inactive = students.filter((s) => s.isActive === false);
  const byClass = {};
  for (const s of students) {
    const c = String(s.classNumber || 'unset');
    byClass[c] = (byClass[c] || 0) + 1;
  }

  console.log(`\n=== Students for admin ${id} ===`);
  console.log({ total: students.length, inactive: inactive.length, byClass });
  console.log(
    'Most recently updated:',
    students.slice(0, 15).map((s) => ({
      name: s.fullName,
      email: s.email,
      class: s.classNumber,
      active: s.isActive !== false,
      updatedAt: s.updatedAt,
    })),
  );

  // Evidence of hard-deleted students: exam results whose userId no longer exists
  const results = await db
    .collection('examresults')
    .find({ adminId: oid })
    .project({ userId: 1, examTitle: 1, completedAt: 1 })
    .toArray();
  const userIds = [...new Set(results.map((r) => r.userId).filter(Boolean).map(String))];
  const existing = new Set(
    (
      await db
        .collection('users')
        .find({ _id: { $in: userIds.map((u) => new mongoose.Types.ObjectId(u)) } })
        .project({ _id: 1 })
        .toArray()
    ).map((u) => String(u._id)),
  );
  const missing = userIds.filter((u) => !existing.has(u));
  console.log({
    uniqueExamTakers: userIds.length,
    hardDeletedExamTakersStillInResults: missing.length,
  });
  if (missing.length) {
    console.log(
      'Sample hard-deleted student ids (still in examresults):',
      missing.slice(0, 20).map((uid) => {
        const any = results.find((r) => String(r.userId) === uid);
        return { userId: uid, lastExam: any?.examTitle, at: any?.completedAt };
      }),
    );
  }

  // Unassigned students that might have been reassigned away
  const unassigned = await db.collection('users').countDocuments({
    role: 'student',
    $or: [{ assignedAdmin: null }, { assignedAdmin: { $exists: false } }],
    email: SCHOOL_RE,
  });
  console.log('Unassigned students with brainfeed in email:', unassigned);
}

// Server log hints (print command for operator)
console.log(`
=== Next: check API logs for explicit deletes ===
pm2 logs asli-api --lines 2000 | grep -iE "delete student|Starting deletion of school|brainfeed|Deleted: .* students"
`);

await mongoose.disconnect();
