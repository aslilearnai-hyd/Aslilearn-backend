/**
 * Full AI Generator QA sweep — 5 records per tool, Fast tier, CBSE Class 10 Science.
 * Usage:
 *   node scripts/qa-ai-generator-sweep.mjs [--from=my-study-decks] [--skip=flashcard-generator] [--batch=5] [--tier=fast]
 * Results append to backend/qa-results/ai-generator-sweep.jsonl
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { AI_TOOL_ORDERED_SLUGS, getToolDisplayTitle } from '../config/aiToolTemplates.js';
import { generateBatchAndSave } from '../services/ai-generator-batch-orchestrator.js';
import { checkRecordSectionGap } from '../services/ai-tool-data-audit-service.js';
import { validateAllCanonicalToolFields } from '../utils/ai-generator-section-pad.js';
import AiToolGeneration from '../models/AiToolGeneration.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

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

const args = process.argv.slice(2);
const fromSlug = args.find((a) => a.startsWith('--from='))?.split('=')[1] || '';
const skipSlugs = new Set(
  (args.find((a) => a.startsWith('--skip='))?.split('=')[1] || 'flashcard-generator')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);
const batchSize = Number(args.find((a) => a.startsWith('--batch='))?.split('=')[1] || 5);
const tier = args.find((a) => a.startsWith('--tier='))?.split('=')[1] || 'fast';
const onlySlug = args.find((a) => a.startsWith('--slug='))?.split('=')[1] || '';

const SCIENCE_BASE = {
  board: 'CBSE',
  className: 'Class 10',
  subjectName: 'Science',
  topicName: 'Life Processes',
  subtopicName: '5.2 Nutrition — Autotrophic, Heterotrophic',
  qualityTier: tier,
  forceGenerate: true,
  extraParams: { questionCount: 8, cardCount: 10, qualityTier: tier },
};

const LANGUAGE_TOOLS = new Set(['reading-practice-room', 'story-passage-creator']);

function paramsForSlug(slug) {
  if (LANGUAGE_TOOLS.has(slug)) {
    return {
      ...SCIENCE_BASE,
      subjectName: 'Hindi',
      topicName: 'ग्रीष्म ऋतु',
      subtopicName: 'गर्मी के दिन',
    };
  }
  return { ...SCIENCE_BASE };
}

const SCAFFOLD_RE =
  /key ideas about|Students should recall basic ideas|Students should define the concept|classlevel:|bloom_level:|difficultylevel:/i;

function extractStructured(row) {
  const meta = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  if (meta.structuredContent && typeof meta.structuredContent === 'object') {
    return meta.structuredContent;
  }
  const raw = String(row?.content || row?.generatedContent || '').trim();
  if (!raw.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.raw && typeof parsed.raw === 'object') return parsed.raw;
    return parsed;
  } catch {
    return null;
  }
}

function auditRecord(row, slug) {
  const gap = checkRecordSectionGap({
    toolName: slug,
    toolDisplayName: getToolDisplayTitle(slug),
    content: row.content || row.generatedContent || '',
    generatedContent: row.generatedContent || row.content || '',
    metadata: row.metadata,
    sourceType: row.sourceType || 'ai_generator',
  });
  const structured = extractStructured(row);
  const canonical = structured
    ? validateAllCanonicalToolFields(slug, structured)
    : { valid: false, missingSections: ['structuredContent'] };
  const blob = JSON.stringify(structured || row?.content || '');
  const scaffoldHit = SCAFFOLD_RE.test(blob);
  const leakHit = /classlevel:|bloom_level:|Edition-\d+-A\d+|\d{10,}-v\d+-a\d+/i.test(blob);
  return {
    id: String(row._id),
    complete: gap.complete && canonical.valid,
    missingSections: [...new Set([...(gap.missingSections || []), ...(canonical.missingSections || [])])],
    scaffoldHit,
    leakHit,
  };
}

async function fetchLatestBatch(slug, count) {
  const rows = await AiToolGeneration.find({
    toolName: slug,
    board: 'CBSE',
    classLabel: 'Class 10',
    topic: SCIENCE_BASE.topicName,
    subtopic: LANGUAGE_TOOLS.has(slug) ? 'गर्मी के दिन' : SCIENCE_BASE.subtopicName,
  })
    .sort({ createdAt: -1 })
    .limit(count)
    .lean();
  return rows;
}

async function runTool(slug) {
  const display = getToolDisplayTitle(slug);
  const params = {
    toolSlug: slug,
    toolName: display,
    ...paramsForSlug(slug),
  };
  const started = Date.now();
  console.log(`\n[QA] === ${display} (${slug}) — batch ${batchSize} ===`);
  const result = await generateBatchAndSave(params, {
    batchSize,
    reqUser: { userId: 'qa-sweep-script', name: 'QA Sweep' },
  });
  const ms = Date.now() - started;
  const rows = await fetchLatestBatch(slug, batchSize);
  const audits = rows.map((r) => auditRecord(r, slug));
  const completeCount = audits.filter((a) => a.complete).length;
  const summary = {
    at: new Date().toISOString(),
    slug,
    display,
    batchSize,
    savedCount: result.savedCount ?? 0,
    failedCount: result.failedCount ?? 0,
    failures: result.failures || [],
    ms,
    audited: audits.length,
    completeCount,
    scaffoldHits: audits.filter((a) => a.scaffoldHit).length,
    leakHits: audits.filter((a) => a.leakHit).length,
    audits,
    verdict:
      (result.savedCount ?? 0) === batchSize && completeCount === batchSize
        ? 'PASS'
        : (result.savedCount ?? 0) >= Math.ceil(batchSize * 0.8) && completeCount >= Math.ceil(batchSize * 0.6)
          ? 'WEAK'
          : 'FAIL',
  };
  console.log(
    `[QA] ${slug}: ${summary.verdict} saved=${summary.savedCount}/${batchSize} complete=${completeCount}/${audits.length} (${Math.round(ms / 1000)}s)`,
  );
  return summary;
}

async function main() {
  const outDir = path.join(__dirname, '..', 'qa-results');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'ai-generator-sweep.jsonl');

  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGO_URI not set');
  await mongoose.connect(mongoUri);

  let slugs = onlySlug ? [onlySlug] : QA_TOOL_ORDER.filter((s) => AI_TOOL_ORDERED_SLUGS.includes(s));
  slugs = slugs.filter((s) => !skipSlugs.has(s));
  if (fromSlug) {
    const idx = slugs.indexOf(fromSlug);
    if (idx >= 0) slugs = slugs.slice(idx);
  }

  const results = [];
  for (const slug of slugs) {
    try {
      const summary = await runTool(slug);
      results.push(summary);
      fs.appendFileSync(outFile, `${JSON.stringify(summary)}\n`);
    } catch (err) {
      const fail = {
        at: new Date().toISOString(),
        slug,
        verdict: 'ERROR',
        message: String(err?.message || err).slice(0, 400),
      };
      results.push(fail);
      fs.appendFileSync(outFile, `${JSON.stringify(fail)}\n`);
      console.error(`[QA] ${slug} ERROR:`, err?.message || err);
    }
  }

  const pass = results.filter((r) => r.verdict === 'PASS').length;
  const weak = results.filter((r) => r.verdict === 'WEAK').length;
  const fail = results.filter((r) => r.verdict === 'FAIL' || r.verdict === 'ERROR').length;
  console.log(`\n[QA] Done — PASS ${pass} | WEAK ${weak} | FAIL/ERROR ${fail} | log: ${outFile}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
