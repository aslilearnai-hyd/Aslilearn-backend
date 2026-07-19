/**
 * Unified V2 + serve-time + bulk quality audit for all curriculum tools.
 * Deterministic by default (no extra LLM). Optional LLM answer-key audit on create.
 */

import { runV2QualityPipeline } from './answer-key-audit-service.js';
import { mapV2StructuredToLegacy } from '../utils/v2-structured-to-legacy.js';
import {
  runAiGeneratorQualityGate,
  computeScaffoldDensity,
  SCAFFOLD_DENSITY_CEILING,
} from './ai-generator-quality-gate.js';
import { validateMathAccuracy } from '../utils/math-accuracy-gate.js';
import { validateSubtopicScope } from '../utils/subtopic-scope.js';
import { shouldUseIndianNotation } from '../utils/indian-number-notation.js';
import { v2ToolFamily } from '../prompts/v2/tool-packs.js';
import { detectBannedPhrase } from '../prompts/shared/banned-phrases.js';
import { isPromptEngineEnabled } from '../prompts/registry.js';

const PLACEHOLDER_RE = [
  /\bfor\s+this\s+subtopic\b/i,
  /\bplaceholder\b/i,
  /\bscaffold\b/i,
  /\btemplate\s+text\b/i,
  /\bstudents\s+explain\s+key\s+ideas\s+about\b/i,
  /\bstudents\s+recall\s+key\s+facts\s+about\b/i,
  /\ba\s+core\s+concept\s+from\b/i,
  /\bexpected\s+term\b/i,
  /\bteacher\s+to\s+add\b/i,
  /\bas\s+provided\s+in\s+the\s+textbook\b/i,
  /\bread\s+the\s+textbook\s+excerpt\b/i,
  /\bno\s+filler\s+content\b/i,
  /\bvalid\s+json\s+output\s+required\b/i,
];

const PROMPT_LEAK_RE = [
  /build questions directly from these passages/i,
  /it matches the textbook explanation/i,
  /book:\s*.+subject:\s*.+class:/i,
  /according to the chapter on .+, which choice reflects/i,
];

function blobHasPlaceholders(blob) {
  return PLACEHOLDER_RE.some((re) => re.test(blob));
}

function blobHasPromptLeak(blob) {
  if (PROMPT_LEAK_RE.some((re) => re.test(blob))) return true;
  const readyHits = blob.match(/\bReady\b/gi);
  return Boolean(readyHits && readyHits.length >= 4);
}

