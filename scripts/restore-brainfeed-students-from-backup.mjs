/**
 * Restore ONLY deleted Brainfeed High School students from a backup copy of `users`.
 *
 * SAFETY: does not overwrite existing users. Inserts missing docs by original _id
 * so examresults keep working.
 *
 * === Step 1 (MongoDB Atlas UI) ===
 * 1. Atlas → your cluster (Cluster0) → Backup
 * 2. Pick a snapshot from BEFORE the delete
 *    (use ~ Jul 22 2026 00:00 UTC or earlier Jul 22 morning — last exam was 09:49 UTC)
 * 3. Restore → Queryable Backup / Restore to new cluster OR
 *    Collection restore of database `ASLI-LEARN` collection `users`
 *    into a TEMP name, e.g. `users_backup_jul22`
 *    (Do NOT overwrite live `users` with full collection restore.)
 *
 * === Step 2 (this script) ===
 *   cd /var/www/ASLI-STUD-BACK
 *   BACKUP_USERS_COLL=users_backup_jul22 node scripts/restore-brainfeed-students-from-backup.mjs
 *
 * Optional:
 *   BACKUP_DB=ASLI-LEARN   (default)
 *   DRY_RUN=1              (preview only)
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const ADMIN_ID = '6a1a85d2f294f34784903681';
const BACKUP_DB = process.env.BACKUP_DB || 'ASLI-LEARN';
const BACKUP_USERS_COLL = process.env.BACKUP_USERS_COLL || '';
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

/** Known deleted Brainfeed student ids from examresults orphan scan */
const KNOWN_DELETED_IDS = [
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

if (!process.env.MONGO_URI) {
  console.error('MONGO_URI missing');
  process.exit(1);
}
if (!BACKUP_USERS_COLL) {
  console.error(`
Set BACKUP_USERS_COLL to the restored backup collection name.

Example:
  BACKUP_USERS_COLL=users_backup_jul22 node scripts/restore-brainfeed-students-from-backup.mjs

First restore Atlas backup of \`users\` into that temp collection (do not overwrite live users).
`);
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI);
const liveDb = mongoose.connection.client.db('ASLI-LEARN');
const backupDb = mongoose.connection.client.db(BACKUP_DB);
const backupUsers = backupDb.collection(BACKUP_USERS_COLL);
const liveUsers = liveDb.collection('users');

const adminOid = new mongoose.Types.ObjectId(ADMIN_ID);
const knownOids = KNOWN_DELETED_IDS.map((id) => new mongoose.Types.ObjectId(id));

// Prefer docs from backup that match known deleted ids OR assignedAdmin=Brainfeed
const fromKnownIds = await backupUsers
  .find({ _id: { $in: knownOids }, role: 'student' })
  .toArray();

const fromAdmin = await backupUsers
  .find({ role: 'student', assignedAdmin: adminOid })
  .toArray();

const byId = new Map();
for (const doc of [...fromKnownIds, ...fromAdmin]) {
  byId.set(String(doc._id), doc);
}
const candidates = [...byId.values()];

console.log(`Backup collection: ${BACKUP_DB}.${BACKUP_USERS_COLL}`);
console.log(`Candidates in backup: ${candidates.length}`);
console.log(`DRY_RUN=${DRY_RUN}`);

let inserted = 0;
let skippedExists = 0;
let missingInBackup = 0;

for (const id of KNOWN_DELETED_IDS) {
  if (!byId.has(id)) {
    missingInBackup += 1;
    console.log(`  missing in backup: ${id}`);
  }
}

for (const doc of candidates) {
  const id = String(doc._id);
  const exists = await liveUsers.findOne({ _id: doc._id }, { projection: { _id: 1 } });
  if (exists) {
    skippedExists += 1;
    console.log(`  skip (already live): ${id} ${doc.email || doc.fullName || ''}`);
    continue;
  }

  // Ensure still linked to Brainfeed admin
  const toInsert = {
    ...doc,
    role: 'student',
    assignedAdmin: adminOid,
    isActive: doc.isActive !== false,
  };

  console.log(
    `  ${DRY_RUN ? 'would insert' : 'insert'}: ${id} | ${toInsert.fullName || ''} | ${toInsert.email || ''} | class ${toInsert.classNumber || ''}`,
  );

  if (!DRY_RUN) {
    await liveUsers.insertOne(toInsert);
    inserted += 1;
  } else {
    inserted += 1;
  }
}

const liveCount = await liveUsers.countDocuments({
  role: 'student',
  assignedAdmin: adminOid,
});

console.log('\n=== Done ===');
console.log({
  insertedOrWouldInsert: inserted,
  skippedExists,
  missingInBackup,
  liveBrainfeedStudentsNow: liveCount,
});

if (missingInBackup > 0) {
  console.log(`
Some IDs were not in this backup snapshot.
Try an earlier Atlas snapshot (before Jul 22 09:49 UTC if needed),
or a snapshot closer to Jul 21 / early Jul 22.
`);
}

await mongoose.disconnect();
