import { createToolPromptPack } from '../../prompt-engine/create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'project-idea-lab',
  toolTitle: 'Project Idea Lab',
  focus: 'Student-led projects with safety notes, observation tables, creative output, and self-assessment — age-appropriate and exciting.',
  includeTeacherScript: true,
  includeMisconceptions: true,
  includeBloom: true,
  includeDifferentiation: true,
  includeVisualLearning: true,
  includeEngagement: true,
  includePedagogyChecklist: true,
  generationRules: [
    'STUDENT PROJECT RULES:',
    '- Title and steps must investigate the subtopic directly — definitions, observations, and conclusions on [subtopic].',
    '- safety_care_instructions: specific hazards (scissors, soil, water) and precautions.',
    '- observation_table: column headers + 4–6 rows students will fill during the project.',
    '- creative_output: what students make (model, poster, digital story, comic) with success criteria.',
    '- self_assessment_rubric: student-friendly "I can…" statements.',
    '- Include peer discussion moment and presentation format (2 min per group).',
    'Tone: encouraging, curious — like a NCERT Lab Manual for students.',
  ],
  rewriteRules: [
    'Include all 14 project fields. observation_table must have real column names for THIS subtopic.',
  ],
});
