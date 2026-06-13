import { getSectionFallbackRules } from '../config/aiToolTemplates.js';

const MIN_LEN = 4;

function isMeaningfulContent(value) {
  if (value == null) return false;
  if (Array.isArray(value)) {
    return value.some((x) => {
      if (x && typeof x === 'object') {
        return Object.values(x).some((v) => String(v ?? '').trim().length >= MIN_LEN);
      }
      return String(x ?? '').trim().length >= MIN_LEN;
    });
  }
  if (typeof value === 'object') {
    return Object.values(value).some((v) => String(v ?? '').trim().length >= MIN_LEN);
  }
  return String(value).trim().length >= MIN_LEN;
}

function isMeaningfulScalar(value) {
  return String(value ?? '').trim().length >= MIN_LEN;
}

function copyMeaningfulField(target, targetKey, source, sourceKeys) {
  if (isMeaningfulContent(target[targetKey])) return;
  for (const srcKey of sourceKeys) {
    const val = source[srcKey];
    if (!isMeaningfulContent(val)) continue;
    target[targetKey] = Array.isArray(val) ? [...val] : val;
    return;
  }
}

/** Map alternate field names using template sectionFallbackRules before all-fields validation. */
export function applyAiGeneratorSectionFallbacks(toolSlug, data) {
  const rules = getSectionFallbackRules(toolSlug);
  const out = data && typeof data === 'object' && !Array.isArray(data) ? { ...data } : {};
  if (!rules.length) return out;

  const aliasTargets = {
    teacher_instructions: ['teacherInstructions'],
    student_instructions: ['studentInstructions'],
    step_by_step_procedure: ['steps', 'procedure'],
    assessment_criteria_rubric: ['assessmentRubric'],
    expected_learning_outcomes: ['expectedLearningOutcomes', 'learningOutcome'],
    learning_objectives: ['learningObjectives'],
    teaching_activities: ['activities', 'classroom_activities', 'lesson_activities'],
    teacher_talk_points: ['teacher_instructions', 'teacher_talk'],
    student_tasks: ['student_instructions'],
    formative_assessment_questions: ['formative_questions', 'assessment'],
    teaching_aids_required: ['materials_required', 'materials', 'teaching_aids'],
    homework_practice: ['homework', 'practice'],
    closure_exit_ticket: ['exit_ticket', 'reflection_exit_ticket'],
    introduction_warmup: ['warmup', 'warm_up'],
    teaching_strategy: ['pedagogy', 'methodology_summary'],
    differentiation_plan: ['differentiation', 'udl_support'],
    prior_knowledge_diagnostic: ['prior_knowledge', 'diagnostic_question'],
    practice_questions: ['questions'],
  };

  for (const rule of rules) {
    const targets = Array.isArray(rule.ifEmpty) ? rule.ifEmpty : [];
    const sources = Array.isArray(rule.use) ? rule.use : [];
    for (const target of targets) {
      copyMeaningfulField(out, target, out, sources);
      for (const alias of aliasTargets[target] || []) {
        copyMeaningfulField(out, alias, out, [target, ...sources]);
      }
      if (rule.synthesize === 'split_into_bullets' && !isMeaningfulContent(out[target])) {
        const srcVal = sources.map((k) => out[k]).find((v) => isMeaningfulContent(v));
        if (typeof srcVal === 'string' && srcVal.trim()) {
          out[target] = srcVal
            .split(/[;\n•]+/)
            .map((s) => s.replace(/^[-*]\s*/, '').trim())
            .filter((s) => isMeaningfulScalar(s));
        }
      }
      if (rule.synthesize === 'from_time_slots' && !isMeaningfulContent(out[target])) {
        const slots = Array.isArray(out.time_slots) ? out.time_slots : [];
        const lines = slots
          .map((ts) => {
            if (!ts || typeof ts !== 'object') return '';
            const t = String(ts.time || ts.duration || ts.slot || '').trim();
            const a = String(ts.activity || ts.task || ts.topic || ts.description || '').trim();
            if (t && a) return `${t}: ${a}`;
            return a || t;
          })
          .filter((s) => isMeaningfulScalar(s));
        if (lines.length) out[target] = lines;
      }
    }
  }

  for (const [target, aliases] of Object.entries(aliasTargets)) {
    copyMeaningfulField(out, target, out, aliases);
    for (const alias of aliases) {
      copyMeaningfulField(out, alias, out, [target, ...aliases]);
    }
  }

  return out;
}
