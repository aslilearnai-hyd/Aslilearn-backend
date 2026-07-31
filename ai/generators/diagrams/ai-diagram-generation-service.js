/**
 * Educational diagram generation for AI-tool questions that need a figure.
 * Uses Gemini native image models (Nano Banana / Flash Image).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getRouterConfig } from '../../providers/model-router.js';
import { isImageStemQuestion } from '../../../utils/unsupported-question-filter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIAGRAM_DIR = path.join(__dirname, '../uploads/ai-diagrams');

const DIAGRAM_TOOLS = new Set([
  'worksheet-mcq-generator',
  'smart-qa-practice-generator',
  'homework-creator',
  'mock-test-builder',
  'exam-question-paper-generator',
  'quick-assignment-builder',
]);

function isTruthyEnv(value, defaultTrue = true) {
  if (value == null || String(value).trim() === '') return defaultTrue;
  const n = String(value).trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(n)) return false;
  if (['1', 'true', 'yes', 'on'].includes(n)) return true;
  return defaultTrue;
}

/** Diagram auto-generation enabled by default. Set AI_DIAGRAM_GENERATION=false to disable. */
export function isAiDiagramGenerationEnabled() {
  return isTruthyEnv(process.env.AI_DIAGRAM_GENERATION, true);
}

export function shouldGenerateDiagramsForTool(toolSlug) {
  if (!isAiDiagramGenerationEnabled()) return false;
  const slug = String(toolSlug || '').trim();
  return DIAGRAM_TOOLS.has(slug);
}

function resolveImageModel() {
  return String(
    process.env.AI_DIAGRAM_GEMINI_MODEL ||
      process.env.GEMINI_IMAGE_MODEL ||
      'gemini-2.5-flash-image',
  ).trim();
}

function ensureDiagramDir() {
  if (!fs.existsSync(DIAGRAM_DIR)) {
    fs.mkdirSync(DIAGRAM_DIR, { recursive: true });
  }
}

function publicBaseUrl() {
  const fromEnv = String(
    process.env.PUBLIC_API_BASE_URL ||
      process.env.API_PUBLIC_BASE_URL ||
      process.env.BACKEND_PUBLIC_URL ||
      '',
  )
    .trim()
    .replace(/\/+$/, '');
  if (fromEnv) return fromEnv;
  return '';
}

function toPublicImageUrl(filename) {
  const base = publicBaseUrl();
  const rel = `/uploads/ai-diagrams/${filename}`;
  return base ? `${base}${rel}` : rel;
}

function truthyFlag(value) {
  if (value === true || value === 1) return true;
  const s = String(value || '')
    .trim()
    .toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function extractQuestionText(q) {
  if (!q || typeof q !== 'object') return '';
  return String(
    q.question || q.question_text || q.questionText || q.prompt || q.text || q.stem || '',
  ).trim();
}

function buildQualityDiagramPrompt({
  imagePrompt,
  question,
  subject,
  topic,
  subtopic,
  classLabel,
}) {
  const figureBrief = String(imagePrompt || '').trim() || String(question || '').trim();
  const ctx = [
    subject && `Subject: ${subject}`,
    classLabel && `Class: ${classLabel}`,
    topic && `Chapter/topic: ${topic}`,
    subtopic && `Subtopic: ${subtopic}`,
  ]
    .filter(Boolean)
    .join('. ');

  return [
    'Create ONE high-quality educational textbook diagram for Indian CBSE/NCERT classroom use.',
    ctx ? `Context — ${ctx}.` : '',
    `Figure to draw: ${figureBrief}`,
    '',
    'QUALITY RULES (mandatory):',
    '- Clean white background, high contrast black/dark-blue line art.',
    '- Clear readable labels with arrows/leader lines; use short correct scientific terms.',
    '- Accurate proportions suitable for Class school exams — not cartoon, not photorealistic clutter.',
    '- Prefer a single centred labelled diagram (like NCERT figures).',
    '- No watermarks, no logos, no decorative borders, no UI chrome, no speech bubbles.',
    '- No people faces unless the topic requires a simple anatomy outline.',
    '- If geometry: show exact shapes, right angles, and measurements clearly.',
    '- If biology: show only the relevant organ/structure with 3–8 key labels.',
    '- If physics/chemistry: show apparatus or circuit with labeled parts and directions.',
    '- Do NOT include the full question text in the image — only the diagram and labels.',
    '- Landscape or square composition, print-friendly.',
  ]
    .filter(Boolean)
    .join('\n');
}

function extractInlineImage(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts) || !parts.length) return null;
  const imageParts = parts.filter(
    (p) =>
      p?.inlineData?.data ||
      p?.inline_data?.data ||
      (typeof p?.inlineData?.mimeType === 'string' && p.inlineData.mimeType.startsWith('image/')) ||
      (typeof p?.inline_data?.mime_type === 'string' && p.inline_data.mime_type.startsWith('image/')),
  );
  const part = imageParts.length ? imageParts[imageParts.length - 1] : null;
  if (!part) return null;
  const data = part.inlineData?.data || part.inline_data?.data;
  const mime =
    part.inlineData?.mimeType ||
    part.inline_data?.mime_type ||
    'image/png';
  if (!data) return null;
  return { data, mime };
}

