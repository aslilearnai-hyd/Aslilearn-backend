/**
 * AI Generator QA sweep via running backend API (no direct Mongo).
 * Usage: node scripts/qa-api-sweep.mjs [--from=my-study-decks] [--slug=my-study-decks] [--batch=5]
 */
const BASE = process.env.QA_API_BASE || 'http://localhost:5000';
const EMAIL = process.env.QA_EMAIL || 'sealucknow2017@gmail.com';
const PASS = process.env.QA_PASSWORD;
if (!PASS || PASS.length < 8) {
  console.error('Set QA_PASSWORD (test account password) before running qa-api-sweep.');
  process.exit(1);
}

const QA_TOOL_ORDER = [
  'flashcard-generator',
  'my-study-decks',
  'worksheet-mcq-generator',
  'smart-qa-practice-generator',
  'mock-test-builder',
  'exam-question-paper-generator',
  'lesson-planner',
  'daily-class-plan-maker',
  'reading-practice-room',
  'story-passage-creator',
  'smart-study-guide-generator',
  'concept-breakdown-explainer',
  'chapter-summary-creator',
  'key-points-formula-extractor',
  'quick-assignment-builder',
  'project-idea-lab',
  'study-schedule-maker',
  'activity-project-generator',
  'concept-mastery-helper',
  'homework-creator',
  'short-notes-summaries-maker',
];

const TOOL_NAMES = {
  'flashcard-generator': 'Flash Card Generator',
  'my-study-decks': 'My Study Decks',
  'worksheet-mcq-generator': 'Worksheet & MCQ Generator',
  'smart-qa-practice-generator': 'Smart Q&A Practice Generator',
  'mock-test-builder': 'Mock Test Builder',
  'exam-question-paper-generator': 'Exam Question Paper Generator',
  'lesson-planner': 'Lesson Planner',
  'daily-class-plan-maker': 'Daily Class Plan Maker',
  'reading-practice-room': 'Reading Practice Room',
  'story-passage-creator': 'Story and Passage Creator',
  'smart-study-guide-generator': 'Smart Study Guide Generator',
  'concept-breakdown-explainer': 'Concept Breakdown Explainer',
  'chapter-summary-creator': 'Chapter Summary Creator',
  'key-points-formula-extractor': 'Key Points Extractor',
  'quick-assignment-builder': 'Quick Assignment Builder',
  'project-idea-lab': 'Project Idea Lab',
  'study-schedule-maker': 'Study Schedule Maker',
  'activity-project-generator': 'Activity / Project Generator',
  'concept-mastery-helper': 'Concept Mastery Helper',
  'homework-creator': 'Homework Creator',
  'short-notes-summaries-maker': 'Short Notes & Summaries',
};

const args = process.argv.slice(2);
const fromSlug = args.find((a) => a.startsWith('--from='))?.split('=')[1] || '';
const skipSlugs = new Set(
  (args.find((a) => a.startsWith('--skip='))?.split('=')[1] || 'flashcard-generator')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);
const onlySlug = args.find((a) => a.startsWith('--slug='))?.split('=')[1] || '';
const batchSize = Number(args.find((a) => a.startsWith('--batch='))?.split('=')[1] || 5);
const tier = args.find((a) => a.startsWith('--tier='))?.split('=')[1] || 'fast';

const LANGUAGE = new Set(['reading-practice-room', 'story-passage-creator']);

function bodyFor(slug) {
  const science = {
    board: 'CBSE',
    className: 'Class 10',
    subjectName: 'Science',
    topicName: 'Life Processes',
    subtopicName: '5.2 Nutrition — Autotrophic, Heterotrophic',
  };
  const lang = {
    board: 'CBSE',
    className: 'Class 10',
    subjectName: 'Hindi',
    topicName: 'ग्रीष्म ऋतु',
    subtopicName: 'गर्मी के दिन',
  };
  const ctx = LANGUAGE.has(slug) ? lang : science;
  return {
    toolSlug: slug,
    toolName: TOOL_NAMES[slug] || slug,
    batchSize,
    qualityTier: tier,
    forceGenerate: true,
    forceUnlock: true,
    extraParams: { questionCount: 8, cardCount: 10, qualityTier: tier },
    ...ctx,
  };
}

