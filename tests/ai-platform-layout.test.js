/**
 * AI platform layout smoke — shims and barrels still resolve.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('ai platform layout', () => {
  it('prompt registry loads via legacy prompts/ shim', async () => {
    const { PROMPT_REGISTRY, isPromptEngineEnabled } = await import('../prompts/registry.js');
    assert.ok(Object.keys(PROMPT_REGISTRY).length >= 15);
    assert.equal(typeof isPromptEngineEnabled, 'function');
  });

  it('providers resolve via services/gemini-service shim', async () => {
    const mod = await import('../services/gemini-service.js');
    assert.ok(mod.default || mod.generateTeacherTool || mod.generateStudentTool);
  });

  it('generators core resolves via services shim', async () => {
    const engine = await import('../services/ai-content-engine-service.js');
    assert.equal(typeof engine.generateStructuredContentForAiGenerator, 'function');
  });

  it('rag embeddings façade exports retrieveRelevantChunks', async () => {
    const emb = await import('../ai/rag/embeddings/index.js');
    assert.equal(typeof emb.retrieveRelevantChunks, 'function');
  });

  it('quality gate resolves via services shim', async () => {
    const gate = await import('../services/ai-generator-quality-gate.js');
    assert.ok(gate.runAiGeneratorQualityGate || gate.isPlaceholderText || Object.keys(gate).length > 0);
  });
});
