import 'dotenv/config';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const args = new Set(process.argv.slice(2));
const run = args.has('--run');
const cyclesArg = process.argv.find((arg) => arg.startsWith('--cycles='));
const configArg = process.argv.find((arg) => arg.startsWith('--config='));
const reportArg = process.argv.find((arg) => arg.startsWith('--report='));
const cycles = Math.max(100, Number(cyclesArg?.split('=')[1]) || 100);
const configPath = configArg?.slice('--config='.length) || 'rag-stress-cases.json';
const reportPath = reportArg?.slice('--report='.length) || 'rag-stress-report.json';
const endpoint = String(process.env.RAG_STRESS_ENDPOINT || '').trim();
const token = String(process.env.RAG_STRESS_BEARER_TOKEN || '').trim();

function signature(value = '') {
  return crypto.createHash('sha256').update(String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).digest('hex').slice(0, 20);
}

function collectQuestionTexts(value, result = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectQuestionTexts(item, result);
  } else if (value && typeof value === 'object') {
    const question = String(value.question || value.stem || value.prompt || '').trim();
    if (question) result.push(question);
    for (const child of Object.values(value)) if (child && typeof child === 'object') collectQuestionTexts(child, result);
  }
  return result;
}

const cases = JSON.parse(await fs.readFile(configPath, 'utf8'));
if (!Array.isArray(cases) || cases.length < 5) {
  throw new Error('Stress config must contain at least five cases: short theory, long theory, numerical, diagram-heavy and narrow subtopic.');
}
if (!run) {
  console.log(JSON.stringify({ mode: 'plan', cyclesPerCase: cycles, totalCalls: cycles * cases.length, cases }, null, 2));
  process.exit(0);
}
if (!endpoint || !token) throw new Error('RAG_STRESS_ENDPOINT and RAG_STRESS_BEARER_TOKEN are required with --run.');

const report = {
  startedAt: new Date().toISOString(),
  cyclesPerCase: cycles,
  cases: [],
};
for (const testCase of cases) {
  const signatures = new Map();
  const chunkFrequency = new Map();
  let success = 0;
  let failure = 0;
  let totalInr = 0;
  let validatorFailures = 0;
  for (let index = 0; index < cycles; index += 1) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...testCase.request, batchSize: 1, generationVariant: index + 1 }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.success === false) {
      failure += 1;
      if (/validation|incomplete|schema|marks|context/i.test(JSON.stringify(body))) validatorFailures += 1;
      continue;
    }
    success += 1;
    totalInr += Number(body?.cost?.inr || body?.data?.cost?.inr || 0);
    const records = body?.records || body?.data?.records || [];
    for (const record of records) {
      const structured = record?.metadata?.structuredContent || record?.structuredContent || {};
      for (const question of collectQuestionTexts(structured)) {
        const key = signature(question);
        signatures.set(key, (signatures.get(key) || 0) + 1);
      }
      for (const chunkId of record?.metadata?.sourceChunkIds || []) {
        chunkFrequency.set(String(chunkId), (chunkFrequency.get(String(chunkId)) || 0) + 1);
      }
    }
  }
  const duplicateQuestions = [...signatures.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const totalQuestions = [...signatures.values()].reduce((sum, count) => sum + count, 0);
  const dominantChunk = [...chunkFrequency.entries()].sort((a, b) => b[1] - a[1])[0] || ['', 0];
  report.cases.push({
    name: testCase.name,
    success,
    failure,
    validatorFailures,
    totalQuestions,
    duplicateQuestions,
    duplicateRate: totalQuestions ? duplicateQuestions / totalQuestions : null,
    averageCostInr: success ? totalInr / success : null,
    dominantChunkId: dominantChunk[0],
    dominantChunkRate: success ? dominantChunk[1] / success : null,
    teacherReviewSampleRequired: Math.ceil(totalQuestions * 0.1),
  });
}
report.finishedAt = new Date().toISOString();
report.acceptance = {
  structuralPass: report.cases.every((row) => row.failure === 0 && row.validatorFailures === 0),
  costAndAcademicReviewPending: true,
};
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
