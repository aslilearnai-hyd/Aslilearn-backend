import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import { decodeCsvBuffer } from '../utils/csv-encoding.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to CSV files - prefer backend folder, then client folder for local dev
const BACKEND_CSV_PATH = path.join(__dirname, '../class-9'); // Check if CSV files are in backend
const CLIENT_SRC_PATH = path.join(__dirname, '../../client/src'); // Fallback to client folder

// Determine which path to use
// __dirname is backend/services, so ../ is backend folder
let CSV_BASE_PATH;
if (fs.existsSync(BACKEND_CSV_PATH)) {
  CSV_BASE_PATH = path.join(__dirname, '..'); // Use backend folder (backend/)
  console.log('📁 Using CSV files from backend folder:', CSV_BASE_PATH);
} else {
  CSV_BASE_PATH = path.join(__dirname, '../../client/src'); // Use client folder
  console.log('📁 Using CSV files from client folder:', CSV_BASE_PATH);
}

/**
 * Read questions from CSV file
 */
function readQuestionsFromCSV(classNumber, subject, topic) {
  try {
    // Normalize class folder name (handle "class - 10" vs "class-9")
    const classFolder = classNumber === 9 ? 'class-9' : 'class - 10';
    
    // Build path to CSV file
    let csvPath;
    
    // Handle sub-subjects (e.g., science/biology, science/chemistry, science/physics)
    if (subject.toLowerCase() === 'science') {
      // For science, we need to check sub-subjects
      // Try common sub-subjects first
      const subSubjects = ['biology', 'chemistry', 'physics'];
      for (const subSubject of subSubjects) {
        const testPath = path.join(CSV_BASE_PATH, classFolder, 'science', subSubject, `${topic}.csv`);
        if (fs.existsSync(testPath)) {
          csvPath = testPath;
          break;
        }
      }
      
      // If not found in sub-subjects, try directly in science folder
      if (!csvPath) {
        const directPath = path.join(CSV_BASE_PATH, classFolder, 'science', `${topic}.csv`);
        if (fs.existsSync(directPath)) {
          csvPath = directPath;
        }
      }
    } else if (subject.toLowerCase() === 'english') {
      // For English, check if there's a prose subfolder
      const prosePath = path.join(CSV_BASE_PATH, classFolder, 'english', 'prose', `${topic}.csv`);
      const directPath = path.join(CSV_BASE_PATH, classFolder, 'english', `${topic}.csv`);
      
      if (fs.existsSync(prosePath)) {
        csvPath = prosePath;
      } else if (fs.existsSync(directPath)) {
        csvPath = directPath;
      }
    } else {
      // For other subjects (maths, social), try direct path
      csvPath = path.join(CSV_BASE_PATH, classFolder, subject.toLowerCase(), `${topic}.csv`);
    }
    
    if (!csvPath || !fs.existsSync(csvPath)) {
      throw new Error(`CSV file not found for Class ${classNumber}, Subject: ${subject}, Topic: ${topic}`);
    }
    
    // Read and parse CSV
    // Note: Some CSV files have commas within fields (like "2, 4, 8, 16, 32" or formulas with commas)
    // The CSV parser will split these, so we need to reconstruct them.
    //
    // Read as a raw buffer and decode with BOM + Windows-1252 fallback so that
    // files saved from Excel on Windows (default ANSI) don't come through as �.
    const csvContent = decodeCsvBuffer(fs.readFileSync(csvPath));
    
    // Parse WITHOUT columns:true first to handle variable column counts
    // Then manually map to column names
    let rawRecords;
    try {
      rawRecords = parse(csvContent, {
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true, // This works better without columns:true
        relax_quotes: true,
        quote: '"',
        escape: '"',
        bom: true,
        cast: false
      });
    } catch (error) {
      console.error('❌ CSV parsing error:', error.message);
      throw new Error(`Failed to parse CSV file: ${error.message}`);
    }
    
    if (rawRecords.length < 2) {
      throw new Error('CSV file has no data rows');
    }
    
    // First row is headers
    const headers = rawRecords[0];
    const expectedHeaders = ['Question_Type', 'Question_Number', 'Question', 'Option_A', 'Option_B', 'Option_C', 'Option_D', 'Answer'];
    
    // Map records to objects
    const records = rawRecords.slice(1).map((row, rowIndex) => {
      const record = {};
      
      // Map first 8 columns to expected headers
      expectedHeaders.forEach((header, idx) => {
        record[header] = (row[idx] || '').trim();
      });
      
      // If row has more than 8 columns, reconstruct options
      if (row.length > 8) {
        const extraCols = row.slice(8);
        // Heuristic: distribute extra columns to options
        // Typically: Option_A, Option_B, Option_C, Option_D each might have 2-5 extra columns
        // Answer is usually the last one
        
        // Try to intelligently group extra columns
        // For now, just append to the last option or answer
        if (extraCols.length > 0) {
          // If we have many extra columns, they're likely split options
          // Group them: first ~5 for Option_A, next ~5 for Option_B, etc.
          const colsPerOption = Math.ceil(extraCols.length / 5); // 4 options + 1 answer
          
          if (extraCols.length >= 20) {
            // 5 columns per option (like "2, 4, 6, 8, 10")
            record.Option_A = (record.Option_A + ', ' + extraCols.slice(0, 5).join(', ')).replace(/^,\s*/, '');
            record.Option_B = (record.Option_B + ', ' + extraCols.slice(5, 10).join(', ')).replace(/^,\s*/, '');
            record.Option_C = (record.Option_C + ', ' + extraCols.slice(10, 15).join(', ')).replace(/^,\s*/, '');
            record.Option_D = (record.Option_D + ', ' + extraCols.slice(15, 20).join(', ')).replace(/^,\s*/, '');
            record.Answer = (record.Answer + ', ' + extraCols.slice(20).join(', ')).replace(/^,\s*/, '') || record.Answer;
          } else {
            // Fewer columns - append to existing options
            const perOption = Math.floor(extraCols.length / 5);
            record.Option_A = (record.Option_A + ', ' + extraCols.slice(0, perOption).join(', ')).replace(/^,\s*/, '');
            record.Option_B = (record.Option_B + ', ' + extraCols.slice(perOption, perOption * 2).join(', ')).replace(/^,\s*/, '');
            record.Option_C = (record.Option_C + ', ' + extraCols.slice(perOption * 2, perOption * 3).join(', ')).replace(/^,\s*/, '');
            record.Option_D = (record.Option_D + ', ' + extraCols.slice(perOption * 3, perOption * 4).join(', ')).replace(/^,\s*/, '');
            record.Answer = (record.Answer + ', ' + extraCols.slice(perOption * 4).join(', ')).replace(/^,\s*/, '') || record.Answer;
          }
        }
      }
      
      return record;
    });
    
    // Records are already cleaned during parsing, just return them
    return records;
  } catch (error) {
    console.error('Error reading CSV:', error);
    throw error;
  }
}

