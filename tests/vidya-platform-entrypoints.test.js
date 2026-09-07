import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const seen = [];
mock.module('../services/vidya-platform-intelligence.js', { namedExports: {
  runPlatformIntelligence: async request => { seen.push(request); return { message: 'Connected answer', groundingStatus: 'database_grounded' }; },
} });
mock.module('../services/vidya-service.js', { defaultExport: {} });
mock.module('../services/vidya-ai-control-service.js', { namedExports: { handleControlAssistantTurn: async request => { seen.push(request); return { message: 'Control answer' }; } } });
mock.module('../services/vidya-student/hybrid-ai-chat-controller.js', { namedExports: { runHybridStudentVidyaChat: async () => { throw new Error('Unexpected legacy student path'); } } });
mock.module('../services/vidya-teacher/teacher-hybrid-chat-controller.js', { namedExports: { runHybridTeacherVidyaChat: async () => { throw new Error('Unexpected legacy teacher path'); } } });
const { handleVidyaTurn, PLANES } = await import('../services/vidya-orchestrator.js');

test('teacher and student entrypoints pass authenticated identity and history into shared intelligence', async () => {
  for (const [role, plane] of [['teacher', PLANES.MENTOR_TEACHER], ['student', PLANES.MENTOR_STUDENT]]) {
    const result = await handleVidyaTurn({ plane, req: { userId: 'signed-in', user: { role } }, body: { message: 'Connect my results and homework', role: 'super-admin', userId: 'forged', history: [{ role: 'user', content: 'Earlier question' }] } });
    assert.equal(result.message, 'Connected answer');
    const request = seen.at(-1);
    assert.equal(request.viewerRole, role);
    assert.equal(request.viewerUserId, 'signed-in');
    assert.equal(request.history[0].content, 'Earlier question');
  }
});

test('control entrypoint retains authenticated scope and existing audit service', async () => {
  await handleVidyaTurn({ plane: PLANES.CONTROL, req: { userId: 'school-admin', user: { role: 'admin' }, headers: {} }, body: { message: 'School overview', role: 'super-admin' } });
  assert.equal(seen.at(-1).viewerRole, 'admin');
  assert.equal(seen.at(-1).viewerUserId, 'school-admin');
});
