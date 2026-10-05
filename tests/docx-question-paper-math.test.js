import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { extractDocxQuestionPaper } from '../services/docx-question-paper.js';

const run = (value) => `<m:r><m:t>${value}</m:t></m:r>`;
const sup = (base, exponent) =>
  `<m:sSup><m:e>${base}</m:e><m:sup>${run(exponent)}</m:sup></m:sSup>`;
const frac = (numerator, denominator) =>
  `<m:f><m:num>${numerator}</m:num><m:den>${denominator}</m:den></m:f>`;
const equation = (body) => `<m:oMath>${body}</m:oMath>`;
const paragraph = (body) => `<w:p>${body}</w:p>`;
const text = (value) => `<w:r><w:t>${value}</w:t></w:r>`;

describe('Word question-paper equations', () => {
  it('preserves stacked fractions, exponents, and grouped products from OMML', () => {
    const numeratorA = `${sup(run('n'), '2')}${run('+2')}`;
    const numeratorC =
      `<m:d><m:e>${run('n+2')}</m:e></m:d>` +
      `<m:d><m:e>${run('n+3')}</m:e></m:d>`;
    const xml =
      '<w:document><w:body>' +
      paragraph(text('1. Which expression is always natural?')) +
      paragraph(text('a) ') + equation(frac(numeratorA, run('2')))) +
      paragraph(text('b) ') + equation(`${sup(run('n'), '2')}${run('−1')}`)) +
      paragraph(text('c) ') + equation(frac(numeratorC, run('2')))) +
      paragraph(text('d) ') + equation(frac(`${run('n')}<m:d><m:e>${run('n+1')}</m:e></m:d>`, run('4')))) +
      '</w:body></w:document>';
    const zip = new AdmZip();
    zip.addFile('word/document.xml', Buffer.from(xml));
    const parsed = extractDocxQuestionPaper(zip.toBuffer());

    assert.match(parsed.text, /a\) \$\\frac\{n\^\{2\}\+2\}\{2\}\$/);
    assert.match(parsed.text, /c\) \$\\frac\{\(n\+2\)\(n\+3\)\}\{2\}\$/);
    assert.match(parsed.text, /d\) \$\\frac\{n\(n\+1\)\}\{4\}\$/);
    assert.doesNotMatch(parsed.text, /n\^\{2\}\+2\^\{2\}/);
  });
});
