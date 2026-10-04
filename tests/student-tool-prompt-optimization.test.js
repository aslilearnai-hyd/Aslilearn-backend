import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STUDENT_TOOL_SLUGS,
  buildToolPack,
  isStudentToolSlug,
} from '../ai/prompt-versioning/tool-packs.js';
import { getBookRagMaxContextChars } from '../ai/rag/books/book-rag-service.js';
import { GENERATOR_LIST_SELECT } from '../controllers/aiGeneratorController.js';

test('every configured student tool uses the compact student contract', () => {
  assert.equal(STUDENT_TOOL_SLUGS.length, 9);
  for (const slug of STUDENT_TOOL_SLUGS) {
    const pack = buildToolPack(slug);
    assert.equal(isStudentToolSlug(slug), true);
    assert.equal(pack.audience, 'student');
    assert.match(pack.instructions, /Do not generate teacher lesson-delivery/i);
    assert.match(pack.responseSchema, /complete but concise answer/i);
    assert.match(pack.responseSchema, /steps only for numericals/i);
    assert.match(pack.responseSchema, /"teacher"/);
    assert.match(pack.responseSchema, /no teacher\/classroom-management advice/i);
  }
});

test('student optimization preserves complete question and answer requirements', () => {
  const mock = buildToolPack('mock-test-builder');
  assert.match(mock.responseSchema, /sectionA_mcq/);
  assert.match(mock.responseSchema, /sectionD_application/);
  assert.match(mock.responseSchema, /sectionE_long/);
  assert.match(mock.responseSchema, /"answerKey"/);
  assert.match(mock.instructions, /Keep all required learning content, questions, answers, and worked numericals/i);
});

test('teacher tools retain the full teacher-oriented contract', () => {
  const teacher = buildToolPack('lesson-planner');
  assert.equal(teacher.audience, 'teacher');
  assert.match(teacher.responseSchema, /3-5 measurable objectives/);
  assert.match(teacher.responseSchema, /classroom management \/ blackboard tip/);
  assert.doesNotMatch(teacher.responseSchema, /short self-study time suggestion/);
});

test('student RAG context is smaller while retaining a substantial grounding budget', () => {
  const studentBudget = getBookRagMaxContextChars('student');
  const teacherBudget = getBookRagMaxContextChars('teacher');
  assert.equal(studentBudget, 6500);
  assert.ok(studentBudget < teacherBudget);
  assert.ok(studentBudget >= 6000);
});

test('completed generation lists retain persistent token and cost visibility', () => {
  assert.match(GENERATOR_LIST_SELECT, /metadata\.cost/);
  assert.match(GENERATOR_LIST_SELECT, /metadata\.tokenUsage/);
});