/**
 * Get available topics for a class and subject
 */
export function getAvailableTopics(classNumber, subject) {
  try {
    const classFolder = classNumber === 9 ? 'class-9' : 'class - 10';
    const topics = [];
    
    console.log('🔍 Getting topics for:', { classNumber, subject, classFolder });
    console.log('📁 CLIENT_SRC_PATH:', CLIENT_SRC_PATH);
    
    let subjectPath;
    if (subject.toLowerCase() === 'science') {
      // Check all science subfolders
      const sciencePath = path.join(CSV_BASE_PATH, classFolder, 'science');
      if (fs.existsSync(sciencePath)) {
        const subDirs = fs.readdirSync(sciencePath, { withFileTypes: true });
        for (const subDir of subDirs) {
          if (subDir.isDirectory()) {
            const files = fs.readdirSync(path.join(sciencePath, subDir.name));
            files.forEach(file => {
              if (file.endsWith('.csv')) {
                topics.push({
                  name: file.replace('.csv', ''),
                  subSubject: subDir.name,
                  fullPath: `${subDir.name}/${file}`
                });
              }
            });
          }
        }
      }
    } else if (subject.toLowerCase() === 'english') {
      // Check prose subfolder and direct folder
      const englishPath = path.join(CSV_BASE_PATH, classFolder, 'english');
      console.log('📂 English path:', englishPath);
      console.log('📂 English path exists:', fs.existsSync(englishPath));
      
      if (fs.existsSync(englishPath)) {
        const prosePath = path.join(englishPath, 'prose');
        console.log('📂 Prose path:', prosePath);
        console.log('📂 Prose path exists:', fs.existsSync(prosePath));
        
        if (fs.existsSync(prosePath)) {
          const files = fs.readdirSync(prosePath);
          console.log('📄 Prose files found:', files);
          files.forEach(file => {
            if (file.endsWith('.csv')) {
              topics.push({
                name: file.replace('.csv', ''),
                subSubject: 'prose',
                fullPath: `prose/${file}`
              });
            }
          });
        }
        // Also check direct files (but skip prose folder)
        const allFiles = fs.readdirSync(englishPath, { withFileTypes: true });
        allFiles.forEach(item => {
          if (item.isFile() && item.name.endsWith('.csv')) {
            topics.push({
              name: item.name.replace('.csv', ''),
              subSubject: null,
              fullPath: item.name
            });
          }
        });
      } else {
        console.error('❌ English path does not exist:', englishPath);
      }
    } else {
      // Direct subject folder
      subjectPath = path.join(CSV_BASE_PATH, classFolder, subject.toLowerCase());
      console.log('📂 Checking subject path:', subjectPath);
      console.log('📂 Path exists:', fs.existsSync(subjectPath));
      
      if (fs.existsSync(subjectPath)) {
        const files = fs.readdirSync(subjectPath);
        console.log('📄 Files found:', files);
        files.forEach(file => {
          if (file.endsWith('.csv')) {
            topics.push({
              name: file.replace('.csv', ''),
              subSubject: null,
              fullPath: file
            });
          }
        });
      } else {
        console.error('❌ Subject path does not exist:', subjectPath);
      }
    }
    
    console.log('✅ Topics found:', topics.length, topics.map(t => t.name));
    return topics;
  } catch (error) {
    console.error('Error getting topics:', error);
    return [];
  }
}

/**
 * Transform questions based on tool type
 */
export function transformQuestionsForTool(questions, toolType, params = {}) {
  const { difficulty, questionCount, format } = params;
  
  // Filter by difficulty if specified
  let filteredQuestions = questions;
  if (difficulty && difficulty !== 'mixed') {
    // Since CSV doesn't have difficulty, we'll use question number as proxy
    // Easy: first 30%, Medium: middle 40%, Hard: last 30%
    const total = questions.length;
    if (difficulty === 'easy') {
      filteredQuestions = questions.slice(0, Math.floor(total * 0.3));
    } else if (difficulty === 'medium') {
      filteredQuestions = questions.slice(Math.floor(total * 0.3), Math.floor(total * 0.7));
    } else if (difficulty === 'hard') {
      filteredQuestions = questions.slice(Math.floor(total * 0.7));
    }
  }
  
  // Limit question count
  if (questionCount && questionCount > 0) {
    filteredQuestions = filteredQuestions.slice(0, parseInt(questionCount));
  }
  
  switch (toolType) {
    case 'worksheet-mcq-generator':
      return generateWorksheet(filteredQuestions, params);
    
    case 'exam-question-paper-generator':
      return generateExamPaper(filteredQuestions, params);
    
    case 'flashcard-generator':
      return generateFlashcards(filteredQuestions, params);
    
    case 'homework-creator':
      return generateHomework(filteredQuestions, params);
    
    case 'concept-mastery-helper':
      return generateConceptMastery(filteredQuestions, params);
    
    case 'short-notes-summaries-maker':
      return generateShortNotes(filteredQuestions, params);
    
    case 'activity-project-generator':
      return generateActivityProject(filteredQuestions, params);
    
    case 'lesson-planner':
      return generateLessonPlan(filteredQuestions, params);
    
    case 'daily-class-plan-maker':
      return generateDailyClassPlan(filteredQuestions, params);
    
    case 'rubrics-evaluation-report-card-generator':
      return generateRubrics(filteredQuestions, params);
    
    case 'story-passage-creator':
      return generateStoryPassage(filteredQuestions, params);
    
    default:
      return generateWorksheet(filteredQuestions, params);
  }
}

