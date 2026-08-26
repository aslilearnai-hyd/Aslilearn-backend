/**
 * Teacher Vidya hybrid: app desk facts first, then named person/class entity facts, else Gemini knowledge.
 */
import { detectQueryIntent } from '../vidya-student/query-intent-detection-engine.js';
import { generateGeneralKnowledgeAnswer } from '../vidya-student/gemini-general-knowledge-service.js';
import {
  buildNamedPersonDetailFacts,
  buildClassGroupFacts,
  extractPersonNameQuery,
  extractClassGroupQuery,
  isPersonDetailQuery,
  isClassGroupQuery,
} from '../vidya-ai-control/entity-detail-facts.js';
import { formatDynamicResponse } from '../vidya-ai-control/response-formatter.js';
import {
  buildTeacherAppDeskFacts,
  teacherAppOnlyReply,
} from './teacher-app-desk-facts.js';

const connectionFallbackMessage = () =>
  "I'm having trouble connecting right now. Please try again in a moment.";

function isTeacherAppQuestion(q) {
  const lower = String(q || '').toLowerCase();
  return (
    /what should i do|today|daily plan|my classes|my students|roster|attendance|homework|assignment|upcoming exam|open exam|quiz|assessment|\bomr\b|work diary|overview|summary|how many (students|classes)|dashboard|logged in|\bstudent\b.*\b(name|details?|report|progress|performance|marks?|scores?)\b/.test(
      lower,
    ) || detectQueryIntent(q).type === 'application'
  );
}

export function needsStudentNameClarification(question) {
  const q = String(question || '').trim().toLowerCase();
  if (!/\b(student|learner|pupil)\b/.test(q)) return false;
  if (/\b(my students|list (?:my )?students|all students|student roster|how many students)\b/.test(q)) {
    return false;
  }
  const extracted = extractPersonNameQuery(question).name;
  if (extracted && !/^(?:by name|the name|a name|name)$/i.test(extracted)) return false;
  return /\b(by name|student details?|student report|tell me about (?:a|the) student|find (?:a|the) student|look up (?:a|the) student)\b/.test(q);
}

export async function runHybridTeacherVidyaChat({
  viewerUserId,
  question,
}) {
  const q = String(question || '').trim();
  if (!q) {
    const e = new Error('message is required');
    e.statusCode = 400;
    throw e;
  }

  const intent = detectQueryIntent(q);
  if (intent.type === 'thanks') {
    return {
      mode: 'thanks',
      intent,
      message: "You're welcome! Ask anytime about your classes, homework, exams, or a student by name.",
      groundingStatus: 'social',
      facts: null,
    };
  }
  if (intent.type === 'greeting') {
    return {
      mode: 'greeting',
      intent,
      message:
        "Hi! I'm Vidya for teachers — ask about your classes, attendance, homework queue, exams, OMR, or a student by name.",
      groundingStatus: 'social',
      facts: null,
    };
  }

  const desk = await buildTeacherAppDeskFacts(viewerUserId);

  if (needsStudentNameClarification(q)) {
    const sampleNames = (Array.isArray(desk?.students) ? desk.students : [])
      .map((student) => student.fullName || student.name)
      .filter(Boolean)
      .slice(0, 3);
    const examples = sampleNames.length
      ? ` For example: **Tell me about ${sampleNames[0]}**.`
      : ' Enter the student’s full name.';
    return {
      mode: 'application',
      intent: { type: 'application', reason: 'need_student_name' },
      message: `Which student do you want to check? Please enter the student's name.${examples}`,
      groundingStatus: 'application',
      facts: { desk },
    };
  }

  const wantsStudentReport =
    /\b(individual\s+)?student\s+(report|reprot)s?\b|\breport\s*card|\bindividual\s+(report|reprot)\b/.test(
      String(q).toLowerCase(),
    );
  if (wantsStudentReport && !extractPersonNameQuery(q).name) {
    const sample = Array.isArray(desk?.students) ? desk.students.slice(0, 3) : [];
    const sampleNames = sample
      .map((s) => s.fullName || s.name)
      .filter(Boolean)
      .slice(0, 3);
    const hint = sampleNames.length
      ? ` For example: **${sampleNames[0]}'s report**.`
      : ' For example: **Priya Sharma report**.';
    return {
      mode: 'application',
      intent: { type: 'application', reason: 'need_student_name' },
      message:
        `Which student do you want the report for? Reply with their name and I'll pull their marks, exams, videos, and homework.${hint}`,
      groundingStatus: 'application',
      facts: { desk },
    };
  }

  // Named student / class → deep entity facts (same as Control)
  const person = extractPersonNameQuery(q);
  const classQ = extractClassGroupQuery(q);
  if (person.name && isPersonDetailQuery(q)) {
    const personFacts = await buildNamedPersonDetailFacts({
      personNameQuery: person.name,
      roleHint: person.roleHint || 'student',
      viewerRole: 'teacher',
      viewerUserId,
    });
    const message = await formatDynamicResponse({
      userPrompt: q,
      plan: { mode: 'person_detail' },
      facts: { ...personFacts, mode: 'person_detail' },
      viewerRole: 'teacher',
      history: [],
    });
    return {
      mode: 'person_detail',
      intent: { type: 'application', reason: 'named_person' },
      message:
        String(message || '').trim() ||
        teacherAppOnlyReply(q, desk),
      groundingStatus: 'application',
      facts: { desk, person: personFacts },
    };
  }

  if (classQ.classNumber && isClassGroupQuery(q)) {
    const classFacts = await buildClassGroupFacts({
      classNumber: classQ.classNumber,
      section: classQ.section,
      viewerRole: 'teacher',
      viewerUserId,
    });
    const message = await formatDynamicResponse({
      userPrompt: q,
      plan: { mode: 'class_detail' },
      facts: { ...classFacts, mode: 'class_detail' },
      viewerRole: 'teacher',
      history: [],
    });
    return {
      mode: 'class_detail',
      intent: { type: 'application', reason: 'class_group' },
      message: String(message || '').trim() || teacherAppOnlyReply(q, desk),
      groundingStatus: 'application',
      facts: { desk, classGroup: classFacts },
    };
  }

  if (isTeacherAppQuestion(q) || intent.type === 'application' || intent.type === 'uncertain') {
    return {
      mode: 'application',
      intent: intent.type === 'uncertain' ? { type: 'application', reason: 'teacher_desk' } : intent,
      message: teacherAppOnlyReply(q, desk),
      groundingStatus: 'application',
      facts: { desk },
    };
  }

  // Concept / teaching help via Gemini
  try {
    const conceptAnswer = await generateGeneralKnowledgeAnswer({
      question: q,
      classLevel: desk.classes?.[0]?.classNumber || '',
      subjectContext: '',
      board: '',
      weakChapters: [],
      enrolledSubjects: [],
    });
    return {
      mode: 'general',
      intent,
      message: `${conceptAnswer}\n\n—\nFor live class data ask: **"my students"**, **"homework"**, **"attendance"**, or a student by name.`,
      groundingStatus: 'general_knowledge',
      facts: { desk: { totals: desk.totals } },
    };
  } catch (err) {
    return {
      mode: 'application',
      intent,
      message: teacherAppOnlyReply(q, desk) || connectionFallbackMessage(),
      groundingStatus: 'application',
      facts: { desk, error: String(err?.message || err) },
    };
  }
}
