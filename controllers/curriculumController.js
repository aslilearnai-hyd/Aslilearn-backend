import {
  getSubjectsForClass,
  getChaptersForSubject,
  getSubtopicsForChapter,
} from '../services/hardcoded-content-service.js';
import {
  CLASS_6_SCIENCE_CURIOSITY_CHAPTERS,
  isClass6ScienceSubject,
  matchClass6ScienceChapter,
} from '../data/class6-science-curiosity-ncert.js';
import {
  CLASS_6_ENGLISH_POORVI_CHAPTERS,
  isClass6EnglishSubject,
  matchClass6EnglishChapter,
} from '../data/class6-english-poorvi-ncert.js';
import {
  CLASS_6_HINDI_MALHAR_CHAPTERS,
  isClass6HindiSubject,
  matchClass6HindiChapter,
} from '../data/class6-hindi-malhar-ncert.js';
import {
  CLASS_6_MATHEMATICS_GANITA_PRAKASH_CHAPTERS,
  isClass6MathematicsSubject,
  matchClass6MathematicsChapter,
} from '../data/class6-mathematics-ganita-prakash-ncert.js';
import {
  CLASS_6_SOCIAL_SCIENCE_EXPLORING_SOCIETY_CHAPTERS,
  isClass6SocialScienceSubject,
  matchClass6SocialScienceChapter,
} from '../data/class6-social-science-exploring-society-ncert.js';
import {
  CLASS_7_SCIENCE_NCERT_CHAPTERS,
  matchClass7ScienceChapter,
  isClass7ScienceSubject,
} from '../data/class7-science-ncert.js';
import {
  CLASS_7_ENGLISH_POORVI_CHAPTERS,
  matchClass7EnglishChapter,
  isClass7EnglishSubject,
} from '../data/class7-english-poorvi-ncert.js';
import {
  CLASS_7_HINDI_CHAPTERS,
  matchClass7HindiChapter,
  isClass7HindiSubject,
} from '../data/class7-hindi-ncert.js';
import {
  CLASS_7_MATHEMATICS_GANITA_PRAKASH_CHAPTERS,
  matchClass7MathematicsChapter,
  isClass7MathematicsSubject,
} from '../data/class7-mathematics-ganita-prakash-ncert.js';
import {
  CLASS_7_SOCIAL_SCIENCE_EXPLORING_SOCIETY_CHAPTERS,
  matchClass7SocialScienceChapter,
  isClass7SocialScienceSubject,
} from '../data/class7-social-science-exploring-society-ncert.js';
import {
  CLASS_8_SCIENCE_NCERT_CHAPTERS,
  matchClass8ScienceChapter,
  isClass8ScienceSubject,
} from '../data/class8-science-ncert.js';
import {
  CLASS_8_ENGLISH_POORVI_CHAPTERS,
  matchClass8EnglishChapter,
  isClass8EnglishSubject,
} from '../data/class8-english-poorvi-ncert.js';
import {
  CLASS_8_HINDI_MALHAR_CHAPTERS,
  matchClass8HindiChapter,
  isClass8HindiSubject,
} from '../data/class8-hindi-malhar-ncert.js';
import {
  CLASS_8_MATHEMATICS_GANITA_PRAKASH_CHAPTERS,
  matchClass8MathematicsChapter,
  isClass8MathematicsSubject,
} from '../data/class8-mathematics-ganita-prakash-ncert.js';
import {
  CLASS_8_SOCIAL_SCIENCE_EXPLORING_SOCIETY_CHAPTERS,
  matchClass8SocialScienceChapter,
  isClass8SocialScienceSubject,
} from '../data/class8-social-science-exploring-society-ncert.js';
import {
  CLASS_10_ENGLISH_NCERT_CHAPTERS,
  matchClass10EnglishChapter,
  isClass10EnglishSubject,
} from '../data/class10-english-firstflight-footprints-ncert.js';
import {
  CLASS_10_MATHEMATICS_NCERT_CHAPTERS,
  matchClass10MathematicsChapter,
  isClass10MathematicsSubject,
} from '../data/class10-mathematics-ncert.js';
import {
  CLASS_10_SOCIAL_SCIENCE_NCERT_CHAPTERS,
  matchClass10SocialScienceChapter,
  isClass10SocialScienceSubject,
} from '../data/class10-social-science-ncert.js';
import {
  CLASS_10_HINDI_NCERT_CHAPTERS,
  matchClass10HindiChapter,
  isClass10HindiSubject,
} from '../data/class10-hindi-ncert.js';
import {
  CLASS_10_SCIENCE_NCERT_CHAPTERS,
  matchClass10ScienceChapter,
  isClass10ScienceSubject,
} from '../data/class10-science-ncert.js';

