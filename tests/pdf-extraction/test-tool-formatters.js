/**
 * All 22 AI tools must have formatters registered.
 */
import { assertAllToolsHaveFormatters, listRegisteredFormatters } from '../../services/tool-formatters/index.js';
import { AI_TOOL_ORDERED_SLUGS } from '../../config/aiToolTemplates.js';

assertAllToolsHaveFormatters();

const registered = listRegisteredFormatters();
const missing = AI_TOOL_ORDERED_SLUGS.filter((s) => !registered.includes(s));
const extra = registered.filter((s) => !AI_TOOL_ORDERED_SLUGS.includes(s));

if (missing.length) {
  console.error('FAIL: missing formatters:', missing.join(', '));
  process.exit(1);
}
if (extra.length) {
  console.warn('WARN: extra formatters:', extra.join(', '));
}

console.log(`PASS: ${registered.length} tool formatters registered (expected ${AI_TOOL_ORDERED_SLUGS.length})`);
