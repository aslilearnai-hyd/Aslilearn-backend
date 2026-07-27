/**
 * List Atlas Cloud Backup snapshots and (optionally) find when Brainfeed students disappear.
 *
 * Live MONGO_URI alone CANNOT read historical snapshots.
 * You need Atlas Admin API keys (Organization → Access Manager → API Keys).
 *
 * Add to backend/.env (or export):
 *   ATLAS_PUBLIC_KEY=...
 *   ATLAS_PRIVATE_KEY=...
 *   ATLAS_GROUP_ID=...          # Project → Settings → Project ID
 *   ATLAS_CLUSTER_NAME=Cluster0
 *
 * List snapshots only:
 *   node scripts/scan-brainfeed-snapshots-atlas.mjs
 *
 * Also start Queryable Backup + count students on candidates (slow, costs while open):
 *   QUERYABLE=1 node scripts/scan-brainfeed-snapshots-atlas.mjs
 *
 * Run this on the droplet (has outbound DNS to Atlas):
 *   cd /var/www/ASLI-STUD-BACK && node scripts/scan-brainfeed-snapshots-atlas.mjs
 */
import 'dotenv/config';
import crypto from 'crypto';
import mongoose from 'mongoose';

const PUBLIC_KEY = process.env.ATLAS_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.ATLAS_PRIVATE_KEY || '';
const GROUP_ID = process.env.ATLAS_GROUP_ID || '';
const CLUSTER = process.env.ATLAS_CLUSTER_NAME || 'Cluster0';
const QUERYABLE = process.env.QUERYABLE === '1' || process.env.QUERYABLE === 'true';
const ADMIN_ID = '6a1a85d2f294f34784903681';

// Deletion window from evidence
const WINDOW_START = new Date('2026-07-22T00:00:00.000Z');
const WINDOW_END = new Date('2026-07-25T23:59:59.000Z');

