import { PDFParse } from 'pdf-parse';
import geminiService from './gemini-service.js';

const TOOL_LABEL_BY_SLUG = {
  'activity-project-generator': 'Activity & Project Generator',
  'worksheet-mcq-generator': 'Worksheet & MCQ Generator',
  'concept-mastery-helper': 'Concept Mastery Helper',
  'lesson-planner': 'Lesson Planner',
  'homework-creator': 'Homework Creator',
  'rubrics-evaluation-generator': 'Rubrics, Evaluation & Report Card',
  'story-passage-creator': 'Story & Passage Creator',
  'short-notes-summaries-maker': 'Short Notes & Summaries',
  'flashcard-generator': 'Flashcard Generator',
  'daily-class-plan-maker': 'Daily Class Plan',
  'exam-question-paper-generator': 'Exam Question Paper',
};

const TOOL_ALIAS_TO_SLUG = Object.entries(TOOL_LABEL_BY_SLUG).reduce((acc, [slug, label]) => {
  const key = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '');
  acc[key] = slug;
  return acc;
}, {});

const CONTENT_TYPE_BY_TOOL_SLUG = {
  'activity-project-generator': 'Activity Plan',
  'worksheet-mcq-generator': 'Worksheet',
  'concept-mastery-helper': 'Concept Notes',
  'lesson-planner': 'Lesson Plan',
  'homework-creator': 'Homework',
  'rubrics-evaluation-generator': 'Rubric',
  'story-passage-creator': 'Story',
  'short-notes-summaries-maker': 'Notes',
  'flashcard-generator': 'Flashcards',
  'daily-class-plan-maker': 'Daily Plan',
  'exam-question-paper-generator': 'Exam Paper',
};

const TOOL_STRICT_OUTPUT_HINTS = {
  'worksheet-mcq-generator': 'Return ONLY question content. No introductions, no chapter heading repetition, no filler text.',
  'activity-project-generator': 'Return ONLY activities/projects with materials, steps, and learning outcomes.',
  'concept-mastery-helper': 'Return ONLY concept explanations and definitions.',
  'lesson-planner': 'Return ONLY lesson plan structure: objectives, activities, timeline, assessment.',
  'homework-creator': 'Return ONLY homework questions and instructions.',
  'rubrics-evaluation-generator': 'Return ONLY rubric criteria and grading scales.',
  'story-passage-creator': 'Return ONLY title, passage, and comprehension questions.',
  'short-notes-summaries-maker': 'Return ONLY concise notes, headings, and key points.',
  'flashcard-generator': 'Return ONLY flashcards with front/back.',
  'daily-class-plan-maker': 'Return ONLY daily plan timeline and activities.',
  'exam-question-paper-generator': 'Return ONLY section-wise exam paper questions.',
};

const toStringList = (value) =>
  (Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);

const toQuestionArray = (value = []) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => {
      if (typeof entry === 'string') {
        const text = entry.trim();
        return text ? { question: text, options: [], answer: '' } : null;
      }
      if (entry && typeof entry === 'object') {
        const question =
          String(entry.question || entry.prompt || entry.text || entry.statement || entry.title || '').trim();
        if (!question) return null;
        const options = Array.isArray(entry.options)
          ? entry.options.map((opt) => String(opt || '').trim()).filter(Boolean)
          : [];
        const answer = String(entry.answer || entry.correctAnswer || '').trim();
        return { question, options, answer };
      }
      return null;
    })
    .filter(Boolean);

const isHeadingLikeLine = (text) =>
  /\b(chapter|topic|lesson|unit|syllabus|mcqs?)\b/i.test(text) && !/[?]/.test(text);

const looksLikeQuestionPrompt = (text) =>
  /[?]|_{3,}|^\s*(what|which|why|how|define|choose|fill|select|state|identify)\b/i.test(text);

