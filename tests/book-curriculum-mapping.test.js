import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCurriculumTree,
  computeMappingHealth,
  detectBookSections,
  deterministicMatch,
  findScopeMismatches,
  groupMappedSectionsForChunking,
  joinPages,
  lexicalSimilarity,
  mapSectionsToCurriculum,
  MAPPING_STATUS,
  parseHeadingLine,
  parseMappingClassifierResponse,
  removeRepeatedPageBoilerplate,
  splitPdfPages,
} from '../ai/rag/books/book-curriculum-mapper.js';
import { resolveSelectionFromRows } from '../ai/rag/books/book-curriculum-service.js';
import { mapAssetsToSections, planCurriculumChunks } from '../ai/rag/books/book-ingestion-service.js';
import { resolveCurriculumRetrievalRoute } from '../ai/rag/books/book-rag-service.js';
import { bookRetrievalFailureMessage } from '../ai/generators/_batch/book-generator-batch-orchestrator.js';

const base = { board: 'CBSE', productCategory: '', classLabel: 'Class 9', subject: 'Science' };
const ROWS = [
  { _id: 'st0301', ...base, label: 'Chapter 3', topicName: 'Chapter 3 - Matter in Our Surroundings', subTopic: 'States of Water', sortOrder: 1 },
  { _id: 'st0302', ...base, label: 'Chapter 3', topicName: 'Chapter 3 - Matter in Our Surroundings', subTopic: 'Evaporation', sortOrder: 2, subtopicNumber: '3.2' },
  { _id: 'st0303', ...base, label: 'Chapter 3', topicName: 'Chapter 3 - Matter in Our Surroundings', subTopic: 'Condensation', sortOrder: 3 },
  { _id: 'st0401', ...base, label: 'Chapter 4', topicName: 'Chapter 4 - Atoms and Molecules', subTopic: '4.1 Laws of Chemical Combination', sortOrder: 4 },
  { _id: 'st0402', ...base, label: 'Chapter 4', topicName: 'Chapter 4 - Atoms and Molecules', subTopic: '4.2 What Is an Atom', sortOrder: 5 },
];
const tree = () => buildCurriculumTree(ROWS);

/** Deterministic fake embedding: bag of words over a tiny vocabulary. */
const VOCAB = ['evaporation', 'escape', 'surface', 'cooling', 'condensation', 'droplets', 'vapour', 'ice', 'melting', 'states', 'water', 'atom', 'law', 'mass', 'matter'];
function fakeEmbed(text) {
  const t = String(text).toLowerCase();
  return VOCAB.map((w) => (t.match(new RegExp(w, 'g')) || []).length);
}

const body = (topic, n = 60) => Array.from({ length: n }, (_, i) => `${topic} sentence ${i}.`).join(' ');

test('curriculum tree derives topic and subtopic numbers from labels', () => {
  const t = tree();
  assert.equal(t.topics.length, 2);
  const [ch3, ch4] = t.topics;
  assert.equal(ch3.topicNumber, '3');
  assert.deepEqual(ch3.subtopics.map((s) => s.number), ['', '3.2', '']);
  assert.deepEqual(ch4.subtopics.map((s) => s.number), ['4.1', '4.2']);
  assert.equal(t.subtopicById.get('st0302').topicKey, ch3.topicKey);
});

test('page split + boilerplate removal drops running headers and page numbers', () => {
  const pages = Array.from({ length: 6 }, (_, i) =>
    `SCIENCE - CLASS 9\nReal content line ${i} about matter.\nMore content ${i}.\n${i + 1}`,
  ).join('\n') ;
  const marked = pages.split('\n').reduce((acc, line, idx) => acc + line + '\n' + ((idx + 1) % 4 === 0 ? `-- ${(idx + 1) / 4} of 6 --\n` : ''), '');
  const split = splitPdfPages(marked);
  assert.equal(split.length, 6);
  assert.equal(split[2].page, 3);
  const { pages: cleaned, removedLines } = removeRepeatedPageBoilerplate(split);
  assert.ok(removedLines >= 6, `removed ${removedLines}`);
  assert.ok(cleaned.every((p) => !/SCIENCE - CLASS 9/.test(p.text)));
  assert.ok(cleaned.every((p) => /Real content/.test(p.text)));
  const { ranges } = joinPages(cleaned);
  assert.equal(ranges[0].page, 1);
});

