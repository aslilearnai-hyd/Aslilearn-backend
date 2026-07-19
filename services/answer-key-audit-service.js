/**
 * Answer-key audit for V2 six-section content.
 * 1) Deterministic math/scope gates (always).
 * 2) Optional second-pass Gemini audit when AI_ANSWER_KEY_AUDIT=on (default on for book RAG).
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
  const raw = String(process.env.AI_ANSWER_KEY_LLM_AUDIT ?? 'on').trim().toLowerCase();
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

/**
 * Dual-LLM / second-pass: ask a cheap model to list hard errors only.
 * Returns { ok, issues[], correctedAnswerKey? }.
 */
async function runLlmAnswerKeyAudit(structured, params = {}, opts = {}) {
  if (!llmAuditEnabled(opts)) return { ok: true, issues: [], skipped: true };

  const prompt = `You are a strict Indian school Maths/Science answer-key auditor.
Check ONLY factual/numerical correctness of answers vs questions (especially MCQs).
Ignore pedagogy, formatting, and style.

Return JSON only:
{"ok":true|false,"issues":["Q1: …"],"fixes":[{"qIndex":0,"correctAnswer":"B) …","working":"one-line correct working"}]}

Rules:
- ok=false if any MCQ letter is wrong, any numerical answer is wrong, or working contradicts the selected answer.
- Prefer Indian number commas (12,34,567) and place names (lakh/crore) in fixes for Class 6-8.
- Empty issues array if everything is correct.
- qIndex is 0-based across all questions in order (A→E).

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
    // Soft-fail LLM audit — deterministic gates still apply.
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
 * @returns {Promise<{ ok:boolean, structuredContent:object, errors:string[], warnings:string[], fixes:string[], audit:object }>}
 */
export async function runV2QualityPipeline(structured, params = {}, opts = {}) {
  const errors = [];
  const warnings = [];
  const fixes = [];
  let content = structured;

  // 1) Indian notation (Classes 6–10 Maths / school default)
  if (shouldUseIndianNotation(params.classLabel, params.subject) && opts.skipIndianNotation !== true) {
    content = applyIndianNotationToStructured(content);
    fixes.push('applied Indian number notation');
  }

  // 2) Deterministic auto-fix for unambiguous MCQ arithmetic
  const auto = tryAutoFixMcqAnswers(content);
  if (auto.fixed) {
    content = auto.structured;
    fixes.push(...auto.fixes.map((f) => `auto-fix ${f}`));
  }

  // 3) Hard math gate
  const math = validateMathAccuracy(content);
  errors.push(...math.errors);
  warnings.push(...math.warnings);

  // 4) Strict subtopic scope
  const scope = validateSubtopicScope(content, params);
  errors.push(...scope.errors);

  // 5) Optional LLM second-pass (only if deterministic still clean or forced)
  let audit = { skipped: true };
  if (auditEnabled(opts) && (errors.length === 0 || opts.llmAuditAlways)) {
    audit = await runLlmAnswerKeyAudit(content, params, opts);
    if (!audit.skipped && audit.fixes?.length) {
      content = applyLlmFixes(content, audit.fixes);
      // Re-run notation after LLM fixes
      if (shouldUseIndianNotation(params.classLabel, params.subject)) {
        content = applyIndianNotationToStructured(content);
      }
      fixes.push(`llm-audit applied ${audit.fixes.length} fix(es)`);
      const math2 = validateMathAccuracy(content);
      // Replace prior math errors with post-fix result
      errors.length = 0;
      errors.push(...math2.errors);
      warnings.push(...math2.warnings);
    }
    if (!audit.ok && audit.issues?.length) {
      errors.push(...audit.issues.map((i) => `LLM audit: ${i}`));
    }
  }

  const ok = errors.length === 0;
  return {
    ok,
    structuredContent: content,
    errors,
    warnings,
    fixes,
    audit,
  };
}

export default { runV2QualityPipeline };