const sanitizeWorksheetQuestions = (questions = []) =>
  questions
    .map((row) => ({
      question: String(row?.question || '').replace(/\s+/g, ' ').trim(),
      options: (Array.isArray(row?.options) ? row.options : [])
        .map((opt) => String(opt || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .reduce((acc, opt) => {
          const labelMatch = opt.match(/^([A-D])\)\s*/i);
          const key = labelMatch ? labelMatch[1].toUpperCase() : opt.toLowerCase();
          if (!acc.some((existing) => {
            const existingMatch = existing.match(/^([A-D])\)\s*/i);
            return (existingMatch ? existingMatch[1].toUpperCase() : existing.toLowerCase()) === key;
          })) {
            acc.push(opt);
          }
          return acc;
        }, [])
        .slice(0, 4),
      answer: String(row?.answer || '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((row) => row.question)
    .filter((row) => !isHeadingLikeLine(row.question))
    .filter((row) => looksLikeQuestionPrompt(row.question) || row.options.length >= 2)
    .filter((row, idx, arr) => arr.findIndex((q) => q.question.toLowerCase() === row.question.toLowerCase()) === idx);

const extractQuestionsFromText = (value) => {
  const text = String(value || '').trim();
  if (!text) return [];

  const blocks = text
    .split(/(?=(?:^|\n|\s)(?:q(?:uestion)?\s*)?\d+[\).:-]\s*)/gi)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .filter((chunk) => /^(?:q(?:uestion)?\s*)?\d+[\).:-]\s*/i.test(chunk));

  return blocks
    .map((chunk) => {
      const normalized = chunk.replace(/\s+/g, ' ').trim();
      const body = normalized.replace(/^(?:q(?:uestion)?\s*)?\d+[\).:-]\s*/i, '').trim();
      const optionMatches = Array.from(
        body.matchAll(/([A-D])\)\s*([^]+?)(?=(?:\s+[A-D]\)\s*)|(?:\s+(?:answer|correct\s*answer)\s*[:\-])|$)/gi),
      );
      const answerMatch = body.match(/(?:answer|correct\s*answer)\s*[:\-]\s*([^]+)$/i);
      const questionText = optionMatches.length > 0 ? body.slice(0, optionMatches[0].index).trim() : body;
      const options = optionMatches.map((m) => `${m[1].toUpperCase()}) ${String(m[2] || '').trim()}`).filter(Boolean);
      const answer = answerMatch ? String(answerMatch[1] || '').trim() : '';
      return {
        question: questionText.replace(/\s*(?:answer|correct\s*answer)\s*[:\-]\s*[^]+$/i, '').trim(),
        options,
        answer,
      };
    })
    .filter((row) => row.question)
    .filter((row) => !isHeadingLikeLine(row.question))
    .filter((row) => looksLikeQuestionPrompt(row.question) || row.options.length >= 2);
};

export function buildDeterministicQuestionSetFromText(pdfText, maxQuestions = 15) {
  const base = sanitizeWorksheetQuestions(extractQuestionsFromText(pdfText));
  return {
    type: 'Worksheet',
    questions: base.slice(0, maxQuestions),
  };
}

const normalizeStructuredContentByTool = (toolSlug, structuredContent, contentType, sourceText = '') => {
  const source = structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)
    ? structuredContent
    : {};
  if (toolSlug === 'worksheet-mcq-generator' || toolSlug === 'homework-creator') {
    const candidateGroups = [
      source.questions,
      source.mcqs,
      source.multipleChoiceQuestions,
      source.shortQuestions,
      source.longQuestions,
      source.fillInTheBlanks,
      source.exerciseQuestions,
      source.exercises,
      source.practiceProblems,
      source.qaPairs,
      source.items,
    ];
    const mergedQuestions = candidateGroups.flatMap((group) => toQuestionArray(group));
    const textBasedQuestions = [
      source.content,
      source.text,
      source.body,
      source.summary,
      source.rawText,
      source.instructions,
      sourceText,
    ].flatMap((candidate) => extractQuestionsFromText(candidate));
    const finalQuestions = sanitizeWorksheetQuestions(
      mergedQuestions.length > 0 ? mergedQuestions : textBasedQuestions,
    );
    if (finalQuestions.length > 0) {
      return {
        normalizedStructuredContent: {
          ...source,
          type: String(source.type || contentType || '').trim() || 'Worksheet',
          questions: finalQuestions,
        },
      };
    }
  }
  return { normalizedStructuredContent: source };
};

