import { createToolPromptPack } from '../create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'study-schedule-maker',
  toolTitle: 'Study Schedule Maker',
  focus: 'Student-friendly revision timetable with active study techniques, breaks, and self-check — not a generic hour list.',
  includeBloom: true,
  includeDifferentiation: true,
  includeEngagement: true,
  generationRules: [
    'STUDY SCHEDULE FOR STUDENTS:',
    '- Break subtopic into 20–30 minute study blocks with technique named (Pomodoro, recall, teach-back, flashcard sprint).',
    '- Each block: specific task ("Draw and label…", "Solve Q1–5 from…", "Explain aloud to mirror").',
    '- Include break activities and sleep reminder.',
    '- Self-check questions at end of each day.',
    '- Weekend consolidation task tied to subtopic.',
    '- Tone: coach-like, motivating — not commanding.',
    'Use lesson-plan schema fields but student-facing language throughout.',
  ],
  rewriteRules: [
    'Every time slot must name an active study action — never "study chapter".',
  ],
});
