import { extractWorksheetItemsFromPdfText } from '../../services/pdf-worksheet-extract.js';
import { canonicalizeWorksheetExtractedItem } from '../../services/ai-content-engine-service.js';

const userSample = `
. Section A: MCQs

Q1. Which direction is opposite to North?

A) East
B) South
C) West
D) North-East
5. Section B: Fill in the Blanks

Q1. The top of most maps shows the direction ________.

6. Section C: Very Short Answer Questions

Q1. What is a landmark?

Q2. Why are directions important while locating places?

7. Section D: Short Answer Questions

Q1. Explain how maps, directions, landmarks and scale help people find places.

Q2. Explain how maps, directions, landmarks and scale help people find places. Section F: Competency / Real-Life Application Questions

8. Section E: Competency / Real-life Application Questions

Q1. A tourist wants to find a museum from a railway station. How would you guide them using directions and landmarks?

Q2. A tourist wants to find a museum from a railway station. How would you guide them using directions and landmarks?
`;

const items = extractWorksheetItemsFromPdfText(userSample, 500);
console.log('extracted:', items.length);
for (const q of items) {
  console.log('-', q.section, '|', q.question.slice(0, 80), '| opts:', q.options?.length || 0);
}

const canonical = canonicalizeWorksheetExtractedItem({ title: 'Locating Places', sections: [] }, userSample);
const total = (canonical.sections || []).reduce((n, s) => n + (s.questions?.length || 0), 0);
console.log('canonical total:', total);
for (const s of canonical.sections || []) {
  if ((s.questions || []).length) {
    console.log(' ', s.sectionName, ':', s.questions.length);
    for (const q of s.questions) {
      console.log('   Q', q.question_number, q.question.slice(0, 70));
    }
  }
}

const dupes = new Set();
let dupeCount = 0;
for (const s of canonical.sections || []) {
  for (const q of s.questions || []) {
    const key = String(q.question || '').toLowerCase().trim();
    if (dupes.has(key)) dupeCount += 1;
    dupes.add(key);
    if (/section\s+[a-f]\s*:/i.test(q.question)) {
      console.error('FAIL: section header in question:', q.question.slice(0, 90));
      process.exit(1);
    }
  }
}
if (total < 6) {
  console.error('FAIL: expected at least 6 canonical questions');
  process.exit(1);
}
if (dupeCount > 0) {
  console.error('FAIL: duplicate questions in canonical output:', dupeCount);
  process.exit(1);
}
console.log('user sample worksheet OK');