test('heading parser ignores TOC rows, questions and maths', () => {
  assert.equal(parseHeadingLine('3.2 Evaporation ........ 45'), null);
  assert.equal(parseHeadingLine('3.2 Evaporation 45'), null);
  assert.equal(parseHeadingLine('1.2 Find the value of x'), null);
  assert.deepEqual(parseHeadingLine('3.2 Evaporation'), { level: 2, number: '3.2', chapterNumber: '3', title: 'Evaporation' });
  assert.equal(parseHeadingLine('3.2.1 Factors Affecting Evaporation').level, 3);
  assert.equal(parseHeadingLine('Chapter 3').chapterNumber, '3');
  assert.equal(parseHeadingLine('CHAPTER IV Atoms').chapterNumber, '4');
});

test('section detection keeps chapter/sub-section hierarchy and page ranges', () => {
  const text = [
    'Contents', '3.1 States of Water ..... 30', '3.2 Evaporation ..... 33',
    'Chapter 3', 'Matter in Our Surroundings', body('intro', 20),
    '3.1 States of Water', body('ice melting water states', 40),
    '3.2 Evaporation', body('evaporation surface escape', 40),
    '3.2.1 Cooling Effect', body('cooling evaporation', 30),
  ].join('\n');
  const sections = detectBookSections(text, [{ page: 30, start: 0, end: text.length }]);
  const content = sections.filter((s) => s.level > 0);
  assert.deepEqual(content.map((s) => [s.level, s.number]), [[1, '3'], [2, '3.1'], [2, '3.2'], [3, '3.2.1']]);
  assert.equal(content[0].title, 'Matter in Our Surroundings');
  assert.ok(content.every((s) => s.chapterTitle === 'Matter in Our Surroundings'));
  assert.equal(content[1].pageStart, 30);
  assert.ok(new Set(sections.map((s) => s.sectionKey)).size === sections.length);
});

test('lexical similarity handles different wording for the same subtopic', () => {
  assert.ok(lexicalSimilarity('Cooling Effect of Evaporation', 'Evaporation') >= 0.9);
  assert.ok(lexicalSimilarity('EVAPORATION', 'Evaporation') >= 0.9);
  assert.equal(lexicalSimilarity('Condensation', 'Evaporation'), 0);
});

test('deterministic match: number, exact title, ambiguity never auto-accepts', () => {
  const t = tree();
  const ch3 = t.topics[0].subtopics.map((s) => ({ id: s.id, name: s.name, number: s.number }));
  assert.equal(deterministicMatch({ number: '3.2', title: 'Evaporation' }, ch3).method, 'number_exact');
  assert.equal(deterministicMatch({ number: '', title: 'condensation' }, ch3).candidate.id, 'st0303');
  // Number agrees but title says something else → review band only.
  assert.ok(deterministicMatch({ number: '3.2', title: 'Photosynthesis in Leaves' }, ch3).confidence < 0.9);
  const ambiguous = deterministicMatch({ title: 'Water' }, [
    { id: 'a', name: 'States of Water' },
    { id: 'b', name: 'Water Cycle' },
  ]);
  assert.ok(ambiguous.confidence < 0.9 && ambiguous.ambiguous);
});

test('classifier output is only trusted for allowed IDs', () => {
  const allowed = [{ id: 'st0302', name: 'Evaporation' }];
  assert.equal(parseMappingClassifierResponse('{"subtopicId":"st0302","confidence":0.94}', allowed).candidate.id, 'st0302');
  assert.ok(parseMappingClassifierResponse('{"subtopicId":"ST9999","confidence":0.99}', allowed).noMatch);
  assert.ok(parseMappingClassifierResponse('{"subtopicId":"NO_MATCH"}', allowed).noMatch);
  assert.ok(parseMappingClassifierResponse('not json', allowed).noMatch);
});