/** Non-math density / placeholder / leak checks for any V2 family. */
export function validateV2ContentDensity(structured, toolSlug = '') {
  const errors = [];
  const warnings = [];
  if (!structured || typeof structured !== 'object') {
    return { valid: false, errors: ['Missing structured content'], warnings };
  }

  const blob = JSON.stringify(structured);
  if (blobHasPlaceholders(blob)) {
    errors.push('Placeholder / scaffold phrasing detected in V2 content');
  }
  if (blobHasPromptLeak(blob)) {
    errors.push('Prompt/RAG chrome leaked into V2 content');
  }
  if (isPromptEngineEnabled()) {
    const banned = detectBannedPhrase(blob);
    if (banned?.banned) {
      errors.push(`Banned phrase: ${banned.reason || 'detected'}`);
    }
  }

  const core = structured.core;
  if (!core || typeof core !== 'object') {
    errors.push('V2 core section missing');
    return { valid: false, errors, warnings };
  }

  const family = v2ToolFamily(toolSlug) || '';
  const coreStr = JSON.stringify(core);
  if (coreStr.length < 180) {
    errors.push('V2 core content too thin');
  }

  // Family-specific minimums
  if (family === 'questions') {
    const mcq = Array.isArray(core.sectionA_mcq) ? core.sectionA_mcq.length : 0;
    const fib = Array.isArray(core.sectionB_fib) ? core.sectionB_fib.length : 0;
    const short = Array.isArray(core.sectionC_short) ? core.sectionC_short.length : 0;
    if (mcq + fib + short < 3) {
      errors.push('Questions family: fewer than 3 items across MCQ/FIB/short');
    }
  }
  if (family === 'cards') {
    const cards = Array.isArray(core.cards) ? core.cards : Array.isArray(core.flashcards) ? core.flashcards : [];
    if (cards.length < 5) {
      // Some packs put cards under different keys — soft warn if none found in core JSON
      if (!/\bfront\b/i.test(coreStr) || !/\bback\b/i.test(coreStr)) {
        warnings.push('Cards family: front/back pairs look sparse');
      }
    }
  }
  if (family === 'explain' || family === 'plan') {
    const assessment = structured.assessment;
    if (!assessment || typeof assessment !== 'object') {
      warnings.push(`${family}: assessment section thin or missing`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * After V2 → legacy map, run scaffold density + production quality gate (strict).
 * Soft for families where legacy map is intentionally partial.
 */
export function validateV2MappedLegacy(toolSlug, v2Structured, meta = {}) {
  const errors = [];
  const warnings = [];
  let legacy = null;
  try {
    legacy = mapV2StructuredToLegacy(toolSlug, v2Structured);
  } catch (err) {
    warnings.push(`Legacy map failed: ${err?.message || err}`);
    return { valid: true, errors, warnings, legacy: null };
  }
  if (!legacy || typeof legacy !== 'object') {
    warnings.push('No legacy mapping for tool — density check skipped');
    return { valid: true, errors, warnings, legacy: null };
  }

  const density = computeScaffoldDensity(toolSlug, legacy);
  if (density && Number(density.ratio) > SCAFFOLD_DENSITY_CEILING) {
    errors.push(
      `Scaffold density ${(density.ratio * 100).toFixed(0)}% exceeds ceiling ${(SCAFFOLD_DENSITY_CEILING * 100).toFixed(0)}%`,
    );
  }

  const gate = runAiGeneratorQualityGate(toolSlug, legacy, {
    ...meta,
    strictValidation: true,
    batchOrchestrator: false,
    bookGenerator: false,
  });
  if (!gate.valid) {
    // Map failures that are clearly bad; treat "missing sections" from incomplete maps as warnings
    const hard = (gate.errors || []).filter(
      (e) =>
        /placeholder|scaffold|banned|leak|title is missing|too short|too thin/i.test(String(e)) ||
        /Missing sections/i.test(String(e)) === false,
    );
    const soft = (gate.errors || []).filter((e) => !hard.includes(e));
    errors.push(...hard.map((e) => `Legacy gate: ${e}`));
    warnings.push(...soft.map((e) => `Legacy gate soft: ${e}`));
  }

  return { valid: errors.length === 0, errors, warnings, legacy };
}

/**
 * Full create-time audit for V2 structured content.
 */
export async function auditV2Generation(toolSlug, structured, params = {}, opts = {}) {
  const errors = [];
  const warnings = [];
  const fixes = [];
  let content = structured;

  const pipeline = await runV2QualityPipeline(content, params, opts);
  content = pipeline.structuredContent;
  errors.push(...(pipeline.errors || []));
  warnings.push(...(pipeline.warnings || []));
  fixes.push(...(pipeline.fixes || []));

  const density = validateV2ContentDensity(content, toolSlug);
  errors.push(...density.errors);
  warnings.push(...density.warnings);

  let legacyResult = { valid: true, errors: [], warnings: [], legacy: null };
  if (opts.skipLegacyScaffold !== true) {
    legacyResult = validateV2MappedLegacy(toolSlug, content, {
      subject: params.subject,
      topic: params.topic,
      subTopic: params.subTopic || params.subtopic,
    });
    errors.push(...legacyResult.errors);
    warnings.push(...legacyResult.warnings);
  }

  return {
    ok: errors.length === 0,
    structuredContent: content,
    legacyStructured: legacyResult.legacy,
    errors,
    warnings,
    fixes,
    audit: pipeline.audit,
  };
}

/**
 * Deterministic audit of a stored AiToolGeneration (or similar) document.
 * Used at teacher/student serve time and bulk re-audit — no LLM by default.
 */
export function auditStoredGenerationDoc(doc = {}) {
  const errors = [];
  const warnings = [];
  const toolSlug = String(doc.toolName || doc.toolSlug || '').trim();
  const meta = doc.metadata && typeof doc.metadata === 'object' ? doc.metadata : {};
  const v2 = meta.structuredContent?.schema === 'asli-v2-six-section' || meta.schemaVersion === 'asli-v2-six-section'
    ? meta.structuredContent
    : meta.structuredContent?.core && meta.structuredContent?.assessment
      ? meta.structuredContent
      : null;

  const params = {
    classLabel: doc.classLabel || meta.classLabel,
    subject: doc.subject || meta.subject,
    topic: doc.topic || meta.topic,
    subTopic: doc.subtopic || meta.subtopic,
    chapterScope: !String(doc.subtopic || meta.subtopic || '').trim(),
  };

  if (v2 && v2.core) {
    let content = v2;
    if (shouldUseIndianNotation(params.classLabel, params.subject)) {
      // Notation rewrite is create-time; at serve we only flag Western commas in Maths
      const blob = JSON.stringify(v2);
      if (/\b\d{1,3}(?:,\d{3}){2,}\b/.test(blob) && /math|mathematics|arith/i.test(String(params.subject || ''))) {
        warnings.push('Western thousand commas present in Maths content');
      }
    }
    const math = validateMathAccuracy(content);
    errors.push(...math.errors);
    warnings.push(...math.warnings);
    const scope = validateSubtopicScope(content, params);
    errors.push(...scope.errors);
    const density = validateV2ContentDensity(content, toolSlug);
    errors.push(...density.errors);
    warnings.push(...density.warnings);
  } else if (meta.structuredContent && typeof meta.structuredContent === 'object') {
    // Serve-time legacy: block only clear scaffold/leak/placeholder — not incomplete field maps.
    const legacyBlob = JSON.stringify(meta.structuredContent);
    if (blobHasPlaceholders(legacyBlob) || blobHasPromptLeak(legacyBlob)) {
      errors.push('Legacy content has placeholder or prompt-leak phrasing');
    }
    const density = computeScaffoldDensity(toolSlug, meta.structuredContent);
    if (density && Number(density.ratio) > SCAFFOLD_DENSITY_CEILING) {
      errors.push(`Legacy scaffold density ${(density.ratio * 100).toFixed(0)}% too high`);
    }
    if (isPromptEngineEnabled()) {
      const banned = detectBannedPhrase(legacyBlob);
      if (banned?.banned) errors.push(`Banned phrase: ${banned.reason || 'detected'}`);
    }
  } else {
    const text = String(doc.generatedContent || doc.content || '').trim();
    if (text.length < 80) errors.push('Stored content too short');
    if (blobHasPlaceholders(text)) errors.push('Placeholder phrasing in stored content');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    toolSlug,
    recordId: String(doc._id || ''),
    checkedAt: new Date().toISOString(),
  };
}

/** True if any retrieved chunk looks like Concept Practice / worked example / error table. */
export function chunksHavePracticeGrounding(chunks = []) {
  return (chunks || []).some((c) => {
    const text = String(c.content || c.chunkText || '').toLowerCase();
    return /concept\s*practice|try\s*these|worked\s*example|common\s*(error|mistake)|misconception|exercise\s*\d/i.test(
      text,
    );
  });
}

export function practiceGroundingRequired(toolSlug, scope = {}) {
  if (!scope.useBookKnowledge && scope.useBookKnowledge !== undefined) return false;
  const family = v2ToolFamily(toolSlug);
  if (family !== 'questions' && family !== 'explain') return false;
  const raw = String(process.env.BOOK_RAG_REQUIRE_PRACTICE ?? 'on').trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

export default {
  validateV2ContentDensity,
  validateV2MappedLegacy,
  auditV2Generation,
  auditStoredGenerationDoc,
  chunksHavePracticeGrounding,
  practiceGroundingRequired,
};
