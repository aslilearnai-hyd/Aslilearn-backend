/** In-memory hierarchy aggregate cache for Super Admin AI Tool Data. */

/** @type {Map<string, { at: number, value: unknown }>} */
export const aggregateCache = new Map();
/** @type {Map<string, Promise<unknown>>} */
export const aggregateInFlight = new Map();

export function clearAiToolHierarchyCache() {
  if (aggregateCache.size > 0) aggregateCache.clear();
  if (aggregateInFlight.size > 0) aggregateInFlight.clear();
}
