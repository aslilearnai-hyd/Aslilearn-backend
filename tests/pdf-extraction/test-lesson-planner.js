import { extractLessonPlannerItemsFromPdfText } from '../../services/pdf-lesson-extract.js';
import { runExtractTest } from './_helpers.js';

const sample = `
Lesson 1
Photosynthesis Introduction
1. Learning Objectives
- Define photosynthesis
- Identify raw materials
2. Introduction / Warm-up
Ask students what plants need to grow.
7. Classroom Activities
1. Label plant diagram
2. Group discussion on sunlight

Variation 2
Respiration Basics
1. Learning Objectives
- Compare photosynthesis and respiration
7. Classroom Activities
1. Read textbook section
2. Complete worksheet
`;

const ok = runExtractTest('lesson-planner', extractLessonPlannerItemsFromPdfText, sample, {
  minCount: 1,
});
process.exit(ok ? 0 : 1);
