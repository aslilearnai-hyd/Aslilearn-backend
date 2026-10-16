/**
 * Real textbook figures for generated questions.
 *
 * Pages whose text carries a figure/table caption are rendered to PNG, Gemini
 * returns a box for each figure on that page (box_2d, 0-1000), and the crop is
 * stored on the BookAsset (assetPath/imageUrl). Book-based questions then show
 * the textbook's own figure instead of an AI drawing.
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFParse } from 'pdf-parse';
import { lexicalSimilarity } from './book-curriculum-mapper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '../../..');
const FIGURE_DIR = path.join(BACKEND_ROOT, 'uploads', 'book-figures');

export const VISUAL_ASSET_TYPES = new Set(['figure', 'graph', 'table', 'chemical_structure']);
const CAPTION_RE = /\b(?:fig(?:ure)?\.?|table|graph|diagram)\s*\d+(?:\.\d+){0,2}\b/i;

export function bookFigureImagesEnabled() {
  return String(process.env.BOOK_FIGURE_IMAGES ?? 'true').trim().toLowerCase() !== 'false';
}

function publicUrl(relPath) {
  const base = String(process.env.PUBLIC_API_BASE_URL || process.env.API_PUBLIC_BASE_URL || process.env.BACKEND_PUBLIC_URL || '')
    .trim()
    .replace(/\/+$/, '');
  return base ? `${base}${relPath}` : relPath;
}

/** Pages (1-based) whose text prints a figure/table caption. */
export function pagesWithFigureCaptions(pages = []) {
  return pages
    .filter((p) => Number.isInteger(p.num) && CAPTION_RE.test(String(p.text || '')))
    .map((p) => p.num);
}

/**
 * Convert a Gemini box_2d ([ymin, xmin, ymax, xmax], 0-1000) into a pixel crop
 * with a little padding. Returns null for boxes that are empty, near full-page
 * (usually a mis-detection) or tiny icons.
 */
export function boxToCrop(box, width, height, pad = 8) {
  if (!Array.isArray(box) || box.length !== 4) return null;
  let [y0, x0, y1, x1] = box.map(Number);
  if (![y0, x0, y1, x1].every(Number.isFinite)) return null;
  if (Math.max(y0, x0, y1, x1) <= 1) [y0, x0, y1, x1] = [y0 * 1000, x0 * 1000, y1 * 1000, x1 * 1000];
  if (y1 <= y0 || x1 <= x0) return null;
  const area = ((y1 - y0) / 1000) * ((x1 - x0) / 1000);
  if (area < 0.004 || area > 0.9) return null;
  const sx = Math.max(0, Math.floor((x0 / 1000) * width) - pad);
  const sy = Math.max(0, Math.floor((y0 / 1000) * height) - pad);
  const ex = Math.min(width, Math.ceil((x1 / 1000) * width) + pad);
  const ey = Math.min(height, Math.ceil((y1 / 1000) * height) + pad);
  return { sx, sy, w: ex - sx, h: ey - sy };
}

export function parseFigureBoxes(raw = '') {
  try {
    const json = JSON.parse(String(raw).match(/\{[\s\S]*\}/)?.[0] || '{}');
    return (Array.isArray(json.figures) ? json.figures : [])
      .map((f) => ({
        caption: String(f?.caption || '').trim().slice(0, 300),
        description: String(f?.description || '').trim().slice(0, 600),
        type: VISUAL_ASSET_TYPES.has(String(f?.type || '').toLowerCase()) ? String(f.type).toLowerCase() : 'figure',
        box: Array.isArray(f?.box_2d) ? f.box_2d : Array.isArray(f?.box) ? f.box : null,
      }))
      .filter((f) => f.box);
  } catch {
    return [];
  }
}

export const FIGURE_BOX_PROMPT = `Find every educational figure, diagram, graph, labelled illustration, chemical structure or data table on this textbook page. Ignore logos, running headers/footers, page numbers, decorative icons, cartoons of characters and plain text. Also ignore boxes that are mainly text — Activity, Note, Did you know, Summary, Key points or Exercise boxes — unless they contain a drawing; then box only the drawing.
For each, return a tight box that includes the drawing, its labels and its printed caption.
Return JSON only: {"figures":[{"caption":"exact printed caption, e.g. Fig 1.3 Syringe with Air","description":"one sentence on what it shows","type":"figure|graph|table|chemical_structure","box_2d":[ymin,xmin,ymax,xmax]}]} with box_2d normalised to 0-1000.`;

/** Match a detected figure to an existing (description-only) asset on the same page. */
function matchExistingAsset(figure, pageAssets, used) {
  let best = null;
  for (const asset of pageAssets) {
    if (used.has(asset.assetId)) continue;
    const score = Math.max(
      lexicalSimilarity(figure.caption, asset.caption),
      lexicalSimilarity(figure.caption, asset.description),
      lexicalSimilarity(figure.description, asset.semanticText || asset.description),
    );
    if (score >= 0.5 && (!best || score > best.score)) best = { asset, score };
  }
  return best?.asset || null;
}

/**
 * Crop figures for one book. Mutates/extends `assets` (BookAsset-shaped docs)
 * and returns them; never throws (figures are an enhancement).
 *
 * deps.locate(pngBuffer) → raw JSON text from a vision model (injected for tests)
 */
