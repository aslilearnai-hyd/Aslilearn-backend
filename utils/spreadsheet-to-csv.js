import * as XLSX from 'xlsx';
import { decodeCsvBuffer } from './csv-encoding.js';

/**
 * Detects whether a buffer is an XLSX (zip) or XLS (OLE) workbook by looking
 * at the magic bytes at the start of the file.
 *
 *   XLSX / XLSM / ODS : 50 4B 03 04                (PK\x03\x04 — zip container)
 *   XLS  (BIFF/OLE2)  : D0 CF 11 E0 A1 B1 1A E1    (OLE compound file)
 *
 * @param {Buffer} buf
 * @returns {'xlsx'|'xls'|'csv'}
 */
function detectSpreadsheetFormat(buf) {
  if (!buf || buf.length < 4) return 'csv';

  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    return 'xlsx';
  }

  if (
    buf.length >= 8 &&
    buf[0] === 0xd0 &&
    buf[1] === 0xcf &&
    buf[2] === 0x11 &&
    buf[3] === 0xe0 &&
    buf[4] === 0xa1 &&
    buf[5] === 0xb1 &&
    buf[6] === 0x1a &&
    buf[7] === 0xe1
  ) {
    return 'xls';
  }

  return 'csv';
}

/**
 * Convert any uploaded spreadsheet (.xlsx / .xls / .csv) into a single CSV
 * string, ready to feed into the existing CSV line parser.
 *
 * Why this matters
 * ----------------
 * Excel's plain "CSV (Comma delimited)" export uses Windows-1252, which is a
 * LOSSY encoding: characters outside cp1252 (θ, π, √, ≤, ≥, Δ, fancy math)
 * are replaced with `?` IN THE FILE ON DISK — before it ever leaves Excel.
 * Encoding auto-detection on the server can't recover them.
 *
 * If the user uploads the native .xlsx file instead, Excel stores every cell
 * in UTF-8 inside the .xlsx zip, so every Unicode character (including x², x³,
 * θ, π, √, Greek letters, Δ, etc.) round-trips perfectly. This function lets
 * the backend accept either format transparently.
 *
 * @param {Buffer} buffer        Raw bytes of the uploaded file.
 * @param {string} [originalName] Optional original filename (used as a hint).
 * @returns {{ csv: string, format: 'xlsx'|'xls'|'csv', sheetName?: string }}
 */
export function spreadsheetBufferToCsv(buffer, originalName = '') {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const magicFormat = detectSpreadsheetFormat(buf);
  const lowerName = String(originalName || '').toLowerCase();
  const nameFormat = lowerName.endsWith('.xlsx')
    ? 'xlsx'
    : lowerName.endsWith('.xls')
      ? 'xls'
      : lowerName.endsWith('.csv')
        ? 'csv'
        : null;

  // Prefer magic bytes over filename — filename can lie.
  const format = magicFormat !== 'csv' ? magicFormat : (nameFormat || 'csv');

  if (format === 'xlsx' || format === 'xls') {
    const workbook = XLSX.read(buf, { type: 'buffer', cellDates: false, raw: false });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error('Uploaded workbook contains no sheets');
    }
    const sheet = workbook.Sheets[sheetName];
    // `sheet_to_csv` emits UTF-8, quotes fields containing commas/newlines,
    // and drops fully blank rows. `blankrows: false` trims trailing blank rows.
    const csv = XLSX.utils.sheet_to_csv(sheet, { FS: ',', RS: '\n', blankrows: false });
    return { csv, format, sheetName };
  }

  // Plain CSV — decode with encoding auto-detection (UTF-8 BOM / UTF-16 / Win-1252).
  return { csv: decodeCsvBuffer(buf), format: 'csv' };
}
