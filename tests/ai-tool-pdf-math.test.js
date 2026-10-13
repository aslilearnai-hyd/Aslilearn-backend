import assert from 'node:assert/strict';
import test from 'node:test';

import {
  pdfReadableMathText,
  pdfReadableUnicodeMathText,
  pdfSafeWinAnsiText,
} from '../utils/ai-tool-pdf-body.js';

test('PDF text removes math delimiters and preserves powers', () => {
  assert.equal(
    pdfReadableMathText('The integers between $12^2$ and $13^2$.'),
    'The integers between 12^2 and 13^2.',
  );
});

test('PDF text renders square roots and fractions as readable ASCII', () => {
  const source = String.raw`Given that $\sqrt{441} = 21$, find $\sqrt{0.0441}$ and $\frac{1}{2}$.`;
  assert.equal(
    pdfSafeWinAnsiText(source),
    'Given that sqrt(441) = 21, find sqrt(0.0441) and (1)/(2).',
  );
});

test('PDF text supports indexed roots and grouped exponents', () => {
  assert.equal(pdfReadableMathText(String.raw`$\sqrt[3]{8} = 2^3$ and $x^{12}$`), 'root[3](8) = 2^3 and x^12');
});

test('PDF text does not remove an unmatched currency marker', () => {
  assert.equal(pdfReadableMathText('The book costs $100.'), 'The book costs $100.');
});

test('Unicode PDF text renders familiar mathematical symbols', () => {
  const source = String.raw`$12^2 \times \sqrt{441}$ and $\sqrt[3]{8} \neq 3$`;
  assert.equal(pdfReadableUnicodeMathText(source), '12² × √441 and ∛8 ≠ 3');
});

test('Unicode PDF text upgrades plain sqrt notation from generated answers', () => {
  assert.equal(
    pdfReadableUnicodeMathText('Working: Property: sqrt(xy) = sqrt(x) * sqrt(y).'),
    'Working: Property: √xy = √x × √y.',
  );
});
