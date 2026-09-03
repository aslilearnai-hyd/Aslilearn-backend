import path from 'node:path';

const types = {
  '.pdf': ['application/pdf'], '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.ppt': ['application/vnd.ms-powerpoint'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.xls': ['application/vnd.ms-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.txt': ['text/plain'], '.png': ['image/png'], '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'], '.webp': ['image/webp'],
};
export function isAllowedUploadMetadata(name, mime) {
  const allowed = types[path.extname(name || '').toLowerCase()];
  return !!allowed && (allowed.includes(String(mime).toLowerCase()) || mime === 'application/octet-stream');
}

export function matchesUploadBytes(name, bytes) {
  const ext = path.extname(name).toLowerCase();
  const starts = (hex) => bytes.subarray(0, hex.length / 2).equals(Buffer.from(hex, 'hex'));
  if (ext === '.pdf') return bytes.subarray(0, 5).toString() === '%PDF-';
  if (ext === '.png') return starts('89504e470d0a1a0a');
  if (ext === '.jpg' || ext === '.jpeg') return starts('ffd8ff');
  if (ext === '.webp') return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (['.doc', '.ppt', '.xls'].includes(ext)) return starts('d0cf11e0a1b11ae1');
  if (['.docx', '.pptx', '.xlsx'].includes(ext)) return starts('504b0304');
  if (ext === '.txt') return !bytes.includes(0);
  return false;
}
