# AI Generator Production Refactor — Implementation Reports

Generated: 2026-06-13

---

## 1. Architecture Report

### Pipeline (new)

```
Generate (Gemini + historical prompt block)
  → Normalize / Finalize (tool-specific, no scaffold when SECTION_PAD=false)
  → Validate (canonical fields)
  → Quality Gate (placeholder/scaffold rejection)
  → LLM Section Repair (missing sections only)
  → Quality Gate (re-check)
  → Uniqueness Engine (title + question similarity)
  → Save AiToolGeneration
  → Persist AiGenerationFingerprint rows
```

### Batch guarantee

`POST /api/ai-generator/generate-batch` uses `ai-generator-batch-orchestrator.js`:

- Computes `existingCount` for the curriculum slot
- Generates variants `existingCount + 1 … existingCount + 25`
- Retries each slot up to `AI_GENERATOR_BATCH_SLOT_MAX_ATTEMPTS` (default 5)
- Tracks in-batch titles/questions to prevent intra-batch duplicates
- Returns 201 when all 25 saved; 207 when partial

### Key modules

| Module | Role |
|--------|------|
| `AiGenerationFingerprint` | Normalized content hashes |
| `ai-generator-historical-index.js` | Pre-generation historical summaries |
| `ai-generator-uniqueness-engine.js` | 75% question / 82% title similarity |
| `ai-generator-quality-gate.js` | Rejects placeholder/scaffold text |
| `ai-generator-section-repair.js` | LLM fill for missing sections only |
| `ai-generator-batch-orchestrator.js` | 25-record batch guarantee |
| `ai-generator-audit-service.js` | Duplicate audit + analytics |

### Single source of truth

- **Storage:** `metadata.structuredContent`
- **Viewers:** `asli-frontend/src/lib/resolve-ai-structured-content.ts` helper added
- **Markdown:** export/PDF/preview only

---

## 2. Duplicate Prevention Report

### Mechanisms

1. **Historical index** — titles, question snippets, objectives injected into every Gemini prompt
2. **Fingerprint collection** — SHA-256 (24-char) hashes on titles, questions, objectives, activities, flashcards
3. **Batch uniqueness** — Jaccard similarity vs batch + historical texts
4. **Variant offset** — new batches start at `existingCount + 1`, not variant 1–25 again
5. **Metadata** — `contentFingerprint`, `questionFingerprints`, `objectiveFingerprints`, `activityFingerprints`

### Thresholds (`.env`)

- `AI_GENERATOR_QUESTION_SIMILARITY_THRESHOLD=0.75`
- `AI_GENERATOR_TITLE_SIMILARITY_THRESHOLD=0.82`

### Question tools covered

worksheet-mcq-generator, homework-creator, mock-test-builder, exam-question-paper-generator, smart-qa-practice-generator, quick-assignment-builder

---

## 3. Viewer Consistency Report

| Status | Detail |
|--------|--------|
| Added | `resolve-ai-structured-content.ts` — SSOT helper |
| Existing | Most viewers already accept `metadata.structuredContent` via record payloads |
| Remaining | Some viewers still merge markdown when structured is partial — migrate incrementally |

**Rubrics:** Viewer existed; generator card + bulk batch now wired in Super Admin UI.

---

## 4. Tool Validation Report (22 tools)

All 22 slugs in `AI_TOOL_ORDERED_SLUGS` share:

| Capability | Status |
|------------|--------|
| Schema (`aiToolTemplates.js`) | ✅ All 22 |
| Validator (`validateToolSpecificStructuredContent`) | ✅ All 22 |
| Finalizer (per-tool in `ai-content-engine-service.js`) | ✅ All 22 |
| Quality gate (`runAiGeneratorQualityGate`) | ✅ Generic + tool rules |
| Duplicate checker (batch + historical) | ✅ All saves |
| Uniqueness checker (questions) | ✅ 6 question tools |
| Completion checker | ✅ Canonical fields + quality gate |
| LLM section repair | ✅ All tools via missing-section list |

