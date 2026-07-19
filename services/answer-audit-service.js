/**
 * Answer-key audit for V2 six-section content.
 * Flash-Lite stable path: do NOT mutate content (no Indian rewrite / LLM rewrite by default).
 * Only deterministic reject gates for catastrophic failures.
 */

import geminiService from './gemini-service.js';
import { extractJsonObject } from '../utils/ai-json-extract.js';
import { GEMINI_LITE_MODEL } from './gemini-models.js';
import { validateMathAccuracy, tryAutoFixMcqAnswers } from '../utils/math-accuracy-gate.js';
import { validateSubtopicScope } from '../utils/subtopic-scope.js';
import {
  applyIndianNotationToStructured,
  shouldUseIndianNotation,
} from '../utils/indian-number-notation.js';

function auditEnabled(opts = {}) {
  if (opts.forceAudit === true) return true;
  if (opts.forceAudit === false) return false;
  const raw = String(process.env.AI_ANSWER_KEY_AUDIT ?? 'on').trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

function llmAuditEnabled(opts = {}) {
  if (opts.llmAudit === false) return false;
  if (opts.llmAudit === true) return true;
  const raw = String(process.env.AI_ANSWER_KEY_LLM_AUDIT ?? 'off').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'on';
}

/** Post-gen Indian rewrite caused 10,00,000 → 10,0 regressions. Default OFF. */
function indianRewriteEnabled(opts = {}) {
  if (opts.skipIndianNotation === true) return false;
  if (opts.forceIndianNotation === true) return true;
  const raw = String(process.env.AI_INDIAN_NOTATION_REWRITE ?? 'off').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'on';
}

function autoFixMcqEnabled(opts = {}) {
  if (opts.autoFixMcq === false) return false;
  if (opts.autoFixMcq === true) return true;
  const raw = String(process.env.AI_MATH_AUTO_FIX ?? 'on').trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

function compactCoreForAudit(structured) {
  const core = structured?.core || {};
  const assessment = structured?.assessment || {};
  return JSON.stringify(
    {
      core: {
        sectionA_mcq: core.sectionA_mcq,
        sectionB_fib: core.sectionB_fib,
        sectionC_short: core.sectionC_short,
        sectionD_application: core.sectionD_application,
        sectionE_long: core.sectionE_long,
      },
      answerKey: assessment.answerKey,
    },
    null,
    0,
  ).slice(0, 14000);
}

async function runLlmAnswerKeyAudit(structured, params = {}, opts = {}) {
  if (!llmAuditEnabled(opts)) return { ok: true, issues: [], skipped: true };

  const prompt = `You are a strict Indian school Maths/Science answer-key auditor.
Check ONLY factual/numerical correctness of answers vs questions (especially MCQs).
Ignore pedagogy, formatting, and style.

Return JSON only:
{"ok":true|false,"issues":["Q1: …"],"fixes":[{"qIndex":0,"correctAnswer":"B) …","working":"one-line correct working"}]}

CONTENT:
${compactCoreForAudit(structured)}

Class: ${params.classLabel || ''} Subject: ${params.subject || ''} Topic: ${params.topic || ''} Subtopic: ${params.subTopic || params.subtopic || ''}`;

  try {
    const raw = await geminiService.generateStructuredContent(prompt, 'json', {
      primaryModel: opts.auditModel || GEMINI_LITE_MODEL,
      flashLiteOnly: true,
      temperature: 0.1,
      maxTokens: 2500,
      isBatchVariant: true,
    });
    const json = extractJsonObject(raw) || {};
    const issues = Array.isArray(json.issues) ? json.issues.map(String).filter(Boolean) : [];
    return {
      ok: json.ok !== false && issues.length === 0,
      issues,
      fixes: Array.isArray(json.fixes) ? json.fixes : [],
      skipped: false,
    };
  } catch (err) {
    return {
      ok: true,
      issues: [],
      skipped: true,
      warning: err?.message || String(err),
    };
  }
}

function applyLlmFixes(structured, fixes = []) {
  if (!fixes.length || !structured?.core) return structured;
  const clone = JSON.parse(JSON.stringify(structured));
  const sections = [
    'sectionA_mcq',
    'sectionB_fib',
    'sectionC_short',
    'sectionD_application',
    'sectionE_long',
  ];
  const flat = [];
  for (const key of sections) {
    const arr = clone.core[key];
    if (!Array.isArray(arr)) continue;
    arr.forEach((q, i) => flat.push({ key, i, q }));
  }
  const keys = Array.isArray(clone.assessment?.answerKey) ? clone.assessment.answerKey : [];

  for (const fix of fixes) {
    const idx = Number(fix.qIndex);
    if (!Number.isFinite(idx) || idx < 0 || idx >= flat.length) continue;
    const target = flat[idx];
    const ans = String(fix.correctAnswer || '').trim();
    if (!ans) continue;
    clone.core[target.key][target.i].answer = ans;
    if (keys[idx]) {
      keys[idx].answer = ans;
      if (fix.working) keys[idx].working = String(fix.working);
    }
  }
  if (clone.assessment) clone.assessment.answerKey = keys;
  return clone;
}

/**
 * Full post-generation quality pipeline for V2 structured content.
 */
export async function runV2QualityPipeline(structured, params = {}, opts = {}) {
  const errors = [];
  const warnings = [];
  const fixes = [];
  let content = structured;

  // 1) Indian rewrite — OFF by default (was corrupting place-value). Prompt handles commas.
  if (
    indianRewriteEnabled(opts) &&
    shouldUseIndianNotation(params.classLabel, params.subject)
  ) {
    content = applyIndianNotationToStructured(content);
    fixes.push('applied Indian number notation');
  }

  // 2) Safe MCQ arithmetic auto-fix only (does not touch commas)
  if (autoFixMcqEnabled(opts)) {
    const auto = tryAutoFixMcqAnswers(content);
    if (auto.fixed) {
      content = auto.structured;
      fixes.push(...auto.fixes.map((f) => `auto-fix ${f}`));
    }
  }

  // 3) Hard math gate (wrong answers / Wait recalculate / broken notation)
  const math = validateMathAccuracy(content);
  errors.push(...math.errors);
  warnings.push(...math.warnings);

  // 4) Subtopic scope — warn only (hard-fail caused retry storms on Flash-Lite)
  const scope = validateSubtopicScope(content, params);
  if (opts.strictSubtopicScope === true) {
    errors.push(...scope.errors);
  } else {
    warnings.push(...scope.errors);
  }

  // 5) LLM audit — OFF by default
  let audit = { skipped: true };
  if (auditEnabled(opts) && llmAuditEnabled(opts) && (errors.length === 0 || opts.llmAuditAlways)) {
    audit = await runLlmAnswerKeyAudit(content, params, opts);
    if (!audit.skipped && audit.fixes?.length) {
      content = applyLlmFixes(content, audit.fixes);
      fixes.push(`llm-audit applied ${audit.fixes.length} fix(es)`);
      const math2 = validateMathAccuracy(content);
      errors.length = 0;
      errors.push(...math2.errors);
      warnings.push(...math2.warnings);
    }
    if (!audit.ok && audit.issues?.length) {
      errors.push(...audit.issues.map((i) => `LLM audit: ${i}`));
    }
  }

  return {
    ok: errors.length === 0,
    structuredContent: content,
    errors,
    warnings,
    fixes,
    audit,
  };
}

export default { runV2QualityPipeline };