const TOOL_STRUCTURED_RULES = {
  'worksheet-mcq-generator': {
    allowedTypes: ['MCQ', 'Worksheet'],
    validate: (data) => Array.isArray(data?.questions) && data.questions.length > 0,
    message: 'Worksheet & MCQ content must include a non-empty questions array.',
  },
  'activity-project-generator': {
    allowedTypes: ['Activity Plan', 'Activity'],
    validate: (data) => Array.isArray(data?.steps) && data.steps.length > 0,
    message: 'Activity content must include non-empty steps.',
  },
  'concept-mastery-helper': {
    allowedTypes: ['Concept Notes', 'Notes'],
    validate: (data) => Array.isArray(data?.concepts) && data.concepts.length > 0,
    message: 'Concept content must include a non-empty concepts array.',
  },
  'lesson-planner': {
    allowedTypes: ['Lesson Plan'],
    validate: (data) => Array.isArray(data?.objectives) && data.objectives.length > 0,
    message: 'Lesson plan must include a non-empty objectives array.',
  },
  'homework-creator': {
    allowedTypes: ['Homework'],
    validate: (data) => Array.isArray(data?.questions) && data.questions.length > 0,
    message: 'Homework content must include a non-empty questions array.',
  },
  'rubrics-evaluation-generator': {
    allowedTypes: ['Rubric'],
    validate: (data) => Array.isArray(data?.criteria) && data.criteria.length > 0,
    message: 'Rubric content must include a non-empty criteria array.',
  },
  'story-passage-creator': {
    allowedTypes: ['Story'],
    validate: (data) => typeof data?.content === 'string' && data.content.trim().length > 0,
    message: 'Story content must include non-empty content text.',
  },
  'short-notes-summaries-maker': {
    allowedTypes: ['Notes', 'Summary'],
    validate: (data) =>
      (Array.isArray(data?.keyPoints) && data.keyPoints.length > 0) ||
      (Array.isArray(data?.headings) && data.headings.length > 0),
    message: 'Summary content must include keyPoints or headings.',
  },
  'flashcard-generator': {
    allowedTypes: ['Flashcards'],
    validate: (data) =>
      Array.isArray(data?.cards) &&
      data.cards.length > 0 &&
      data.cards.every((card) => String(card?.front || '').trim() && String(card?.back || '').trim()),
    message: 'Flashcards content must include cards with front and back values.',
  },
  'daily-class-plan-maker': {
    allowedTypes: ['Daily Plan'],
    validate: (data) => Array.isArray(data?.timeline) && data.timeline.length > 0,
    message: 'Daily plan content must include a non-empty timeline.',
  },
  'exam-question-paper-generator': {
    allowedTypes: ['Exam Paper'],
    validate: (data) => Array.isArray(data?.sections) && data.sections.length > 0,
    message: 'Exam paper content must include a non-empty sections array.',
  },
};

function normalizeToolKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function extractJsonObject(text) {
  const raw = String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Gemini returned invalid JSON payload');
  }
  return JSON.parse(raw.slice(start, end + 1));
}

function buildPrompt(pdfText, selected = {}) {
  const selectedClass = String(selected.classLabel || '').trim();
  const selectedSubject = String(selected.subject || '').trim();
  const selectedTopic = String(selected.topic || selected.chapter || '').trim();
  const selectedSubTopic = String(selected.subTopic || '').trim();
  const selectedToolLabel = getToolLabelFromSlug(String(selected.toolType || '').trim());
  const selectedToolHint = TOOL_STRICT_OUTPUT_HINTS[String(selected.toolType || '').trim()] || '';

  return `Analyze this educational PDF content and return ONLY valid JSON.

Detect:
1. class
2. subject
3. topic
4. subtopic
5. bestMatchingTool from this exact list:
- Activity & Project Generator
- Worksheet & MCQ Generator
- Concept Mastery Helper
- Lesson Planner
- Homework Creator
- Rubrics, Evaluation & Report Card
- Story & Passage Creator
- Short Notes & Summaries
- Flashcard Generator
- Daily Class Plan
- Exam Question Paper

6. contentType from:
MCQ, Notes, Worksheet, Lesson Plan, Story, Homework, Rubric, Flashcards, Exam Paper, Concept Notes, Activity Plan, Daily Plan

7. subjectTopicValidation object that confirms whether this PDF is relevant to the selected hierarchy.
8. structuredContent object according to detected tool/content.

Selected upload metadata (must be validated against PDF):
- class: ${selectedClass || '(not provided)'}
- subject: ${selectedSubject || '(not provided)'}
- topic: ${selectedTopic || '(not provided)'}
- subtopic: ${selectedSubTopic || '(not provided)'}
- selectedTool: ${selectedToolLabel || '(not provided)'}

Generate STRICTLY and ONLY content for the selected tool.
Do not generate introductions.
Do not generate topic headings.
Do not generate repeated chapter names.
Do not generate explanations unless the selected tool requires explanations.
Do not generate generic filler content.
Return only final educational content for the selected tool.
${selectedToolHint}

Return strict JSON exactly in this shape:
{
  "class": "string",
  "subject": "string",
  "topic": "string",
  "subtopic": "string",
  "bestMatchingTool": "string",
  "contentType": "string",
  "subjectTopicValidation": {
    "subjectMatched": true,
    "topicMatched": true,
    "reason": "string",
    "confidence": 0.0
  },
  "structuredContent": {}
}

PDF Content:
${pdfText.slice(0, 120000)}`;
}

