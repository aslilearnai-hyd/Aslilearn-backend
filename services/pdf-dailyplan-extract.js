/**
 * Regex-based daily class plan extraction from PDF text.
 * @module services/pdf-dailyplan-extract
 */

import { bulletsFromLines, splitPdfTextByMarkerLines, str, strArr } from './pdf-extract-utils.js';

const DAY_MARKER = /^(?:Day|Daily\s*Plan|Period\s*Plan)\s+\d+\b/i;

function parseTimeSlot(line) {
  const m = str(line).match(
    /^(\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2})\s*[-–:]?\s*(.+)$/i,
  );
  if (m) {
    return { time: str(m[1]), activity: str(m[2]), type: 'period' };
  }
  const period = line.match(/^Period\s+(\d+)\s*[:\-—]\s*(.+)$/i);
  if (period) {
    return { time: `Period ${period[1]}`, activity: str(period[2]), type: 'period' };
  }
  return null;
}

function parseDailyPlanBlock(block, index) {
  const lines = String(block || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim());

  let title = '';
  let day_period_topic_breakup = '';
  const time_slots = [];
  const objectives = [];
  let homework = '';
  let exit_ticket = '';
  let inHomework = false;
  let inObjectives = false;

  for (const line of lines) {
    if (!line || DAY_MARKER.test(line)) continue;

    const topicMatch = line.match(/^Topic\s*[:\-—]\s*(.+)$/i);
    if (topicMatch) {
      title = str(topicMatch[1]);
      day_period_topic_breakup = str(topicMatch[1]);
      continue;
    }

    if (/^Objectives?\s*[:\-—]?\s*$/i.test(line)) {
      inObjectives = true;
      inHomework = false;
      continue;
    }
    if (/^Homework\s*[:\-—]?\s*$/i.test(line)) {
      inHomework = true;
      inObjectives = false;
      continue;
    }
    if (/^Exit\s*(?:Ticket|Assessment)\s*[:\-—]\s*(.+)$/i.test(line)) {
      exit_ticket = str(line.match(/^Exit\s*(?:Ticket|Assessment)\s*[:\-—]\s*(.+)$/i)?.[1]);
      continue;
    }

    const slot = parseTimeSlot(line);
    if (slot) {
      time_slots.push(slot);
      inObjectives = false;
      inHomework = false;
      continue;
    }

    if (inHomework) {
      homework += (homework ? '\n' : '') + line;
    } else if (inObjectives || /^[-•*]\s+/.test(line)) {
      objectives.push(line.replace(/^[-•*]\s+/, ''));
    } else if (!title && line.length >= 3 && line.length < 120) {
      title = line;
      day_period_topic_breakup = line;
    }
  }

  const hasBody =
    time_slots.length > 0 ||
    objectives.length > 0 ||
    str(homework).length > 5 ||
    str(exit_ticket).length > 3;

  if (!hasBody && !title) return null;

  return {
    sl_no: index + 1,
    title: title || `Daily Plan ${index + 1}`,
    day_period_topic_breakup: day_period_topic_breakup || title,
    time_slots,
    timeline: time_slots.map((s) => `${s.time} — ${s.activity}`),
    objectives: bulletsFromLines(objectives),
    homework_followup: str(homework),
    exit_ticket,
    _fromPdf: true,
  };
}

/**
 * @param {string} text
 * @param {number} [limit=50]
 */
export function extractDailyPlanItemsFromPdfText(text, limit = 50) {
  const blocks = splitPdfTextByMarkerLines(str(text), DAY_MARKER, 50);
  const out = [];

  for (const block of blocks) {
    if (out.length >= limit) break;
    const plan = parseDailyPlanBlock(block, out.length);
    if (plan) out.push(plan);
  }

  if (!out.length) {
    const single = parseDailyPlanBlock(str(text), 0);
    if (single) out.push(single);
  }

  return out.slice(0, limit).map((row, i) => ({
    ...row,
    sl_no: row.sl_no ?? i + 1,
    objectives: strArr(row.objectives),
    _fromPdf: true,
  }));
}
