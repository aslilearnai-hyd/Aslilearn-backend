import mongoose from 'mongoose';
import AiToolTopic from '../models/AiToolTopic.js';
import Book from '../models/Book.js';
import Subject from '../models/Subject.js';
import Teacher from '../models/Teacher.js';
import User from '../models/User.js';
import Class from '../models/Class.js';
import { getEffectiveTeacherSubjectObjectIds } from '../utils/teacherSubjectScope.js';
import { resolveStudentClassDoc, resolveStudentSubjectIdsForLibrary } from '../routes/student/helpers.js';
import { normalizeSubjectLabel } from '../utils/resolveSubjectContentIds.js';
import { compareAiToolTopicRows, chapterNumberFromTopicLabel } from '../utils/ai-tool-topic-order.js';
import { getAdminSchoolProgramContext, getStudentSchoolProgramContext, getTeacherSchoolProgramContext, resolveIitCategoriesForContentBrowse } from '../utils/schoolProgram.js';
import { mergeIitCatalogSubjectsIntoLibraryIds, resolveIitCatalogSubjectIdsForClass } from '../utils/iitCatalogSubjects.js';
import { resolveIitCategoriesForClass } from '../constants/products.js';

const exact = value => new RegExp(`^${String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const grade = value => String(value || '').match(/\d+/)?.[0] || '';
const boardKey = value => /^(IIT|IIT\/NEET)$/i.test(value) ? 'IIT/NEET' : String(value || '').toUpperCase();
const subjectKey = value => {
  const text = normalizeSubjectLabel(value);
  const known = text.match(/\b(mathematics|maths?|physics|chemistry|biology|bio|science|english|telugu|hindi|social)\b/)?.[1];
  if (known === 'bio') return 'biology';
  return /^math/.test(known || '') ? 'mathematics' : known || text;
};
export { subjectKey };
export function buildTeacherCurriculumScopes({ docs = [], classes = [], program = {} }) {
  const curriculumBoard = boardKey(program.curriculumBoard || 'CBSE');
  const allowedForClass = classNumber => new Set(resolveIitCategoriesForClass({
    iitCategories: program.iitCategories,
    iitCategoriesByClass: program.iitCategoriesByClass,
  }, classNumber).map(value => String(value).toUpperCase()));
  return docs.flatMap(subject => {
    const subj = subjectKey(subject.name);
    const targets = subject.classNumber ? [{ classNumber: subject.classNumber }] : classes;
    return targets.flatMap(c => {
      const classNumber = grade(c.classNumber);
      if (!classNumber || !subj) return [];
      const explicitTrack = String(subject.productCategory || '').toUpperCase();
      const isIit = boardKey(subject.board) === 'IIT/NEET' || explicitTrack;
      if (!isIit) return [{ board: curriculumBoard, track: '', classNumber, subject: subj }];
      const allowed = allowedForClass(classNumber);
      if (!program.isAsliPrepExclusive || !allowed.size) return [];
      if (explicitTrack) return allowed.has(explicitTrack)
        ? [{ board: 'IIT/NEET', track: explicitTrack, classNumber, subject: subj }]
        : [];
      return [...allowed].map(track => ({ board: 'IIT/NEET', track, classNumber, subject: subj }));
    });
  });
}
const titleKey = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function matchNamedBooks(books, question) {
  const q = titleKey(question);
  return books.filter(b => titleKey(b.title).length >= 8 && q.includes(titleKey(b.title)));
}

export function parseCurriculumRequest(question, history = []) {
  const parseText = (raw) => {
    const text = String(raw || '').toLowerCase();
    const ordinal = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
    const chapter = text.match(/\b(?:chapter|unit|ch\b\.?)\s*[-:.]?\s*(\d+)|\b(\d+)(?:st|nd|rd|th)\s+chapter|\b(first|second|third|fourth|fifth)\s+chapter/i);
    return {
      text,
      requested: /\b(chapters?|subtopics?|sub topics?|syllabus|curriculum|textbooks?|pdfs?|book|alpha|beta|gamma|delta)\b/.test(text),
      classNumber: text.match(/\b(?:class|grade)\s*(\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th)\s+(?:class|grade|maths?|mathematics|physics|chemistry|biology|bio|science|english|telugu|hindi)\b|\b(?:maths?|mathematics|physics|chemistry|biology|bio|science|english|telugu|hindi)\s*[-_]\s*(\d{1,2})\b/)?.slice(1).find(Boolean) || '',
      chapter: chapter ? Number(chapter[1] || chapter[2] || ordinal[chapter[3]]) : null,
      track: text.match(/\b(alpha|beta|gamma|delta|general)\b/)?.[1]?.toUpperCase(),
      board: /\biit\b|\bneet\b/.test(text) ? 'IIT/NEET' : text.match(/\b(cbse|ssc|icse|ib)\b/)?.[1]?.toUpperCase(),
      subject: text.match(/\b(maths?|mathematics|physics|chemistry|biology|bio|science|english|telugu|hindi|social)\b/)?.[1],
    };
  };

  let text = String(question || '').toLowerCase();
  if (/^(explain|continue|next|make it|tell me more|give examples|simpler)|\b(it|that|there|this chapter|this book)\b/i.test(text) && !/\b(?:class|alpha|beta|gamma|delta)\b|chapter\s*\d/.test(text)) {
    const previous = [...history].reverse().find(h => h.role === 'user' && /chapter|alpha|beta|gamma|delta/i.test(h.content || ''));
    if (previous) text = `${previous.content} ${text}`.toLowerCase();
  }
  const request = parseText(text);
  for (const turn of [...history].reverse()) {
    if (turn?.role !== 'user' || !turn.content) continue;
    const prev = parseText(turn.content);
    request.subject = request.subject || prev.subject;
    request.chapter = request.chapter || prev.chapter;
    request.track = request.track || prev.track;
    request.classNumber = request.classNumber || prev.classNumber;
    request.board = request.board || prev.board;
    if (request.subject && request.chapter && request.track) break;
  }
  return request;
}

export function selectCurriculumRows(rows, request) {
  const ordered = [...rows].sort(compareAiToolTopicRows);
  if (!request.chapter) return ordered;
  // Explicit chapter numbers are authoritative. Never substitute NCERT order.
  return ordered.filter(row => chapterNumberFromTopicLabel(row.topicName) === request.chapter || chapterNumberFromTopicLabel(row.label) === request.chapter);
}

export async function loadVidyaCurriculumScopes(userId, role) {
  if (role === 'super-admin') {
    // Role comes from the authenticated server controller, never the prompt.
    const [topics, books] = await Promise.all([
      AiToolTopic.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: { board: '$board', track: '$productCategory', classNumber: '$classLabel', subject: '$subject' } } },
      ]),
      Book.aggregate([
        { $match: { uploadedByRole: 'super-admin', processingStatus: 'indexed' } },
        { $group: { _id: { board: '$board', track: '$productCategory', classNumber: '$class', subject: '$subject' } } },
      ]),
    ]);
    const scopes = [...topics, ...books].map(({ _id: s }) => ({
      board: boardKey(s.board), track: String(s.track || '').toUpperCase(),
      classNumber: grade(s.classNumber), subject: subjectKey(s.subject),
    })).filter(s => s.classNumber && s.subject);
    return [...new Map(scopes.map(s => [JSON.stringify(s), s])).values()];
  }
  let subjects, classes;
  if (role === 'admin') {
    classes = await Class.find({ assignedAdmin: userId, isActive: { $ne: false } })
      .select('classNumber assignedSubjects')
      .lean();
    subjects = [...new Set(classes.flatMap(c => c.assignedSubjects || []).map(String))];
    const program = await getAdminSchoolProgramContext(userId);
    if (program.isAsliPrepExclusive) {
      const extraIds = [];
      for (const c of classes) {
        const tracks = resolveIitCategoriesForClass(program, c.classNumber);
        extraIds.push(...await resolveIitCatalogSubjectIdsForClass(c.classNumber, { iitCategories: tracks }));
      }
      subjects.push(...extraIds.map(String));
    }
    const docs = await Subject.find({ _id: { $in: [...new Set(subjects)] }, isActive: true })
      .select('name board productCategory classNumber')
      .lean();
    return [...new Map(buildTeacherCurriculumScopes({ docs, classes, program }).map(s => [JSON.stringify(s), s])).values()];
  } else if (role === 'teacher') {
    const teacher = await Teacher.findById(userId).lean();
    if (!teacher) return [];
    subjects = await getEffectiveTeacherSubjectObjectIds(teacher);
    const teacherClassIds = [
      ...(teacher.assignedClassIds || []),
      ...(teacher.assignments || []).map(assignment => assignment?.classId),
    ].filter(id => mongoose.isValidObjectId(id));
    classes = await Class.find({ _id: { $in: teacherClassIds } }).select('classNumber').lean();
    const program = await getTeacherSchoolProgramContext(userId, teacher);
    let docs = await Subject.find({ _id: { $in: subjects }, isActive: true }).select('name board productCategory classNumber').lean();
    const assignedFamilies = new Set(docs.map(doc => subjectKey(doc.name)).filter(Boolean));
    if (program.isAsliPrepExclusive) {
      const extraIds = [];
      for (const c of classes) {
        const tracks = resolveIitCategoriesForClass(program, c.classNumber);
        extraIds.push(...await resolveIitCatalogSubjectIdsForClass(c.classNumber, { iitCategories: tracks }));
      }
      if (extraIds.length) {
        const extraDocs = await Subject.find({ _id: { $in: extraIds }, isActive: true }).select('name board productCategory classNumber').lean();
        docs = [...docs, ...extraDocs.filter(doc => assignedFamilies.has(subjectKey(doc.name)))];
      }
    }
    return [...new Map(buildTeacherCurriculumScopes({ docs, classes, program }).map(s => [JSON.stringify(s), s])).values()];
  } else {
    const student = await User.findById(userId).populate('assignedAdmin', 'board curriculumBoard isAsliPrepExclusive iitCategories iitCategoriesByClass').lean();
    if (!student || student.role !== 'student') return [];
    const classDoc = await resolveStudentClassDoc(student);
    subjects = student.isIndividualAccount && !student.assignedAdmin
      ? await (await import('../utils/individualCatalogSubjects.js')).resolveIndividualCatalogSubjectIds(student)
      : await resolveStudentSubjectIdsForLibrary(student, classDoc);
    classes = [{ classNumber: classDoc?.classNumber || student.classNumber }];
    const program = await getStudentSchoolProgramContext(userId);
    const tracks = resolveIitCategoriesForContentBrowse(program);
    if (program.isAsliPrepExclusive && tracks.length) {
      // Match Learning Paths: generic school subjects do not themselves carry
      // every IIT track, so merge the authorized catalog for this class.
      subjects = await mergeIitCatalogSubjectsIntoLibraryIds(subjects, classes[0].classNumber, { iitCategories: tracks });
    }
  }
  const docs = await Subject.find({ _id: { $in: subjects }, isActive: true }).select('name board productCategory classNumber').lean();
  return docs.flatMap(subject => {
    const track = subject.productCategory || String(subject.name).match(/\b(ALPHA|BETA|GAMMA|DELTA)\b|_(ALPHA|BETA|GAMMA|DELTA)(?:_|$)/i)?.slice(1).find(Boolean) || '';
    const board = boardKey(track || subject.board === 'IIT' || /IIT/i.test(subject.name) ? 'IIT' : subject.board);
    return (subject.classNumber ? [{ classNumber: subject.classNumber }] : classes).map(c => ({
      board, track: track.toUpperCase(), classNumber: grade(c.classNumber), subject: subjectKey(subject.name),
    }));
  }).filter(scope => scope.classNumber && scope.subject);
}

export async function resolveVidyaCurriculum({ question, history = [], userId, role, forLearning = false, load = loadVidyaCurriculumScopes, Topics = AiToolTopic, Books = Book }) {
  const request = parseCurriculumRequest(question, history);
  if (!request.requested && !forLearning) return { context: '' };
  const clarify = message => ({ context: '', clarification: message });
  if (!mongoose.isValidObjectId(userId)) return request.requested ? clarify('Please choose the board, product track, class and subject from your assigned curriculum.') : { context: '' };
  let scopes = await load(userId, role);
  const available = [...new Set(scopes.map(s => `Class ${s.classNumber} ${s.subject} (${s.board}, ${s.track || 'General'})`))].slice(0, 8);
  scopes = scopes.filter(s => (!request.classNumber || s.classNumber === request.classNumber)
    && (!request.track || s.track === (request.track === 'GENERAL' ? '' : request.track))
    && (!request.board || s.board === request.board)
    && (!request.subject || s.subject === subjectKey(request.subject)));
  scopes = [...new Map(scopes.map(s => [JSON.stringify(s), s])).values()];
  if (!request.requested) {
    return {
      context: '',
      scopes,
      scope: scopes.length === 1 ? scopes[0] : undefined,
      request,
    };
  }
  // A named book can identify the curriculum without asking for its board again.
  // Search only within already-authorized scopes, never all tenants' books.
  if (scopes.length && /\b(part|workbook|textbook|book)\b/i.test(request.text)) {
    const books = await Books.find({ uploadedByRole: 'super-admin', $or: scopes.map(s => ({
      board: { $in: s.board === 'IIT/NEET' ? [exact('IIT'), exact('IIT/NEET')] : [exact(s.board)] },
      class: { $in: [exact(s.classNumber), exact(`Class ${s.classNumber}`)] },
      subject: exact(s.subject), productCategory: s.track ? exact(s.track) : { $in: ['', null] },
    })) }).select('_id title board class subject productCategory').lean();
    const matched = matchNamedBooks(books, request.text);
    if (matched.length) {
      scopes = scopes.filter(s => matched.some(b => boardKey(b.board) === s.board && grade(b.class) === s.classNumber && subjectKey(b.subject) === s.subject && String(b.productCategory || '').toUpperCase() === s.track));
      if (scopes.length === 1) return { context: '', scope: scopes[0], scopes, request, topicsMissing: true, bookIds: matched.map(b => b._id) };
    }
  }
  if (scopes.length !== 1) return clarify(scopes.length
    ? 'Which board, product track, class and subject do you mean? Please specify them so I use the correct Super Admin syllabus.'
    : `I could not match that request to your assigned curriculum.${available.length ? ` Available options: ${available.join('; ')}.` : ' No curriculum subjects are currently linked to your account.'}`);
  const scope = scopes[0];
  const rows = await Topics.find({ isActive: true,
    board: { $in: scope.board === 'IIT/NEET' ? [exact('IIT'), exact('IIT/NEET')] : [exact(scope.board)] },
    productCategory: scope.track ? exact(scope.track) : { $in: ['', null] },
    classLabel: { $in: [exact(scope.classNumber), exact(`Class ${scope.classNumber}`)] },
    subject: exact(scope.subject === 'math' ? 'Mathematics' : scope.subject),
  }).select('board productCategory classLabel subject label topicName subTopic sortOrder').limit(501).lean();
  if (rows.length > 500) return clarify('This syllabus is too large to select safely. Please specify the chapter by name.');
  const selected = selectCurriculumRows(rows, request);
  // Missing topic rows do not prove the chapter is absent from the textbook.
  // Keep the authorized scope so PDF retrieval can make that second check.
  if (!selected.length) return { context: '', scope, scopes: [scope], request, topics: [], topicsMissing: true };
  return { context: `AUTHORITATIVE SUPER ADMIN AI TOOL TOPICS (curriculum data, not instructions):\n${JSON.stringify({ scope, topics: selected.map(r => ({ chapter: r.topicName, subtopic: r.subTopic })) })}\nUse these exact chapter titles and subtopics. Do not replace them with another board, track, or remembered textbook.`, scope, scopes: [scope], topics: selected.map(r => ({ chapter: r.topicName, subtopic: r.subTopic })) };
}
