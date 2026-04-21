/**
 * Class X — Hindi (NCERT: Kshitij, Kritika, Sparsh, Sanchayan).
 * Used by /api/curriculum/topics and /api/curriculum/subtopics for Class 10 + Hindi.
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

export const CLASS_10_HINDI_NCERT_CHAPTERS = [
  { title: 'Kshitij 1: Surdas - Pad (Pad)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  {
    title: 'Kshitij 2: Tulsidas - Ram-Lakshman-Parshuram Samvad (Prasang)',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  { title: 'Kshitij 3: Atmakathya - Jaishankar Prasad (Kavita)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  {
    title: "Kshitij 4: Utsaah / At Nahin Rahi Hai - Suryakant Tripathi 'Nirala' (Kavita)",
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  {
    title: 'Kshitij 5: Yah Danturit Muskaan / Fasal - Nagarjun (Kavita)',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  { title: 'Kshitij 6: Sangatkar - Manglesh Dabral (Kavita)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Kshitij 7: Netaji ka Chashma - Swayam Prakash (Kahani)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Kshitij 8: Balgobin Bhagat - Ramvriksh Benipuri (Rekhachitra)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Kshitij 9: Lakhnavi Andaaz - Yashpal (Vyangya)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Kshitij 10: Ek Kahani Yah Bhi - Mannu Bhandari (Atmkatha-ansh)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  {
    title: 'Kshitij 11: Stri Shiksha Ke Virodhi Kutarkon Ka Khandan (Lekh)',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  { title: 'Kshitij 12: Naubatkhane Mein Ibadat / Sanskriti (Lekh)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },

  { title: 'Kritika 1: Mata Ka Anchal - Shivpujan Sahay (Kahani)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Kritika 2: Sana-Sana Hath Jodi - Madhu Kankaria (Yatra Vrittant)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  {
    title: "Kritika 3: Main Kyon Likhta Hoon - Sachidanand Hiranand Vatsyayan 'Agyeya' (Lekh)",
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },

  { title: 'Sparsh 1: Sakhi - Kabir (Dohe)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Sparsh 2: Pad - Meerabai (Pad)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Sparsh 3: Manushyata - Maithili Sharan Gupt (Kavita)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Sparsh 4: Parvat Pradesh Ke Pavas - Sumitranandan Pant (Kavita)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Sparsh 5: Top - Veeren Dangwal (Kavita)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Sparsh 6: Kar Chale Hum Fida - Kaifi Azmi (Geet)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Sparsh 7: Aatmatran - Rabindranath Tagore (Kavita)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Sparsh 8: Bade Bhai Sahab - Premchand (Kahani)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Sparsh 9: Diary Ka Ek Panna - Sitaram Seksariya (Diary)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Sparsh 10: Tatara-Vamiro Katha - Leeladhar Mandloi (Kahani)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Sparsh 11: Teesri Kasam Ke Shilpkar Shailendra - Prahlad Agrawal (Lekh)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  {
    title: 'Sparsh 12: Ab Kahan Doosre Ke Dukh Se Dukhi Hone Wale - Nida Fazli (Lekh)',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  { title: 'Sparsh 13: Patjhar Mein Tooti Pattiyan - Ravindra Kelekar (Lekh)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Sparsh 14: Kartus - Habib Tanvir (Ekanki)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },

  { title: 'Sanchayan 1: Harihar Kaka - Mithileshwar (Kahani)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Sanchayan 2: Sapnon Ke Se Din - Gurdial Singh (Atmkatha-ansh)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Sanchayan 3: Topi Shukla - Rahi Masoom Raza (Upanyas-ansh)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },

  {
    title: 'व्याकरण',
    subtopics: ['अपठित बोध', 'अपठित गद्यांश', 'पदबंध', 'रचना के आधार पर वाक्य रूपांतरण', 'समास', 'मुहावरे'],
  },
  {
    title: 'रचनात्मक लेखन',
    subtopics: ['अनुच्छेद लेखन', 'पत्र-लेखन', 'सूचना लेखन', 'विज्ञापन लेखन', 'लघु कथा लेखन', 'ई-मेल लेखन'],
  },
];

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isClass10HindiSubject(subjectId) {
  const s = norm(subjectId);
  return s.includes('hindi') || s.includes('हिंदी') || s.includes('हिन्दी');
}

export function matchClass10HindiChapter(topicId) {
  return matchNcertChapter(topicId, CLASS_10_HINDI_NCERT_CHAPTERS);
}