/**
 * Generate Worksheet format
 */
function generateWorksheet(questions, params) {
  const questionCount = questions.length;
  let content = `# Worksheet: ${params.topic || 'Practice Questions'}\n\n`;
  content += `**Subject:** ${params.subject || 'General'}\n`;
  content += `**Class:** ${params.classNumber || 'N/A'}\n`;
  if (params.subTopic) {
    content += `**Sub Topic:** ${params.subTopic}\n`;
  }
  content += `**Date:** ${new Date().toLocaleDateString()}\n`;
  content += `**Total Questions:** ${questionCount}\n\n`;
  content += `---\n\n`;
  content += `## Instructions\n\n`;
  content += `Please answer all questions. Show your work where applicable.\n\n`;
  content += `---\n\n`;
  
  questions.forEach((q, index) => {
    content += `### Question ${index + 1}\n\n`;
    content += `${q.Question || q.question || ''}\n\n`;
    
    if (q.Option_A || q.option_a) {
      content += `**A)** ${q.Option_A || q.option_a}\n`;
      content += `**B)** ${q.Option_B || q.option_b}\n`;
      content += `**C)** ${q.Option_C || q.option_c}\n`;
      content += `**D)** ${q.Option_D || q.option_d}\n\n`;
    }
    
    content += `\n`;
  });
  
  // Answer Key at the end
  content += `\n---\n\n## Answer Key\n\n`;
  questions.forEach((q, index) => {
    const answer = q.Answer || q.answer || 'N/A';
    content += `**Q${index + 1}:** ${answer}\n`;
  });
  
  return content;
}

/**
 * Generate Exam Paper format
 */
function generateExamPaper(questions, params) {
  const { duration = 90, totalMarks = 100 } = params;
  const marksPerQuestion = questions.length > 0 ? Math.floor(totalMarks / questions.length) : 1;
  
  let content = `# Examination Paper\n\n`;
  content += `**Subject:** ${params.subject || 'General'}\n`;
  content += `**Class:** ${params.classNumber || 'N/A'}\n`;
  content += `**Topic:** ${params.topic || 'N/A'}\n`;
  if (params.subTopic) {
    content += `**Sub Topic:** ${params.subTopic}\n`;
  }
  content += `**Time:** ${duration} minutes\n`;
  content += `**Total Questions:** ${questions.length}\n`;
  content += `**Total Marks:** ${totalMarks}\n\n`;
  content += `---\n\n`;
  content += `## Instructions\n\n`;
  content += `1. Answer all questions.\n`;
  content += `2. Each question carries ${marksPerQuestion} marks.\n`;
  content += `3. Write clearly and legibly.\n`;
  content += `4. Read all questions carefully before answering.\n\n`;
  content += `---\n\n`;
  
  questions.forEach((q, index) => {
    content += `### Question ${index + 1} [${marksPerQuestion} Marks]\n\n`;
    content += `${q.Question || q.question || ''}\n\n`;
    
    if (q.Option_A || q.option_a) {
      content += `**A)** ${q.Option_A || q.option_a}\n`;
      content += `**B)** ${q.Option_B || q.option_b}\n`;
      content += `**C)** ${q.Option_C || q.option_c}\n`;
      content += `**D)** ${q.Option_D || q.option_d}\n\n`;
    }
    
    content += `\n`;
  });
  
  // Answer key at the end
  content += `\n---\n\n## Answer Key\n\n`;
  questions.forEach((q, index) => {
    const answer = q.Answer || q.answer || 'N/A';
    content += `**Q${index + 1}:** ${answer}\n`;
  });
  
  return content;
}

/**
 * Generate Flashcards format
 */
function generateFlashcards(questions, params) {
  const cardCount = params.cardCount ? Math.min(parseInt(params.cardCount), questions.length) : questions.length;
  const selectedQuestions = questions.slice(0, cardCount);
  
  let content = `# Flashcards: ${params.topic || 'Practice'}\n\n`;
  content += `**Subject:** ${params.subject || 'General'}\n`;
  content += `**Class:** ${params.classNumber || 'N/A'}\n`;
  if (params.subTopic) {
    content += `**Sub Topic:** ${params.subTopic}\n`;
  }
  content += `**Total Cards:** ${cardCount}\n\n`;
  content += `---\n\n`;
  
  selectedQuestions.forEach((q, index) => {
    content += `## Flashcard ${index + 1}\n\n`;
    content += `### Front:\n\n`;
    content += `${q.Question || q.question || ''}\n\n`;
    
    if (q.Option_A || q.option_a) {
      content += `**Options:**\n`;
      content += `- A) ${q.Option_A || q.option_a}\n`;
      content += `- B) ${q.Option_B || q.option_b}\n`;
      content += `- C) ${q.Option_C || q.option_c}\n`;
      content += `- D) ${q.Option_D || q.option_d}\n\n`;
    }
    
    content += `### Back:\n\n`;
    content += `**Answer:** ${q.Answer || q.answer || 'N/A'}\n\n`;
    content += `---\n\n`;
  });
  
  return content;
}