test('maps book sections to DB IDs: number, lexical, many-to-one inheritance', async () => {
  const t = tree();
  const text = [
    'Chapter 3', 'Matter in Our Surroundings', body('intro matter', 20),
    '3.1 States of Water', body('ice melting water states', 40),
    '3.2 Evaporation', body('evaporation surface escape', 40),
    '3.2.1 Rate of Escape', body('surface escape', 30),
    '3.3 Condensation of Vapour', body('condensation droplets vapour', 40),
  ].join('\n');
  const sections = detectBookSections(text, []);
  const { sections: mapped } = await mapSectionsToCurriculum(sections, t, { embed: fakeEmbed, classify: null });
  const byNumber = Object.fromEntries(mapped.filter((s) => s.number).map((s) => [s.number, s]));
  assert.equal(byNumber['3'].aiTopicKey, t.topics[0].topicKey);
  assert.equal(byNumber['3'].aiSubtopicId, '');
  assert.equal(byNumber['3.1'].aiSubtopicId, 'st0301');
  assert.equal(byNumber['3.2'].aiSubtopicId, 'st0302');
  assert.equal(byNumber['3.2'].mappingMethod, 'number_exact');
  assert.equal(byNumber['3.2.1'].aiSubtopicId, 'st0302'); // many-to-one
  assert.equal(byNumber['3.3'].aiSubtopicId, 'st0303');
  for (const s of mapped.filter((x) => x.level > 0)) {
    assert.equal(s.mappingStatus, MAPPING_STATUS.AUTO, `${s.number} ${s.mappingMethod} ${s.mappingConfidence}`);
  }
});

test('ambiguous section goes to the constrained classifier; NO_MATCH stays unmapped', async () => {
  const t = buildCurriculumTree([
    { _id: 'a', ...base, label: 'Chapter 5', topicName: 'Chapter 5 - Water', subTopic: 'States of Water', sortOrder: 1 },
    { _id: 'b', ...base, label: 'Chapter 5', topicName: 'Chapter 5 - Water', subTopic: 'Water Cycle', sortOrder: 2 },
  ]);
  const sections = detectBookSections(['Chapter 5', 'Water', body('x', 20), '5.7 Water Everywhere', body('y', 40)].join('\n'), []);
  const prompts = [];
  const classify = async (prompt) => {
    prompts.push(prompt);
    return '{"subtopicId":"b","confidence":0.88,"reason":"cycle"}';
  };
  const { sections: mapped, geminiCallsUsed } = await mapSectionsToCurriculum(sections, t, { classify, windowSplit: false });
  const sub = mapped.find((s) => s.number === '5.7');
  assert.equal(geminiCallsUsed, 1);
  assert.match(prompts[0], /ALLOWED SUBTOPICS:[\s\S]*a — States of Water[\s\S]*b — Water Cycle/);
  assert.equal(sub.aiSubtopicId, 'b');
  assert.equal(sub.mappingMethod, 'gemini');

  const { sections: rejected } = await mapSectionsToCurriculum(sections, t, {
    classify: async () => '{"subtopicId":"NO_MATCH"}',
    windowSplit: false,
  });
  const noMatch = rejected.find((s) => s.number === '5.7');
  assert.equal(noMatch.aiSubtopicId, '');

  const { sections: noGemini } = await mapSectionsToCurriculum(sections, t, { classify: null, windowSplit: false });
  // Without the classifier the section stays topic-level (no guessed subtopic).
  assert.equal(noGemini.find((s) => s.number === '5.7').aiSubtopicId, '');
});

test('manual overrides win and stale overrides go back to review', async () => {
  const t = tree();
  const sections = detectBookSections(['3.1 Something Odd', body('z', 40)].join('\n'), []);
  const key = sections.find((s) => s.level === 2).sectionKey;
  const { sections: manual } = await mapSectionsToCurriculum(sections, t, { overrides: new Map([[key, { aiSubtopicId: 'st0303' }]]) });
  const s = manual.find((x) => x.sectionKey === key);
  assert.equal(s.aiSubtopicId, 'st0303');
  assert.equal(s.mappingStatus, MAPPING_STATUS.REVIEWED);
  const { sections: stale } = await mapSectionsToCurriculum(sections, t, { overrides: new Map([[key, { aiSubtopicId: 'deleted' }]]) });
  assert.equal(stale.find((x) => x.sectionKey === key).mappingStatus, MAPPING_STATUS.NEEDS_REVIEW);
});

