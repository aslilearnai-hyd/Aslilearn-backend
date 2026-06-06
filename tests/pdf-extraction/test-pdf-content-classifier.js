import { classifyPdfContent } from '../../services/pdf-content-classifier.js';
import { extractCanonicalPdfDocument } from '../../services/pdf-canonical-extract.js';

const worksheetText = `
Section A: MCQs
1. Which direction is opposite to North?
(a) East (b) South (c) West (d) North
Answer: (b)
Section B: Fill in the Blanks
1. The top of most maps shows ________.
`;

const activityText = `
Activity / Project 1
Title: Map Reading
Learning Objectives
- Read maps
Materials Required
Paper, pencil
`;

const canonicalWs = extractCanonicalPdfDocument(worksheetText, { toolSlug: 'worksheet-mcq-generator' });
const wsClass = classifyPdfContent(worksheetText, canonicalWs);
console.log('worksheet family:', wsClass.family, wsClass.confidence);
if (wsClass.family !== 'QUESTION_BASED') {
  console.error('Expected QUESTION_BASED');
  process.exit(1);
}

const actClass = classifyPdfContent(activityText, extractCanonicalPdfDocument(activityText));
console.log('activity family:', actClass.family);
if (actClass.family !== 'ACTIVITY_BASED') {
  console.error('Expected ACTIVITY_BASED');
  process.exit(1);
}

if (!canonicalWs.version || canonicalWs.version < 2) {
  console.error('Expected canonical v2');
  process.exit(1);
}

console.log('pdf content classifier OK');