async function callGeminiImage(promptText) {
  const { gemini } = getRouterConfig();
  if (!gemini.apiKey) {
    throw new Error('Gemini API key not configured for diagram generation');
  }
  const modelName = resolveImageModel();
  const baseUrl = gemini.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  const url = `${baseUrl}/models/${modelName}:generateContent?key=${gemini.apiKey}`;
  const payload = {
    contents: [{ role: 'user', parts: [{ text: promptText }] }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      temperature: 0.2,
    },
  };

  const timeoutMs = Number(process.env.AI_DIAGRAM_TIMEOUT_MS) || 90000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const msg = err?.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : String(err?.message || err);
    throw new Error(`Diagram model fetch failed: ${msg}`);
  }
  clearTimeout(timer);

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Diagram model failed (${response.status}): ${String(errText).slice(0, 300)}`);
  }
  const data = await response.json();
  const image = extractInlineImage(data);
  if (!image) {
    throw new Error('Diagram model returned no image');
  }
  return image;
}

function extFromMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  return 'png';
}

async function saveDiagramBuffer(base64Data, mime) {
  ensureDiagramDir();
  const ext = extFromMime(mime);
  const filename = `diagram-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const fullPath = path.join(DIAGRAM_DIR, filename);
  await fs.promises.writeFile(fullPath, Buffer.from(base64Data, 'base64'));
  return { filename, imageUrl: toPublicImageUrl(filename) };
}

/**
 * Decide whether a question needs a generated diagram.
 */
export function questionNeedsDiagram(q) {
  if (!q || typeof q !== 'object') return false;
  if (q.imageUrl && String(q.imageUrl).trim()) return false;
  if (truthyFlag(q.needsDiagram) || truthyFlag(q.needs_diagram) || truthyFlag(q.needsFigure)) {
    return true;
  }
  const prompt = String(q.imagePrompt || q.image_prompt || q.figurePrompt || '').trim();
  if (prompt) return true;
  return isImageStemQuestion(extractQuestionText(q));
}

function walkQuestions(node, visit) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) walkQuestions(item, visit);
    return;
  }
  if (typeof node !== 'object') return;

  const looksLikeQuestion =
    extractQuestionText(node) &&
    (Array.isArray(node.options) ||
      node.answer != null ||
      node.type != null ||
      node.question_number != null ||
      node.questionNumber != null ||
      node.marks != null ||
      node.imagePrompt != null ||
      node.needsDiagram != null);

  if (looksLikeQuestion) {
    visit(node);
  }

  for (const [key, val] of Object.entries(node)) {
    if (key === 'options' || key === 'answer' || key === 'explanation') continue;
    if (val && typeof val === 'object') walkQuestions(val, visit);
  }
}

/**
 * Collect question objects that need diagrams (mutates in place later).
 */
export function collectDiagramCandidates(structuredContent) {
  const out = [];
  if (!structuredContent || typeof structuredContent !== 'object') return out;
  walkQuestions(structuredContent, (q) => {
    if (questionNeedsDiagram(q)) out.push(q);
  });
  return out;
}

const MAX_DIAGRAMS_PER_RECORD = Math.max(
  1,
  Number(process.env.AI_DIAGRAM_MAX_PER_RECORD) || 6,
);

/**
 * Generate diagrams for candidates inside structuredContent (in place).
 * @returns {{ generated: number, failed: number, skipped: number }}
 */
export async function enrichStructuredContentWithDiagrams(
  structuredContent,
  {
    toolSlug = '',
    subject = '',
    topic = '',
    subtopic = '',
    classLabel = '',
  } = {},
) {
  if (!shouldGenerateDiagramsForTool(toolSlug)) {
    return { generated: 0, failed: 0, skipped: 0 };
  }
  if (!structuredContent || typeof structuredContent !== 'object') {
    return { generated: 0, failed: 0, skipped: 0 };
  }

  const candidates = collectDiagramCandidates(structuredContent).slice(0, MAX_DIAGRAMS_PER_RECORD);
  if (!candidates.length) {
    return { generated: 0, failed: 0, skipped: 0 };
  }

  let generated = 0;
  let failed = 0;

  for (const q of candidates) {
    const question = extractQuestionText(q);
    const imagePrompt = String(q.imagePrompt || q.image_prompt || q.figurePrompt || '').trim();
    const prompt = buildQualityDiagramPrompt({
      imagePrompt: imagePrompt || question,
      question,
      subject,
      topic,
      subtopic,
      classLabel,
    });

    try {
      const image = await callGeminiImage(prompt);
      const saved = await saveDiagramBuffer(image.data, image.mime);
      q.imageUrl = saved.imageUrl;
      q.imagePrompt = imagePrompt || question.slice(0, 400);
      q.needsDiagram = true;
      // Ensure stem points at the attached figure when it didn't already.
      if (question && !isImageStemQuestion(question)) {
        q.question = `Study the figure below and answer: ${question}`;
      }
      generated += 1;
    } catch (err) {
      failed += 1;
      console.warn(
        '[ai-diagram]',
        toolSlug,
        'failed:',
        String(err?.message || err).slice(0, 200),
      );
      // Drop orphan figure language if we couldn't produce an image.
      if (isImageStemQuestion(question) && !String(q.imageUrl || '').trim()) {
        q.question = question
          .replace(
            /\b(?:refer(?:\s+to)?|see|look\s+at|observe|study|based\s+on|as\s+shown\s+in)\s+(?:the\s+)?(?:following\s+)?(?:figure|fig\.?|image|diagram|picture)[^:?.]*[:?.]?\s*/i,
            '',
          )
          .trim();
        delete q.needsDiagram;
        delete q.imagePrompt;
      }
    }
  }

  return { generated, failed, skipped: 0 };
}
