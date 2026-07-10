/**
 * Dynamic prompt layers for the V2 6-section engine.
 * Appended, in order, on top of the master prompt + tool pack by the assembler.
 */

/** Board / Level adaptation layer. */
export function buildBoardLayer({ board, classLabel, subject } = {}) {
  const b = String(board || '').trim().toUpperCase();
  const cls = String(classLabel || '').replace(/[^0-9]/g, '');
  const isJee = /JEE|IIT|NEET/.test(b);
  const lines = [`BOARD/LEVEL LAYER — Board: ${board || 'CBSE'} | Class: ${classLabel || ''} | Subject: ${subject || ''}`];
  if (b.includes('CBSE')) {
    lines.push('Follow the latest CBSE competency-based pattern (case-study, assertion-reason, source-based). Map directly to NCERT.');
  } else if (isJee) {
    lines.push('Use authentic JEE Main/Advanced question types (Numerical Answer Type, Multi-correct, Paragraph/Comprehension). Raise conceptual depth and rigor in the Stretch tier.');
  } else if (b) {
    lines.push(`Match the ${board} blueprint and its prescribed textbook exercise sequence and question style.`);
  }
  if (cls && Number(cls) >= 9) lines.push('Board year: include high-weightage topics and previous-year exam trends where relevant.');
  return lines.join('\n');
}

/** RAG grounding layer — only added when book/textbook mode is active. */
export function buildRagLayer(ragContext) {
  const chunks = String(ragContext || '').trim();
  if (!chunks) return '';
  return `RAG GROUNDING LAYER — strict textbook mode.
- Grounding: use ONLY the retrieved textbook chunks below for definitions, explanations, examples, exercises, and question patterns. Do not invent facts.
- Citation: in the core and objectives sections, cite exact page/exercise numbers from the chunks (e.g. "NCERT Class 8 Science, Page 52, Ex 5.3, Q2"). Use section/exercise ids if page numbers are absent.
- Missing content: if the chunks do not cover something needed, say so in a short "Teacher to add" note instead of hallucinating.
- Section 6 exception: only in "reallife" may you add short Indian real-life context not in the textbook, clearly noting it is additional.

RETRIEVED TEXTBOOK CHUNKS:
"""
${chunks.slice(0, 12000)}
"""`;
}

/** IIT / JEE enhancement layer — added when JEE Main/Advanced level is selected. */
export function buildIitLayer({ board } = {}) {
  const b = String(board || '').trim().toUpperCase();
  if (!/JEE|IIT/.test(b)) return '';
  return `IIT/JEE MODE LAYER (apply on top of tool rules).
- Make the Stretch tier significantly harder: multi-step problems, conceptual depth, JEE-style application.
- Prefer Numerical Answer Type, Multi-correct, and Paragraph/Comprehension questions in the core.
- In assessment, add JEE-style marking logic and common JEE traps/mistakes.
- In objectives, note JEE Main/Advanced syllabus weightage and frequently-tested sub-topics.
- In reallife, add competitive-exam relevance and engineering/research career connections.`;
}
