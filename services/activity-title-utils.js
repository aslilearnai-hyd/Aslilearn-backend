/**
 * Detect template section labels vs real activity names (PDF extract + storage).
 */

/** Full "1. Title of (the) Activity / Project" label, optional trailing name after : or — */
export const ACTIVITY_TEMPLATE_TITLE_LINE_RE =
  /^(?:\d+[\.)]\s*)?(?:Title\s+of\s+(?:the\s+)?Activity\s*\/\s*Project|Project\s*\/\s*Activity\s*Title|Title\s+of\s+Activity\s*\/\s*Project)\s*(?:[:\-—]\s*)?(.*)$/i;

/** Line immediately after section-1 header in PDF text */
export const ACTIVITY_TITLE_HEADER_NEXT_LINE_RE =
  /\b1\.\s*Title\s+of\s+(?:the\s+)?Activity\s*\/\s*Project\s*\n+\s*([^\n\r]+)/i;

/** Truncated / mistaken titles from bad partial regex captures */
export const ACTIVITY_TITLE_FRAGMENT_RE =
  /^of\s+(?:the\s+)?activity\s*\/\s*project\s*$/i;

/** PDF workbook index label — not a human-readable activity name */
export const GENERIC_ACTIVITY_NUMBER_TITLE_RE = /^Activity\s+\d+\s*$/i;

/** Table / rubric column headers often mistaken for titles */
const ACTIVITY_TITLE_JUNK_LINE_RE =
  /^(?:learning\s+stage|duration\s+mode|observation|student\s+name|roll\s*no|date|signature|teacher\s*signature|criteria|marks?\s*obtained|time\s+allotted|serial\s*no|s\.?\s*no)/i;

const ACTIVITY_SECTION_HEADING_RE =
  /^(?:\d+[\.)]\s*)?(?:subtopic|learning\s+objectives?|ncf|materials|step-by-step|teacher\s+instructions?|student\s+instructions?|safety|observation|differentiation|assessment|expected\s+learning|real[-\s]?life|reflection)/i;

export function isGenericActivityNumberTitle(text) {
  return GENERIC_ACTIVITY_NUMBER_TITLE_RE.test(String(text || '').replace(/\s+/g, ' ').trim());
}

/** Upload form topic / PDF header — not an activity name (e.g. "Class 6 Science … | Chapter 1 | Subtopic …"). */
export function isCurriculumBreadcrumbTitle(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (isActivityTemplateTitleLabel(t) || isGenericActivityNumberTitle(t)) return true;
  if (/\|/.test(t) && /(?:chapter|subtopic|ncert|class\s+\d|activity\s+project)/i.test(t)) return true;
  if (/^class\s+\d+/i.test(t) && (/\|/.test(t) || /chapter\s+\d/i.test(t))) return true;
  if (t.length > 90 && /(?:chapter|subtopic)\s*[\d.:]/i.test(t)) return true;
  return false;
}

export function isActivityTemplateTitleLabel(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (ACTIVITY_TITLE_FRAGMENT_RE.test(t)) return true;
  const m = t.match(ACTIVITY_TEMPLATE_TITLE_LINE_RE);
  if (!m) return false;
  return !String(m[1] || '').trim();
}

/** Real activity name (e.g. "Food Sources Sorting Game") — not table headers or section labels. */
export function looksLikeValidActivityTitle(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 4 || t.length > 140) return false;
  if (isActivityTemplateTitleLabel(t) || isCurriculumBreadcrumbTitle(t) || isGenericActivityNumberTitle(t)) {
    return false;
  }
  if (ACTIVITY_TITLE_FRAGMENT_RE.test(t) || ACTIVITY_TITLE_JUNK_LINE_RE.test(t)) return false;
  if (ACTIVITY_SECTION_HEADING_RE.test(t)) return false;
  if (/learning\s+stage.*duration|duration.*mode.*difficulty/i.test(t)) return false;
  if (
    /\b(learning\s+stage|duration\s+mode|student\s+name|roll\s*no|marks?\s+obtained)\b/i.test(t) &&
    !/\b(game|sorting|mapping|activity|experiment|project|chart|worksheet|hunt|lab|plant|food)\b/i.test(t)
  ) {
    return false;
  }
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 5 && /^(learning|duration|mode|difficulty|observation|marks|criteria)$/i.test(words.join(' '))) {
    return false;
  }
  if (words.length >= 4 && words.every((w) => /^[A-Z][a-z]+$/.test(w) || /^(and|or|the|of)$/i.test(w))) {
    const labelHits = words.filter((w) =>
      /^(learning|stage|duration|mode|difficulty|observation|student|teacher|marks|criteria|date|time)$/i.test(w),
    );
    if (labelHits.length >= 3) return false;
  }
  return true;
}

