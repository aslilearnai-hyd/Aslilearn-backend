import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

function isTruthy(value) {
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function resolveChatCompletionsEndpoint(baseUrlRaw) {
  const sanitized = String(baseUrlRaw || '').trim().replace(/\/+$/, '');
  if (!sanitized) {
    return 'http://127.0.0.1:1234/v1/chat/completions';
  }

  if (/\/chat\/completions$/i.test(sanitized)) {
    return sanitized;
  }

  if (/\/v1$/i.test(sanitized)) {
    return `${sanitized}/chat/completions`;
  }

  return `${sanitized}/v1/chat/completions`;
}

function getLlmConfig() {
  const baseUrlRaw =
    process.env.UPSTREAM_LLM_URL ||
    process.env.LLM_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    process.env.LM_STUDIO_BASE_URL ||
    'http://127.0.0.1:1234/v1';
  const apiKey =
    process.env.UPSTREAM_LLM_API_KEY ||
    process.env.LLM_API_KEY ||
    process.env.OPENAI_API_KEY ||
    'lm-studio';
  const model =
    process.env.LLM_MODEL_ID ||
    process.env.UPSTREAM_LLM_MODEL_ID ||
    process.env.OPENAI_MODEL ||
    process.env.LM_STUDIO_MODEL ||
    'mistralai/mistral-7b-instruct-v0.3';
  const disableAuth = isTruthy(process.env.DISABLE_LLM_AUTH);
  const allowInsecureCert = isTruthy(process.env.ALLOW_INSECURE_LLM_CERT);
  const endpoint = resolveChatCompletionsEndpoint(baseUrlRaw);

  if (allowInsecureCert) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  return {
    endpoint,
    apiKey: String(apiKey),
    model: String(model),
    disableAuth,
    allowInsecureCert,
    contextTokens: Number(process.env.LLM_CONTEXT_TOKENS) || 0,
    provider: String(process.env.LLM_PROVIDER || '').trim().toLowerCase(),
  };
}

function getGeminiFallbackConfig() {
  const apiKey = String(
    process.env.VIDYA_AI_GEMINI_API_KEY ||
      process.env.GEMINI_API_KEY ||
      ''
  ).trim();
  const model = String(
    process.env.VIDYA_AI_GEMINI_MODEL ||
      process.env.GEMINI_FALLBACK_MODEL ||
      'gemini-2.0-flash'
  ).trim();
  const baseUrl = String(
    process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta'
  )
    .trim()
    .replace(/\/+$/, '');
  return { apiKey, model, baseUrl };
}

function cleanText(value) {
  return value == null ? '' : String(value).trim();
}

function stripCodeFences(text) {
  return String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

async function callChatCompletions({
  messages,
  temperature = 0.3,
  maxTokens = 2000,
  preferJson = false,
}) {
  const callGeminiFallback = async () => {
    const { apiKey, model, baseUrl } = getGeminiFallbackConfig();
    if (!apiKey) {
      throw new Error('LLM request failed and Gemini fallback key is missing');
    }

    const prompt = normalizedMessages
      .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${String(m.content || '')}`)
      .join('\n\n');

    const payload = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt || 'Help with educational content.' }],
        },
      ],
      generationConfig: {
        temperature,
        maxOutputTokens: contextTokens > 0 ? Math.min(maxTokens, contextTokens) : maxTokens,
      },
    };

    const response = await fetch(
      `${baseUrl}/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini fallback failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => (typeof p?.text === 'string' ? p.text : ''))
      .join('')
      .trim();
    if (!text) {
      throw new Error('Gemini fallback returned empty content');
    }
    return text;
  };

  const { endpoint, apiKey, model, disableAuth, contextTokens } = getLlmConfig();
  // Some local model templates (LM Studio) only accept user/assistant roles.
  const normalizeMessages = (inputMessages) => {
    const list = Array.isArray(inputMessages) ? inputMessages : [];
    if (!list.length) return [{ role: 'user', content: 'Hello' }];

    const systemMessages = list
      .filter((m) => m?.role === 'system' && m?.content != null)
      .map((m) => String(m.content).trim())
      .filter(Boolean);

    const nonSystem = list
      .filter((m) => m?.role !== 'system')
      .map((m) => {
        const role = m?.role === 'assistant' ? 'assistant' : 'user';
        return { role, content: m?.content ?? '' };
      });

    if (!systemMessages.length) return nonSystem;

    if (!nonSystem.length) {
      return [{ role: 'user', content: systemMessages.join('\n\n') }];
    }

    const first = nonSystem[0];
    if (first.role === 'user' && typeof first.content === 'string') {
      return [
        {
          ...first,
          content: `${systemMessages.join('\n\n')}\n\n${first.content}`,
        },
        ...nonSystem.slice(1),
      ];
    }

    return [
      { role: 'user', content: systemMessages.join('\n\n') },
      ...nonSystem,
    ];
  };

  const normalizedMessages = normalizeMessages(messages);

  const basePayload = {
    model,
    messages: normalizedMessages,
    temperature,
    max_tokens: contextTokens > 0 ? Math.min(maxTokens, contextTokens) : maxTokens,
  };

  const withJsonFormat = preferJson
    ? { ...basePayload, response_format: { type: 'json_object' } }
    : basePayload;

  const attemptRequest = async (payload) => {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (!disableAuth) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM request failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!cleanText(content)) {
      throw new Error('LLM returned empty content');
    }
    return String(content);
  };

  try {
    return await attemptRequest(withJsonFormat);
  } catch (error) {
    if (!preferJson) {
      try {
        console.warn('Primary LLM failed, trying Gemini fallback:', error?.message || error);
        return await callGeminiFallback();
      } catch (fallbackError) {
        throw fallbackError;
      }
    }
    try {
      return await attemptRequest(basePayload);
    } catch (error2) {
      try {
        console.warn('Primary LLM JSON mode failed, trying Gemini fallback:', error2?.message || error2);
        return await callGeminiFallback();
      } catch (fallbackError) {
        throw fallbackError;
      }
    }
  }
}

