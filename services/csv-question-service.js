import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to CSV files - check backend folder first (for Railway), then client folder (for local dev)
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
    // The CSV parser will split these, so we need to reconstruct them
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    
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
function transformQuestionsForTool(questions, toolType, params = {}) {
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
  let content = `# Worksheet: ${params.topic || 'Practice Questions'}\n\n`;
  content += `**Subject:** ${params.subject || 'General'}\n`;
  content += `**Class:** ${params.classNumber || 'N/A'}\n`;
  content += `**Date:** ${new Date().toLocaleDateString()}\n\n`;
  content += `---\n\n`;
  
  questions.forEach((q, index) => {
    content += `## Question ${index + 1}\n\n`;
    content += `${q.Question || q.question || ''}\n\n`;
    
    if (q.Option_A || q.option_a) {
      content += `**A)** ${q.Option_A || q.option_a}\n`;
      content += `**B)** ${q.Option_B || q.option_b}\n`;
      content += `**C)** ${q.Option_C || q.option_c}\n`;
      content += `**D)** ${q.Option_D || q.option_d}\n\n`;
    }
    
    content += `**Answer:** ${q.Answer || q.answer || 'N/A'}\n\n`;
    content += `---\n\n`;
  });
  
  return content;
}

/**
 * Generate Exam Paper format
 */
function generateExamPaper(questions, params) {
  const { timeLimit = 60, totalMarks = 100 } = params;
  const marksPerQuestion = Math.floor(totalMarks / questions.length);
  
  let content = `# Examination Paper\n\n`;
  content += `**Subject:** ${params.subject || 'General'}\n`;
  content += `**Class:** ${params.classNumber || 'N/A'}\n`;
  content += `**Topic:** ${params.topic || 'N/A'}\n`;
  content += `**Time:** ${timeLimit} minutes\n`;
  content += `**Total Marks:** ${totalMarks}\n\n`;
  content += `---\n\n`;
  content += `## Instructions\n\n`;
  content += `1. Answer all questions.\n`;
  content += `2. Each question carries ${marksPerQuestion} marks.\n`;
  content += `3. Write clearly and legibly.\n\n`;
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
    content += `**Q${index + 1}:** ${q.Answer || q.answer || 'N/A'}\n`;
  });
  
  return content;
}

/**
 * Generate Flashcards format
 */
function generateFlashcards(questions, params) {
  let content = `# Flashcards: ${params.topic || 'Practice'}\n\n`;
  content += `**Subject:** ${params.subject || 'General'}\n`;
  content += `**Class:** ${params.classNumber || 'N/A'}\n\n`;
  content += `---\n\n`;
  
  questions.forEach((q, index) => {
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
  let content = `# Homework Assignment\n\n`;
  content += `**Subject:** ${params.subject || 'General'}\n`;
  content += `**Class:** ${params.classNumber || 'N/A'}\n`;
  content += `**Topic:** ${params.topic || 'N/A'}\n`;
  content += `**Due Date:** ${params.dueDate || 'To be announced'}\n\n`;
  content += `---\n\n`;
  content += `## Instructions\n\n`;
  content += `Please complete the following questions. Show all your work.\n\n`;
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
  
  return content;
}

/**
 * Generate Concept Mastery format
 */
function generateConceptMastery(questions, params) {
  let content = `# Concept Mastery Guide: ${params.topic || 'Topic'}\n\n`;
  content += `**Subject:** ${params.subject || 'General'}\n`;
  content += `**Class:** ${params.classNumber || 'N/A'}\n\n`;
  content += `---\n\n`;
  content += `## Overview\n\n`;
  content += `This guide helps you master the concept of **${params.topic || 'this topic'}** through structured practice questions.\n\n`;
  content += `---\n\n`;
  
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
    content += `**Explanation:** Review the concept and understand why this is the correct answer.\n\n`;
    content += `---\n\n`;
  });
  
  return content;
}

/**
 * Generate Short Notes format
 */
function generateShortNotes(questions, params) {
  let content = `# Short Notes: ${params.topic || 'Topic'}\n\n`;
  content += `**Subject:** ${params.subject || 'General'}\n`;
  content += `**Class:** ${params.classNumber || 'N/A'}\n\n`;
  content += `---\n\n`;
  
  // Group questions by concepts
  const keyPoints = questions.slice(0, Math.min(10, questions.length)).map((q, index) => {
    return `**Key Point ${index + 1}:** ${q.Question || q.question || ''}\n`;
  });
  
  content += `## Key Points\n\n`;
  content += keyPoints.join('\n');
  content += `\n---\n\n`;
  content += `## Quick Review Questions\n\n`;
  
  questions.slice(10).forEach((q, index) => {
    content += `${index + 1}. ${q.Question || q.question || ''}\n`;
    content += `   **Answer:** ${q.Answer || q.answer || 'N/A'}\n\n`;
  });
  
  return content;
}

/**
 * Generate Activity/Project format
 */
