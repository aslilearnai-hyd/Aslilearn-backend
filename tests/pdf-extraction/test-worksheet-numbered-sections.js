import {
  extractWorksheetItemsFromPdfText,
  consolidateWorksheetExtractItems,
  worksheetTextForPatternExtract,
} from '../../services/pdf-worksheet-extract.js';
import { canonicalizeWorksheetExtractedItem } from '../../services/ai-content-engine-service.js';

const ncertStyle = `
Worksheet — Large Numbers Around Us

Learning Objectives
- Read and write numbers up to one lakh
- Solve multi-step problems involving large numbers

Instructions to Students
1. Read each question carefully.
2. Use the Indian place-value system.

Section A: MCQs
1. 1 lakh is equal to
(a) 10,000
(b) 1,00,000
(c) 10,00,000
(d) 1,000
Answer: (b)

2. Which number is the greatest?
(a) 45,678
(b) 54,876
(c) 48,765
(d) 43,567
Answer: (b)

Section B: Fill in the Blanks
1. 5 thousands + 3 hundreds = ___________
2. The numeral for fifty thousand is ___________

Section C: Very Short Answer Questions
1. Write the numeral for 3 ten thousands and 4 hundreds.
2. How many zeros are there in one lakh?

Section D: Short Answer Questions
1. A shopkeeper sold 12,450 books in January and 9,875 in February. How many books did he sell in two months?
2. Arrange 78,901; 87,109; 80,719 in ascending order.

Section E: Competency / Real-life Application Questions
1. Ravi's village has a population of 45,230. The nearby town has 1,20,500 people. How many more people live in the town?
2. Design a poster showing how you use large numbers in daily life (markets, distances, population).

Answer Key
1. (b) 2. (b) 3. 5300 4. 50000
`;

const items = extractWorksheetItemsFromPdfText(ncertStyle, 80);
console.log('extracted questions:', items.length);
if (items.length < 6) {
  console.error('Expected at least 6 questions, got', items.length);
  process.exit(1);
}

const bySection = new Map();
for (const q of items) {
  const s = q.section || 'unknown';
  bySection.set(s, (bySection.get(s) || 0) + 1);
}
console.log('by section:', Object.fromEntries(bySection));

const consolidated = consolidateWorksheetExtractItems(
  [
    {
      title: 'Large Numbers Worksheet',
      learning_objectives: ['Read numbers up to one lakh'],
      instructions: 'Read carefully.',
      sections: [],
    },
  ],
  { rawPdfText: ncertStyle },
);
const merged = consolidated[0];
const sectionCounts = (merged.sections || []).map((s) => ({
  name: s.sectionName,
  n: (s.questions || []).length,
}));
console.log('consolidated sections:', sectionCounts);

const totalQ = sectionCounts.reduce((n, s) => n + s.n, 0);
if (totalQ < 6) {
  console.error('Consolidated worksheet should have questions in sections, got', totalQ);
  process.exit(1);
}

const markdown = `### 4. Section A: MCQs

**Q1.** 1 lakh is equal to
A) 10,000
B) 1,00,000
**Answer:** B

### 5. Section B: Fill in the Blanks

**Q2.** 5 thousands + 3 hundreds = ___________
`;

const fromMd = canonicalizeWorksheetExtractedItem(
  { title: 'Test', sections: [], learning_objectives: ['x'], instructions: 'y' },
  markdown,
);
const mdTotal = (fromMd.sections || []).reduce((n, s) => n + (s.questions?.length || 0), 0);
console.log('from markdown repair:', mdTotal);
if (mdTotal < 1) {
  console.error('Should extract from markdown **Q** format');
  process.exit(1);
}

console.log('worksheet numbered-section tests OK');
