import ChatSession from '../models/ChatSession.js';
import VidyaCallLog from '../models/VidyaCallLog.js';
import { buildSystemPrompt, sanitizeUserFacingError, stripModelLeaks } from './vidya-persona.js';
import { callModel, streamGeminiModel, buildContentsFromHistory } from './model-router.js';
import { retrieveLibraryChunks, buildCitations } from './vidya-retriever.js';
import {
  buildRecentActivity,
  buildUserProfileSnapshot,
  buildPlatformSnapshotForVidya,
} from './vidya-context.js';
import { buildStudentAiContext } from './vidya-student/student-ai-context-engine.js';

const ROLE_NORMALISE = (role) => {
  const r = String(role || '').toLowerCase().trim();
  if (r === 'admin') return 'school-admin';
  if (r === 'super-admin' || r === 'superadmin') return 'super-admin';
  if (r === 'teacher') return 'teacher';
  if (r === 'student') return 'student';
  return r || 'unknown';
};

const truncate = (text, n = 600) => String(text || '').slice(0, n);

const loadOrCreateSession = async ({ userId, sessionId, role, context }) => {
  if (sessionId) {
    const existing = await ChatSession.findById(sessionId).catch(() => null);
    if (existing && String(existing.userId) === String(userId)) {
      return existing;
    }
  }
  const recent = await ChatSession.findOne({ userId, archived: false })
    .sort({ updatedAt: -1 })
    .catch(() => null);
  if (recent) {
    const stale = Date.now() - new Date(recent.updatedAt).getTime() > 30 * 60 * 1000;
    if (!stale) return recent;
  }
  const session = new ChatSession({
    userId,
    role,
    context: {
      currentSubject: context?.currentSubject || '',
      currentTopic: context?.currentTopic || '',
      currentClass: context?.currentClass || context?.studentClass || '',
      studentName: context?.studentName || '',
      seedSource: context?.seedSource || '',
      meta: context?.meta || {},
    },
    messages: [],
  });
  await session.save();
  return session;
};

const buildContext = async ({ userId, role, providedContext }) => {
  const profile = await buildUserProfileSnapshot(userId);
  const recentActivity = await buildRecentActivity(userId);
  const rawRole = String(role || profile?.role || 'student').toLowerCase().trim();
  let platformSnapshot = null;
  if (['super-admin', 'admin', 'school-admin'].includes(rawRole)) {
    platformSnapshot = await buildPlatformSnapshotForVidya({
      viewerRole: rawRole,
      viewerUserId: userId,
    });
  }

  const ctx = {
    studentName: providedContext?.studentName || profile?.studentName || '',
    classLevel: providedContext?.studentClass || providedContext?.currentClass || profile?.classLevel || '',
    subject: providedContext?.currentSubject || '',
    topic: providedContext?.currentTopic || '',
    role: ROLE_NORMALISE(role || profile?.role || 'student'),
    recentActivity,
    platformSnapshot,
  };

  if (ROLE_NORMALISE(role || profile?.role || 'student') === 'student') {
    try {
      const studentCtx = await buildStudentAiContext({
        viewerRole: 'student',
        viewerUserId: userId,
        studentId: userId,
      });
      if (studentCtx.ok) {
        // Extract weak topic names from questionAnalytics across recent exams
        const allResults = studentCtx.exams?.recentResults || [];
        const topicErrorMap = {};
        for (const result of allResults.slice(0, 10)) {
          const qa = Array.isArray(result.questionAnalytics) ? result.questionAnalytics : [];
          for (const q of qa) {
            if (!q.isCorrect && q.chapter) {
              topicErrorMap[q.chapter] = (topicErrorMap[q.chapter] || 0) + 1;
            }
          }
        }
        const weakTopicNames = Object.entries(topicErrorMap)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([chapter]) => chapter);

        ctx.studentExamSummary = {
          recentResults: allResults.slice(0, 5),
          weakTopics: weakTopicNames,
          riskLevel: studentCtx.risk?.riskLevel || null, // correct key is "risk" not "riskReport"
        };
      }
    } catch (_) {
      // keep context best-effort to avoid blocking chat
    }
  }
  return ctx;
};

const persistMessage = async (session, message) => {
  session.appendMessage(message);
  await session.save();
};

