/**
 * Diff each tool's CANONICAL TEMPLATE SECTIONS against what its PROMPT actually
 * asks the model to produce. Zero token cost — pure static comparison.
 *
 * The validator requires 100% of canonicalHeadings to be filled. If a heading is
 * never mentioned in the prompt, the model has no reason to emit it and EVERY
 * record for that tool fails on the same section — which is exactly the pattern
 * the July 2026 census found (worksheet omits 'Section E' on 796 records,
 * concept-mastery omits 'Diagram / Visualisation Suggestion' on 250).
 *
 * Usage: node diff-prompt-vs-template.js [--tool=slug]
 */

import dotenv from 'dotenv';

dotenv.config();

import { getAiToolTemplate, AI_TOOL_ORDERED_SLUGS } from './config/aiToolTemplates.js';
import {
  buildPromptEngineSystemPrompt,
  buildPromptEngineGenerationBlock,
} from './prompts/registry.js';

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--tool=')) || '').slice(7);

const CTX = {
  board: 'CBSE',
  classLabel: 'Class 9',
  subject: 'Science',
  topic: 'Matter in Our Surroundings',
  subTopic: 'States of Matter',
};

/** Strip punctuation/casing so 'Section E: Competency / Real-life Application' can be token-matched. */
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'with', 'one',
  'section', 'questions', 'question', 'task', 'tasks', 'block', 'note', 'notes',
]);

/** Content words of a heading label — what we expect to see echoed in the prompt. */
function keyTokens(label) {
  return norm(label)
    .split(' ')
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function analyse(slug) {
  const tpl = getAiToolTemplate(slug);
  const headings = tpl?.canonicalHeadings || [];
  if (!headings.length) return null;

  let prompt = '';
  try {
    prompt = [
      buildPromptEngineSystemPrompt(slug, CTX),
      buildPromptEngineGenerationBlock(slug, CTX),
    ].join('\n');
  } catch (e) {
    return { slug, error: String(e?.message || e).slice(0, 80) };
  }
  if (!prompt.trim()) return { slug, error: 'no prompt pack registered' };

  const hay = norm(prompt);
  const covered = [];
  const missing = [];
  const weak = [];

  for (const h of headings) {
    const label = h.label || h.id;
    const toks = keyTokens(label);
    if (!toks.length) {
      covered.push(label);
      continue;
    }
    // Also accept the storage keys — prompts often name the JSON field, not the label.
    const keys = Array.isArray(h.storageKeys) ? h.storageKeys : [];
    const keyHit = keys.some((k) => hay.includes(norm(k)));

    const hits = toks.filter((t) => hay.includes(t)).length;
    const ratio = hits / toks.length;

    if (keyHit || ratio === 1) covered.push(label);
    else if (ratio >= 0.5) weak.push({ label, ratio, toks, keys });
    else missing.push({ label, ratio, toks, keys });
  }

  return { slug, total: headings.length, covered, weak, missing };
}

const slugs = only ? [only] : [...AI_TOOL_ORDERED_SLUGS];
const results = [];

for (const slug of slugs) {
  const r = analyse(slug);
  if (r) results.push(r);
}

console.log('Prompt vs template canonical-section coverage — no LLM calls.\n');

const broken = results.filter((r) => !r.error && (r.missing.length || r.weak.length));
const clean = results.filter((r) => !r.error && !r.missing.length && !r.weak.length);
const errored = results.filter((r) => r.error);

broken.sort((a, b) => b.missing.length - a.missing.length);

for (const r of broken) {
  console.log(`\n${r.slug}  —  ${r.covered.length}/${r.total} sections named in prompt`);
  for (const m of r.missing) {
    console.log(`   NOT IN PROMPT  ${m.label}`);
    console.log(`                  looked for: ${m.toks.join(', ')}${m.keys.length ? ` | keys: ${m.keys.join(', ')}` : ''}`);
  }
  for (const w of r.weak) {
    console.log(`   PARTIAL        ${w.label}  (${Math.round(w.ratio * 100)}% of terms present)`);
  }
}

if (clean.length) {
  console.log(`\n\nFully covered (${clean.length}): ${clean.map((r) => r.slug).join(', ')}`);
}
if (errored.length) {
  console.log(`\nSkipped (${errored.length}):`);
  for (const e of errored) console.log(`   ${e.slug}: ${e.error}`);
}

const totalMissing = broken.reduce((a, r) => a + r.missing.length, 0);
console.log(
  `\n${'='.repeat(60)}\n${broken.length} tools have unnamed sections | ${totalMissing} sections never asked for in any prompt`,
);
