// Hardcoded Content Service - Reads pre-generated content from Asli hardcoding folder
// Supports multiple classes (Class 5, 6, 7, 8, 9, 10)

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Base path to hardcoded content folder
const HARDCODED_ROOT = path.join(__dirname, '../../Asli hardcoding');

/**
 * Get the base path for a specific class
 */
function getClassBasePath(classNumber) {
  return path.join(HARDCODED_ROOT, `Class ${classNumber}`);
}

/**
 * Get AMENITY base path
 * AMENITY folder is at root level: Asli hardcoding/AMENITY/
 */
function getAmenityBasePath() {
  return path.join(HARDCODED_ROOT, 'AMENITY');
}

// Tool type mappings
const TOOL_MAPPINGS = {
  // AMENITY tools (JSON format)
  'concept-mastery-helper': { folder: 'AMENITY', filePattern: 'cmh_', format: 'json' },
  'flashcard-generator': { folder: 'AMENITY', filePattern: 'fcm_', format: 'json' },
  'short-notes-summaries-maker': { folder: 'AMENITY', filePattern: 'sns_', format: 'json' },
  
  // Other tools (CSV/JSON format)
  'lesson-planner': { folder: null, filePattern: 'planner.json', format: 'json' },
  'daily-class-plan-maker': { folder: null, filePattern: 'planner.json', format: 'json' },
  'activity-project-generator': { folder: null, filePattern: 'projects.csv', format: 'csv' },
  'story-passage-creator': { folder: null, filePattern: 'passages.csv', format: 'csv' },
  'worksheet-mcq-generator': { folder: 'mcq', filePattern: null, format: 'csv' },
  'exam-question-paper-generator': { folder: 'mcq', filePattern: null, format: 'csv' },
  // Additional question types that can use MCQ folder or specific folders
  'fill-in-blanks': { folder: 'Fill in the blanks', filePattern: null, format: 'csv' },
  'short-answer': { folder: 'short answers', filePattern: null, format: 'csv' },
  'long-answer': { folder: 'long answer', filePattern: null, format: 'csv' },
  'match-following': { folder: 'match the following', filePattern: null, format: 'csv' },
  'true-false': { folder: 'true or false', filePattern: null, format: 'csv' },
};

// Valid subjects (common across all classes)
export const VALID_SUBJECTS = ['English', 'Hindi', 'Maths', 'Science', 'Social Science'];

/**
 * Get available subjects for a class by reading folder structure
 */
export async function getSubjectsForClass(classNumber) {
  try {
    const classPath = getClassBasePath(classNumber);
    
    // Check if class folder exists
    try {
      await fs.access(classPath);
    } catch {
      return []; // Class folder doesn't exist
    }
    
    // Read all folders in the class directory
    const entries = await fs.readdir(classPath, { withFileTypes: true });
    const subjects = entries
      .filter(entry => entry.isDirectory() && entry.name !== 'AMENITY')
      .map(entry => entry.name)
      .filter(name => VALID_SUBJECTS.includes(name) || VALID_SUBJECTS.some(s => s.toLowerCase() === name.toLowerCase()))
      .sort();
    
    return subjects;
  } catch (error) {
    console.error(`Error getting subjects for Class ${classNumber}:`, error);
    return [];
  }
}

// Subject name mappings (for folder names)
const SUBJECT_MAPPINGS = {
  'English': 'English',
  'Hindi': 'Hindi',
  'Mathematics': 'Maths',
  'Maths': 'Maths',
  'Science': 'Science',
  'Social Science': 'Social Science',
};

// AMENITY folder subject mappings (AMENITY uses "Mathematics" not "Maths")
const AMENITY_SUBJECT_MAPPINGS = {
  'English': 'English',
  'Hindi': 'Hindi',
  'Mathematics': 'Mathematics',
  'Maths': 'Mathematics', // Map Maths to Mathematics for AMENITY folder
  'Science': 'Science',
  'Social Science': 'Social Science',
};

