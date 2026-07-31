# Generators

Per-tool normalize/finalize logic currently lives in `core/ai-content-engine-service.js` (legacy monolith, ~11k lines).

**Planned split (when needed):**

| Folder | Tool slugs |
|--------|------------|
| `worksheet/` | worksheet-mcq-generator |
| `lesson-plan/` | lesson-planner, study-schedule-maker, daily-class-plan-maker |
| `flashcards/` | flashcard-generator, my-study-decks |
| `question-paper/` | exam-question-paper-generator, mock-test-builder |
| `homework/` | homework-creator |
| `study-guide/` | smart-study-guide-generator |
| + activity, concept, story, short-notes, practice-qa, … | see prompt-registry |

Until then: import from `core/` or via shim `services/ai-content-engine-service.js`.
