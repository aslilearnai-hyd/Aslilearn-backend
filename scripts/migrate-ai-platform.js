/**
 * Phase 3: Establish backend/ai/ layout.
 * Moves AI modules into domain folders; leaves shim re-exports at old paths.
 *
 * Run: node scripts/migrate-ai-platform.js
 * Idempotent: skips if ai/.migration-done exists (delete that file to re-run).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const marker = path.join(root, 'ai', '.migration-done');

if (fs.existsSync(marker)) {
  console.log('Migration already done (ai/.migration-done). Delete marker to re-run.');
  process.exit(0);
}

/** @type {Array<[string, string]>} oldRel → newRel (posix, relative to backend/) */
const MOVES = [];

function add(oldRel, newRel) {
  MOVES.push([oldRel.replace(/\\/g, '/'), newRel.replace(/\\/g, '/')]);
}

function addDir(oldDir, newDir, filter = (f) => f.endsWith('.js') || f.endsWith('.md') || f.endsWith('.cjs')) {
  const abs = path.join(root, oldDir);
  if (!fs.existsSync(abs)) return;
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      addDir(path.join(oldDir, ent.name), path.join(newDir, ent.name), filter);
    } else if (filter(ent.name)) {
      add(path.join(oldDir, ent.name), path.join(newDir, ent.name));
    }
  }
}

// --- Prompt platform ---
add('prompts/create-tool-prompt-pack.js', 'ai/prompt-engine/create-tool-prompt-pack.js');
addDir('prompts/shared', 'ai/prompt-engine/shared');
add('prompts/quality-content-check.js', 'ai/quality-gates/quality-content-check.js');
add('prompts/registry.js', 'ai/prompt-registry/registry.js');
add('prompts/types.js', 'ai/prompt-registry/types.js');
add('prompts/README.md', 'ai/prompt-registry/README.md');
addDir('prompts/tools', 'ai/prompt-registry/tools');
addDir('prompts/v2', 'ai/prompt-versioning');

// --- Providers ---
add('services/gemini-service.js', 'ai/providers/gemini-service.js');
add('services/gemini-models.js', 'ai/providers/gemini-models.js');
add('services/model-router.js', 'ai/providers/model-router.js');
add('services/gemini-service.cjs', 'ai/providers/gemini-service.cjs');
add('utils/gemini-token-cost.js', 'ai/providers/gemini-token-cost.js');

// --- Quality / validation / repair ---
add('services/ai-generator-quality-gate.js', 'ai/quality-gates/ai-generator-quality-gate.js');
add('services/ai-generator-section-repair.js', 'ai/repair/ai-generator-section-repair.js');
add('services/ai-tool-dashboard-validation.js', 'ai/validation/ai-tool-dashboard-validation.js');
add('services/exam-paper-pipeline-validator.js', 'ai/validation/exam-paper-pipeline-validator.js');
add('services/pdf-extract-validation.js', 'ai/validation/pdf-extract-validation.js');
add('utils/ai-generator-post-validation.js', 'ai/validation/ai-generator-post-validation.js');
add('utils/ai-generator-quality-tier.js', 'ai/quality-gates/ai-generator-quality-tier.js');
add('utils/ai-generator-section-pad.js', 'ai/repair/ai-generator-section-pad.js');
add('utils/ai-generator-section-fallbacks.js', 'ai/repair/ai-generator-section-fallbacks.js');

// --- Generators (core + shared satellites) ---
add('services/ai-content-engine-service.js', 'ai/generators/core/ai-content-engine-service.js');
add('services/six-section-generator.js', 'ai/generators/_v2/six-section-generator.js');
add('services/ai-generator-batch-orchestrator.js', 'ai/generators/_batch/ai-generator-batch-orchestrator.js');
add('services/book-generator-batch-orchestrator.js', 'ai/generators/_batch/book-generator-batch-orchestrator.js');
add('services/book-generator-job-service.js', 'ai/generators/_batch/book-generator-job-service.js');
add('services/book-generator-historical.js', 'ai/generators/_batch/book-generator-historical.js');
add('services/ai-diagram-generation-service.js', 'ai/generators/diagrams/ai-diagram-generation-service.js');
add('config/bookBasedTools.js', 'ai/generators/shared/bookBasedTools.js');
add('constants/ai-generator-variant-angles.js', 'ai/generators/shared/ai-generator-variant-angles.js');

