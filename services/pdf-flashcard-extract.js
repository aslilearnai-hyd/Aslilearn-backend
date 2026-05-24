/**
 * Regex-based flashcard extraction from PDF text.
 * @module services/pdf-flashcard-extract
 */

import { splitPdfTextByMarkerLines, str } from './pdf-extract-utils.js';

const CARD_MARKER = /^(?:Card|Flashcard|Flash\s*Card|Item)\s+\d+\b/i;

function parseCardBlock(block, index) {
  const lines = String(block || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let front = '';
  let back = '';
  let memory_cue = '';
  let skill_focus = '';
  let example_use = '';
  let peer_prompt = '';
  let reflection = '';
  let deck_title = '';

  for (const line of lines) {
    if (CARD_MARKER.test(line)) continue;
    const f = line.match(/^Front\s*[:\-—]\s*(.+)$/i);
    const b = line.match(/^Back\s*[:\-—]\s*(.+)$/i);
    const hint = line.match(/^(?:Memory\s*Cue|Hint)\s*[:\-—]\s*(.+)$/i);
    const skill = line.match(/^Skill\s*(?:Focus)?\s*[:\-—]\s*(.+)$/i);
    const ex = line.match(/^Example\s*(?:Use)?\s*[:\-—]\s*(.+)$/i);
    const peer = line.match(/^Peer\s*Prompt\s*[:\-—]\s*(.+)$/i);
    const refl = line.match(/^Reflection\s*[:\-—]\s*(.+)$/i);
    const deck = line.match(/^Deck\s*(?:Title)?\s*[:\-—]\s*(.+)$/i);

    if (f) front = str(f[1]);
    else if (b) back = str(b[1]);
    else if (hint) memory_cue = str(hint[1]);
    else if (skill) skill_focus = str(skill[1]);
    else if (ex) example_use = str(ex[1]);
    else if (peer) peer_prompt = str(peer[1]);
    else if (refl) reflection = str(refl[1]);
    else if (deck) deck_title = str(deck[1]);
    else if (!front && line.length > 2 && !/^(front|back)\b/i.test(line)) {
      front = line;
    } else if (front && !back && line.length > 1) {
      back = line;
    }
  }

  if (!front && !back) return null;

  return {
    sl_no: index + 1,
    front: front || `Card ${index + 1}`,
    back: back || '',
    memory_cue,
    skill_focus,
    example_use,
    peer_prompt,
    reflection,
    deck_title,
    title: (front || `Card ${index + 1}`).slice(0, 120),
    _fromPdf: true,
  };
}

/**
 * @param {string} text
 * @param {number} [limit=200]
 */
export function extractFlashcardItemsFromPdfText(text, limit = 200) {
  const blocks = splitPdfTextByMarkerLines(str(text), CARD_MARKER, 20);
  const out = [];

  for (const block of blocks) {
    if (out.length >= limit) break;
    const card = parseCardBlock(block, out.length);
    if (card && str(card.back)) out.push(card);
  }

  return out.map((row, i) => ({
    ...row,
    sl_no: row.sl_no ?? i + 1,
    _fromPdf: true,
  }));
}
