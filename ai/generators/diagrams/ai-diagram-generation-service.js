/**
 * Educational diagram generation for AI-tool questions that need a figure.
 * Uses Gemini native image models (Nano Banana / Flash Image).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import { getRouterConfig } from '../../providers/model-router.js';
import { fetchGeminiGenerateContent } from '../../providers/google-genai-compat.js';
import { isImageStemQuestion } from '../../../utils/unsupported-question-filter.js';
import AssessmentAsset from '../../../models/AssessmentAsset.js';

const DIAGRAM_DIR = path.join(process.cwd(), 'uploads', 'ai-diagrams');

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
  return isTruthyEnv(process.env.AI_DIAGRAM_GENERATION, false);
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
  // Without an explicit figure brief, draw only the setup the question
  // describes — the image must never show or state the answer.
  const figureBrief = String(imagePrompt || '').trim() ||
    `the apparatus / setup / structure this question refers to (draw the situation only, not its answer): ${String(question || '').trim()}`;
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
    '- NEVER write the answer, conclusions, explanations or full sentences in the image; no text boxes, callouts or captions.',
    '- Labels are short names only (max 3 words each, at most 6 labels), spelled correctly. Never label results or outcomes.',
    '- Landscape or square composition, print-friendly.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Turn a question into a neutral drawing brief: what to draw and which parts
 * to label, with no outcome, explanation or answer. Falls back to a generic
 * setup brief if the text call fails.
 */
async function deriveNeutralFigureBrief(question, { subject = '', topic = '', subtopic = '' } = {}) {
  const fallback = `the apparatus or structure discussed in ${subtopic || topic || subject}, with its parts labelled`;
  try {
    const { callLlmJson } = await import('../../providers/gemini-service.js');
    const raw = await callLlmJson(
      [
        'Write a drawing brief for the figure a student needs to answer this question.',
        `Question: ${String(question || '').slice(0, 600)}`,
        'Describe ONLY the objects/apparatus/structure to draw and up to 6 part labels.',
        'Do NOT state any result, outcome, conclusion, explanation or answer, and do not quote the question.',
        'Return JSON only: {"brief":"<= 35 words","labels":["short label", "..."]}',
      ].join('\n'),
      { maxTokens: 200, temperature: 0, usageLabel: 'diagram-brief' },
    );
    const json = JSON.parse(String(raw).match(/\{[\s\S]*\}/)?.[0] || '{}');
    const brief = String(json.brief || '').trim();
    const labels = Array.isArray(json.labels) ? json.labels.map((l) => String(l).trim()).filter(Boolean).slice(0, 6) : [];
    if (!brief) return fallback;
    return labels.length ? `${brief} Labels: ${labels.join(', ')}.` : brief;
  } catch {
    return fallback;
  }
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
  const payload = {
    contents: [{ role: 'user', parts: [{ text: promptText }] }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      temperature: 0.2,
    },
  };

  const timeoutMs = Number(process.env.AI_DIAGRAM_TIMEOUT_MS) || 90000;
  let response;
  try {
    response = await fetchGeminiGenerateContent({
      baseUrl,
      apiKey: gemini.apiKey,
      model: modelName,
      body: payload,
      timeoutMs,
    });
  } catch (err) {
    const msg = err?.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : String(err?.message || err);
    throw new Error(`Diagram model fetch failed: ${msg}`);
  }

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
  // The six-section prompts mark figure questions with needsDiagram +
  // imagePrompt. Requiring only newAssetRequired (which nothing sets) meant no
  // diagram was generated at all after the multimodal upgrade.
  // A stem that says "observe the diagram below" needs a figure even when the
  // model forgot to set needsDiagram; otherwise it points at nothing.
  const wantsFigure =
    truthyFlag(q.newAssetRequired) ||
    truthyFlag(q.needsDiagram) ||
    truthyFlag(q.needs_diagram) ||
    truthyFlag(q.needsFigure) ||
    isImageStemQuestion(extractQuestionText(q));
  return wantsFigure && Boolean(
    String(q.imagePrompt || q.image_prompt || q.figurePrompt || extractQuestionText(q)).trim(),
  );
}

