/**
 * PDF generation splitter — global heading split (50 generations, not 1).
 */
import {
  splitAllPdfGenerations,
  splitByGenerationHeadings,
  findAllGenerationHeadings,
  dedupeHeadingsFirstOccurrence,
  countGlobalGenerationMatches,
} from '../../services/pdf-generation-splitter.js';

const BULK = Array.from({ length: 5 }, (_, i) => {
  const n = i + 1;
  return `
Generation ${n}: Square Numbers Activity ${n}

Section 1
Assignment Title
Activity ${n} Title Here

Section 4
Concept-based Questions
Q1. Question for generation ${n}?
`;
}).join('\n');

const result = splitAllPdfGenerations(BULK);
if (result.totalGenerations !== 5) {
  console.error('FAIL: expected 5 generations, got', result.totalGenerations);
  process.exit(1);
}

const fifty = Array.from({ length: 50 }, (_, i) => {
  const n = i + 1;
  return `Generation ${n}: Activity ${n}\nSection 1\nTitle ${n}\nSection 4\nQ1. Unique question number ${n} for this generation block with enough text?`;
}).join('\n\n');

const fiftyResult = splitAllPdfGenerations(fifty, { pageCount: 102 });
if (fiftyResult.totalGenerations !== 50) {
  console.error('FAIL: expected 50 generations, got', fiftyResult.totalGenerations);
  process.exit(1);
}

if (fiftyResult.extractionStats.globalHeadingCount !== 50) {
  console.error('FAIL: expected 50 headings, got', fiftyResult.extractionStats.globalHeadingCount);
  process.exit(1);
}

const headings = findAllGenerationHeadings(fifty);
const split = splitByGenerationHeadings(fifty, headings);
if (split.length !== 50) {
  console.error('FAIL: splitByGenerationHeadings expected 50, got', split.length);
  process.exit(1);
}

const globalCount = countGlobalGenerationMatches(fifty);
if (globalCount !== 50) {
  console.error('FAIL: global regex expected 50, got', globalCount);
  process.exit(1);
}

const pageFooterNoise = `
Generation 1: Real Assignment Title Here

Section 4
Concept-based Questions
Q1. What is the main concept for this assignment with enough body text?

Generation 2: Second Assignment Title Here

Section 4
Concept-based Questions
Q1. Different question for generation two with unique content here?
`;
const noiseResult = splitAllPdfGenerations(pageFooterNoise, { pageCount: 102 });
if (noiseResult.totalGenerations !== 2) {
  console.error('FAIL: footer noise produced', noiseResult.totalGenerations, 'expected 2');
  process.exit(1);
}

console.log('PASS: pdf generation splitter');
console.log('  basic:', result.totalGenerations);
console.log('  fifty-bank:', fiftyResult.totalGenerations);
console.log('  headings:', dedupeHeadingsFirstOccurrence(headings).length);