async function login() {
  const res = await fetch(`${BASE}/api/super-admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  const data = await res.json();
  if (!data.token) throw new Error(`Login failed: ${JSON.stringify(data).slice(0, 200)}`);
  return data.token;
}

async function generateBatch(token, slug) {
  const started = Date.now();
  const res = await fetch(`${BASE}/api/ai-generator/generate-batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(bodyFor(slug)),
  });
  const data = await res.json();
  return { status: res.status, ms: Date.now() - started, data };
}

async function fetchRecords(token, slug) {
  const q = new URLSearchParams({
    toolSlug: slug,
    board: 'CBSE',
    className: 'Class 10',
    limit: String(batchSize),
  });
  const res = await fetch(`${BASE}/api/ai-generator/records?${q}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return data?.data?.grouped || data?.data || data;
}

function flattenGrouped(grouped) {
  const rows = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.records)) rows.push(...node.records);
    for (const v of Object.values(node)) {
      if (v && typeof v === 'object') walk(v);
    }
  };
  walk(grouped);
  return rows;
}

function quickAudit(record) {
  const blob = String(record?.generatedContent || record?.content || '');
  const scaffold = /key ideas about|Students should recall basic ideas|classlevel:|bloom_level:/i.test(blob);
  const leak = /Edition-\d+-A\d+|\d{10,}-v\d+-a\d+/i.test(blob);
  const short = blob.length < 200;
  return { scaffold, leak, short, chars: blob.length };
}

async function runTool(token, slug) {
  console.log(`\n[QA API] ${TOOL_NAMES[slug]} (${slug}) — generating ${batchSize}…`);
  const gen = await generateBatch(token, slug);
  const saved = gen.data?.data?.savedCount ?? gen.data?.savedCount ?? 0;
  const failed = gen.data?.data?.failedCount ?? gen.data?.failedCount ?? 0;
  const failures = gen.data?.data?.failures ?? gen.data?.failures ?? [];
  const grouped = await fetchRecords(token, slug);
  const rows = flattenGrouped(grouped).slice(0, batchSize);
  const audits = rows.map(quickAudit);
  const verdict =
    saved === batchSize && audits.every((a) => !a.short && !a.scaffold)
      ? 'PASS'
      : saved >= Math.ceil(batchSize * 0.8)
        ? 'WEAK'
        : 'FAIL';
  const summary = {
    at: new Date().toISOString(),
    slug,
    verdict,
    saved,
    failed,
    failures,
    genMs: gen.ms,
    httpStatus: gen.status,
    audited: audits.length,
    scaffoldHits: audits.filter((a) => a.scaffold).length,
    leakHits: audits.filter((a) => a.leak).length,
    audits,
  };
  console.log(
    `[QA API] ${slug}: ${verdict} saved=${saved}/${batchSize} audited=${audits.length} (${Math.round(gen.ms / 1000)}s)`,
  );
  return summary;
}

async function main() {
  const fs = await import('fs');
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.join(__dirname, '..', 'qa-results');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'ai-generator-sweep.jsonl');

  const token = await login();
  let slugs = onlySlug ? [onlySlug] : [...QA_TOOL_ORDER];
  slugs = slugs.filter((s) => !skipSlugs.has(s));
  if (fromSlug) {
    const i = slugs.indexOf(fromSlug);
    if (i >= 0) slugs = slugs.slice(i);
  }

  for (const slug of slugs) {
    try {
      const summary = await runTool(token, slug);
      fs.appendFileSync(outFile, `${JSON.stringify(summary)}\n`);
    } catch (err) {
      const fail = { at: new Date().toISOString(), slug, verdict: 'ERROR', message: String(err?.message || err) };
      fs.appendFileSync(outFile, `${JSON.stringify(fail)}\n`);
      console.error(`[QA API] ${slug} ERROR:`, err?.message || err);
    }
  }
  console.log(`\n[QA API] Log: ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
