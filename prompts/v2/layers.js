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
- SILENT grounding: do NOT print page numbers, exercise/figure ids, or phrases like "as provided in the textbook" / "read the textbook excerpt" in any field. Match the textbook's terminology and examples, but keep every question and statement self-contained (answerable without the book in hand). Broad curriculum mapping ("NCERT Class 11, Equilibrium") is fine; specific page/exercise citations are not.
- Missing content: if the chunks do not cover something needed, quietly fill it with correct on-syllabus content — do not add "Teacher to add" or "not in textbook" notes to the output.
- FEW-SHOT PRIORITY: prefer "Concept Practice", worked examples, error/misconception tables, and exercise numericals from the chunks as patterns for NEW questions (change the numbers — do not copy stems verbatim).
- MATH FIDELITY: when chunks show Indian place-value commas (lakh/crore) or International commas, match the system the question asks for; default to Indian for Class 6–8.
- Section 6 exception: only in "reallife" may you add short Indian real-life context not in the textbook.
- Preserve pedagogical extras (common errors, wrong-option reasons, marking points) — never invent a wrong final answer to pad them.

RETRIEVED TEXTBOOK CHUNKS:
"""
${chunks.slice(0, 12000)}
"""`;
}

/** IIT / JEE enhancement layer — added when JEE Main/Advanced level is selected. */
export function buildIitLayer({ board, classLabel } = {}) {
  const b = String(board || '').trim().toUpperCase();
  if (!/JEE|IIT/.test(b)) return '';
  const cls = Number(String(classLabel || '').replace(/[^0-9]/g, ''));
  const isFoundation = Number.isFinite(cls) && cls > 0 && cls <= 10;
  const levelRule = isFoundation
    ? `- STAY IN SYLLABUS SCOPE: this is JEE FOUNDATION for Class ${cls}. Use ONLY Class ${cls} topics/concepts — do NOT introduce Class 11-12 topics. Raise DIFFICULTY within the class's own syllabus (multi-step, application, and reasoning on Class ${cls} concepts), not by pulling in higher-class content.`
    : `- Full JEE Main/Advanced level within the selected class's syllabus: base items at JEE Main, hardest (Stretch) at JEE Advanced. Do not water down, but stay within the class's prescribed topics.`;
  return `IIT/JEE MODE LAYER (apply on top of tool rules).
${levelRule}
- Every question must challenge a serious IIT aspirant AT THIS CLASS LEVEL — if it is trivial single-step recall, raise it; if it needs a higher class's concept, replace it with a hard problem on this class's own topics.
- Core questions: JEE-style items — Numerical Answer Type, Multi-correct, Paragraph/Comprehension, Assertion-Reason — with multi-step reasoning and the conceptual traps JEE sets. No definition-only questions.
- Worked solutions: show the full multi-step method, not one-line answers.
- Assessment: consistent JEE marking scheme (state it once, apply it uniformly — do not mix schemes) and the specific misconceptions JEE exploits.
- Objectives: map to JEE syllabus weightage and frequently-tested sub-topics.
- Reallife: engineering / research / competitive-exam relevance.`;
}