const CLASS_ROWS = ['Class 6', 'Class 7', 'Class 8', 'Class 10'];

/** Normalize dashboard class ids to curriculum keys (IIT / numeric). */
function normalizeClassId(classId) {
  if (classId == null || classId === '') return null;
  const s = String(classId).trim();
  if (s === 'Class-6-IIT') return 'IIT-6';
  if (s === 'IIT-6') return 'IIT-6';
  return s;
}

function parseClassIdToNumber(classId) {
  const s = normalizeClassId(classId);
  if (s == null || s === '') return null;
  if (s === 'IIT-6') return 'IIT-6';
  const m = String(s).match(/(\d+)/);
  return m ? m[1] : null;
}

/** GET /api/curriculum/classes */
export const listClasses = async (req, res) => {
  try {
    const data = CLASS_ROWS.map((id) => ({
      id,
      name: id,
      label: id,
    }));
    res.json({ success: true, data });
  } catch (error) {
    console.error('listClasses:', error);
    res.status(500).json({ success: false, message: 'Failed to list classes' });
  }
};

/** GET /api/curriculum/subjects?classId= */
export const listSubjects = async (req, res) => {
  try {
    const { classId: rawClass } = req.query;
    const classId = normalizeClassId(rawClass) ?? rawClass;
    if (!classId) {
      return res.status(400).json({ success: false, message: 'classId is required' });
    }
    const cn = parseClassIdToNumber(classId);
    if (!cn) {
      return res.json({ success: true, data: [], message: 'Unsupported class' });
    }

    if (cn === 'IIT-6') {
      const subjects = await getSubjectsForClass('IIT-6');
      const finalSubjects = subjects.length > 0 ? subjects : ['Physics', 'Chemistry', 'Maths', 'Biology'];
      return res.json({
        success: true,
        data: finalSubjects.map((name) => ({ id: name, name, label: name })),
      });
    }

    const classNum = parseInt(cn, 10);
    if (isNaN(classNum) || classNum < 5 || classNum > 10) {
      return res.json({ success: true, data: [], message: 'No curriculum for this class' });
    }

    // Class 6 — Science + English (Poorvi) + Hindi (Malhar) + Mathematics + Social Science.
    if (classNum === 6) {
      return res.json({
        success: true,
        data: [
          { id: 'Science', name: 'Science', label: 'Science' },
          { id: 'English', name: 'English', label: 'English' },
          { id: 'Hindi', name: 'Hindi', label: 'Hindi' },
          { id: 'Mathematics', name: 'Mathematics', label: 'Mathematics' },
          { id: 'Social Science', name: 'Social Science', label: 'Social Science' },
        ],
      });
    }
    // Class 7 — Science + English (Poorvi).
    if (classNum === 7) {
      return res.json({
        success: true,
        data: [
          { id: 'Science', name: 'Science', label: 'Science' },
          { id: 'English', name: 'English', label: 'English' },
          { id: 'Hindi', name: 'Hindi', label: 'Hindi' },
          { id: 'Mathematics', name: 'Mathematics', label: 'Mathematics' },
          { id: 'Social Science', name: 'Social Science', label: 'Social Science' },
        ],
      });
    }
    if (classNum === 8) {
      const dynamicSubjects = await getSubjectsForClass(classNum);
      const subjectSet = new Set(dynamicSubjects || []);
      subjectSet.add('Science');
      subjectSet.add('English');
      subjectSet.add('Hindi');
      subjectSet.add('Mathematics');
      subjectSet.add('Social Science');
      const finalSubjects = [...subjectSet];
      return res.json({
        success: true,
        data: finalSubjects.map((name) => ({ id: name, name, label: name })),
      });
    }
    if (classNum === 10) {
      const dynamicSubjects = await getSubjectsForClass(classNum);
      const subjectSet = new Set(dynamicSubjects || []);
      subjectSet.add('Science');
      subjectSet.add('English');
      subjectSet.add('Mathematics');
      subjectSet.add('Social Science');
      subjectSet.add('Hindi');
      const finalSubjects = [...subjectSet];
      return res.json({
        success: true,
        data: finalSubjects.map((name) => ({ id: name, name, label: name })),
      });
    }

    const subjects = await getSubjectsForClass(classNum);
    const finalSubjects = subjects.length > 0 ? subjects : [];
    res.json({
      success: true,
      data: finalSubjects.map((name) => ({ id: name, name, label: name })),
      message: finalSubjects.length === 0 ? 'No data available' : undefined,
    });
  } catch (error) {
    console.error('listSubjects:', error);
    res.status(500).json({ success: false, message: 'Failed to list subjects' });
  }
};