const writeLog = async (record) => {
  try {
    await VidyaCallLog.create({
      ...record,
      promptPreview: truncate(record.prompt, 500),
      responsePreview: truncate(record.response, 500),
    });
  } catch (err) {
    console.warn('Failed to write VidyaCallLog:', err.message);
  }
};

const buildPromptAndContents = async ({
  userMessage,
  ctx,
  session,
  attachments = [],
}) => {
  const retrieval = await retrieveLibraryChunks({
    query: userMessage,
    subject: ctx.subject,
    classLabel: ctx.classLevel,
  }).catch((err) => {
    console.warn('Retrieval failed:', err.message);
    return { chunks: [], topScore: 0, priorityTier: 3 };
  });

  const systemInstruction = buildSystemPrompt({
    role: ctx.role,
    studentName: ctx.studentName,
    classLevel: ctx.classLevel,
    subject: ctx.subject,
    topic: ctx.topic,
    retrievedChunks: retrieval.chunks,
    recentActivity: ctx.recentActivity,
    platformSnapshot: ctx.platformSnapshot,
    studentExamSummary: ctx.studentExamSummary,
  });

  const contents = buildContentsFromHistory({
    history: session.messages.slice(-8),
    userMessage,
    attachments,
  });

  return { systemInstruction, contents, retrieval };
};

export const handleChat = async ({
  userId,
  role,
  message,
  context: providedContext = {},
  sessionId,
  requestIp = '',
  userAgent = '',
}) => {
  if (!userId) throw new Error('userId is required for Vidya chat');
  if (!message || !String(message).trim()) {
    const e = new Error('Please type a question for Vidya.');
    e.statusCode = 400;
    throw e;
  }

  const startedAt = Date.now();
  const ctx = await buildContext({ userId, role, providedContext });
  const session = await loadOrCreateSession({
    userId,
    sessionId,
    role: ctx.role,
    context: providedContext,
  });

  await persistMessage(session, {
    role: 'user',
    content: String(message),
    timestamp: new Date(),
  });

  const { systemInstruction, contents, retrieval } = await buildPromptAndContents({
    userMessage: message,
    ctx,
    session,
  });

  let modelResult;
  let logRecord = {
    userId: String(userId),
    role: ctx.role,
    sessionId: String(session._id),
    route: 'chat',
    prompt: String(message),
    response: '',
    model: '',
    provider: 'unknown',
    fallbackChain: [],
    latencyMs: 0,
    retrieverUsed: retrieval.chunks.length > 0,
    chunkIds: retrieval.chunks.map((c) => String(c._id || '')).filter(Boolean),
    chunkScores: retrieval.chunks.map((c) => Number(c.score || 0)),
    priorityTier: retrieval.priorityTier,
    subject: ctx.subject,
    classLabel: ctx.classLevel,
    topic: ctx.topic,
    success: false,
    requestIp,
    userAgent,
  };

  try {
    modelResult = await callModel({
      systemInstruction,
      contents,
      generationConfig: { temperature: 0.4, maxOutputTokens: 1400 },
    });
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    logRecord = {
      ...logRecord,
      latencyMs: elapsed,
      success: false,
      error: String(err?.message || err).slice(0, 1000),
      fallbackChain: err?.fallbackChain || [],
      safetyBlocked: Boolean(err?.safety),
      safetyDetails: err?.safety || null,
    };
    await writeLog(logRecord);
    const userMessage = sanitizeUserFacingError(err);
    const wrapped = new Error(userMessage);
    wrapped.statusCode = err?.statusCode || 502;
    wrapped.retryable = true;
    throw wrapped;
  }

  const cleanText = stripModelLeaks(modelResult.text);
  const elapsed = Date.now() - startedAt;
  const citations = buildCitations(retrieval.chunks);

  await persistMessage(session, {
    role: 'assistant',
    content: cleanText,
    model: modelResult.modelName,
    citations,
    timestamp: new Date(),
  });

  if (!session.title || session.title.startsWith('New conversation')) {
    session.title = String(message).trim().slice(0, 60);
    await session.save();
  }

  await writeLog({
    ...logRecord,
    response: cleanText,
    model: modelResult.modelName,
    provider: modelResult.provider,
    fallbackChain: modelResult.fallbackChain || [],
    latencyMs: elapsed,
    success: true,
  });

  return {
    success: true,
    sessionId: String(session._id),
    message: cleanText,
    citations,
    priorityTier: retrieval.priorityTier,
    model: modelResult.provider,
    fallbackUsed: modelResult.provider !== 'gemini',
    latencyMs: elapsed,
  };
};

