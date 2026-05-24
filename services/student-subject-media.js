/**
 * Bulk-load videos + assessments for all student subjects (one query each, grouped server-side).
 * @module services/student-subject-media
 */

import mongoose from 'mongoose';
import Video from '../models/Video.js';
import Assessment from '../models/Assessment.js';
import Teacher from '../models/Teacher.js';
import Content from '../models/Content.js';
import {
  resolveStudentClassSubjects,
  resolveStudentContentBoard,
} from '../utils/studentClassSubjects.js';

function buildTeacherSubjectMap(teachers, boardSubjectIds) {
  const map = new Map();
  for (const teacher of teachers) {
    for (const subjId of teacher.subjects || []) {
      const subjIdStr = String(subjId);
      if (!boardSubjectIds.includes(subjIdStr)) continue;
      if (!map.has(subjIdStr)) map.set(subjIdStr, []);
      map.get(subjIdStr).push(String(teacher._id));
    }
  }
  return map;
}

function formatTeacherVideo(video) {
  const subjectIdStr = video.subjectId ? String(video.subjectId) : '';
  return {
    _id: String(video._id),
    title: video.title || 'Untitled Video',
    description: video.description || '',
    videoUrl: video.videoUrl || '',
    thumbnailUrl: video.thumbnailUrl || '',
    duration: video.duration || 0,
    subjectId: subjectIdStr,
    subjectName: '',
    isYouTubeVideo: Boolean(video.isYouTubeVideo),
    youtubeUrl: video.youtubeUrl || '',
    isPublished: video.isPublished !== false,
    isActive: video.isActive !== false,
    difficulty: video.difficulty || 'Medium',
    language: video.language || 'English',
    source: 'teacher',
    createdAt: video.createdAt,
  };
}

function formatExclusiveVideo(content) {
  const subjectId = content.subject
    ? String(content.subject._id || content.subject)
    : '';
  const fileUrl = content.fileUrl || '';
  const isYt = fileUrl.includes('youtube.com') || fileUrl.includes('youtu.be');
  return {
    _id: String(content._id),
    title: content.title,
    description: content.description || '',
    videoUrl: fileUrl,
    thumbnailUrl: content.thumbnailUrl || '',
    duration: (content.duration || 0) * 60,
    subjectId,
    subjectName: content.subject?.name || '',
    isYouTubeVideo: isYt,
    youtubeUrl: isYt ? fileUrl : undefined,
    isPublished: true,
    isActive: true,
    difficulty: 'Medium',
    language: 'English',
    source: 'asli-prep-exclusive',
    createdAt: content.createdAt,
    topic: content.topic || '',
  };
}

/** Map video/assessment row → canonical subject id string */
function resolveSubjectKey(raw, subjectMetaById, subjectMetaByName) {
  const key = String(raw || '').trim();
  if (!key) return null;
  if (subjectMetaById.has(key)) return key;
  const byName = subjectMetaByName.get(key.toLowerCase());
  if (byName) return byName;
  return null;
}

function assessmentMatchesSubject(assessment, subjectIdStr, subjectName) {
  const ids = Array.isArray(assessment.subjectIds) ? assessment.subjectIds : [];
  for (const raw of ids) {
    const s = String(raw || '').trim();
    if (!s) continue;
    if (s === subjectIdStr || s === subjectName) return true;
    if (mongoose.Types.ObjectId.isValid(s) && s === subjectIdStr) return true;
  }
  return false;
}

/**
 * Load all videos + assessments once; attach to subject summary rows.
 * @param {object} student — lean user with assignedAdmin, assignedClass
 * @param {Array<object>} subjectRows — from loadSubjectsSummary
 */
