import { validateDashboardAiToolDoc } from '../services/ai-tool-dashboard-validation.js';

const markdown = `## Science Worksheet

### 2. Learning Objectives
- Understand empirical evidence

### 3. Instructions to Students
Read each question carefully.

### 4. Section A: MCQs

**Q1.** Which best describes scientific inquiry?
A) Guesswork
B) Evidence-based reasoning
**Answer:** B

### 5. Section B: Fill in the Blanks

**Q2.** Science relies on ______ evidence.

### 6. Section C: Very Short Answer Questions

**Q3.** What is a hypothesis?

### 7. Section D: Short Answer Questions

**Q4.** Explain experimentation in class.

### 8. Section E: Competency / Real-life Application Questions

**Q5.** How would you check a daily-life claim?

## 9. Answer Key
Q1: B
Q2: empirical
Q3: testable explanation
Q4: experiments test predictions
Q5: collect observations

## 10. Bloom's Level and Difficulty Tag
Understand — Medium
`;

/** Structured JSON only has questions — meta sections exist in markdown only. */
const structured = {
  title: 'Science Worksheet',
  sections: [
    {
      sectionName: 'Section A: MCQs',
      questions: [{ question: 'Which best describes scientific inquiry?', options: ['A', 'B'], answer: 'B' }],
    },
  ],
};

const gate = validateDashboardAiToolDoc('worksheet-mcq-generator', {
  toolName: 'worksheet-mcq-generator',
  generatedContent: markdown,
  metadata: { structuredContent: structured },
});

console.log('sparse structured + full markdown gate:', gate.valid ? 'PASS' : `FAIL — ${gate.message}`);
if (!gate.valid) {
  console.error('missing:', gate.missingSections);
  process.exit(1);
}

const questionsOnly = validateDashboardAiToolDoc('worksheet-mcq-generator', {
  toolName: 'worksheet-mcq-generator',
  generatedContent: `### 4. Section A: MCQs\n\n**Q1.** Test?\n**Answer:** A`,
  metadata: {
    structuredContent: {
      title: 'Bare',
      sections: [{ sectionName: 'Section A: MCQs', questions: [{ question: 'Test?', answer: 'A' }] }],
    },
  },
});

if (questionsOnly.valid) {
  console.error('FAIL: questions-only worksheet should not pass');
  process.exit(1);
}
console.log('questions-only blocked:', questionsOnly.missingSections?.join(', '));
console.log('worksheet sparse-structured validation OK');