export const handleStreamingChat = async ({
  userId,
  role,
  message,
  context: providedContext = {},
  sessionId,
  res,
  requestIp = '',
  userAgent = '',
}) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event, data) => {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (_) {}
  };

  if (!userId || !message || !String(message).trim()) {
    send('error', { message: 'Please type a question for Vidya.' });
    res.end();
    return;
  }

  const startedAt = Date.now();
  const ctx = await buildContext({ userId, role, providedContext });
  const session = await loadOrCreateSession({
    userId,
    sessionId,
    role: ctx.role,
    context: providedContext,
  });

  await persistMessage(session, {
    role: 'user',
    content: String(message),
    timestamp: new Date(),
  });

  const { systemInstruction, contents, retrieval } = await buildPromptAndContents({
    userMessage: message,
    ctx,
    session,
  });

  send('session', { sessionId: String(session._id) });
  if (retrieval.chunks.length > 0) {
    send('citations', { citations: buildCitations(retrieval.chunks), priorityTier: retrieval.priorityTier });
  } else {
    send('citations', { citations: [], priorityTier: retrieval.priorityTier });
  }

  let collected = '';
  let modelInfo = null;

  try {
    const result = await streamGeminiModel({
      systemInstruction,
      contents,
      generationConfig: { temperature: 0.4, maxOutputTokens: 1400 },
      onToken: (piece) => {
        const cleaned = stripModelLeaks(piece);
        collected += cleaned;
        send('token', { text: cleaned });
      },
      onSafety: (safety) => {
        send('safety', safety);
      },
    });
    modelInfo = result;
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    await writeLog({
      userId: String(userId),
      role: ctx.role,
      sessionId: String(session._id),
      route: 'chat-stream',
      prompt: String(message),
      response: collected,
      model: '',
      provider: 'unknown',
      fallbackChain: err?.fallbackChain || [],
      latencyMs: elapsed,
      retrieverUsed: retrieval.chunks.length > 0,
      chunkIds: retrieval.chunks.map((c) => String(c._id || '')).filter(Boolean),
      chunkScores: retrieval.chunks.map((c) => Number(c.score || 0)),
      priorityTier: retrieval.priorityTier,
      subject: ctx.subject,
      classLabel: ctx.classLevel,
      topic: ctx.topic,
      success: false,
      error: String(err?.message || err).slice(0, 1000),
      safetyBlocked: Boolean(err?.safety),
      safetyDetails: err?.safety || null,
      requestIp,
      userAgent,
    });
    send('error', { message: sanitizeUserFacingError(err), retryable: true });
    res.end();
    return;
  }

  const elapsed = Date.now() - startedAt;
  const citations = buildCitations(retrieval.chunks);

  await persistMessage(session, {
    role: 'assistant',
    content: collected,
    model: modelInfo?.modelName || '',
    citations,
    timestamp: new Date(),
  });

  if (!session.title || session.title.startsWith('New conversation')) {
    session.title = String(message).trim().slice(0, 60);
    await session.save();
  }

  await writeLog({
    userId: String(userId),
    role: ctx.role,
    sessionId: String(session._id),
    route: 'chat-stream',
    prompt: String(message),
    response: collected,
    model: modelInfo?.modelName || '',
    provider: modelInfo?.provider || 'gemini',
    fallbackChain: modelInfo?.fallbackChain || [],
    latencyMs: elapsed,
    retrieverUsed: retrieval.chunks.length > 0,
    chunkIds: retrieval.chunks.map((c) => String(c._id || '')).filter(Boolean),
    chunkScores: retrieval.chunks.map((c) => Number(c.score || 0)),
    priorityTier: retrieval.priorityTier,
    subject: ctx.subject,
    classLabel: ctx.classLevel,
    topic: ctx.topic,
    success: true,
    requestIp,
    userAgent,
  });

  send('done', {
    sessionId: String(session._id),
    model: modelInfo?.provider || 'gemini',
    fallbackUsed: (modelInfo?.provider || 'gemini') !== 'gemini',
    latencyMs: elapsed,
    priorityTier: retrieval.priorityTier,
  });
  res.end();
};