export async function extractTextFromPdfBuffer(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    const raw = String(parsed?.text || '');
    return raw
      .replace(/\r/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .filter(Boolean)
      .join('\n')
      .trim();
  } finally {
    await parser.destroy().catch(() => {});
  }
}

function normalizeContentType(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const key = raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  if (key.includes('concept')) return 'Concept Notes';
  if (key.includes('flash')) return 'Flashcards';
  if (key.includes('lesson')) return 'Lesson Plan';
  if (key.includes('daily')) return 'Daily Plan';
  if (key.includes('exam')) return 'Exam Paper';
  if (key.includes('activity')) return 'Activity Plan';
  if (key.includes('work')) return 'Worksheet';
  if (key.includes('mcq')) return 'MCQ';
  if (key.includes('homework')) return 'Homework';
  if (key.includes('rubric')) return 'Rubric';
  if (key.includes('story') || key.includes('passage')) return 'Story';
  if (key.includes('summary')) return 'Summary';
  if (key.includes('note')) return 'Notes';
  return raw;
}

export function validateToolSpecificStructuredContent(toolSlug, structuredContent, contentType, sourceText = '') {
  const normalizedTool = String(toolSlug || '').trim();
  const normalizedType = normalizeContentType(contentType);
  const rule = TOOL_STRUCTURED_RULES[normalizedTool];
  if (!rule) {
    return {
      valid: false,
      message: 'Unsupported content type for selected tool.',
      normalizedType,
    };
  }
  const allowed = rule.allowedTypes.map((type) => normalizeContentType(type));
  const defaultType = normalizeContentType(CONTENT_TYPE_BY_TOOL_SLUG[normalizedTool]);
  const resolvedType = normalizedType || defaultType;
  const { normalizedStructuredContent } = normalizeStructuredContentByTool(
    normalizedTool,
    structuredContent,
    resolvedType,
    sourceText,
  );
  if (!allowed.includes(resolvedType)) {
    return {
      valid: false,
      message: `Detected content type "${resolvedType}" is not allowed for selected tool.`,
      normalizedType: resolvedType,
      normalizedStructuredContent,
    };
  }
  if (!normalizedStructuredContent || typeof normalizedStructuredContent !== 'object' || Array.isArray(normalizedStructuredContent)) {
    return {
      valid: false,
      message: 'Structured content must be a JSON object.',
      normalizedType: resolvedType,
      normalizedStructuredContent,
    };
  }
  if (!rule.validate(normalizedStructuredContent)) {
    return {
      valid: false,
      message: rule.message,
      normalizedType: resolvedType,
      normalizedStructuredContent,
    };
  }
  return { valid: true, message: '', normalizedType: resolvedType, normalizedStructuredContent };
}

function validateStrictToolQuality(toolSlug, normalizedStructuredContent) {
  const slug = String(toolSlug || '').trim();
  if (slug === 'worksheet-mcq-generator') {
    const questions = sanitizeWorksheetQuestions(toQuestionArray(normalizedStructuredContent?.questions || []));
    if (questions.length < 3) {
      return { valid: false, reason: 'MCQ/Worksheet must include at least 3 valid questions.' };
    }
    const badFormat = questions.find((q) => q.options.length < 4 || !q.answer);
    if (badFormat) {
      return { valid: false, reason: 'Each MCQ must include four options and a correct answer.' };
    }
  }
  return { valid: true, reason: '' };
}

