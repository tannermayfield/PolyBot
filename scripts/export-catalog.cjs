'use strict';
// Exports the extension's content catalog as JSON for the insights database (ADR-015).
// JavaScript stays the single source of truth; `python -m polybot_insights.catalog`
// loads the output into core.*.
//
//   node scripts/export-catalog.cjs [--out insights/build/catalog.json]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const LEVEL_BAND = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 5 };
const MEDIA_SKILL = { reading: 'reading_comprehension', listening: 'listening_comprehension' };

function loadBrowserGlobal(file, name) {
  const context = { window: {} };
  context.self = context;
  vm.runInNewContext(read(file), context);
  return context[name] || context.window[name];
}

function buildCatalog() {
  const { LANGUAGES } = loadBrowserGlobal('languages.js', 'SPTubeLang');
  const { CATALOG } = require(path.join(root, 'learning-data.js'));
  const { CATEGORIES } = loadBrowserGlobal('personalization-interests.js', 'PersonalizationInterests');
  const frequency = require(path.join(root, 'frequency-data.js'));

  const languages = LANGUAGES.map(l => ({ code: l.code, name: l.name, is_rtl: l.rtl === true }));
  const courses = languages.map(l => ({ course_id: `path:${l.code}`, language_code: l.code, title: `${l.name} learning path` }));
  // Same ID scheme as learning-data.js deriveGrammar(): grammar:<lang>:<level>:<slug>.
  const grammar = languages.flatMap(l => CATALOG.TOPICS.map(([level, slug]) => ({
    lesson_id: `grammar:${l.code}:${level}:${slug}`, lesson_type: 'grammar_topic', language_code: l.code,
    course_id: `path:${l.code}`, primary_skill_id: `grammar.${slug}`, cefr_level: level, difficulty_band: LEVEL_BAND[level]
  })));
  const media = Object.entries(CATALOG.PROVIDED_MEDIA).flatMap(([code, items]) => items.map(item => ({
    lesson_id: item.id, lesson_type: 'media_item', language_code: code, course_id: null,
    primary_skill_id: MEDIA_SKILL[item.kind], cefr_level: null, difficulty_band: null
  })));
  const topics = CATEGORIES.flatMap(c => c.items.map(item => ({ topic_id: item.id, category: c.name, label: item.label })));
  // Only Spanish has frequency bands (languages.js CATCHUP_SUPPORTED); band 1 = most frequent.
  const vocabulary = frequency.flatMap(band => band.words.map(word => ({
    vocab_item_id: `es:${word.toLowerCase()}`, language_code: 'es', term: word.toLowerCase(), difficulty_band: band.level
  })));

  for (const lesson of [...grammar, ...media]) {
    if (!lesson.primary_skill_id) throw new Error(`No skill for ${lesson.lesson_id}`);
  }
  return {
    schema_version: 1,
    sources: ['languages.js', 'learning-data.js', 'personalization-interests.js', 'frequency-data.js'],
    grammar_skill_ids: CATALOG.TOPICS.map(([, slug]) => `grammar.${slug}`),
    languages, courses, lessons: [...grammar, ...media], topics, vocabulary
  };
}

if (require.main === module) {
  const at = process.argv.indexOf('--out');
  const json = JSON.stringify(buildCatalog(), null, 1);
  if (at === -1) process.stdout.write(json + '\n');
  else {
    const out = path.resolve(process.argv[at + 1]);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, json + '\n');
    console.error(`Wrote ${out}`);
  }
}

module.exports = { buildCatalog };
