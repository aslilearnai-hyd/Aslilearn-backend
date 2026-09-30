/**
 * Source-level security checks. These run without a database and prevent
 * credentials or known unsafe regular expressions from being reintroduced.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { formatChemicalFormulasInText } from '../ai/shared/classroom-text-format.js';
import { sanitizeFlashcardTopicLink } from '../ai/shared/sanitize-ai-question-display.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const sourceExtensions = /\.(?:c?js|mjs|ts|tsx|py|sh|ya?ml|properties|example)$/i;
const sourceRoots = /^(?:backend\/|client\/src\/|ASLI-MOBILE-main\/|\.github\/)/;

function trackedSourceFiles() {
  return execFileSync('git', ['-c', `safe.directory=${repoRoot}`, 'ls-files', '-z'], { cwd: repoRoot })
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter((path) => sourceRoots.test(path) && sourceExtensions.test(path))
    .filter((path) => !path.includes('/node_modules/'));
}

describe('source credential hygiene', () => {
  it('contains no tracked MongoDB URI with embedded credentials', () => {
    const embeddedMongoCredential = new RegExp(
      ['mongodb', '(?:\\+srv)?', ':\\/\\/', '[^\\s/:@]+', ':', '[^\\s/@]+', '@'].join(''),
      'i',
    );
    const offenders = [];

    for (const relativePath of trackedSourceFiles()) {
      const absolutePath = join(repoRoot, relativePath);
      if (!existsSync(absolutePath)) continue;
      if (statSync(absolutePath).size > 1_000_000) continue;
      if (embeddedMongoCredential.test(readFileSync(absolutePath, 'utf8'))) {
        offenders.push(relativePath);
      }
    }

    assert.deepEqual(offenders, [], `Embedded MongoDB credentials found in: ${offenders.join(', ')}`);
  });

  it('keeps maintenance credentials environment-only and never prints them', () => {
    const files = [
      'backend/set-admin-password.js',
      'backend/test-login.js',
      'backend/scripts/recover-schools-from-orphans.js',
    ];
    for (const relativePath of files) {
      const source = readFileSync(join(repoRoot, relativePath), 'utf8');
      assert.doesNotMatch(source, /const\s+(?:newPassword|testPassword|defaultPassword)\s*=\s*['"][^'"]+['"]/);
      assert.doesNotMatch(source, /console\.log\([^\n]*Password:\s*[^'"`]/i);
    }
  });
});

describe('text normalizer denial-of-service resistance', () => {
  it('does not reintroduce the two unsafe nested-repeat patterns', () => {
    const files = [
      'client/src/lib/exam-text-normalize.ts',
      'client/src/lib/strip-ai-tool-metadata.ts',
      'ASLI-MOBILE-main/src/lib/exam-text-normalize.ts',
      'ASLI-MOBILE-main/src/lib/strip-ai-tool-metadata.ts',
      'backend/ai/shared/classroom-text-format.js',
      'backend/ai/shared/sanitize-ai-question-display.js',
    ];
    const unsafeFragments = [
      '(?:\\d+[A-Z]?[a-z]?)*',
      '(?:\\s*[—–-]\\s*)+',
    ];

    for (const relativePath of files) {
      const source = readFileSync(join(repoRoot, relativePath), 'utf8');
      for (const fragment of unsafeFragments) {
        assert.equal(source.includes(fragment), false, `${relativePath} contains ${fragment}`);
      }
    }
  });

  it('handles long formula-like and separator input in bounded time', () => {
    const formulaInput = `${'A1'.repeat(100_000)}!`;
    const separatorInput = `Topic${' - '.repeat(100_000)}`;
    const started = performance.now();

    formatChemicalFormulasInText(formulaInput);
    sanitizeFlashcardTopicLink(separatorInput);

    assert.ok(performance.now() - started < 2_000, 'Text normalization exceeded two seconds');
  });
});
