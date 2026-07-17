import assert from 'node:assert/strict';
import { validateDashboardAiToolDoc } from '../services/ai-tool-dashboard-validation.js';
import { mapV2StructuredToLegacy } from '../utils/v2-structured-to-legacy.js';
import { formatItemToContentFromTemplate } from '../config/aiToolTemplates.js';

const v2 = {
  schema: 'asli-v2-six-section',
  tool: 'activity-project-generator',
  core: {
    title: 'Pollination Observation Lab',
    overview: 'Students observe pollination in local flowers.',
    materials: ['Magnifying glass', 'Notebook', 'Flower samples'],
    steps: [
      'Collect two flower samples from the school garden.',
      'Observe stamen and stigma under a magnifying glass.',
      'Record whether pollen is visible on the stigma.',
    ],
    roles: {
      teacher: 'Demonstrate safe handling of flower samples.',
      student: 'Draw and label the flower parts observed.',
    },
  },
  objectives: {
    items: ['Describe pollination using observed evidence.', 'Identify flower parts involved in fertilisation.'],
    alignment: 'NCF scientific inquiry',
  },
  differentiation: { support: 'Provide a labelled diagram template.', core: 'Standard observation table.', stretch: 'Compare two flower types.' },
  assessment: { rubric: 'Observation accuracy and labelled diagram quality.', commonErrors: ['Confusing stamen with petal'] },
  teacher: { tips: ['Group students in pairs for observation.'] },
  reallife: { connection: 'Farmers rely on pollination for crop yield.', reflection: 'Why is pollination important for food production?' },
};

const legacy = mapV2StructuredToLegacy('activity-project-generator', v2);
assert.ok(legacy, 'V2 activity should map to legacy shape');
assert.ok(String(legacy.subtopic_link_prior_knowledge || '').length > 10);
assert.ok(Array.isArray(legacy.student_instructions) && legacy.student_instructions.length > 0);
assert.ok(Array.isArray(legacy.assessment_criteria_rubric) && legacy.assessment_criteria_rubric.length > 0);
assert.ok(String(legacy.expected_learning_outcomes || '').length > 10);

const markdown = formatItemToContentFromTemplate('activity-project-generator', legacy, 0);
const doc = {
  toolName: 'activity-project-generator',
  subject: 'Biology',
  topic: 'Chapter 3 - Plant Life',
  subtopic: 'Pollination and Fertilisation',
  classLabel: 'Class 6',
  board: 'IIT',
  generatedContent: markdown,
  metadata: {
    structuredContent: v2,
    legacyStructuredContent: legacy,
  },
};

const gate = validateDashboardAiToolDoc('activity-project-generator', doc);
assert.equal(gate.valid, true, gate.message || 'expected valid delivery');

console.log('activity-v2-dashboard-delivery.test.js passed');