/**
 * Generate Homework format
 */
function generateHomework(questions, params) {
  const expectedDuration = params.duration || 30;
  let content = `# Homework Assignment\n\n`;
  content += `**Subject:** ${params.subject || 'General'}\n`;
  content += `**Class:** ${params.classNumber || 'N/A'}\n`;
  content += `**Topic:** ${params.topic || 'N/A'}\n`;
  if (params.subTopic) {
    content += `**Sub Topic:** ${params.subTopic}\n`;
  }
  content += `**Expected Duration:** ${expectedDuration} minutes\n`;
  content += `**Total Questions:** ${questions.length}\n`;
  content += `**Due Date:** ${params.dueDate || 'To be announced'}\n\n`;
  content += `---\n\n`;
  content += `## Instructions\n\n`;
  content += `Please complete the following questions. Show all your work and reasoning.\n`;
  content += `Submit your completed homework by the due date.\n\n`;
  content += `---\n\n`;
  
  questions.forEach((q, index) => {
    content += `### Question ${index + 1}\n\n`;
    content += `${q.Question || q.question || ''}\n\n`;
    
    if (q.Option_A || q.option_a) {
      content += `**A)** ${q.Option_A || q.option_a}\n`;
      content += `**B)** ${q.Option_B || q.option_b}\n`;
      content += `**C)** ${q.Option_C || q.option_c}\n`;
      content += `**D)** ${q.Option_D || q.option_d}\n\n`;
    }
    
    content += `\n`;
  });
  
  // Answer key for teacher reference (can be removed before giving to students)
  content += `\n---\n\n## Answer Key (Teacher Reference)\n\n`;
  questions.forEach((q, index) => {
    const answer = q.Answer || q.answer || 'N/A';
    content += `**Q${index + 1}:** ${answer}\n`;
  });
  
  return content;
}

/**
 * Generate detailed explanation for a question
 */
