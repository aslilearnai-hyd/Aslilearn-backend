# Vidya AI — Operations Runbook

This document describes how Vidya AI is configured, secured and operated. It is the canonical reference for the Vidya stack introduced by the *"Vidya AI: From Gemini Wrapper to Connected Platform Brain"* plan.

## 1. Components

| Layer | File | Purpose |
| --- | --- | --- |
| Routes | [`routes/vidya.js`](../routes/vidya.js) | All `/api/ai-chat*` and chat-session endpoints. Auth + rate limit live here. |
| Orchestrator | [`services/vidya-service.js`](../services/vidya-service.js) | Builds context, runs RAG, calls model, sanitizes, persists, logs. |
| Persona | [`services/vidya-persona.js`](../services/vidya-persona.js) | Single source of truth for Vidya's identity and voice. Role-aware. |
| Model router | [`services/model-router.js`](../services/model-router.js) | Gemini fallback chain + cross-vendor emergency fallback. Streaming support. |
| Retriever | [`services/vidya-retriever.js`](../services/vidya-retriever.js) | RAG against `AiContentEngineChunk` (with legacy `PdfChunk` fallback). |
| Cross-module context | [`services/vidya-context.js`](../services/vidya-context.js) | Pulls recent `ExamResult`, `UserProgress`, `LearningPath` for prompt enrichment. |
| Persistent sessions | [`models/ChatSession.js`](../models/ChatSession.js) | Replaces the old in-memory `Map`. TTL 180 days. |
| Observability | [`models/VidyaCallLog.js`](../models/VidyaCallLog.js) | Every Vidya call: who, what, model, latency, retrieval tier, safety flags. TTL 90 days. |
| Rate limit | [`middleware/rate-limit.js`](../middleware/rate-limit.js) | IP global + per-user + per-user heavy. Redis-backed if `REDIS_URL` set. |

### Platform aggregates (admins only)

Vidya **does not** expose MongoDB collections or “all tables” to the Gemini API. That would be unsafe. Instead, for **`super-admin`** and **`admin`** (school admin JWT role), [`services/vidya-context.js`](../services/vidya-context.js) runs fixed read-only aggregates each chat turn (`User` counts by role, exam totals, Vidya usage, PDF chunk totals, plus school-scoped student counts for admins) and passes the resulting JSON inside the **system prompt** so answers like “how many students?” match the database. Extend that function if you need more metrics—never widen raw table access via the chat model.

Students and teachers do not receive this block.

## 2. Endpoints

