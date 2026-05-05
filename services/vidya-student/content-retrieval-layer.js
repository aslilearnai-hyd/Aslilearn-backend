import AiContentEngineChunk from '../../models/AiContentEngineChunk.js';
import AiToolGeneration from '../../models/AiToolGeneration.js';
import PDFContent from '../../models/PDFContent.js';

function extractKeywords(query) {
  const words = String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  return Array.from(new Set(words)).slice(0, 8);
}

export async function retrieveStudentContent({
  query,
  classNumber,
  subject,
}) {
  const keywords = extractKeywords(query);
  const regex = keywords.length ? new RegExp(keywords.join('|'), 'i') : null;

  const [chunks, aiGen, pdfMeta] = await Promise.all([
    AiContentEngineChunk.find({
      ...(classNumber ? { classLabel: { $in: [String(classNumber), `Class ${classNumber}`] } } : {}),
      ...(subject ? { subject: new RegExp(`^${String(subject)}$`, 'i') } : {}),
      ...(regex ? { chunkText: regex } : {}),
    })
      .select('subject classLabel chapter topic subTopic chunkText sourcePdfId')
      .limit(6)
      .lean(),
    AiToolGeneration.find({
      ...(classNumber ? { classLabel: { $in: [String(classNumber), `Class ${classNumber}`] } } : {}),
      ...(subject ? { subject: new RegExp(`^${String(subject)}$`, 'i') } : {}),
      ...(regex ? { generatedContent: regex } : {}),
    })
      .select('toolName toolDisplayName subject classLabel topic subtopic generatedContent createdAt')
      .sort({ createdAt: -1 })
      .limit(4)
      .lean(),
    PDFContent.find({
      ...(classNumber ? { classNumber: String(classNumber) } : {}),
      ...(subject ? { subject: new RegExp(`^${String(subject)}$`, 'i') } : {}),
      ...(regex ? { topic: regex } : {}),
    })
      .select('originalFileName classNumber subject topic uploadedAt')
      .sort({ uploadedAt: -1 })
      .limit(4)
      .lean(),
  ]);

  return {
    schoolContent: chunks.map((c) => ({
      source: 'school_pdf_chunk',
      chapter: c.chapter,
      topic: c.topic || c.subTopic || '',
      preview: String(c.chunkText || '').slice(0, 260),
      classLabel: c.classLabel,
      subject: c.subject,
    })),
    aiGenerator: aiGen.map((g) => ({
      source: 'ai_generator',
      tool: g.toolDisplayName || g.toolName,
      topic: g.topic || g.subtopic || '',
      preview: String(g.generatedContent || '').slice(0, 200),
      subject: g.subject,
      classLabel: g.classLabel,
    })),
    pdfLibrary: pdfMeta.map((p) => ({
      source: 'pdf_library',
      fileName: p.originalFileName,
      topic: p.topic,
      subject: p.subject,
      classNumber: p.classNumber,
    })),
  };
}