function generateExplanation(question, concept, subject) {
  const q = question.Question || question.question || '';
  const answer = question.Answer || question.answer || '';
  const optionA = question.Option_A || question.option_a || '';
  const optionB = question.Option_B || question.option_b || '';
  const optionC = question.Option_C || question.option_c || '';
  const optionD = question.Option_D || question.option_d || '';
  
  let explanation = '';
  
  // Extract the correct answer letter and value
  let correctOption = '';
  let correctAnswerValue = answer;
  
  // Check if answer is a letter (A, B, C, D) or contains the actual answer text
  if (answer.trim().length === 1 && ['A', 'B', 'C', 'D', 'a', 'b', 'c', 'd'].includes(answer.trim())) {
    correctOption = answer.trim().toUpperCase();
    // Get the actual answer value from the option
    if (correctOption === 'A') correctAnswerValue = optionA;
    else if (correctOption === 'B') correctAnswerValue = optionB;
    else if (correctOption === 'C') correctAnswerValue = optionC;
    else if (correctOption === 'D') correctAnswerValue = optionD;
  } else {
    // Answer contains the actual text, find which option matches
    if (optionA && (answer.includes(optionA) || optionA.includes(answer) || answer.toLowerCase() === optionA.toLowerCase())) {
      correctOption = 'A';
      correctAnswerValue = optionA;
    } else if (optionB && (answer.includes(optionB) || optionB.includes(answer) || answer.toLowerCase() === optionB.toLowerCase())) {
      correctOption = 'B';
      correctAnswerValue = optionB;
    } else if (optionC && (answer.includes(optionC) || optionC.includes(answer) || answer.toLowerCase() === optionC.toLowerCase())) {
      correctOption = 'C';
      correctAnswerValue = optionC;
    } else if (optionD && (answer.includes(optionD) || optionD.includes(answer) || answer.toLowerCase() === optionD.toLowerCase())) {
      correctOption = 'D';
      correctAnswerValue = optionD;
    }
  }
  
  // Generate detailed explanation based on question content and concept
  const qLower = q.toLowerCase();
  const conceptLower = concept.toLowerCase();
  
  // States of Matter specific explanations
  if (conceptLower.includes('state') || conceptLower.includes('matter')) {
    if (qLower.includes('fixed volume') || qLower.includes('volume')) {
      if (correctAnswerValue.toLowerCase().includes('solid')) {
        explanation = `**Solid** is the correct answer because solids have a fixed volume and fixed shape. `;
        explanation += `The particles in a solid are tightly packed in a regular arrangement, which prevents them from moving freely. `;
        explanation += `This is why solids maintain their shape and volume regardless of the container they're placed in. `;
        if (optionB && optionB.toLowerCase().includes('liquid')) {
          explanation += `Liquids have a fixed volume but not a fixed shape (they take the shape of their container). `;
        }
        if (optionC && optionC.toLowerCase().includes('gas')) {
          explanation += `Gases have neither fixed volume nor fixed shape.`;
        }
      } else if (correctAnswerValue.toLowerCase().includes('liquid')) {
        explanation = `**Liquid** is correct because liquids have a fixed volume but not a fixed shape. `;
        explanation += `The particles in a liquid are close together but can move past each other, allowing liquids to flow and take the shape of their container. `;
        explanation += `However, the volume remains constant because the particles are still relatively close together.`;
      }
    } else if (qLower.includes('shape') || qLower.includes('fixed shape')) {
      explanation = `**${correctAnswerValue}** is correct because in the context of **${concept}**, this state has the characteristic described in the question. `;
      explanation += `Solids have both fixed shape and volume, liquids have fixed volume but not fixed shape, and gases have neither. `;
      explanation += `This fundamental property helps distinguish between the three states of matter.`;
    } else if (qLower.includes('particle') || qLower.includes('molecule')) {
      explanation = `**${correctAnswerValue}** is the correct answer because it accurately describes the particle arrangement in **${concept}**. `;
      explanation += `The behavior and arrangement of particles (atoms or molecules) determine the properties of each state of matter. `;
      explanation += `Understanding particle behavior is key to mastering **${concept}**.`;
    } else {
      explanation = `**${correctAnswerValue}** is correct because it represents a fundamental property of **${concept}**. `;
      explanation += `In the study of states of matter, we learn that solids, liquids, and gases each have distinct characteristics. `;
      explanation += `${correctAnswerValue} is the accurate answer based on the scientific principles of **${concept}**.`;
    }
  }
  // Temperature and phase change questions
  else if (qLower.includes('temperature') || qLower.includes('point') || qLower.includes('melting') || qLower.includes('boiling') || qLower.includes('freezing')) {
    if (answer.includes('°C') || answer.includes('°F') || answer.includes('K') || answer.match(/\d+/)) {
      explanation = `The correct answer is **${answer}** because this is the scientifically established value for this property. `;
      if (qLower.includes('melting') && answer.includes('0')) {
        explanation += `The melting point of ice (solid water) is 0°C at standard atmospheric pressure. `;
        explanation += `At this temperature, ice changes from solid to liquid state.`;
      } else if (qLower.includes('boiling') && (answer.includes('100') || answer.includes('373'))) {
        explanation += `The boiling point of water is 100°C (373 K) at standard atmospheric pressure. `;
        explanation += `At this temperature, liquid water changes to water vapor (gas).`;
      } else {
        explanation += `This value is a fundamental constant in the study of **${concept}** and is determined through careful scientific measurement.`;
      }
    } else {
      explanation = `**${correctAnswerValue}** is correct because it accurately represents the temperature or condition described in **${concept}**. `;
      explanation += `Temperature plays a crucial role in phase changes and state transitions in matter.`;
    }
  }
  // "Which" or "What" questions - provide specific reasoning
  else if (qLower.includes('which') || qLower.includes('what')) {
    explanation = `**${correctAnswerValue}** is the correct answer because it specifically matches the criteria described in the question about **${concept}**. `;
    
    // Provide specific reasoning based on the answer
    if (correctOption && optionA && optionB && optionC && optionD) {
      explanation += `\n\n**Why this answer is correct:**\n`;
      explanation += `- ${correctAnswerValue} directly addresses the question about **${concept}**\n`;
      explanation += `- It aligns with the fundamental principles of **${concept}**\n`;
      
      // Explain why other options are wrong
      const wrongOptions = [];
      if (correctOption !== 'A' && optionA) wrongOptions.push({ letter: 'A', value: optionA });
      if (correctOption !== 'B' && optionB) wrongOptions.push({ letter: 'B', value: optionB });
      if (correctOption !== 'C' && optionC) wrongOptions.push({ letter: 'C', value: optionC });
      if (correctOption !== 'D' && optionD) wrongOptions.push({ letter: 'D', value: optionD });
      
      if (wrongOptions.length > 0) {
        explanation += `\n**Why other options are incorrect:**\n`;
        wrongOptions.forEach(opt => {
          explanation += `- Option ${opt.letter} (${opt.value}) does not match the criteria or represents a different aspect of **${concept}**\n`;
        });
      }
    }
  }
  // "Why" or explanation questions
  else if (qLower.includes('why') || qLower.includes('explain') || qLower.includes('reason')) {
    explanation = `**${correctAnswerValue}** is correct because it provides the scientific reasoning related to **${concept}**. `;
    explanation += `This answer demonstrates the cause-and-effect relationship or underlying principle that governs **${concept}**. `;
    explanation += `Understanding this connection helps you see how different aspects of **${concept}** are interrelated.`;
  }
  // Calculation or "how" questions
  else if (qLower.includes('how') || qLower.includes('calculate') || qLower.includes('find') || qLower.includes('solve')) {
    explanation = `To answer this question about **${concept}**, the correct answer is **${answer}**. `;
    explanation += `This requires applying the key principles and formulas related to **${concept}**. `;
    explanation += `The solution involves understanding the relationship between different variables in **${concept}**.`;
  }
  // Default - provide contextual explanation
  else {
    explanation = `**${correctAnswerValue}** is the correct answer because it accurately represents a key aspect of **${concept}**. `;
    
    if (correctOption && optionA && optionB && optionC && optionD) {
      const wrongOptions = [];
      if (correctOption !== 'A' && optionA) wrongOptions.push(`A (${optionA})`);
      if (correctOption !== 'B' && optionB) wrongOptions.push(`B (${optionB})`);
      if (correctOption !== 'C' && optionC) wrongOptions.push(`C (${optionC})`);
      if (correctOption !== 'D' && optionD) wrongOptions.push(`D (${optionD})`);
      
      if (wrongOptions.length > 0) {
        explanation += `\n\nThe other options ${wrongOptions.join(', ')} are incorrect because:\n`;
        explanation += `- They represent different concepts or properties\n`;
        explanation += `- They don't apply to the specific question about **${concept}**\n`;
        explanation += `- They may contain factual errors or misconceptions\n`;
      }
    }
    
    explanation += `\n\n**Key Takeaway:** Understanding why **${correctAnswerValue}** is correct helps you build a solid foundation in **${concept}**. `;
    explanation += `This knowledge connects to broader principles in ${subject || 'this subject'}.`;
  }
  
  return explanation;
}

/**
 * Generate Concept Mastery format
 */