/**
 * Parse a single PDF line for activity name; returns '' if line is only a template label.
 * @param {string} line
 * @returns {string}
 */
export function parseActivityNameFromTitleLine(line) {
  const t = String(line || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (ACTIVITY_TITLE_FRAGMENT_RE.test(t)) return '';
  const m = t.match(ACTIVITY_TEMPLATE_TITLE_LINE_RE);
  if (m) {
    const name = String(m[1] || '').trim();
    return name.length >= 2 && looksLikeValidActivityTitle(name) ? name : '';
  }
  if (isActivityTemplateTitleLabel(t) || isCurriculumBreadcrumbTitle(t)) return '';
  if (/^(?:\d+[\.)]\s*)?(?:title|project)\s*$/i.test(t)) return '';
  return looksLikeValidActivityTitle(t) ? t : '';
}

/**
 * Pull the real activity name from one workbook/PDF block — line after "1. Title of the Activity / Project".
 * @param {string} block
 * @returns {string}
 */
export function extractActivityTitleFromBlock(block) {
  const text = String(block || '').replace(/\r/g, '\n');

  const direct = text.match(ACTIVITY_TITLE_HEADER_NEXT_LINE_RE);
  if (direct) {
    const name = String(direct[1] || '').trim();
    if (looksLikeValidActivityTitle(name)) return name;
  }

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^Activity\s+\d+\b/i.test(line)) continue;

    const isTitleHeader =
      isActivityTemplateTitleLabel(line) ||
      /^1\.\s*Title\s+of\s+(?:the\s+)?Activity/i.test(line) ||
      /^1\.\s*(?:Title|Project)\s*\/\s*Activity/i.test(line);

    if (!isTitleHeader) continue;

    const sameLine = parseActivityNameFromTitleLine(line);
    if (sameLine) return sameLine;

    for (let j = i + 1; j < Math.min(lines.length, i + 5); j += 1) {
      const next = lines[j];
      if (!next || /^Activity\s+\d+\b/i.test(next)) continue;
      if (isActivityTemplateTitleLabel(next) || ACTIVITY_SECTION_HEADING_RE.test(next)) continue;
      const name = parseActivityNameFromTitleLine(next);
      if (name) return name;
    }
  }
  return '';
}

/**
 * Split full PDF text into per-activity blocks (Activity N or repeated section-1 headers).
 * @param {string} text
 * @returns {string[]}
 */
export function splitActivityBlocksByTitleSection(text) {
  const raw = String(text || '').replace(/\r/g, '\n');
  if (!raw.trim()) return [];

  if (/\bActivity\s+\d+\b/i.test(raw)) {
    return raw.split(/\n(?=Activity\s+\d+\b)/gi).filter((p) => /\bActivity\s+\d+\b/i.test(p));
  }

  const byTitleHeader = raw.split(
    /\n(?=1\.\s*Title\s+of\s+(?:the\s+)?Activity\s*\/\s*Project\b)/gi,
  );
  if (byTitleHeader.length > 1) {
    return byTitleHeader.filter((p) => /Title\s+of\s+(?:the\s+)?Activity/i.test(p));
  }

  return [raw];
}

/**
 * Re-apply line-after-"1. Title…" parsing for each extracted row.
 * @param {unknown[]} items
 * @param {string} rawText
 */
