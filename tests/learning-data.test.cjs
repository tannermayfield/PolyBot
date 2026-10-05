'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const LearningData = require('../learning-data.js');

const NOW = Date.UTC(2026, 8, 15, 12);
const AUDIO = 'data:audio/webm;base64,AQID';
const LANGUAGES = [
  { code: 'en', name: 'English', speechLang: 'en-US' },
  { code: 'es', name: 'Spanish', speechLang: 'es-ES' },
  { code: 'fr', name: 'French', speechLang: 'fr-FR' },
  { code: 'ja', name: 'Japanese', speechLang: 'ja-JP' },
  { code: 'ar', name: 'Arabic', speechLang: 'ar-SA', rtl: true }
];
const langApi = {
  LANGUAGES, DEFAULT_LANG: 'es', DEFAULT_NATIVE_LANG: 'en',
  storageKeys: code => ({ vocab: `sptubeVocabulary_${code}`, defs: `sptubeDefinitions_${code}`, phrases: `sptubePhrases_${code}` })
};
const copy = value => structuredClone(value);

function memory(initial = {}, delayed = false) {
  const values = copy(initial);
  return {
    values, writes: [],
    async get(keys) {
      if (delayed) await new Promise(resolve => setImmediate(resolve));
      return copy(Object.fromEntries(keys.filter(key => Object.hasOwn(values, key)).map(key => [key, values[key]])));
    },
    async set(items) {
      if (delayed) await new Promise(resolve => setImmediate(resolve));
      Object.assign(values, copy(items)); this.writes.push(copy(items));
    }
  };
}
function fixture(initial = {}, options = {}) {
  const storage = options.storage || memory(initial, options.delayed);
  const api = LearningData.createStore({ storage, langApi, runtime: Object.hasOwn(options, 'runtime') ? options.runtime : null,
    locks: null, now: options.now || (() => NOW) });
  return { api, storage };
}
function frenchData(extra = {}) {
  return {
    sptubeTargetLang: 'fr', sptubeNativeLang: 'en',
    sptubeVocabulary_fr: { Bonjour: 'learning', monde: 'known', inconnu: 'learning' },
    sptubeDefinitions_fr: {
      bonjour: [{ translation: 'hello there', matched: 'hello', sentence: 'Bonjour, Marie.', savedAt: NOW }],
      monde: { translation: 'world', savedAt: NOW - 1 }
    },
    sptubePhrases_fr: [{ id: 'phrase-1', savedTranslation: 'Bonjour tout le monde.', english: 'Hello everyone.',
      source: 'video', videoClip: AUDIO, sourceUrl: 'https://example.test/video', savedAt: NOW - 100 }],
    ...extra
  };
}

test('load returns the selected language profile and an honest empty learner state', async () => {
  const { api, storage } = fixture({ sptubeTargetLang: 'ja', sptubeNativeLang: 'ar' });
  const state = await api.load();
  assert.deepEqual(state.target, { code: 'ja', name: 'Japanese', speechLang: 'ja-JP', rtl: false });
  assert.deepEqual(state.native, { code: 'ar', name: 'Arabic', speechLang: 'ar-SA', rtl: true });
  assert.deepEqual(state.targetLanguages.map(item => item.code), ['ja']);
  assert.deepEqual(state.vocabulary, []);
  assert.deepEqual(state.media, []);
  assert.equal(state.grammarTopics.length, 25);
  assert.deepEqual([...new Set(state.grammarTopics.map(topic => topic.level))], ['A1', 'A2', 'B1', 'B2', 'C1']);
  assert.ok(state.grammarTopics.every(topic => !topic.completed && topic.practice.steps.length === 4));
  assert.ok(state.path.every(step => !step.completed && step.progress.completed === 0 && step.aiLessonStatus === 'planned'));
  assert.equal(storage.writes.length, 0, 'a first load must not seed progress');
});

