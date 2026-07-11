/**
 * Dynamic prompt layers for the V2 6-section engine.
 * Appended, in order, on top of the master prompt + tool pack by the assembler.
 */

/** Board / Level adaptation layer. */
export function buildBoardLayer({ board, classLabel, subject } = {}) {
  const b = String(board || '').trim().toUpperCase();
  const cls = String(classLabel || '').replace(/[^0-9]/g, '');
  const isJee = /JEE|IIT|NEET/.test(b);
  const isSsc = /\bSSC\b|STATE/.test(b);
  const lines = [`BOARD/LEVEL LAYER — Board: ${board || 'CBSE'} | Class: ${classLabel || ''} | Subject: ${subject || ''}`];
  if (b.includes('CBSE')) {
    lines.push(
      'Follow the latest CBSE board blueprint: section-wise distribution (MCQ / VSA 1m / SA 2-3m / LA 5m / case-study & assertion-reason), competency-based framing, and internal choice as CBSE prescribes. Map directly to NCERT chapters, terminology, and exercise style.',
    );
  } else if (isJee) {
    lines.push('Use authentic JEE Main/Advanced question types (Numerical Answer Type, Multi-correct, Paragraph/Comprehension, Assertion-Reason). See the IIT/JEE mode layer for depth.');
  } else if (isSsc) {
    lines.push(
      'Follow the SSC / State-Board blueprint: align to the prescribed State textbook exercise sequence and terminology, the state paper pattern (objective + short + long + activity-based), and the state marking scheme. Keep difficulty and phrasing at State-Board level, not CBSE or JEE.',
    );
  } else if (b) {
    lines.push(`Match the ${board} official paper blueprint: its section-wise mark distribution, prescribed textbook exercise sequence, question style, and internal choice.`);
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
  return `IIT/JEE MODE LAYER (apply on top of tool rules — this OVERRIDES board-basic difficulty).
- The ENTIRE output must be at genuine JEE Main/Advanced level, NOT NCERT/board-basic. Every question, worked example, and explanation must match the depth a serious IIT aspirant actually needs. If it would be too easy for a JEE student, it is wrong — raise it.
- Core questions: real JEE-style items only — Numerical Answer Type, Multi-correct (one or more correct), Paragraph/Comprehension, Assertion-Reason — each requiring multi-step reasoning and setting the conceptual traps JEE is known for. No trivial single-step recall or definition-only questions.
- Difficulty calibration: base items at JEE Main level, Stretch tier at JEE Advanced level. Do not water down for the class label.
- Worked solutions: show the full multi-step method a topper would use, not one-line answers.
- Assessment: use the JEE marking scheme (including negative marking) and list the specific conceptual traps/misconceptions JEE exploits for this topic.
- Objectives: map to JEE Main/Advanced syllabus weightage and the most frequently-tested sub-topics.
- Reallife: engineering / research / competitive-exam relevance and career connections.
- If the given subtopic is inherently below JEE scope, still frame every item at the highest rigor the topic allows and explicitly connect it to how JEE tests (or builds on) that idea.`;
}
