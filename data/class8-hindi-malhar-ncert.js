/**
 * Class VIII — Hindi (Malhar / NCERT outline).
 * Used by /api/curriculum/topics and /api/curriculum/subtopics for Class 8 + Hindi.
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

export const CLASS_8_HINDI_MALHAR_CHAPTERS = [
  {
    title: 'Poems (Kavita) - Swadesh (Kavita)',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  {
    title: 'Poems (Kavita) - Ek Aashirvaad (Kavita)',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  {
    title: 'Poems (Kavita) - Kabir Ke Dohe - Kabir (Dohe)',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  {
    title: 'Poems (Kavita) - Mat Baandho (Kavita)',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  {
    title: 'Poems (Kavita) - Aadmi Ka Anupat (Kavita)',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  {
    title: 'Prose (Gadya) - Do Gauraiya (Kahani)',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  {
    title: 'Prose (Gadya) - Haridwar (Kahani)',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  {
    title: 'Prose (Gadya) - Ek Tinke Par Mitti (Kahani/Lekh)',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  {
    title: 'Prose (Gadya) - Naya Mehman (Kahani)',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  {
    title: 'Prose (Gadya) - Tarun Ke Sapne (Lekh)',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  {
    title: 'Grammar (व्याकरण)',
    subtopics: [
      'व्याकरण',
      'शब्द भेद',
      'शब्द/पद',
      'लिंग',
      'वचन',
      'कारक',
      'विलोम शब्द',
      'उपसर्ग/प्रत्यय',
      'पर्यायवाची',
      'भिन्नार्थक विचार',
      'काल',
      'विराम चिह्न',
      'संधि',
      'समास',
      'पदबंध',
      'वाक्य परिवर्तन (रचना के आधार पर)',
      'मुहावरे और लोकोक्तियाँ',
    ],
  },
  {
    title: 'लेखन कार्य',
    subtopics: [
      'अनुच्छेद-लेखन',
      'पत्र लेखन',
      'संवाद लेखन',
      'विज्ञापन लेखन',
      'ईमेल लेखन',
      'लघु कथा लेखन',
      'चित्र वर्णन',
    ],
  },
];

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isClass8HindiSubject(subjectId) {
  const s = norm(subjectId);
  return s.includes('hindi') || s.includes('हिंदी') || s.includes('हिन्दी');
}

export function matchClass8HindiChapter(topicId) {
  return matchNcertChapter(topicId, CLASS_8_HINDI_MALHAR_CHAPTERS);
}