test('vocabulary supports any configured language, prefers matched text, and keeps empty meanings', async () => {
  const { api, storage } = fixture(frenchData());
  const state = await api.load();
  assert.deepEqual(state.vocabulary.map(item => [item.word, item.status, item.meaning]), [
    ['Bonjour', 'learning', 'hello'], ['inconnu', 'learning', ''], ['monde', 'known', 'world']
  ]);
  assert.equal(state.vocabulary[0].definitions[0].sentence, 'Bonjour, Marie.');
  assert.deepEqual(storage.values.sptubeVocabulary_fr, frenchData().sptubeVocabulary_fr, 'load must not rewrite the legacy vocabulary store');
  assert.equal(storage.writes.length, 0);
});

test('vocabulary mastery snapshots are real, deduplicated, and language-scoped', async () => {
  let tick = NOW;
  const { api, storage } = fixture(frenchData(), { now: () => ++tick });
  const first = await api.recordVocabularySnapshot();
  assert.deepEqual(first, { targetCode: 'fr', known: 1, total: 3, recordedAt: NOW + 1 });
  await api.recordVocabularySnapshot();
  assert.equal(storage.values.giftOfTonguesLearning.vocabularyMasterySnapshots.length, 1, 'unchanged mastery must not invent another point');
  storage.values.sptubeVocabulary_fr.Bonjour = 'known';
  const second = await api.recordVocabularySnapshot();
  assert.deepEqual(second, { targetCode: 'fr', known: 2, total: 3, recordedAt: NOW + 3 });
  storage.values.sptubeVocabulary_es = { hola: 'known' };
  await api.recordVocabularySnapshot('es');
  await assert.rejects(api.recordVocabularySnapshot('xx'), /supported target language/);
  await api.setLanguages('es', 'en');
  const state = await api.load();
  assert.deepEqual(state.vocabularyMastery.map(item => item.targetCode), ['es']);
  assert.deepEqual(state.vocabularyMastery.map(item => [item.known, item.total]), [[1, 1]]);
  await api.setLanguages('fr', 'en');
  assert.deepEqual((await api.load()).vocabularyMastery.map(item => [item.known, item.total]), [[1, 3], [2, 3]]);
});

test('setLanguages validates codes, persists existing language keys, and switches data sets', async () => {
  const { api, storage } = fixture({
    sptubeTargetLang: 'es', sptubeNativeLang: 'en', sptubeVocabulary_es: { hola: 'known' },
    sptubeVocabulary_fr: { salut: 'learning' }, sptubeDefinitions_fr: { salut: { matched: 'hi' } }
  });
  const state = await api.setLanguages('fr', 'ja');
  assert.equal(state.target.code, 'fr');
  assert.equal(state.native.code, 'ja');
  assert.equal(state.vocabulary[0].word, 'salut');
  assert.deepEqual(storage.values.sptubeVocabulary_es, { hola: 'known' });
  assert.deepEqual(storage.values.sptubeVocabulary_fr, { salut: 'learning' });
  await assert.rejects(api.setLanguages('xx', 'en'), /supported/);
});

test('target language choices persist and always include the active language', async () => {
  const { api, storage } = fixture({ sptubeTargetLang: 'es', sptubeNativeLang: 'en' });
  const state = await api.setLanguages('fr', 'en', ['es', 'ja', 'es']);
  assert.deepEqual(state.targetLanguages.map(item => item.code), ['fr', 'es', 'ja']);
  assert.deepEqual(storage.values.giftOfTonguesLearning.targetLanguages, ['fr', 'es', 'ja']);
  const switched = await api.setLanguages('ja', 'en', state.targetLanguages.map(item => item.code));
  assert.deepEqual(switched.targetLanguages.map(item => item.code), ['ja', 'fr', 'es']);
  await assert.rejects(api.setLanguages('fr', 'en', ['xx']), /supported target languages/);
});