// Unit/Topic mappings for AMENITY folder
const UNIT_MAPPINGS = {
  'Hindi': {
    'Unit-1': 'Uniit-1', // Note: typo in folder name
    'Unit-2': 'Unit-2',
    'Unit-3': 'Unit-3',
    'Unit-4': 'Unit-4',
    'Unit-5': 'Unit-5',
    'Unit-6': 'Unit-6',
    'Unit-7': 'Unit-7',
    'Unit-8': 'Unit-8',
    'Unit-9': 'Unit-9',
    'Unit-10': 'Unit-10',
    'Unit-11': 'Unit-11',
    'Unit-12': 'Unit-12',
    'Unit-13': 'Unit-13',
  },
  'Mathematics': {
    'Unit-1': 'Unit-1',
    'Unit-2': 'Unit-2',
    'Unit-3': 'Unit-3',
    'Unit-4': 'Unit-4',
    'Unit-5': 'Unit-5',
    'Unit-6': 'Unit-6',
    'Unit-7': 'Unit-7',
    'Unit-8': 'Unit-8',
    'Unit-9': 'Unit-9',
    'Unit-10': 'Unit-10',
  },
  'Science': {
    'Unit-1': 'Unit-1',
    'Unit-2': 'Unit-2',
    'Unit-3': 'Unit-3',
    'Unit-4': 'Unit-4',
    'Unit-5': 'Unit-5',
    'Unit-6': 'Unit-6',
    'Unit-7': 'Unit-7',
    'Unit-8': 'Unit-8',
    'Unit-9': 'Unit-9',
    'Unit-10': 'Unit-10',
    'Unit-11': 'Unit-11',
    'Unit-12': 'Unit-12',
  },
  'Social Science': {
    'Unit-1': 'Unit-1',
    'Unit-2': 'Unit-2',
    'Unit-3': 'Unit-3',
    'Unit-4': 'Unit-4',
    'Unit-5': 'Unit-5',
    'Unit-6': 'Unit-6',
    'Unit-7': 'Unit-7',
    'Unit-8': 'Unit-8',
    'Unit-9': 'Unit-9',
    'Unit-10': 'Unit-10',
    'Unit-11': 'Unit-11',
    'Unit-12': 'Unit-12',
    'Unit-13': 'Unit-13',
    'Unit-14': 'Unit-14',
  },
};

/**
 * Get lesson number from topic name by reading planner.json
 * Handles both "lessons" and "lesson_plans" array structures
 */
async function getLessonNumberFromTopic(classNumber, subject, topic) {
  try {
    const classBasePath = getClassBasePath(classNumber);
    const subjectFolder = SUBJECT_MAPPINGS[subject] || subject;
    const plannerPath = path.join(classBasePath, subjectFolder, 'planner.json');
    
    // Check if planner.json exists
    try {
      await fs.access(plannerPath);
    } catch {
      return null; // Planner doesn't exist for this subject
    }
    
    const plannerData = await readJSONFile(plannerPath);
    if (!plannerData) {
      return null;
    }
    
    // Handle both "lessons" and "lesson_plans" array structures
    let lessonsArray = null;
    if (plannerData.lessons && Array.isArray(plannerData.lessons)) {
      lessonsArray = plannerData.lessons;
    } else if (plannerData.lesson_plans && Array.isArray(plannerData.lesson_plans)) {
      lessonsArray = plannerData.lesson_plans;
    } else {
      return null;
    }
    
    // Search for matching lesson name (case-insensitive, partial match)
    const topicLower = topic.toLowerCase().trim();
    for (let i = 0; i < lessonsArray.length; i++) {
      const lesson = lessonsArray[i];
      if (lesson.lesson_name) {
        const lessonNameLower = lesson.lesson_name.toLowerCase().trim();
        // Exact match or contains match
        if (lessonNameLower === topicLower || lessonNameLower.includes(topicLower) || topicLower.includes(lessonNameLower)) {
          return i + 1; // Return 1-based lesson number
        }
      }
    }
    
    return null; // No match found
  } catch (error) {
    console.error(`Error getting lesson number for ${subject}/${topic}:`, error.message);
    return null;
  }
}

/**
 * Normalize topic/unit name to match folder structure
 */
