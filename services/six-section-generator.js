/**
 * V2 six-section content generator (pilot).
 * Assembles the master/tool/board/RAG/IIT prompt, calls Gemini for strict JSON,
 * parses it, and returns semantic structuredContent (six sections). Rendering is
 * the frontend's job (SixSectionViewer) — this service does content only.
 */

import geminiService from './gemini-service.js';
import { extractJsonObject } from '../utils/ai-json-extract.js';
import { getAiGeneratorGeminiModel } from '../utils/ai-generator-batch-config.js';
import { assembleSixSectionPrompt } from '../prompts/v2/assemble.js';
import { V2_SECTION_IDS } from '../prompts/v2/master-prompt.js';

function hasAllSixSections(json) {
  if (!json || typeof json !== 'object') return false;
  return V2_SECTION_IDS.every((id) => json[id] && typeof json[id] === 'object');
}

// Guaranteed clean math: convert Unicode math glyphs to ASCII and strip corruption
// artifacts (U+FFFD) so nothing garbles in the UI or the PDF's Helvetica font — even
// if the model ignores the ASCII-math prompt rule.
// The generation pipeline corrupts characters ABOVE Latin-1 (superscript charge
// signs ⁺⁻, subscripts, arrows →, roots √, Greek Δπθ) into garbage/mojibake, while
// Latin-1 (² ³ ° ± × ½) survives and renders fine. So: convert every above-Latin-1
// symbol to safe ASCII, KEEP Latin-1, then strip any remaining non-Latin-1 bytes
// (mojibake/replacement chars). Result stays clean even if the model emits Unicode.
const MATH_UNICODE_MAP = {
  '→': '->', '←': '<-', '↔': '<->', '⇌': '<=>', '⇋': '<=>', '⇒': '=>', '⇔': '<=>',
  '√': 'sqrt', '∛': 'cbrt', '∑': 'sum', '∏': 'product', '∫': 'integral', '∂': 'd', '∇': 'grad', '∞': 'infinity',
  '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~=', '≡': '=',
  '⁰': '^0', '⁴': '^4', '⁵': '^5', '⁶': '^6', '⁷': '^7', '⁸': '^8', '⁹': '^9', '⁺': '+', '⁻': '-', 'ⁿ': '^n',
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '₊': '+', '₋': '-',
  'Δ': 'delta ', '∆': 'delta ', 'π': 'pi', 'θ': 'theta', 'α': 'alpha', 'β': 'beta', 'γ': 'gamma',
  'λ': 'lambda', 'μ': 'mu', 'Ω': 'ohm', 'Σ': 'sum', 'Π': 'product',
  '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '′': "'", '″': '"',
};
// Latin-1 MATH symbols that render fine and are legitimate (° ± ² ³ µ · ¹ ¼ ½ ¾ × ÷).
// Everything else in Latin-1 (accented LETTERS À Â Ã Æ é …) is mojibake in our
// English/math content, so it is dropped.
const KEEP_LATIN1 = new Set([0xb0, 0xb1, 0xb2, 0xb3, 0xb5, 0xb7, 0xb9, 0xbc, 0xbd, 0xbe, 0xd7, 0xf7]);

function sanitizeMathString(s) {
  let t = String(s);
  for (const u of Object.keys(MATH_UNICODE_MAP)) {
    if (t.indexOf(u) !== -1) t = t.split(u).join(MATH_UNICODE_MAP[u]);
  }
  // Keep tab/newline/CR + printable ASCII + math symbols + Devanagari + Telugu.
  // Drop control chars, replacement chars, mojibake accented letters, and garbage.
  let out = '';
  for (const ch of t) {
    const c = ch.codePointAt(0);
    if (
      c === 9 || c === 10 || c === 13 ||
      (c >= 0x20 && c <= 0x7e) || // printable ASCII
      KEEP_LATIN1.has(c) || // math-only Latin-1 symbols
      (c >= 0x900 && c <= 0x97f) || // Devanagari (Hindi)
      (c >= 0xc00 && c <= 0xc7f) // Telugu
    )
      out += ch;
  }
  return out;
}

/** How much genuine garbage a raw model response has (replacement chars +
 *  un-mappable above-Latin-1 that is not Hindi/Telugu). High = a garbled generation. */
function rawGarbageScore(raw) {
  let bad = 0;
  for (const ch of String(raw)) {
    const c = ch.codePointAt(0);
    if (c === 0xfffd) {
      bad += 1;
    } else if (
      c > 0xff &&
      !(c >= 0x900 && c <= 0x97f) &&
      !(c >= 0xc00 && c <= 0xc7f) &&
      MATH_UNICODE_MAP[ch] === undefined
    ) {
      bad += 1;
    }
  }
  return bad;
}
function deepSanitizeMath(val) {
  if (typeof val === 'string') return sanitizeMathString(val);
  if (Array.isArray(val)) return val.map(deepSanitizeMath);
  if (val && typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = deepSanitizeMath(v);
    return out;
  }
  return val;
}

/**
 * @param {string} toolSlug
 * @param {object} params { board, classLabel, subject, topic, subTopic }
 * @param {{ ragContext?:string, primaryModel?:string }} [opts]
 * @returns {Promise<{ ok:boolean, structuredContent?:object, error?:string }>}
 */
export async function generateSixSectionContent(toolSlug, params = {}, opts = {}) {
  const assembled = assembleSixSectionPrompt(toolSlug, params, opts);
  if (!assembled.supported) {
    return { ok: false, error: `Tool "${toolSlug}" is not V2-enabled yet.` };
  }

  const model = opts.primaryModel || getAiGeneratorGeminiModel();
  const baseTemp =
    Number.isFinite(opts.temperature) && opts.temperature > 0 && opts.temperature <= 1.2
      ? opts.temperature
      : 0.55;
  // Ceiling only — you pay for tokens actually generated, so a high cap just
  // prevents truncated JSON on large outputs (e.g. a 25-question worksheet with a
  // full answer key). Overridable per call.
  const maxTokens =
    Number.isFinite(opts.maxTokens) && opts.maxTokens > 0 ? opts.maxTokens : 14000;

  // Lighter models (gemini-3.1-flash-lite) intermittently return incomplete JSON
  // (a missing section). Retry a few times — cheap on Flash-Lite (~₹0.1/call) — and
  // lower the temperature on retries for more reliable structure. This keeps the
  // cheapest model usable without ever falling to a costlier one.
  const maxTries = Number.isFinite(opts.maxTries) && opts.maxTries > 0 ? opts.maxTries : 3;
  let lastRaw = '';
  for (let attempt = 1; attempt <= maxTries; attempt += 1) {
    const temperature =
      attempt === 1 ? baseTemp : Math.max(0.3, baseTemp - 0.2 * (attempt - 1));
    const raw = await geminiService.generateStructuredContent(assembled.prompt, 'json', {
      primaryModel: model,
      temperature,
      maxTokens,
    });
    lastRaw = raw;
    const json = extractJsonObject(raw);
    if (hasAllSixSections(json)) {
      // Reject a visibly garbled generation and retry for a clean one (Flash-Lite
      // garbles intermittently). On the last attempt, sanitize and keep what we have.
      if (attempt < maxTries && rawGarbageScore(raw) >= 4) {
        continue;
      }
      return {
        ok: true,
        structuredContent: deepSanitizeMath({
          schema: 'asli-v2-six-section',
          tool: toolSlug,
          ...Object.fromEntries(V2_SECTION_IDS.map((id) => [id, json[id]])),
        }),
      };
    }
  }
  return { ok: false, error: 'Model did not return all six sections.', raw: lastRaw };
}

export default generateSixSectionContent;
