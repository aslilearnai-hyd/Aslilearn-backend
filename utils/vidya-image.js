export function normalizeVidyaImage(image, mimeType) {
  const raw = String(image || '');
  const match = raw.match(/^data:(image\/[\w.+-]+);base64,(.*)$/s);
  const data = match ? match[2] : raw;
  const mime = match?.[1] || mimeType || 'image/jpeg';
  const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) fail('Use a JPEG, PNG or WebP photo.');
  if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) fail('The photo could not be read. Please upload it again.');
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > 5 * 1024 * 1024) fail('Please upload a photo smaller than 5 MB.', 413);
  const valid = mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) fail('The photo format does not match its contents. Export it as JPEG or PNG and try again.');
  return { imageBase64: data, mimeType: mime };
}
