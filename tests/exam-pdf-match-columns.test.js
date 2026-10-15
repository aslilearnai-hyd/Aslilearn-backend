import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseMatchColumnsFromStem } from '../services/exam-pdf-enrichment.js';

describe('exam PDF Match-the-Following extraction', () => {
  it('parses inline columns after an instruction sentence that also names both columns', () => {
    const stem =
      'Match each item in Column I with its corresponding value in Column II. ' +
      'Column I: A. Distance between (-1, 2) and (2, 6) ' +
      'B. Midpoint of (-5, 7) and (9, -1) ' +
      'C. Discriminant of x^2 - 6x + 9 = 0 ' +
      'D. Vertex of y = x^2 - 6x + 8 ' +
      'Column II: 1. (2, 3) 2. 5 3. 0 4. (3, -1)';

    const result = parseMatchColumnsFromStem(stem);

    assert.deepEqual(result.matchColumnI.map((item) => item.key), ['A', 'B', 'C', 'D']);
    assert.deepEqual(result.matchColumnII.map((item) => item.key), ['1', '2', '3', '4']);
    assert.match(result.matchColumnI[0].text, /Distance between/);
    assert.equal(result.matchColumnII[1].text, '5');
  });
});
