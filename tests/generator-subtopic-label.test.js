import assert from 'node:assert/strict';
import {
  canonicalizeGeneratorSubtopic,
  isJoinedMultiSubtopicLabel,
  WHOLE_CHAPTER_LABEL,
} from '../ai/generators/shared/generator-subtopic-label.js';

assert.equal(isJoinedMultiSubtopicLabel('Speed, Velocity and Acceleration'), false);
assert.equal(isJoinedMultiSubtopicLabel('A | B'), true);
assert.equal(isJoinedMultiSubtopicLabel('Topic A + Topic B'), true);

assert.equal(
  canonicalizeGeneratorSubtopic('Speed, Velocity and Acceleration'),
  'Speed, Velocity and Acceleration',
);
assert.equal(canonicalizeGeneratorSubtopic(''), WHOLE_CHAPTER_LABEL);
assert.equal(canonicalizeGeneratorSubtopic('Whole chapter'), WHOLE_CHAPTER_LABEL);
assert.equal(
  canonicalizeGeneratorSubtopic('System of Measurement', { chapterScope: true }),
  WHOLE_CHAPTER_LABEL,
);
assert.equal(
  canonicalizeGeneratorSubtopic('A', { subTopicList: ['A', 'B'] }),
  WHOLE_CHAPTER_LABEL,
);
assert.equal(
  canonicalizeGeneratorSubtopic('A | B'),
  WHOLE_CHAPTER_LABEL,
);

console.log('generator-subtopic-label tests passed');
