import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSystemPrompt } from '../services/vidya-persona.js';

test('teacher persona receives the signed-in teacher name', () => {
  const prompt = buildSystemPrompt({
    role: 'teacher',
    studentName: 'Vishwas Ramasani',
    subject: 'Biology',
  });

  assert.match(prompt, /signed-in teacher's name is Vishwas Ramasani/);
  assert.match(prompt, /Your name is Vishwas Ramasani/);
  assert.match(prompt, /Never claim that you cannot access their name or profile/);
});

test('teacher persona does not present a generic fallback as a real name', () => {
  const prompt = buildSystemPrompt({
    role: 'teacher',
    studentName: 'Teacher',
    subject: 'General',
  });

  assert.doesNotMatch(prompt, /signed-in teacher's name is Teacher/);
});