const generatorShared = [
  'ai-generator-content-strategy.js',
  'ai-generator-content-extractor.js',
  'ai-generator-fingerprint-service.js',
  'ai-generator-historical-index.js',
  'ai-generator-lock-service.js',
  'ai-generator-random-retrieval.js',
  'ai-generator-topic-saturation.js',
  'ai-generator-uniqueness-engine.js',
  'ai-generator-audit-service.js',
  'ai-tool-rotation-service.js',
  'ai-tool-duplicates-service.js',
  'ai-tool-data-audit-service.js',
];
for (const f of generatorShared) {
  add(`services/${f}`, `ai/generators/shared/${f}`);
}
addDir('services/tool-formatters', 'ai/generators/_formatters');

const generatorUtils = [
  'ai-generator-batch-config.js',
  'ai-generator-dedup.js',
  'ai-generator-llm-budget.js',
  'ai-generator-response-schema.js',
  'build-ai-tool-raw-data.js',
  'practice-qa-topic-bank.js',
  'generator-subtopic-label.js',
  'subject-topic-fact-bank.js',
];
for (const f of generatorUtils) {
  const src = path.join(root, 'utils', f);
  if (fs.existsSync(src)) add(`utils/${f}`, `ai/generators/shared/${f}`);
}

// --- RAG ---
add('services/pdf-rag-service.js', 'ai/rag/pdf/pdf-rag-service.js');
add('services/pdf-content-engine.js', 'ai/rag/pdf/pdf-content-engine.js');
add('services/pdf-knowledge-pipeline.js', 'ai/rag/pdf/pdf-knowledge-pipeline.js');
add('services/pdf-knowledge-extractor.js', 'ai/rag/pdf/pdf-knowledge-extractor.js');
add('services/pdf-content-classifier.js', 'ai/rag/pdf/pdf-content-classifier.js');
add('services/pdf-content-cleaner.js', 'ai/rag/pdf/pdf-content-cleaner.js');
add('services/pdf-canonical-extract.js', 'ai/rag/pdf/pdf-canonical-extract.js');
add('services/pdf-canonical-mapper.js', 'ai/rag/pdf/pdf-canonical-mapper.js');
add('services/pdf-canonical-normalize.js', 'ai/rag/pdf/pdf-canonical-normalize.js');
add('services/pdf-generation-splitter.js', 'ai/rag/pdf/pdf-generation-splitter.js');
add('services/pdf-tool-extract.js', 'ai/rag/pdf/pdf-tool-extract.js');
add('services/pdf-extract-utils.js', 'ai/rag/pdf/shared/pdf-extract-utils.js');
add('services/pdf-extractor-service.js', 'ai/rag/pdf/pdf-extractor-service.js');
add('services/curiosity-activity-pdf-parser.js', 'ai/rag/pdf/curiosity-activity-pdf-parser.js');
add('services/activity-title-utils.js', 'ai/rag/pdf/activity-title-utils.js');
add('services/activity-section-headers.js', 'ai/rag/pdf/activity-section-headers.js');
add('queues/pdfProcessingQueue.js', 'ai/rag/pdf/pdfProcessingQueue.js');

const pdfExtracts = fs
  .readdirSync(path.join(root, 'services'))
  .filter((f) => /^pdf-.*extract\.js$/.test(f) || f.startsWith('pdf-assignment-'));
for (const f of pdfExtracts) {
  add(`services/${f}`, `ai/rag/pdf/extract/${f}`);
}
add('services/pdf-activity-canonical-parse.js', 'ai/rag/pdf/extract/pdf-activity-canonical-parse.js');

add('services/book-rag-service.js', 'ai/rag/books/book-rag-service.js');
add('services/book-ingestion-service.js', 'ai/rag/books/book-ingestion-service.js');
add('utils/book-grounded-record.js', 'ai/rag/books/book-grounded-record.js');

add('services/curriculum-context-service.js', 'ai/rag/retrieval/curriculum-context-service.js');
add('services/vidya-retriever.js', 'ai/rag/retrieval/vidya-retriever.js');

