import { extractDailyPlanItemsFromPdfText } from '../../services/pdf-dailyplan-extract.js';
import { runExtractTest } from './_helpers.js';

const sample = `
Day 1
Topic: Fractions

9:00 - 9:20 - Introduction
9:20 - 9:40 - Activity
9:40 - 10:00 - Practice

Homework:
Solve page 12.

Day 2
Topic: Decimals

9:00 - 9:30 - Concept introduction
9:30 - 10:00 - Worksheet
`;

const ok = runExtractTest('daily-class-plan-maker', extractDailyPlanItemsFromPdfText, sample, {
  minCount: 2,
});
process.exit(ok ? 0 : 1);
