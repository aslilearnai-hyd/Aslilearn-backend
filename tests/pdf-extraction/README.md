# PDF extraction smoke tests

Regex-based extractors for all **11 AI tools**, plus Gemini merge tests.

**Worksheet PDF upload (production):** zero-LLM only — see `ai-tools/AI-PDF-UPLOAD.md` for full pipeline, fixes, and operator checklist.

## Run all tests

```bash
cd backend
npm run test:pdf-extraction
```

## Run a single tool

```bash
node tests/pdf-extraction/test-worksheet.js
node tests/pdf-extraction/test-worksheet-multipage-mcq.js
node tests/pdf-extraction/test-worksheet-locating-places-dense.js
node tests/pdf-extraction/test-worksheet-answer-key-sections.js
node tests/pdf-extraction/test-worksheet-user-sample.js
node tests/pdf-extraction/test-concept-mastery.js
node tests/pdf-extraction/test-flashcards.js
# … etc.
```

## Registry API

All tools use the same entry point:

```js
import { extractToolItemsFromPdfText } from '../services/pdf-tool-extract.js';

const items = extractToolItemsFromPdfText('flashcard-generator', pdfText);
```

## Extractor modules

| Tool | Module | Export |
|------|--------|--------|
| Activity & Project | `pdf-activity-extract.js` | `extractActivityProjectItemsFromPdfText` |
| Worksheet & MCQ | `pdf-worksheet-extract.js` | `extractWorksheetItemsFromPdfText` |
| Concept Mastery | `pdf-concept-extract.js` | `extractConceptMasteryItemsFromPdfText` |
| Lesson Planner | `pdf-lesson-extract.js` | `extractLessonPlannerItemsFromPdfText` |
| Homework Creator | `pdf-homework-extract.js` | `extractHomeworkItemsFromPdfText` |
| Rubrics & Evaluation | `pdf-rubric-extract.js` | `extractRubricItemsFromPdfText` |
| Story & Passage | `pdf-story-extract.js` | `extractStoryPassageItemsFromPdfText` |
| Short Notes | `pdf-shortnotes-extract.js` | `extractShortNotesItemsFromPdfText` |
| Flashcards | `pdf-flashcard-extract.js` | `extractFlashcardItemsFromPdfText` |
| Daily Class Plan | `pdf-dailyplan-extract.js` | `extractDailyPlanItemsFromPdfText` |
| Exam Paper | `pdf-exam-paper-extract.js` | `extractExamPaperItemsFromPdfText` |

Shared helpers live in `services/pdf-extract-utils.js`.

Each test prints `count`, full `JSON.stringify(items, null, 2)`, and **PASS/FAIL**.