test('chapters without numbered headings are split by subtopic windows', async () => {
  const t = tree();
  const para = (words, n) => Array.from({ length: n }, () => `${words}.`).join(' ');
  const text = [
    'Chapter 3', 'Matter in Our Surroundings',
    para('states water states of water', 40),
    para('evaporation surface escape evaporation', 40),
    para('condensation droplets vapour condensation', 40),
  ].join('\n');
  const sections = detectBookSections(text, []);
  const { sections: mapped } = await mapSectionsToCurriculum(sections, t, { embed: fakeEmbed });
  const ids = mapped.filter((s) => s.aiSubtopicId).map((s) => s.aiSubtopicId);
  assert.deepEqual(ids, ['st0301', 'st0302', 'st0303']);
  assert.ok(mapped.filter((s) => s.aiSubtopicId).every((s) => s.mappingMethod === 'embedding_window'));
});

test('chunk groups never span two subtopic IDs', () => {
  const s = (key, id, words = 50) => ({
    sectionKey: key, level: 2, number: '', title: key, text: body(key, words / 3), wordCount: words,
    aiTopicKey: 'T', aiSubtopicId: id, mappingStatus: MAPPING_STATUS.AUTO, startOffset: 0, endOffset: 0,
  });
  const groups = groupMappedSectionsForChunking([s('a', '1'), s('b', '1', 10), s('c', '2'), s('d', '1')]);
  assert.deepEqual(groups.map((g) => [g.aiSubtopicId, g.sectionKeys.join(',')]), [['1', 'a,b'], ['2', 'c'], ['1', 'd']]);
});

test('planCurriculumChunks: single-chapter PDF numbered 3.x uses its intro as the chapter', async () => {
  const text = [
    body('matter intro', 20),
    '3.1 States of Water', body('ice melting water states', 40),
    '3.2 Evaporation', body('evaporation surface', 40),
  ].join('\n');
  const plan = await planCurriculumChunks({ fullText: text, tree: tree(), book: { topic: 'Matter in Our Surroundings' }, embed: fakeEmbed });
  assert.deepEqual(plan.groups.map((g) => g.aiSubtopicId), ['', 'st0301', 'st0302']);
  assert.ok(plan.groups.every((g) => g.aiTopicKey === tree().topics[0].topicKey));
  assert.equal(await planCurriculumChunks({ fullText: text, tree: buildCurriculumTree([]) }), null);
});

test('assets inherit the section mapping of their page, never a neighbour subtopic', () => {
  const sections = [
    { sectionKey: 'k1', level: 2, title: 'Evaporation', pageStart: 10, pageEnd: 11, aiTopicKey: 'T', aiSubtopicId: 'st0302', aiSubtopicName: 'Evaporation', mappingStatus: MAPPING_STATUS.AUTO },
    { sectionKey: 'k2', level: 2, title: 'Condensation', pageStart: 11, pageEnd: 12, aiTopicKey: 'T', aiSubtopicId: 'st0303', aiSubtopicName: 'Condensation', mappingStatus: MAPPING_STATUS.AUTO },
  ];
  const m = mapAssetsToSections([
    { assetId: 'fig-10', page: 10, caption: 'Figure 3.4' },
    { assetId: 'fig-11a', page: 11, caption: 'Condensation on a cold glass' },
    { assetId: 'fig-11b', page: 11, caption: 'Figure 3.6' },
  ], sections);
  assert.equal(m.get('fig-10').aiSubtopicId, 'st0302');
  assert.equal(m.get('fig-11a').aiSubtopicId, 'st0303');
  assert.equal(m.get('fig-11b').aiSubtopicId, ''); // shared page → topic-level only
  assert.equal(m.get('fig-11b').aiTopicKey, 'T');
});

test('mapping health gates readiness', () => {
  const t = tree();
  const ready = computeMappingHealth([
    { level: 1, wordCount: 100, aiTopicKey: 'x', mappingStatus: MAPPING_STATUS.AUTO, mappingConfidence: 0.97 },
    { level: 2, wordCount: 400, aiTopicKey: 'x', aiSubtopicId: 'st0302', mappingStatus: MAPPING_STATUS.AUTO, mappingConfidence: 0.97 },
  ], t, { chunks: [{ aiSubtopicId: 'st0302' }, { aiSubtopicId: '' }] });
  // Only 1 of 5 subtopics has text: not ready even though all text is settled.
  assert.equal(ready.status, 'needs_review');
  assert.equal(ready.mappedSubtopics, 1);
  assert.equal(ready.totalSubtopics, 5);
  assert.equal(ready.chunksWithoutSubtopic, 1);
  const review = computeMappingHealth([
    { level: 2, wordCount: 400, aiTopicKey: 'x', aiSubtopicId: 'st0302', mappingStatus: MAPPING_STATUS.AUTO, mappingConfidence: 0.97 },
    { level: 2, wordCount: 300, aiTopicKey: 'x', aiSubtopicId: '', mappingStatus: MAPPING_STATUS.AUTO, mappingConfidence: 0.95 },
  ], t);
  assert.equal(review.status, 'needs_review');
  assert.equal(review.unmappedHighValueSections, 1);
  assert.equal(computeMappingHealth([], buildCurriculumTree([])).status, 'no_curriculum');
});