### Special handling

- **Worksheet:** Sections A–E required; scaffold disabled when `AI_GENERATOR_SECTION_PAD=false`
- **Homework:** Question uniqueness + concept coverage via quality gate
- **Lesson planner:** Objectives/outcomes/activities enforced via canonical field validation
- **Rubrics:** 10 sections + criteria rows enforced; now in frontend TOOLS list

---

## 5. Database Optimization Report

### AiToolGeneration indexes (existing)

- `{ board, toolName, classLabel, subject, topic, subtopic }`
- `{ classLabel, subject, topic, subtopic, createdAt }`
- `{ sourceType, toolName, createdAt }`

### AiGenerationFingerprint indexes (new model)

- `{ fingerprint, contentType }`
- `{ toolSlug, board, className, subject, topic, subtopic, contentType }`
- `{ generationId, contentType }`

### Scale notes

- Fingerprint lookups scoped by tool + class + subject + topic + subtopic
- Historical load capped at 5000 rows per generation scope
- Audit sampling uses 400-question window for similarity stats

---

## 6. Technical Debt Report

| Item | Priority | Notes |
|------|----------|-------|
| `extractJsonObject` duplicated in `ai-content-engine-service.js` | Low | New `utils/ai-json-extract.js` used by section repair; main service still has local copy |
| Exam/activity finalizers still contain scaffold fallbacks | Medium | Guarded by `isAiGeneratorSectionPadEnabled()` in worksheet; others need same pattern |
| Viewer SSOT not enforced in all 21 viewer components | Medium | Helper added; per-viewer migration pending |
| Admin duplicate actions (delete/merge/regenerate) | Low | Audit dashboard read-only; actions not yet implemented |
| Stale "17 tools" strings elsewhere in codebase | Low | Controller updated to 22 |

---

## 7. Remaining Risks Report

1. **LLM cost** — Section repair + uniqueness retries increase Gemini calls; monitor `AI_GENERATOR_BATCH_SLOT_MAX_ATTEMPTS`
2. **Partial batches** — If 5 attempts fail for a slot, batch returns 207; operator must retry
3. **Fingerprint backfill** — Existing records lack fingerprints until regenerated or backfill script run
4. **Similarity false positives** — Short questions may collide at 75%; tune threshold if needed
5. **Concurrent batch runs** — Two admins generating same slot simultaneously may race on variant numbers

---

## Modified Files Summary

### Backend (new)

- `models/AiGenerationFingerprint.js`
- `services/ai-generator-content-extractor.js`
- `services/ai-generator-quality-gate.js`
- `services/ai-generator-fingerprint-service.js`
- `services/ai-generator-historical-index.js`
- `services/ai-generator-uniqueness-engine.js`
- `services/ai-generator-section-repair.js`
- `services/ai-generator-batch-orchestrator.js`
- `services/ai-generator-audit-service.js`
- `utils/ai-json-extract.js`

### Backend (modified)

- `services/ai-content-engine-service.js` — quality gate, section repair, conditional padding
- `controllers/aiGeneratorController.js` — fingerprints, uniqueness, batch + audit endpoints
- `routes/aiGeneratorRoutes.js` — new routes
- `.env` — production generator flags

### Frontend (new)

- `src/lib/resolve-ai-structured-content.ts`
- `src/components/super-admin/ai-generator-audit.tsx`

### Frontend (modified)

- `src/components/super-admin/ai-generator.tsx` — rubrics tool, batch endpoint, audit tab

---

## Environment (restart backend after change)

```env
AI_GENERATOR_SECTION_PAD=false
AI_GENERATOR_VALIDATION_MAX_ATTEMPTS=3
AI_GENERATOR_BATCH_SIZE=25
AI_GENERATOR_QUESTION_SIMILARITY_THRESHOLD=0.75
```
