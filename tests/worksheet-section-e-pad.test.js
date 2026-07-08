import {
  finalizeWorksheetStructuredContent,
  ensureWorksheetSectionsComplete,
  WORKSHEET_SECTION_LABELS,
} from '../services/ai-content-engine-service.js';

const ragContext = `[Chunk 1]
Light travels in straight lines. Reflection occurs when light bounces off a mirror.
The angle of incidence equals the angle of reflection. Luminous objects emit their own light.

[Chunk 2]
Transparent materials allow light to pass through. Opaque objects block light and form shadows.
A periscope uses two mirrors to see over obstacles.`;

const meta = {
  subject: 'Science',
  topic: 'Light',
  subTopic: 'Introduction to Light Energy',
  bookGenerator: true,
  batchOrchestrator: true,
  strictValidation: false,
  pdfContext: ragContext,
  generationVariant: 2,
};

// Simulate PDF extraction that only fills A–D (no competency row).
const partialSections = [
  { sectionName: WORKSHEET_SECTION_LABELS.A, questions: [{ question: 'Which property of light is shown when it travels in straight lines?', type: 'MCQ', options: ['A) x', 'B) y', 'C) z', 'D) w'], answer: 'A) x' }] },
  { sectionName: WORKSHEET_SECTION_LABELS.B, questions: [{ question: 'Light travels in _____ lines when unobstructed.', type: 'FIB', answer: 'straight' }] },
  { sectionName: WORKSHEET_SECTION_LABELS.C, questions: [{ question: 'Define reflection in one sentence.', type: 'VSA', answer: 'Bouncing of light.' }] },
  { sectionName: WORKSHEET_SECTION_LABELS.D, questions: [{ question: 'Explain how a periscope uses mirrors.', type: 'SA', answer: 'Two mirrors reflect light.' }] },
];

let structured = finalizeWorksheetStructuredContent(
  { title: 'Light Worksheet', sections: partialSections },
  meta,
);

const eSection = (structured.sections || []).find(
  (s) => s.sectionName === WORKSHEET_SECTION_LABELS.E,
);
if (!eSection || !eSection.questions?.length) {
  console.error('FAIL: Section E missing after finalize');
  process.exit(1);
}

structured = ensureWorksheetSectionsComplete(
  { ...structured, sections: structured.sections.filter((s) => s.sectionName !== WORKSHEET_SECTION_LABELS.E) },
  meta,
);
const eAfter = (structured.sections || []).find(
  (s) => s.sectionName === WORKSHEET_SECTION_LABELS.E,
);
if (!eAfter || !eAfter.questions?.length) {
  console.error('FAIL: ensureWorksheetSectionsComplete did not restore Section E');
  process.exit(1);
}

console.log('OK: Section E padded with', eAfter.questions.length, 'question(s)');