async function normalizeTopic(classNumber, topic, subject) {
  // Remove extra spaces and convert to proper case
  let normalized = topic.trim();
  
  // Check if it's already in C/P format (C1, P1, etc.)
  const existingMatch = normalized.match(/^([CP])(\d+)$/i);
  if (existingMatch) {
    return `${existingMatch[1].toUpperCase()}${existingMatch[2]}`;
  }
  
  // Check if it's a unit format (Unit-1, Unit 1, etc.)
  const unitMatch = normalized.match(/unit[\s-]?(\d+)/i);
  if (unitMatch) {
    const unitNum = unitMatch[1];
    return `C${unitNum}`;
  }
  
  // Try to get lesson number from planner.json (for English and other subjects with planner)
  const lessonNum = await getLessonNumberFromTopic(classNumber, subject, normalized);
  if (lessonNum) {
    return `C${lessonNum}`;
  }
  
  // Apply subject-specific mappings for AMENITY folder (only for Hindi Unit-1 typo)
  if (SUBJECT_MAPPINGS[subject] === 'Hindi') {
    // For Hindi, try to match unit format
    const hindiUnitMatch = normalized.match(/unit[\s-]?(\d+)/i);
    if (hindiUnitMatch) {
      const unitNum = hindiUnitMatch[1];
      const unitKey = `Unit-${unitNum}`;
      if (UNIT_MAPPINGS['Hindi'] && UNIT_MAPPINGS['Hindi'][unitKey]) {
        return UNIT_MAPPINGS['Hindi'][unitKey]; // Returns 'Uniit-1' for Unit-1
      }
      // If not in mapping, return as Unit-X format
      return unitKey;
    }
  }
  
  return normalized;
}

/**
 * Get file path for AMENITY tools (Concept Mastery, Flashcard, Short Notes)
 * 
 * AMENITY folder structure:
 * - Asli hardcoding/AMENITY/Subject/Unit-X/
 *   - cmh_*.json (Concept Mastery Helper)
 *   - fcm_*.json (Flashcard Generator)
 *   - sns_*.json (Short Notes Summary)
 * 
 * File naming patterns:
 * - Mathematics: cmh_mu2.json, fcm_mu2.json, sns_mu2.json
 * - Hindi: cmh_hu2.json, fcm_hu2.json, sns_hu2.json
 * - Science: cmh_su2.json, fcm_su2.json, sns_su2.json
 * - Social Science: cmh_ssu2.json, fcm_ssu2.json, sns_ssu2.json
 * - English: cmh_eu2-1.json (in topic subfolders)
 */
