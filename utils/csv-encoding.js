import iconv from 'iconv-lite';

/**
 * Smart CSV buffer decoder.
 *
 * Handles the common real-world case where a CSV is saved from Excel on
 * Windows using the default ANSI (Windows-1252) encoding, which contains
 * bytes like 0xB0 (°), 0x96 (–), 0x97 (—), 0x92 (’) that are NOT valid
 * UTF-8 and show up as the U+FFFD replacement character (�) when the
 * buffer is decoded with `buffer.toString('utf8')`.
 *
 * Detection order:
 *  1. UTF-8  BOM  (EF BB BF)           → UTF-8 (BOM stripped)
 *  2. UTF-16 LE BOM (FF FE)            → UTF-16 LE
 *  3. UTF-16 BE BOM (FE FF)            → UTF-16 BE
 *  4. Valid UTF-8 (strict)             → UTF-8
 *  5. Fallback                         → Windows-1252 (cp1252)
 *
 * Windows-1252 is a superset of Latin-1 that covers every byte Excel
 * typically emits, so this fallback is lossless for Excel CSV output.
 *
 * @param {Buffer} buffer  Raw file bytes (e.g. `req.file.buffer` or `fs.readFileSync(path)`).
 * @returns {string}       Decoded text in UTF-16 (JS string), never containing � from encoding errors.
 */
export function decodeCsvBuffer(buffer) {
  if (!buffer || buffer.length === 0) return '';

  // Normalize to a real Buffer (in case someone passes a Uint8Array).
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  // 1. UTF-8 BOM
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString('utf8');
  }

  // 2. UTF-16 LE BOM
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return iconv.decode(buf.slice(2), 'utf16-le');
  }

  // 3. UTF-16 BE BOM
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return iconv.decode(buf.slice(2), 'utf16-be');
  }

  // 4. Strict UTF-8 validation. Node 18+ ships `Buffer.isUtf8`; use it when available
  //    (fast, zero-copy). Otherwise fall back to a round-trip check.
  const looksLikeUtf8 =
    typeof Buffer.isUtf8 === 'function'
      ? Buffer.isUtf8(buf)
      : (() => {
          const decoded = buf.toString('utf8');
          // If re-encoding the decoded string doesn't match the original bytes,
          // the input wasn't valid UTF-8.
          return Buffer.byteLength(decoded, 'utf8') === buf.length && !decoded.includes('\uFFFD');
        })();

  if (looksLikeUtf8) {
    return buf.toString('utf8');
  }

  // 5. Fallback: Windows-1252 (covers ANSI Excel, Latin-1, and similar).
  return iconv.decode(buf, 'win1252');
}

/**
 * Post-process a CSV cell value while preserving Unicode symbols.
 *
 * Important: do NOT normalize math or smart punctuation characters to ASCII.
 * We preserve symbols like `θ`, `π`, `√`, `°`, `²`, `³`, `⁻¹`, `−`, `≤`, `≥`
 * exactly as uploaded so question text/options remain faithful.
 *
 * Only safe cleanups are applied:
 *  - strip UTF-8 BOM if it leaks into a cell
 *  - convert NBSP to normal space
 *  - trim outer whitespace
 *
 * @param {string} value
 * @returns {string}
 */
export function cleanCsvCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);

  s = s
    .replace(/\uFEFF/g, '')
    .replace(/\u00A0/g, ' ');

  // Excel frequently auto-converts tokens like "05-6" into calendar text
  // "05-Jun". For question/options cells we want the numeric form back.
  const monthToNumber = {
    jan: '1',
    feb: '2',
    mar: '3',
    apr: '4',
    may: '5',
    jun: '6',
    jul: '7',
    aug: '8',
    sep: '9',
    oct: '10',
    nov: '11',
    dec: '12',
  };
  s = s.replace(
    /^(\d{1,2})\s*-\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$/i,
    (_, day, mon) => `${String(day)}-${monthToNumber[String(mon).toLowerCase()] || mon}`
  );

  // If a minus sign was lost and became "?" (or replacement char) before a
  // number (e.g. "?5" instead of "-5"), restore it.
  s = s
    .replace(/(^|[\s,(=])\?(?=\d)/g, '$1-')
    .replace(/(^|[\s,(=])\uFFFD(?=\d)/g, '$1-');

  return s.trim();
}
