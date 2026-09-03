import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
let captured;
let missing = false;
let topicsMissing = false;
mock.module('../services/model-router.js', { namedExports: {
  callModel: async payload => { captured = payload; return { text: 'Number patterns follow a rule. [B1]' }; },
  buildContentsFromHistory: ({ userMessage }) => [{ role: 'user', content: userMessage }],
} });
mock.module('../services/vidya-curriculum.js', { namedExports: {
  resolveVidyaCurriculum: async () => ({ context: topicsMissing ? '' : 'Chapter 1 - Pattern In Mathematics', scope: { track: 'ALPHA' } }),
} });
mock.module('../services/vidya-textbook-context.js', { namedExports: {
  retrieveVidyaTextbookContext: async () => ({ context: missing ? '' : 'PDF PASSAGE: Number patterns follow a rule. [B1]', sources: missing ? [] : [{ id: 'B1' }] }),
  textbookSourceFooter: sources => sources.length ? '\nRetrieved source B1' : '',
} });
const { generateGeneralKnowledgeAnswer, generateContextAwareAnswer } = await import('../services/vidya-student/gemini-general-knowledge-service.js');
test('teacher and student model requests include syllabus and actual retrieved text', async () => {
  for (const generate of [generateGeneralKnowledgeAnswer, generateContextAwareAnswer]) {
    const result = await generate({ question: 'Teach chapter 1', viewerUserId: 'test' });
    assert.match(captured.systemInstruction, /Pattern In Mathematics/);
    assert.match(captured.systemInstruction, /PDF PASSAGE: Number patterns/);
    assert.match(result, /Retrieved source B1/);
  }
});
test('configured topic permits a clearly labelled general explanation without PDF evidence', async () => {
  missing = true;
  for (const generate of [generateGeneralKnowledgeAnswer, generateContextAwareAnswer]) {
    await generate({ question: 'Teach chapter 1', viewerUserId: 'test' });
    assert.match(captured.systemInstruction, /Pattern In Mathematics/);
    assert.match(captured.systemInstruction, /general explanation/);
  }
});
test('no topic or PDF evidence does not call Gemini to guess', async () => {
  missing = true;
  topicsMissing = true;
  captured = null;
  for (const generate of [generateGeneralKnowledgeAnswer, generateContextAwareAnswer]) {
    const result = await generate({ question: 'Teach chapter 1', viewerUserId: 'test' });
    assert.match(result, /AI Tool Topics and matching indexed textbooks/);
    assert.equal(captured, null);
  }
});