async function getAmenityFilePath(classNumber, subject, topic, toolType) {
  const mapping = TOOL_MAPPINGS[toolType];
  if (!mapping || mapping.folder !== 'AMENITY') {
    return null;
  }

  const subjectFolder = SUBJECT_MAPPINGS[subject] || subject;
  const normalizedTopic = await normalizeTopic(classNumber, topic, subject);
  
  // Map subject names for AMENITY folder (AMENITY uses "Mathematics" not "Maths")
  const amenitySubject = AMENITY_SUBJECT_MAPPINGS[subject] || subject;
  
  // Extract unit number from topic
  const unitMatch = normalizedTopic.match(/unit[\s-]?(\d+)/i);
  const unitNum = unitMatch ? unitMatch[1] : '1';
  
  // Build file pattern
  let fileName;
  let filePath;
  
  // AMENITY folder is at root level, not class-specific
  const amenityBasePath = getAmenityBasePath();
  
  if (amenitySubject === 'English') {
    // English has topic folders within units
    // Structure: AMENITY/English/Unit-1/Topic Name/cmh_eu1-1.json
    // First, convert topic to unit format (C8 -> Unit-8)
    let unitFolderName = normalizedTopic;
    
    // If topic is in C/P format, convert to Unit format
    const cFormatMatch = normalizedTopic.match(/^C(\d+)$/i);
    if (cFormatMatch) {
      unitFolderName = `Unit-${cFormatMatch[1]}`;
    } else if (!normalizedTopic.startsWith('Unit-')) {
      // If topic is a lesson name, try to get unit number from planner
      const lessonNum = await getLessonNumberFromTopic(classNumber, subject, topic);
      if (lessonNum) {
        unitFolderName = `Unit-${lessonNum}`;
      } else {
        // Try to match topic name directly to a folder name
        unitFolderName = normalizedTopic;
      }
    }
    
    const unitPath = path.join(
      amenityBasePath,
      amenitySubject,
      unitFolderName
    );
    
    try {
      // Check if unit folder exists
      await fs.access(unitPath);
      
      // List all topic folders in the unit
      const topicFolders = await fs.readdir(unitPath, { withFileTypes: true });
      
      // Extract unit number for file pattern
      const unitNumMatch = unitFolderName.match(/unit[\s-]?(\d+)/i);
      const unitNum = unitNumMatch ? unitNumMatch[1] : '1';
      
      // Try to find matching file in any topic folder
      for (const folder of topicFolders) {
        if (folder.isDirectory()) {
          const topicFolderPath = path.join(unitPath, folder.name);
          const files = await fs.readdir(topicFolderPath);
          
          // Look for file matching pattern: {tool}_eu{unit}-{number}.json or {tool}_eu{unit}.json
          const filePattern = mapping.filePattern.replace('_', ''); // cmh, fcm, or sns
          const matchingFile = files.find(f => 
            f.startsWith(filePattern) && 
            (f.includes(`eu${unitNum}-`) || f.includes(`eu${unitNum}.`)) && 
            f.endsWith('.json')
          );
          
          if (matchingFile) {
            return path.join(topicFolderPath, matchingFile);
          }
        }
      }
      
      // If no match found in topic folders, return null
      return null;
    } catch (err) {
      console.log(`Error reading English unit folder ${unitPath}:`, err.message);
      return null;
    }
  } else {
    // For Hindi, Mathematics, Science, Social Science - files are directly in Unit folders
    // Convert topic to Unit format if needed
    let unitFolderName = normalizedTopic;
    
    // If topic is in C/P format, convert to Unit format
    const cFormatMatch = normalizedTopic.match(/^C(\d+)$/i);
    if (cFormatMatch) {
      unitFolderName = `Unit-${cFormatMatch[1]}`;
    } else if (!normalizedTopic.startsWith('Unit-')) {
      // If topic is a lesson name, try to get unit number from planner
      const lessonNum = await getLessonNumberFromTopic(classNumber, subject, topic);
      if (lessonNum) {
        unitFolderName = `Unit-${lessonNum}`;
      } else {
        // Try to match unit format
        const unitMatch = normalizedTopic.match(/unit[\s-]?(\d+)/i);
        if (unitMatch) {
          unitFolderName = `Unit-${unitMatch[1]}`;
        }
      }
    }
    
    // Extract unit number for file naming
    const unitNumMatch = unitFolderName.match(/unit[\s-]?(\d+)/i);
    const finalUnitNum = unitNumMatch ? unitNumMatch[1] : unitNum;
    
    // Handle Hindi Unit-1 typo (Uniit-1)
    if (amenitySubject === 'Hindi' && unitFolderName === 'Unit-1') {
      unitFolderName = 'Uniit-1';
    }
    
    // Build file name based on subject
    if (amenitySubject === 'Hindi') {
      fileName = `${mapping.filePattern}hu${finalUnitNum}.json`;
    } else if (amenitySubject === 'Mathematics') {
      fileName = `${mapping.filePattern}mu${finalUnitNum}.json`;
    } else if (amenitySubject === 'Science') {
      fileName = `${mapping.filePattern}su${finalUnitNum}.json`;
    } else if (amenitySubject === 'Social Science') {
      fileName = `${mapping.filePattern}ssu${finalUnitNum}.json`;
    } else {
      return null;
    }
    
    filePath = path.join(
      amenityBasePath,
      amenitySubject,
      unitFolderName,
      fileName
    );
  }
  
  return filePath;
}

/**
 * Get file path for other tools (Lesson Planner, Projects, MCQ, etc.)
 */