function buildTeacherToolPrompt(toolType, params = {}) {
  const common = `Subject: ${params.subject || 'General'}
Topic: ${params.topic || 'General Topic'}
${params.subTopic ? `Sub Topic: ${params.subTopic}\n` : ''}Grade/Class: ${params.gradeLevel || 'General'}

Format response in Markdown with headings, bullets, and clear sections.`;

  const templates = {
    'activity-project-generator': `${common}

Create an engaging classroom activity/project with:
1) Objective
2) Materials
3) Procedure
4) Assessment rubric
5) Extension idea`,
    'worksheet-mcq-generator': `${common}

Create a worksheet with ${params.questionCount || 10} questions (${params.questionType || 'mixed'}), include answers and short explanations.`,
    'concept-mastery-helper': `${common}

Explain the concept in simple steps, common mistakes, examples, and a quick recap.`,
    'lesson-planner': `${common}

Create a complete lesson plan for ${params.duration || 90} minutes with objectives, prerequisite, teaching flow, examples, and homework.`,
    'homework-creator': `${common}

Create a meaningful homework set with instructions, questions, answer key, and grading criteria.`,
    'rubrics-evaluation-generator': `${common}

Create clear evaluation rubrics with criteria and performance levels (Excellent, Good, Satisfactory, Needs Improvement).`,
    'story-passage-creator': `${common}

Write a topic-relevant story/passage in the subject language, then add vocabulary, comprehension and discussion questions.`,
    'short-notes-summaries-maker': `${common}

Create concise revision notes with key ideas, definitions, formulas (if any), and quick reference points.`,
    'flashcard-generator': `${common}

Generate ${params.cardCount || 20} flashcards in Markdown with Front/Back format.`,
    'daily-class-plan-maker': `${common}

Create a practical day plan with time slots, activities, checkpoints, and notes.`,
    'exam-question-paper-generator': `${common}

Generate a full exam paper with exactly ${Math.min(
      Math.max(Number(params.questionCount ?? params.numberOfQuestions ?? 17) || 17, 1),
      100,
    )} questions and a complete answer key.`,
  };

  return (
    templates[toolType] ||
    `${common}

Generate high-quality educational content for toolType="${toolType}" using params: ${JSON.stringify(params)}`
  );
}

function buildStudentToolPrompt(toolType, params = {}) {
  const common = `Class: ${params.gradeLevel || 'General'}
Subject: ${params.subject || 'General'}
Topic: ${params.topic || params.chapter || params.concept || 'General Topic'}

Format response in Markdown and keep it student-friendly.`;

  const templates = {
    'smart-study-guide-generator': `${common}

Create a personalized study guide with key concepts, formulas, and a revision checklist.`,
    'concept-breakdown-explainer': `${common}

Break the concept into simple steps with examples and common misconceptions.`,
    'personalized-revision-planner': `${common}

Create a realistic day-wise revision planner based on exam date and available hours.`,
    'smart-qa-practice-generator': `${common}

Generate practice questions with step-by-step answers and quick tips.`,
    'chapter-summary-creator': `${common}

Provide a concise chapter summary with key takeaways and quick review points.`,
    'key-points-formula-extractor': `${common}

List the most important key points, definitions, and formulas.`,
    'quick-assignment-builder': `${common}

Build a structured assignment with instructions and marking criteria.`,
    'exam-readiness-checker': `${common}

Assess readiness, identify weak areas, and provide an actionable improvement plan.`,
    'project-layout-designer': `${common}

Design a complete project layout with sections, timeline, and resources.`,
    'goal-motivation-planner': `${common}

Create a SMART goals and motivation plan with milestones and tracking.`,
  };

  return (
    templates[toolType] ||
    `${common}

Generate educational content for toolType="${toolType}" using params: ${JSON.stringify(params)}`
  );
}

class GeminiService {
  constructor() {
    const cfg = getLlmConfig();
    this.model = cfg.model;
    this.endpoint = cfg.endpoint;
    this.provider = cfg.provider || 'default';
    this.disableAuth = cfg.disableAuth;
    console.log(`✅ LLM service ready: ${this.model} @ ${this.endpoint} (provider=${this.provider}, auth=${this.disableAuth ? 'off' : 'on'})`);
  }

