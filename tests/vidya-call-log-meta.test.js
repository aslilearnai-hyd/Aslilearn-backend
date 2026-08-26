import assert from 'node:assert/strict';
import { mentorCallLogMeta } from '../utils/vidya-call-log-meta.js';

assert.deepEqual(mentorCallLogMeta({ groundingStatus: 'application' }), {
  provider: 'local',
  success: true,
});

assert.deepEqual(mentorCallLogMeta({ groundingStatus: 'social' }), {
  provider: 'local',
  success: true,
});

assert.deepEqual(mentorCallLogMeta({ groundingStatus: 'ai_context_aware' }), {
  provider: 'gemini',
  success: true,
});

assert.deepEqual(mentorCallLogMeta({ groundingStatus: 'general_knowledge' }), {
  provider: 'gemini',
  success: true,
});

assert.deepEqual(mentorCallLogMeta({ groundingStatus: 'ai_error' }), {
  provider: 'fallback',
  success: false,
});

assert.deepEqual(mentorCallLogMeta({ groundingStatus: 'application_fallback' }), {
  provider: 'fallback',
  success: true,
});

assert.deepEqual(mentorCallLogMeta({ groundingStatus: 'grounding_blocked' }), {
  provider: 'local',
  success: false,
});

console.log('vidya-call-log-meta.test.js: all passed');
