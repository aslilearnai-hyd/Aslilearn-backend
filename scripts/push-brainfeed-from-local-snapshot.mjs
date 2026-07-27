/**
 * Copy Brainfeed students from local snapshot mongod → live Atlas.
 *
 * Prerequisites:
 *   Local mongod running on 27018 with restored Atlas snapshot dbpath
 *
 *   node scripts/push-brainfeed-from-local-snapshot.mjs
 */
import dns from 'dns';
import mongoose from 'mongoose';
import 'dotenv/config';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const ADMIN_ID = '6a1a85d2f294f34784903681';
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

const LOCAL_URI = process.env.LOCAL_SNAPSHOT_URI || 'mongodb://127.0.0.1:27018';
const LIVE_URI = process.env.MONGO_URI;
const DRY_RUN = process.env.DRY_RUN === '1';

if (!LIVE_URI) {
  console.error('MONGO_URI missing');
  process.exit(1);
}

const local = await mongoose.createConnection(LOCAL_URI).asPromise();
const live = await mongoose.createConnection(LIVE_URI).asPromise();

const adminOid = new mongoose.Types.ObjectId(ADMIN_ID);
const knownOids = KNOWN_DELETED_IDS.map((id) => new mongoose.Types.ObjectId(id));

// Find ASLI-LEARN (or first db that has users)
const adminDb = local.client.db().admin();
const dbs = (await adminDb.listDatabases()).databases.map((d) => d.name);
console.log('local dbs', dbs);

let sourceDbName = dbs.find((n) => /asli/i.test(n)) || 'ASLI-LEARN';
if (!dbs.includes(sourceDbName)) {
  for (const n of dbs) {
    if (['admin', 'local', 'config'].includes(n)) continue;
    const cols = await local.client.db(n).listCollections().toArray();
    if (cols.some((c) => c.name === 'users')) {
      sourceDbName = n;
      break;
    }
  }
}
console.log('using source db', sourceDbName);

const sourceUsers = local.client.db(sourceDbName).collection('users');
const liveUsers = live.client.db('ASLI-LEARN').collection('users');

const fromKnown = await sourceUsers.find({ _id: { $in: knownOids }, role: 'student' }).toArray();
const fromAdmin = await sourceUsers.find({ role: 'student', assignedAdmin: adminOid }).toArray();
const byId = new Map();
for (const doc of [...fromKnown, ...fromAdmin]) byId.set(String(doc._id), doc);
const candidates = [...byId.values()];

console.log({
  fromKnown: fromKnown.length,
  fromAdmin: fromAdmin.length,
  uniqueCandidates: candidates.length,
  sample: candidates.slice(0, 5).map((s) => ({
    id: String(s._id),
    name: s.fullName,
    email: s.email,
  })),
});

let inserted = 0;
let skipped = 0;
let missing = 0;

for (const id of KNOWN_DELETED_IDS) {
  const doc = byId.get(id);
  if (!doc) {
    missing += 1;
    console.log('missing in snapshot', id);
    continue;
  }
  const exists = await liveUsers.findOne({ _id: doc._id }, { projection: { _id: 1 } });
  if (exists) {
    skipped += 1;
    continue;
  }
  if (DRY_RUN) {
    console.log('DRY_RUN would insert', doc.email || doc.fullName);
    inserted += 1;
    continue;
  }
  await liveUsers.insertOne(doc);
  inserted += 1;
  console.log('inserted', doc.email || doc.fullName, String(doc._id));
}

// Also insert any other Brainfeed students present in snapshot but not in known list
for (const doc of candidates) {
  const id = String(doc._id);
  if (KNOWN_DELETED_IDS.includes(id)) continue;
  const exists = await liveUsers.findOne({ _id: doc._id }, { projection: { _id: 1 } });
  if (exists) continue;
  if (DRY_RUN) {
    console.log('DRY_RUN extra', doc.email || doc.fullName);
    inserted += 1;
    continue;
  }
  await liveUsers.insertOne(doc);
  inserted += 1;
  console.log('inserted extra', doc.email || doc.fullName, id);
}

const liveCount = await liveUsers.countDocuments({ role: 'student', assignedAdmin: adminOid });
console.log({ inserted, skipped, missing, liveBrainfeedStudentCount: liveCount, DRY_RUN });

await local.close();
await live.close();