function generateActivityProject(questions, params) {
  let content = `# Activity/Project: ${params.topic || 'Topic'}\n\n`;
  content += `**Subject:** ${params.subject || 'General'}\n`;
  content += `**Class:** ${params.classNumber || 'N/A'}\n\n`;
  content += `---\n\n`;
  content += `## Activity Description\n\n`;
  content += `This activity is designed to help students understand **${params.topic || 'this topic'}** through hands-on practice.\n\n`;
  content += `---\n\n`;
  content += `## Practice Questions\n\n`;
  
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
  
  return content;
}

/**
 * Generate Lesson Plan format
 */
function generateLessonPlan(questions, params) {
  let content = `# Lesson Plan: ${params.topic || 'Topic'}\n\n`;
  content += `**Subject:** ${params.subject || 'General'}\n`;
  content += `**Class:** ${params.classNumber || 'N/A'}\n`;
  content += `**Duration:** ${params.duration || '45 minutes'}\n\n`;
  content += `---\n\n`;
  content += `## Learning Objectives\n\n`;
  content += `By the end of this lesson, students will be able to:\n`;
  content += `- Understand key concepts related to ${params.topic || 'this topic'}\n`;
  content += `- Solve practice problems\n`;
  content += `- Apply knowledge to new situations\n\n`;
  content += `---\n\n`;
  content += `## Practice Questions\n\n`;
  
  questions.forEach((q, index) => {
    content += `### Question ${index + 1}\n\n`;
    content += `${q.Question || q.question || ''}\n\n`;
    
    if (q.Option_A || q.option_a) {
      content += `**A)** ${q.Option_A || q.option_a}\n`;
      content += `**B)** ${q.Option_B || q.option_b}\n`;
      content += `**C)** ${q.Option_C || q.option_c}\n`;
      content += `**D)** ${q.Option_D || q.option_d}\n\n`;
    }
    
    content += `**Answer:** ${q.Answer || q.answer || 'N/A'}\n\n`;
  });
  
  return content;
}

/**
 * Generate Daily Class Plan format
 */
function generateDailyClassPlan(questions, params) {
  let content = `# Daily Class Plan: ${params.topic || 'Topic'}\n\n`;
  content += `**Subject:** ${params.subject || 'General'}\n`;
  content += `**Class:** ${params.classNumber || 'N/A'}\n`;
  content += `**Date:** ${new Date().toLocaleDateString()}\n\n`;
  content += `---\n\n`;
  content += `## Class Activities\n\n`;
  content += `### Warm-up (5 minutes)\n`;
  content += `Review previous concepts.\n\n`;
  content += `### Main Activity (30 minutes)\n`;
  content += `Practice questions on ${params.topic || 'this topic'}:\n\n`;
  
  questions.forEach((q, index) => {
    content += `${index + 1}. ${q.Question || q.question || ''}\n`;
    content += `   Answer: ${q.Answer || q.answer || 'N/A'}\n\n`;
  });
  
  content += `### Wrap-up (10 minutes)\n`;
  content += `Review answers and clarify doubts.\n\n`;
  
  return content;
}

/**
 * Generate Rubrics format
 */
function generateRubrics(questions, params) {
  let content = `# Assessment Rubric: ${params.topic || 'Topic'}\n\n`;
  content += `**Subject:** ${params.subject || 'General'}\n`;
  content += `**Class:** ${params.classNumber || 'N/A'}\n\n`;
  content += `---\n\n`;
  content += `## Evaluation Criteria\n\n`;
  content += `### Knowledge & Understanding (40%)\n`;
  content += `- Correct answers to factual questions\n`;
  content += `- Understanding of key concepts\n\n`;
  content += `### Application (30%)\n`;
  content += `- Ability to apply knowledge to solve problems\n\n`;
  content += `### Analysis (20%)\n`;
  content += `- Ability to analyze and reason\n\n`;
  content += `### Communication (10%)\n`;
  content += `- Clarity of responses\n\n`;
  content += `---\n\n`;
  content += `## Sample Questions for Assessment\n\n`;
  
  questions.forEach((q, index) => {
    content += `**Question ${index + 1}:** ${q.Question || q.question || ''}\n`;
    content += `**Correct Answer:** ${q.Answer || q.answer || 'N/A'}\n\n`;
  });
  
  return content;
}

/**
 * Generate Story/Passage format
 */
function generateStoryPassage(questions, params) {
  let content = `# Reading Passage: ${params.topic || 'Topic'}\n\n`;
  content += `**Subject:** ${params.subject || 'General'}\n`;
  content += `**Class:** ${params.classNumber || 'N/A'}\n\n`;
  content += `---\n\n`;
  content += `## Passage\n\n`;
  content += `Read the following questions and answer them based on your understanding of **${params.topic || 'this topic'}**.\n\n`;
  content += `---\n\n`;
  content += `## Comprehension Questions\n\n`;
  
  questions.forEach((q, index) => {
    content += `### Question ${index + 1}\n\n`;
    content += `${q.Question || q.question || ''}\n\n`;
    
    if (q.Option_A || q.option_a) {
      content += `**A)** ${q.Option_A || q.option_a}\n`;
      content += `**B)** ${q.Option_B || q.option_b}\n`;
      content += `**C)** ${q.Option_C || q.option_c}\n`;
      content += `**D)** ${q.Option_D || q.option_d}\n\n`;
    }
    
    content += `**Answer:** ${q.Answer || q.answer || 'N/A'}\n\n`;
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