test('selection resolves to DB IDs and labels, not request wording', () => {
  const rows = ROWS.slice(0, 3);
  const sel = resolveSelectionFromRows(rows, { subtopicName: 'evaporation' });
  assert.equal(sel.aiSubtopicId, 'st0302');
  assert.equal(sel.subtopicName, 'Evaporation');
  assert.equal(sel.topicName, 'Chapter 3 - Matter in Our Surroundings');
  const missing = resolveSelectionFromRows(rows, { subtopicName: 'Sublimation' });
  assert.equal(missing.aiSubtopicId, '');
  assert.equal(missing.subtopicRequested, true);
  const multi = resolveSelectionFromRows(rows, { subTopics: ['Evaporation', 'Condensation'] });
  assert.deepEqual(multi.aiSubtopicIds, ['st0302', 'st0303']);
});

test('retrieval route: strict ID filter, fail closed, legacy for unmapped books', async () => {
  const curriculum = { aiTopicKey: 'T3', aiSubtopicId: 'st0302', aiSubtopicIds: [], topicName: 'Ch3', subtopicName: 'Evaporation' };
  const mapped = { hasMapped: async () => true };
  const strict = await resolveCurriculumRetrievalRoute({ bookId: 'b', topicName: 'Ch3', subtopicName: 'Evaporation', curriculum }, mapped);
  assert.equal(strict.mode, 'strict');
  assert.deepEqual(strict.filter, { aiTopicKey: 'T3', aiSubtopicId: 'st0302' });

  const whole = await resolveCurriculumRetrievalRoute({ bookId: 'b', topicName: 'Ch3', subtopicName: '', curriculum }, mapped);
  assert.deepEqual(whole.filter, { aiTopicKey: 'T3' });

  const missingSub = await resolveCurriculumRetrievalRoute(
    { bookId: 'b', topicName: 'Ch3', subtopicName: 'Sublimation', curriculum: { ...curriculum, aiSubtopicId: '' } },
    mapped,
  );
  assert.equal(missingSub.mode, 'blocked');
  assert.equal(missingSub.status, 'rag_scope_empty');

  const legacy = await resolveCurriculumRetrievalRoute({ bookId: 'b', topicName: 'Ch3', curriculum }, { hasMapped: async () => false });
  assert.equal(legacy.mode, 'legacy');

  process.env.BOOK_RAG_REQUIRE_CURRICULUM_MAPPING = 'true';
  try {
    const blocked = await resolveCurriculumRetrievalRoute({ bookId: 'b', topicName: 'Ch3', curriculum }, { hasMapped: async () => false });
    assert.equal(blocked.status, 'curriculum_unmapped');
  } finally {
    delete process.env.BOOK_RAG_REQUIRE_CURRICULUM_MAPPING;
  }
});

test('scope invariant flags any chunk from another subtopic', () => {
  const chunks = [{ aiTopicKey: 'T', aiSubtopicId: 'st0302' }, { aiTopicKey: 'T', aiSubtopicId: 'st0301' }];
  assert.equal(findScopeMismatches(chunks, { aiTopicKey: 'T', aiSubtopicId: 'st0302' }).length, 1);
  assert.equal(findScopeMismatches(chunks, { aiTopicKey: 'T' }).length, 0);
  assert.match(bookRetrievalFailureMessage('rag_scope_empty'), /no content mapped/);
});