export async function attachFigureImages({ bookId, buffer, assets = [], locate, maxPages, renderScale }) {
  if (!bookFigureImagesEnabled() || !Buffer.isBuffer(buffer) || typeof locate !== 'function') {
    return { assets, croppedCount: 0, pagesScanned: 0 };
  }
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const limit = Math.max(1, Number(maxPages ?? process.env.BOOK_FIGURE_MAX_PAGES) || 120);
  const scale = Number(renderScale ?? process.env.BOOK_FIGURE_RENDER_SCALE) || 1.6;

  let parser = new PDFParse({ data: buffer });
  let pageTexts = [];
  try {
    pageTexts = (await parser.getText()).pages || [];
  } finally {
    await parser.destroy().catch(() => {});
  }
  const captionPages = pagesWithFigureCaptions(pageTexts);
  const assetPages = assets.filter((a) => VISUAL_ASSET_TYPES.has(a.type) && Number.isInteger(Number(a.page))).map((a) => Number(a.page));
  const pages = [...new Set([...captionPages, ...assetPages])].sort((a, b) => a - b).slice(0, limit);
  if (!pages.length) return { assets, croppedCount: 0, pagesScanned: 0 };

  await fs.mkdir(FIGURE_DIR, { recursive: true });
  let croppedCount = 0;
  const added = [];
  for (let i = 0; i < pages.length; i += 4) {
    const batch = pages.slice(i, i + 4);
    parser = new PDFParse({ data: buffer });
    let shots;
    try {
      shots = await parser.getScreenshot({ partial: batch, scale, imageBuffer: true, imageDataUrl: false });
    } catch (error) {
      console.warn('[book-figures] render failed:', error?.message || error);
      continue;
    } finally {
      await parser.destroy().catch(() => {});
    }
    for (const shot of shots.pages || []) {
      const png = Buffer.from(shot.data);
      let figures = [];
      try {
        figures = parseFigureBoxes(await locate(png));
      } catch (error) {
        console.warn('[book-figures] locate failed on page', shot.pageNumber, error?.message || error);
        continue;
      }
      if (!figures.length) continue;
      const image = await loadImage(png);
      const pageAssets = assets.filter((a) => Number(a.page) === shot.pageNumber && VISUAL_ASSET_TYPES.has(a.type));
      const used = new Set();
      for (const [index, figure] of figures.entries()) {
        const crop = boxToCrop(figure.box, image.width, image.height);
        if (!crop) continue;
        const canvas = createCanvas(crop.w, crop.h);
        canvas.getContext('2d').drawImage(image, crop.sx, crop.sy, crop.w, crop.h, 0, 0, crop.w, crop.h);
        let asset = matchExistingAsset(figure, pageAssets, used);
        if (!asset) {
          asset = {
            assetId: `BOOK_FIG_${String(bookId).slice(-12)}_${shot.pageNumber}_${index}`,
            page: shot.pageNumber,
            type: figure.type,
            caption: figure.caption,
            description: figure.description,
            semanticText: [figure.caption, figure.description].filter(Boolean).join(' — '),
            canonicalData: {},
            labels: [],
          };
          added.push(asset);
        }
        used.add(asset.assetId);
        const fileName = `${String(asset.assetId).replace(/[^A-Za-z0-9_-]/g, '')}.png`;
        await fs.writeFile(path.join(FIGURE_DIR, fileName), canvas.toBuffer('image/png'));
        asset.assetPath = `/uploads/book-figures/${fileName}`;
        asset.imageUrl = publicUrl(asset.assetPath);
        asset.sourceBBox = figure.box.map(Number);
        if (!asset.caption && figure.caption) asset.caption = figure.caption;
        croppedCount += 1;
      }
    }
  }
  return { assets: [...assets, ...added], croppedCount, pagesScanned: pages.length };
}

/**
 * Pick the textbook figure for a question that needs one: match its image
 * prompt / text against figure captions and descriptions.
 */
export function pickFigureForQuestion(question = {}, figures = []) {
  const withImages = figures.filter((f) => f?.imageUrl);
  if (!withImages.length) return null;
  const wanted = [question.imagePrompt, question.image_prompt, question.figurePrompt].filter(Boolean).join(' ');
  const text = String(question.question || question.questionText || question.stem || '');
  const explicit = withImages.find((f) => wanted.includes(f.assetId) || (Array.isArray(question.sourceAssetIds) && question.sourceAssetIds.length === 1 && question.sourceAssetIds[0] === f.assetId));
  if (explicit) return explicit;
  let best = null;
  for (const figure of withImages) {
    const label = [figure.caption, figure.description, figure.semanticText].filter(Boolean).join(' ');
    const score = Math.max(lexicalSimilarity(wanted, label), 0.8 * lexicalSimilarity(text, label));
    if (score >= 0.45 && (!best || score > best.score)) best = { figure, score };
  }
  return best?.figure || null;
}

/**
 * Give every figure question in a structured record the textbook figure it
 * refers to. Questions with no matching textbook figure are left for the AI
 * diagram step. Returns how many questions got a textbook figure.
 */
export async function attachTextbookFigures(structuredContent, figures = []) {
  if (!structuredContent || typeof structuredContent !== 'object' || !figures.some((f) => f?.imageUrl)) return 0;
  const { collectDiagramCandidates } = await import('../../generators/diagrams/ai-diagram-generation-service.js');
  let attached = 0;
  for (const question of collectDiagramCandidates(structuredContent)) {
    const figure = pickFigureForQuestion(question, figures);
    if (!figure) continue;
    question.imageUrl = figure.imageUrl;
    question.figureSource = 'textbook';
    question.figureCaption = figure.caption || '';
    question.sourceAssetIds = [figure.assetId];
    question.needsDiagram = true;
    delete question.newAssetRequired;
    attached += 1;
  }
  return attached;
}
