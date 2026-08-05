/**
 * Reads a .docx question paper.
 *
 * A .docx is a zip: text in word/document.xml, pictures in word/media/.
 * Gemini cannot inline a .docx like a PDF, so we extract text + embedded
 * images and send both to the same extraction/enrichment pipeline.
 *
 * Only body drawings are kept (header/footer logos are dropped). Images are
 * returned in document order with nearby text so figures can be matched to
 * the right question — not sprayed in filename order onto Q1, Q2, …
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
  // Word drawing/shape leftovers often dump long digit runs into text
  // (sometimes chained: 825510604500-14282156515Single Correct,
  // or glued onto answer-key headings: 720725-51299Mathematics).
  let prev;
  do {
    prev = out;
    out = out.replace(/(?:^|[\s\n])-?\d{7,}(?=[\s\n]|$)/g, ' ');
    out = out.replace(/-?\d{7,}(?=[A-Za-z])/g, '');
    out = out.replace(/\d{3,}[-–]?(?=Mathematics|Physics|Chemistry|Biology)/gi, '');
  } while (out !== prev);
  out = out.replace(/\b(?:center|left|right|top|bottom)\d+\b/gi, ' ');
  out = out.replace(/\n00(?=Single Correct)/g, '\n');
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

function pngOrJpegSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return { width: 0, height: 0 };
  // PNG IHDR
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG SOF0/2
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      const len = buf.readUInt16BE(i + 2);
      i += 2 + len;
    }
  }
  return { width: 0, height: 0 };
}

/**
 * ASLI Prep papers embed the foundation logo in the cover + every header.
 * Those are near-square, highly compressible, and must never become questionImage.
 */
export function isLikelyDocxLogoOrBanner(img) {
  const w = Number(img?.width) || 0;
  const h = Number(img?.height) || 0;
  const bytes = Buffer.isBuffer(img?.data) ? img.data.length : Number(img?.bytes) || 0;
  if (w < 40 || h < 30) return true;
  if (w * h < 6000) return true;
  const ar = w / Math.max(1, h);
  const bpp = bytes / Math.max(1, w * h);
  // Square logo (cover / header): huge pixel box, tiny file
  if (ar > 0.82 && ar < 1.22 && w >= 180 && bpp < 0.06) return true;
  // Wide short banners / footers under questions
  if (ar >= 4 && h <= 160) return true;
  if (ar >= 3.2 && h <= 130 && bpp < 0.35) return true;
  if (img?.fromHeaderOrFooter) return true;
  return false;
}

function xmlPlainSlice(xml, from, to) {
  return decodeXmlEntities(String(xml || '').slice(from, to))
    .replace(/<[^>]+>/g, ' ')
    .replace(/<[^>]*$/g, ' ')
    .replace(/^[^<\s]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRelsTargetMap(relsXml) {
  const map = new Map();
  const re = /Id="(rId\d+)"[^>]*Target="([^"]+)"/gi;
  let m;
  while ((m = re.exec(String(relsXml || '')))) {
    map.set(m[1], m[2].replace(/\\/g, '/'));
  }
  return map;
}

function collectHeaderFooterMediaNames(zip, entries) {
  const names = new Set();
  for (const entryName of entries) {
    if (!/^word\/_rels\/(header|footer)\d+\.xml\.rels$/i.test(entryName)) continue;
    const rels = zip.readAsText(entryName);
    for (const target of parseRelsTargetMap(rels).values()) {
      const base = target.split('/').pop();
      if (base && /\.(png|jpe?g|gif|webp)$/i.test(base)) names.add(base.toLowerCase());
    }
  }
  return names;
}

/**
 * Body drawings in reading order, with nearby text for question matching.
 */