export function buildRenderableContent(toolSlug, contentType, structuredContent) {
  const type = normalizeContentType(contentType) || normalizeContentType(CONTENT_TYPE_BY_TOOL_SLUG[String(toolSlug || '').trim()]);
  const source = structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)
    ? structuredContent
    : {};

  if (toolSlug === 'worksheet-mcq-generator' || toolSlug === 'homework-creator') {
    const cleanedQuestions = sanitizeWorksheetQuestions(toQuestionArray(source.questions || source.mcqs || source.items || []));
    return {
      kind: 'questionSet',
      title: type || 'Worksheet',
      questions: cleanedQuestions,
    };
  }
  if (toolSlug === 'concept-mastery-helper' || toolSlug === 'short-notes-summaries-maker') {
    return {
      kind: 'notes',
      title: type || 'Notes',
      sections: (Array.isArray(source.concepts) ? source.concepts : source.headings || []).map((entry) => ({
        heading: String(entry?.title || entry?.heading || entry || '').trim(),
        explanation: String(entry?.explanation || entry?.description || '').trim(),
      })),
      keyPoints: toStringList(source.keyPoints),
    };
  }
  if (toolSlug === 'story-passage-creator') {
    return {
      kind: 'story',
      title: String(source.title || 'Story').trim(),
      passage: String(source.content || source.passage || '').trim(),
      questions: toQuestionArray(source.questions || []),
    };
  }
  if (toolSlug === 'lesson-planner' || toolSlug === 'daily-class-plan-maker') {
    return {
      kind: 'lessonPlan',
      title: type || 'Lesson Plan',
      objectives: toStringList(source.objectives),
      activities: toStringList(source.activities),
      timeline: toStringList(source.timeline),
      assessment: String(source.assessment || '').trim(),
    };
  }
  if (toolSlug === 'flashcard-generator') {
    return {
      kind: 'flashcards',
      title: type || 'Flashcards',
      cards: (Array.isArray(source.cards) ? source.cards : [])
        .map((card) => ({
          front: String(card?.front || '').trim(),
          back: String(card?.back || '').trim(),
        }))
        .filter((card) => card.front && card.back),
    };
  }
  if (toolSlug === 'rubrics-evaluation-generator') {
    return {
      kind: 'rubric',
      title: type || 'Rubric',
      criteria: toStringList(source.criteria),
      gradingScale: toStringList(source.gradingScale),
    };
  }
  if (toolSlug === 'exam-question-paper-generator') {
    return {
      kind: 'examPaper',
      title: type || 'Exam Paper',
      sections: (Array.isArray(source.sections) ? source.sections : []).map((section) => ({
        sectionName: String(section?.sectionName || section?.title || 'Section').trim(),
        questions: toQuestionArray(section?.questions || []),
      })),
    };
  }
  if (toolSlug === 'activity-project-generator') {
    return {
      kind: 'activity',
      title: String(source.title || type || 'Activity').trim(),
      materials: toStringList(source.materials),
      steps: toStringList(source.steps),
      learningOutcome: String(source.learningOutcome || '').trim(),
    };
  }

  return {
    kind: 'notes',
    title: type || 'Generated Content',
    sections: [
      {
        heading: 'Content',
        explanation: String(source.content || source.text || source.summary || '').trim(),
      },
    ],
    keyPoints: [],
  };
}

export async function classifyPdfContentWithGemini(pdfText, selected = {}) {
  if (!pdfText || !pdfText.trim()) {
    throw new Error('No extractable text found in PDF');
  }

  const prompt = buildPrompt(pdfText, selected);
  const selectedToolSlug = String(selected.toolType || '').trim();
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const raw = await geminiService.generateStructuredContent(prompt, 'json');
      const json = extractJsonObject(raw);
      const candidate = {
        classLabel: String(json.class || '').trim(),
        subject: String(json.subject || '').trim(),
        topic: String(json.topic || '').trim(),
        subTopic: String(json.subtopic || '').trim(),
        bestMatchingToolLabel: String(json.bestMatchingTool || '').trim(),
        contentType: normalizeContentType(json.contentType),
        structuredContent: json.structuredContent && typeof json.structuredContent === 'object'
          ? json.structuredContent
          : {},
        subjectTopicValidation: {
          subjectMatched: Boolean(json?.subjectTopicValidation?.subjectMatched),
          topicMatched: Boolean(json?.subjectTopicValidation?.topicMatched),
          reason: String(json?.subjectTopicValidation?.reason || '').trim(),
          confidence: Number(json?.subjectTopicValidation?.confidence || 0),
        },
        rawGemini: json,
      };
      if (selectedToolSlug) {
        const structural = validateToolSpecificStructuredContent(
          selectedToolSlug,
          candidate.structuredContent,
          candidate.contentType || CONTENT_TYPE_BY_TOOL_SLUG[selectedToolSlug] || '',
          '',
        );
        if (!structural.valid) {
          throw new Error(`Tool-format mismatch: ${structural.message}`);
        }
        const quality = validateStrictToolQuality(selectedToolSlug, structural.normalizedStructuredContent);
        if (!quality.valid) {
          throw new Error(`Tool-quality mismatch: ${quality.reason}`);
        }
        candidate.structuredContent = structural.normalizedStructuredContent || candidate.structuredContent;
        candidate.contentType = structural.normalizedType || candidate.contentType;
      }
      return candidate;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(lastError?.message || 'Gemini classification failed');
}