async function getOtherToolFilePath(classNumber, subject, topic, toolType, difficulty = 'medium') {
  const mapping = TOOL_MAPPINGS[toolType];
  if (!mapping || mapping.folder === 'AMENITY') {
    return null;
  }

  const classBasePath = getClassBasePath(classNumber);
  const subjectFolder = SUBJECT_MAPPINGS[subject] || subject;
  
  // For direct files (planner.json, projects.csv, passages.csv)
  if (!mapping.folder) {
    let fileName = mapping.filePattern;
    
    // Handle Hindi subject which has project.csv (singular) instead of projects.csv
    if (toolType === 'activity-project-generator' && subjectFolder === 'Hindi') {
      // Check if project.csv exists, otherwise use projects.csv
      const projectCsvPath = path.join(classBasePath, subjectFolder, 'project.csv');
      const projectsCsvPath = path.join(classBasePath, subjectFolder, 'projects.csv');
      try {
        await fs.access(projectCsvPath);
        fileName = 'project.csv';
      } catch {
        // If project.csv doesn't exist, try projects.csv
        try {
          await fs.access(projectsCsvPath);
          fileName = 'projects.csv';
        } catch {
          // Keep original filename if neither exists
        }
      }
    }
    
    // For story-passage-creator, only allow English and Hindi
    if (toolType === 'story-passage-creator' && subjectFolder !== 'English' && subjectFolder !== 'Hindi') {
      console.log(`Story & Passage Creator is only available for English and Hindi. Subject: ${subjectFolder}`);
      return null;
    }
    
    const filePath = path.join(
      classBasePath,
      subjectFolder,
      fileName
    );
    return filePath;
  }
  
  // For folder-based tools (MCQ, Fill in blanks, etc.)
  // Normalize topic to get lesson code (C1, C2, P1, P2, etc.)
  const topicCode = await normalizeTopic(classNumber, topic, subject);
  
  // Normalize difficulty
  const difficultyLower = difficulty.toLowerCase();
  const difficultyMap = {
    'easy': 'easy',
    'medium': 'medium',
    'hard': 'hard',
  };
  const difficultyFormatted = difficultyMap[difficultyLower] || 'medium';
  
  // Build filename pattern - handle case sensitivity
  // Some folders use "Fill in the blanks" (capital B), some use "Fill in the Blanks"
  let folderName = mapping.folder;
  
  // Try to find the actual folder name (case-insensitive)
  try {
    const subjectPath = path.join(HARDCODED_BASE_PATH, subjectFolder);
    const folders = await fs.readdir(subjectPath, { withFileTypes: true });
    const matchingFolder = folders.find(f => 
      f.isDirectory() && f.name.toLowerCase() === folderName.toLowerCase()
    );
    if (matchingFolder) {
      folderName = matchingFolder.name;
    }
  } catch (err) {
    // If can't read, use original folder name
  }
  
  // File names are lowercase (c8 easy.csv, not C8 Easy.csv)
  const fileName = `${topicCode.toLowerCase()} ${difficultyFormatted}.csv`;
  
  const filePath = path.join(
    classBasePath,
    subjectFolder,
    folderName,
    fileName
  );
  
  return filePath;
}

/**
 * Read and parse JSON file
 */
async function readJSONFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error reading JSON file ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Read and parse CSV file
 */