/** GET /api/curriculum/topics?classId=&subjectId= */
export const listTopics = async (req, res) => {
  try {
    const { classId: rawC, subjectId } = req.query;
    const classId = normalizeClassId(rawC) ?? rawC;
    if (!classId || !subjectId) {
      return res.status(400).json({
        success: false,
        message: 'classId and subjectId are required',
      });
    }
    const cn = parseClassIdToNumber(classId);
    if (!cn) {
      return res.json({ success: true, data: [] });
    }

    const subject = String(subjectId).trim();
    const classParam = cn === 'IIT-6' ? 'IIT-6' : cn;

    if (classParam === '6' && isClass6ScienceSubject(subject)) {
      const topics = CLASS_6_SCIENCE_CURIOSITY_CHAPTERS.map((ch) => ch.title);
      return res.json({
        success: true,
        data: topics.map((name) => ({ id: name, name, label: name })),
      });
    }
    if (classParam === '6' && isClass6EnglishSubject(subject)) {
      const topics = CLASS_6_ENGLISH_POORVI_CHAPTERS.map((ch) => ch.title);
      return res.json({
        success: true,
        data: topics.map((name) => ({ id: name, name, label: name })),
      });
    }
    if (classParam === '6' && isClass6HindiSubject(subject)) {
      const topics = CLASS_6_HINDI_MALHAR_CHAPTERS.map((ch) => ch.title);
      return res.json({
        success: true,
        data: topics.map((name) => ({ id: name, name, label: name })),
      });
    }
    if (classParam === '6' && isClass6MathematicsSubject(subject)) {
      const topics = CLASS_6_MATHEMATICS_GANITA_PRAKASH_CHAPTERS.map((ch) => ch.title);
      return res.json({
        success: true,
        data: topics.map((name) => ({ id: name, name, label: name })),
      });
    }
    if (classParam === '6' && isClass6SocialScienceSubject(subject)) {
      const topics = CLASS_6_SOCIAL_SCIENCE_EXPLORING_SOCIETY_CHAPTERS.map((ch) => ch.title);
      return res.json({
        success: true,
        data: topics.map((name) => ({ id: name, name, label: name })),
      });
    }

    if (classParam === '7' && isClass7ScienceSubject(subject)) {
      const topics = CLASS_7_SCIENCE_NCERT_CHAPTERS.map((ch) => ch.title);
      return res.json({
        success: true,
        data: topics.map((name) => ({ id: name, name, label: name })),
      });
    }
    if (classParam === '7' && isClass7EnglishSubject(subject)) {
      const topics = CLASS_7_ENGLISH_POORVI_CHAPTERS.map((ch) => ch.title);
      return res.json({
        success: true,
        data: topics.map((name) => ({ id: name, name, label: name })),
      });
    }
    if (classParam === '7' && isClass7HindiSubject(subject)) {
      const topics = CLASS_7_HINDI_CHAPTERS.map((ch) => ch.title);
      return res.json({
        success: true,
        data: topics.map((name) => ({ id: name, name, label: name })),
      });
    }
    if (classParam === '7' && isClass7MathematicsSubject(subject)) {
      const topics = CLASS_7_MATHEMATICS_GANITA_PRAKASH_CHAPTERS.map((ch) => ch.title);
      return res.json({
        success: true,
        data: topics.map((name) => ({ id: name, name, label: name })),
      });
    }
    if (classParam === '7' && isClass7SocialScienceSubject(subject)) {
      const topics = CLASS_7_SOCIAL_SCIENCE_EXPLORING_SOCIETY_CHAPTERS.map((ch) => ch.title);
      return res.json({
        success: true,
        data: topics.map((name) => ({ id: name, name, label: name })),
      });
    }

    if (classParam === '8' && isClass8ScienceSubject(subject)) {
      const topics = CLASS_8_SCIENCE_NCERT_CHAPTERS.map((ch) => ch.title);
      return res.json({
        success: true,
        data: topics.map((name) => ({ id: name, name, label: name })),
      });
    }
    if (classParam === '8' && isClass8EnglishSubject(subject)) {
      const topics = CLASS_8_ENGLISH_POORVI_CHAPTERS.map((ch) => ch.title);
      return res.json({
        success: true,
        data: topics.map((name) => ({ id: name, name, label: name })),
      });
    }
    if (classParam === '8' && isClass8HindiSubject(subject)) {
      const topics = CLASS_8_HINDI_MALHAR_CHAPTERS.map((ch) => ch.title);
      return res.json({
        success: true,
        data: topics.map((name) => ({ id: name, name, label: name })),
      });
    }
    if (classParam === '8' && isClass8MathematicsSubject(subject)) {
      const topics = CLASS_8_MATHEMATICS_GANITA_PRAKASH_CHAPTERS.map((ch) => ch.title);
      return res.json({
        success: true,
        data: topics.map((name) => ({ id: name, name, label: name })),
      });
    }
    if (classParam === '8' && isClass8SocialScienceSubject(subject)) {
      const topics = CLASS_8_SOCIAL_SCIENCE_EXPLORING_SOCIETY_CHAPTERS.map((ch) => ch.title);
      return res.json({
        success: true,
        data: topics.map((name) => ({ id: name, name, label: name })),
      });
    }
    if (classParam === '10' && isClass10EnglishSubject(subject)) {
      const topics = CLASS_10_ENGLISH_NCERT_CHAPTERS.map((ch) => ch.title);
      return res.json({
        success: true,
        data: topics.map((name) => ({ id: name, name, label: name })),
      });
    }
    if (classParam === '10' && isClass10MathematicsSubject(subject)) {
      const topics = CLASS_10_MATHEMATICS_NCERT_CHAPTERS.map((ch) => ch.title);
      return res.json({
        success: true,
        data: topics.map((name) => ({ id: name, name, label: name })),
      });
    }
    if (classParam === '10' && isClass10ScienceSubject(subject)) {
      const topics = CLASS_10_SCIENCE_NCERT_CHAPTERS.map((ch) => ch.title);
      return res.json({
        success: true,
        data: topics.map((name) => ({ id: name, name, label: name })),
      });
    }
    if (classParam === '10' && isClass10SocialScienceSubject(subject)) {
      const topics = CLASS_10_SOCIAL_SCIENCE_NCERT_CHAPTERS.map((ch) => ch.title);
      return res.json({
        success: true,
        data: topics.map((name) => ({ id: name, name, label: name })),
      });
    }
    if (classParam === '10' && isClass10HindiSubject(subject)) {
      const topics = CLASS_10_HINDI_NCERT_CHAPTERS.map((ch) => ch.title);
      return res.json({
        success: true,
        data: topics.map((name) => ({ id: name, name, label: name })),
      });
    }

    const chapters = await getChaptersForSubject(classParam, subject);
    const topics = (chapters || []).map(
      (ch) => ch.chapterName || ch.name || ch.chapterCode || '',
    ).filter(Boolean);

    res.json({
      success: true,
      data: topics.map((name) => ({ id: name, name, label: name })),
      message: topics.length === 0 ? 'No data available' : undefined,
    });
  } catch (error) {
    console.error('listTopics:', error);
    res.status(500).json({ success: false, message: 'Failed to list topics' });
  }
};