export async function regenerateStructuredContentForTool(pdfText, selected = {}) {
  const toolSlug = String(selected.toolType || '').trim();
  if (!toolSlug) throw new Error('toolType is required for regeneration');
  const toolLabel = getToolLabelFromSlug(toolSlug);
  const contentType = CONTENT_TYPE_BY_TOOL_SLUG[toolSlug] || 'Notes';
  const strictHint = TOOL_STRICT_OUTPUT_HINTS[toolSlug] || 'Return only tool-specific educational content.';

  const prompt = `You are generating educational content from extracted PDF text.

Selected Tool: ${toolLabel}
Selected Content Type: ${contentType}

${strictHint}

Return ONLY valid JSON:
{
  "contentType": "${contentType}",
  "structuredContent": {}
}

For worksheet/mcq tools, structuredContent must include:
{
  "type": "MCQ",
  "questions": [
    { "question": "string", "options": ["A","B","C","D"], "answer": "string" }
  ]
}

Extracted PDF text:
${String(pdfText || '').slice(0, 120000)}
`;

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const raw = await geminiService.generateStructuredContent(prompt, 'json');
      const json = extractJsonObject(raw);
      return {
        contentType: normalizeContentType(json.contentType || contentType),
        structuredContent:
          json.structuredContent && typeof json.structuredContent === 'object' && !Array.isArray(json.structuredContent)
            ? json.structuredContent
            : {},
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(lastError?.message || 'Tool regeneration failed');
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsKeyword(normalizedText, value) {
  const needle = normalizeText(value);
  if (!needle) return true;
  return normalizedText.includes(needle);
}

export async function classifyPdfContentWithFallback(pdfText, selected = {}) {
  try {
    const result = await classifyPdfContentWithGemini(pdfText, selected);
    return { ...result, analysisMode: 'gemini', isFallback: false };
  } catch (error) {
    const message = String(error?.message || '');
    const isQuotaIssue = /\b429\b|quota|resource_exhausted/i.test(message);
    if (!isQuotaIssue) throw error;

    const selectedToolSlug = String(selected.toolType || '').trim();
    const selectedTopic = String(selected.topic || selected.chapter || '').trim();
    const selectedSubject = String(selected.subject || '').trim();
    const selectedClass = String(selected.classLabel || '').trim();
    const selectedSubTopic = String(selected.subTopic || '').trim();
    const normalizedPdf = normalizeText(pdfText);
    const subjectMentioned = containsKeyword(normalizedPdf, selectedSubject);
    const topicMentioned = containsKeyword(normalizedPdf, selectedTopic);

    return {
      classLabel: selectedClass,
      subject: selectedSubject,
      topic: selectedTopic,
      subTopic: selectedSubTopic,
      bestMatchingToolLabel: getToolLabelFromSlug(selectedToolSlug),
      contentType: CONTENT_TYPE_BY_TOOL_SLUG[selectedToolSlug] || 'Notes',
      structuredContent: {
        mode: 'fallback',
        note: 'Gemini quota exceeded; saved with selected metadata and lightweight text validation.',
      },
      subjectTopicValidation: {
        subjectMatched: subjectMentioned,
        topicMatched: topicMentioned,
        reason: 'Fallback lexical validation based on PDF text keyword presence.',
        confidence: 0.35,
      },
      rawGemini: {},
      analysisMode: 'fallback',
      isFallback: true,
      fallbackReason: 'Gemini quota exceeded',
      fallbackValidation: {
        subjectMentioned,
        topicMentioned,
      },
    };
  }
}

export function resolveToolSlugFromLabel(label) {
  const key = normalizeToolKey(label);
  return TOOL_ALIAS_TO_SLUG[key] || '';
}

export function getToolLabelFromSlug(slug) {
  return TOOL_LABEL_BY_SLUG[slug] || slug;
}

