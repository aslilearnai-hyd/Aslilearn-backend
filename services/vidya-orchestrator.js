/**
 * Vidya orchestrator v1 — single entry for all chat planes.
 * Delegates to existing implementations; unifies logging and tenant context.
 */
import vidyaService from './vidya-service.js';
import { handleControlAssistantTurn } from './vidya-ai-control-service.js';
import { runHybridStudentVidyaChat } from './vidya-student/hybrid-ai-chat-controller.js';
import { runHybridTeacherVidyaChat } from './vidya-teacher/teacher-hybrid-chat-controller.js';
import { classifyPlatformDataQuestion, enforceGroundingResult } from './vidya-platform-data-firewall.js';

const PLANES = Object.freeze({
  RAG: 'rag',
  RAG_STREAM: 'rag-stream',
  MENTOR_STUDENT: 'mentor-student',
  MENTOR_TEACHER: 'mentor-teacher',
  CONTROL: 'control',
  VISION: 'vision',
});

export { PLANES };

export async function handleVidyaTurn({ plane, req, res, body = {} }) {
  const tenant = req.vidyaTenant || {};
  const userId = req.userId || req.user?.userId || req.user?.id;
  const role = req.user?.role;

  switch (plane) {
    case PLANES.MENTOR_STUDENT: {
      const question = String(body.message || '').trim();
      const studentId = body.studentId ? String(body.studentId) : String(userId);
      const result = await runHybridStudentVidyaChat({
        viewerRole: role,
        viewerUserId: userId,
        studentId,
        question,
        history: Array.isArray(body.history) ? body.history : [],
        tenant,
      });
      return enforceGroundingResult(result, classifyPlatformDataQuestion(question, 'student'));
    }

    case PLANES.MENTOR_TEACHER: {
      const question = String(body.message || '').trim();
      const result = await runHybridTeacherVidyaChat({
        viewerUserId: userId,
        question,
        history: Array.isArray(body.history) ? body.history : [],
        tenant,
      });
      return enforceGroundingResult(result, classifyPlatformDataQuestion(question, 'teacher'));
    }

    case PLANES.RAG:
      return vidyaService.handleChat({
        userId,
        role,
        message: body.message,
        context: body.context || {},
        sessionId: body.sessionId,
        requestIp: req.ip || '',
        userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
        tenant,
      });

    case PLANES.RAG_STREAM:
      return vidyaService.handleStreamingChat({
        userId,
        role,
        message: body.message,
        context: body.context || {},
        sessionId: body.sessionId,
        res,
        requestIp: req.ip || '',
        userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
        tenant,
      });

    case PLANES.VISION:
      return vidyaService.handleVisionAnalyse({
        userId,
        role,
        imageBase64: body.imageBase64,
        context: body.context || '',
        requestIp: req.ip || '',
        userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
        tenant,
      });

    case PLANES.CONTROL: {
      const rawHistory = Array.isArray(body.history) ? body.history : [];
      const history = rawHistory
        .slice(-24)
        .map((h) => ({
          role: String(h.role || '').toLowerCase() === 'assistant' ? 'assistant' : 'user',
          content: String(h.content || '').slice(0, 6000),
        }))
        .filter((h) => h.content.trim());

      return handleControlAssistantTurn({
        userMessage: body.message,
        conversationHistory: history,
        viewerUserId: userId,
        viewerRole: role,
        requestIp: req.ip || '',
        userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
      });
    }

    default: {
      const err = new Error(`Unknown Vidya plane: ${plane}`);
      err.statusCode = 400;
      throw err;
    }
  }
}