test('real-book patterns: running headers, contents rows, question-style headings', () => {
  const page = (n, chapterNo, title, bodyLines) => [
    n % 2 ? `${title} \tChapter ${chapterNo}` : `Chapter ${chapterNo} \t${title}`,
    ...bodyLines,
    `asliprep.com Foundation\t${n}\tGrade VIII`,
    `-- ${n} of 12 --`,
  ].join('\n');
  const text = [
    'Contents\nChapter 1\nParticulate Nature of Matter \t1\nChapter 2\nElements and Mixtures \t9\n-- 1 of 12 --',
    'Preface line one\nChapter 2, ‘Elements and Mixtures’, considers how substances combine together\n-- 2 of 12 --',
    page(3, 1, 'Particulate Nature of Matter', ['1.1 Matter is Made of Particles', body('particles', 20)]),
    page(4, 1, 'Particulate Nature of Matter', ['1.2 What Governs the State of Matter?', body('state', 20)]),
    page(5, 1, 'Particulate Nature of Matter', [body('more state', 20)]),
    page(6, 1, 'Particulate Nature of Matter', ['1.2 Find the value of x in the equation', body('q', 5)]),
    page(7, 2, 'Elements and Mixtures', ['2.1 Let’s Learn about Mixtures', body('mix', 20)]),
    page(8, 2, 'Elements and Mixtures', [body('mix more', 20)]),
    page(9, 2, 'Elements and Mixtures', ['2.2 Elements', body('elements', 20)]),
  ].join('\n');
  const { pages } = removeRepeatedPageBoilerplate(splitPdfPages(text));
  const { text: clean, ranges } = joinPages(pages);
  const sections = detectBookSections(clean, ranges).filter((s) => s.level > 0);
  assert.deepEqual(sections.map((s) => s.number), ['1.1', '1.2', '2.1', '2.2']);
  // Running-header pages must not split 1.2: its text spans pages 4–6.
  const s12 = sections.find((s) => s.number === '1.2');
  assert.match(s12.text, /more state/);
});

