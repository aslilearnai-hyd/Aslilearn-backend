/** Human-readable label from a structuredContent key (e.g. sectionA_mcq -> "Section A — MCQ"). */
function humanizeV2Key(k) {
  let s = String(k || '');
  const sec = s.match(/^section([A-E])_?(.*)$/i);
  if (sec) {
    const kind = sec[2]
      .replace(/mcq/i, 'MCQ')
      .replace(/fib/i, 'Fill in the Blanks')
      .replace(/([a-z])([A-Z])/g, '$1 $2');
    return `Section ${sec[1].toUpperCase()}${kind ? ' — ' + kind.replace(/\b\w/g, (c) => c.toUpperCase()) : ''}`;
  }
  s = s.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Render a V2 six-section structuredContent object into readable plain text for the PDF. */
export function formatV2SixSectionToText(sc) {
  const lines = [];
  const SECTIONS = [
    ['core', 'CONTENT'],
    ['objectives', 'LEARNING OBJECTIVES'],
    ['differentiation', 'DIFFERENTIATION & SUPPORT'],
    ['assessment', 'ANSWER KEY & ASSESSMENT'],
    ['teacher', "TEACHER'S IMPLEMENTATION GUIDE"],
    ['reallife', 'REAL-LIFE CONNECTION'],
  ];
  const walk = (val, indent) => {
    if (val == null || val === '') return;
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      lines.push(indent + String(val));
      return;
    }
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          walk(item, indent);
          lines.push('');
        } else {
          walk(item, `${indent}• `);
        }
      }
      return;
    }
    if (typeof val === 'object') {
      for (const [k, v] of Object.entries(val)) {
        if (v == null || v === '') continue;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          lines.push(`${indent}${humanizeV2Key(k)}: ${v}`);
        } else {
          lines.push(`${indent}${humanizeV2Key(k)}:`);
          walk(v, `${indent}  `);
        }
      }
    }
  };
  for (const [key, title] of SECTIONS) {
    if (!sc || !sc[key]) continue;
    lines.push('');
    lines.push(title);
    walk(sc[key], '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function isV2SixSection(record, structuredContent) {
  return (
    record?.metadata?.formatSource === 'asli-v2-six-section' ||
    record?.metadata?.schemaVersion === 'asli-v2-six-section' ||
    structuredContent?.schema === 'asli-v2-six-section'
  );
}

/** Full readable body for PDF / export (V2 stores the real payload in metadata). */
export function resolveAiToolRecordPdfBody(record) {
  const structured = record?.metadata?.structuredContent;
  if (isV2SixSection(record, structured) && structured) {
    const formatted = formatV2SixSectionToText(structured);
    if (formatted) return formatted;
  }
  const text = String(record?.generatedContent || record?.content || '').trim();
  if (text) return text;
  if (typeof record?.metadata?.renderContent === 'string' && record.metadata.renderContent.trim()) {
    return record.metadata.renderContent.trim();
  }
  if (structured && typeof structured === 'object') {
    const formatted = formatV2SixSectionToText(structured);
    if (formatted) return formatted;
    try {
      return JSON.stringify(structured, null, 2);
    } catch {
      return '';
    }
  }
  return '';
}

const WINANSI_SWAPS = {
  '\u2013': '-',
  '\u2014': '-',
  '\u2018': "'",
  '\u2019': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u2026': '...',
  '\u00A0': ' ',
  '\u2022': '*',
  '\u2192': '->',
  '\u2190': '<-',
};

function readLatexGroup(value, openingIndex) {
  if (value[openingIndex] !== '{') return null;
  let depth = 0;
  for (let index = openingIndex; index < value.length; index += 1) {
    if (value[index] === '{') depth += 1;
    if (value[index] === '}') depth -= 1;
    if (depth === 0) {
      return { body: value.slice(openingIndex + 1, index), end: index + 1 };
    }
  }
  return null;
}

function replaceLatexCommandGroups(value) {
  let result = String(value ?? '');
  for (let pass = 0; pass < 8; pass += 1) {
    const match = /\\(sqrt|frac|text|mathrm|mathbf)\s*(?:\[([^\]]+)\])?\s*\{/.exec(result);
    if (!match) break;

    const firstOpening = match.index + match[0].length - 1;
    const first = readLatexGroup(result, firstOpening);
    if (!first) break;

    let replacement;
    let end = first.end;
    if (match[1] === 'frac') {
      const secondOpening = result.slice(end).search(/\S/);
      const secondIndex = secondOpening < 0 ? -1 : end + secondOpening;
      const second = secondIndex >= 0 ? readLatexGroup(result, secondIndex) : null;
      if (!second) break;
      replacement = `(${first.body})/(${second.body})`;
      end = second.end;
    } else if (match[1] === 'sqrt') {
      replacement = match[2] ? `root[${match[2]}](${first.body})` : `sqrt(${first.body})`;
    } else {
      replacement = first.body;
    }

    result = `${result.slice(0, match.index)}${replacement}${result.slice(end)}`;
  }
  return result;
}

/** Convert common LaTeX math into readable ASCII for PDFs that use standard PDFKit fonts. */
export function pdfReadableMathText(value) {
  let text = String(value ?? '');
  text = text
    .replace(/\$\$([\s\S]*?)\$\$/g, '$1')
    .replace(/\$([^$\r\n]+)\$/g, '$1')
    .replace(/\\\[([\s\S]*?)\\\]/g, '$1')
    .replace(/\\\((.*?)\\\)/g, '$1');

  text = replaceLatexCommandGroups(text);
  text = text
    .replace(/\\left\b|\\right\b/g, '')
    .replace(/\^\{([^{}]+)\}/g, '^$1')
    .replace(/_\{([^{}]+)\}/g, '_$1')
    .replace(/\\times\b|\\cdot\b/g, '*')
    .replace(/\\div\b/g, '/')
    .replace(/\\leq?\b/g, '<=')
    .replace(/\\geq?\b/g, '>=')
    .replace(/\\neq\b/g, '!=')
    .replace(/\\pm\b/g, '+/-')
    .replace(/\\(?:quad|qquad)\b|\\[,;!]/g, ' ')
    .replace(/\\([A-Za-z]+)\b/g, '$1')
    .replace(/[{}]/g, '');
  return text;
}

/** Helvetica/WinAnsi cannot encode most Unicode — strip/replace so PDFKit does not throw. */
export function pdfSafeWinAnsiText(value) {
  return pdfReadableMathText(value).replace(
    /[^\x09\x0A\x0D\x20-\x7E]/g,
    (ch) => WINANSI_SWAPS[ch] || '?',
  );
}