  async generateResponse(message, context = {}, chatHistory = []) {
    const studentName = context?.studentName || 'Student';
    let systemInstruction = `You are Vidya AI for AsliLearn.
Give direct, accurate, educational answers.
Use clear language and step-by-step explanations for problem solving.
Keep responses focused and practical.`;

    if (context.currentSubject) {
      systemInstruction += `\nCurrent subject: ${context.currentSubject}`;
      if (context.currentTopic) {
        systemInstruction += `\nCurrent topic: ${context.currentTopic}`;
      }
    }

    const normalizedHistory = (chatHistory || []).slice(-8).map((msg) => ({
      role: msg?.role === 'assistant' ? 'assistant' : 'user',
      content: cleanText(msg?.content),
    }));

    const messages = [
      { role: 'system', content: systemInstruction },
      ...normalizedHistory.filter((m) => m.content.length > 0),
      { role: 'user', content: cleanText(message) || `Help ${studentName} with studies.` },
    ];

    return callChatCompletions({
      messages,
      temperature: 0.4,
      maxTokens: 1400,
    });
  }

  async analyzeImage(imageBase64, context = '') {
    const prompt = `Analyze this educational image and help the student.
${context ? `Context: ${context}` : ''}
Provide: (1) what you see, (2) explanation/solution, (3) key takeaways.`;

    const dataUri = `data:image/jpeg;base64,${imageBase64}`;
    const visionMessages = [
      { role: 'system', content: 'You are a helpful educational vision assistant.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      },
    ];

    try {
      return await callChatCompletions({
        messages: visionMessages,
        temperature: 0.2,
        maxTokens: 1400,
      });
    } catch (error) {
      console.warn('Vision request failed, falling back to text-only analysis:', error.message);
      return callChatCompletions({
        messages: [
          { role: 'system', content: 'You are a helpful educational assistant.' },
          {
            role: 'user',
            content:
              `${prompt}\n\nImage bytes were provided but vision is unavailable on current model. ` +
              'Explain this limitation and provide what guidance can still be offered.',
          },
        ],
        temperature: 0.2,
        maxTokens: 600,
      });
    }
  }

  async generateStructuredContent(prompt, format = 'text') {
    const wantsJson = String(format).toLowerCase() === 'json';
    const messages = [
      {
        role: 'system',
        content: wantsJson
          ? 'Return only valid JSON. No markdown, no code fences, no extra text.'
          : 'Return clear, structured educational content.',
      },
      { role: 'user', content: cleanText(prompt) },
    ];

    const text = await callChatCompletions({
      messages,
      temperature: wantsJson ? 0.1 : 0.3,
      maxTokens: 2200,
      preferJson: wantsJson,
    });

    return wantsJson ? stripCodeFences(text) : text;
  }
}

const geminiService = new GeminiService();

export const generateLessonPlan = async (subject, topic, gradeLevel, duration) => {
  const prompt = `Create a comprehensive lesson plan.
Subject: ${subject}
Topic: ${topic}
Grade: ${gradeLevel}
Duration: ${duration} minutes

Include objectives, prerequisites, teaching flow, examples, assessment, homework, and common mistakes.`;
  return geminiService.generateStructuredContent(prompt, 'text');
};

export const generateTestQuestions = async (subject, topic, gradeLevel, questionCount, difficulty) => {
  const prompt = `Generate exactly ${questionCount} MCQs in JSON.
Subject: ${subject}
Topic: ${topic}
Grade: ${gradeLevel}
Difficulty: ${difficulty}

JSON schema:
{
  "questions": [
    {
      "question": "string",
      "type": "multiple-choice",
      "options": ["A", "B", "C", "D"],
      "correctAnswer": "string",
      "explanation": "string"
    }
  ]
}`;
  return geminiService.generateStructuredContent(prompt, 'json');
};

export const generateClasswork = async (subject, topic, gradeLevel, assignmentType) => {
  const prompt = `Create ${assignmentType} classwork.
Subject: ${subject}
Topic: ${topic}
Grade: ${gradeLevel}
Include title, instructions, tasks, rubric, and expected duration.`;
  return geminiService.generateStructuredContent(prompt, 'text');
};

export const generateSchedule = async (subjects, gradeLevels, timeSlots, preferences) => {
  const prompt = `Create a weekly teaching schedule.
Subjects: ${Array.isArray(subjects) ? subjects.join(', ') : subjects}
Grades: ${Array.isArray(gradeLevels) ? gradeLevels.join(', ') : gradeLevels}
Time slots: ${Array.isArray(timeSlots) ? timeSlots.join(', ') : timeSlots}
Preferences: ${preferences}`;
  return geminiService.generateStructuredContent(prompt, 'text');
};

export const generateTeacherTool = async (toolType, params) => {
  return geminiService.generateStructuredContent(buildTeacherToolPrompt(toolType, params), 'text');
};

export const generateStudentTool = async (toolType, params) => {
  return geminiService.generateStructuredContent(buildStudentToolPrompt(toolType, params), 'text');
};

export default geminiService;
