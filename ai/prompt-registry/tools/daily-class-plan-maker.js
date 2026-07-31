import { createToolPromptPack } from '../../prompt-engine/create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'daily-class-plan-maker',
  toolTitle: 'Daily Class Plan Maker',
  focus: 'Full school day plan across periods — timings, methods, activities, exit tickets, reflection.',
  includeTeacherScript: true,
  includeEngagement: true,
  includeDifferentiation: true,
  generationRules: [
    'DAILY CLASS PLAN — 9 SECTIONS (NOT lesson planner):',
    'day_period_topic_breakup: period-wise table (Time | Class | Subject | Subtopic chunk | Goal).',
    'objectives[]: per period, measurable.',
    'teaching_methods[]: named method per period with rationale.',
    'classroom_activity[]: specific activity with duration.',
    'exit_ticket: one per period or end-of-day synthesis.',
    'differentiated_support: how plan shifts if periods run short.',
    'homework_followup: link to previous day + tonight tasks.',
    'teaching_aids[]: consolidated list for the day.',
    'teacher_reflection_notes: end-of-day prompts for teacher journal.',
    'Do NOT use lesson_name, introduction_warmup, teaching_strategy as primary fields.',
  ],
  rewriteRules: [
    'Use 9-section daily plan schema only. day_period_topic_breakup must have real periods.',
  ],
});
