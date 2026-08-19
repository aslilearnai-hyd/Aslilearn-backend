import geminiService from '../gemini-service.js';
import { MODULE_REGISTRY } from './module-registry.js';
import {
  isReportsOverviewQuery,
  isHeadcountOverviewQuery,
  isPublishedCatalogQuery,
  extractSchoolNameQuery,
  isSchoolDetailQuery,
} from './school-overview-facts.js';
import {
  extractPersonNameQuery,
  isPersonDetailQuery,
  extractClassGroupQuery,
  isClassGroupQuery,
} from './entity-detail-facts.js';

function safeJson(raw) {
  let text = String(raw || '').trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s >= 0 && e > s) text = text.slice(s, e + 1);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const OPS = ['count', 'list', 'aggregate', 'distinct'];
const FILTER_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'regex', 'exists'];
const AGG_OPS = ['sum', 'avg', 'min', 'max', 'count'];
const TIMEFRAMES = ['today', 'this_week', 'this_month', 'last_7_days', 'all'];
const aliasList = Object.entries(MODULE_REGISTRY)
  .map(([k, v]) => `- ${k}: ${[k, ...(v.aliases || [])].join(', ')}`)
  .join('\n');

function parseTimeframeFromMessage(message) {
  const lower = String(message || '').toLowerCase();
  if (/last\s*7\s*days|past\s*7\s*days|previous\s*7\s*days/.test(lower)) return 'last_7_days';
  const daysMatch = lower.match(/last\s*(\d{1,3})\s*days?/);
  if (daysMatch) {
    const n = Math.min(365, Math.max(1, parseInt(daysMatch[1], 10)));
    return n === 7 ? 'last_7_days' : `last_${n}_days`;
  }
  if (/\btoday\b/.test(lower)) return 'today';
  if (/this week|weekly/.test(lower)) return 'this_week';
  if (/this month|monthly/.test(lower)) return 'this_month';
  return 'all';
}

function isGroupedBySchool(message) {
  return /(grouped?\s+by\s+school|group\s+by\s+school|per\s+school|by\s+school)/i.test(
    String(message || ''),
  );
}

function isPrimarilySchoolCount(message) {
  const lower = String(message || '').toLowerCase();
  if (isGroupedBySchool(lower)) return false;
  return /(how many schools|number of schools|total schools|count(?:\s+the)?\s+schools|schools (?:are|do) there)/i.test(
    lower,
  );
}

function buildMetricsGroupPlan({ module, message, preferredDateField = '', errMessage = '' }) {
  const bySchool = isGroupedBySchool(message);
  const isCount = /((how|who)\s*many|count|total|number of|are there|how much)/i.test(
    String(message || ''),
  );
  return {
    mode: 'database',
    module,
    operation: bySchool ? 'aggregate' : isCount ? 'count' : 'list',
    filters: [],
    selectFields: [],
    groupBy: bySchool ? ['school'] : [],
    aggregates: [{ func: 'count', field: '*', as: 'count' }],
    sort: [{ field: 'count', direction: 'desc' }],
    limit: bySchool ? 50 : 20,
    timeframe: parseTimeframeFromMessage(message),
    preferredDateField,
    clarification: '',
    parseWarning: errMessage ? `gemini_unavailable:${errMessage}` : `${module}_metrics_intent`,
  };
}