test('saved phrases become reading or listening media without invented completion', async () => {
  const data = frenchData({ sptubePhrases_fr: [
    frenchData().sptubePhrases_fr[0],
    { id: 'phrase-2', savedTranslation: 'Une lecture.', english: 'A reading.', source: 'web', savedAt: NOW },
    { id: 'invalid', savedTranslation: '', english: 'missing target' }
  ] });
  const { api } = fixture(data);
  const state = await api.load();
  assert.equal(state.media.length, 2);
  assert.equal(state.media[0].kind, 'reading');
  assert.equal(state.media[0].origin, 'saved');
  assert.equal(state.media[0].experience, 'interactive');
  assert.deepEqual(state.media[0].interactionModes, ['read', 'write', 'speak']);
  assert.equal(state.media[1].kind, 'listening');
  assert.equal(state.media[1].audioUrl, AUDIO);
  assert.equal(state.media[1].sourceUrl, 'https://example.test/video');
  assert.ok(state.media.every(item => !item.completed && Object.keys(item.responses).length === 0));
});

test('Spanish includes stable provided reading and listening choices for both experiences', async () => {
  const { api } = fixture({ sptubeTargetLang: 'es', sptubeNativeLang: 'en' });
  const media = (await api.load()).media;
  assert.equal(media.length, 4);
  assert.equal(new Set(media.map(item => item.id)).size, 4);
  assert.ok(media.every(item => item.id.startsWith('media:es:provided:') && item.origin === 'provided'));
  for (const kind of ['reading', 'listening']) {
    const interactive = media.find(item => item.kind === kind && item.experience === 'interactive');
    const carefree = media.find(item => item.kind === kind && item.experience === 'carefree');
    assert.ok(interactive, `missing interactive ${kind}`);
    assert.ok(carefree, `missing carefree ${kind}`);
    assert.ok(interactive.interactionModes.includes('write'));
    assert.ok(interactive.interactionModes.includes('speak'));
    assert.deepEqual(carefree.interactionModes, [kind === 'reading' ? 'read' : 'listen']);
  }
});

test('grammar practice and My Path progress are recorded only after explicit completion', async () => {
  const { api, storage } = fixture(frenchData());
  let state = await api.load();
  const topic = state.grammarTopics.find(item => item.level === 'A1');
  assert.equal(state.path[0].progress.completed, 0);
  assert.deepEqual(storage.values.giftOfTonguesLearning, undefined);
  const completion = await api.completeActivity(topic.id);
  assert.deepEqual(completion, { id: topic.id, completedAt: NOW });
  state = await api.load();
  assert.equal(state.grammarTopics.find(item => item.id === topic.id).completedAt, NOW);
  assert.deepEqual(state.path[0].progress, { completed: 1, total: 5 });
  assert.equal(state.path[0].completed, false, 'topic progress must not invent path-step completion');
  await api.completeActivity(state.path[0].id);
  assert.equal((await api.load()).path[0].completed, true);
  const spanish = await api.setLanguages('es', 'en');
  assert.equal(spanish.grammarTopics.find(item => item.title === topic.title).completed, false, 'grammar completion must stay with its target language');
  assert.ok(topic.id.startsWith('grammar:fr:'));
  await assert.rejects(api.completeActivity('made-up-lesson'), /unavailable/);
});

test('Spanish keeps legacy grammar completion while new progress remains language-scoped', async () => {
  const { api } = fixture({
    sptubeTargetLang: 'es', sptubeNativeLang: 'en',
    giftOfTonguesLearning: {version:1,mediaResponses:[],targetLanguages:[],completedActivities:{'grammar:A1:word-order':NOW}}
  });
  const spanish = await api.load();
  assert.equal(spanish.grammarTopics.find(item => item.title === 'Basic word order').completed, true);
  const french = await api.setLanguages('fr','en');
  assert.equal(french.grammarTopics.find(item => item.title === 'Basic word order').completed, false);
});

