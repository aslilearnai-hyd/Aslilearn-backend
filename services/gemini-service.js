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

// Generic teacher tool generator
export const generateTeacherTool = async (toolType, params) => {
  const apiKey = process.env.GEMINI_API_KEY || 'AIzaSyDExDEuif6KRk5suciCPLr1sDqkQFDfNb8';
  const genAI = new GoogleGenerativeAI(apiKey);
  
  // Define prompts for each tool type
  const toolPrompts = {
    'activity-project-generator': `Create engaging activities and projects.

Subject: ${params.subject || 'General'}
Topic: ${params.topic || 'General Topic'}
${params.subTopic ? `Sub Topic: ${params.subTopic}\n` : ''}Grade Level: ${params.gradeLevel || 'General'}
Class: ${params.className || ''}

IMPORTANT: Format your response using Markdown with clear headings (##), subheadings (###), bullet points (-), numbered lists, and bold text (**text**).

## Activity Title and Description
Provide a catchy title and detailed description.

## Learning Objectives
List specific learning goals students will achieve.

## Materials Needed
- List all required materials
- Equipment and resources
- Digital tools (if applicable)

## Step-by-Step Instructions
Provide clear, numbered steps for implementation.

## Expected Outcomes
Describe what students will learn and produce.

## Assessment Criteria
- How to evaluate student work
- Rubric or checklist

## Extension Activities
Optional activities for advanced students.

## Safety Considerations
Important safety notes (if applicable).

Make it engaging, hands-on, and aligned with curriculum standards.`,

    'worksheet-mcq-generator': `Design custom worksheets and MCQs with various question types.

Subject: ${params.subject || 'General'}
Topic: ${params.topic || 'General Topic'}
${params.subTopic ? `Sub Topic: ${params.subTopic}\n` : ''}Grade Level: ${params.gradeLevel || 'General'}
Question Type: ${params.questionType || 'All Types'}
Number of Questions: ${params.questionCount || 10}
Difficulty: ${params.difficulty || 'medium'}

IMPORTANT: Format your response using Markdown with clear headings (##), subheadings (###), bullet points (-), numbered lists, and bold text (**text**).

${params.questionType === 'Single Option' ? 'Generate ONLY single-option multiple-choice questions (one correct answer per question).' : ''}
${params.questionType === 'Multiple Option' ? 'Generate ONLY multiple-option multiple-choice questions (multiple correct answers per question).' : ''}
${params.questionType === 'Integer Type' ? 'Generate ONLY integer-type questions (numerical answer questions).' : ''}
${params.questionType === 'All Types' ? 'Generate a mix of question types: single-option MCQs, multiple-option MCQs, integer-type questions, fill-in-the-blank, and short answer questions.' : ''}

## Worksheet Title
Provide a clear, descriptive title.

## Instructions
Clear instructions for students on how to complete the worksheet.

## Exercises
Include ${params.questionCount || 10} questions based on the selected question type.

Format each question clearly with proper numbering.
${params.questionType === 'Single Option' || params.questionType === 'Multiple Option' || params.questionType === 'All Types' ? '\nFor multiple-choice questions:\n- Provide 4 options (A, B, C, D)\n- Mark the correct answer(s) clearly\n- Include brief explanations' : ''}
${params.questionType === 'Integer Type' || params.questionType === 'All Types' ? '\nFor integer-type questions:\n- Provide numerical answer questions\n- Include step-by-step solutions' : ''}

## Answer Key
Provide complete answers for all questions with explanations where needed.

## Grading Rubric
- Point distribution
- Evaluation criteria
- Partial credit guidelines

Make it comprehensive and appropriate for the grade level.`,

    'concept-mastery-helper': `Break down complex concepts into digestible lessons.

Subject: ${params.subject || 'General'}
Concept: ${params.concept || params.topic || 'General Concept'}
${params.subTopic ? `Sub Topic: ${params.subTopic}\n` : ''}Grade Level: ${params.gradeLevel || 'General'}

IMPORTANT: Format your response using Markdown with clear headings (##), subheadings (###), bullet points (-), numbered lists, and bold text (**text**).

## Concept Overview
Provide a clear introduction to the concept.

## Key Components Breakdown
Break down the concept into smaller, understandable parts:
- Component 1
- Component 2
- Component 3

## Step-by-Step Explanation
Provide a detailed, step-by-step explanation of how the concept works.

## Real-World Examples
Include practical examples that students can relate to.

## Common Misconceptions
List common mistakes students make and how to avoid them.

## Practice Exercises
Provide exercises to reinforce understanding.

## Summary and Key Takeaways
Summarize the most important points students should remember.

Make it clear, simple, and easy to understand.`,

    'lesson-planner': `Create a comprehensive, detailed lesson plan for IIT JEE Mains preparation.

Subject: ${params.subject || 'General'}
Topic: ${params.topic || 'General Topic'}
${params.subTopic ? `Sub Topic: ${params.subTopic}\n` : ''}Grade Level: ${params.gradeLevel || 'General'}
Duration: ${params.duration || 90} minutes

IMPORTANT: Format your response using Markdown with clear headings (##), subheadings (###), bullet points (-), numbered lists, and bold text (**text**). Make it professional and well-structured.

Provide a structured lesson plan with the following sections:

## Learning Objectives
List 3-5 specific JEE Mains learning goals that students will achieve.

## Prerequisites
- What students should know before this lesson
- Foundation concepts required

## Materials Needed
- Textbooks and reference materials
- Teaching aids and equipment
- Digital resources

## Introduction/Warm-up (5-10 minutes)
- Hook to engage students
- Connection to JEE pattern
- Real-world applications

## Main Content Delivery
Break down the main content with time allocation:
- Theory explanation (XX minutes)
- Key concepts and formulas
- Problem-solving techniques
- JEE-level examples with step-by-step solutions

## Practice Problems
Provide 3-5 JEE Mains level practice problems with:
- Problem statement
- Step-by-step solution
- Key concepts tested

## Assessment/Evaluation
Include JEE-style questions for quick assessment.

## Homework/Assignment
- Specific practice problems
- Reference materials
- Expected completion time

## Common Mistakes and Tips
- Typical errors students make
- Tips to avoid mistakes
- Exam strategy

## Next Class Preview
- What will be covered next
- Preparation required

Make the content detailed, practical, and focused on JEE Mains preparation.`,

    'homework-creator': `Generate meaningful homework assignments for:
Subject: ${params.subject || 'General'}
Topic: ${params.topic || 'General Topic'}
${params.subTopic ? `Sub Topic: ${params.subTopic}\n` : ''}Grade Level: ${params.gradeLevel || 'General'}
Duration: ${params.duration || '30 minutes'}

Generate:
1. Assignment Title
2. Learning Objectives
3. Instructions
4. Questions/Problems
5. Expected Time to Complete
6. Answer Key (for teacher)
7. Grading Criteria

Make it meaningful, relevant, and appropriate for the grade level.`,

    'rubrics-evaluation-generator': `Create clear assessment criteria and rubrics for:
Subject: ${params.subject || 'General'}
Assignment Type: ${params.assignmentType || 'General Assignment'}
Grade Level: ${params.gradeLevel || 'General'}

Generate:
1. Rubric Title
2. Assessment Criteria (4-6 criteria)
3. Performance Levels (Excellent, Good, Satisfactory, Needs Improvement)
4. Point Distribution
5. Detailed Descriptors for Each Level
6. Total Points
7. Grading Guidelines

Make it clear, fair, and comprehensive.`,

    'learning-outcomes-generator': `Define measurable learning outcomes for:
Subject: ${params.subject || 'General'}
Topic: ${params.topic || 'General Topic'}
${params.subTopic ? `Sub Topic: ${params.subTopic}\n` : ''}Grade Level: ${params.gradeLevel || 'General'}

Generate:
1. Course/Unit Title
2. Overall Learning Goals
3. Specific Learning Outcomes (5-8 outcomes)
4. Assessment Methods for Each Outcome
5. Success Criteria
6. Bloom's Taxonomy Level
7. Alignment with Standards

Make them specific, measurable, achievable, relevant, and time-bound (SMART).`,

    'story-passage-creator': `Generate engaging stories and reading passages for:
Subject: ${params.subject || 'General'}
Topic: ${params.topic || 'General Topic'}
${params.subTopic ? `Sub Topic: ${params.subTopic}\n` : ''}Grade Level: ${params.gradeLevel || 'General'}
Length: ${params.length || 'medium'}

Generate:
1. Story/Passage Title
2. The Story/Passage Content
3. Reading Level Information
4. Vocabulary Words
5. Comprehension Questions
6. Discussion Questions
7. Extension Activities

Make it engaging, age-appropriate, and educational.`,

    'short-notes-summaries-maker': `Condense complex topics into concise notes for:
Subject: ${params.subject || 'General'}
Topic: ${params.topic || 'General Topic'}
${params.subTopic ? `Sub Topic: ${params.subTopic}\n` : ''}Grade Level: ${params.gradeLevel || 'General'}

Generate:
1. Topic Title
2. Key Points Summary
3. Important Definitions
4. Formulas/Equations (if applicable)
5. Quick Reference Guide
6. Mnemonics (if helpful)
7. Related Topics

Make it concise, clear, and easy to review.`,

    'flashcard-generator': `Build study flashcards for quick revision for:
Subject: ${params.subject || 'General'}
Topic: ${params.topic || 'General Topic'}
${params.subTopic ? `Sub Topic: ${params.subTopic}\n` : ''}Grade Level: ${params.gradeLevel || 'General'}
Number of Cards: ${params.cardCount || 20}

Generate:
1. Flashcard Set Title
2. List of Flashcards (Front: Question/Concept, Back: Answer/Explanation)
3. Study Tips
4. Review Schedule Suggestions

Format each card clearly with front and back content.`,

    'report-card-generator': `Generate comprehensive student progress reports with feedback for:
Student Name: ${params.studentName || 'Student'}
Subject: ${params.subject || 'General'}
Grade Level: ${params.gradeLevel || 'General'}
Term: ${params.term || 'Current Term'}

Generate:
1. Student Information
2. Academic Performance Summary
3. Subject-wise Breakdown
4. Strengths and Achievements
5. Areas for Improvement
6. Teacher Comments
7. Recommendations
8. Next Steps

Make it constructive, encouraging, and detailed.`,

    'student-skill-tracker': `Monitor and track student skill development for:
Student Name: ${params.studentName || 'Student'}
Subject: ${params.subject || 'General'}
Grade Level: ${params.gradeLevel || 'General'}

Generate:
1. Skill Assessment Framework
2. Current Skill Levels
3. Skill Categories (e.g., Problem Solving, Critical Thinking, Communication)
4. Progress Tracking Template
5. Development Goals
6. Action Plan
7. Monitoring Schedule

Make it comprehensive and actionable.`,

    'daily-class-plan-maker': `Organize daily teaching schedule efficiently for:
Date: ${params.date || 'Today'}
Subjects: ${params.subjects || 'General'}
Grade Level: ${params.gradeLevel || 'General'}
Time Slots: ${params.timeSlots || 'Standard'}

Generate:
1. Daily Schedule Overview
2. Time-Blocked Plan
3. Activities for Each Period
4. Materials Needed
5. Assessment Checkpoints
6. Notes and Reminders

Make it organized, efficient, and practical.`,

    'exam-question-paper-generator': `Create comprehensive exam papers with varying difficulty for:
Subject: ${params.subject || 'General'}
Topic: ${params.topic || 'General Topic'}
${params.subTopic ? `Sub Topic: ${params.subTopic}\n` : ''}Grade Level: ${params.gradeLevel || 'General'}
Duration: ${params.duration || '90 minutes'}
Difficulty Mix: ${params.difficulty || 'mixed'}

Generate:
1. Exam Paper Header
2. Instructions
3. Questions (mix of easy, medium, hard)
4. Marking Scheme
5. Answer Key
6. Time Allocation Suggestions

Make it comprehensive and exam-ready.`
  };

  let prompt = toolPrompts[toolType] || `Generate content for ${toolType} with the following parameters: ${JSON.stringify(params)}`;
  
  // Add markdown formatting instruction if not already present
  if (!prompt.includes('IMPORTANT: Format your response using Markdown')) {
    prompt = `IMPORTANT: Format your response using Markdown with clear headings (##), subheadings (###), bullet points (-), numbered lists, and bold text (**text**). Make it professional and well-structured.\n\n${prompt}`;
  }

  const modelsToTry = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-pro',
    'gemini-1.5-flash'
  ];

  for (const modelName of modelsToTry) {
    try {
      console.log(`🔄 Trying model for ${toolType}: ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      console.log(`✅ Successfully generated ${toolType} using ${modelName}`);
      return response.text();
    } catch (error) {
      console.log(`❌ Model ${modelName} failed: ${error.message}`);
      if (modelName === modelsToTry[modelsToTry.length - 1]) {
        console.error(`Error generating ${toolType}:`, error);
        throw new Error(`Failed to generate ${toolType}: ${error.message || 'Unknown error'}`);
      }
      continue;
    }
  }
};

const geminiService = new GeminiService();

// Student Tool Generator
export const generateStudentTool = async (toolType, params) => {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

  const toolPrompts = {
    'smart-study-guide-generator': `Create a comprehensive, personalized study guide.

Class: ${params.gradeLevel || 'General'}
Subject: ${params.subject || 'General'}
Topic: ${params.topic || 'General Topic'}
Focus Areas: ${params.focusAreas || 'All areas'}

IMPORTANT: Format your response using Markdown with clear headings (##), subheadings (###), bullet points (-), numbered lists, and bold text (**text**). For mathematical expressions, use LaTeX notation with $ for inline math and $$ for block/display math.

Generate a detailed study guide with:

## Study Guide: [Topic Name]

### Overview
Brief introduction to the topic and its importance.

### Key Concepts
List and explain the main concepts with examples.

### Important Formulas & Theorems
- Formula 1: [with explanation]
- Formula 2: [with explanation]
- Use LaTeX for math: $E = mc^2$, $\\int f(x)dx$

### Study Tips
- Practical tips for mastering this topic
- Common mistakes to avoid
- Memory techniques

### Practice Recommendations
- Suggested exercises
- Practice problems with solutions
- Additional resources

### Revision Checklist
- [ ] Concept 1
- [ ] Concept 2
- [ ] Practice problems

Make it comprehensive, well-structured, and suitable for ${params.gradeLevel || 'General'} level.`,

    'concept-breakdown-explainer': `Break down a complex concept into simple, easy-to-understand explanations.

Class: ${params.gradeLevel || 'General'}
Subject: ${params.subject || 'General'}
Concept: ${params.concept || 'General Concept'}

IMPORTANT: Format your response using Markdown. Use LaTeX for math expressions.

Provide:

## Concept Breakdown: [Concept Name]

### What is [Concept]?
Simple definition and explanation.

### Why is it Important?
Real-world applications and significance.

### Step-by-Step Explanation
Break down into digestible steps:
1. Step 1: [Explanation]
2. Step 2: [Explanation]
3. Step 3: [Explanation]

### Visual Analogy
Use relatable analogies to explain the concept.

### Examples
- Example 1: [Detailed example]
- Example 2: [Detailed example]

### Common Misconceptions
- Misconception 1: [Correct explanation]
- Misconception 2: [Correct explanation]

### Practice Questions
A few questions to test understanding.

Make it clear, simple, and appropriate for ${params.gradeLevel || 'General'} level.`,

    'personalized-revision-planner': `Create a personalized revision schedule.

Class: ${params.gradeLevel || 'General'}
Subjects: ${params.subjects || 'All subjects'}
Exam Date: ${params.examDate || 'Not specified'}
Study Hours Per Day: ${params.studyHoursPerDay || 4} hours

IMPORTANT: Format your response using Markdown.

Generate:

## Personalized Revision Plan

### Overview
Summary of the revision plan.

### Daily Schedule
Break down each day with:
- Morning session (topics)
- Afternoon session (topics)
- Evening session (topics)

### Weekly Breakdown
- Week 1: [Subjects and topics]
- Week 2: [Subjects and topics]
- Continue for all weeks

### Subject-wise Plan
For each subject:
- Topics to cover
- Time allocation
- Revision strategy

### Tips for Success
- Study techniques
- Break schedules
- Health and wellness tips

### Progress Tracking
Create a checklist for tracking progress.

Make it realistic, achievable, and tailored to the student's needs.`,

    'smart-qa-practice-generator': `Generate practice questions with detailed answers.

Class: ${params.gradeLevel || 'General'}
Subject: ${params.subject || 'General'}
Topic: ${params.topic || 'General Topic'}
Number of Questions: ${params.questionCount || 10}
Difficulty: ${params.difficulty || 'medium'}

IMPORTANT: Format using Markdown. Use LaTeX for math.

Generate:

## Practice Questions: [Topic]

### Question Set

For each question, provide:

**Question [Number]**
[Question text with LaTeX math if needed]

**Answer:**
[Detailed step-by-step answer]

**Key Points:**
- Important concepts covered
- Tips for solving similar problems

**Practice Tip:**
[Additional guidance]

Make questions appropriate for ${params.gradeLevel || 'General'} level and ${params.difficulty || 'medium'} difficulty.`,

    'chapter-summary-creator': `Create a concise chapter summary.

Class: ${params.gradeLevel || 'General'}
Subject: ${params.subject || 'General'}
Chapter/Topic: ${params.chapter || 'General Chapter'}

IMPORTANT: Format using Markdown. Use LaTeX for math.

Provide:

## Chapter Summary: [Chapter Name]

### Overview
Brief introduction to the chapter.

### Main Topics Covered
1. Topic 1: [Summary]
2. Topic 2: [Summary]
3. Topic 3: [Summary]

### Key Concepts
- Concept 1: [Explanation]
- Concept 2: [Explanation]

### Important Formulas/Definitions
- Formula 1: [with context]
- Definition 1: [with context]

### Summary Points
- Point 1
- Point 2
- Point 3

### Quick Review
A condensed version for last-minute revision.

Make it concise yet comprehensive for ${params.gradeLevel || 'General'} level.`,

    'key-points-formula-extractor': `Extract key points and formulas from a topic.

Class: ${params.gradeLevel || 'General'}
Subject: ${params.subject || 'General'}
Topic: ${params.topic || 'General Topic'}

IMPORTANT: Format using Markdown. Use LaTeX for math formulas.

Generate:

## Key Points & Formulas: [Topic]

### Essential Formulas
- **Formula 1**: $[LaTeX formula]$ - [Explanation and when to use]
- **Formula 2**: $[LaTeX formula]$ - [Explanation and when to use]

### Key Definitions
- **Term 1**: [Definition]
- **Term 2**: [Definition]

### Important Theorems/Principles
- Theorem 1: [Statement and significance]
- Principle 1: [Statement and application]

### Critical Points to Remember
- Point 1
- Point 2
- Point 3

### Quick Reference
A condensed cheat sheet format.

Make it focused on the most important information for ${params.gradeLevel || 'General'} level.`,

    'quick-assignment-builder': `Build a structured assignment.

Class: ${params.gradeLevel || 'General'}
Subject: ${params.subject || 'General'}
Topic: ${params.topic || 'General Topic'}
Assignment Type: ${params.assignmentType || 'General'}

IMPORTANT: Format using Markdown.

Create:

## Assignment: [Topic]

### Assignment Overview
- Title: [Assignment Title]
- Subject: [Subject]
- Topic: [Topic]
- Type: [Assignment Type]

### Objectives
- Objective 1
- Objective 2
- Objective 3

### Instructions
Step-by-step instructions for completing the assignment.

### Requirements
- Requirement 1
- Requirement 2
- Requirement 3

### Evaluation Criteria
- Criterion 1: [Points/Percentage]
- Criterion 2: [Points/Percentage]

### Submission Guidelines
- Format requirements
- Deadline information
- Submission method

Make it clear, structured, and appropriate for ${params.gradeLevel || 'General'} level.`,

    'exam-readiness-checker': `Assess exam readiness and provide recommendations.

Class: ${params.gradeLevel || 'General'}
Subject: ${params.subject || 'General'}
Exam Type: ${params.examType || 'General Exam'}
Exam Date: ${params.examDate || 'Not specified'}

IMPORTANT: Format using Markdown.

Provide:

## Exam Readiness Assessment

### Current Status
Assessment of current preparation level.

### Strengths
- Strength 1
- Strength 2
- Strength 3

### Areas Needing Improvement
- Area 1: [Specific improvement needed]
- Area 2: [Specific improvement needed]

### Readiness Score
Overall readiness percentage with breakdown.

### Recommended Action Plan
- Immediate actions (next 24 hours)
- Short-term plan (next week)
- Long-term plan (until exam)

### Study Priorities
Ranked list of topics to focus on.

### Practice Recommendations
- Types of practice needed
- Resources to use
- Mock tests to take

### Exam Strategy
- Time management tips
- Question-solving approach
- Stress management

Make it actionable and encouraging for ${params.gradeLevel || 'General'} level.`,

    'project-layout-designer': `Design a structured project layout.

Class: ${params.gradeLevel || 'General'}
Subject: ${params.subject || 'General'}
Project Topic: ${params.projectTopic || 'General Topic'}
Project Type: ${params.projectType || 'General'}

IMPORTANT: Format using Markdown.

Create:

## Project Layout: [Project Topic]

### Project Overview
- Title: [Project Title]
- Type: [Project Type]
- Subject: [Subject]
- Duration: [Estimated time]

### Project Structure
1. **Introduction**
   - Purpose
   - Objectives
   - Scope

2. **Main Content Sections**
   - Section 1: [Description]
   - Section 2: [Description]
   - Section 3: [Description]

3. **Methodology/Approach**
   - Step-by-step approach
   - Tools and materials needed

4. **Results/Findings**
   - Expected outcomes
   - How to present results

5. **Conclusion**
   - Summary
   - Key takeaways

### Timeline
- Week 1: [Tasks]
- Week 2: [Tasks]
- Continue as needed

### Resources Needed
- Materials
- References
- Tools

### Presentation Guidelines
- Format requirements
- Visual elements
- Presentation tips

Make it comprehensive and suitable for ${params.gradeLevel || 'General'} level.`,

    'goal-motivation-planner': `Create a goal-setting and motivation plan.

Class: ${params.gradeLevel || 'General'}
Goal Type: ${params.goalType || 'Academic'}
Timeframe: ${params.timeframe || '1 month'}
Goal Description: ${params.description || 'General goals'}

IMPORTANT: Format using Markdown.

Generate:

## Goal & Motivation Plan

### Goal Statement
Clear, specific goal statement.

### Why This Goal Matters
Personal significance and benefits.

### SMART Goals Breakdown
- **Specific**: [Specific goal]
- **Measurable**: [How to measure]
- **Achievable**: [Feasibility]
- **Relevant**: [Relevance]
- **Time-bound**: [Timeline]

### Action Plan
- Week 1: [Actions]
- Week 2: [Actions]
- Continue for the timeframe

### Milestones
- Milestone 1: [Date and achievement]
- Milestone 2: [Date and achievement]

### Motivation Strategies
- Strategy 1: [How to stay motivated]
- Strategy 2: [Reward system]
- Strategy 3: [Accountability]

### Obstacles & Solutions
- Potential obstacle 1: [Solution]
- Potential obstacle 2: [Solution]

### Progress Tracking
Methods to track and measure progress.

### Daily Affirmations
Positive statements to reinforce motivation.

Make it inspiring, actionable, and tailored to the student's goals.`
  };

  let prompt = toolPrompts[toolType] || `Generate content for ${toolType} with the following parameters: ${JSON.stringify(params)}`;
  
  if (!prompt.includes('IMPORTANT: Format your response using Markdown')) {
    prompt = `IMPORTANT: Format your response using Markdown with clear headings (##), subheadings (###), bullet points (-), numbered lists, and bold text (**text**). Make it professional and well-structured.\n\n${prompt}`;
  }

  const modelsToTry = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-pro',
    'gemini-1.5-flash'
  ];

  for (const modelName of modelsToTry) {
    try {
      console.log(`🔄 Trying model for student tool ${toolType}: ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      console.log(`✅ Successfully generated student tool ${toolType} using ${modelName}`);
      return response.text();
    } catch (error) {
      console.log(`❌ Model ${modelName} failed: ${error.message}`);
      if (modelName === modelsToTry[modelsToTry.length - 1]) {
        console.error(`Error generating student tool ${toolType}:`, error);
        throw new Error(`Failed to generate content: ${error.message}`);
      }
    }
  }
};

export default geminiService;
