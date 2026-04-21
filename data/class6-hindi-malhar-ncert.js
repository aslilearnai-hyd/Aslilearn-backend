/**
 * Class VI — Hindi (Malhar / NCERT outline).
 * Used by /api/curriculum/topics and /api/curriculum/subtopics for Class 6 + Hindi.
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

export const CLASS_6_HINDI_MALHAR_CHAPTERS = [
  { title: 'Poems (Kavita) - Matrubhoomi (Kavita)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Poems (Kavita) - Pehli Boond (Kavita)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Poems (Kavita) - Jalte Chalo (Kavita)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Poems (Kavita) - Maiya Main Nahin Makhan Khayo (Kavita)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Poems (Kavita) - Chetak Ki Veerta (Kavita)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },

  { title: 'Prose (Gadya) - Gol (Kahani)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Prose (Gadya) - Haar Ki Jeet (Kahani)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Prose (Gadya) - Rahim Ke Dohe (Dohe)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Prose (Gadya) - Meri Maa (Sansmaran)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Prose (Gadya) - Sattriya aur Bihu Nritya (Nibandh)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Prose (Gadya) - Pariksha (Kahani)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Prose (Gadya) - Hind Mahasagar Mein Chhota-Sa Hindustan (Lekh)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Prose (Gadya) - Ped Ki Baat (Kavita/Lekh)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },

  {
    title: 'Grammar (व्याकरण)',
    subtopics: [
      'वर्ण-विचार और शब्द-विचार',
      'व्याकरणिक कोटियाँ — संज्ञा, सर्वनाम, विशेषण, क्रिया',
      'संज्ञा के विकार — लिंग, वचन, कारक',
      'काल — भूतकाल, वर्तमान काल, भविष्य काल',
      'शब्द रचना — उपसर्ग और प्रत्यय',
      'शब्द-भंडार — पर्यायवाची, विलोम, युग्म शब्द, समरूपी भिन्नार्थक शब्द, अनेकार्थी शब्द',
      'वाक्य-विचार और विराम-चिह्न',
      'व्यावहारिक व्याकरण — मुहावरे और लोकोक्तियाँ',
    ],
  },
];

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isClass6HindiSubject(subjectId) {
  const s = norm(subjectId);
  return s.includes('hindi') || s.includes('हिंदी') || s.includes('हिन्दी');
}

export function matchClass6HindiChapter(topicId) {
  return matchNcertChapter(topicId, CLASS_6_HINDI_MALHAR_CHAPTERS);
}
