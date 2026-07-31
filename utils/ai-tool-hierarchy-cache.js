/** In-memory hierarchy aggregate cache for Super Admin AI Tool Data. */

/** @type {Map<string, { at: number, value: unknown }>} */
export const aggregateCache = new Map();
/** @type {Map<string, Promise<unknown>>} */
export const aggregateInFlight = new Map();

export function clearAiToolHierarchyCache() {
  aggregateCache.clear();
  aggregateInFlight.clear();
}