function generateConceptMastery(questions, params) {
  const concept = params.concept || params.topic || 'Topic';
  const subject = params.subject || 'General';
  let content = `# Concept Mastery Guide: ${concept}\n\n`;
  content += `**Subject:** ${subject}\n`;
  content += `**Class:** ${params.classNumber || 'N/A'}\n`;
  if (params.subTopic) {
    content += `**Sub Topic:** ${params.subTopic}\n`;
  }
  content += `\n---\n\n`;
  content += `## Overview\n\n`;
  content += `This guide helps you master the concept of **${concept}** through structured practice questions and detailed explanations.\n\n`;
  content += `### Learning Path\n`;
  content += `1. **Understand** the core concept\n`;
  content += `2. **Practice** with guided questions\n`;
  content += `3. **Apply** knowledge to solve problems\n`;
  content += `4. **Master** through repeated practice\n\n`;
  content += `---\n\n`;
  content += `## Concept Breakdown\n\n`;
  content += `### Key Concepts\n`;
  content += `- Core principles of **${concept}**\n`;
  content += `- Important relationships and patterns\n`;
  content += `- Common applications and examples\n\n`;
  content += `---\n\n`;
  content += `## Practice Questions with Detailed Explanations\n\n`;
  
  questions.forEach((q, index) => {
    content += `### Concept Check ${index + 1}\n\n`;
    content += `**Question:** ${q.Question || q.question || ''}\n\n`;
    
    if (q.Option_A || q.option_a) {
      content += `**Options:**\n`;
      content += `- A) ${q.Option_A || q.option_a}\n`;
      content += `- B) ${q.Option_B || q.option_b}\n`;
      content += `- C) ${q.Option_C || q.option_c}\n`;
      content += `- D) ${q.Option_D || q.option_d}\n\n`;
    }
    
    content += `**Correct Answer:** ${q.Answer || q.answer || 'N/A'}\n\n`;
    content += `**Explanation:**\n\n`;
    
    // Generate detailed explanation
    const explanation = generateExplanation(q, concept, subject);
    content += explanation;
    
    content += `\n\n`;
    content += `---\n\n`;
  });
  
  content += `## Summary\n\n`;
  content += `Continue practicing with these questions to master **${concept}**. `;
  content += `Focus on understanding the reasoning behind each answer and how it relates to the core principles of **${concept}**.\n\n`;
  
  return content;
}

/**
 * Generate Short Notes format
 */
function generateShortNotes(questions, params) {
  let content = `# Short Notes: ${params.topic || 'Topic'}\n\n`;
  content += `**Subject:** ${params.subject || 'General'}\n`;
  content += `**Class:** ${params.classNumber || 'N/A'}\n`;
  if (params.subTopic) {
    content += `**Sub Topic:** ${params.subTopic}\n`;
  }
  content += `\n---\n\n`;
  content += `## Key Concepts & Points\n\n`;
  
  // Use first 10-15 questions as key points
  const keyPointsCount = Math.min(15, questions.length);
  const keyPoints = questions.slice(0, keyPointsCount);
  
  keyPoints.forEach((q, index) => {
    // Extract concept from question (first sentence or main idea)
    const questionText = q.Question || q.question || '';
    const concept = questionText.split('.')[0] || questionText.split('?')[0] || questionText;
    content += `### ${index + 1}. ${concept.substring(0, 100)}${concept.length > 100 ? '...' : ''}\n\n`;
    if (q.Answer || q.answer) {
      content += `**Key Point:** ${q.Answer || q.answer}\n\n`;
    }
  });
  
  content += `---\n\n`;
  content += `## Quick Review Questions\n\n`;
  
  // Use remaining questions for review
  const reviewQuestions = questions.slice(keyPointsCount);
  if (reviewQuestions.length > 0) {
    reviewQuestions.forEach((q, index) => {
      content += `${index + 1}. ${q.Question || q.question || ''}\n`;
      content += `   **Answer:** ${q.Answer || q.answer || 'N/A'}\n\n`;
    });
  } else {
    // If no remaining questions, use all questions as review
    questions.forEach((q, index) => {
      content += `${index + 1}. ${q.Question || q.question || ''}\n`;
      content += `   **Answer:** ${q.Answer || q.answer || 'N/A'}\n\n`;
    });
  }
  
  return content;
}

/**
 * Generate Activity/Project format
 */
function generateActivityProject(questions, params) {
  let content = `# Activity/Project: ${params.topic || 'Topic'}\n\n`;
  content += `**Subject:** ${params.subject || 'General'}\n`;
  content += `**Class:** ${params.classNumber || 'N/A'}\n`;
  if (params.subTopic) {
    content += `**Sub Topic:** ${params.subTopic}\n`;
  }
  if (params.className) {
    content += `**Section:** ${params.className}\n`;
  }
  content += `\n---\n\n`;
  content += `## Activity Description\n\n`;
  content += `This activity is designed to help students understand **${params.topic || 'this topic'}** through hands-on practice and engagement.\n\n`;
  content += `### Learning Goals\n`;
  content += `- Develop understanding of key concepts\n`;
  content += `- Apply knowledge through practical tasks\n`;
  content += `- Enhance problem-solving skills\n\n`;
  content += `### Materials Needed\n`;
  content += `- Textbook/Reference materials\n`;
  content += `- Writing materials\n`;
  content += `- Calculator (if applicable)\n\n`;
  content += `---\n\n`;
  content += `## Activity Tasks\n\n`;
  
  questions.forEach((q, index) => {
    content += `### Task ${index + 1}\n\n`;
    content += `${q.Question || q.question || ''}\n\n`;
    
    if (q.Option_A || q.option_a) {
      content += `**Options:**\n`;
      content += `- A) ${q.Option_A || q.option_a}\n`;
      content += `- B) ${q.Option_B || q.option_b}\n`;
      content += `- C) ${q.Option_C || q.option_c}\n`;
      content += `- D) ${q.Option_D || q.option_d}\n\n`;
    }
    
    content += `**Expected Answer:** ${q.Answer || q.answer || 'N/A'}\n\n`;
  });
  
  content += `---\n\n`;
  content += `## Assessment Criteria\n\n`;
  content += `- Completion of all tasks: 40%\n`;
  content += `- Accuracy of answers: 40%\n`;
  content += `- Presentation and clarity: 20%\n\n`;
  
  return content;
}

