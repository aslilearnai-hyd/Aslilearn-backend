# ASLI Learn Prompt Engine

Per-tool prompt packs that transform AI-generated educational content quality without changing UI, tool slugs, or navigation.

## Architecture

```
backend/prompts/
├── registry.js              # Loads 19 registered tool packs (2 retired packs remain on disk only)
├── create-tool-prompt-pack.js
├── quality-content-check.js   # Banned phrases + specificity scan
├── shared/
│   ├── educator-persona.js  # System role (NCERT author, CBSE expert, etc.)
│   ├── banned-phrases.js    # Rejects generic AI instructions
│   ├── grade-level.js       # Class 1–12 cognitive adaptation
│   ├── subject-awareness.js # Science/Maths/English/Social/Language rules
│   └── pedagogy-depth.js    # Differentiation, Bloom, teacher script, misconceptions
└── tools/
    ├── lesson-planner.js
    ├── worksheet-mcq-generator.js
    └── … (21 files total)
```

## Each tool pack exports

| Method | Purpose |
|--------|---------|
| `system(ctx)` | Educator persona + universal quality rules |
| `generation(ctx)` | Tool-specific depth instructions + grade/subject blocks |
| `rewrite(ctx)` | Validation retry when quality gate fails |
| `repair(ctx)` | LLM section repair for missing fields |

## Integration points

1. **`buildAiGeneratorPromptParts`** (`config/aiToolTemplates.js`) — injects Prompt Engine system + generation blocks into every Gemini call
2. **`runAiGeneratorQualityGate`** — scans for banned phrases + thin teacher-script fields
3. **`repairMissingSectionsViaLlm`** — uses per-tool repair prompts
4. **`generateStructuredContentForAiGenerator`** — uses per-tool rewrite prompts on retry

## Toggle

```bash
# Default: ON
AI_PROMPT_ENGINE=true

# Revert to legacy generic prompts
AI_PROMPT_ENGINE=false
```

## Quality philosophy

- No generic phrases ("Explain the concept", "Discuss with students")
- Teacher scripts with actual dialogue and expected student answers
- Subtopic-specific examples, misconceptions, differentiation
- Grade- and subject-adaptive vocabulary
- Bloom progression in assessments
- Reject thin / AI-sounding output before save

## Extending a tool

Edit `backend/prompts/tools/<slug>.js` — add `generationRules`, enable flags like `includeTeacherScript`, or expand `rewriteRules`.

Shared rules live in `backend/prompts/shared/` and apply to all tools automatically.
