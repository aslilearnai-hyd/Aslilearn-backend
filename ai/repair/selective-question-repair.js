function clean(value) {
  return String(value || '').trim();
}

function getQuestionText(row = {}) {
  return clean(row.question || row.stem || row.prompt);
}

function questionArrays(structured = {}) {
  const result = [];
  const walk = (value, path = []) => {
    if (Array.isArray(value)) {
      if (value.some((item) => item && typeof item === 'object' && getQuestionText(item))) {
        result.push({ array: value, path });
      }
      for (let index = 0; index < value.length; index += 1) walk(value[index], [...path, index]);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) if (child && typeof child === 'object') walk(child, [...path, key]);
  };
  walk(structured);
  return result;
}

export function identifyFailedQuestionSlots(structured = {}, findings = []) {
  const failedSlotIds = new Set(findings.map((item) => clean(item.slotId)).filter(Boolean));
  const failed = [];
  for (const group of questionArrays(structured)) {
    for (let index = 0; index < group.array.length; index += 1) {
      const row = group.array[index];
      const slotId = clean(row?.slotId);
      if (failedSlotIds.has(slotId) || /INSUFFICIENT_(?:VISUAL_)?CONTEXT/i.test(JSON.stringify(row || {}))) {
        failed.push({ slotId, path: group.path, index, question: row });
      }
    }
  }
  return failed;
}

function locateArray(root, path) {
  let cursor = root;
  for (const segment of path) cursor = cursor?.[segment];
  return Array.isArray(cursor) ? cursor : null;
}

/** Merge only regenerated failed question objects; preserve every valid slot. */
export function mergeSelectiveQuestionRepairs(structured = {}, failed = [], replacements = []) {
  const copy = JSON.parse(JSON.stringify(structured || {}));
  const replacementBySlot = new Map(
    replacements.map((row) => [clean(row?.slotId), row]).filter(([slotId]) => slotId),
  );
  let repairedCount = 0;
  for (const failure of failed) {
    const target = locateArray(copy, failure.path);
    const replacement = replacementBySlot.get(clean(failure.slotId));
    if (!target || !replacement || failure.index < 0 || failure.index >= target.length) continue;
    target[failure.index] = replacement;
    repairedCount += 1;
  }
  return { structuredContent: copy, repairedCount };
}

export function buildSelectiveRepairPrompt(failed = [], slots = [], contextText = '') {
  const slotById = new Map(slots.map((slot) => [clean(slot.slotId), slot]));
  const payload = failed.map((item) => ({
    slot: slotById.get(clean(item.slotId)) || { slotId: item.slotId },
    rejectedQuestion: item.question,
  }));
  return `Repair ONLY the rejected question slots below. Return JSON {"questions":[...]} with one replacement per slotId. Do not rewrite valid questions.\nFAILED SLOTS:\n${JSON.stringify(payload)}\nGROUNDING CONTEXT:\n${clean(contextText)}`;
}
