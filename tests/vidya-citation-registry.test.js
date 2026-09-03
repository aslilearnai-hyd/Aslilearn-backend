import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSourceFollowUp,
  parseCitationRegistryFromMessage,
  lastAssistantCitationRegistry,
  explainStoredSources,
  maybeExplainStoredSources,
} from '../services/vidya-citation-registry.js';
import { bindAnswerToCitationRegistry } from '../services/vidya-textbook-context.js';

test('source follow-up is detected without treating a maths lesson as a source lookup', () => {
  assert.equal(isSourceFollowUp('What are these sources ??'), true);
  assert.equal(isSourceFollowUp('explain these sources'), true);
  assert.equal(isSourceFollowUp('Teach me chapter 2 alpha iit maths'), false);
});

test('follow-up reads the previous assistant registry and never invents chemistry', () => {
  const previous = `Arithmetic expressions group numbers and operations. [B1]

Sources:
• [B1] Maths 7th Alpha — Chapter 2 Arithmetic Expressions`;
  const history = [
    { role: 'user', content: 'Teach me chapter 2 alpha iit maths' },
    { role: 'assistant', content: previous },
  ];
  const reply = maybeExplainStoredSources('What are these sources ??', history);
  assert.match(reply, /Maths 7th Alpha/);
  assert.match(reply, /Chapter 2 Arithmetic Expressions/);
  assert.doesNotMatch(reply, /Chemistry Alpha|Physics ·|Poorvi/i);
});

test('structured citations on history win over a contradictory Sources block', () => {
  const history = [{
    role: 'assistant',
    content: 'Answer [B1]\n\nSources:\n• [B1] Chemistry Alpha — Introduction',
    citations: [{ id: 'B1', title: 'Maths 7th Alpha', chapter: 'Chapter 2 Arithmetic Expressions' }],
  }];
  const registry = lastAssistantCitationRegistry(history);
  assert.equal(registry[0].title, 'Maths 7th Alpha');
  assert.match(explainStoredSources(registry), /Maths 7th Alpha/);
  assert.doesNotMatch(explainStoredSources(registry), /Chemistry Alpha/);
});

test('missing registry fails closed instead of guessing books', () => {
  assert.match(maybeExplainStoredSources('what are these sources', []), /cannot verify/);
});

test('in-text citations that are not in the registry are stripped and the footer is unique', () => {
  const sources = [
    { id: 'B1', title: 'Maths 7th Alpha', chapter: 'Chapter 2 Arithmetic Expressions' },
    { id: 'B2', title: 'Chemistry Alpha', chapter: 'Introduction' },
  ];
  const raw = 'Use inverse operations. [B1] [B5]\n\nSources:\n• [B1] [B5] [B6] Mathematics · Alpha — Chapter 2\n\nSources:\n• [B4] Chemistry Alpha — Introduction';
  const bound = bindAnswerToCitationRegistry(raw, sources);
  assert.equal((bound.text.match(/Sources:/g) || []).length, 1);
  assert.match(bound.text, /\[B1\]/);
  assert.doesNotMatch(bound.text, /\[B5\]|\[B6\]|\[B4\]|\[B2\]/);
  assert.doesNotMatch(bound.text, /Chemistry/);
  assert.deepEqual(bound.citations.map(s => s.id), ['B1']);
});

test('parseCitationRegistryFromMessage keeps one id bound to one title', () => {
  const parsed = parseCitationRegistryFromMessage('Lesson [B1] [B2]\n\nSources:\n• [B1] Maths 7th Alpha — Chapter 2\n• [B2] Maths 7th Alpha — Working with brackets');
  assert.equal(parsed[0].id, 'B1');
  assert.equal(parsed[0].title, 'Maths 7th Alpha');
  assert.equal(parsed[1].chapter, 'Working with brackets');
});
