import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const PUBLIC_KEY = process.env.ATLAS_PUBLIC_KEY || 'multzlbu';
const PRIVATE_KEY = process.env.ATLAS_PRIVATE_KEY || '';
const GROUP_ID = process.env.ATLAS_GROUP_ID || '69f77d2ce9ada22e26a16de0';
const CLUSTER = process.env.ATLAS_CLUSTER_NAME || 'Cluster0';
// Jul 22 06:10 UTC — before last exam activity
const SNAPSHOT_ID = process.env.SNAPSHOT_ID || '6a605e03ad8aa776c3bc31d3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(__dirname, '_restore-work');
const TAR = path.join(WORK, 'snapshot.tar.gz');

if (!PRIVATE_KEY) {
  console.error('ATLAS_PRIVATE_KEY required');
  process.exit(1);
}

fs.mkdirSync(WORK, { recursive: true });

function digestHeader(method, apiPath, challenge) {
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
  const ha2 = crypto.createHash('md5').update(`${method}:${apiPath}`).digest('hex');
  const response = crypto
    .createHash('md5')
    .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    .digest('hex');
  return `Digest username="${PUBLIC_KEY}", realm="${realm}", nonce="${nonce}", uri="${apiPath}", qop=${qop}, nc=${nc}, cnonce="${cnonce}", response="${response}"`;
}

async function atlas(method, apiPath, bodyObj) {
  const url = `https://cloud.mongodb.com${apiPath}`;
  const body = bodyObj ? JSON.stringify(bodyObj) : undefined;
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  const r1 = await fetch(url, { method, headers, body });
  if (r1.status !== 401) {
    const text = await r1.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: r1.status, text, json };
  }
  const auth = digestHeader(method, apiPath, r1.headers.get('www-authenticate'));
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
    json = null;
  }
  return { status: r2.status, text, json };
}

const jobsPath = `/api/atlas/v1.0/groups/${GROUP_ID}/clusters/${encodeURIComponent(CLUSTER)}/backup/restoreJobs`;

console.log('1) Listing existing download jobs...');
const listed = await atlas('GET', jobsPath);
const existing = (listed.json?.results || []).find(
  (j) =>
    j.snapshotId === SNAPSHOT_ID &&
    j.deliveryType === 'download' &&
    !j.expired &&
    !j.failed &&
    Array.isArray(j.deliveryUrl) &&
    j.deliveryUrl.length > 0,
);
let job = existing;

if (!job) {
  console.log('2) Starting download restore for', SNAPSHOT_ID);
  const created = await atlas('POST', jobsPath, {
    snapshotId: SNAPSHOT_ID,
    deliveryType: 'download',
  });
  console.log('create', created.status, created.text.slice(0, 300));
  if (created.status >= 400) {
    // concurrent — find in-progress job
    const again = await atlas('GET', jobsPath);
    job = (again.json?.results || []).find(
      (j) => j.snapshotId === SNAPSHOT_ID && j.deliveryType === 'download' && !j.expired && !j.failed,
    );
    if (!job) process.exit(1);
  } else {
    job = created.json;
  }
}

const jobId = job.id;
console.log('jobId', jobId, 'timestamp', job.timestamp);

for (let i = 0; i < 60; i++) {
  const polled = await atlas('GET', `${jobsPath}/${jobId}`);
  job = polled.json;
  const urls = job?.deliveryUrl || [];
  console.log(`poll ${i + 1}: urls=${urls.length} failed=${job?.failed} expired=${job?.expired}`);
  if (job?.failed) {
    console.error(job);
    process.exit(1);
  }
  if (urls.length) break;
  await new Promise((r) => setTimeout(r, 20000));
}

const downloadUrl = job?.deliveryUrl?.[0];
if (!downloadUrl) {
  console.error('No deliveryUrl yet');
  process.exit(1);
}
console.log('3) Download URL ready (expires', job.expiresAt, ')');
fs.writeFileSync(path.join(WORK, 'download-url.txt'), downloadUrl);

console.log('4) Downloading archive to', TAR);
const curl = spawnSync(
  'curl.exe',
  ['-L', '--retry', '10', '--retry-all-errors', '-C', '-', '--http1.1', '-o', TAR, downloadUrl],
  { stdio: 'inherit', shell: false },
);
if (curl.status !== 0) {
  console.error('curl failed', curl.status);
  process.exit(curl.status || 1);
}

const st = fs.statSync(TAR);
console.log('downloaded bytes', st.size);
console.log('DONE_DOWNLOAD');
console.log(downloadUrl);