/** GET /api/curriculum/subtopics?classId=&subjectId=&topicId= */
export const listSubtopics = async (req, res) => {
  try {
    const { classId: rawC, subjectId, topicId } = req.query;
    const classId = normalizeClassId(rawC) ?? rawC;
    if (!classId || !subjectId || !topicId) {
      return res.status(400).json({
        success: false,
        message: 'classId, subjectId, and topicId are required',
      });
    }
    const cn = parseClassIdToNumber(classId);
    if (!cn) {
      return res.json({ success: true, data: [] });
    }

    const subject = String(subjectId).trim();
    const topic = String(topicId).trim();
    const classParam = cn === 'IIT-6' ? 'IIT-6' : cn;

    if (classParam === '6' && isClass6ScienceSubject(subject)) {
      const ch = matchClass6ScienceChapter(topic);
      const raw = ch && Array.isArray(ch.subtopics) ? ch.subtopics : [];
      return res.json({
        success: true,
        data: raw.map((name) => ({ id: name, name, label: name })),
        message: raw.length === 0 ? 'No data available' : undefined,
      });
    }
    if (classParam === '6' && isClass6EnglishSubject(subject)) {
      const ch = matchClass6EnglishChapter(topic);
      const raw = ch && Array.isArray(ch.subtopics) ? ch.subtopics : [];
      return res.json({
        success: true,
        data: raw.map((name) => ({ id: name, name, label: name })),
        message: raw.length === 0 ? 'No data available' : undefined,
      });
    }
    if (classParam === '6' && isClass6HindiSubject(subject)) {
      const ch = matchClass6HindiChapter(topic);
      const raw = ch && Array.isArray(ch.subtopics) ? ch.subtopics : [];
      return res.json({
        success: true,
        data: raw.map((name) => ({ id: name, name, label: name })),
        message: raw.length === 0 ? 'No data available' : undefined,
      });
    }
    if (classParam === '6' && isClass6MathematicsSubject(subject)) {
      const ch = matchClass6MathematicsChapter(topic);
      const raw = ch && Array.isArray(ch.subtopics) ? ch.subtopics : [];
      return res.json({
        success: true,
        data: raw.map((name) => ({ id: name, name, label: name })),
        message: raw.length === 0 ? 'No data available' : undefined,
      });
    }
    if (classParam === '6' && isClass6SocialScienceSubject(subject)) {
      const ch = matchClass6SocialScienceChapter(topic);
      const raw = ch && Array.isArray(ch.subtopics) ? ch.subtopics : [];
      return res.json({
        success: true,
        data: raw.map((name) => ({ id: name, name, label: name })),
        message: raw.length === 0 ? 'No data available' : undefined,
      });
    }

    if (classParam === '7' && isClass7ScienceSubject(subject)) {
      const ch = matchClass7ScienceChapter(topic);
      const raw = ch && Array.isArray(ch.subtopics) ? ch.subtopics : [];
      return res.json({
        success: true,
        data: raw.map((name) => ({ id: name, name, label: name })),
        message: raw.length === 0 ? 'No data available' : undefined,
      });
    }
    if (classParam === '7' && isClass7EnglishSubject(subject)) {
      const ch = matchClass7EnglishChapter(topic);
      const raw = ch && Array.isArray(ch.subtopics) ? ch.subtopics : [];
      return res.json({
        success: true,
        data: raw.map((name) => ({ id: name, name, label: name })),
        message: raw.length === 0 ? 'No data available' : undefined,
      });
    }
    if (classParam === '7' && isClass7HindiSubject(subject)) {
      const ch = matchClass7HindiChapter(topic);
      const raw = ch && Array.isArray(ch.subtopics) ? ch.subtopics : [];
      return res.json({
        success: true,
        data: raw.map((name) => ({ id: name, name, label: name })),
        message: raw.length === 0 ? 'No data available' : undefined,
      });
    }
    if (classParam === '7' && isClass7MathematicsSubject(subject)) {
      const ch = matchClass7MathematicsChapter(topic);
      const raw = ch && Array.isArray(ch.subtopics) ? ch.subtopics : [];
      return res.json({
        success: true,
        data: raw.map((name) => ({ id: name, name, label: name })),
        message: raw.length === 0 ? 'No data available' : undefined,
      });
    }
    if (classParam === '7' && isClass7SocialScienceSubject(subject)) {
      const ch = matchClass7SocialScienceChapter(topic);
      const raw = ch && Array.isArray(ch.subtopics) ? ch.subtopics : [];
      return res.json({
        success: true,
        data: raw.map((name) => ({ id: name, name, label: name })),
        message: raw.length === 0 ? 'No data available' : undefined,
      });
    }

    if (classParam === '8' && isClass8ScienceSubject(subject)) {
      const ch = matchClass8ScienceChapter(topic);
      const raw = ch && Array.isArray(ch.subtopics) ? ch.subtopics : [];
      return res.json({
        success: true,
        data: raw.map((name) => ({ id: name, name, label: name })),
        message: raw.length === 0 ? 'No data available' : undefined,
      });
    }
    if (classParam === '8' && isClass8EnglishSubject(subject)) {
      const ch = matchClass8EnglishChapter(topic);
      const raw = ch && Array.isArray(ch.subtopics) ? ch.subtopics : [];
      return res.json({
        success: true,
        data: raw.map((name) => ({ id: name, name, label: name })),
        message: raw.length === 0 ? 'No data available' : undefined,
      });
    }
    if (classParam === '8' && isClass8HindiSubject(subject)) {
      const ch = matchClass8HindiChapter(topic);
      const raw = ch && Array.isArray(ch.subtopics) ? ch.subtopics : [];
      return res.json({
        success: true,
        data: raw.map((name) => ({ id: name, name, label: name })),
        message: raw.length === 0 ? 'No data available' : undefined,
      });
    }
    if (classParam === '8' && isClass8MathematicsSubject(subject)) {
      const ch = matchClass8MathematicsChapter(topic);
      const raw = ch && Array.isArray(ch.subtopics) ? ch.subtopics : [];
      return res.json({
        success: true,
        data: raw.map((name) => ({ id: name, name, label: name })),
        message: raw.length === 0 ? 'No data available' : undefined,
      });
    }
    if (classParam === '8' && isClass8SocialScienceSubject(subject)) {
      const ch = matchClass8SocialScienceChapter(topic);
      const raw = ch && Array.isArray(ch.subtopics) ? ch.subtopics : [];
      return res.json({
        success: true,
        data: raw.map((name) => ({ id: name, name, label: name })),
        message: raw.length === 0 ? 'No data available' : undefined,
      });
    }
    if (classParam === '10' && isClass10EnglishSubject(subject)) {
      const ch = matchClass10EnglishChapter(topic);
      const raw = ch && Array.isArray(ch.subtopics) ? ch.subtopics : [];
      return res.json({
        success: true,
        data: raw.map((name) => ({ id: name, name, label: name })),
        message: raw.length === 0 ? 'No data available' : undefined,
      });
    }
    if (classParam === '10' && isClass10MathematicsSubject(subject)) {
      const ch = matchClass10MathematicsChapter(topic);
      const raw = ch && Array.isArray(ch.subtopics) ? ch.subtopics : [];
      return res.json({
        success: true,
        data: raw.map((name) => ({ id: name, name, label: name })),
        message: raw.length === 0 ? 'No data available' : undefined,
      });
    }
    if (classParam === '10' && isClass10ScienceSubject(subject)) {
      const ch = matchClass10ScienceChapter(topic);
      const raw = ch && Array.isArray(ch.subtopics) ? ch.subtopics : [];
      return res.json({
        success: true,
        data: raw.map((name) => ({ id: name, name, label: name })),
        message: raw.length === 0 ? 'No data available' : undefined,
      });
    }
    if (classParam === '10' && isClass10SocialScienceSubject(subject)) {
      const ch = matchClass10SocialScienceChapter(topic);
      const raw = ch && Array.isArray(ch.subtopics) ? ch.subtopics : [];
      return res.json({
        success: true,
        data: raw.map((name) => ({ id: name, name, label: name })),
        message: raw.length === 0 ? 'No data available' : undefined,
      });
    }
    if (classParam === '10' && isClass10HindiSubject(subject)) {
      const ch = matchClass10HindiChapter(topic);
      const raw = ch && Array.isArray(ch.subtopics) ? ch.subtopics : [];
      return res.json({
        success: true,
        data: raw.map((name) => ({ id: name, name, label: name })),
        message: raw.length === 0 ? 'No data available' : undefined,
      });
    }

    const raw = await getSubtopicsForChapter(classParam, subject, topic);
    res.json({
      success: true,
      data: raw.map((name) => ({ id: name, name, label: name })),
      message: raw.length === 0 ? 'No data available' : undefined,
    });
  } catch (error) {
    console.error('listSubtopics:', error);
    res.status(500).json({ success: false, message: 'Failed to list subtopics' });
  }
};
