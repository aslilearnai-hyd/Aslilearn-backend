/**
 * Deterministic parse for Curiosity "Lesson Plan Generator (20 Variations)" style PDFs:
 *   Lesson Plan N
 *   Create a Lesson Plan for:
 *   Class: … Subject: … Chapter/Topic: … Duration: … Teaching Method: …
 *   1. Learning Objectives … 2. Introduction / Warm-up … … 7. Teaching Aids Required …
 * Matches text from pdf-parse (same as upload pipeline).
 */

function cleanLessonLine(line) {
  let s = String(line || '')
    .replace(/^[\s•\-\u2022\u25cf]+/u, '')
    .replace(/^\d+[\).\s]+/, '')
    .trim();
  if (!s) return '';
  if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(s)) return '';
  if (/^Lesson Plan\s+\d+/i.test(s)) return '';
  if (/^Create a Lesson Plan for:\s*$/i.test(s)) return '';
  if (/^(Class|Subject|Chapter\/Topic|Duration|Teaching Method):/i.test(s)) return '';
  if (/^students will be able to:?\s*$/i.test(s)) return '';
  if (/^\d{1,2}$/.test(s)) return '';
  if (/^[•\u2022]\s*$/.test(line.trim())) return '';
  if (/^\d+\.\s*$/.test(s)) return '';
  return s;
}

function extractLessonSection(chunk, headerLine, stopAt) {
  const lines = chunk.split(/\n/).map((l) => l.replace(/\r/g, ''));
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (headerLine.test(t)) {
      i += 1;
      break;
    }
    i += 1;
  }
  const out = [];
  while (i < lines.length) {
    const t = lines[i].trim();
    if (stopAt && stopAt.test(t)) break;
    if (/^Lesson Plan\s+\d+/i.test(t)) break;
    const c = cleanLessonLine(lines[i]);
    if (c) out.push(c);
    i += 1;
  }
  return out;
}

function parseMetaBlock(part) {
  const classM = part.match(/\nClass:\s*([^\n\r]+)/i);
  const subjectM = part.match(/\nSubject:\s*([^\n\r]+)/i);
  const chapterM = part.match(/\nChapter\/Topic:\s*([^\n\r]+)/i);
  const durationM = part.match(/\nDuration:\s*([^\n\r]+)/i);
  const methodM = part.match(/\nTeaching Method:\s*([^\n\r]+)/i);
  return {
    classLabel: classM ? String(classM[1]).trim() : '',
    subject: subjectM ? String(subjectM[1]).trim() : '',
    chapterTopic: chapterM ? String(chapterM[1]).trim() : '',
    duration: durationM ? String(durationM[1]).trim() : '',
    teachingMethod: methodM ? String(methodM[1]).trim() : '',
  };
}

/**
 * @param {string} rawText
 * @returns {object[] | null}
 */
export function extractLessonPlansFromCuriosityVariationsPdf(rawText) {
  const text = String(rawText || '').replace(/\r/g, '\n');
  if (!/\bLesson Plan\s+\d+\b/i.test(text)) return null;
  if (!/\b1\.\s*Learning Objectives\b/i.test(text)) return null;

  const parts = text.split(/\n(?=Lesson Plan\s+\d+\b)/gi).filter((p) => /\bLesson Plan\s+\d+\b/i.test(p));
  if (parts.length === 0) return null;

  const out = [];
  for (const part of parts) {
    const numMatch = part.match(/\bLesson Plan\s+(\d+)\b/i);
    if (!numMatch) continue;
    const planNo = Number.parseInt(numMatch[1], 10);
    if (!Number.isFinite(planNo)) continue;

    const meta = parseMetaBlock(part);
    const method = meta.teachingMethod || 'Lesson';
    const dur = meta.duration || '';
    const lesson_name = dur ? `Lesson Plan ${planNo} — ${method} (${dur})` : `Lesson Plan ${planNo} — ${method}`;

    const learning_objectives = extractLessonSection(
      part,
      /^1\.\s*Learning Objectives/i,
      /^2\.\s*Introduction/i,
    );
    const introduction_warmup = extractLessonSection(
      part,
      /^2\.\s*Introduction/i,
      /^3\.\s*Teaching Strategy/i,
    );
    const teaching_strategy = extractLessonSection(
      part,
      /^3\.\s*Teaching Strategy/i,
      /^4\.\s*Classroom Activities/i,
    );
    const classroom_activities = extractLessonSection(
      part,
      /^4\.\s*Classroom Activities/i,
      /^5\.\s*Assessment/i,
    );
    const assessment_questions = extractLessonSection(
      part,
      /^5\.\s*Assessment/i,
      /^6\.\s*Homework/i,
    );
    const homework_practice = extractLessonSection(
      part,
      /^6\.\s*Homework/i,
      /^7\.\s*Teaching Aids/i,
    );
    const teaching_aids = extractLessonSection(part, /^7\.\s*Teaching Aids/i, /^Lesson Plan\s+\d+\b/i);

    if (!learning_objectives.length && !introduction_warmup.length) continue;

    out.push({
      lesson_plan_number: planNo,
      lesson_name,
      subject_area: meta.subject || undefined,
      duration_label: dur || undefined,
      teaching_method: method,
      chapter_topic: meta.chapterTopic || undefined,
      class_label: meta.classLabel || undefined,
      learning_objectives,
      introduction_warmup,
      teaching_strategy,
      classroom_activities,
      assessment_questions,
      homework_practice,
      teaching_aids,
    });
  }

  return out.length ? out.sort((a, b) => a.lesson_plan_number - b.lesson_plan_number) : null;
}
