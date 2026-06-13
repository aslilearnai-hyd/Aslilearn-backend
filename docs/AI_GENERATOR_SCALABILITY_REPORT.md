# AI Generator Scalability Refactor — Reports

Generated: 2026-06-13

---

## 1. Fingerprint Backfill Report

### Script

```bash
npm run ai:fingerprint-backfill
```

### Behavior

- Scans all `AiToolGeneration` records with `metadata.structuredContent`
- Skips records that already have rows in `AiGenerationFingerprint`
- Writes title, question, objective, activity fingerprints
- Updates record metadata: `contentFingerprint`, `questionFingerprints`, etc.
- Logs progress: `Record N/total`
- Prints summary on completion

### Run after deploy

Required once for historical records created before fingerprint system.

---

## 2. Viewer Migration Report

### Policy

`AI_VIEWER_STRUCTURED_ONLY = true` in `resolve-ai-structured-content.ts`

Viewers render **only** from `metadata.structuredContent`. Markdown is export/preview only.

### Migrated

| Area | Status |
|------|--------|
| `viewerPayloadFromRecord` helper | All 8 student tool payload functions |
| `deckViewerPayloadFromRecord` | Migrated |
| `resolveHomeworkFromPayload` | Structured-only path |
| `resolveWorksheetFromPayload` | Structured-only path |
| `resolveMockTestFromPayload` | Structured-only path |
| `resolvePracticeQaFromPayload` | Structured-only path |
| Homework viewer | No markdown fallback |
| Worksheet viewer | No markdown fallback |
| `StructuredContentRequired` component | Added for missing structured JSON |

### Remaining incremental work

Lesson planner, activity, rubrics, story, daily class plan, concept mastery, exam paper, short notes resolve functions still contain markdown branches but are gated when structured JSON is present. Full structured-only guards can be added per-tool as needed.

---

## 3. Concurrency Protection Report

### Model: `AiGenerationLock`

Partial unique index on active locks per curriculum slot.

### Flow

1. `acquireGenerationLock` before batch/single generation
2. If active lock exists → HTTP 409 `Generation already in progress.`
3. `releaseGenerationLock` in `finally` block
4. `cleanupExpiredGenerationLocks` on acquire (default TTL 30 min)

### Config

`AI_GENERATOR_LOCK_TTL_MINUTES=30`

---

## 4. Topic Saturation Report

### Score

`topicSaturationScore` = total records in slot

### Levels

| Records | Level |
|---------|-------|
| 0–100 | Healthy |
| 101–500 | Growing |
| 501–1000 | High |
| 1001+ | Saturated |

### API

`GET /api/ai-generator/audit/saturation`

### Dashboard

Topic saturation table with level badges in Duplicate Audit tab.

---

## 5. Random Retrieval Report

### Trigger

When `existingCount >= 1000` and `forceGenerate !== true`

### Implementation

- `AiToolGeneration.aggregate([{ $match }, { $sample }])`
- Diversity filter: title fingerprint, content fingerprint, difficulty, generation date
- Returns 25 existing records — **zero Gemini tokens**

### Override

Admin checkbox: **Force Generate New Content**

---

## 6. Performance Benchmark Report

### Prompt scaling (100k+ records)

| Before | After |
|--------|-------|
| Loaded all historical records | Top 20 recent records only |
| 3000 fingerprint rows in prompt | 20 fingerprint samples |
| Full title/question lists | Deduplicated compact samples |

### Config

```env
AI_GENERATOR_HISTORICAL_PROMPT_LIMIT=20
AI_GENERATOR_FINGERPRINT_PROMPT_LIMIT=20
```

### Index usage

- `AiGenerationFingerprint`: `{ fingerprint, contentType }`, scope compound indexes
- `AiToolGeneration`: board/tool/class/subject/topic/subtopic indexes
- `$sample` uses collection scan on matched subset — acceptable at 100k+ with scoped `$match`

### Cost savings

Saturated topics use random retrieval → `geminiGenerationsAvoided` tracked in analytics.

---

## 7. Remaining Technical Debt Report

| Item | Priority |
|------|----------|
| Full structured-only guards on lesson/activity/rubric/story parsers | Medium |
| Mongo transactions for lock + save (requires replica set) | Low |
| Backfill job scheduling (cron) for new legacy imports | Low |
| Per-slot saturation cache collection | Low |
| Admin duplicate delete/merge actions | Low |

---

## File Summary

### Backend (new)

- `models/AiGenerationLock.js`
- `scripts/ai-fingerprint-backfill.js`
- `services/ai-generator-lock-service.js`
- `services/ai-generator-topic-saturation.js`
- `services/ai-generator-random-retrieval.js`
- `services/ai-generator-content-strategy.js`

### Backend (modified)

- `services/ai-generator-batch-orchestrator.js` — locks, strategy, random retrieval
- `services/ai-generator-historical-index.js` — top-20 compact prompts
- `services/ai-generator-audit-service.js` — saturation + savings metrics
- `controllers/aiGeneratorController.js` — forceGenerate, 409 lock, saturation API
- `routes/aiGeneratorRoutes.js` — `/audit/saturation`
- `package.json` — `ai:fingerprint-backfill`
- `.env` — saturation + lock + prompt limits

### Frontend (new)

- `components/structured-content-required.tsx`

### Frontend (modified)

- `lib/resolve-ai-structured-content.ts` — SSOT helpers
- `lib/parse-*.ts` — structured-only resolve + payload migration (8 tools)
- `components/homework-creator-viewer.tsx`
- `components/worksheet-mcq-viewer.tsx`
- `components/my-study-decks-viewer.tsx`
- `components/super-admin/ai-generator.tsx` — force generate checkbox
- `components/super-admin/ai-generator-audit.tsx` — saturation + savings
