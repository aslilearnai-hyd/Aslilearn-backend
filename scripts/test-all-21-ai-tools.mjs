/**
 * Smoke-test all 21 book-based AI tools — one Gemini generation each.
 * Usage: node scripts/test-all-21-ai-tools.mjs [--tier=fast|premium] [--slug=worksheet-mcq-generator]
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { AI_TOOL_ORDERED_SLUGS } from '../config/aiToolTemplates.js';
import {
  generateStructuredContentForAiGenerator,
  validateToolSpecificStructuredContent,
} from '../services/ai-content-engine-service.js';
import { extractTitleFromStructured } from '../services/ai-generator-content-extractor.js';
import { mustEnforceStoryPassageLanguageCompliance } from '../utils/story-passage-subject.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const tierArg = args.find((a) => a.startsWith('--tier='))?.split('=')[1] || 'fast';
const slugFilter = args.find((a) => a.startsWith('--slug='))?.split('=')[1] || '';

const BASE = {
  board: 'CBSE',
  classLabel: 'Class 10',
  gradeLevel: 'Class 10',
  topic: 'Life Processes',
  subTopic: 'Photosynthesis',
  qualityTier: tierArg,
  extraParams: { questionCount: 8, cardCount: 8 },
};

const LANGUAGE_BASE = {
  ...BASE,
  subject: 'Hindi',
  topic: 'ग्रीष्म ऋतु',
  subTopic: 'गर्मी के दिन',
};

function paramsForSlug(slug) {
  if (slug === 'reading-practice-room' || slug === 'story-passage-creator') {
    return { ...LANGUAGE_BASE };
  }
  return { ...BASE, subject: 'Science' };
}

function hasSubstantiveContent(slug, structured) {
  if (!structured || typeof structured !== 'object' || Array.isArray(structured)) return false;
  const blob = JSON.stringify(structured);
  if (blob.length < 120) return false;
  const title = extractTitleFromStructured(slug, structured);
  if (title && title.length >= 4) return true;
  if (Array.isArray(structured.cards) && structured.cards.length >= 3) return true;
  if (Array.isArray(structured.questions) && structured.questions.length >= 2) return true;
  if (Array.isArray(structured.sections) && structured.sections.some((s) => (s?.questions?.length || 0) > 0)) {
    return true;
  }
  const textFields = [
    'passage',
    'lesson_name',
    'concept_name',
    'chapter_summary_title',
    'study_guide_title',
    'worksheet_title',
    'mock_test_title',
    'paper_title',
    'assignment_title',
    'flashcard_deck_title',
    'deck_title',
  ];
  return textFields.some((k) => String(structured[k] || '').trim().length >= 20);
}

async function testOne(slug) {
  const params = paramsForSlug(slug);
  const started = Date.now();
  try {
    const result = await generateStructuredContentForAiGenerator(slug, params);
    const structured = result?.structuredContent;
    const generated = String(result?.generatedContent || '').trim();
    const validation = validateToolSpecificStructuredContent(
      slug,
      structured,
      result?.contentType || 'Notes',
      generated,
      { subject: params.subject, topic: params.topic, subTopic: params.subTopic, qualityTier: tierArg },
    );
    const title = extractTitleFromStructured(slug, structured) || '(no title)';
    const ok = generated.length > 40;
    return {
      slug,
      ok,
      ms: Date.now() - started,
      title: title.slice(0, 72),
      valid: validation.valid,
      message: ok
        ? ''
        : validation.valid
          ? 'Generated text too short'
          : String(validation.message || '').slice(0, 140),
      chars: generated.length,
    };
  } catch (err) {
    return {
      slug,
      ok: false,
      ms: Date.now() - started,
      title: '',
      valid: false,
      message: String(err?.message || err).slice(0, 200),
      chars: 0,
    };
  }
}

const slugs = slugFilter
  ? AI_TOOL_ORDERED_SLUGS.filter((s) => s === slugFilter)
  : [...AI_TOOL_ORDERED_SLUGS];

if (!slugs.length) {
  console.error(`Unknown slug: ${slugFilter}`);
  process.exit(1);
}

console.log(`Testing ${slugs.length} AI tool(s) — tier=${tierArg}\n`);

const results = [];
for (let i = 0; i < slugs.length; i += 1) {
  const slug = slugs[i];
  const subject = paramsForSlug(slug).subject;
  const lang = mustEnforceStoryPassageLanguageCompliance(subject) ? ' [language]' : '';
  process.stdout.write(`[${i + 1}/${slugs.length}] ${slug}${lang}… `);
  const row = await testOne(slug);
  results.push(row);
  console.log(row.ok ? `OK (${row.ms}ms) — ${row.title}` : `FAIL (${row.ms}ms) — ${row.message}`);
}

const passed = results.filter((r) => r.ok);
const failed = results.filter((r) => !r.ok);

console.log('\n--- Summary ---');
console.log(`Passed: ${passed.length}/${results.length}`);
if (failed.length) {
  console.log('Failed:');
  for (const f of failed) {
    console.log(`  - ${f.slug}: ${f.message}`);
  }
  process.exit(1);
}
console.log('All tools generated content successfully.');