function digestAuthHeader(method, path, wwwAuthenticate) {
  // Atlas uses HTTP Digest (MD5). Parse challenge.
  const parts = {};
  wwwAuthenticate.replace(/Digest\s+/i, '').split(/,\s*/).forEach((pair) => {
    const m = pair.match(/^(\w+)=("?)(.+)\2$/);
    if (m) parts[m[1]] = m[3];
  });
  const realm = parts.realm || 'MMS Public API';
  const nonce = parts.nonce;
  const qop = parts.qop || 'auth';
  const opaque = parts.opaque;
  const nc = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');
  const ha1 = crypto.createHash('md5').update(`${PUBLIC_KEY}:${realm}:${PRIVATE_KEY}`).digest('hex');
  const ha2 = crypto.createHash('md5').update(`${method}:${path}`).digest('hex');
  const response = crypto
    .createHash('md5')
    .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    .digest('hex');
  let header = `Digest username="${PUBLIC_KEY}", realm="${realm}", nonce="${nonce}", uri="${path}", qop=${qop}, nc=${nc}, cnonce="${cnonce}", response="${response}"`;
  if (opaque) header += `, opaque="${opaque}"`;
  return header;
}

async function atlasFetch(method, apiPath, body) {
  const url = `https://cloud.mongodb.com${apiPath}`;
  const baseHeaders = {
    Accept: 'application/vnd.atlas.2023-02-01+json',
    'Content-Type': 'application/json',
  };
  // First request to get digest challenge
  let res = await fetch(url, { method, headers: baseHeaders, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) {
    const challenge = res.headers.get('www-authenticate');
    if (!challenge || !challenge.toLowerCase().includes('digest')) {
      const text = await res.text();
      throw new Error(`Atlas auth failed (no digest): ${res.status} ${text}`);
    }
    const auth = digestAuthHeader(method, apiPath, challenge);
    res = await fetch(url, {
      method,
      headers: { ...baseHeaders, Authorization: auth },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`Atlas ${method} ${apiPath} → ${res.status}: ${text.slice(0, 500)}`);
  }
  return json;
}

async function countBrainfeed(uri) {
  const conn = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 20000 }).asPromise();
  try {
    const dbName = conn.name || 'ASLI-LEARN';
    const db = conn.client.db('ASLI-LEARN');
    const oid = new mongoose.Types.ObjectId(ADMIN_ID);
    const count = await db.collection('users').countDocuments({
      role: 'student',
      assignedAdmin: oid,
    });
    const sample = await db
      .collection('users')
      .find({ role: 'student', assignedAdmin: oid })
      .project({ fullName: 1, email: 1 })
      .limit(5)
      .toArray();
    return { dbName, count, sample };
  } finally {
    await conn.close();
  }
}

if (!PUBLIC_KEY || !PRIVATE_KEY || !GROUP_ID) {
  console.error(`
Missing Atlas Admin API credentials.

Your backend/.env only has MONGO_URI (live database).
That connects to CURRENT data only — not hourly backup snapshots.

Create keys:
  1. Atlas → Organization → Access Manager → API Keys → Create API Key
  2. Permissions: Project Read Only (or Project Backup Manager)
  3. Add IP access for this server
  4. Put in .env:
       ATLAS_PUBLIC_KEY=...
       ATLAS_PRIVATE_KEY=...
       ATLAS_GROUP_ID=<Project ID from Project Settings>
       ATLAS_CLUSTER_NAME=Cluster0

Then run on the droplet:
  cd /var/www/ASLI-STUD-BACK
  node scripts/scan-brainfeed-snapshots-atlas.mjs
`);
  process.exit(1);
}

console.log(`Listing snapshots for ${CLUSTER} in project ${GROUP_ID}...`);
const snaps = await atlasFetch(
  'GET',
  `/api/atlas/v2/groups/${GROUP_ID}/clusters/${encodeURIComponent(CLUSTER)}/backup/snapshots?itemsPerPage=100`,
);

const results = (snaps?.results || snaps || []).filter(Boolean);
const timed = results
  .map((s) => ({
    id: s.id,
    createdAt: s.createdAt || s.snapshotCreatedAt || s.startedAt,
    frequencyType: s.frequencyType || s.type || s.snapshotType,
    status: s.status,
    cloudProvider: s.cloudProvider,
  }))
  .filter((s) => s.createdAt)
  .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

const inWindow = timed.filter((s) => {
  const t = new Date(s.createdAt);
  return t >= WINDOW_START && t <= WINDOW_END;
});

console.log(`\nTotal snapshots returned: ${timed.length}`);
console.log(`In deletion window 22–25 Jul 2026: ${inWindow.length}`);
console.log('\n=== Hourly/daily snapshots in window ===');
for (const s of inWindow) {
  console.log(`${s.createdAt}  ${s.frequencyType || ''}  id=${s.id}`);
}

if (!QUERYABLE) {
  console.log(`
Next: find which of these first lost Brainfeed students.
Re-run with QUERYABLE=1 to auto-open Queryable Backup on each window snapshot
(slow; keep only a few if needed), OR manually Query each in Atlas UI and run:

  SNAPSHOT_URI='...' SNAPSHOT_LABEL='22Jul-...' node scripts/count-brainfeed-in-snapshot.mjs
`);
  process.exit(0);
}

console.log('\nQueryable scan enabled — checking snapshots in window (oldest → newest)...');
let lastPresent = null;
let firstMissing = null;

for (const s of inWindow) {
  console.log(`\n--- Queryable: ${s.createdAt} (${s.id}) ---`);
  try {
    // Start queryable backup job — endpoint names vary by Atlas API version.
    // Try restore job with deliveryType queryable / create queryable.
    const job = await atlasFetch(
      'POST',
      `/api/atlas/v2/groups/${GROUP_ID}/clusters/${encodeURIComponent(CLUSTER)}/backup/restoreJobs`,
      {
        snapshotId: s.id,
        deliveryType: 'queryable',
      },
    );
    console.log('restore job:', job?.id || job?.status || JSON.stringify(job).slice(0, 200));

    // Poll for connection string
    let uri = null;
    for (let i = 0; i < 30; i += 1) {
      await new Promise((r) => setTimeout(r, 10000));
      const status = await atlasFetch(
        'GET',
        `/api/atlas/v2/groups/${GROUP_ID}/clusters/${encodeURIComponent(CLUSTER)}/backup/restoreJobs/${job.id}`,
      );
      const state = status?.status || status?.state;
      console.log(`  poll ${i + 1}: ${state}`);
      uri =
        status?.connectionString ||
        status?.queryableBackup?.connectionString ||
        status?.deliveryUrl?.[0] ||
        null;
      if (uri || state === 'FAILED' || state === 'CANCELLED') break;
      if (state === 'FINISHED' || state === 'READY' || state === 'RUNNING') {
        if (uri) break;
      }
    }

    if (!uri) {
      console.log('  No connection string yet — check Atlas UI Queryable Backup for this snapshot.');
      continue;
    }

    const { count, sample } = await countBrainfeed(uri);
    console.log(`  brainfeedStudentCount=${count}`);
    if (sample?.length) console.log('  sample', sample.map((x) => x.email || x.fullName));

    if (count > 0) lastPresent = { ...s, count };
    if (count === 0 && !firstMissing) firstMissing = s;

    // Cancel/finish queryable to save cost if API supports it
  } catch (e) {
    console.error('  queryable failed:', e.message);
    console.error('  Fall back to manual Queryable Backup in Atlas UI for this snapshot id.');
  }
}

console.log('\n=== RESULT ===');
console.log({
  lastSnapshotWithStudents: lastPresent,
  firstSnapshotMissingStudents: firstMissing,
  meaning: firstMissing
    ? `Students were deleted BETWEEN ${lastPresent?.createdAt || '?'} and ${firstMissing.createdAt}`
    : 'Could not determine — finish manual checks',
});
