/**
 * Measure REAL cost per generation on Gemini 3.1 Flash-Lite.
 *
 * Calls generateStructuredContentForAiGenerator, which generates but does NOT
 * save — so this measures live token usage without writing anything to Mongo.
 *
 * Usage:
 *   node measure-generation-cost.js                    # 3 records, worksheet
 *   node measure-generation-cost.js --n=5 --tool=lesson-planner
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

import connectDB from './config/database.js';
import { generateStructuredContentForAiGenerator } from './services/ai-content-engine-service.js';
import {
  beginTokenUsageSession,
  endTokenUsageSession,
} from './services/gemini-service.js';
import { computeGeminiCostFromTokenUsage } from './utils/gemini-token-cost.js';
import { validateDashboardAiToolDoc } from './services/ai-tool-dashboard-validation.js';

const args = process.argv.slice(2);
const argVal = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

const TOOL = argVal('tool', 'worksheet-mcq-generator');
const N = Math.max(1, Math.min(10, parseInt(argVal('n', '3'), 10) || 3));

// A realistic curriculum slot — the same shape the batch orchestrator passes.
const PARAMS = {
  board: 'CBSE',
  classLabel: 'Class 9',
  gradeLevel: 'Class 9',
  subject: 'Science',
  topic: 'Matter in Our Surroundings',
  subTopic: 'States of Matter',
};

const TARGET_INR = Number(process.env.AI_GENERATOR_TARGET_INR_PER_RECORD || 0.2);

async function main() {
  console.log(`Measuring ${N} live generation(s) of "${TOOL}" — no records saved.\n`);
  await connectDB();

  const rows = [];

  for (let i = 1; i <= N; i += 1) {
    beginTokenUsageSession(`cost-measure-${i}`);
    const startedAt = Date.now();
    let ok = false;
    let gateValid = null;
    let gateMessage = '';
    let err = '';

    try {
      const result = await generateStructuredContentForAiGenerator(TOOL, {
        ...PARAMS,
        extraParams: { batchSize: N, generationVariant: i },
      });
      ok = true;

      // Run the same gate the corpus is judged by, so we see whether a
      // single-pass generation under the new caps would actually have saved.
      const content =
        result?.content || result?.generatedContent || result?.structuredContent || '';
      const gate = validateDashboardAiToolDoc(TOOL, {
        toolName: TOOL,
        content: typeof content === 'string' ? content : JSON.stringify(content),
        generatedContent: typeof content === 'string' ? content : JSON.stringify(content),
        metadata: result?.metadata,
      });
      gateValid = Boolean(gate.valid);
      gateMessage = String(gate.message || '').slice(0, 70);
    } catch (e) {
      err = String(e?.message || e).slice(0, 90);
    }

    const usage = endTokenUsageSession();
    const cost = computeGeminiCostFromTokenUsage(usage);
    const t = usage.totals || {};

    rows.push({
      run: i,
      ok,
      gate: gateValid === null ? '-' : gateValid ? 'PASS' : 'FAIL',
      calls: t.callCount || 0,
      inTok: t.promptTokens || 0,
      outTok: t.completionTokens || 0,
      inr: cost.inr,
      sec: +((Date.now() - startedAt) / 1000).toFixed(1),
    });

    console.log(
      `  run ${i}: ${ok ? 'ok' : 'ERROR ' + err} | gate ${rows[i - 1].gate} | ` +
        `${t.callCount || 0} calls | ${t.promptTokens || 0} in / ${t.completionTokens || 0} out | INR ${cost.inr} | ${rows[i - 1].sec}s` +
        (gateMessage && gateValid === false ? `\n         gate says: ${gateMessage}` : ''),
    );
  }

  const done = rows.filter((r) => r.ok);
  const sum = (k) => done.reduce((a, r) => a + Number(r[k] || 0), 0);
  const avg = (k) => (done.length ? sum(k) / done.length : 0);

  console.log('\n' + '='.repeat(64));
  console.table(rows);
  if (done.length) {
    const avgInr = avg('inr');
    console.log(`avg input tokens : ${Math.round(avg('inTok'))}`);
    console.log(`avg output tokens: ${Math.round(avg('outTok'))}`);
    console.log(`avg LLM calls    : ${avg('calls').toFixed(2)} per generation`);
    console.log(`avg cost         : INR ${avgInr.toFixed(3)} per generation`);
    console.log(`cost per 10 gens : INR ${(avgInr * 10).toFixed(2)}   (target ${(TARGET_INR * 10).toFixed(2)})`);
    console.log(`gate pass rate   : ${done.filter((r) => r.gate === 'PASS').length}/${done.length}`);
    console.log(
      avgInr > TARGET_INR
        ? `\nOVER target by ${(avgInr / TARGET_INR).toFixed(1)}x`
        : `\nWithin target.`,
    );
  }

  await mongoose.connection.close();
}

main().catch(async (e) => {
  console.error('Measurement failed:', e?.message || e);
  try { await mongoose.connection.close(); } catch {}
  process.exit(1);
});