async function readCSVFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    if (lines.length === 0) return [];
    
    // Parse header
    const headers = lines[0].split(',').map(h => h.trim());
    const data = [];
    
    // Parse rows
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      data.push(row);
    }
    
    return { headers, data };
  } catch (error) {
    console.error(`Error reading CSV file ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Get hardcoded content for a specific tool
 */
export async function getHardcodedContent(classNumber, subject, topic, toolType, params = {}) {
  try {
    const classNum = parseInt(classNumber);
    
    // Support classes 5-10
    if (isNaN(classNum) || classNum < 5 || classNum > 10) {
      console.log(`Unsupported class: ${classNumber}. Supported classes: 5-10`);
      return null;
    }
    
    // Validate subject - only allow the 5 valid subjects
    if (!VALID_SUBJECTS.includes(subject)) {
      console.log(`Invalid subject: ${subject}. Valid subjects are: ${VALID_SUBJECTS.join(', ')}`);
      return null;
    }
    
    // Check if tool type is supported
    if (!TOOL_MAPPINGS[toolType]) {
      return null;
    }
    
    const mapping = TOOL_MAPPINGS[toolType];
    let filePath = null;
    
    // Get file path based on tool type
    if (mapping.folder === 'AMENITY') {
      // AMENITY tools require topic
      if (!topic) {
        console.log(`Topic is required for AMENITY tools`);
        return null;
      }
      filePath = await getAmenityFilePath(classNum, subject, topic, toolType);
    } else {
      // For lesson-planner, daily-class-plan-maker, activity-project-generator, and story-passage-creator, topic is optional
      // For other tools, topic is required
      if (toolType === 'lesson-planner' || toolType === 'daily-class-plan-maker' || toolType === 'activity-project-generator' || toolType === 'story-passage-creator') {
        // These tools use direct files (planner.json, projects.csv, passages.csv) which contain all content
        // Topic is optional - if provided, it will be used to filter in the formatter
        // Pass empty string to indicate we want the full file
        filePath = await getOtherToolFilePath(classNum, subject, topic || '', toolType);
      } else {
        // Other tools require topic
        if (!topic) {
          console.log(`Topic is required for ${toolType}`);
          return null;
        }
        const difficulty = params.difficulty || params.questionDifficulty || 'medium';
        filePath = await getOtherToolFilePath(classNum, subject, topic, toolType, difficulty);
      }
    }
    
    if (!filePath) {
      console.log(`No file path found for: ${subject}/${topic}/${toolType}`);
      return null;
    }
    
    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      console.log(`File not found: ${filePath}`);
      return null;
    }
    
    // Read and parse file based on format
    if (mapping.format === 'json') {
      return await readJSONFile(filePath);
    } else if (mapping.format === 'csv') {
      return await readCSVFile(filePath);
    }
    
    return null;
  } catch (error) {
    console.error('Error getting hardcoded content:', error);
    return null;
  }
}

/**
 * Check if hardcoded content exists for given parameters
 */
export async function hasHardcodedContent(classNumber, subject, topic, toolType) {
  const content = await getHardcodedContent(classNumber, subject, topic, toolType);
  return content !== null;
}

/**
 * Get all available content types for a given chapter/topic
 */
export async function getAvailableContentForTopic(classNumber, subject, topic) {
  try {
    const classNum = parseInt(classNumber);
    
    // Support classes 5-10
    if (isNaN(classNum) || classNum < 5 || classNum > 10) {
      return [];
    }

    // Validate subject
    if (!VALID_SUBJECTS.includes(subject)) {
      return [];
    }

    const classBasePath = getClassBasePath(classNum);
    const subjectFolder = SUBJECT_MAPPINGS[subject] || subject;
    const topicCode = await normalizeTopic(classNum, topic, subject);
    
    // List of all content types to check
    // Note: Folder names need to match actual folder names (case-sensitive)
    const contentTypes = [
      { toolType: 'worksheet-mcq-generator', folder: 'mcq', name: 'MCQ Questions' },
      { toolType: 'fill-in-blanks', folder: 'Fill in the blanks', name: 'Fill in the Blanks' },
      { toolType: 'short-answer', folder: 'short answers', name: 'Short Answer Questions' },
      { toolType: 'long-answer', folder: 'long answer', name: 'Long Answer Questions' },
      { toolType: 'match-following', folder: 'match the following', name: 'Match the Following' },
      { toolType: 'true-false', folder: 'true or false', name: 'True or False' },
      { toolType: 'lesson-planner', folder: null, filePattern: 'planner.json', name: 'Lesson Planner' },
      { toolType: 'activity-project-generator', folder: null, filePattern: 'projects.csv', name: 'Projects & Activities' },
      { toolType: 'story-passage-creator', folder: null, filePattern: 'passages.csv', name: 'Stories & Passages' },
      // AMENITY tools
      { toolType: 'concept-mastery-helper', folder: 'AMENITY', name: 'Concept Mastery Helper' },
      { toolType: 'flashcard-generator', folder: 'AMENITY', name: 'Flashcards' },
      { toolType: 'short-notes-summaries-maker', folder: 'AMENITY', name: 'Short Notes & Summaries' },
    ];

    const availableContent = [];

    for (const contentType of contentTypes) {
      let exists = false;

      if (contentType.folder === 'AMENITY') {
        // Check AMENITY folder
        const filePath = await getAmenityFilePath(classNum, subject, topic, contentType.toolType);
        if (filePath) {
          try {
            await fs.access(filePath);
            exists = true;
          } catch {
            exists = false;
          }
        }
      } else if (contentType.folder === null) {
        // Check direct files (planner.json, projects.csv, etc.)
        const filePath = path.join(
          classBasePath,
          subjectFolder,
          contentType.filePattern
        );
        try {
          await fs.access(filePath);
          exists = true;
        } catch {
          exists = false;
        }
      } else {
        // Check folder-based content (MCQ, Fill in blanks, etc.)
        // First, find the actual folder name (case-insensitive)
        let actualFolderName = contentType.folder;
        try {
          const subjectPath = path.join(HARDCODED_BASE_PATH, subjectFolder);
          const folders = await fs.readdir(subjectPath, { withFileTypes: true });
          const matchingFolder = folders.find(f => 
            f.isDirectory() && f.name.toLowerCase() === contentType.folder.toLowerCase()
          );
          if (matchingFolder) {
            actualFolderName = matchingFolder.name;
          }
        } catch (err) {
          // If can't read, use original folder name
        }
        
        // Check if at least one difficulty level exists
        for (const difficulty of ['easy', 'medium', 'hard']) {
          const filePath = path.join(
            classBasePath,
            subjectFolder,
            actualFolderName,
            `${topicCode.toLowerCase()} ${difficulty}.csv`
          );
          try {
            await fs.access(filePath);
            exists = true;
            break; // Found at least one, no need to check others
          } catch {
            // Continue checking
          }
        }
      }

      if (exists) {
        availableContent.push({
          toolType: contentType.toolType,
          name: contentType.name,
          available: true
        });
      }
    }

    return availableContent;
  } catch (error) {
    console.error('Error getting available content:', error);
    return [];
  }
}

/**
 * Extract topic codes (C1, C2, P1, etc.) from folder structure
 */
async function extractTopicCodesFromFolders(classNumber, subject) {
  try {
    const classBasePath = getClassBasePath(classNumber);
    // Normalize subject name
    const normalizedSubject = VALID_SUBJECTS.find(s => 
      s.toLowerCase() === subject.toLowerCase()
    ) || subject;
    const subjectFolder = SUBJECT_MAPPINGS[normalizedSubject] || normalizedSubject;
    const subjectPath = path.join(classBasePath, subjectFolder);
    
    console.log(`🔍 Extracting topic codes from: ${subjectPath}`);
    
    // Check if subject folder exists
    try {
      await fs.access(subjectPath);
    } catch {
      return new Set(); // Subject folder doesn't exist
    }
    
    const topicCodes = new Set();
    
    // Read all folders in the subject directory
    const entries = await fs.readdir(subjectPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Check folders like "mcq", "Fill in the blanks", etc.
        const folderPath = path.join(subjectPath, entry.name);
        
        try {
          const files = await fs.readdir(folderPath);
          
          // Extract topic codes from filenames (c1 easy.csv, c2 medium.csv, p1 hard.csv, etc.)
          for (const file of files) {
            // Match patterns like: c1, c2, p1, C1, C2, P1 (case-insensitive)
            // Pattern: starts with c or p, followed by digits, then space or end
            const match = file.match(/^([cp])(\d+)(\s|\.|$)/i);
            if (match) {
              const type = match[1].toUpperCase();
              const num = match[2];
              const code = `${type}${num}`;
              topicCodes.add(code);
              console.log(`  Found topic code: ${code} from file: ${file}`);
            }
          }
        } catch (err) {
          // Skip folders we can't read
          continue;
        }
      } else if (entry.isFile()) {
        // Also check files in root (like planner.json, projects.csv might have topic info)
        // But we'll focus on folder-based content
      }
    }
    
    return topicCodes;
  } catch (error) {
    console.error(`Error extracting topic codes from folders for ${subject}:`, error);
    return new Set();
  }
}

/**
 * Get all chapters/topics for a subject from planner.json and folder structure
 * Handles both "lessons" and "lesson_plans" array structures
 * Also reads topic codes (C1, C2, P1, etc.) from folder structure
 */
export async function getChaptersForSubject(classNumber, subject) {
  try {
    const classNum = parseInt(classNumber);
    
    // Support classes 5-10
    if (isNaN(classNum) || classNum < 5 || classNum > 10) {
      console.log(`Unsupported class: ${classNumber}`);
      return [];
    }

    // Normalize subject name (handle case variations)
    const normalizedSubject = VALID_SUBJECTS.find(s => 
      s.toLowerCase() === subject.toLowerCase()
    ) || subject;
    
    // Validate subject
    if (!VALID_SUBJECTS.includes(normalizedSubject)) {
      console.log(`Invalid subject: ${subject}. Valid subjects: ${VALID_SUBJECTS.join(', ')}`);
      return [];
    }

    const classBasePath = getClassBasePath(classNum);
    const subjectFolder = SUBJECT_MAPPINGS[normalizedSubject] || normalizedSubject;
    const plannerPath = path.join(classBasePath, subjectFolder, 'planner.json');
    
    const chapters = [];
    const chapterMap = new Map(); // Map chapterCode to chapter object
    
    // First, try to get chapters from planner.json
    try {
      await fs.access(plannerPath);
      const plannerData = await readJSONFile(plannerPath);
      
      if (plannerData) {
        // Handle both "lessons" and "lesson_plans" array structures
        let lessonsArray = null;
        if (plannerData.lessons && Array.isArray(plannerData.lessons)) {
          lessonsArray = plannerData.lessons;
        } else if (plannerData.lesson_plans && Array.isArray(plannerData.lesson_plans)) {
          lessonsArray = plannerData.lesson_plans;
        }
        
        if (lessonsArray) {
          // Extract chapters/lessons from planner
          lessonsArray.forEach((lesson, index) => {
            const chapterCode = `C${index + 1}`;
            const chapter = {
              chapterNumber: index + 1,
              chapterCode: chapterCode,
              chapterName: lesson.lesson_name || `Chapter ${index + 1}`,
              duration: lesson.duration || null,
              subjectArea: lesson.subject_area || null // For Social Science
            };
            chapters.push(chapter);
            chapterMap.set(chapterCode, chapter);
          });
        }
      }
    } catch (err) {
      // Planner doesn't exist, continue to folder-based extraction
    }
    
    // Also extract topic codes from folder structure
    const folderTopicCodes = await extractTopicCodesFromFolders(classNum, normalizedSubject);
    console.log(`📁 Found ${folderTopicCodes.size} topic codes from folders:`, Array.from(folderTopicCodes));
    
    // Add topics from folders that aren't in planner.json
    for (const code of folderTopicCodes) {
      if (!chapterMap.has(code)) {
        // Parse code (C1, C2, P1, etc.)
        const match = code.match(/^([CP])(\d+)$/i);
        if (match) {
          const type = match[1].toUpperCase();
          const num = parseInt(match[2]);
          
          let chapterName;
          if (type === 'C') {
            chapterName = `Chapter ${num}`;
          } else if (type === 'P') {
            chapterName = `Poem ${num}`;
          } else {
            chapterName = `${type}${num}`;
          }
          
          const chapter = {
            chapterNumber: num,
            chapterCode: code,
            chapterName: chapterName,
            duration: null,
            subjectArea: null
          };
          
          chapters.push(chapter);
          chapterMap.set(code, chapter);
        }
      }
    }
    
    // Sort chapters by type (C first, then P) and then by number
    chapters.sort((a, b) => {
      const aType = a.chapterCode.charAt(0);
      const bType = b.chapterCode.charAt(0);
      if (aType !== bType) {
        return aType.localeCompare(bType);
      }
      return a.chapterNumber - b.chapterNumber;
    });
    
    return chapters;
  } catch (error) {
    console.error('Error getting chapters:', error);
    return [];
  }
}

export default {
  getHardcodedContent,
  hasHardcodedContent,
  getAvailableContentForTopic,
  getChaptersForSubject,
};
