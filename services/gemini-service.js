// Gemini Service - Google Gemini AI integration (ES Module version)
// Replaces Ollama service with Google Gemini API

import { GoogleGenerativeAI } from '@google/generative-ai';

class GeminiService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || 'AIzaSyDExDEuif6KRk5suciCPLr1sDqkQFDfNb8';
    this.genAI = new GoogleGenerativeAI(this.apiKey);
    this.textModel = 'gemini-2.5-flash'; // Latest model that works with v1 API
    
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
    const apiKey = process.env.GEMINI_API_KEY || 'AIzaSyDExDEuif6KRk5suciCPLr1sDqkQFDfNb8';
    const genAI = new GoogleGenerativeAI(apiKey);
  
  // Try multiple models in order of preference
  const modelsToTry = [
    'gemini-2.5-flash',    // Latest version
    'gemini-2.0-flash',    // Version 2.0
    'gemini-pro',          // Stable fallback
    'gemini-1.5-flash'     // Older but might work
  ];

  const prompt = `Create a comprehensive, detailed lesson plan for IIT JEE Mains preparation:

Subject: ${subject}
Topic: ${topic}
Grade Level: ${gradeLevel}
Duration: ${duration} minutes

This is for IIT JEE Mains coaching, so please provide a structured lesson plan with:

1. **Learning Objectives** (3-5 JEE-specific goals)
   - What students will be able to do after this lesson
   - JEE Mains exam relevance

2. **Prerequisites and Previous Knowledge Required**
   - What students should know before this lesson
   - Foundation concepts needed

3. **Materials Needed**
   - Textbooks and reference materials (mention specific JEE books)
   - Teaching aids, demonstrations, or equipment
   - Digital resources if applicable

4. **Introduction/Warm-up (5-10 minutes)**
   - Hook to engage students
   - Connect to JEE pattern and previous topics
   - Real-world applications

5. **Main Content Delivery (with detailed time breakdown)**
   - Theory explanation with key concepts
   - Important formulas and derivations
   - Problem-solving techniques and strategies
   - JEE-level examples with step-by-step solutions
   - Common patterns and shortcuts

6. **Practice Problems (JEE Mains level)**
   - 3-5 practice problems with varying difficulty
   - Include solutions and explanations

7. **Assessment/Evaluation (JEE-style questions)**
   - Quick check questions
   - JEE Mains pattern questions

8. **Homework/Assignment**
   - JEE practice problems
   - Reference to specific problem sets
   - Expected time for completion

9. **Common Mistakes and Tips**
   - What students typically get wrong
   - Tips for avoiding errors
   - Exam strategy

10. **Next Class Preview**
    - What will be covered next
    - Preparation required

Format the response in a clear, structured manner with proper headings and sections. Make it practical, engaging, and focused on JEE Mains preparation.`;

  for (const modelName of modelsToTry) {
    try {
      console.log(`🔄 Trying model for lesson plan: ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(prompt);
    const response = await result.response;
      const lessonPlan = response.text();
      
      console.log(`✅ Successfully generated lesson plan using ${modelName}`);
      return lessonPlan;
  } catch (error) {
      console.log(`❌ Model ${modelName} failed: ${error.message}`);
      // If this is the last model, throw the error
      if (modelName === modelsToTry[modelsToTry.length - 1]) {
    console.error('Error generating lesson plan:', error);
        throw new Error(`Failed to generate lesson plan: ${error.message || 'Unknown error'}`);
      }
      // Otherwise, try the next model
      continue;
    }
  }
};

export const generateTestQuestions = async (subject, topic, gradeLevel, questionCount, difficulty) => {
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

  // Include JSON instruction in the prompt since systemInstruction is not supported in v1 API
  const fullPrompt = `You are a helpful educational assistant. Respond ONLY with valid JSON, no markdown, no code blocks, just pure JSON.

${prompt}`;

  // Try multiple models in order of preference
  const modelsToTry = [
    'gemini-2.5-flash',    // Latest version
    'gemini-2.0-flash',    // Version 2.0
    'gemini-pro',          // Stable fallback
    'gemini-1.5-flash'     // Older but might work
  ];

  for (const modelName of modelsToTry) {
    try {
      console.log(`🔄 Trying model for quiz generation: ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    let text = response.text();
    
    // Clean up markdown code blocks if present
    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    
      console.log(`✅ Successfully generated questions using ${modelName}`);
    return text;
  } catch (error) {
      console.log(`❌ Model ${modelName} failed: ${error.message}`);
      // If this is the last model, throw the error
      if (modelName === modelsToTry[modelsToTry.length - 1]) {
    console.error('Error generating test questions:', error);
    throw new Error(`Failed to generate test questions: ${error.message || 'Unknown error'}`);
      }
      // Otherwise, try the next model
      continue;
    }
  }
};

export const generateClasswork = async (subject, topic, gradeLevel, assignmentType) => {
    const apiKey = process.env.GEMINI_API_KEY || 'AIzaSyDExDEuif6KRk5suciCPLr1sDqkQFDfNb8';
    const genAI = new GoogleGenerativeAI(apiKey);
    
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

  // Try multiple models in order of preference
  const modelsToTry = [
    'gemini-2.5-flash',    // Latest version
    'gemini-2.0-flash',    // Version 2.0
    'gemini-pro',          // Stable fallback
    'gemini-1.5-flash'     // Older but might work
  ];

  for (const modelName of modelsToTry) {
    try {
      console.log(`🔄 Trying model for classwork: ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(prompt);
    const response = await result.response;
      console.log(`✅ Successfully generated classwork using ${modelName}`);
    return response.text();
  } catch (error) {
      console.log(`❌ Model ${modelName} failed: ${error.message}`);
      if (modelName === modelsToTry[modelsToTry.length - 1]) {
    console.error('Error generating classwork:', error);
        throw new Error(`Failed to generate classwork: ${error.message || 'Unknown error'}`);
      }
      continue;
    }
  }
};

export const generateSchedule = async (subjects, gradeLevels, timeSlots, preferences) => {
    const apiKey = process.env.GEMINI_API_KEY || 'AIzaSyDExDEuif6KRk5suciCPLr1sDqkQFDfNb8';
    const genAI = new GoogleGenerativeAI(apiKey);
    
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

  // Try multiple models in order of preference
  const modelsToTry = [
    'gemini-2.5-flash',    // Latest version
    'gemini-2.0-flash',    // Version 2.0
    'gemini-pro',          // Stable fallback
    'gemini-1.5-flash'     // Older but might work
  ];

  for (const modelName of modelsToTry) {
    try {
      console.log(`🔄 Trying model for schedule: ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(prompt);
    const response = await result.response;
      console.log(`✅ Successfully generated schedule using ${modelName}`);
    return response.text();
  } catch (error) {
      console.log(`❌ Model ${modelName} failed: ${error.message}`);
      if (modelName === modelsToTry[modelsToTry.length - 1]) {
    console.error('Error generating schedule:', error);
        throw new Error(`Failed to generate schedule: ${error.message || 'Unknown error'}`);
      }
      continue;
    }
  }
};

const geminiService = new GeminiService();

export default geminiService;
