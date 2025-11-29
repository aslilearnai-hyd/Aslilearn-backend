// Gemini Service - Google Gemini AI integration (ES Module version)
// Replaces Ollama service with Google Gemini API

import { GoogleGenerativeAI } from '@google/generative-ai';

class GeminiService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || 'AIzaSyDExDEuif6KRk5suciCPLr1sDqkQFDfNb8';
    this.genAI = new GoogleGenerativeAI(this.apiKey);
    this.textModel = 'gemini-2.0-flash-exp';
    
    if (!this.apiKey) {
      console.warn('⚠️  GEMINI_API_KEY not set in environment variables');
    } else {
      console.log('✅ Gemini service initialized');
    }
  }

  async generateStructuredContent(prompt, format = 'text') {
    try {
      const model = this.genAI.getGenerativeModel({ model: this.textModel });
      
      const systemInstruction = format === 'json' 
        ? 'You are a helpful assistant. Respond ONLY with valid JSON, no markdown, no code blocks, just pure JSON.'
        : 'You are a helpful assistant. Provide clear, structured responses.';

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        systemInstruction: systemInstruction
      });

      const response = await result.response;
      let resultText = response.text();

      // Clean JSON if format is json
      if (format === 'json') {
        resultText = resultText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
      }

      return resultText;
    } catch (error) {
      console.error('Gemini structured content error:', error);
      throw new Error(`Failed to generate content: ${error.message}`);
    }
  }
}

// Export functions for backward compatibility with existing code
export const generateLessonPlan = async (subject, topic, gradeLevel, duration) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY || 'AIzaSyDExDEuif6KRk5suciCPLr1sDqkQFDfNb8';
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    
    const prompt = `
    Create a comprehensive lesson plan for:
    - Subject: ${subject}
    - Topic: ${topic}
    - Grade Level: ${gradeLevel}
    - Duration: ${duration} minutes
    
    Please provide:
    1. Learning Objectives (3-5 specific goals)
    2. Materials Needed
    3. Introduction (5-10 minutes)
    4. Main Activities (with time allocations)
    5. Assessment/Evaluation
    6. Homework/Follow-up
    7. Differentiation strategies
    
    Format the response in a clear, structured manner suitable for a teacher to follow.
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('Error generating lesson plan:', error);
    throw new Error('Failed to generate lesson plan');
  }
};

export const generateTestQuestions = async (subject, topic, gradeLevel, questionCount, difficulty) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY || 'AIzaSyDExDEuif6KRk5suciCPLr1sDqkQFDfNb8';
    const genAI = new GoogleGenerativeAI(apiKey);
    
    const prompt = `Generate exactly ${questionCount} multiple-choice test questions for:
- Subject: ${subject}
- Topic: ${topic}
- Grade Level: ${gradeLevel}
- Difficulty: ${difficulty}

IMPORTANT: You MUST return ONLY valid JSON in the following exact format (no markdown, no code blocks, just pure JSON):
{
  "questions": [
    {
      "question": "Question text here",
      "type": "multiple-choice",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": "Option A",
      "explanation": "Explanation of why the correct answer is right"
    }
  ]
}

Requirements:
1. Generate exactly ${questionCount} questions
2. All questions must be multiple-choice with exactly 4 options (A, B, C, D)
3. Each question must have exactly ONE correct answer
4. Questions should be appropriate for ${gradeLevel} level
5. Difficulty should match: ${difficulty}
6. Questions should cover the topic: ${topic} in ${subject}
7. Include clear explanations for each correct answer
8. Return ONLY the JSON object, no additional text before or after`;

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();
    
    // Clean up markdown code blocks if present
    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    
    return text;
  } catch (error) {
    console.error('Error generating test questions:', error);
    throw new Error(`Failed to generate test questions: ${error.message || 'Unknown error'}`);
  }
};

export const generateClasswork = async (subject, topic, gradeLevel, assignmentType) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY || 'AIzaSyDExDEuif6KRk5suciCPLr1sDqkQFDfNb8';
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    
    const prompt = `
    Create ${assignmentType} for:
    - Subject: ${subject}
    - Topic: ${topic}
    - Grade Level: ${gradeLevel}
    
    Please provide:
    1. Assignment Title
    2. Instructions (clear and detailed)
    3. Tasks/Questions
    4. Rubric/Evaluation Criteria
    5. Expected Time to Complete
    6. Resources/References
    
    Make the assignment engaging and appropriate for the grade level.
    Include both individual and group work elements if applicable.
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('Error generating classwork:', error);
    throw new Error('Failed to generate classwork');
  }
};

export const generateSchedule = async (subjects, gradeLevels, timeSlots, preferences) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY || 'AIzaSyDExDEuif6KRk5suciCPLr1sDqkQFDfNb8';
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    
    const prompt = `
    Create a teaching schedule for:
    - Subjects: ${subjects.join(', ')}
    - Grade Levels: ${gradeLevels.join(', ')}
    - Available Time Slots: ${timeSlots.join(', ')}
    - Preferences: ${preferences}
    
    Please provide:
    1. Weekly Schedule (Monday to Friday)
    2. Subject Distribution
    3. Break Times
    4. Preparation Time
    5. Assessment Schedule
    6. Professional Development Time
    
    Ensure the schedule is balanced and follows best practices for teaching.
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('Error generating schedule:', error);
    throw new Error('Failed to generate schedule');
  }
};

const geminiService = new GeminiService();

export default geminiService;
