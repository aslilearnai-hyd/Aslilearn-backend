import {
  buildWorksheetAnswerKeyFromSections,
  buildWorksheetAnswerKeySections,
  normalizeWorksheetStructuredContent,
} from '../../services/ai-content-engine-service.js';

const sample = {
  title: 'Locating Places',
  sections: [
    {
      sectionName: 'Section A: MCQs',
      questions: [
        { question_number: 1, question: 'Which direction is opposite to North?', answer: '(b) South', options: [] },
        { question_number: 2, question: 'Which is east?', answer: '(a) East', options: [] },
      ],
    },
    {
      sectionName: 'Section B: Fill in the Blanks',
      questions: [{ question_number: 1, question: 'Top of map shows ________.', answer: 'north' }],
    },
    {
      sectionName: 'Section C: Very Short Answer Questions',
      questions: [{ question_number: 1, question: 'What is a landmark?', answer: 'A fixed reference point' }],
    },
  ],
};

const key = buildWorksheetAnswerKeyFromSections(sample.sections);
console.log(key);
if (!/A\. Section A: MCQs/.test(key) || !/Q1\. \(b\) South/.test(key)) {
  console.error('FAIL: section A key missing');
  process.exit(1);
}
if (!/B\. Section B: Fill in the Blanks/.test(key) || !/Q1\. north/.test(key)) {
  console.error('FAIL: section B key missing');
  process.exit(1);
}

const sections = buildWorksheetAnswerKeySections(sample.sections);
if (sections.length !== 3 || sections[0].letter !== 'A') {
  console.error('FAIL: answer key sections structure');
  process.exit(1);
}

const normalized = normalizeWorksheetStructuredContent(sample);
if (!String(normalized.answer_key || '').includes('A. Section A: MCQs')) {
  console.error('FAIL: polish should set sectioned answer_key');
  process.exit(1);
}

console.log('worksheet answer key sections OK');
