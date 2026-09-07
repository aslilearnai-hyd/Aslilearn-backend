import assert from 'node:assert/strict';
import { normalizeClassNumberLabel } from '../utils/studentClassContent.js';

assert.equal(normalizeClassNumberLabel('Class 7'), '7');
assert.equal(normalizeClassNumberLabel('VI'), '6');
assert.equal(normalizeClassNumberLabel('IIT-6'), '6');
assert.equal(normalizeClassNumberLabel('#_@_@_'), '');
assert.equal(normalizeClassNumberLabel('Class #_@_@_'), '');
assert.equal(normalizeClassNumberLabel(''), '');
assert.equal(normalizeClassNumberLabel('99'), '');

console.log('normalizeClassNumberLabel junk-filter tests passed');