/**
 * Generate Lesson Plan format
 */
function generateLessonPlan(questions, params) {
  const duration = params.duration || 90;
  const timePerQuestion = Math.floor(duration / Math.max(questions.length, 1));
  
  let content = `# Lesson Plan: ${params.topic || 'Topic'}\n\n`;
  content += `**Subject:** ${params.subject || 'General'}\n`;
  content += `**Class:** ${params.classNumber || 'N/A'}\n`;
  if (params.subTopic) {
    content += `**Sub Topic:** ${params.subTopic}\n`;
  }
  content += `**Duration:** ${duration} minutes\n`;
  content += `**Total Questions:** ${questions.length}\n\n`;
  content += `---\n\n`;
  content += `## Learning Objectives\n\n`;
  content += `By the end of this lesson, students will be able to:\n`;
  content += `- Understand key concepts related to **${params.topic || 'this topic'}**\n`;
  content += `- Solve practice problems independently\n`;
  content += `- Apply knowledge to new situations\n`;
  content += `- Demonstrate mastery through assessment\n\n`;
  content += `---\n\n`;
  content += `## Lesson Structure\n\n`;
  content += `### Introduction (10 minutes)\n`;
  content += `- Review previous concepts\n`;
  content += `- Introduce the topic: **${params.topic || 'Topic'}**\n`;
  content += `- Set learning objectives\n\n`;
  content += `### Main Activity (${Math.floor(duration * 0.6)} minutes)\n`;
  content += `- Guided practice with questions\n`;
  content += `- Independent problem-solving\n\n`;
  content += `### Practice Questions\n\n`;
  
  questions.forEach((q, index) => {
    content += `#### Question ${index + 1}\n\n`;
    content += `${q.Question || q.question || ''}\n\n`;
    
    if (q.Option_A || q.option_a) {
      content += `**A)** ${q.Option_A || q.option_a}\n`;
      content += `**B)** ${q.Option_B || q.option_b}\n`;
      content += `**C)** ${q.Option_C || q.option_c}\n`;
      content += `**D)** ${q.Option_D || q.option_d}\n\n`;
    }
    
    content += `**Answer:** ${q.Answer || q.answer || 'N/A'}\n\n`;
  });
  
  content += `### Wrap-up (10 minutes)\n`;
  content += `- Review key concepts\n`;
  content += `- Address questions and clarifications\n`;
  content += `- Assign homework if applicable\n\n`;
  
  return content;
}

/**
 * Generate Daily Class Plan format
 */
function generateDailyClassPlan(questions, params) {
  const date = params.date || new Date().toLocaleDateString();
  const subjects = params.subjects || params.subject || 'General';
  const timeSlots = params.timeSlots || '9:00-10:00, 10:15-11:15';
  
  let content = `# Daily Class Plan\n\n`;
  content += `**Date:** ${date}\n`;
  content += `**Class:** ${params.classNumber || 'N/A'}\n`;
  content += `**Subjects:** ${subjects}\n`;
  if (params.subTopic) {
    content += `**Sub Topic:** ${params.subTopic}\n`;
  }
  content += `**Time Slots:** ${timeSlots}\n\n`;
  content += `---\n\n`;
  content += `## Class Schedule\n\n`;
  content += `### Warm-up (5-10 minutes)\n`;
  content += `- Review previous concepts\n`;
  content += `- Quick recap of homework\n`;
  content += `- Set agenda for today's class\n\n`;
  content += `### Main Activity (30-40 minutes)\n`;
  content += `**Topic:** ${params.topic || 'Current Topic'}\n\n`;
  content += `Practice questions:\n\n`;
  
  questions.slice(0, Math.min(10, questions.length)).forEach((q, index) => {
    content += `${index + 1}. ${q.Question || q.question || ''}\n`;
  });
  
  content += `\n### Practice Session\n\n`;
  questions.forEach((q, index) => {
    content += `**Q${index + 1}:** ${q.Question || q.question || ''}\n`;
    content += `   **Answer:** ${q.Answer || q.answer || 'N/A'}\n\n`;
  });
  
  content += `### Wrap-up (10 minutes)\n`;
  content += `- Review answers and solutions\n`;
  content += `- Address student questions\n`;
  content += `- Assign homework\n`;
  content += `- Preview next lesson\n\n`;
  
  return content;
}

/**
 * Generate Rubrics format
 */
