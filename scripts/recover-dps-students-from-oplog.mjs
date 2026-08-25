import dns from 'node:dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();
dns.setServers(['8.8.8.8', '1.1.1.1']);

const LOCAL_URI = process.env.RECOVERY_LOCAL_URI || 'mongodb://127.0.0.1:27019/local?directConnection=true';
const LIVE_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
const DPS_ADMIN_ID = new mongoose.Types.ObjectId('6a5f62b5d33b6c1fd0909258');
const DELETE_START = new Date('2026-07-27T07:48:52.000Z');
const DELETE_END = new Date('2026-07-27T07:48:55.000Z');

function applyDiff(target, diff) {
  for (const [key, value] of Object.entries(diff.u || {})) target[key] = value;
  for (const key of Object.keys(diff.d || {})) delete target[key];
  for (const [key, child] of Object.entries(diff)) {
    if (!key.startsWith('s')) continue;
    const field = key.slice(1);
    if (!target[field] || typeof target[field] !== 'object') target[field] = {};
    applyDiff(target[field], child);
  }
  return target;
}

function applyOplogUpdate(doc, update) {
  if (update?.$v === 2 && update.diff) return applyDiff(doc, update.diff);
  for (const [operator, values] of Object.entries(update || {})) {
    if (operator === '$set') Object.assign(doc, values);
    else if (operator === '$unset') for (const key of Object.keys(values)) delete doc[key];
    else if (!operator.startsWith('$')) return { ...update };
  }
  return doc;
}

async function main() {
  const local = await mongoose.createConnection(LOCAL_URI).asPromise();
  const oplog = local.collection('oplog.rs');
  const txns = await oplog.find({
    op: 'c', wall: { $gte: DELETE_START, $lte: DELETE_END }, 'o.applyOps.ns': 'ASLI-LEARN.users'
  }).sort({ wall: 1 }).toArray();
  const deletedIds = new Set();
  for (const txn of txns) for (const op of txn.o.applyOps || []) {
    if (op.ns === 'ASLI-LEARN.users' && op.op === 'd' && op.o?._id) deletedIds.add(String(op.o._id));
  }

  const ids = [...deletedIds].map((id) => new mongoose.Types.ObjectId(id));
  const history = await oplog.find({
    ns: 'ASLI-LEARN.users',
    $or: [{ 'o._id': { $in: ids } }, { 'o2._id': { $in: ids } }],
    wall: { $lt: DELETE_END }
  }).sort({ $natural: 1 }).toArray();
  const docs = new Map();
  for (const op of history) {
    const id = String(op.o?._id || op.o2?._id || '');
    if (op.op === 'i') docs.set(id, { ...op.o });
    else if (op.op === 'u' && docs.has(id)) docs.set(id, applyOplogUpdate(docs.get(id), op.o));
  }

  const dpsDocs = [...docs.values()].filter((doc) =>
    doc.role === 'student' && String(doc.assignedAdmin || '') === String(DPS_ADMIN_ID)
  );
  const group = {};
  for (const doc of docs.values()) {
    const key = `${doc.role || 'unknown'}:${doc.assignedAdmin || 'none'}`;
    group[key] = (group[key] || 0) + 1;
  }
  console.log(JSON.stringify({
    deletionUtc: [txns[0]?.wall, txns.at(-1)?.wall],
    deletedUsers: deletedIds.size,
    reconstructedUsers: docs.size,
    dpsStudents: dpsDocs.length,
    population: group
  }, null, 2));

  if (!LIVE_URI) throw new Error('MONGO_URI/MONGODB_URI is not configured');
  const live = await mongoose.createConnection(LIVE_URI).asPromise();
  const users = live.collection('users');
  const existing = await users.find({
    $or: [{ _id: { $in: dpsDocs.map((d) => d._id) } }, { email: { $in: dpsDocs.map((d) => d.email) } }]
  }, { projection: { _id: 1, email: 1, assignedAdmin: 1 } }).toArray();
  const existingIds = new Set(existing.map((d) => String(d._id)));
  const existingEmails = new Set(existing.map((d) => String(d.email).toLowerCase()));
  const safe = dpsDocs.filter((d) => !existingIds.has(String(d._id)) && !existingEmails.has(String(d.email).toLowerCase()));
  const conflicts = dpsDocs.length - safe.length;
  const liveDpsCount = await users.countDocuments({ role: 'student', assignedAdmin: DPS_ADMIN_ID });
  const affectedAdminIds = [...new Set([...docs.values()]
    .map((doc) => doc.assignedAdmin)
    .filter(Boolean)
    .map(String))].map((id) => new mongoose.Types.ObjectId(id));
  const affectedAdmins = await users.find(
    { _id: { $in: affectedAdminIds } },
    { projection: { fullName: 1, name: 1, schoolName: 1, organizationName: 1, email: 1 } }
  ).toArray();
  console.log(JSON.stringify({
    liveMatches: existing.length,
    safeToRestore: safe.length,
    conflicts,
    liveDpsCount,
    affectedAdmins: affectedAdmins.map((admin) => ({
      id: String(admin._id),
      name: admin.schoolName || admin.organizationName || admin.fullName || admin.name,
      email: admin.email
    }))
  }, null, 2));

  if (process.env.APPLY === '1' || process.argv.includes('--apply')) {
    if (dpsDocs.length !== 109) throw new Error(`Expected exactly 109 DPS students, found ${dpsDocs.length}`);
    if (conflicts) throw new Error(`Refusing restore: ${conflicts} ID/email conflict(s)`);
    const result = await users.insertMany(safe, { ordered: true });
    console.log(`RESTORED=${result.insertedCount}`);
  } else {
    console.log('DRY RUN ONLY. Set APPLY=1 after validating the counts above.');
  }
  await live.close();
  await local.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