test('writing and speaking reflections are bounded, update in place, and require current media', async () => {
  let tick = NOW;
  const { api, storage } = fixture(frenchData(), { now: () => ++tick });
  const itemId = (await api.load()).media[0].id;
  const writing = await api.saveMediaResponse({ itemId, mode: 'writing', text: '  I noticed the greeting.  ' });
  assert.equal(writing.text, 'I noticed the greeting.');
  await api.saveMediaResponse({ itemId, mode: 'writing', text: 'Revised response' });
  await api.saveMediaResponse({ itemId, mode: 'speaking', text: 'I practiced this aloud.' });
  const item = (await api.load()).media[0];
  assert.equal(item.responses.writing.text, 'Revised response');
  assert.equal(item.responses.speaking.text, 'I practiced this aloud.');
  assert.equal(storage.values.giftOfTonguesLearning.mediaResponses.length, 2);
  assert.deepEqual(storage.values.sptubePhrases_fr, frenchData().sptubePhrases_fr);
  await assert.rejects(api.saveMediaResponse({ itemId, mode: 'drawing', text: 'x' }), /writing or speaking/);
  await assert.rejects(api.saveMediaResponse({ itemId: 'media:fr:missing', mode: 'writing', text: 'x' }), /unavailable/);
  await assert.rejects(api.saveMediaResponse({ itemId, mode: 'writing', text: 'x'.repeat(4001) }), /4000/);
});

test('dictionary lookup uses saved definitions before extension translation', async () => {
  const messages = [];
  const runtime = { sendMessage(message, callback) {
    messages.push(message);
    callback({ translation: message.text === 'cheese' ? 'fromage' : 'network value', sourceLang:message.text === 'cheese' ? 'en' : 'fr', targetLang:message.text === 'cheese' ? 'fr' : 'en' });
  } };
  const { api } = fixture(frenchData(), { runtime });
  const saved = await api.lookup('Bonjour');
  assert.deepEqual(saved, { status: 'found', source: 'saved', term: 'Bonjour', targetCode: 'fr', nativeCode: 'en', sourceLang:'fr', targetLang:'en', translation: 'hello' });
  assert.equal(messages.length, 0);
  const translated = await api.lookup('fromage');
  assert.equal(translated.status, 'found');
  assert.equal(translated.source, 'translation');
  assert.equal(translated.translation, 'network value');
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0], { type: 'TRANSLATE_DICTIONARY_AUTO', text: 'fromage', targetLang: 'fr', nativeLang: 'en' });
  const reverse = await api.lookup('cheese');
  assert.equal(reverse.translation, 'fromage');
  assert.deepEqual({sourceLang:reverse.sourceLang,targetLang:reverse.targetLang},{sourceLang:'en',targetLang:'fr'});
  assert.deepEqual(messages[1], { type: 'TRANSLATE_DICTIONARY_AUTO', text: 'cheese', targetLang: 'fr', nativeLang: 'en' });
});

test('standalone lookup and failed extension lookup return explicit unavailable states', async () => {
  const standalone = fixture(frenchData()).api;
  assert.deepEqual(await standalone.lookup('fromage'), {
    status: 'unavailable', source: 'preview', term: 'fromage', targetCode: 'fr', nativeCode: 'en', translation: '',
    message: 'Live dictionary lookup is available in the installed extension.'
  });
  const failed = fixture(frenchData(), { runtime: { sendMessage(message, callback) { callback(null); } } }).api;
  const result = await failed.lookup('fromage');
  assert.equal(result.status, 'unavailable');
  assert.equal(result.source, 'translation');
  await assert.rejects(standalone.lookup(' '.repeat(4)), /Lookup term/);
});

