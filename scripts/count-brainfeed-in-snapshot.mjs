/**
 * Count Brainfeed students in a snapshot connection (Queryable Backup / restored temp).
 *
 * Atlas UI:
 *   Backup → open a snapshot → "Query" / Queryable Backup → copy connection string
 *
 * Then:
 *   SNAPSHOT_URI='mongodb://...' node scripts/count-brainfeed-in-snapshot.mjs
 *   # or if querying live:
 *   node scripts/count-brainfeed-in-snapshot.mjs
 *
 * Prints student count + sample. Use this on hourly snapshots to find when count drops to 0.
 */
import mongoose from 'mongoose';
import 'dotenv/config';

const ADMIN_ID = '6a1a85d2f294f34784903681';
const uri = process.env.SNAPSHOT_URI || process.env.MONGO_URI;
const label = process.env.SNAPSHOT_LABEL || (process.env.SNAPSHOT_URI ? 'snapshot' : 'live');

if (!uri) {
  console.error('Set SNAPSHOT_URI or MONGO_URI');
  process.exit(1);
}

await mongoose.connect(uri);
const db = mongoose.connection.db;
const oid = new mongoose.Types.ObjectId(ADMIN_ID);

const school = await db.collection('schools').findOne(
  { name: { $regex: /brainfeed/i } },
  { projection: { name: 1, adminUserId: 1, updatedAt: 1 } },
);

const admin = await db.collection('users').findOne(
  { _id: oid },
  { projection: { email: 1, schoolName: 1, isActive: 1 } },
);

const students = await db
  .collection('users')
  .find({ role: 'student', assignedAdmin: oid })
  .project({ fullName: 1, email: 1, classNumber: 1, isActive: 1 })
  .sort({ fullName: 1 })
  .toArray();

const knownIds = [
  '6a1aac63f294f34784907cfc',
  '6a1aac63f294f34784907d03',
  '6a1aac64f294f34784907d0b',
  '6a1aac6bf294f34784907d5e',
  '6a1aac70f294f34784907da0',
  '6a1aac67f294f34784907d36',
  '6a1aac89f294f34784907ed3',
  '6a1aac69f294f34784907d4a',
  '6a1aac64f294f34784907d0f',
  '6a1aac64f294f34784907d07',
  '6a1aac65f294f34784907d1e',
  '6a6090018ded45e54dd621a7',
];

let knownPresent = 0;
for (const id of knownIds) {
  const hit = await db.collection('users').findOne({ _id: new mongoose.Types.ObjectId(id) });
  if (hit) knownPresent += 1;
}

console.log(
  JSON.stringify(
    {
      label,
      schoolName: school?.name || null,
      adminEmail: admin?.email || null,
      brainfeedStudentCount: students.length,
      knownDeletedIdsStillPresent: knownPresent,
      sample: students.slice(0, 8).map((s) => ({
        name: s.fullName,
        email: s.email,
        class: s.classNumber,
      })),
    },
    null,
    2,
  ),
);

await mongoose.disconnect();

if (students.length === 0) {
  console.log('\n>>> MISSING in this snapshot (0 Brainfeed students)');
  process.exit(2);
}
console.log('\n>>> PRESENT in this snapshot');