// --- Shared AI utils ---
add('utils/ai-json-extract.js', 'ai/shared/ai-json-extract.js');
for (const f of [
  'ai-tool-topic-taxonomy.js',
  'ai-tool-topic-order.js',
  'ai-tool-topic-display.js',
  'ai-tool-subject-rules.js',
  'ai-tool-data-match.js',
  'ai-tool-record-sort.js',
  'sanitize-ai-question-display.js',
  'classroom-text-format.js',
  'story-passage-subject.js',
]) {
  if (fs.existsSync(path.join(root, 'utils', f))) {
    add(`utils/${f}`, `ai/shared/${f}`);
  }
}

// Deduplicate MOVES (last wins for same old path — skip dup bookBasedTools)
const byOld = new Map();
for (const [o, n] of MOVES) byOld.set(o, n);
const uniqueMoves = [...byOld.entries()];

/** Map oldRel → newRel for lookup */
const moveMap = new Map(uniqueMoves);

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function relImportBetween(fromFile, toFile) {
  let rel = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

function rewriteImports(content, oldRel, newRel) {
  const importRe =
    /((?:import|export)\s+(?:type\s+)?(?:[^'"\n]*?\s+from\s+)?|import\s*\(\s*|await\s+import\s*\(\s*)(['"])(\.[^'"]+)\2/g;

  return content.replace(importRe, (full, prefix, quote, spec) => {
    // Resolve old absolute-ish target
    const oldAbs = path.normalize(path.join(root, path.dirname(oldRel), spec));
    let oldTargetRel = path.relative(root, oldAbs).replace(/\\/g, '/');
    // Try with .js if missing
    if (!moveMap.has(oldTargetRel) && !fs.existsSync(path.join(root, oldTargetRel))) {
      if (!oldTargetRel.endsWith('.js') && !oldTargetRel.endsWith('.cjs')) {
        const withJs = oldTargetRel + '.js';
        if (moveMap.has(withJs) || fs.existsSync(path.join(root, withJs))) {
          oldTargetRel = withJs;
        }
      }
    }

    let newTargetRel;
    if (moveMap.has(oldTargetRel)) {
      newTargetRel = moveMap.get(oldTargetRel);
    } else {
      // Target stayed put — point from new location to original file
      newTargetRel = oldTargetRel;
    }

    const newSpec = relImportBetween(newRel, newTargetRel);
    // Preserve extension as in original spec when possible
    let outSpec = newSpec;
    if (spec.endsWith('.js') && !outSpec.endsWith('.js') && !outSpec.endsWith('.cjs')) {
      outSpec += '.js';
    }
    if (spec.endsWith('.cjs') && !outSpec.endsWith('.cjs')) {
      outSpec += '.cjs';
    }
    return `${prefix}${quote}${outSpec}${quote}`;
  });
}

function makeShim(oldRel, newRel) {
  let spec = relImportBetween(oldRel, newRel);
  if (!spec.endsWith('.js') && !spec.endsWith('.cjs') && !spec.endsWith('.md')) {
    spec += path.extname(newRel) || '.js';
  }
  return `export { default } from '${spec}';\nexport * from '${spec}';\n`;
}

function makeCjsShim(oldRel, newRel) {
  let req = relImportBetween(oldRel, newRel);
  if (!req.endsWith('.cjs') && !req.endsWith('.js')) {
    req += path.extname(newRel) || '.cjs';
  }
  return `module.exports = require('${req}');\n`;
}

let moved = 0;
let skipped = 0;

for (const [oldRel, newRel] of uniqueMoves) {
  const oldAbs = path.join(root, oldRel);
  const newAbs = path.join(root, newRel);
  if (!fs.existsSync(oldAbs)) {
    console.warn('missing', oldRel);
    skipped++;
    continue;
  }
  // Already a shim?
  const existing = fs.readFileSync(oldAbs, 'utf8');
  if (existing.includes('export { default } from') && existing.length < 200 && existing.includes('/ai/')) {
    console.log('skip shim', oldRel);
    skipped++;
    continue;
  }
  if (fs.existsSync(newAbs) && newAbs !== oldAbs) {
    // already migrated physical file
    if (!existing.includes(`from '${relImportBetween(oldRel, newRel)}'`) && existing.length > 500) {
      // old still has full content — continue
    } else {
      skipped++;
      continue;
    }
  }

  let content = fs.readFileSync(oldAbs, 'utf8');
  if (oldRel.endsWith('.js') || oldRel.endsWith('.cjs')) {
    content = rewriteImports(content, oldRel, newRel);
  }

  ensureDir(newAbs);
  fs.writeFileSync(newAbs, content);

  // Write shim at old path
  const shim = oldRel.endsWith('.cjs') ? makeCjsShim(oldRel, newRel) : makeShim(oldRel, newRel);
  // For .md just leave a pointer
  if (oldRel.endsWith('.md')) {
    fs.writeFileSync(oldAbs, `# Moved\n\nSee [\`${newRel}\`](../${newRel}).\n`);
  } else {
    fs.writeFileSync(oldAbs, shim);
  }
  moved++;
  console.log('moved', oldRel, '→', newRel);
}

// Fix prompt-registry tools: they imported ../create-tool-prompt-pack — rewrite should handle via moveMap
// Fix quality-content-check: ./shared → prompt-engine/shared
// Fix create-tool-prompt-pack: ./shared stays in prompt-engine

// Special: bookBasedTools was listed twice — ensure generators/shared has it; shim config/
const bookCfgOld = path.join(root, 'config/bookBasedTools.js');
const bookCfgNew = path.join(root, 'ai/generators/shared/bookBasedTools.js');
if (fs.existsSync(bookCfgOld) && fs.statSync(bookCfgOld).size > 200) {
  // if still full file
} else if (!fs.existsSync(bookCfgNew) && fs.existsSync(path.join(root, 'ai/rag/books/bookBasedTools.js'))) {
  // ok
}

// Streaming façade
fs.mkdirSync(path.join(root, 'ai/streaming'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'ai/streaming/index.js'),
  `/** LLM SSE streaming — re-exported from providers/model-router */
export { streamGeminiModel } from '../providers/model-router.js';
`,
);

// Embeddings façade (still implemented inside pdf-rag-service for now)
fs.mkdirSync(path.join(root, 'ai/rag/embeddings'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'ai/rag/embeddings/index.js'),
  `/**
 * Embedding API — currently provided by pdf-rag-service.
 * Future: extract generateEmbedding here for shared use by books + pdf + vidya.
 */
export { generateEmbedding, retrieveRelevantChunks } from '../pdf/pdf-rag-service.js';
`,
);

// Generators barrel
fs.writeFileSync(
  path.join(root, 'ai/generators/index.js'),
  `/** Content engine façade — full split per tool is a follow-up */
export * from './core/ai-content-engine-service.js';
export { default } from './core/ai-content-engine-service.js';
`,
);

// Top-level README
fs.writeFileSync(
  path.join(root, 'ai/README.md'),
  `# ASLILEARN AI Platform

Domain layout for prompts, generators, RAG, providers, and quality systems.

\`\`\`
ai/
├── prompt-engine/       # Pack factory + shared prompt layers
├── prompt-registry/     # Per-tool prompt packs + registry
├── prompt-versioning/   # V2 six-section assembler
├── generators/          # Tool generation (core monolith + shared/batch)
│   ├── core/            # ai-content-engine-service (split per tool later)
│   ├── _batch/          # Batch orchestrators
│   ├── _formatters/     # Slug → render/canonicalize
│   ├── _v2/             # Six-section generator
│   ├── diagrams/
│   └── shared/
├── rag/
│   ├── pdf/             # PDF RAG, extractors, queue
│   ├── books/           # Book KB ingest + retrieval
│   ├── embeddings/      # Façade over pdf-rag embeddings
│   └── retrieval/       # Curriculum + Vidya retrievers
├── validation/
├── quality-gates/
├── repair/
├── streaming/           # SSE helpers
├── providers/           # Gemini, model-router, token cost
└── shared/              # Cross-cutting AI utils
\`\`\`

**Compatibility:** Old paths under \`services/\`, \`prompts/\`, \`utils/\`, \`config/\` re-export from here so existing imports keep working.

**Follow-ups:** Split \`ai-content-engine-service.js\` and \`config/aiToolTemplates.js\` per tool; extract embeddings from pdf-rag; thin \`routes/pdf-rag.js\`.
`,
);

fs.writeFileSync(
  path.join(root, 'ai/index.js'),
  `/**
 * ASLILEARN AI platform entry (optional barrel).
 * Prefer deep imports: ai/providers/..., ai/generators/..., etc.
 */
export * as providers from './providers/gemini-service.js';
export * as promptRegistry from './prompt-registry/registry.js';
`,
);

fs.writeFileSync(marker, new Date().toISOString() + `\nmoved=${moved}\n`);
console.log(`\nDone. moved=${moved} skipped=${skipped}`);