test('malformed legacy data is ignored safely and unsafe inputs never pollute prototypes', async () => {
  const hostile = JSON.parse('{"__proto__":{"polluted":true},"bonjour":"known"}');
  const { api } = fixture({
    sptubeTargetLang: 'fr', sptubeNativeLang: 'en', sptubeVocabulary_fr: hostile,
    sptubeDefinitions_fr: { bonjour: [{ matched: 'hello' }, null, { matched: '' }] },
    sptubePhrases_fr: [{ savedTranslation: 3 }, null],
    giftOfTonguesLearning: JSON.parse('{"completedActivities":{"__proto__":4,"grammar:fr:A1:word-order":' + NOW + '}}')
  });
  const state = await api.load();
  assert.equal(state.vocabulary[0].meaning, 'hello');
  assert.equal(state.grammarTopics[0].completed, true);
  assert.equal({}.polluted, undefined);
  const unsafe = Object.create(null);
  unsafe.itemId = 'media:fr:x'; unsafe.mode = 'writing'; unsafe.text = 'okay'; unsafe.constructor = { prototype: { polluted: true } };
  await assert.rejects(api.saveMediaResponse(unsafe), /unsafe/);
  assert.equal({}.polluted, undefined);
});

test('serialized writes preserve concurrent completions and media responses', async () => {
  let tick = NOW;
  const storage = memory(frenchData(), true);
  const { api } = fixture({}, { storage, now: () => ++tick });
  const loaded = await api.load();
  const itemId = loaded.media[0].id;
  const activities = loaded.grammarTopics.slice(0, 10).map(item => item.id);
  await Promise.all([
    ...activities.map(id => api.completeActivity(id)),
    api.saveMediaResponse({ itemId, mode: 'writing', text: 'Concurrent writing' }),
    api.saveMediaResponse({ itemId, mode: 'speaking', text: 'Concurrent speaking' })
  ]);
  const state = await api.load();
  assert.equal(state.grammarTopics.filter(item => item.completed).length, 10);
  assert.equal(state.media[0].responses.writing.text, 'Concurrent writing');
  assert.equal(state.media[0].responses.speaking.text, 'Concurrent speaking');
  assert.deepEqual(storage.values.sptubeVocabulary_fr, frenchData().sptubeVocabulary_fr);
});

test('browser global works with callback-based chrome.storage.local', async () => {
  const values = copy(frenchData());
  let context;
  const realmCopy = value => vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(value))})`, context);
  const chrome = { runtime: { sendMessage(message, callback) { callback({ translation: 'cheese' }); } }, storage: { local: {
    get(keys, callback) { callback(realmCopy(Object.fromEntries(keys.filter(key => Object.hasOwn(values, key)).map(key => [key, values[key]])))); },
    set(items, callback) { Object.assign(values, copy(items)); callback(); }
  } } };
  context = vm.createContext({ chrome, URL });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../languages.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../learning-data.js'), 'utf8'), context);
  const state = await context.LearningData.load();
  assert.equal(state.target.code, 'fr');
  assert.equal(state.vocabulary.length, 3);
  const translated = await vm.runInContext('LearningData.lookup("fromage")', context);
  assert.equal(translated.translation, 'cheese');
  await vm.runInContext('LearningData.completeActivity("grammar:fr:A1:word-order")', context);
  assert.equal(values.giftOfTonguesLearning.completedActivities['grammar:fr:A1:word-order'] > 0, true);
});

test('localhost preview uses localStorage and returns an unavailable live lookup', async () => {
  const values = new Map([
    ['sptubeTargetLang', JSON.stringify('fr')], ['sptubeNativeLang', JSON.stringify('en')],
    ['sptubeVocabulary_fr', JSON.stringify({ salut: 'learning' })]
  ]);
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); }
  };
  const context = vm.createContext({ localStorage, URL });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../languages.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../learning-data.js'), 'utf8'), context);
  const state = await context.LearningData.load();
  assert.equal(state.target.code, 'fr');
  assert.equal(state.vocabulary[0].word, 'salut');
  const result = await vm.runInContext('LearningData.lookup("bonjour")', context);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.source, 'preview');
  await vm.runInContext('LearningData.setLanguages("ja", "ar")', context);
  assert.equal(JSON.parse(values.get('sptubeTargetLang')), 'ja');
  assert.equal(JSON.parse(values.get('sptubeNativeLang')), 'ar');
});