export const handleVisionAnalyse = async ({
  userId,
  role,
  imageBase64,
  context = '',
  requestIp = '',
  userAgent = '',
}) => {
  if (!imageBase64) {
    const e = new Error('Image is required.');
    e.statusCode = 400;
    throw e;
  }
  const startedAt = Date.now();
  const profile = await buildUserProfileSnapshot(userId);
  const normalisedRole = ROLE_NORMALISE(role || profile?.role || 'student');
  const systemInstruction = buildSystemPrompt({
    role: normalisedRole,
    studentName: profile?.studentName,
    classLevel: profile?.classLevel,
  });
  const contents = buildContentsFromHistory({
    history: [],
    userMessage: `Analyse this educational image and help the user. ${
      context ? 'Additional context: ' + context : ''
    } Provide: (1) what is in the image, (2) explanation/solution if applicable, (3) key takeaways.`,
    attachments: [{ mime: 'image/jpeg', data: imageBase64 }],
  });

  try {
    const result = await callModel({
      systemInstruction,
      contents,
      generationConfig: { temperature: 0.2, maxOutputTokens: 1400 },
    });
    const cleanText = stripModelLeaks(result.text);
    await writeLog({
      userId: String(userId || ''),
      role: normalisedRole,
      sessionId: '',
      route: 'vision',
      prompt: `[image] ${context || ''}`,
      response: cleanText,
      model: result.modelName,
      provider: result.provider,
      fallbackChain: result.fallbackChain || [],
      latencyMs: Date.now() - startedAt,
      retrieverUsed: false,
      priorityTier: 0,
      success: true,
      requestIp,
      userAgent,
    });
    return { analysis: cleanText, model: result.provider };
  } catch (err) {
    await writeLog({
      userId: String(userId || ''),
      role: normalisedRole,
      sessionId: '',
      route: 'vision',
      prompt: `[image] ${context || ''}`,
      response: '',
      model: '',
      provider: 'unknown',
      fallbackChain: err?.fallbackChain || [],
      latencyMs: Date.now() - startedAt,
      success: false,
      error: String(err?.message || err).slice(0, 1000),
      safetyBlocked: Boolean(err?.safety),
      safetyDetails: err?.safety || null,
      requestIp,
      userAgent,
    });
    const wrapped = new Error(sanitizeUserFacingError(err));
    wrapped.statusCode = err?.statusCode || 502;
    wrapped.retryable = true;
    throw wrapped;
  }
};

export const listChatSessions = async ({ userId, limit = 30 }) => {
  return ChatSession.find({ userId, archived: false })
    .sort({ updatedAt: -1 })
    .limit(Math.max(1, Math.min(100, limit)))
    .select('_id title role lastModelUsed messageCount context updatedAt createdAt')
    .lean();
};

export const getChatSession = async ({ userId, sessionId }) => {
  const s = await ChatSession.findById(sessionId).lean().catch(() => null);
  if (!s || String(s.userId) !== String(userId)) return null;
  return s;
};

export const deleteChatSession = async ({ userId, sessionId }) => {
  const s = await ChatSession.findById(sessionId);
  if (!s || String(s.userId) !== String(userId)) return false;
  s.archived = true;
  await s.save();
  return true;
};

export const seedDebriefSession = async ({ userId, role, examResult, suggestedQuestion }) => {
  const session = new ChatSession({
    userId: String(userId),
    role: ROLE_NORMALISE(role),
    title: `Debrief: ${examResult?.examTitle || 'recent exam'}`,
    context: {
      currentSubject: '',
      currentTopic: '',
      seedSource: 'exam-debrief',
      meta: {
        examId: examResult?._id ? String(examResult._id) : '',
        examTitle: examResult?.examTitle || '',
        scorePct: typeof examResult?.percentage === 'number' ? Math.round(examResult.percentage) : null,
      },
    },
    messages: [
      {
        role: 'assistant',
        content:
          suggestedQuestion ||
          `I noticed you finished "${examResult?.examTitle || 'your recent exam'}" with ${
            typeof examResult?.percentage === 'number' ? Math.round(examResult.percentage) + '%' : 'your score'
          }. Want to look at the questions you got wrong together?`,
        timestamp: new Date(),
      },
    ],
  });
  session.messageCount = session.messages.length;
  await session.save();
  return session;
};

export default {
  handleChat,
  handleStreamingChat,
  handleVisionAnalyse,
  listChatSessions,
  getChatSession,
  deleteChatSession,
  seedDebriefSession,
};
