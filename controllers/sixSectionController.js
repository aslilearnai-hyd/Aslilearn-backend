/**
 * V2 six-section generation endpoint (pilot, flag-gated).
 * Isolated from the existing AI-generator controller so it cannot affect the
 * current generation path. Returns semantic 6-section JSON for preview; it does
 * NOT save a record yet (rendering + saving are the next integration step).
 */

import { generateSixSectionContent } from '../services/six-section-generator.js';
import { isSixSectionV2Enabled } from '../prompts/v2/assemble.js';
import { isV2SupportedTool } from '../prompts/v2/tool-packs.js';

const s = (v) => String(v ?? '').trim();

export async function generateSixSectionPreview(req, res) {
  try {
    if (!isSixSectionV2Enabled()) {
      return res.status(403).json({
        success: false,
        message: 'V2 six-section mode is off. Set AI_GENERATOR_V2_SIX_SECTION=on to enable.',
      });
    }

    const toolSlug = s(req.body?.toolSlug || req.body?.toolType);
    if (!isV2SupportedTool(toolSlug)) {
      return res
        .status(400)
        .json({ success: false, message: `Tool "${toolSlug || '(none)'}" is not V2-enabled yet.` });
    }

    const params = {
      board: s(req.body?.board || req.body?.boardName) || 'CBSE',
      classLabel: s(req.body?.classLabel || req.body?.className || req.body?.classNumber),
      subject: s(req.body?.subject || req.body?.subjectName),
      topic: s(req.body?.topic || req.body?.topicName),
      subTopic: s(req.body?.subTopic || req.body?.subtopic || req.body?.subtopicName),
    };
    const ragContext = s(req.body?.ragContext || req.body?.pdfContext || req.body?.sourceText);

    const result = await generateSixSectionContent(
      toolSlug,
      params,
      ragContext ? { ragContext } : {},
    );
    if (!result.ok) {
      return res.status(422).json({ success: false, message: result.error || 'Generation failed.' });
    }
    return res.json({ success: true, data: { structuredContent: result.structuredContent } });
  } catch (err) {
    console.error('[six-section] preview failed:', err?.message || err);
    return res
      .status(500)
      .json({ success: false, message: err?.message || 'Six-section generation error.' });
  }
}

export default generateSixSectionPreview;
