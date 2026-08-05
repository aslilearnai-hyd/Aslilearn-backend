/**
 * Reads a .docx question paper.
 *
 * A .docx is a zip: text in word/document.xml, pictures in word/media/.
 * Gemini cannot inline a .docx like a PDF, so we extract text + embedded
 * images and send both to the same extraction/enrichment pipeline.
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
    .replace(/&amp;/g, '&');
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
  out = out.replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, (_, inner) => inner);
  out = out.replace(/<[^>]+>/g, '');
  out = decodeXmlEntities(out);
  return out
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mimeFromImageName(name) {
  const n = String(name || '').toLowerCase();
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  if (n.endsWith('.gif')) return 'image/gif';
  if (n.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

/**
 * @returns {{
 *   text: string,
 *   images: Array<{ name: string, data: Buffer, mimeType: string }>,
 *   paragraphs: number
 * }}
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
    .filter((e) => /^word\/media\/[^/]+\.(png|jpe?g|gif|webp)$/i.test(e.entryName))
    .map((e) => {
      const name = e.entryName.split('/').pop();
      const data = e.getData();
      return {
        name,
        data,
        mimeType: mimeFromImageName(name),
      };
    })
    .filter((img) => img.data && img.data.length > 500)
    // Keep document order (zip entry order ≈ appearance order in Word)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));

  return {
    text,
    images,
    paragraphs: (text.match(/\n/g) || []).length + 1,
  };
}
