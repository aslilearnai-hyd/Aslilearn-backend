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
    '',
    // These 5 canonical sections are required by the validator (100% fill rule)
    // but were never named in this prompt, so the model had no reason to emit
    // them and every record failed at 6/13. Field keys given explicitly.
    'ALSO REQUIRED — emit all of these fields:',
    'prior_knowledge_readiness_check: what the student should already know before starting, as a 2–3 item readiness check.',
    'concept_learning_slot: the study block where the concept is FIRST learned (not revised) — name the technique and the source pages.',
    'breaks_focus_tips: specific break activities and focus techniques (movement, hydration, screen rule), not generic "take a break".',
    'ncf_competency_alignment: the NCF/NEP competency this schedule builds, in plain language.',
    'expected_learning_outcomes: 3 measurable things the student can do after completing the schedule.',
  ],
  rewriteRules: [
    'Every time slot must name an active study action — never "study chapter".',
  ],
});
