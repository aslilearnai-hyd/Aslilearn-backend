# ASLILEARN AI Platform

Domain layout for prompts, generators, RAG, providers, and quality systems.

```
ai/
├── prompt-engine/       # Pack factory + shared prompt layers
├── prompt-registry/     # Per-tool prompt packs + registry
├── prompt-versioning/   # V2 six-section assembler
├── generators/          # Tool generation (core monolith + shared/batch)
│   ├── core/            # ai-content-engine-service (split per tool later)
│   ├── _batch/          # Batch orchestrators
│   ├── _formatters/     # Slug → render/canonicalize
│   ├── _v2/             # Six-section generator
│   ├── diagrams/
│   └── shared/
├── rag/
│   ├── pdf/             # PDF RAG, extractors, queue
│   ├── books/           # Book KB ingest + retrieval
│   ├── embeddings/      # Façade over pdf-rag embeddings
│   └── retrieval/       # Curriculum + Vidya retrievers
├── validation/
├── quality-gates/
├── repair/
├── streaming/           # SSE helpers
├── providers/           # Gemini, model-router, token cost
└── shared/              # Cross-cutting AI utils
```

**Compatibility:** Old paths under `services/`, `prompts/`, `utils/`, `config/` re-export from here so existing imports keep working.

**Follow-ups:** Split `ai-content-engine-service.js` and `config/aiToolTemplates.js` per tool; extract embeddings from pdf-rag; thin `routes/pdf-rag.js`.
