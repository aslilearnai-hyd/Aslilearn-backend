/**
 * Simulates: DB record → API buildRawDataForTool → client resolveActivitiesFromPayload
 */
import { buildRawDataForTool } from '../utils/build-ai-tool-raw-data.js';
import { validateDashboardAiToolDoc } from '../services/ai-tool-dashboard-validation.js';
import { formatItemToContentFromTemplate } from '../config/aiToolTemplates.js';

const structured = {
  title: 'Observing Plant Growth',
  learning_objectives: ['Observe changes in a seedling over a week'],
  materials_required: ['Pots and soil', 'Seeds'],
  step_by_step_procedure: ['Day 1: Plant seeds', 'Day 3: Measure height'],
  teacherInstructions: ['Demonstrate how to measure height consistently', 'Circulate during recording'],
  studentInstructions: ['Water plants daily', 'Complete the observation table'],
  differentiation: 'Provide a pre-filled table for support',
  assessment_criteria_rubric: ['Accuracy of observations'],
  expected_learning_outcomes: 'Learners describe seedling changes using evidence.',
  real_life_application: 'Gardening uses similar skills.',
  reflection_exit_ticket: 'What surprised you about your plant?',
  subtopic_link_prior_knowledge: 'Students know plants need water.',
  ncf_competency_alignment: 'Scientific inquiry',
};

const markdown = formatItemToContentFromTemplate('activity-project-generator', structured, 0);
const doc = {
  toolName: 'activity-project-generator',
  generatedContent: markdown,
  metadata: { structuredContent: structured },
};

const gate = validateDashboardAiToolDoc('activity-project-generator', doc);
console.log('1. Backend validation:', gate.valid ? 'PASS' : `FAIL — ${gate.message}`);

const rawData = buildRawDataForTool('activity-project-generator', markdown, doc.metadata);
const act = rawData?.activities?.[0];
console.log('2. rawData teacher_instructions:', act?.teacher_instructions);
console.log('2. rawData teacherInstructions:', act?.teacherInstructions);

const { resolveActivitiesFromPayload } = await import(
  new URL('../../asli-frontend/src/lib/parse-activity-markdown.ts', import.meta.url).href
);

const resolved = resolveActivitiesFromPayload(rawData?.activities, markdown);
const r = resolved[0];
console.log('3. Client resolved teacher_instructions:', r?.teacher_instructions);
console.log('3. Client resolved student_instructions:', r?.student_instructions);

const missing = [];
if (!r?.teacher_instructions?.length) missing.push('teacher_instructions');
if (!r?.student_instructions?.length) missing.push('student_instructions');
if (!r?.step_by_step_procedure?.length) missing.push('procedure');

if (!gate.valid || missing.length) {
  console.error('PIPELINE FAILED', { missing, gate: gate.message });
  process.exit(1);
}
console.log('PIPELINE OK — all key sections reach the client parser');

// Case B: teacher section only in markdown (structured JSON incomplete — common in DB)
const sparseStructured = {
  title: 'Observing Plant Growth',
  step_by_step_procedure: ['Day 1: Plant seeds'],
  studentInstructions: ['Water plants daily'],
};
const sparseMd = formatItemToContentFromTemplate('activity-project-generator', structured, 0);
const sparseDoc = {
  toolName: 'activity-project-generator',
  generatedContent: sparseMd,
  metadata: { structuredContent: sparseStructured },
};
const sparseGate = validateDashboardAiToolDoc('activity-project-generator', sparseDoc);
const sparseRaw = buildRawDataForTool('activity-project-generator', sparseMd, sparseDoc.metadata);
const sparseResolved = resolveActivitiesFromPayload(sparseRaw?.activities, sparseMd)[0];
console.log('\nCase B (sparse structured, full markdown):');
console.log('  validation:', sparseGate.valid ? 'PASS' : `FAIL — ${sparseGate.message}`);
console.log('  rawData teacher:', sparseRaw?.activities?.[0]?.teacher_instructions?.length ?? 0, 'lines');
console.log('  client teacher:', sparseResolved?.teacher_instructions?.length ?? 0, 'lines');
if (!sparseResolved?.teacher_instructions?.length) {
  console.error('Case B FAILED — teacher instructions lost');
  process.exit(1);
}
console.log('Case B OK');