function generateRubrics(questions, params) {
  const outputType = params.outputType || 'Rubrics & Evaluation';
  const isReportCard = outputType === 'Report Card';
  
  if (isReportCard) {
    // Generate Report Card format
    let content = `# Report Card\n\n`;
    content += `**Student Name:** ${params.studentName || 'Student Name'}\n`;
    content += `**Class:** ${params.classNumber || 'N/A'}\n`;
    content += `**Subject:** ${params.subject || 'General'}\n`;
    if (params.term) {
      content += `**Term:** ${params.term}\n`;
    }
    content += `**Date:** ${new Date().toLocaleDateString()}\n\n`;
    content += `---\n\n`;
    content += `## Academic Performance\n\n`;
    content += `### Subject: ${params.subject || 'General'}\n\n`;
    content += `**Overall Grade:** To be determined\n\n`;
    content += `### Assessment Breakdown\n\n`;
    content += `- **Knowledge & Understanding:** Based on performance\n`;
    content += `- **Application Skills:** Based on problem-solving\n`;
    content += `- **Analysis & Reasoning:** Based on critical thinking\n`;
    content += `- **Communication:** Based on clarity of responses\n\n`;
    content += `---\n\n`;
    content += `## Sample Assessment Questions\n\n`;
    
    questions.slice(0, Math.min(10, questions.length)).forEach((q, index) => {
      content += `${index + 1}. ${q.Question || q.question || ''}\n`;
      content += `   **Answer:** ${q.Answer || q.answer || 'N/A'}\n\n`;
    });
    
    content += `---\n\n`;
    content += `## Teacher Comments\n\n`;
    content += `*Comments to be filled by teacher*\n\n`;
    content += `## Recommendations\n\n`;
    content += `*Recommendations for improvement*\n\n`;
    
    return content;
  } else {
    // Generate Rubrics & Evaluation format
    let content = `# Assessment Rubric: ${params.topic || params.assignmentType || 'Assignment'}\n\n`;
    content += `**Subject:** ${params.subject || 'General'}\n`;
    content += `**Class:** ${params.classNumber || 'N/A'}\n`;
    if (params.assignmentType) {
      content += `**Assignment Type:** ${params.assignmentType}\n`;
    }
    if (params.subTopic) {
      content += `**Sub Topic:** ${params.subTopic}\n`;
    }
    content += `\n---\n\n`;
    content += `## Evaluation Criteria\n\n`;
    content += `### Knowledge & Understanding (40%)\n`;
    content += `- **Excellent (36-40%):** Demonstrates comprehensive understanding of key concepts\n`;
    content += `- **Good (28-35%):** Shows good understanding with minor gaps\n`;
    content += `- **Satisfactory (20-27%):** Basic understanding demonstrated\n`;
    content += `- **Needs Improvement (<20%):** Limited understanding shown\n\n`;
    content += `### Application (30%)\n`;
    content += `- **Excellent (27-30%):** Successfully applies knowledge to solve complex problems\n`;
    content += `- **Good (21-26%):** Applies knowledge to solve standard problems\n`;
    content += `- **Satisfactory (15-20%):** Basic application skills demonstrated\n`;
    content += `- **Needs Improvement (<15%):** Struggles with application\n\n`;
    content += `### Analysis (20%)\n`;
    content += `- **Excellent (18-20%):** Excellent analytical and reasoning skills\n`;
    content += `- **Good (14-17%):** Good analytical skills with minor errors\n`;
    content += `- **Satisfactory (10-13%):** Basic analytical skills\n`;
    content += `- **Needs Improvement (<10%):** Limited analytical ability\n\n`;
    content += `### Communication (10%)\n`;
    content += `- **Excellent (9-10%):** Clear, well-organized responses\n`;
    content += `- **Good (7-8%):** Generally clear responses\n`;
    content += `- **Satisfactory (5-6%):** Adequate communication\n`;
    content += `- **Needs Improvement (<5%):** Unclear or disorganized responses\n\n`;
    content += `---\n\n`;
    content += `## Sample Questions for Assessment\n\n`;
    
    questions.forEach((q, index) => {
      content += `### Question ${index + 1}\n\n`;
      content += `${q.Question || q.question || ''}\n\n`;
      if (q.Option_A || q.option_a) {
        content += `**Options:**\n`;
        content += `- A) ${q.Option_A || q.option_a}\n`;
        content += `- B) ${q.Option_B || q.option_b}\n`;
        content += `- C) ${q.Option_C || q.option_c}\n`;
        content += `- D) ${q.Option_D || q.option_d}\n\n`;
      }
      content += `**Correct Answer:** ${q.Answer || q.answer || 'N/A'}\n\n`;
    });
    
    return content;
  }
}

/**
 * Generate Story/Passage format
 */
function generateStoryPassage(questions, params) {
  const length = params.length || 'medium';
  const passageLength = length === 'short' ? 5 : length === 'long' ? 15 : 10;
  const selectedQuestions = questions.slice(0, Math.min(passageLength, questions.length));
  
  let content = `# Reading Passage: ${params.topic || 'Topic'}\n\n`;
  content += `**Subject:** ${params.subject || 'General'}\n`;
  content += `**Class:** ${params.classNumber || 'N/A'}\n`;
  if (params.subTopic) {
    content += `**Sub Topic:** ${params.subTopic}\n`;
  }
  content += `**Length:** ${length}\n\n`;
  content += `---\n\n`;
  content += `## Passage\n\n`;
  content += `Read the following passage and answer the comprehension questions based on your understanding of **${params.topic || 'this topic'}**.\n\n`;
  content += `### Introduction\n\n`;
  content += `This passage explores the key concepts and ideas related to **${params.topic || 'this topic'}**. Pay attention to the main ideas, supporting details, and relationships between concepts.\n\n`;
  content += `---\n\n`;
  content += `## Comprehension Questions\n\n`;
  
  selectedQuestions.forEach((q, index) => {
    content += `### Question ${index + 1}\n\n`;
    content += `${q.Question || q.question || ''}\n\n`;
    
    if (q.Option_A || q.option_a) {
      content += `**A)** ${q.Option_A || q.option_a}\n`;
      content += `**B)** ${q.Option_B || q.option_b}\n`;
      content += `**C)** ${q.Option_C || q.option_c}\n`;
      content += `**D)** ${q.Option_D || q.option_d}\n\n`;
    }
    
    content += `\n`;
  });
  
  content += `---\n\n`;
  content += `## Answer Key\n\n`;
  selectedQuestions.forEach((q, index) => {
    const answer = q.Answer || q.answer || 'N/A';
    content += `**Q${index + 1}:** ${answer}\n`;
  });
  
  return content;
}

/**
 * Main function to generate content from CSV
 */
export function generateContentFromCSV(classNumber, subject, topic, toolType, params = {}) {
  try {
    // Read questions from CSV
    const questions = readQuestionsFromCSV(classNumber, subject, topic);
    
    if (!questions || questions.length === 0) {
      throw new Error(`No questions found in CSV file for topic: ${topic}`);
    }
    
    // Transform questions based on tool type
    const content = transformQuestionsForTool(questions, toolType, {
      ...params,
      classNumber,
      subject,
      topic
    });
    
    return content;
  } catch (error) {
    console.error('Error generating content from CSV:', error);
    throw error;
  }
}

