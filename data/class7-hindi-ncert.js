/**
 * Class VII — Hindi syllabus outline.
 * Used by /api/curriculum/topics and /api/curriculum/subtopics for Class 7 + Hindi.
 */
import { matchNcertChapter } from './class6-science-curiosity-ncert.js';

const COMMON_LITERATURE_SUBTOPICS = [
  "Pre-reading: Let's Begin / Paath se Pehle",
  'Reading the text: silent reading, reading aloud, pronunciation practice',
  "Comprehension: Let's Understand / Samajh",
  "Vocabulary & Grammar: Let's Learn / Bhasha ki Baat",
  "Listening & Speaking: Let's Listen and Speak / Sunna-Bolna",
  "Writing: Let's Write / Likhna",
  "Project/Extension: Let's Explore More / Paath se Aage",
];

export const CLASS_7_HINDI_CHAPTERS = [
  {
    title: 'Poems (Kavita) - Maa, Kah Ek Kahani',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  {
    title: 'Poems (Kavita) - Phool Aur Kaanta',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  {
    title: 'Poems (Kavita) - Giridhar Kavi Rai Ki Kundaliya',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  {
    title: 'Poems (Kavita) - Varsha-Bahaar',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  {
    title: 'Poems (Kavita) - Chidiya',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  {
    title: 'Poems (Kavita) - Meera Ke Pad',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  {
    title: 'Prose (Gadya) - Teen Buddhimaan (Lokkatha)',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  {
    title: 'Prose (Gadya) - Paani Re Paani (Nibandh)',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  {
    title: 'Prose (Gadya) - Nahin Hona Beemaar (Kahani)',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  {
    title: 'Prose (Gadya) - Birju Maharaj Se Saakshatkaar (Interview)',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  {
    title: 'Grammar (व्याकरण)',
    subtopics: [
      'भाषा और व्याकरण',
      'वर्ण विचार',
      'शब्द विचार',
      'वर्तनी',
      'संज्ञा',
      'लिंग (संज्ञा के विकार)',
      'वचन',
      'कारक',
      'सर्वनाम',
      'विशेषण',
      'क्रिया',
      'काल',
      'वाच्य',
      'अव्यय',
      'संधि',
      'समास',
      'उपसर्ग एवं प्रत्यय',
      'वाक्य रचना',
      'वाक्य अशुद्धियाँ एवं संशोधन',
      'विराम-चिह्न',
      'मुहावरे एवं लोकोक्तियां',
    ],
  },
  {
    title: 'लेखन कौशल',
    subtopics: ['अनुच्छेद-लेखन', 'पत्र लेखन', 'संवाद-लेखन', 'निबंध-लेखन', 'चित्र वर्णन'],
  },
];

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isClass7HindiSubject(subjectId) {
  const s = norm(subjectId);
  return s.includes('hindi') || s.includes('हिंदी') || s.includes('हिन्दी');
}

export function matchClass7HindiChapter(topicId) {
  return matchNcertChapter(topicId, CLASS_7_HINDI_CHAPTERS);
}
