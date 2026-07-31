/**
 * SSRF / open-proxy protection for outbound URL fetches.
 * Hostnames must match allowlisted domains exactly or as a subdomain suffix.
 */
const DEFAULT_CONTENT_DOMAINS = Object.freeze([
  'epathshala.nic.in',
  'ncert.nic.in',
  'diksha.gov.in',
  'cdn.aslilearn.ai',
  'aslilearn.ai',
]);

function normalizeHostname(hostname) {
  return String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
}

/**
 * True if host is exactly domain or a subdomain of domain (not a lookalike).
 * e.g. domain ncert.nic.in allows pdf.ncert.nic.in, not ncert.nic.in.evil.com
 */
export function hostnameMatchesAllowlist(hostname, allowedDomains = DEFAULT_CONTENT_DOMAINS) {
  const host = normalizeHostname(hostname);
  if (!host || host.includes('..')) return false;
  // Block obvious private / metadata hosts even if somehow listed
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === 'metadata.google.internal' ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0)/.test(host)
  ) {
    return false;
  }
  return allowedDomains.some((domain) => {
    const d = normalizeHostname(domain);
    return host === d || host.endsWith(`.${d}`);
  });
}

export function assertAllowedFetchUrl(rawUrl, allowedDomains = DEFAULT_CONTENT_DOMAINS) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    const err = new Error('Invalid URL');
    err.status = 400;
    throw err;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    const err = new Error('Only http(s) URLs are allowed');
    err.status = 400;
    throw err;
  }
  if (!hostnameMatchesAllowlist(parsed.hostname, allowedDomains)) {
    const err = new Error('Domain not allowed');
    err.status = 403;
    throw err;
  }
  return parsed;
}

export function getContentProxyAllowlist() {
  const fromEnv = String(process.env.CONTENT_PROXY_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : [...DEFAULT_CONTENT_DOMAINS];
}

export { DEFAULT_CONTENT_DOMAINS };
