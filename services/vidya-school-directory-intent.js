/** Unqualified school-directory requests refer to the current application.
 * Geographic searches and educational concepts still go to the intent model.
 */
export function isSchoolDirectoryQuestion(question) {
  return /^(?:please\s+)?(?:tell me about|show(?: me)?|list|what are|which are|give me)(?:\s+all)?(?:\s+the)?\s+(?:available\s+|registered\s+)?schools(?:\s+(?:available|registered))?(?:\s+(?:there|here|in (?:this|our|the) (?:app|application|platform)|on aslilearn))?[?.!\s]*$/i.test(String(question || '').trim());
}

export function schoolDirectoryPlan() {
  return { mode: 'platform', queries: [{
    id: 'schools', module: 'schools', operation: 'list',
    selectFields: ['name', 'place', 'board', 'isActive'],
    filters: [], sort: [{ field: 'name', direction: 'asc' }], limit: 100, offset: 0,
  }] };
}
