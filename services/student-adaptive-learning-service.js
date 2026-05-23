import mongoose from 'mongoose';
import User from '../models/User.js';
import Subject from '../models/Subject.js';
import Content from '../models/Content.js';
import Assessment from '../models/Assessment.js';
import Exam from '../models/Exam.js';
import ExamResult from '../models/ExamResult.js';
import { filterToActiveCatalogSubjectIds } from '../utils/activeCatalog.js';
import { subjectGroupKey } from '../utils/resolveSubjectContentIds.js';
import {
  loadStudentLibraryContents,
  resolveStudentSubjectIdsForLibrary,
} from '../utils/studentLibraryContents.js';

/** @typedef {import('mongoose').Types.ObjectId} ObjectId */

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function plainSubjectName(name) {
  if (!name || typeof name !== 'string') return '';
  const m = name.match(/^(.+?)_\d+$/);
  return m ? m[1] : name;
}

function toSubjectKey(name) {
  return subjectGroupKey(name || '');
}

function meaningfulChapterLabel(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const lower = s.toLowerCase();
  const meaningless = new Set([
    'general',
    'unknown',
    'n/a',
    'na',
    'misc',
    'miscellaneous',
    'chapter',
    'unit',
    'default',
    'other',
    'none',
  ]);
  if (meaningless.has(lower)) return '';
  return s;
}

async function resolveStudentClassDoc(student) {
  const Class = (await import('../models/Class.js')).default;
  if (student.assignedClass) {
    if (typeof student.assignedClass === 'object' && student.assignedClass._id) {
      if (student.assignedClass.assignedSubjects !== undefined) {
        return student.assignedClass;
      }
      return await Class.findById(student.assignedClass._id).populate('assignedSubjects');
    }
    return await Class.findById(student.assignedClass).populate('assignedSubjects');
  }
  const aid = student.assignedAdmin?._id || student.assignedAdmin;
  if (student.classNumber && student.classNumber !== 'Unassigned' && aid) {
    return await Class.findOne({
      classNumber: student.classNumber,
      assignedAdmin: aid,
      isActive: true,
    }).populate('assignedSubjects');
  }
  return null;
}

function subjectWiseScoreToObject(sws) {
  if (!sws || typeof sws !== 'object') return {};
  if (sws instanceof Map) return Object.fromEntries(sws);
  return { ...sws };
}

