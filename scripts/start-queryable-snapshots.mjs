import crypto from 'crypto';
import fs from 'fs';

/**
 * NOTE: Atlas Admin API restoreJobs does NOT accept deliveryType "queryable"
 * (only automated | download | pointInTime). Invalid "queryable" returns
 * MISSING_ATTRIBUTE. Start Queryable Backup from the Atlas UI, then run
 * count-brainfeed-in-snapshot.mjs with SNAPSHOT_URI.
 *
 * This script starts a *download* restore job so you can pull a snapshot archive
 * and mongorestore users into a temp collection (safer than overwriting live).
 *
 *   ATLAS_PUBLIC_KEY=... ATLAS_PRIVATE_KEY=... node scripts/start-queryable-snapshots.mjs [snapshotId...]
 */
const PUBLIC_KEY = process.env.ATLAS_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.ATLAS_PRIVATE_KEY || '';
const GROUP_ID = process.env.ATLAS_GROUP_ID || '69f77d2ce9ada22e26a16de0';
const CLUSTER = process.env.ATLAS_CLUSTER_NAME || 'Cluster0';

if (!PUBLIC_KEY || !PRIVATE_KEY) {
  console.error('Set ATLAS_PUBLIC_KEY and ATLAS_PRIVATE_KEY');
  process.exit(1);
}

function digestHeader(method, path, challenge) {
  const parts = {};
  challenge
    .replace(/Digest\s+/i, '')
    .split(/,\s*/)
    .forEach((pair) => {
      const m = pair.match(/^(\w+)="?([^"]+)"?$/);
      if (m) parts[m[1]] = m[2];
    });
  const realm = parts.realm || 'MMS Public API';
  const nonce = parts.nonce;
  const qop = 'auth';
  const nc = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');
  const ha1 = crypto.createHash('md5').update(`${PUBLIC_KEY}:${realm}:${PRIVATE_KEY}`).digest('hex');
  const ha2 = crypto.createHash('md5').update(`${method}:${path}`).digest('hex');
  const response = crypto
    .createHash('md5')
    .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    .digest('hex');
  let h = `Digest username="${PUBLIC_KEY}", realm="${realm}", nonce="${nonce}", uri="${path}", qop=${qop}, nc=${nc}, cnonce="${cnonce}", response="${response}"`;
  if (parts.opaque) h += `, opaque="${parts.opaque}"`;
  return h;
}

async function atlas(method, apiPath, bodyObj) {
  const url = `https://cloud.mongodb.com${apiPath}`;
  const body = bodyObj ? JSON.stringify(bodyObj) : undefined;
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';

  const r1 = await fetch(url, { method, headers, body });
  if (r1.status !== 401) {
    const text = await r1.text();
    return { status: r1.status, json: text ? JSON.parse(text) : null, text };
  }
  const challenge = r1.headers.get('www-authenticate');
  const auth = digestHeader(method, apiPath, challenge);
  const r2 = await fetch(url, {
    method,
    headers: { ...headers, Authorization: auth },
    body,
  });
  const text = await r2.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: r2.status, json, text };
}

const snapshotIds = (process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      // Around deletion window — binary search candidates
      '6a605e03ad8aa776c3bc31d3', // 2026-07-22T06:10:27Z daily (before last exam)
      '6a60b264c6da051692f2f803', // 2026-07-22T12:09:56Z hourly (after last exam)
      '6a6300d087cb9d0865d75d16', // 2026-07-24T06:09:15Z daily (school updated ~same time)
      '6a6452567dead12fb31e6b50', // 2026-07-25T06:09:31Z weekly
    ]);

const out = [];
for (const snapshotId of snapshotIds) {
  console.log('\nStarting download restore for', snapshotId);
  const created = await atlas(
    'POST',
    `/api/atlas/v1.0/groups/${GROUP_ID}/clusters/${encodeURIComponent(CLUSTER)}/backup/restoreJobs`,
    { snapshotId, deliveryType: 'download' },
  );
  console.log('create status', created.status);
  console.log(JSON.stringify(created.json, null, 2).slice(0, 1500));
  out.push({ snapshotId, create: created });
  fs.writeFileSync(
    new URL(`./_download-${snapshotId}.json`, import.meta.url),
    JSON.stringify(created, null, 2),
  );
  if (created.status === 400 && /CONCURRENT|already an active/i.test(created.text || '')) {
    console.log('Another download is already active for this snapshot — poll that job instead.');
  }
}

console.log('\nDone. Poll GET .../backup/restoreJobs/{id} until deliveryUrl is set.');
console.log('Queryable Backup: use Atlas UI only (API does not support deliveryType=queryable).');
