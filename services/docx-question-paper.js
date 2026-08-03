/**
 * Reads a .docx question paper.
 *
 * A .docx is a zip: the text lives in word/document.xml and any pictures in
 * word/media/. Gemini cannot take a .docx as inline data the way it takes a
 * PDF, so this pulls the text out and the extraction prompt runs against that
 * text instead of the rendered page.
 *
 * That difference matters and is deliberately not hidden: a Word file carries
 * no page images, so the visual maths layout and the figures-next-to-questions
 * cues a PDF gives up are simply not there. Text and pictures are recovered;
 * exact visual layout is not.
 */
import AdmZip from 'adm-zip';

const DOCX_MIMES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export function isDocxUpload(originalname, mimetype) {
  const name = String(originalname || '').toLowerCase();
  const mime = String(mimetype || '').toLowerCase();
  return name.endsWith('.docx') || DOCX_MIMES.includes(mime);
}

/** Word stores literal characters as XML entities; put them back. */
function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&'); // last, so a literal &amp;lt; survives
}

/**
 * document.xml is a flat run of <w:p> paragraphs containing <w:t> text runs.
 * Paragraph and explicit break boundaries become newlines so question numbering
 * ("1.", "2.") still starts a line — the extraction prompt depends on that.
 */
function documentXmlToText(xml) {
  let out = String(xml || '');
  out = out.replace(/<w:tab\b[^>]*\/>/g, '\t');
  out = out.replace(/<w:br\b[^>]*\/>/g, '\n');
  out = out.replace(/<\/w:p>/g, '\n');
  // Keep <w:t> contents, drop every other tag
  out = out.replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, (_, inner) => inner);
  out = out.replace(/<[^>]+>/g, '');
  out = decodeXmlEntities(out);
  return out
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * @returns {{ text: string, images: Array<{ name: string, data: Buffer }>, paragraphs: number }}
 */
export function extractDocxQuestionPaper(buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  const docEntry = entries.find((e) => e.entryName === 'word/document.xml');
  if (!docEntry) {
    throw new Error('This does not look like a Word document (word/document.xml missing).');
  }
  const xml = zip.readAsText(docEntry);
  const text = documentXmlToText(xml);

  const images = entries
    .filter((e) => /^word\/media\/[^/]+\.(png|jpe?g)$/i.test(e.entryName))
    .map((e) => ({ name: e.entryName.split('/').pop(), data: e.getData() }))
    .filter((img) => img.data && img.data.length > 500);

  return {
    text,
    images,
    paragraphs: (text.match(/\n/g) || []).length + 1,
  };
}