function tryBuildUsageOrAuditPlan(message, errMessage = '') {
  const lower = String(message || '').toLowerCase();
  if (/(audit\s*log|audit\s*entr|compliance\s*log)/i.test(lower)) {
    return buildMetricsGroupPlan({
      module: 'audit_logs',
      message,
      preferredDateField: 'at',
      errMessage,
    });
  }
  if (
    /(usage\s*analytics|ai\s*analytics|vidya\s*(call|usage)|analytics\s*entr|ai\s*usage|ai\s*conversation)/i.test(
      lower,
    )
  ) {
    return buildMetricsGroupPlan({
      module: 'analytics',
      message,
      preferredDateField: 'ts',
      errMessage,
    });
  }
  if (/(teacher\s*tool\s*usage|tool\s*usage)/i.test(lower)) {
    return buildMetricsGroupPlan({
      module: 'teacher_tool_usage',
      message,
      preferredDateField: 'createdAt',
      errMessage,
    });
  }
  if (/(weekly\s*impact|impact\s*snapshot|school\s*impact)/i.test(lower)) {
    return buildMetricsGroupPlan({
      module: 'impact_snapshots',
      message,
      preferredDateField: 'weekStart',
      errMessage,
    });
  }
  return null;
}
const GREETING_RE = /^(hi|hii|hiii|hello|hey|heya|yo|sup|good\s*(morning|afternoon|evening|night)|namaste|hola|thanks|thank\s*you|thx|bye|goodbye|how\s*are\s*you|what'?s\s*up)[\s!.?]*$/i;

function isGreetingOrSmallTalk(message) {
  const t = String(message || '').trim();
  if (!t) return false;
  if (t.split(/\s+/).length > 5) return false;
  // Affirmatives are follow-ups, not greetings
  if (isAffirmativeFollowUp(t)) return false;
  return GREETING_RE.test(t);
}

/** Short confirmations that must continue the previous control action — not a new DB search. */
function isAffirmativeFollowUp(message) {
  return /^(yes|yep|yeah|yup|sure|please|ok|okay|do it|go ahead|also|that too|both|assessments?(?:\s+too)?|videos?(?:\s+too)?)[\s!.?]*$/i.test(
    String(message || '').trim(),
  );
}

function lastHistoryTurn(history, role) {
  const hist = Array.isArray(history) ? history : [];
  for (let i = hist.length - 1; i >= 0; i -= 1) {
    const turn = hist[i];
    if (String(turn?.role || '').toLowerCase() !== role) continue;
    const content = String(turn?.content || '').trim();
    if (!content) continue;
    if (role === 'user' && isAffirmativeFollowUp(content)) continue;
    return content;
  }
  return '';
}

/**
 * Resolve "yes" / "ok" / "also assessments" against recent turns so we never
 * run a bare intent classifier on an empty affirmation.
 */
function tryResolveAffirmativeFollowUp(message, history) {
  if (!isAffirmativeFollowUp(message)) return null;

  const prevUser = lastHistoryTurn(history, 'user');
  const prevAssistant = lastHistoryTurn(history, 'assistant');

  if (prevUser && isPublishedCatalogQuery(prevUser)) {
    return buildCatalogCountsPlan('followup_catalog_prev_user');
  }
  if (
    prevUser &&
    /\b(videos?|assessments?|quizzes?|eduott)\b/i.test(prevUser) &&
    /count|total|number|show|published|how many/i.test(prevUser)
  ) {
    return buildCatalogCountsPlan('followup_catalog_prev_user_metric');
  }
  if (
    prevAssistant &&
    /(assessment|video count|separately|would you like|fetch the count|published videos|published assessments)/i.test(
      prevAssistant,
    )
  ) {
    return buildCatalogCountsPlan('followup_catalog_pending_offer');
  }
  if (prevUser && (isReportsOverviewQuery(prevUser) || isHeadcountOverviewQuery(prevUser))) {
    return buildOverviewPlan('followup_overview_prev_user');
  }
  // Last resort: re-interpret the previous user question as the real intent
  if (prevUser) {
    return buildHeuristicPlan(prevUser, 'followup_replay_prev_user');
  }
  return null;
}

function shouldUpgradeToCatalogCounts(message, module = '') {
  const lower = String(message || '').toLowerCase();
  const mod = String(module || '').toLowerCase();
  if (isPublishedCatalogQuery(message)) return true;
  if (['videos', 'assessments', 'library_content'].includes(mod)) return true;
  if (/\b(videos?|assessments?|quizzes?|eduott)\b/.test(lower) &&
    /((how|who)\s*many|count|total|number of|show|published|list)/.test(lower)) {
    return true;
  }
  return false;
}

function buildKnowledgePlan(errMessage = '', warning = 'greeting_or_small_talk') {
  return {
    mode: 'knowledge',
    module: '',
    operation: 'list',
    filters: [],
    selectFields: [],
    groupBy: [],
    aggregates: [],
    sort: [],
    limit: 20,
    timeframe: 'all',
    clarification: '',
    parseWarning: errMessage ? `gemini_unavailable:${errMessage}` : warning,
  };
}

function buildCatalogCountsPlan(errMessage = '') {
  const warning = String(errMessage || '').trim();
  return {
    mode: 'catalog_counts',
    module: 'videos',
    operation: 'count',
    filters: [],
    selectFields: [],
    groupBy: [],
    aggregates: [],
    sort: [],
    limit: 20,
    timeframe: 'all',
    clarification: '',
    parseWarning: warning
      ? warning.startsWith('followup_') || warning.startsWith('gemini_') || warning.startsWith('person_')
        ? warning
        : `gemini_unavailable:${warning}`
      : 'published_catalog_intent',
  };
}

function buildOverviewPlan(errMessage = '') {
  return {
    mode: 'overview',
    module: '',
    operation: 'overview',
    filters: [],
    selectFields: [],
    groupBy: [],
    aggregates: [],
    sort: [],
    limit: 20,
    timeframe: 'all',
    clarification: '',
    parseWarning: errMessage ? `gemini_unavailable:${errMessage}` : 'reports_overview_intent',
  };
}

function buildSchoolDetailPlan(schoolName, errMessage = '') {
  return {
    mode: 'school_detail',
    module: 'schools',
    operation: 'overview',
    schoolNameQuery: schoolName,
    filters: [{ field: 'name', op: 'regex', value: schoolName }],
    selectFields: [
      'name',
      'place',
      'phone',
      'contactPerson',
      'board',
      'curriculumBoard',
      'licensedStudents',
      'licensedTeachers',
      'isActive',
    ],
    groupBy: [],
    aggregates: [],
    sort: [],
    limit: 5,
    timeframe: 'all',
    clarification: '',
    parseWarning: errMessage ? `gemini_unavailable:${errMessage}` : 'school_detail_intent',
  };
}

function buildPersonDetailPlan(personName, roleHint = '', errMessage = '') {
  return {
    mode: 'person_detail',
    module: roleHint === 'teacher' ? 'teachers' : roleHint === 'admin' ? 'users' : 'students',
    operation: 'overview',
    personNameQuery: personName,
    personRoleHint: roleHint || '',
    filters: [{ field: 'fullName', op: 'regex', value: personName }],
    selectFields: ['fullName', 'classNumber', 'email', 'isActive'],
    groupBy: [],
    aggregates: [],
    sort: [],
    limit: 5,
    timeframe: 'all',
    clarification: '',
    parseWarning: errMessage ? `gemini_unavailable:${errMessage}` : 'person_detail_intent',
  };
}

function buildClassDetailPlan(classNumber, section = '', errMessage = '') {
  return {
    mode: 'class_detail',
    module: 'classes',
    operation: 'overview',
    classNumberQuery: classNumber,
    sectionQuery: section || '',
    filters: [
      { field: 'classNumber', op: 'eq', value: classNumber },
      ...(section ? [{ field: 'section', op: 'eq', value: section }] : []),
    ],
    selectFields: ['classNumber', 'section', 'name'],
    groupBy: [],
    aggregates: [],
    sort: [],
    limit: 20,
    timeframe: 'all',
    clarification: '',
    parseWarning: errMessage ? `gemini_unavailable:${errMessage}` : 'class_detail_intent',
  };
}

function buildSchoolSearchPlan(schoolName, errMessage = '') {
  return {
    mode: 'database',
    module: 'schools',
    operation: 'list',
    filters: [{ field: 'name', op: 'regex', value: schoolName }],
    selectFields: [
      'name',
      'place',
      'board',
      'curriculumBoard',
      'phone',
      'contactPerson',
      'isActive',
      'licensedStudents',
      'licensedTeachers',
    ],
    groupBy: [],
    aggregates: [],
    sort: [{ field: 'name', direction: 'asc' }],
    limit: 20,
    timeframe: 'all',
    clarification: '',
    parseWarning: errMessage ? `gemini_unavailable:${errMessage}` : 'school_search_intent',
  };
}

function buildHeuristicPlan(message, errMessage = '') {
  if (isGreetingOrSmallTalk(message)) {
    return buildKnowledgePlan(errMessage);
  }
  if (isReportsOverviewQuery(message) || isHeadcountOverviewQuery(message)) {
    return buildOverviewPlan(errMessage);
  }
  if (isPublishedCatalogQuery(message)) {
    return buildCatalogCountsPlan(errMessage);
  }

  const personEarly = extractPersonNameQuery(message);
  if (personEarly.name && isPersonDetailQuery(message)) {
    return buildPersonDetailPlan(personEarly.name, personEarly.roleHint, errMessage);
  }

  const classEarly = extractClassGroupQuery(message);
  if (classEarly.classNumber && isClassGroupQuery(message)) {
    return buildClassDetailPlan(classEarly.classNumber, classEarly.section, errMessage);
  }

  const namedSchool = extractSchoolNameQuery(message);
  if (namedSchool) {
    if (isSchoolDetailQuery(message) || /(details?|info|about|overview)/i.test(message)) {
      return buildSchoolDetailPlan(namedSchool, errMessage);
    }
    return buildSchoolSearchPlan(namedSchool, errMessage);
  }

  const metricsPlan = tryBuildUsageOrAuditPlan(message, errMessage);
  if (metricsPlan) return metricsPlan;

  const lower = String(message || '').toLowerCase();
  const classMatch = String(message || '').match(/class\s*(\d+)/i);
  const classNumber = classMatch ? classMatch[1] : '';
  const isCount = /((how|who)\s*many|count|total|number of|are there|how much)/i.test(lower);
  const asksOwnGeneratedContent =
    /(i generated|my generated|my content|content i generated|generated by me|created by me|upto now)/i.test(lower) &&
    /(content|generate|generated|generation)/i.test(lower);
  const isSchoolQuery = /(school|schools)/i.test(lower);
  const isGeneralKnowledge = /^(what is|what are|who is|who are|explain|define|meaning of|tell me about|why|how does|how do)/i.test(
    lower.trim()
  );
  const hasDbIntentWord = /(count|total|number of|list|show|display|records?|database|db|analytics|report|dashboard|highest|top|rank|breakdown|enrolled|active users?)/i.test(
    lower
  );
  const operation = isCount ? 'count' : 'list';
  /** @type {Array<{field:string,op:string,value:any}>} */
  const filters = [];

  let module = 'students';
  if (isPrimarilySchoolCount(lower) || (isSchoolQuery && !isGroupedBySchool(lower) && !/(student|teacher|exam|audit|analytics|usage|order|omr|video)/i.test(lower))) {
    module = 'schools';
  } else if (/(trial|individual account|b2c)/i.test(lower)) {
    module = 'trial_members';
  } else if (/(school order|product order|subscription order|\borders\b)/i.test(lower)) {
    module = 'school_orders';
  } else if (/(student|students|learner|learners|enrolled)/i.test(lower)) {
    module = 'students';
  } else if (/(teacher|teachers|faculty|staff)/i.test(lower)) {
    module = 'teachers';
  } else if (/(exam|exams)\b/i.test(lower) || (/\btest\b/i.test(lower) && !/\bschool\b/i.test(lower))) {
    module = 'exams';
  } else if (/(result|results|score|performance)/i.test(lower)) {
    module = 'results';
  } else if (/(attendance|present|absent)/i.test(lower)) {
    module = 'attendance';
  } else if (/(learning session|user session|session time|study session)/i.test(lower)) {
    module = 'learning_sessions';
  } else if (/(subject|subjects)/i.test(lower)) {
    module = 'subjects';
  } else if (/(class|classes|section|sections)/i.test(lower)) {
    module = 'classes';
  } else if (/(ai|generation|generations|request|requests)/i.test(lower)) {
    module = 'ai_tool_data';
  } else if (/(content|generated content|generated|generation|created content)/i.test(lower)) {
    module = 'ai_tool_data';
  } else if (/(notice|notices|announcement|event)/i.test(lower)) {
    module = 'notices';
  } else if (/(performance report|analysis report)/i.test(lower)) {
    module = 'performance_reports';
  } else if (/(report|reports|remark|remarks)/i.test(lower)) {
    module = 'reports';
  } else if (/(audit\s*log|audit\s*entr)/i.test(lower)) {
    module = 'audit_logs';
  } else if (/(usage\s*analytics|ai\s*analytics|analytics|vidya\s*usage)/i.test(lower)) {
    module = 'analytics';
  } else if (/(user|users|role|permission)/i.test(lower)) {
    module = 'users';
  } else if (/(video|videos|eduott|assessment|assessments|quiz|quizzes)/i.test(lower)) {
    // Never leave catalog metrics on a half-complete single-module plan
    return buildCatalogCountsPlan(errMessage);
  }

  if (module === 'ai_tool_data' && asksOwnGeneratedContent) {
    filters.push({ field: 'generatedBy', op: 'eq', value: '__viewer__' });
    filters.push({ field: 'teacherId', op: 'eq', value: '__viewer__' });
  }

  const hasExplicitModuleKeyword =
    module !== 'students' || /(student|students|learner|learners|enrolled)/i.test(lower);

  if (!hasExplicitModuleKeyword && isGeneralKnowledge && !hasDbIntentWord) {
    return {
      mode: 'knowledge',
      module: '',
      operation: 'list',
      filters: [],
      selectFields: [],
      groupBy: [],
      aggregates: [],
      sort: [],
      limit: 20,
      timeframe: 'all',
      clarification: '',
      parseWarning: errMessage ? `gemini_unavailable:${errMessage}` : 'intent_json_parse_failed',
    };
  }

  if (classNumber) filters.push({ field: 'classNumber', op: 'eq', value: classNumber });
  if (/\bactive\b/i.test(lower)) filters.push({ field: 'isActive', op: 'eq', value: true });

  // "users who logged in within the last 7 days" — not "entries were logged"
  if (
    /(logged?\s*in|last\s*login|have\s+logged|login\s+within)/i.test(lower) &&
    !/(entr(?:y|ies)\s+were\s+logged|records?\s+were\s+logged|analytics\s+entries)/i.test(lower)
  ) {
    const daysMatch = lower.match(/last\s*(\d{1,3})\s*days?/);
    const days = daysMatch ? Math.min(90, Math.max(1, parseInt(daysMatch[1], 10))) : 7;
    const loginModule = /(student|students)/i.test(lower)
      ? 'students'
      : /(teacher|teachers)/i.test(lower)
        ? 'teachers'
        : 'users';
    return {
      mode: 'database',
      module: loginModule,
      operation: isCount ? 'count' : 'list',
      filters: [
        ...filters.filter((f) => f.field !== 'lastLogin'),
        { field: 'lastLogin', op: 'gte', value: `days_ago_${days}` },
      ],
      selectFields:
        loginModule === 'teachers'
          ? ['fullName', 'email', 'phone', 'isActive', 'updatedAt']
          : ['fullName', 'email', 'role', 'classNumber', 'schoolName', 'isActive', 'lastLogin'],
      groupBy: [],
      aggregates: [],
      sort: [{ field: 'lastLogin', direction: 'desc' }],
      limit: 40,
      timeframe: 'all',
      dateField: 'lastLogin',
      clarification: '',
      parseWarning: errMessage ? `gemini_unavailable:${errMessage}` : 'login_activity_intent',
    };
  }

  if (module === 'exams') {
    if (/\b(active|upcoming|scheduled|running)\b/i.test(lower)) {
      filters.push({ field: 'isActive', op: 'eq', value: true });
    }
    if (/\b(active now|currently active|running now|live now|now active)\b/i.test(lower)) {
      filters.push({ field: 'startDate', op: 'lte', value: 'now' });
      filters.push({ field: 'endDate', op: 'gte', value: 'now' });
      filters.push({ field: 'isActive', op: 'eq', value: true });
    }
    if (/\b(active today|today active|today running)\b/i.test(lower)) {
      filters.push({ field: 'startDate', op: 'lte', value: 'today_end' });
      filters.push({ field: 'endDate', op: 'gte', value: 'today_start' });
      filters.push({ field: 'isActive', op: 'eq', value: true });
    }
    const examTypeMatch = lower.match(/\b(weekend|mains|advanced|practice)\b/);
    if (examTypeMatch) {
      filters.push({ field: 'examType', op: 'eq', value: examTypeMatch[1] });
    }
    const subjMatch = lower.match(/\b(maths|math|physics|chemistry|biology)\b/);
    if (subjMatch) {
      const subject = subjMatch[1] === 'math' ? 'maths' : subjMatch[1];
      filters.push({ field: 'subject', op: 'eq', value: subject });
    }

    if (/(which class|highest class|class has highest|class wise|class-wise|by class)/i.test(lower)) {
      return {
        mode: 'database',
        module: 'exams',
        operation: 'aggregate',
        filters,
        selectFields: [],
        groupBy: ['classNumber'],
        aggregates: [{ func: 'count', field: '*', as: 'examCount' }],
        sort: [{ field: 'examCount', direction: 'desc' }],
        limit: 10,
        timeframe: /today/i.test(lower) ? 'today' : /this week|weekly/i.test(lower) ? 'this_week' : 'all',
        clarification: '',
        parseWarning: errMessage ? `gemini_unavailable:${errMessage}` : 'intent_json_parse_failed',
      };
    }

    if (/(subject wise|subject-wise|by subject)/i.test(lower)) {
      return {
        mode: 'database',
        module: 'exams',
        operation: 'aggregate',
        filters,
        selectFields: [],
        groupBy: ['subject'],
        aggregates: [{ func: 'count', field: '*', as: 'examCount' }],
        sort: [{ field: 'examCount', direction: 'desc' }],
        limit: 10,
        timeframe: /today/i.test(lower) ? 'today' : /this week|weekly/i.test(lower) ? 'this_week' : 'all',
        clarification: '',
        parseWarning: errMessage ? `gemini_unavailable:${errMessage}` : 'intent_json_parse_failed',
      };
    }

    if (/(list|show|display|give|provide|get)/i.test(lower) && !isCount) {
      return {
        mode: 'database',
        module: 'exams',
        operation: 'list',
        filters,
        selectFields: ['title', 'classNumber', 'subject', 'examType', 'startDate', 'endDate', 'isActive'],
        groupBy: [],
        aggregates: [],
        sort: [{ field: 'startDate', direction: 'asc' }],
        limit: 20,
        timeframe: /today/i.test(lower) ? 'today' : /this week|weekly/i.test(lower) ? 'this_week' : 'all',
        clarification: '',
        parseWarning: errMessage ? `gemini_unavailable:${errMessage}` : 'intent_json_parse_failed',
      };
    }
  }

  if (isPrimarilySchoolCount(lower)) {
    return {
      mode: 'database',
      module: 'schools',
      operation: 'count',
      filters: [],
      selectFields: [],
      groupBy: [],
      aggregates: [{ func: 'count', field: '*', as: 'count' }],
      sort: [],
      limit: 20,
      timeframe: 'all',
      clarification: '',
      parseWarning: errMessage ? `gemini_unavailable:${errMessage}` : 'intent_json_parse_failed',
    };
  }

  const bySchool = isGroupedBySchool(lower);
  return {
    mode: 'database',
    module,
    operation: bySchool ? 'aggregate' : operation,
    filters,
    selectFields: module === 'schools' ? ['name', 'place', 'board', 'phone', 'isActive'] : [],
    groupBy: bySchool ? ['school'] : [],
    aggregates:
      bySchool || operation === 'count'
        ? [{ func: 'count', field: '*', as: 'count' }]
        : [],
    sort: [
      {
        field: bySchool ? 'count' : module === 'schools' ? 'name' : 'createdAt',
        direction: bySchool || module !== 'schools' ? 'desc' : 'asc',
      },
    ],
    limit: bySchool ? 50 : 20,
    timeframe: parseTimeframeFromMessage(lower),
    preferredDateField:
      module === 'audit_logs' ? 'at' : module === 'analytics' ? 'ts' : '',
    clarification: '',
    parseWarning: errMessage ? `gemini_unavailable:${errMessage}` : 'intent_json_parse_failed',
  };
}

export async function parseDynamicIntent({ userMessage, history = [] }) {
  const message = String(userMessage || '').trim();

  // Affirmatives ("yes", "ok") continue the previous control action — never a bare DB search.
  const followUpPlan = tryResolveAffirmativeFollowUp(message, history);
  if (followUpPlan) return followUpPlan;

  // Short-circuit obvious greetings/small talk before spending a Gemini round trip
  // on intent classification — this is also what was silently hanging/misfiring.
  if (isGreetingOrSmallTalk(message)) {
    return buildKnowledgePlan();
  }
  if (isReportsOverviewQuery(message) || isHeadcountOverviewQuery(message)) {
    return buildOverviewPlan();
  }
  // Multi-metric published catalog (videos + assessments) — one deterministic plan, both counts.
  if (isPublishedCatalogQuery(message)) {
    return buildCatalogCountsPlan();
  }

  const personEarly = extractPersonNameQuery(message);
  if (personEarly.name && isPersonDetailQuery(message)) {
    return buildPersonDetailPlan(personEarly.name, personEarly.roleHint);
  }

  const classEarly = extractClassGroupQuery(message);
  if (classEarly.classNumber && isClassGroupQuery(message)) {
    return buildClassDetailPlan(classEarly.classNumber, classEarly.section);
  }

  const namedSchoolEarly = extractSchoolNameQuery(message);
  if (namedSchoolEarly && isSchoolDetailQuery(message)) {
    return buildSchoolDetailPlan(namedSchoolEarly);
  }

  // Prefer deterministic metrics / login plans over Gemini inventing wrong modules.
  // "entries were logged" must not match the login-activity heuristic.
  const metricsEarly = tryBuildUsageOrAuditPlan(message);
  if (metricsEarly) return metricsEarly;

  if (
    /(logged?\s*in|last\s*login|have\s+logged|login\s+within)/i.test(message) &&
    !/(entr(?:y|ies)\s+were\s+logged|logged\s+in\s+the\s+last|records?\s+were\s+logged)/i.test(message)
  ) {
    return buildHeuristicPlan(message);
  }

  const hist = (Array.isArray(history) ? history : []).slice(-8);
  const historyBlock = hist
    .map((m) => `${String(m.role || '').toUpperCase()}: ${String(m.content || '').slice(0, 700)}`)
    .join('\n');

  const prompt = `You map admin chat questions to a READ-ONLY database query plan.
Return ONLY JSON with shape:
{
  "mode":"database"|"knowledge"|"school_detail"|"person_detail"|"class_detail"|"overview",
  "module":"<one module key when mode=database>",
  "operation":"count"|"list"|"aggregate"|"distinct"|"overview",
  "schoolNameQuery":"<school name when looking up one school>",
  "personNameQuery":"<person full name when asking about a student/teacher/admin>",
  "personRoleHint":"student"|"teacher"|"admin"|"",
  "classNumberQuery":"<class number like 7>",
  "sectionQuery":"<section letter like A or empty>",
  "filters":[{"field":"", "op":"eq|ne|gt|gte|lt|lte|in|regex|exists", "value":""}],
  "selectFields":["fieldA","fieldB"],
  "groupBy":["fieldA"],
  "aggregates":[{"func":"count|sum|avg|min|max","field":"<field-or-*>","as":"metric"}],
  "sort":[{"field":"", "direction":"asc|desc"}],
  "limit":20,
  "timeframe":"today|this_week|this_month|last_7_days|all",
  "clarification":""
}

Modules:
${aliasList}

Rules:
- If user asks for application data/count/list/ranking/summary, choose mode="database".
- If the user asks for published videos AND/OR assessments/quizzes counts in one question, you MUST treat it as ONE catalog request. Never answer only videos and then ask whether to fetch assessments. Put both metrics in one plan (prefer mode hints that cover both; backend upgrades videos/assessments modules to a combined catalog count).
- Never ask a follow-up clarification when the user already named both metrics.
- Short affirmations like "yes" / "ok" mean continue the previous metric request from conversation history — do not invent a new empty database search.
- For a named person ("how is Rahul doing?", "Priya's exam scores", "tell me about teacher Sharma"), choose mode="person_detail" and set personNameQuery (+ optional personRoleHint).
- Never set personNameQuery to metric words like "videos", "assessments", "number", or "count".
- For a class/section group ("Class 7A performance", "how is class 8 doing?"), choose mode="class_detail" with classNumberQuery and optional sectionQuery.
- For named school details ("details about X school", "tell me about school X"), choose mode="school_detail", module="schools", and set schoolNameQuery to the school name.
- Never map "test school" / school names containing "test" to exams.
- School counts/lists use module="schools" (School collection name field), not users.
- "usage analytics" / AI usage → module="analytics". "audit log" → module="audit_logs". When the user says grouped by school, set operation="aggregate" and groupBy=["school"].
- For "last 7 days" set timeframe="last_7_days".
- For generic conceptual Qs not requiring DB, choose mode="knowledge".
- Never produce write/update/delete/drop/alter operations.
- operation must be one of: ${OPS.join(', ')}, overview.
- filter op must be one of: ${FILTER_OPS.join(', ')}.
- aggregate func must be one of: ${AGG_OPS.join(', ')}.
- Keep limit <= 100.
- If class mention like "Class 7", add filter field classNumber op eq value "7" (or "Class 7" only when needed).
- If the question implies a specific filter (a class, section, subject, etc.) but does not actually state its value (e.g. "students in Class" with no number), do NOT invent a filter with an empty/blank value — omit that filter entirely, and set "clarification" to a short one-line question asking for the missing detail (e.g. "Which class would you like the count for?").
- Greetings and small talk ("hi", "thanks", "how are you") should be mode="knowledge", not database.

Recent conversation:
${historyBlock || '(none)'}

User question:
${message.slice(0, 4500)}
`;

  let raw = '';
  let parsed = null;
  try {
    raw = await geminiService.generateStructuredContent(prompt, 'json');
    parsed = safeJson(raw);
  } catch (err) {
    return buildHeuristicPlan(message, String(err?.message || 'unknown'));
  }

  if (!parsed || typeof parsed !== 'object') {
    return buildHeuristicPlan(message, '');
  }

  if (isReportsOverviewQuery(message) || isHeadcountOverviewQuery(message)) {
    return buildOverviewPlan();
  }
  if (
    isPublishedCatalogQuery(message) ||
    shouldUpgradeToCatalogCounts(message, String(parsed.module || ''))
  ) {
    return buildCatalogCountsPlan('gemini_upgraded_to_catalog');
  }

  const namedSchool = extractSchoolNameQuery(message) || String(parsed.schoolNameQuery || '').trim();
  if (
    namedSchool &&
    (String(parsed.mode || '').toLowerCase() === 'school_detail' || isSchoolDetailQuery(message))
  ) {
    return buildSchoolDetailPlan(namedSchool);
  }
  if (
    namedSchool &&
    /(school|schools)/i.test(message) &&
    !/(how many|count|total|number of)/i.test(message)
  ) {
    return buildSchoolSearchPlan(namedSchool);
  }

  const personFromParsed = String(parsed.personNameQuery || '').trim();
  const personParsed = personFromParsed
    ? { name: personFromParsed, roleHint: String(parsed.personRoleHint || '').trim() }
    : extractPersonNameQuery(message);
  // Never accept metric words as a person name from Gemini
  if (
    personParsed.name &&
    !/^(videos?|assessments?|quizzes?|number|count|published)$/i.test(personParsed.name) &&
    (String(parsed.mode || '').toLowerCase() === 'person_detail' || isPersonDetailQuery(message))
  ) {
    return buildPersonDetailPlan(personParsed.name, personParsed.roleHint);
  }

  const classFromParsed = {
    classNumber: String(parsed.classNumberQuery || '').trim(),
    section: String(parsed.sectionQuery || '').trim(),
  };
  const classParsed = classFromParsed.classNumber
    ? classFromParsed
    : extractClassGroupQuery(message);
  if (
    classParsed.classNumber &&
    (String(parsed.mode || '').toLowerCase() === 'class_detail' || isClassGroupQuery(message))
  ) {
    return buildClassDetailPlan(classParsed.classNumber, classParsed.section);
  }

  const parsedMode = String(parsed.mode || '').toLowerCase();
  const mode =
    parsedMode === 'overview'
      ? 'overview'
      : parsedMode === 'school_detail'
        ? 'school_detail'
        : parsedMode === 'person_detail'
          ? 'person_detail'
          : parsedMode === 'class_detail'
            ? 'class_detail'
            : parsedMode === 'database'
              ? 'database'
              : 'knowledge';
  const operation = OPS.includes(String(parsed.operation)) ? String(parsed.operation) : 'list';
  const limit = Math.max(1, Math.min(100, Number(parsed.limit) || 20));
  const parsedTf = String(parsed.timeframe || '').trim();
  const timeframe =
    TIMEFRAMES.includes(parsedTf) || /^last_\d{1,3}_days$/.test(parsedTf)
      ? parsedTf
      : parseTimeframeFromMessage(message);

  const normalized = {
    mode,
    module: String(parsed.module || '').trim(),
    operation,
    filters: Array.isArray(parsed.filters) ? parsed.filters : [],
    selectFields: Array.isArray(parsed.selectFields) ? parsed.selectFields.map(String) : [],
    groupBy: Array.isArray(parsed.groupBy) ? parsed.groupBy.map(String) : [],
    aggregates: Array.isArray(parsed.aggregates) ? parsed.aggregates : [],
    sort: Array.isArray(parsed.sort) ? parsed.sort : [],
    limit,
    timeframe,
    clarification: String(parsed.clarification || '').slice(0, 220),
    rawPreview: String(raw || '').slice(0, 600),
  };

  if (mode === 'school_detail') {
    const q = namedSchool || String(parsed.schoolNameQuery || '').trim() || 'school';
    return buildSchoolDetailPlan(q);
  }
  if (mode === 'person_detail') {
    const q = personParsed.name || String(parsed.personNameQuery || '').trim();
    if (!q) return buildHeuristicPlan(message, 'person_detail_missing_name');
    if (
      /^(videos?|assessments?|quizzes?|number|count|published)$/i.test(q) ||
      shouldUpgradeToCatalogCounts(message, q)
    ) {
      return buildCatalogCountsPlan('person_misclassified_as_catalog');
    }
    return buildPersonDetailPlan(q, personParsed.roleHint || String(parsed.personRoleHint || ''));
  }
  if (mode === 'class_detail') {
    const cn = classParsed.classNumber || String(parsed.classNumberQuery || '').trim();
    if (!cn) return buildHeuristicPlan(message, 'class_detail_missing_number');
    return buildClassDetailPlan(cn, classParsed.section || String(parsed.sectionQuery || ''));
  }

  const lower = message.toLowerCase();
  const metricsOverride = tryBuildUsageOrAuditPlan(message);
  if (mode === 'database' && metricsOverride) {
    return { ...metricsOverride, rawPreview: normalized.rawPreview };
  }

  const isCount = /(how many|count|total|number of|are there|how much)/i.test(lower);
  if (mode === 'database' && isPrimarilySchoolCount(lower)) {
    return {
      ...normalized,
      module: 'schools',
      operation: 'count',
      filters: [],
      selectFields: [],
      groupBy: [],
      aggregates: [{ func: 'count', field: '*', as: 'count' }],
      sort: [],
      limit: Math.max(20, normalized.limit || 20),
      timeframe: 'all',
    };
  }

  if (mode === 'database' && isGroupedBySchool(lower) && !normalized.groupBy.length) {
    return {
      ...normalized,
      operation: 'aggregate',
      groupBy: ['school'],
      aggregates: normalized.aggregates.length
        ? normalized.aggregates
        : [{ func: 'count', field: '*', as: 'count' }],
      limit: Math.max(50, normalized.limit || 50),
      timeframe: normalized.timeframe === 'all' ? parseTimeframeFromMessage(message) : normalized.timeframe,
    };
  }

  if (mode === 'database' && shouldUpgradeToCatalogCounts(message, normalized.module)) {
    return buildCatalogCountsPlan('gemini_module_upgraded_to_catalog');
  }

  if (mode === 'database' && /(content|generate|generated|generation)/i.test(lower)) {
    const filters = Array.isArray(normalized.filters) ? [...normalized.filters] : [];
    const asksOwn = /(i generated|my generated|my content|content i generated|generated by me|created by me|upto now)/i.test(
      lower,
    );
    if (asksOwn) {
      filters.push({ field: 'generatedBy', op: 'eq', value: '__viewer__' });
      filters.push({ field: 'teacherId', op: 'eq', value: '__viewer__' });
    }
    return {
      ...normalized,
      module: 'ai_tool_data',
      operation: isCount ? 'count' : normalized.operation,
      filters,
      timeframe: parseTimeframeFromMessage(message),
    };
  }

  return normalized;
}
