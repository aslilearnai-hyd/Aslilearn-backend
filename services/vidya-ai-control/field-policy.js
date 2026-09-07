// Applies to schema discovery, filtering, aggregation and returned nested data.
export function isPrivateField(path) {
  return /(?:password|passwd|secret|token|otp|pinHash|signature|apiKey|authorization|cookie|resetCode|recoveryCode|salt)/i.test(path)
    || /^(?:__proto__|prototype|constructor|__v|pin)$/.test(path);
}

export function redactPlatformValue(value, depth = 0) {
  if (depth > 8 || Buffer.isBuffer(value)) return undefined;
  if (value == null || typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 8000) : value;
  if (value instanceof Date) return value.toISOString();
  if (value._bsontype) return String(value);
  if (Array.isArray(value)) return [...value.slice(0, 100).map(v => redactPlatformValue(v, depth + 1)), ...(value.length > 100 ? [`[${value.length - 100} additional items omitted]`] : [])];
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !isPrivateField(key))
    .map(([key, item]) => [key, redactPlatformValue(item, depth + 1)]));
}