function isLikelyVideoUrl(url) {
  const u = String(url || '').trim().toLowerCase();
  if (!u) return false;
  if (/\.pdf(\?|#|$)/.test(u) || u.includes('docs.google.com/document')) return false;
  if (u.includes('youtube.com') || u.includes('youtu.be')) return true;
  if (u.includes('vimeo.com') || u.includes('loom.com/share')) return true;
  if (/\.(mp4|webm|ogg|m3u8|mov|mkv|avi)(\?|#|$)/.test(u)) return true;
  return false;
}

function mapContentDisplayType(doc) {
  const t = String(doc.type || '');
  const url = String(doc.fileUrl || (Array.isArray(doc.fileUrls) ? doc.fileUrls[0] : '') || '').toLowerCase();
  if (t === 'Video') return isLikelyVideoUrl(url) ? 'Video' : url.includes('.pdf') ? 'PDF' : 'Notes';
  if (t === 'Audio') return 'Audio';
  if (t === 'Homework') return 'Assignment';
  if (t === 'TextBook' || t === 'Workbook' || t === 'Material') {
    if (url.includes('.pdf') || url.includes('type=pdf')) return 'PDF';
    return 'Notes';
  }
  return 'Notes';
}

function pickFileUrl(doc) {
  return String(doc.fileUrl || (Array.isArray(doc.fileUrls) && doc.fileUrls[0] ? doc.fileUrls[0] : '') || '').trim();
}

/**
 * @param {string} userId
 */
export async function buildAdaptiveLearningPayload(userId) {
  const uid = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;

  const student = await User.findById(uid)
    .populate('assignedAdmin', 'board')
    .populate({
      path: 'assignedClass',
      select: 'classNumber section assignedSubjects',
      populate: { path: 'assignedSubjects', select: '_id name' },
    })
    .lean();

  if (!student) {
    return { cards: [], meta: { reason: 'student_not_found' } };
  }

  const studentClassDoc = await resolveStudentClassDoc(student);
  const adminBoard =
    student.assignedAdmin?.board ||
    (await User.findById(student.assignedAdmin).select('board').lean())?.board ||
    student.board;

  let librarySubjectIds = await resolveStudentSubjectIdsForLibrary(student, studentClassDoc);
  librarySubjectIds = await filterToActiveCatalogSubjectIds(librarySubjectIds);
  if (!librarySubjectIds.length) {
    return { cards: [], meta: { reason: 'no_subjects' } };
  }

  const { contents: allContents, boardUpper, studentClassNum } = await loadStudentLibraryContents(
    uid,
    student,
    studentClassDoc,
    adminBoard
  );

  const subjectDocs = await Subject.find({ _id: { $in: librarySubjectIds }, isActive: true })
    .select('_id name')
    .lean();

  const subjectIdToKey = new Map();
  const subjectKeyToId = new Map();
  for (const s of subjectDocs) {
    const key = toSubjectKey(s.name);
    const idStr = String(s._id);
    subjectIdToKey.set(idStr, key);
    if (!subjectKeyToId.has(key)) subjectKeyToId.set(key, idStr);
  }

  const examResults = await ExamResult.find({ userId: uid })
    .sort({ completedAt: -1 })
    .limit(50)
    .lean();

  /** @type {Map<string, { correct: number, total: number, lastAt: Date }>} */
  const subjectExamAgg = new Map();
  /** @type {Map<string, { weight: number, lastAt: Date, wrong: number, skip: number }>} */
  const topicWeak = new Map();

  for (const row of examResults) {
    const completedAt = row.completedAt ? new Date(row.completedAt) : new Date(0);
    const days = (Date.now() - completedAt.getTime()) / 86400000;
    const recency = Math.min(1, Math.exp(-days / 21));

    const sws = subjectWiseScoreToObject(row.subjectWiseScore);
    for (const [subName, score] of Object.entries(sws)) {
      const key = toSubjectKey(subName);
      if (!key) continue;
      const total = Number(score?.total || 0);
      const correct = Number(score?.correct || 0);
      if (total <= 0) continue;
      const prev = subjectExamAgg.get(key) || { correct: 0, total: 0, lastAt: completedAt };
      subjectExamAgg.set(key, {
        correct: prev.correct + correct,
        total: prev.total + total,
        lastAt: completedAt > prev.lastAt ? completedAt : prev.lastAt,
      });
    }

    const qa = Array.isArray(row.questionAnalytics) ? row.questionAnalytics : [];
    for (const q of qa) {
      const st = String(q.status || '');
      if (st !== 'wrong' && st !== 'not_answered') continue;
      const subj = toSubjectKey(q.subject || 'general');
      const ch = meaningfulChapterLabel(q.chapter);
      if (!ch) continue;
      const w = (st === 'wrong' ? 2 : 1) * recency;
      const tk = `${subj}::${ch.toLowerCase()}`;
      const prev = topicWeak.get(tk) || { weight: 0, lastAt: completedAt, wrong: 0, skip: 0 };
      topicWeak.set(tk, {
        weight: prev.weight + w,
        lastAt: completedAt > prev.lastAt ? completedAt : prev.lastAt,
        wrong: prev.wrong + (st === 'wrong' ? 1 : 0),
        skip: prev.skip + (st === 'not_answered' ? 1 : 0),
      });
    }
  }

  /** @type {Map<string, number>} */
  const subjectPct = new Map();
  for (const [k, v] of subjectExamAgg) {
    subjectPct.set(k, v.total > 0 ? Math.round((v.correct / v.total) * 10000) / 100 : 0);
  }

  const weakSubjectKeys = new Set();
  for (const [k, pct] of subjectPct) {
    if (pct < 70) weakSubjectKeys.add(k);
  }
  for (const tk of topicWeak.keys()) {
    weakSubjectKeys.add(tk.split('::')[0]);
  }

  if (weakSubjectKeys.size === 0) {
    for (const s of subjectDocs) {
      weakSubjectKeys.add(toSubjectKey(s.name));
      if (weakSubjectKeys.size >= 2) break;
    }
  }

  const rankedSubjects = Array.from(weakSubjectKeys)
    .map((key) => {
      const pct = subjectPct.get(key);
      const examScore = pct !== undefined ? pct : 60;
      const topicsForSubj = [...topicWeak.entries()].filter(([tk]) => tk.startsWith(`${key}::`));
      const topicWeightSum = topicsForSubj.reduce((s, [, v]) => s + v.weight, 0);
      const weakness = (100 - examScore) * 0.55 + Math.min(100, topicWeightSum * 8) * 0.45;
      return { key, examScore, topicWeightSum, weakness };
    })
    .sort((a, b) => b.weakness - a.weakness)
    .slice(0, 4);

  const classId = student.assignedClass?._id || student.assignedClass;
  const classOid = classId ? (mongoose.Types.ObjectId.isValid(classId) ? classId : null) : null;

  let assessments = [];
  if (classOid) {
    assessments = await Assessment.find({
      assignedClasses: classOid,
      isPublished: true,
    })
      .sort({ createdAt: -1 })
      .limit(80)
      .lean();
  }

  const examsForClass = studentClassNum
    ? await Exam.find({
        isActive: true,
        board: boardUpper,
        classNumber: studentClassNum,
      })
      .sort({ createdAt: -1 })
      .limit(40)
      .lean()
    : [];

  const cards = [];

  for (const row of rankedSubjects) {
    const subKey = row.key;
    const subjectOidStr = subjectKeyToId.get(subKey);
    const subjectRow = subjectDocs.find((x) => toSubjectKey(x.name) === subKey);
    const subjectDisplayName = subjectRow?.name || subKey.charAt(0).toUpperCase() + subKey.slice(1);

    const weakTopicsForSub = [...topicWeak.entries()]
      .filter(([tk]) => tk.startsWith(`${subKey}::`))
      .map(([tk, v]) => ({
        label: tk.split('::').slice(1).join('::'),
        weight: v.weight,
        lastAt: v.lastAt,
      }))
      .sort((a, b) => b.weight - a.weight);

    const distinctWeakTopics = weakTopicsForSub.length;
    const topicLabels = [...new Set(weakTopicsForSub.map((t) => t.label))];

    let progressPercent =
      row.examScore !== undefined && typeof row.examScore === 'number' ? Math.round(row.examScore) : 50;
    progressPercent = Math.max(5, Math.min(100, progressPercent));

    let priority = 'Low';
    if (row.examScore !== undefined && row.examScore < 50) priority = 'High';
    else if (row.examScore !== undefined && row.examScore < 65) priority = 'Medium';
    else if (distinctWeakTopics >= 4 || row.topicWeightSum >= 6) priority = 'High';
    else if (distinctWeakTopics >= 2) priority = 'Medium';

    const targetGroup = toSubjectKey(subjectRow?.name || subKey);
    const contentsForSubject = allContents.filter((c) => {
      const cid = String(c.subject?._id || c.subject || '');
      if (subjectOidStr && cid === subjectOidStr) return true;
      return toSubjectKey(c.subject?.name || '') === targetGroup;
    });

    const used = new Set();
    /** @type {Array<any>} */
    const recommended = [];

    const scoreContentAgainstTopic = (doc, label) => {
      const L = label.toLowerCase();
      const parts = L.split(/\s+/).filter((p) => p.length > 2);
      const hay = `${doc.topic || ''} ${doc.title || ''} ${doc.description || ''}`.toLowerCase();
      let s = 0;
      if (hay.includes(L)) s += 5;
      for (const p of parts) {
        if (hay.includes(p)) s += 1;
      }
      return s;
    };

    const pushContent = (doc, topicHint, scoreBump) => {
      const id = String(doc._id);
      if (used.has(id)) return;
      const url = pickFileUrl(doc);
      const displayType = mapContentDisplayType(doc);
      if (!url && displayType !== 'Video') return;
      if (displayType === 'Video' && !isLikelyVideoUrl(url)) return;
      used.add(id);
      const isPdf = displayType === 'PDF';
      recommended.push({
        kind: 'content',
        _id: id,
        title: doc.title || 'Untitled',
        displayType,
        nativeType: doc.type,
        topicHint: topicHint || '',
        fileUrl: url,
        relevance: scoreBump,
        openMode: isPdf ? 'preview' : 'url',
      });
    };

    const beforeWeakTopicMatch = recommended.length;

    for (const wt of weakTopicsForSub.slice(0, 12)) {
      if (recommended.length >= 18) break;
      const label = wt.label;
      const rx = new RegExp(escapeRegex(label).substring(0, 80), 'i');
      const scored = [];
      for (const doc of contentsForSubject) {
        if (used.has(String(doc._id))) continue;
        const hay = `${doc.topic || ''} ${doc.title || ''}`;
        let m = rx.test(hay);
        let sc = m ? 10 + wt.weight : scoreContentAgainstTopic(doc, label);
        if (!m && sc < 3) continue;
        if (!m && sc >= 3) m = true;
        if (m) scored.push({ doc, sc: sc + wt.weight });
      }
      scored.sort((a, b) => b.sc - a.sc);
      for (const { doc } of scored.slice(0, 3)) {
        pushContent(doc, label, 1);
      }
    }

    /** No weak-topic matches → show class library content for this subject */
    const libraryFallback = recommended.length === beforeWeakTopicMatch;
    const maxLibraryItems = libraryFallback ? 12 : 22;
    for (const doc of contentsForSubject) {
      if (recommended.length >= maxLibraryItems) break;
      if (used.has(String(doc._id))) continue;
      pushContent(doc, libraryFallback ? 'From your library' : '', libraryFallback ? 3 : 0);
    }

    const quizMatches = assessments.filter((q) => {
      const ids = Array.isArray(q.subjectIds) ? q.subjectIds : [];
      return ids.some((sid) => {
        const raw = typeof sid === 'object' && sid !== null ? sid._id || sid : sid;
        const idStr = String(raw || '');
        if (subjectOidStr && idStr === subjectOidStr) return true;
        const nm =
          typeof sid === 'object' && sid?.name ? String(sid.name) : String(sid?.name || sid || '');
        return toSubjectKey(nm) === subKey;
      });
    });

    const quizSorted = [...quizMatches].sort((a, b) => {
      const attA = Array.isArray(a.attempts)
        ? a.attempts.find((x) => x.user && String(x.user) === String(uid))
        : null;
      const attB = Array.isArray(b.attempts)
        ? b.attempts.find((x) => x.user && String(x.user) === String(uid))
        : null;
      return (attA ? 1 : 0) - (attB ? 1 : 0);
    });

    let quizAdded = 0;
    for (const q of quizSorted) {
      if (recommended.length >= 26) break;
      if (quizAdded >= 4) break;
      const attempt = Array.isArray(q.attempts)
        ? q.attempts.find((a) => a.user && String(a.user) === String(uid))
        : null;
      const totalPoints = Number(q.totalPoints || 0);
      const score = attempt ? Number(attempt.score || 0) : null;
      const weakQuiz =
        !attempt || (totalPoints > 0 && score !== null && score / totalPoints < 0.65);
      if (!weakQuiz && attempt) continue;
      recommended.push({
        kind: 'quiz',
        _id: String(q._id),
        title: q.title || 'Practice quiz',
        displayType: 'Practice',
        nativeType: 'Assessment',
        topicHint: '',
        navigatePath: `/quiz/${String(q._id)}`,
        openMode: 'navigate',
        relevance: !attempt ? 5 : 2,
      });
      quizAdded += 1;
    }

    if (quizAdded === 0) {
      for (const q of quizSorted.slice(0, 2)) {
        if (recommended.length >= 26) break;
        recommended.push({
          kind: 'quiz',
          _id: String(q._id),
          title: q.title || 'Practice quiz',
          displayType: 'Practice',
          nativeType: 'Assessment',
          topicHint: '',
          navigatePath: `/quiz/${String(q._id)}`,
          openMode: 'navigate',
          relevance: 1,
        });
        quizAdded += 1;
      }
    }

    const examMatches = examsForClass
      .filter((ex) => toSubjectKey(ex.subject) === targetGroup)
      .sort((a, b) => {
        const pa =
          String(a.examType || '').toLowerCase() === 'practice' ||
          /\b(pyq|previous|past|mock|sample)\b/i.test(String(a.title || ''))
            ? 1
            : 0;
        const pb =
          String(b.examType || '').toLowerCase() === 'practice' ||
          /\b(pyq|previous|past|mock|sample)\b/i.test(String(b.title || ''))
            ? 1
            : 0;
        return pb - pa;
      });

    let examAdded = 0;
    for (const ex of examMatches) {
      if (recommended.length >= 30) break;
      if (examAdded >= 3) break;
      const prefer =
        String(ex.examType || '').toLowerCase() === 'practice' ||
        /\b(pyq|previous|past|mock|sample)\b/i.test(String(ex.title || ''));
      recommended.push({
        kind: 'exam',
        _id: String(ex._id),
        title: ex.title || 'Exam paper',
        displayType: 'Previous paper',
        nativeType: 'Exam',
        topicHint: '',
        navigatePath: '/student-exams',
        examId: String(ex._id),
        openMode: prefer ? 'navigate' : 'navigate',
        relevance: prefer ? 2 : 1,
      });
      examAdded += 1;
    }

    recommended.sort((a, b) => (b.relevance || 0) - (a.relevance || 0));

    /** Per-topic “no content” only when nothing was recommended for this subject card */
    const gapsWithoutContent =
      recommended.length === 0 ? topicLabels.slice(0, 8) : [];

    cards.push({
      subjectId: subjectOidStr || subKey,
      subjectName: plainSubjectName(subjectDisplayName) || subjectDisplayName,
      progressPercent,
      examScorePercent: progressPercent,
      weakTopicCount: distinctWeakTopics,
      priority,
      gapsWithoutContent,
      usesLibraryFallback: libraryFallback && recommended.length > 0,
      recommendedContent: recommended.slice(0, 24),
    });
  }

  return {
    cards,
    meta: {
      generatedAt: new Date().toISOString(),
      examResultsAnalyzed: examResults.length,
      libraryItemsLoaded: allContents.length,
    },
  };
}