export function repairActivityItemTitlesFromPdf(items, rawText) {
  if (!Array.isArray(items) || !items.length) return items;
  const blocks = splitActivityBlocksByTitleSection(rawText);
  const titleBySl = new Map();
  for (const block of blocks) {
    const numMatch = block.match(/\bActivity\s+(\d+)\b/i);
    const title = extractActivityTitleFromBlock(block);
    if (!title) continue;
    if (numMatch) titleBySl.set(Number.parseInt(numMatch[1], 10), title);
  }

  return items.map((row, index) => {
    if (!row || typeof row !== 'object') return row;
    const sl = Number(row.sl_no ?? row.question_number);
    let better = Number.isFinite(sl) ? titleBySl.get(sl) : '';
    if (!better && blocks[index]) better = extractActivityTitleFromBlock(blocks[index]);
    const current = String(row.title || row.name || '').trim();
    if (
      better &&
      looksLikeValidActivityTitle(better) &&
      (!current || !looksLikeValidActivityTitle(current))
    ) {
      return { ...row, title: better, name: better };
    }
    return row;
  });
}

/**
 * Clean stored title — never return template labels or "of the Activity / Project" fragments.
 * @param {string} rawTitle
 * @param {string} [rawName]
 * @param {number|string} [slNo]
 */
export function cleanActivityTitleForStorage(rawTitle, rawName, slNo) {
  let t = parseActivityNameFromTitleLine(String(rawTitle || ''));
  if (!t) {
    const fromName = parseActivityNameFromTitleLine(String(rawName || ''));
    if (fromName) t = fromName;
  }
  if (!t) {
    const raw = String(rawTitle || '').replace(/\s+/g, ' ').trim();
    if (raw && looksLikeValidActivityTitle(raw)) t = raw;
  }
  t = t.replace(/^1\.\s*title\s*[—:-]\s*/i, '').trim();
  const parts = t.split(/\s*[—–]\s/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2 && isActivityTemplateTitleLabel(parts[parts.length - 1])) {
    t = parts.slice(0, -1).join(' — ');
  }
  if (/title\s*[—:-]\s*materials required/i.test(t)) {
    t = t.replace(/\s*title\s*[—:-]\s*materials required\s*$/i, '').trim();
  }
  if (!looksLikeValidActivityTitle(t)) t = '';
  if (!t) {
    const n = String(rawName || '').trim();
    if (looksLikeValidActivityTitle(n)) return n;
    return '';
  }
  return t;
}

/** Parse saved markdown for the activity name (## Activity N: … or section 1 body). */
export function extractActivityTitleFromMarkdown(md) {
  const text = String(md || '').trim();
  if (!text) return '';

  const h2 = text.match(/^##\s*Activity\s*\d+\s*:\s*(.+)$/im);
  if (h2) {
    const name = parseActivityNameFromTitleLine(h2[1].trim());
    if (name) return name;
  }

  const section1 = text.match(
    /(?:^|\n)(?:#{1,3}\s*)?1\.\s*(?:Title|Project\s*\/\s*Activity\s*Title|Title\s+of\s+(?:the\s+)?Activity\s*\/\s*Project)[^\n]*\n+([^\n#]+)/im,
  );
  if (section1) {
    const name = parseActivityNameFromTitleLine(section1[1].trim());
    if (name) return name;
  }

  return '';
}

/**
 * Best label for PDF list cards (never the curriculum topic breadcrumb).
 * @param {Record<string, unknown>} [structured]
 * @param {string} [generatedContent]
 * @param {Record<string, unknown>} [meta]
 */
export function resolveActivityDisplayTitle(structured, generatedContent, meta = {}) {
  const sl = structured?.sl_no ?? structured?.question_number ?? meta?.bulkItemIndex;
  let title = cleanActivityTitleForStorage(
    structured?.title || structured?.name,
    structured?.name,
    sl,
  );
  if (!title) {
    title = extractActivityTitleFromMarkdown(generatedContent);
  }
  if (!title || !looksLikeValidActivityTitle(title)) {
    const idx =
      meta?.bulkItemIndex != null
        ? Number(meta.bulkItemIndex) + 1
        : meta?.itemIndex != null
          ? Number(meta.itemIndex) + 1
          : null;
    title = idx != null ? `Activity ${idx}` : 'Activity';
  }
  return title;
}
