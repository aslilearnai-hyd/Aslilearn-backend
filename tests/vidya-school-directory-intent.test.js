import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSchoolDirectoryQuestion } from '../services/vidya-school-directory-intent.js';
import { classifyPlatformDataQuestion } from '../services/vidya-platform-data-firewall.js';

test('directory requests are application questions for every viewer role', () => {
  for (const question of ['Tell me about the schools available there.', 'Show me the registered schools', 'List all the schools in our application', 'What are the available schools?']) {
    assert.equal(isSchoolDirectoryQuestion(question), true, question);
    for (const role of ['student', 'teacher', 'admin', 'super-admin']) {
      assert.equal(classifyPlatformDataQuestion(question, role).protected, true);
    }
  }
});

test('general concepts and external school searches are not forced to the app directory', () => {
  for (const question of ['What is photosynthesis?', 'Tell me about schools in London', 'What are schools of thought?', 'Why do schools have holidays?']) {
    assert.equal(isSchoolDirectoryQuestion(question), false, question);
  }
  assert.equal(classifyPlatformDataQuestion('What is photosynthesis?', 'student').protected, false);
});