test('six-section repairs ask only for what is missing', async () => {
  const { missingSixSectionIds, buildMissingSectionsPrompt, buildAnswerKeyCompletionPrompt } = await import('../ai/generators/_v2/six-section-generator.js');
  const partial = { core: { title: 'Mole Concept' }, objectives: {}, differentiation: {}, assessment: { answerKey: [] } };
  assert.deepEqual(missingSixSectionIds(partial), ['teacher', 'reallife']);
  assert.deepEqual(missingSixSectionIds(null).length, 6);
  const prompt = buildMissingSectionsPrompt({
    missing: ['teacher', 'reallife'],
    prompt: '"teacher": { "timing": "t", "tlm": [], "tips": [] },\n"reallife": { "connection": "c" }',
    params: { board: 'CBSE', subject: 'Chemistry', topic: 'Atoms', subTopic: 'Mole Concept' },
    toolSlug: 'homework-creator',
    json: partial,
  });
  assert.match(prompt, /exactly these keys: teacher, reallife/);
  assert.match(prompt, /"teacher": \{ "timing"/);
  const ak = buildAnswerKeyCompletionPrompt({
    questions: [{ label: 'C3', row: { q: 'Define mole.' } }],
    existing: [{ q: 'A1', answer: 'b', working: 'w' }],
    ragContext: 'A mole is 6.022 x 10^23 particles.',
  });
  assert.match(ak, /exactly 1 entries/);
  assert.match(ak, /C3: \{"q":"Define mole\."\}/);
  assert.match(ak, /6\.022/);
});

test('IIT foundation layout: ▶ headings, chapter topic list, exercise blocks, parent numbering', async () => {
  const rows = [
    { _id: 'b41', ...base, label: 'Chapter 4', topicName: 'Chapter 4 - Sequences and Progressions', subTopic: 'Basic Concepts and Arithmetic Progression', sortOrder: 1 },
    { _id: 'b42', ...base, label: 'Chapter 4', topicName: 'Chapter 4 - Sequences and Progressions', subTopic: 'Arithmetic Progression (A.P.)', sortOrder: 2 },
    { _id: 'b47', ...base, label: 'Chapter 4', topicName: 'Chapter 4 - Sequences and Progressions', subTopic: 'Sigma Notation and Special Series', sortOrder: 3 },
  ];
  const t = buildCurriculumTree(rows);
  const text = [
    // Chapter-opening topic list (no text under each line).
    '4.1 Basic Concepts and Arithmetic Progression', '4.2 Arithmetic Progression (A.P.)', '4.7 Sigma Notation and Special Series',
    'Synopsis - 1',
    '▶4.1 Basic Concepts and Arithmetic', body('intro', 20),
    '4.1.1 Sequence', body('sequence', 30),
    'Rough Work',
    '4.1.3 Series', body('series sum', 30),
    '▶ 4.2 Arithmetic Progression (A.P.)', body('ap', 30),
    '4.2.1 Definition', body('ap def', 30),
    '▶4.7 Sigma Notation and Special Series', body('sigma', 30),
    'Single Correct Answer Type – MCQ', body('mcq', 40),
    'Assertion – Reason Type', body('ar', 20),
    'Integer Type', body('int', 20),
  ].join('\n');
  const { sections } = await mapSectionsToCurriculum(detectBookSections(text, []), t, { windowSplit: false });
  const find = (n, title) => sections.find((s) => s.number === n && (!title || s.title.startsWith(title)) && s.wordCount > 0);
  assert.equal(find('4.1.1').aiSubtopicId, 'b41');
  assert.equal(find('4.1.1').mappingMethod, 'inherited_parent');
  // "Series" shares a word with "Sigma … Special Series" but its book parent is 4.1.
  assert.equal(find('4.1.3').aiSubtopicId, 'b41');
  assert.equal(find('4.2.1').aiSubtopicId, 'b42');
  const exercises = sections.filter((s) => s.kind === 'exercise');
  assert.equal(exercises.length, 1, 'consecutive exercise headings form one block');
  assert.equal(exercises[0].aiSubtopicId, '');
  assert.equal(exercises[0].mappingMethod, 'exercise_block');
  assert.match(exercises[0].text, /Integer Type/);
  // The sigma subtopic keeps only its own text, not the exercises.
  assert.ok(!/mcq/.test(find('4.7', 'Sigma').text));
  assert.ok(!sections.some((s) => /Rough Work/.test(s.title)));

  // Health counts subtopics by real chunks: the 0-word topic-list rows don't count.
  const health = computeMappingHealth(sections, t, { chunks: [{ aiSubtopicId: 'b41', mappingStatus: MAPPING_STATUS.AUTO }] });
  assert.equal(health.mappedSubtopics, 1);
  assert.equal(health.unmappedHighValueSections, 0, 'exercise blocks are not "unmapped"');
});

test('chapter list comes from detected chapters, not the legacy splitter', async () => {
  const { chaptersFromCurriculumSections } = await import('../ai/rag/books/book-ingestion-service.js');
  const chapters = chaptersFromCurriculumSections([
    { level: 0, chapterNumber: '', wordCount: 900 },
    { level: 2, chapterNumber: '1', chapterTitle: 'Introduction to Chemistry', wordCount: 300, aiTopicName: 'Chapter 1 - Intro' },
    { level: 2, kind: 'exercise', chapterNumber: '1', chapterTitle: 'Introduction to Chemistry', wordCount: 200 },
    { level: 2, chapterNumber: '2', chapterTitle: '', wordCount: 100, aiTopicName: 'Chapter 2 - Materials' },
  ]);
  assert.deepEqual(chapters.map((c) => [c.title, c.wordCount]), [
    ['Chapter 1 - Introduction to Chemistry', 500],
    ['Chapter 2 - Materials', 100],
  ]);
});

test('textbook figures: caption pages, crop boxes, question matching', async () => {
  const { pagesWithFigureCaptions, boxToCrop, parseFigureBoxes, pickFigureForQuestion, attachTextbookFigures } = await import('../ai/rag/books/book-figure-images.js');
  assert.deepEqual(pagesWithFigureCaptions([
    { num: 1, text: 'Contents' }, { num: 17, text: '... ▶ Fig 1.3 Syringe with Air ...' }, { num: 37, text: 'Table 2.1 Types of Mixtures' },
  ]), [17, 37]);
  const crop = boxToCrop([451, 339, 537, 660], 892, 1262);
  assert.ok(crop.w > 280 && crop.h > 100 && crop.sx < 302 && crop.sy < 569);
  assert.equal(boxToCrop([0, 0, 1000, 1000], 800, 1000), null, 'full-page box is a mis-detection');
  assert.equal(boxToCrop([10, 10, 12, 12], 800, 1000), null, 'tiny icon');
  assert.equal(parseFigureBoxes('{"figures":[{"caption":"Fig 1.3 Syringe with Air","box_2d":[1,2,3,4]}]}')[0].caption, 'Fig 1.3 Syringe with Air');

  const figures = [
    { assetId: 'F1', caption: 'Fig 1.3 Syringe with Air', imageUrl: '/uploads/book-figures/F1.png' },
    { assetId: 'F2', caption: 'Fig 1.11 Interconversion of Matter', imageUrl: '/uploads/book-figures/F2.png' },
  ];
  assert.equal(pickFigureForQuestion({ needsDiagram: true, imagePrompt: 'Interconversion of Matter' }, figures).assetId, 'F2');
  assert.equal(pickFigureForQuestion({ question: 'Observe the diagram of the syringe with air. Why is it easy to push?' }, figures).assetId, 'F1');
  assert.equal(pickFigureForQuestion({ needsDiagram: true, imagePrompt: 'Labelled human heart' }, figures), null);

  const record = { core: { sectionC_short: [
    { question: 'Observe the diagram below and name the change of state marked X.', answer: 'x', marks: 2, needsDiagram: true, imagePrompt: 'Fig 1.11 Interconversion of Matter' },
    { question: 'Define diffusion.', answer: 'y', marks: 2 },
  ] } };
  assert.equal(await attachTextbookFigures(record, figures), 1);
  assert.equal(record.core.sectionC_short[0].imageUrl, '/uploads/book-figures/F2.png');
  assert.equal(record.core.sectionC_short[0].figureSource, 'textbook');
  assert.equal(record.core.sectionC_short[1].imageUrl, undefined);
});

test('AI diagram trigger honours needsDiagram and diagram-stem text', async () => {
  const { questionNeedsDiagram } = await import('../ai/generators/diagrams/ai-diagram-generation-service.js');
  assert.equal(questionNeedsDiagram({ question: 'Why?', needsDiagram: true, imagePrompt: 'syringe' }), true);
  assert.equal(questionNeedsDiagram({ question: 'Observe the diagram and label the parts.' }), true);
  assert.equal(questionNeedsDiagram({ question: 'Define molarity.' }), false);
  assert.equal(questionNeedsDiagram({ question: 'Label the figure.', needsDiagram: true, imageUrl: '/x.png' }), false);
});

test('quality check ignores figure captions kept in hidden imagePrompt', async () => {
  const { validateV2QuestionContent } = await import('../ai/generators/_v2/six-section-quality.js');
  const content = {
    core: { sectionC_short: [{ question: 'Observe the diagram below. Name the process.', answer: 'Evaporation', marks: 2, needsDiagram: true, imagePrompt: 'Fig 1.11 Interconversion of Matter' }] },
    assessment: { answerKey: [{ q: 'C1', answer: 'Evaporation', working: '' }] },
  };
  assert.equal(validateV2QuestionContent(content).valid, true);
  content.core.sectionC_short[0].question = 'Refer to Figure 1.11 and name the process.';
  assert.equal(validateV2QuestionContent(content).valid, false);
});

test('generated figure images are public; other uploads stay private', async () => {
  const { isPublicUploadPath } = await import('../utils/upload-access.js');
  assert.equal(isPublicUploadPath('/ai-diagrams/diagram-1.png'), true);
  assert.equal(isPublicUploadPath('/book-figures/BOOK_FIG_x.png'), true);
  assert.equal(isPublicUploadPath('/pdf-knowledge/book.pdf'), false);
  assert.equal(isPublicUploadPath('/content/notes.pdf'), false);
});

test('effective mapping status requires real subtopic coverage', async () => {
  const { bookMappingStatus } = await import('../ai/rag/books/book-rag-service.js');
  const st = (m) => bookMappingStatus('x', { book: { curriculumMapping: m } });
  assert.equal(await st({ status: 'ready', mappedSubtopics: 44, totalSubtopics: 44 }), 'ready');
  assert.equal(await st({ status: 'ready', mappedSubtopics: 39, totalSubtopics: 40 }), 'ready');
  assert.equal(await st({ status: 'ready', mappedSubtopics: 0, totalSubtopics: 28 }), 'needs_review');
  assert.equal(await st({ status: 'needs_review', mappedSubtopics: 7, totalSubtopics: 111 }), 'needs_review');
  assert.equal(await st({}), 'not_mapped');
});