All Vidya endpoints require a JWT (`Authorization: Bearer <token>`).

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/ai-chat` | One-shot reply (returns full text). |
| `POST` | `/api/ai-chat/stream` | Server-Sent Events stream of tokens. Recommended for the UI. |
| `POST` | `/api/ai-chat/analyze-image` | Vision endpoint. Heavy rate-limited. |
| `GET` | `/api/users/:userId/chat-sessions` | Persistent chat history list. Owner or admin/super-admin. |
| `GET` | `/api/chat-sessions/:sessionId` | Full session contents. |
| `DELETE` | `/api/chat-sessions/:sessionId` | Soft-archive a session. |
| `GET` | `/api/vidya/admin/call-logs` | Super-admin observability. |
| `GET` | `/api/vidya/admin/retrieval-tiers` | Super-admin: daily % from PDF library vs Gemini-only. |

### SSE event types on `/api/ai-chat/stream`

- `session` — `{ sessionId }` emitted first.
- `citations` — `{ citations[], priorityTier }` (1 = strong PDF match, 2 = weak hint, 3 = no match).
- `token` — `{ text }` (one or more, stream as you receive).
- `safety` — `{ reason, ratings }` if safety filter triggers.
- `done` — terminal event with `{ sessionId, model, fallbackUsed, latencyMs, priorityTier }`.
- `error` — `{ message, retryable }` and the stream ends.

## 3. Environment variables

Already present:
- `VIDYA_AI_GEMINI_API_KEY` (or `GEMINI_API_KEY`) — primary Vidya model key.
- `VIDYA_AI_GEMINI_MODEL` — default `gemini-2.0-flash`.
- `VIDYA_AI_GEMINI_FALLBACK_MODELS` — CSV. Default chain hits 4 Gemini models.
- `GEMINI_API_BASE_URL` — defaults to the public endpoint.
- `REDIS_URL` — when set, all rate limits and the BullMQ queue use it. Without it the limits use in-process memory (fine for single-instance).
- `MONGO_URI`, `JWT_SECRET` — existing.

New / now-honoured variables:
- `ANTHROPIC_API_KEY` — optional. Enables Claude as an emergency fallback.
- `ANTHROPIC_FALLBACK_MODEL` — defaults to `claude-3-5-haiku-latest`.
- `OPENAI_API_KEY` — optional. Enables OpenAI as an emergency fallback.
- `OPENAI_FALLBACK_MODEL` — defaults to `gpt-4o-mini`.
- `VIDYA_EMERGENCY_FALLBACK` — CSV order, e.g. `anthropic,openai`. Defaults to that order.
- `AI_CHAT_GLOBAL_MAX` — global IP requests per 15 minutes (default 100).
- `AI_CHAT_USER_MAX` — per-user requests per minute (default 30).
- `AI_HEAVY_MAX` — per-user image/PDF analyses per minute (default 8).
- `RAG_STRONG_THRESHOLD` — top chunk score above which Vidya cites (default 0.78).
- `RAG_WEAK_THRESHOLD` — minimum score for chunks to enter the prompt (default 0.55).
- `RAG_TOP_K` — chunks to consider (default 6).
- `CHAT_SESSION_TTL_DAYS` — chat session retention (default 180).
- `VIDYA_CALL_LOG_TTL_DAYS` — observability retention (default 90).
- `AI_GENERATOR_DEFAULT_STATE` — set to `approved` to keep the legacy "live immediately" behaviour while the review UX rolls out. Otherwise new generations land as `draft`.

## 4. Gemini API key ownership transfer (Phase 3.1)

The Vidya keys must live in **Kakani Edu Media's** Google Cloud Platform account so the customer owns the billing relationship.

### Steps

1. **Create the project** under the Kakani Edu Media organisation in [Google Cloud Console](https://console.cloud.google.com/).
2. **Enable** the *Generative Language API*.
3. **Attach** Kakani Edu Media's billing account to the project. Set up a budget alert at the agreed monthly cap.
4. **Create an API key**, restricted to the *Generative Language API* (and optionally to your server's IP range / referrers).
5. **Stage the new key**:
   - In production `.env`, set `VIDYA_AI_GEMINI_API_KEY=<new key>`.
   - **Keep the old key** in `GEMINI_API_KEY` for the next 48 hours so the embedding code (which reads `GEMINI_API_KEY` / `GOOGLE_API_KEY`) continues to function during the overlap.
6. **Verify** by hitting `/api/ai-chat` with a test student; confirm the new key is used by checking `VidyaCallLog` for successful entries with the new model name. Watch billing for traffic.
7. **48-hour overlap**: monitor for 48 hours.
8. **Rotate the embedding key**: once stable, update `GEMINI_API_KEY` and `GOOGLE_API_KEY` to the new key and revoke the old one in the previous GCP project.
9. **Document** in your password manager that the new key lives under the Kakani Edu Media account, with a rotation reminder set for 6 months.

### Verification command

```bash
curl -X POST https://YOUR_API_HOST/api/ai-chat \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"message":"hello"}'
```

A successful response means the new key is working. Confirm in MongoDB:

```js
db.vidyacalllogs.find({}).sort({ ts: -1 }).limit(5)
```

## 5. Safety filter audit

Vidya now sends explicit `safetySettings` to Gemini at `BLOCK_ONLY_HIGH` for the four standard categories. This prevents legitimate chemistry / biology / history questions from getting blocked.

To audit refused questions:

```js
// Most recent safety blocks
db.vidyacalllogs.find({ safetyBlocked: true }).sort({ ts: -1 }).limit(20)
```

Or via API (super-admin):

```
GET /api/vidya/admin/call-logs?limit=200
```

Filter the response client-side on `safetyBlocked: true` to see what was refused.

## 6. The 10-step Live Verification Checklist

Run these together on a screen-share to confirm everything works.

1. **Auth bypass** — `curl -X POST $API/api/ai-chat -d '{"message":"hi"}' -H 'Content-Type: application/json'` ⇒ expect `401`.
2. **Rate limit** — send >30 chats / minute as one user ⇒ expect `429` with the friendly Vidya message.
3. **PDF citation** — pick a paragraph from an uploaded PDF, ask the question, confirm the answer cites `[Subject | Class | Chapter]`.
4. **Role behaviour** — ask "give me 10 MCQs on photosynthesis" from a Student account vs a Teacher account. Student gets explanation + offer; Teacher gets a clean numbered MCQ list.
5. **Persistence** — chat 5 messages, restart the backend (`npm start`), log in again, confirm history is intact via `GET /api/users/:userId/chat-sessions`.
6. **Cross-module memory** — submit an exam, wait 2 minutes, ask Vidya "any tips for me today?" and confirm the response references the recent exam.
7. **Persona** — ask "what AI model are you?" ⇒ expect "I am Vidya — your AsliLearn study companion" and **no** mention of Gemini / Google / LLM.
8. **Streaming** — call `/api/ai-chat/stream`; tokens stream over SSE.
9. **Failure UX** — set `VIDYA_AI_GEMINI_API_KEY` to garbage temporarily; expect a clean retryable response, not a stack trace.
10. **Approval** — generate AI Generator content as Super Admin (`POST /api/ai-generator/generate`); confirm it does **not** appear to a student via `/api/student/ai/tool` until you `POST /api/ai-generator/records/:id/review { action: 'approve' }`.

## 7. Migration scripts

- `node scripts/migrate-pdf-chunks.js --dry-run` — preview the legacy `PdfChunk` ⇒ `AiContentEngineChunk` migration.
- `node scripts/migrate-pdf-chunks.js` — run the migration.

After this, all retrieval flows through `AiContentEngineChunk` (the same collection PDF uploads write to) which fixes the disconnect documented in the original plan.
