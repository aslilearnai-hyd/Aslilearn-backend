import geminiService from '../gemini-service.js';

/**
 * Gemini formats a natural-language answer ONLY from grounded facts JSON.
 *
 * @param {{ userPrompt: string, intentSummary: Record<string, unknown>, factsJson: Record<string, unknown>, notes?: string[] }} opts
 */
export async function generateGroundedAnswer({ userPrompt, intentSummary, factsJson, notes = [] }) {
  const notesBlock =
    notes && notes.length
      ? `\nOperational notes about data sources:\n${notes.slice(0, 8).map((n, i) => `${i + 1}. ${n}`).join('\n')}`
      : '';

  const payload = JSON.stringify(factsJson, null, 0).slice(0, 12000);

  const prompt = `You are Vidya AI Control — an administrator assistant inside an LMS.
Answer the operator's question in clear, concise English.

STRICT RULES:
- Base every factual claim ONLY on keys in FACTS_JSON. Do NOT invent totals, percentages, dates, names, or database values.
- If FACTS_JSON says billingDataAvailable:false or clarificationNeeded:true, acknowledge that plainly.
- Mention caveats only when FACTS_JSON or notes say so (e.g. attendance uses login-session proxy).
- For rankings, cite the identifier from FACTS_JSON (class number / section labels).
- No markdown headings; plain sentences. Do not prepend "Answer:".

Operator question:
${String(userPrompt || '').slice(0, 4000)}

Intent classifier output (validated):
${JSON.stringify(intentSummary, null, 0).slice(0, 2500)}
${notesBlock}

FACTS_JSON (from database aggregations — AUTHORITATIVE for numbers):
${payload}
`;

  const text = await geminiService.generateStructuredContent(prompt, 'text');
  return String(text || '').trim();
}
