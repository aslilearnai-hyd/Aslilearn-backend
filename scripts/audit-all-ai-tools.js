import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const TOOLS = [
  'activity-project-generator',
  'project-idea-lab',
  'worksheet-mcq-generator',
  'concept-mastery-helper',
  'lesson-planner',
  'study-schedule-maker',
  'homework-creator',
  'reading-practice-room',
  'story-passage-creator',
  'short-notes-summaries-maker',
  'my-study-decks',
  'flashcard-generator',
  'daily-class-plan-maker',
  'mock-test-builder',
  'exam-question-paper-generator',
  'smart-study-guide-generator',
  'concept-breakdown-explainer',
  'smart-qa-practice-generator',
  'chapter-summary-creator',
  'key-points-formula-extractor',
  'quick-assignment-builder',
];

const scope = {
  board: 'CBSE',
  className: 'Class 10',
  subjectName: 'Science',
  topicName: 'Chapter 2: Acids, Bases and Salts',
  subtopicName: '2.1 Chemical Properties of Acids and Bases',
};

await mongoose.connect(process.env.MONGO_URI);
const { generateBatchAndSave } = await import('../services/ai-generator-batch-orchestrator.js');

const results = [];
for (const toolSlug of TOOLS) {
  try {
    const r = await generateBatchAndSave(
      { ...scope, toolSlug, toolName: toolSlug, batchSize: 1, extraParams: {} },
      { reqUser: { userId: '507f1f77bcf86cd799439011', name: 'Audit' } },
    );
    results.push({
      tool: toolSlug,
      ok: r.savedCount > 0,
      saved: r.savedCount,
      fail: r.failures?.[0]?.slice(0, 140) || '',
    });
    console.log(
      (r.savedCount > 0 ? 'OK  ' : 'FAIL') + ' ' + toolSlug + (r.failures?.[0] ? ' -> ' + r.failures[0].slice(0, 100) : ''),
    );
  } catch (e) {
    results.push({ tool: toolSlug, ok: false, saved: 0, fail: String(e?.message || e).slice(0, 140) });
    console.log('ERR ' + toolSlug + ' -> ' + String(e?.message || e).slice(0, 100));
  }
}

const failed = results.filter((r) => !r.ok);
console.log('\n=== SUMMARY ===');
console.log('passed', results.filter((r) => r.ok).length, '/', TOOLS.length);
console.log('failed', failed.length);
for (const f of failed) console.log('-', f.tool, ':', f.fail);

await mongoose.disconnect();
