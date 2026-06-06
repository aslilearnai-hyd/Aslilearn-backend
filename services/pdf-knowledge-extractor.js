/**
 * ONE Gemini call per PDF → universal educational knowledge base JSON.
 * @module services/pdf-knowledge-extractor
 */

import { cleanPdfEducationalContent } from './pdf-content-cleaner.js';
import { isolateGenerationBlock } from './pdf-assignment-boundaries.js';
import {
  normalizeEducationalKnowledgeBase,
  knowledgeBaseHasContent,
} from './educational-knowledge-schema.js';
import { callLlmJson } from './gemini-service.js';

const MAX_KB_INPUT_CHARS = Math.max(20000, Number(process.env.PDF_KB_MAX_INPUT_CHARS) || 100000);

function buildKnowledgeExtractionPrompt(textSlice, params = {}) {
  const subject = String(params.subject || '').trim();
  const classLabel = String(params.classLabel || '').trim();
  const topic = String(params.topic || '').trim();
  const subtopic = String(params.subtopic || '').trim();

  return `You are an educational content analyst. Extract ONLY real teaching knowledge from this PDF text.

IGNORE and DO NOT include:
- Page numbers, footers (-- N of M --), chapter headers with page counts
- "Generation 1", "Generation 2" assignment bank markers (extract underlying concepts only once)
- Student checklists, rubric templates, "how to use these assignments"
- Repeated boilerplate across multiple assignments

CURRICULUM CONTEXT:
- Class: ${classLabel || 'N/A'}
- Subject: ${subject || 'N/A'}
- Topic/Chapter: ${topic || 'N/A'}
- Subtopic: ${subtopic || 'N/A'}

Return ONE JSON object with this exact shape:
{
  "chapter": "chapter or topic name",
  "title": "short title",
  "summary": "2-4 sentence chapter summary",
  "learningObjectives": ["..."],
  "concepts": [{ "name": "", "description": "", "importance": "", "examples": [] }],
  "definitions": [{ "term": "", "definition": "" }],
  "formulas": [{ "name": "", "expression": "", "explanation": "" }],
  "examples": [{ "title": "", "problem": "", "solution": "", "steps": [] }],
  "activities": [{ "title": "", "description": "", "steps": [], "materials": [], "learning_outcomes": [] }],
  "applications": [{ "title": "", "scenario": "", "explanation": "" }],
  "misconceptions": [{ "misconception": "", "correction": "" }],
  "questions": [{ "question": "", "type": "mcq|short|long", "options": [], "answer": "", "section": "", "marks": 0 }],
  "instructions": "general instructions if present"
}

Rules:
- Distill duplicate content; one canonical set of concepts for the chapter
- questions: include MCQs, short answer, and application questions found in the PDF
- Do NOT invent content unrelated to the PDF
- Return valid JSON only

PDF TEXT:
${textSlice}`;
}

function prepareTextForKnowledgeExtraction(rawText) {
  let text = cleanPdfEducationalContent(rawText);
  text = isolateGenerationBlock(text, 1);
  if (text.length > MAX_KB_INPUT_CHARS) {
    text = `${text.slice(0, MAX_KB_INPUT_CHARS)}\n\n[TRUNCATED FOR EXTRACTION]`;
  }
  return text;
}

function parseJsonResponse(raw) {
  const t = String(raw || '').trim();
  if (!t) return {};
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return {};
      }
    }
  }
  return {};
}

/**
 * Single Gemini call — extract universal knowledge base from PDF text.
 * @param {string} pdfText
 * @param {Record<string, unknown>} [params]
 */
export async function extractEducationalKnowledgeFromPdfText(pdfText, params = {}) {
  const prepared = prepareTextForKnowledgeExtraction(pdfText);
  if (!prepared.trim()) {
    throw new Error('No extractable text after PDF cleaning.');
  }

  const prompt = buildKnowledgeExtractionPrompt(prepared, params);
  const raw = await callLlmJson(prompt, {
    maxTokens: Math.min(16000, Number(process.env.PDF_KB_MAX_OUTPUT_TOKENS) || 12000),
    temperature: 0.15,
    usageLabel: 'pdf-knowledge-extract',
  });

  const kb = normalizeEducationalKnowledgeBase(parseJsonResponse(raw), {
    ...params,
    textLength: prepared.length,
  });

  if (!knowledgeBaseHasContent(kb)) {
    throw new Error('Knowledge extraction returned empty educational content.');
  }

  return kb;
}
