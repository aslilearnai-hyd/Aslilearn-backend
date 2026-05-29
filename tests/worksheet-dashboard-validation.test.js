import { validateDashboardAiToolDoc } from '../services/ai-tool-dashboard-validation.js';
import { normalizeWorksheetStructuredContent } from '../services/ai-content-engine-service.js';

const markdown = `# Science Worksheet — What Makes Science Different

## 2. Learning Objectives
- Understand empirical evidence
- Apply scientific thinking

## 3. Instructions to Students
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

**Q4.** Explain how experimentation supports scientific conclusions in class.

### 8. Section E: Competency / Real-life Application Questions

**Q5.** How would you use evidence to check a claim you hear in daily life?

## 9. Answer Key
Q1: B
Q2: empirical
Q3: testable explanation
Q4: experiments test predictions
Q5: collect observations

## 10. Bloom's Level and Difficulty Tag
Understand — Medium
`;

const structured = {
  title: 'Science Worksheet',
  sections: [
    {
      sectionName: 'Section A: MCQs',
      questions: [
        {
          question: 'Which best describes scientific inquiry?',
          options: ['A', 'B'],
          answer: 'B',
        },
      ],
    },
  ],
};

const doc = {
  toolName: 'worksheet-mcq-generator',
  generatedContent: markdown,
  metadata: { structuredContent: structured },
};

const gate = validateDashboardAiToolDoc('worksheet-mcq-generator', doc);
console.log('gate valid:', gate.valid, gate.message || '');

const norm = normalizeWorksheetStructuredContent(structured, markdown);
for (const s of norm.sections) {
  console.log(s.sectionName, (s.questions || []).length);
}

if (!gate.valid) process.exit(1);
