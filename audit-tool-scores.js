/**
 * Per-tool scoring audit — ZERO token cost, no writes.
 *
 * Every number here is MEASURED from the corpus, not estimated. Emits JSON so
 * the scorecard is reproducible rather than a one-off judgement.
 *
 * Usage: node audit-tool-scores.js --out=tool-scores.json
 */

import mongoose from 'mongoose';
import { writeFileSync } from 'node:fs';
import dotenv from 'dotenv';

dotenv.config();

import connectDB from './config/database.js';
import AiToolGeneration from './models/AiToolGeneration.js';
import { AI_TOOL_ORDERED_SLUGS, getAiToolTemplate } from './config/aiToolTemplates.js';
import { validateDashboardAiToolDoc } from './services/ai-tool-dashboard-validation.js';
import { BOOK_BASED_STUDENT_TOOL_SLUGS, BOOK_BASED_TEACHER_TOOL_SLUGS } from './config/bookBasedTools.js';

const args = process.argv.slice(2);
const OUT = (args.find((a) => a.startsWith('--out=')) || '--out=tool-scores.json').slice(6);

const BOOK_TOOLS = new Set([...BOOK_BASED_STUDENT_TOOL_SLUGS, ...BOOK_BASED_TEACHER_TOOL_SLUGS]);

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function splitSections(md, headingLabels) {
  const known = new Set(headingLabels.map(norm));
  const out = [];
  let cur = null;
  for (const line of String(md || '').split(/\r?\n/)) {
    const stripped = line.replace(/^#{1,4}\s+/, '').replace(/^\*\*|\*\*$/g, '').replace(/^\d{1,2}\.\s*/, '').trim();
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

function isHeadingEcho(heading, body) {
  const h = norm(heading);
  const b = norm(body);
  if (!h || !b || h.split(' ').length < 2 || !b.startsWith(h)) return false;
  const rem = b.slice(h.length).trim();
  if (rem.split(' ').filter(Boolean).length > 12) return false;
  return /^(for|in|of|about|on)\b/.test(rem) || rem === '';
}

async function main() {
  console.log('Per-tool scoring audit — no LLM calls, no writes.\n');
  await connectDB();

  const report = [];

  for (const slug of AI_TOOL_ORDERED_SLUGS) {
    const tpl = getAiToolTemplate(slug);
    const headingLabels = (tpl?.canonicalHeadings || []).map((h) => h.label || h.id).filter(Boolean);

    const s = {
      slug,
      title: tpl?.title || slug,
      sections: headingLabels.length,
      bookEnabled: BOOK_TOOLS.has(slug),
      total: 0,
      complete: 0,
      incomplete: 0,
      echoRecords: 0,
      echoSections: 0,
      tinyRecords: 0,
      lenSum: 0,
      recent: { total: 0, incomplete: 0 },
      bookTotal: 0,
      bookIncomplete: 0,
    };

    const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 24); // last 24h ~ post-fix records

    const cur = AiToolGeneration.find({ toolName: slug, sourceType: { $ne: 'ai_pdf' } })
      .select('content generatedContent metadata createdAt')
      .lean()
      .cursor();

    for await (const row of cur) {
      const md = String(row.content || row.generatedContent || '');
      s.total += 1;
      s.lenSum += md.length;
      if (md.length < 200) s.tinyRecords += 1;

      const gate = validateDashboardAiToolDoc(slug, {
        toolName: slug,
        content: md,
        generatedContent: md,
        metadata: row.metadata,
      });
      const ok = Boolean(gate.valid);
      if (ok) s.complete += 1;
      else s.incomplete += 1;

      const isBook = Boolean(row.metadata?.bookGenerator);
      if (isBook) {
        s.bookTotal += 1;
        if (!ok) s.bookIncomplete += 1;
      }

      if (row.createdAt && new Date(row.createdAt) >= cutoff) {
        s.recent.total += 1;
        if (!ok) s.recent.incomplete += 1;
      }

      let echoes = 0;
      for (const sec of splitSections(md, headingLabels)) {
        if (isHeadingEcho(sec.heading, sec.body)) echoes += 1;
      }
      if (echoes) {
        s.echoRecords += 1;
        s.echoSections += echoes;
      }
    }

    s.avgLen = s.total ? Math.round(s.lenSum / s.total) : 0;
    s.completePct = s.total ? +((s.complete / s.total) * 100).toFixed(1) : 0;
    s.echoPct = s.total ? +((s.echoRecords / s.total) * 100).toFixed(1) : 0;
    s.recentCompletePct = s.recent.total
      ? +(((s.recent.total - s.recent.incomplete) / s.recent.total) * 100).toFixed(1)
      : null;
    delete s.lenSum;

    report.push(s);
    console.log(
      `  ${slug.padEnd(32)} ${String(s.total).padStart(5)} recs | complete ${String(s.completePct).padStart(5)}% | echo ${String(s.echoPct).padStart(4)}% | avg ${String(s.avgLen).padStart(6)} chars`,
    );
  }

  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), tools: report }, null, 2));
  console.log(`\nwritten -> ${OUT}`);
  await mongoose.connection.close();
}

main().catch(async (e) => {
  console.error('Scoring audit failed:', e?.message || e);
  try { await mongoose.connection.close(); } catch {}
  process.exit(1);
});