/**
 * AI diagrams show immediately by default (still listed in Assessment Assets
 * for later rejection). AI_DIAGRAM_REQUIRE_APPROVAL=true restores the
 * hold-for-review behaviour.
 */
export function aiDiagramsRequireApproval() {
  return isTruthyEnv(process.env.AI_DIAGRAM_REQUIRE_APPROVAL, false);
}

function attachDiagram(q, { imageUrl, assetId }) {
  q.imageUrl = imageUrl;
  q.sourceAssetIds = [...new Set([...(q.sourceAssetIds || []), assetId].filter(Boolean))];
  q.needsDiagram = true;
  q.validationFlags = (q.validationFlags || []).filter((flag) => flag !== 'PENDING_ASSET_APPROVAL');
  if (!q.validationFlags.length) delete q.validationFlags;
  delete q.pendingAssetId;
  delete q.newAssetRequired;
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
  let pendingReview = 0;
  let reused = 0;

  for (const q of candidates) {
    const question = extractQuestionText(q);
    const imagePrompt = String(q.imagePrompt || q.image_prompt || q.figurePrompt || '').trim();
    // Keyed on the question, so duplicate copies (V2 + legacy) reuse one image.
    const cacheKey = crypto
      .createHash('sha256')
      .update(['diagram-v2', imagePrompt || question, subject, topic, subtopic, classLabel].join('|'))
      .digest('hex');
    let prompt = '';

    try {
      const requireApproval = aiDiagramsRequireApproval();
      const approved = await AssessmentAsset.findOne({ cacheKey, approvalStatus: 'approved' }).lean();
      if (approved) {
        attachDiagram(q, approved);
        reused += 1;
        continue;
      }
      const pending = await AssessmentAsset.findOne({ cacheKey, approvalStatus: 'pending_review' }).lean();
      if (pending && !requireApproval) {
        await AssessmentAsset.updateOne({ _id: pending._id }, { $set: { approvalStatus: 'approved' } });
        attachDiagram(q, pending);
        reused += 1;
        continue;
      }
      if (pending) {
        q.pendingAssetId = pending.assetId;
        q.validationFlags = [...new Set([...(q.validationFlags || []), 'PENDING_ASSET_APPROVAL'])];
        pendingReview += 1;
        continue;
      }
      // The image model copies whatever text it is given into the picture.
      // Give it a neutral brief (objects + labels only), never the question.
      const brief = imagePrompt || (await deriveNeutralFigureBrief(question, { subject, topic, subtopic }));
      prompt = buildQualityDiagramPrompt({ imagePrompt: brief, question: '', subject, topic, subtopic, classLabel });
      const image = await callGeminiImage(prompt);
      const saved = await saveDiagramBuffer(image.data, image.mime);
      const assetId = `ASSESSMENT_ASSET_${cacheKey.slice(0, 20)}`;
      await AssessmentAsset.create({
        assetId,
        cacheKey,
        imageUrl: saved.imageUrl,
        prompt,
        subject,
        classLabel,
        topic,
        subtopic,
        approvalStatus: requireApproval ? 'pending_review' : 'approved',
        model: resolveImageModel(),
      });
      generated += 1;
      if (requireApproval) {
        q.pendingAssetId = assetId;
        q.validationFlags = [...new Set([...(q.validationFlags || []), 'PENDING_ASSET_APPROVAL'])];
        delete q.needsDiagram;
        delete q.newAssetRequired;
        pendingReview += 1;
      } else {
        attachDiagram(q, { imageUrl: saved.imageUrl, assetId });
      }
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

  return { generated, failed, skipped: 0, pendingReview, reused };
}
