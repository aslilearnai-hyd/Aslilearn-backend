/**
 * Shared helper for PDF extraction smoke tests.
 */

/**
 * @param {string} name
 * @param {(text: string) => unknown[]} extractFn
 * @param {string} sample
 * @param {{ minCount?: number; label?: string }} [options]
 */
export function runExtractTest(name, extractFn, sample, options = {}) {
  const minCount = options.minCount ?? 1;
  const label = options.label || name;

  console.log(`\n=== ${label} ===`);
  try {
    const items = extractFn(sample);
    console.log('count', items.length);
    console.log(JSON.stringify(items, null, 2));

    if (!Array.isArray(items)) {
      console.error(`FAIL: ${label} — extractor did not return an array`);
      return false;
    }
    if (items.length < minCount) {
      console.error(`FAIL: ${label} — expected at least ${minCount} item(s), got ${items.length}`);
      return false;
    }
    console.log(`PASS: ${label}`);
    return true;
  } catch (err) {
    console.error(`FAIL: ${label} — ${err?.message || err}`);
    if (err?.stack) console.error(err.stack.split('\n').slice(0, 4).join('\n'));
    return false;
  }
}