export async function enrichSubjectsWithMedia(student, subjectRows = []) {
  if (!subjectRows.length) return subjectRows;

  const ctx = await resolveStudentClassSubjects(student);
  const { subjects: boardSubjects, librarySubjectIds, studentClassNumber, filterContentsForStudentClass } =
    ctx;

  if (!boardSubjects.length) {
    return subjectRows.map((s) => ({
      ...s,
      videos: [],
      quizzes: [],
      assessments: [],
      totalContent: 0,
    }));
  }

  const boardSubjectIds = boardSubjects.map((s) => String(s._id));
  const adminId = student.assignedAdmin?._id || student.assignedAdmin;
  const studentBoard = resolveStudentContentBoard(student, ctx.adminBoard);

  const teachers = adminId
    ? await Teacher.find({
        adminId,
        subjects: { $in: boardSubjects.map((s) => s._id) },
        isActive: true,
      })
        .select('_id subjects')
        .lean()
    : [];

  const teacherSubjectMap = buildTeacherSubjectMap(teachers, boardSubjectIds);
  const teacherIds = teachers.map((t) => t._id);

  const subjectConditions = [];
  const validTeacherIds = [];
  for (const subj of boardSubjects) {
    const subjIdStr = String(subj._id);
    const teachersForSubject = teacherSubjectMap.get(subjIdStr);
    if (teachersForSubject?.length) {
      subjectConditions.push({ subjectId: subjIdStr }, { subjectId: String(subj._id) });
      validTeacherIds.push(...teachersForSubject);
    }
  }

  let teacherVideos = [];
  if (subjectConditions.length && validTeacherIds.length && adminId) {
    const uniqueTeachers = [...new Set(validTeacherIds)];
    const videoQuery = {
      $and: [
        { isPublished: true },
        { isActive: true },
        { createdBy: { $in: uniqueTeachers } },
        { adminId },
        { $or: subjectConditions },
      ],
    };
    teacherVideos = await Video.find(videoQuery).sort({ createdAt: -1 }).limit(400).lean();
  }

  let exclusiveVideos = [];
  const boardLabel = student.board || student.assignedAdmin?.board;
  if (boardLabel && librarySubjectIds.length) {
    let exclusiveContent = await Content.find({
      board: boardLabel,
      isActive: true,
      isExclusive: true,
      type: { $in: ['Video', 'video'] },
      subject: { $in: librarySubjectIds },
    })
      .populate('subject', '_id name')
      .limit(200)
      .lean();

    if (studentClassNumber) {
      exclusiveContent = filterContentsForStudentClass(
        exclusiveContent,
        studentClassNumber,
        librarySubjectIds,
      );
    }
    exclusiveVideos = exclusiveContent.map(formatExclusiveVideo);
  }

  const allVideos = [
    ...teacherVideos.map(formatTeacherVideo),
    ...exclusiveVideos,
  ];

  let assessments = [];
  if (teacherIds.length) {
    const assessmentSubjectConditions = boardSubjects
      .filter((subj) => teacherSubjectMap.get(String(subj._id))?.length)
      .map((subj) => ({
        subjectIds: { $in: [String(subj._id), subj._id] },
      }));

    if (assessmentSubjectConditions.length) {
      const uniqueTeachers = [
        ...new Set(
          boardSubjects.flatMap((subj) => teacherSubjectMap.get(String(subj._id)) || []),
        ),
      ];
      assessments = await Assessment.find({
        $and: [{ isPublished: true }, { createdBy: { $in: uniqueTeachers } }, { $or: assessmentSubjectConditions }],
      })
        .select(
          'title description difficulty duration totalPoints questions subjectIds attempts createdAt isPublished',
        )
        .sort({ createdAt: -1 })
        .limit(200)
        .lean();
    }
  }

  const subjectMetaById = new Map();
  const subjectMetaByName = new Map();
  for (const row of subjectRows) {
    const id = String(row._id || row.id);
    const name = String(row.name || '').trim();
    subjectMetaById.set(id, { id, name });
    if (name) subjectMetaByName.set(name.toLowerCase(), id);
  }

  const videosBySubject = new Map();
  const assessmentsBySubject = new Map();
  for (const row of subjectRows) {
    const id = String(row._id || row.id);
    videosBySubject.set(id, []);
    assessmentsBySubject.set(id, []);
  }

  for (const video of allVideos) {
    const sid = resolveSubjectKey(video.subjectId, subjectMetaById, subjectMetaByName);
    if (sid && videosBySubject.has(sid)) {
      videosBySubject.get(sid).push(video);
    }
  }

  for (const assessment of assessments) {
    for (const row of subjectRows) {
      const id = String(row._id || row.id);
      const name = String(row.name || '').trim();
      if (assessmentMatchesSubject(assessment, id, name)) {
        assessmentsBySubject.get(id).push(assessment);
      }
    }
  }

  return subjectRows.map((row) => {
    const id = String(row._id || row.id);
    const videos = videosBySubject.get(id) || [];
    const assessmentList = assessmentsBySubject.get(id) || [];
    return {
      ...row,
      videos,
      quizzes: assessmentList,
      assessments: assessmentList,
      totalContent: videos.length + assessmentList.length,
    };
  });
}