function extractBodyImagesInOrder(zip, entries) {
  const docRelsEntry = entries.find((e) => e === 'word/_rels/document.xml.rels');
  const docEntry = entries.find((e) => e === 'word/document.xml');
  if (!docEntry || !docRelsEntry) return [];

  const ridToTarget = parseRelsTargetMap(zip.readAsText(docRelsEntry));
  const headerFooterMedia = collectHeaderFooterMediaNames(zip, entries);
  const xml = zip.readAsText(docEntry);
  const out = [];
  const seenAt = new Set();
  const blipRe = /<a:blip[^>]*r:embed="(rId\d+)"/g;
  let m;
  while ((m = blipRe.exec(xml))) {
    const rid = m[1];
    const target = ridToTarget.get(rid);
    if (!target || !/media\//i.test(target)) continue;
    const name = target.split('/').pop();
    if (!name || !/\.(png|jpe?g|gif|webp)$/i.test(name)) continue;
    const key = `${rid}:${m.index}`;
    if (seenAt.has(key)) continue;
    seenAt.add(key);

    const mediaPath = target.startsWith('media/') ? `word/${target}` : `word/media/${name}`;
    const mediaEntry = zip.getEntry(mediaPath) || zip.getEntry(`word/media/${name}`);
    if (!mediaEntry) continue;
    const data = mediaEntry.getData();
    if (!data || data.length < 500) continue;
    const { width, height } = pngOrJpegSize(data);

    // Prefer text after the whole drawing/pict, not mid-tag leftovers.
    const drawingEnd = (() => {
      const from = m.index;
      const closeDrawing = xml.indexOf('</w:drawing>', from);
      const closePict = xml.indexOf('</w:pict>', from);
      const ends = [closeDrawing, closePict].filter((x) => x >= 0);
      if (!ends.length) return from + m[0].length;
      return Math.min(...ends) + '</w:drawing>'.length;
    })();
    const beforeText = xmlPlainSlice(xml, Math.max(0, m.index - 1800), m.index).slice(-400);
    const afterText = xmlPlainSlice(xml, drawingEnd, drawingEnd + 1200).slice(0, 280);
    const fromHeaderOrFooter = headerFooterMedia.has(String(name).toLowerCase());

    out.push({
      name,
      data,
      mimeType: mimeFromImageName(name),
      width,
      height,
      bytes: data.length,
      beforeText,
      afterText,
      fromHeaderOrFooter,
      order: out.length,
    });
  }
  return out;
}

/**
 * @returns {{
 *   text: string,
 *   images: Array<{
 *     name: string,
 *     data: Buffer,
 *     mimeType: string,
 *     width?: number,
 *     height?: number,
 *     beforeText?: string,
 *     afterText?: string,
 *     fromHeaderOrFooter?: boolean,
 *     order?: number
 *   }>,
 *   paragraphs: number
 * }}
 */
export function extractDocxQuestionPaper(buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().map((e) => e.entryName);

  const docEntry = zip.getEntries().find((e) => e.entryName === 'word/document.xml');
  if (!docEntry) {
    throw new Error('This does not look like a Word document (word/document.xml missing).');
  }
  const xml = zip.readAsText(docEntry);
  const text = documentXmlToText(xml);

  let images = extractBodyImagesInOrder(zip, entries);

  // Fallback: older path if relationships missing — still drop header logos by heuristic
  if (!images.length) {
    const headerFooterMedia = collectHeaderFooterMediaNames(zip, entries);
    images = zip
      .getEntries()
      .filter((e) => /^word\/media\/[^/]+\.(png|jpe?g|gif|webp)$/i.test(e.entryName))
      .map((e, order) => {
        const name = e.entryName.split('/').pop();
        const data = e.getData();
        const { width, height } = pngOrJpegSize(data);
        return {
          name,
          data,
          mimeType: mimeFromImageName(name),
          width,
          height,
          bytes: data?.length || 0,
          beforeText: '',
          afterText: '',
          fromHeaderOrFooter: headerFooterMedia.has(String(name).toLowerCase()),
          order,
        };
      })
      .filter((img) => img.data && img.data.length > 500)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
  }

  images = images.filter((img) => !isLikelyDocxLogoOrBanner(img));

  return {
    text,
    images,
    paragraphs: (text.match(/\n/g) || []).length + 1,
  };
}
