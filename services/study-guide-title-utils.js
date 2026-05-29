/**
 * Reject MCQ blobs / answer keys used mistakenly as study guide title.
 */

function str(v) {
  return v == null ? '' : String(v).trim();
}

/** Line looks like MCQ options + answer, not a study guide name. */
export function isMcqOrAnswerTitleBlob(text) {
  const t = str(text).replace(/\s+/g, ' ');
  if (!t) return false;
  if (/\*\*Answer:\*\*/i.test(t) || /\bAnswer:\s*[A-D]\b/i.test(t)) return true;
  const optionHits = (t.match(/\b[A-D][\).:\-]\s+/gi) || []).length;
  if (optionHits >= 2) return true;
  if (optionHits >= 1 && /\b(?:objective|subjective|mcq)\b/i.test(t)) return true;
  if (optionHits >= 1 && t.length > 80) return true;
  if (/^\d+\.\s*\[(?:objective|subjective|mcq)\]/i.test(t)) return true;
  return false;
}

export function sanitizeStudyGuideTitle(raw, fallback = 'Study Guide') {
  const t = str(raw).replace(/\s+/g, ' ').trim();
  if (!t || isMcqOrAnswerTitleBlob(t)) return fallback;
  if (/^(study guide|untitled)$/i.test(t)) return fallback;
  if (t.length > 140) return fallback;
  return t;
}

/** Prefer subtopic/topic when the model put MCQ text in title. */
export function deriveStudyGuideTitleFromContext(meta = {}, structured = {}) {
  const candidates = [
    meta.subTopic,
    meta.subtopic,
    meta.topic,
    structured.chapter_subtopic_overview,
    structured.chapter_overview,
    Array.isArray(structured.learning_objectives) ? structured.learning_objectives[0] : '',
  ];
  for (const c of candidates) {
    const t = sanitizeStudyGuideTitle(c, '');
    if (t) return t;
  }
  const overview = str(structured.chapter_subtopic_overview || structured.chapter_overview);
  if (overview) {
    const first = overview.split(/[.!?\n]/)[0]?.trim() || '';
    const t = sanitizeStudyGuideTitle(first, '');
    if (t) return t;
  }
  return '';
}

export function resolveStudyGuideDisplayTitle(rawTitle, meta = {}, structured = {}) {
  const direct = sanitizeStudyGuideTitle(rawTitle, '');
  if (direct) return direct;
  return deriveStudyGuideTitleFromContext(meta, structured) || 'Study Guide';
}
