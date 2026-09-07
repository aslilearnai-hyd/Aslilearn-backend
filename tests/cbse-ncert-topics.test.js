import assert from 'node:assert/strict';
import { canonicalCbseNcertTopics } from '../ai/shared/cbse-ncert-topics.js';
import { filterTopicsForSplitScienceSubject } from '../ai/shared/ai-tool-topic-taxonomy.js';

const subjects = ['English', 'Hindi', 'Maths', 'Science', 'Social Science', 'Physics', 'Chemistry', 'Biology'];
for (const classNumber of ['6', '7', '8', '9', '10']) {
  for (const subject of subjects) {
    const topics = canonicalCbseNcertTopics(`Class ${classNumber}`, subject, 'CBSE');
    assert.ok(
      topics.length > 0,
      `Expected CBSE Class ${classNumber} ${subject} topics, got ${topics.length}`,
    );
  }
}

assert.equal(canonicalCbseNcertTopics('Class 6', 'Mathematics', 'CBSE').includes('Knowing Our Numbers'), true);
assert.equal(canonicalCbseNcertTopics('Class 6', 'Maths', 'IIT/NEET').length, 0);

const science = canonicalCbseNcertTopics('Class 6', 'Science', 'CBSE');
assert.ok(filterTopicsForSplitScienceSubject(science, 'Chemistry', 'CBSE', 'Class 6').includes('Sorting Materials into Groups'));
assert.ok(filterTopicsForSplitScienceSubject(science, 'Biology', 'CBSE', 'Class 6').some((t) => /plants|living|food/i.test(t)));
assert.ok(filterTopicsForSplitScienceSubject(science, 'Physics', 'CBSE', 'Class 6').includes('Fun with Magnets'));

console.log('CBSE NCERT topic catalog tests passed');
