/**
 * Heading-echo audit — ZERO token cost.
 *
 * Finds sections whose BODY is just a restatement of its own HEADING, e.g.
 *
 *   3. Prior Knowledge Required
 *      Prior Knowledge Required for Pre-reading: Let's Begin in English.
 *
 * This is content-free text that passes every completeness check, because the
 * section is technically "filled". It is the generic-filler class the July 2026
 * P0 findings flagged, and unlike scaffold padding nothing currently detects it.
 *
 * Usage:
 *   node audit-heading-echo.js
 *   node audit-heading-echo.js --tool=activity-project-generator --show=5
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

import connectDB from './config/database.js';
import AiToolGeneration from './models/AiToolGeneration.js';
import { AI_TOOL_ORDERED_SLUGS, getAiToolTemplate } from './config/aiToolTemplates.js';

const args = process.argv.slice(2);
const argVal = (n, d = '') => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const ONLY = argVal('tool', '');
const SHOW = Math.max(0, parseInt(argVal('show', '3'), 10) || 0);

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Split rendered content into { heading, body } pairs.
 *
 * Records store headings as PLAIN NUMBERED LINES ("2. Subtopic Link and Prior
 * Knowledge Required"), not markdown "###" — an earlier version of this audit
 * matched only "#"-prefixed lines and therefore reported 0 echoes across all
 * 20,475 records.
 *
 * A line counts as a heading only when it matches one of the tool's canonical
 * heading labels, so numbered STEP items ("1. Set the scene: a monsoon...") are
 * not mistaken for section headings.
 */
function splitSections(md, headingLabels) {
  const known = new Set(headingLabels.map(norm));
  const out = [];
  let cur = null;
  for (const line of String(md || '').split(/\r?\n/)) {
    const stripped = line
      .replace(/^#{1,4}\s+/, '')
      .replace(/^\*\*|\*\*$/g, '')
      .replace(/^\d{1,2}\.\s*/, '')
      .trim();
    if (stripped && known.has(norm(stripped))) {
      if (cur) out.push(cur);
      cur = { heading: stripped, body: [] };
      continue;
    }
    if (cur) cur.body.push(line);
  }
  if (cur) out.push(cur);
  return out.map((s) => ({ heading: s.heading, body: s.body.join(' ').trim() }));
}

/**
 * A body echoes its heading when, after removing the heading words, almost
 * nothing of substance is left. Requires the heading to be reasonably specific
 * so short generic labels ("Example", "Materials") do not trigger on prose that
 * happens to use the word.
 */
function isHeadingEcho(heading, body) {
  const h = norm(heading);
  const b = norm(body);
  if (!h || !b) return false;
  if (h.split(' ').length < 2) return false;
  if (!b.startsWith(h)) return false;
  const remainder = b.slice(h.length).trim();
  if (remainder.split(' ').filter(Boolean).length > 12) return false;

  /*
   * Only count it when the remainder is a bare CONTEXT TAG, not real prose.
   *
   * The generated-filler signature is "<Heading> for <topic> in <subject>" —
   * the field value is the heading plus the curriculum slot and nothing else.
   * A section whose genuine sentence happens to open with its own title, e.g.
   *   Internal Choices -> "Internal choices have been provided within Section C"
   * is legitimate content and must not be flagged; it continues with a verb
   * rather than a "for/in/of/about" context tag.
   */
  return /^(for|in|of|about|on)\b/.test(remainder) || remainder === '';
}

async function main() {
  console.log('Heading-echo audit — no LLM calls.\n');
  await connectDB();

  const slugs = ONLY ? [ONLY] : [...AI_TOOL_ORDERED_SLUGS];
  const results = [];

  for (const slug of slugs) {
    const tpl = getAiToolTemplate(slug);
    if (!tpl) continue;
    const headingLabels = (tpl.canonicalHeadings || []).map((h) => h.label || h.id).filter(Boolean);
    if (!headingLabels.length) continue;
    const stats = { slug, records: 0, affected: 0, echoes: 0, bySection: {}, samples: [] };

    const cur = AiToolGeneration.find({ toolName: slug, sourceType: { $ne: 'ai_pdf' } })
      .select('content generatedContent')
      .lean()
      .cursor();

    for await (const row of cur) {
      const md = String(row.content || row.generatedContent || '');
      if (!md) continue;
      stats.records += 1;
      let hitThis = 0;
      for (const sec of splitSections(md, headingLabels)) {
        if (!isHeadingEcho(sec.heading, sec.body)) continue;
        hitThis += 1;
        stats.echoes += 1;
        stats.bySection[sec.heading] = (stats.bySection[sec.heading] || 0) + 1;
        if (stats.samples.length < SHOW) {
          stats.samples.push({ id: String(row._id).slice(-6), heading: sec.heading, body: sec.body.slice(0, 90) });
        }
      }
      if (hitThis) stats.affected += 1;
    }
    if (stats.records) results.push(stats);
  }

  results.sort((a, b) => b.affected / (b.records || 1) - a.affected / (a.records || 1));

  console.log('tool                              records  affected     %   echoes');
  console.log('-'.repeat(70));
  let R = 0;
  let A = 0;
  let E = 0;
  for (const s of results) {
    const pct = s.records ? Math.round((s.affected / s.records) * 100) : 0;
    console.log(
      s.slug.padEnd(34) + String(s.records).padStart(7) + String(s.affected).padStart(10) + String(pct).padStart(5) + '%' + String(s.echoes).padStart(8),
    );
    R += s.records;
    A += s.affected;
    E += s.echoes;
  }
  console.log('-'.repeat(70));
  console.log('TOTAL'.padEnd(34) + String(R).padStart(7) + String(A).padStart(10) + String(R ? Math.round((A / R) * 100) : 0).padStart(5) + '%' + String(E).padStart(8));

  const worst = results.filter((s) => s.affected > 0).slice(0, 6);
  if (worst.length) {
    console.log('\nmost-echoed sections:');
    for (const s of worst) {
      const top = Object.entries(s.bySection).sort((a, b) => b[1] - a[1]).slice(0, 3);
      console.log(`  ${s.slug}`);
      for (const [h, c] of top) console.log(`     ${String(c).padStart(5)}  ${h}`);
      for (const ex of s.samples.slice(0, 1)) {
        console.log(`     e.g. ${ex.id}: "${ex.body}"`);
      }
    }
  }

  await mongoose.connection.close();
}

main().catch(async (e) => {
  console.error('Audit failed:', e?.message || e);
  try { await mongoose.connection.close(); } catch {}
  process.exit(1);
});
