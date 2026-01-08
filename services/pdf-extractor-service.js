// PDF Extraction Service - Extracts content from PDFs for AI tools
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);

/**
 * Extract content from PDF using Python script
 */
export async function extractContentFromPDF(pdfPath, classNumber, subject, topic) {
  try {
    const pythonScript = path.join(__dirname, '../scripts/pdf-extractor.py');
    const outputDir = path.join(__dirname, `../uploads/extracted/${classNumber}/${subject}`);
    
    // Create output directory
    await fs.mkdir(outputDir, { recursive: true });
    
    // Run Python extraction script
    const command = `python3 "${pythonScript}" "${pdfPath}" "${outputDir}" "${classNumber}" "${subject}" "${topic}"`;
    
    console.log('🔄 Running PDF extraction:', command);
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    });
    
    if (stderr && !stderr.includes('WARNING')) {
      console.error('PDF extraction stderr:', stderr);
    }
    
    // Parse JSON output from Python script
    const lines = stdout.trim().split('\n');
    const jsonLine = lines[lines.length - 1]; // Last line should be JSON
    
    let result;
    try {
      result = JSON.parse(jsonLine);
    } catch (e) {
      // If JSON parsing fails, create result from file paths
      const csvPath = path.join(outputDir, `${topic}.csv`);
      const metadataPath = path.join(outputDir, `${topic}_metadata.json`);
      
      // Check if files exist
      const csvExists = await fs.access(csvPath).then(() => true).catch(() => false);
      const metadataExists = await fs.access(metadataPath).then(() => true).catch(() => false);
      
      if (!csvExists) {
        throw new Error('PDF extraction failed - CSV file not created');
      }
      
      // Read metadata if exists
      let metadata = {};
      if (metadataExists) {
        const metadataContent = await fs.readFile(metadataPath, 'utf-8');
        metadata = JSON.parse(metadataContent);
      }
      
      result = {
        success: true,
        csv_path: csvPath,
        metadata_path: metadataPath,
        questions_count: 0,
        metadata: metadata
      };
    }
    
    if (!result.success) {
      throw new Error('PDF extraction failed');
    }
    
    // Read extracted CSV
    const csvContent = await fs.readFile(result.csv_path, 'utf-8');
    const questions = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    
    result.questions = questions;
    result.questions_count = questions.length;
    
    console.log(`✅ PDF extraction successful: ${questions.length} questions extracted`);
    
    return result;
  } catch (error) {
    console.error('❌ PDF extraction error:', error);
    throw new Error(`Failed to extract PDF content: ${error.message}`);
  }
}

/**
 * Get extracted content for a topic
 */
export async function getExtractedContent(classNumber, subject, topic) {
  try {
    const csvPath = path.join(__dirname, `../uploads/extracted/${classNumber}/${subject}/${topic}.csv`);
    
    // Check if file exists
    try {
      await fs.access(csvPath);
    } catch {
      return null; // File doesn't exist
    }
    
    // Read and parse CSV
    const csvContent = await fs.readFile(csvPath, 'utf-8');
    const questions = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    
    return questions;
  } catch (error) {
    console.error('Error reading extracted content:', error);
    return null;
  }
}

/**
 * Get available topics from extracted PDFs
 */
export async function getExtractedTopics(classNumber, subject) {
  try {
    const extractDir = path.join(__dirname, `../uploads/extracted/${classNumber}/${subject}`);
    
    // Check if directory exists
    try {
      await fs.access(extractDir);
    } catch {
      return []; // Directory doesn't exist
    }
    
    // Read all CSV files
    const files = await fs.readdir(extractDir);
    const topics = files
      .filter(file => file.endsWith('.csv') && !file.includes('_metadata'))
      .map(file => ({
        name: file.replace('.csv', ''),
        fullPath: file
      }));
    
    return topics;
  } catch (error) {
    console.error('Error getting extracted topics:', error);
    return [];
  }
}

/**
 * Check if PDF content exists for a topic
 */
export async function hasExtractedContent(classNumber, subject, topic) {
  try {
    const csvPath = path.join(__dirname, `../uploads/extracted/${classNumber}/${subject}/${topic}.csv`);
    await fs.access(csvPath);
    return true;
  } catch {
    return false;
  }
}


