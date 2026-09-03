import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVidyaImage } from '../utils/vidya-image.js';

test('preserves PNG MIME rather than labelling every photo JPEG', () => {
  const data = Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64');
  assert.equal(normalizeVidyaImage(data, 'image/png').mimeType, 'image/png');
  assert.equal(normalizeVidyaImage(`data:image/png;base64,${data}`).imageBase64, data);
});
test('rejects unsupported, corrupt and oversized photos', () => {
  assert.throws(() => normalizeVidyaImage('AAAA', 'image/heic'), /JPEG/);
  assert.throws(() => normalizeVidyaImage('AAAA', 'image/jpeg'), /format/);
  assert.throws(() => normalizeVidyaImage('invalid!!!'), /read/);
  assert.throws(() => normalizeVidyaImage(Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64')), /smaller/);
});
