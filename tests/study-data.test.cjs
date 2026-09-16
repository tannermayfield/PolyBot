'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const StudioData = require('../study-data.js');

const NOW = Date.UTC(2026, 8, 15, 12);
const DAY = 86400000;
const AUDIO = 'data:audio/webm;codecs=opus;base64,AQID';
const OTHER_AUDIO = 'data:audio/wav;base64,BAUG';
const THIRD_AUDIO = 'data:audio/ogg;base64,BwgJ';
const KEY = StudioData.STORAGE_KEY;
const copy = value => structuredClone(value);

function memory(initial = {}, delayed = false) {
  const values = copy(initial);
  const changes = new Set();
  const store = {
    values, writes: 0, emitsChanges: true,
    async get(keys) {
      if (delayed) await new Promise(resolve => setImmediate(resolve));
      return copy(Object.fromEntries(keys.filter(key => Object.hasOwn(values, key)).map(key => [key, values[key]])));
    },
    async set(items) {
      if (delayed) await new Promise(resolve => setImmediate(resolve));
      if (store.failNext) { store.failNext = false; throw new Error('Storage quota exceeded'); }
      Object.assign(values, copy(items)); store.writes++;
      for (const callback of changes) callback();
    },
    subscribe(callback) { changes.add(callback); return () => changes.delete(callback); },
    external(items) { Object.assign(values, copy(items)); for (const callback of changes) callback(); }
  };
  return store;
}
function locks() {
  let queue = Promise.resolve();
  return { requests: 0, request(name, fn) {
    assert.equal(name, `${KEY}:write`);
    this.requests++;
    const next = queue.then(fn); queue = next.catch(() => {}); return next;
  } };
}
function fixture(initial = {}, options = {}) {
  const storage = options.storage || memory(initial);
  let counter = 0;
  const api = StudioData.createStore({ storage, locks: options.locks || null, now: () => NOW,
    makeId: prefix => `${options.prefix || 'test'}-${prefix}-${++counter}` });
  return { api, storage };
}
function legacyPhrase(extra = {}) {
  return { id: 'old-phrase', savedTranslation: '¿Cómo estás?', english: 'How are you?', savedAt: NOW - DAY,
    source: 'video', videoClip: AUDIO, voiceboxAudio: OTHER_AUDIO, voiceboxAudioProfileId: 'speaker-1', recording: THIRD_AUDIO, ...extra };
}
function legacy(extra = {}) {
  return { sptubePhrases_es: [legacyPhrase()],
    voiceboxSettings: { baseUrl: 'http://127.0.0.1:17493', profileId: 'speaker-1', profileName: 'Luz' },
    sptubeVocabulary_es: { hola: 'learning', mundo: 'known', pendiente: 'learning' },
    sptubeDefinitions_es: { hola: { matched: 'hello', translation: 'hello there', sentence: 'Hola, ¿cómo estás?' },
      mundo: [{ translation: 'the world' }] }, ...extra };
}

test('first initialization seeds text only and repeated loads are read-only', async () => {
  const { api, storage } = fixture();
  const state = await api.init();
  assert.ok(state.phrases.length > 0);
  assert.ok(state.phrases.every(p => p.source === 'starter' && p.references.length === 0));
  assert.deepEqual(state.attempts, []);
  assert.deepEqual(state.voices, []);
  assert.deepEqual(state.reviews, {});
  assert.equal(state.settings.assessmentEnabled, false);
  assert.equal(state.settings.theme, 'system');
  assert.deepEqual(api.stats(state, NOW), { attempts: 0, practiceMinutes: 0, practicedDays: 0, dueSpeaking: 4, dueMeaning: 0 });
  assert.equal(storage.writes, 1);
  await api.load(); await api.load();
  assert.equal(storage.writes, 1);
  assert.equal(Object.hasOwn(state, '_meta'), false);
  assert.equal(StudioData.ACCENTS.length, 8);
});

test('Spanish migration retains source audio, reference voices and recordings without editing old stores', async () => {
  const initial = legacy({ sptubePhrases_fr: [legacyPhrase({ id: 'french-phrase', savedTranslation: 'Bonjour' })] });
  const { api, storage } = fixture(initial);
  const state = await api.load();
  assert.equal(state.phrases.length, 1);
  assert.equal(state.phrases[0].id, 'old-phrase');
  assert.equal(state.phrases[0].text, '¿Cómo estás?');
  assert.equal(state.phrases[0].translation, 'How are you?');
  assert.deepEqual(state.phrases[0].references.map(r => r.kind), ['original', 'voicebox']);
  assert.equal(state.phrases[0].references[0].audioUrl, AUDIO);
  assert.equal(state.voices[0].profileId, 'speaker-1');
  assert.equal(state.voices[0].name, 'Luz');
  assert.equal(state.attempts.length, 1);
  assert.equal(state.attempts[0].duration, 0, 'unknown legacy duration must not fabricate practice time');
  assert.equal(state.attempts[0].referenceSnapshot, undefined, 'legacy association is unknown');
  assert.equal(state.attempts[0].assessment, undefined);
  assert.equal(state.attempts[0].text, '¿Cómo estás?');
  await api.load(); await api.load();
  assert.equal(storage.writes, 1);
  for (const [key, value] of Object.entries(initial)) assert.deepEqual(storage.values[key], value);
  assert.deepEqual(Object.keys(storage.values).filter(key => !Object.hasOwn(initial, key)), [KEY]);
});

test('new legacy captures and recordings import once while studio edits remain intact', async () => {
  const { api, storage } = fixture(legacy());
  await api.load();
  await api.savePhrase({ id: 'old-phrase', text: '¿Cómo te encuentras?' });
  storage.external({ sptubePhrases_es: [legacyPhrase({ recording: AUDIO, voiceboxAudio: THIRD_AUDIO }),
    legacyPhrase({ id: 'new-capture', savedTranslation: 'Hasta luego', videoClip: null, voiceboxAudio: null, recording: null })] });
  const updated = await api.load();
  assert.equal(updated.phrases.length, 2);
  assert.equal(updated.phrases[0].text, '¿Cómo te encuentras?');
  assert.equal(updated.phrases[0].translation, 'How are you?');
  assert.equal(updated.phrases[0].references.length, 3);
  assert.equal(updated.attempts.length, 2);
  const writes = storage.writes;
  await api.load();
  assert.equal(storage.writes, writes);
});

test('vocabulary prefers matched definitions, retains missing meanings, and keeps mastery separate', async () => {
  const { api, storage } = fixture(legacy());
  const state = await api.load();
  assert.equal(state.vocabulary.find(v => v.word === 'hola').meaning, 'hello');
  assert.equal(state.vocabulary.find(v => v.word === 'mundo').meaning, 'the world');
  assert.equal(state.vocabulary.find(v => v.word === 'mundo').status, 'known');
  assert.equal(state.vocabulary.find(v => v.word === 'pendiente').meaning, '');
  assert.equal(api.dueItems(state, 'meaning', NOW).length, 2);
  await assert.rejects(async () => api.rateReview('meaning', 'es:pendiente', 'good'), /no saved meaning/);
  await api.rateReview('meaning', 'es:hola', 'good', NOW);
  const next = await api.load();
  assert.equal(api.dueItems(next, 'speaking', NOW).length, 1);
  assert.equal(api.dueItems(next, 'meaning', NOW).length, 1);
  assert.equal(storage.values.sptubeVocabulary_es.hola, 'learning');
});

test('Spanish-only keys work, but a present namespaced empty store supersedes stale legacy values', async () => {
  const { api } = fixture({ spanishPhrases: [legacyPhrase()], spanishVocabulary: { hola: 'known' },
    spanishDefinitions: { hola: { matched: 'hello' } } });
  const state = await api.load();
  assert.equal(state.phrases[0].id, 'old-phrase');
  assert.equal(state.vocabulary[0].meaning, 'hello');
  const empty = fixture({ spanishPhrases: [legacyPhrase()], sptubePhrases_es: [], spanishVocabulary: { hola: 'known' }, sptubeVocabulary_es: {} });
  const newer = await empty.api.load();
  assert.ok(newer.phrases.every(p => p.source === 'starter'));
  assert.deepEqual(newer.vocabulary, []);
});

test('deleting a phrase cascades recordings/reviews and tombstones prevent legacy and old-backup resurrection', async () => {
  const { api, storage } = fixture(legacy());
  await api.load();
  await api.rateReview('speaking', 'old-phrase', 'good');
  const before = await api.exportBackup();
  await api.removePhrase('old-phrase');
  let state = await api.load();
  assert.deepEqual(state.phrases, []);
  assert.deepEqual(state.attempts, []);
  assert.deepEqual(state.reviews, {});
  await api.importBackup(before);
  state = await api.load();
  assert.deepEqual(state.phrases, []);
  assert.deepEqual(state.attempts, []);
  assert.deepEqual(state.reviews, {});
  const deletedBackup = await api.exportBackup();
  const restored = fixture(legacy());
  await restored.api.importBackup(deletedBackup);
  assert.deepEqual((await restored.api.load()).phrases, []);
  assert.deepEqual(storage.values.sptubePhrases_es, legacy().sptubePhrases_es);
});

test('deleting the complete starter library does not seed it again', async () => {
  const { api } = fixture();
  const state = await api.load();
  for (const item of state.phrases) await api.removePhrase(item.id);
  assert.deepEqual((await api.load()).phrases, []);
});

test('deleted old recordings and voice settings do not reimport; removing a voice retains saved media', async () => {
  const { api } = fixture(legacy());
  const state = await api.load();
  await api.removeAttempt(state.attempts[0].id);
  await api.removeVoice(state.voices[0].id);
  const updated = await api.load();
  assert.deepEqual(updated.attempts, []);
  assert.deepEqual(updated.voices, []);
  assert.equal(updated.phrases[0].references.length, 2);
  assert.equal(updated.phrases[0].references[1].audioUrl, OTHER_AUDIO);
});

test('attempt history keeps immutable reference snapshots across phrase edits, voice removal and reassessment', async () => {
  const { api } = fixture();
  const p = await api.savePhrase({ text: 'Tengo muchas ganas de verte.', translation: 'I really look forward to seeing you.' });
  const v = await api.saveVoice({ name: 'Speaker', profileId: 'remote-voice', accentId: 'es-AR', baseUrl: 'http://127.0.0.1:17493' });
  const ref = await api.addReference(p.id, { label: 'Original delivery', kind: 'voicebox', audioUrl: AUDIO, voiceId: v.id, accentId: 'es-AR' });
  const first = await api.saveAttempt({ phraseId: p.id, audioUrl: OTHER_AUDIO, duration: 10, mode: 'test', accentId: 'es-AR', referenceId: ref.id });
  assert.equal(first.referenceSnapshot.text, p.text);
  await api.savePhrase({ id: p.id, text: 'Me gustaría verte.' });
  await api.removeVoice(v.id);
  const revised = await api.saveAttempt({ ...first, createdAt: NOW + DAY, accentId: 'es-MX', mode: 'practice', duration: 999,
    referenceSnapshot: { label: 'Changed', audioUrl: THIRD_AUDIO, text: 'Different text' }, selfRating: 'good',
    assessment: { provider: 'azure', locale: 'es-AR', transcript: p.text, accuracy: 88, fluency: null, completeness: 100, words: [], tips: [], limitations: [] } });
  assert.deepEqual(revised.referenceSnapshot, first.referenceSnapshot);
  assert.equal(revised.createdAt, first.createdAt);
  assert.equal(revised.duration, 10);
  assert.equal(revised.mode, 'test');
  assert.equal(revised.accentId, 'es-AR');
  assert.equal(revised.assessment.accuracy, 88);
  assert.equal(revised.selfRating, 'good');
  const state = await api.load();
  assert.equal(state.phrases.find(item => item.id === p.id).references.length, 1);
  assert.equal(state.attempts.length, 1);
  assert.deepEqual(state.reviews, {}, 'saving an attempt must not invent review mastery');
  await assert.rejects(async () => api.saveAttempt({ ...first, audioUrl: THIRD_AUDIO }), /cannot be replaced/);
});

test('recording accepts an explicit clip segment snapshot and rejects inverted bounds', async () => {
  const { api } = fixture();
  const p = await api.savePhrase({ text: 'Una frase larga. Otra parte.' });
  const segment = { label: 'Native clip', audioUrl: AUDIO, start: 1.2, end: 3.4, text: 'Otra parte.', accentId: 'es-CL' };
  const a = await api.saveAttempt({ phraseId: p.id, audioUrl: OTHER_AUDIO, duration: 2, accentId: 'es-CL', referenceSnapshot: segment });
  assert.deepEqual(a.referenceSnapshot, segment);
  assert.equal(a.text, 'Otra parte.');
  await assert.rejects(async () => api.saveAttempt({ phraseId: p.id, audioUrl: OTHER_AUDIO, accentId: 'es-CL', referenceSnapshot: { ...segment, end: 0.5 } }), /Segment end/);
});

test('attempt transcript stays frozen without a reference, including backwards-compatible older records', async () => {
  const { api, storage } = fixture();
  const p = await api.savePhrase({ text: 'La frase original.' });
  const a = await api.saveAttempt({ phraseId: p.id, audioUrl: AUDIO, duration: 5, accentId: 'es-MX' });
  assert.equal(a.text, p.text);
  await api.savePhrase({ id: p.id, text: 'Texto nuevo.' });
  const updated = await api.saveAttempt({ ...a, text: 'Mal texto', selfRating: 'again' });
  assert.equal(updated.text, p.text);
  const supplied = await api.saveAttempt({ phraseId: p.id, text: 'Solo el segmento.', audioUrl: OTHER_AUDIO, duration: 3, accentId: 'es-MX' });
  assert.equal(supplied.text, 'Solo el segmento.');
  delete storage.values[KEY].attempts[0].text;
  const writes = storage.writes;
  const older = await api.load();
  assert.equal(older.attempts[0].text, 'Texto nuevo.');
  assert.equal(storage.writes, writes, 'resolving an old missing transcript is a pure read');
  await api.savePhrase({ id: p.id, text: 'Una edición posterior.' });
  assert.equal((await api.load()).attempts[0].text, 'Texto nuevo.');
});

test('local mutation queue preserves concurrent operations and recovers after a failed write', async () => {
  const storage = memory({}, true);
  const { api } = fixture({}, { storage });
  await Promise.all(Array.from({ length: 25 }, (_, i) => api.savePhrase({ text: `Frase ${i}` })));
  let state = await api.load();
  assert.equal(state.phrases.filter(p => p.source === 'manual').length, 25);
  storage.failNext = true;
  await assert.rejects(api.savePhrase({ text: 'This must not be saved' }), /quota/);
  await api.savePhrase({ text: 'Saved after failure' });
  state = await api.load();
  assert.equal(state.phrases.filter(p => p.source === 'manual').length, 26);
  assert.ok(!state.phrases.some(p => p.text === 'This must not be saved'));
});

test('Web Locks serialize separate tabs/workers without losing writes or duplicate migration', async () => {
  const storage = memory(legacy(), true);
  const sharedLocks = locks();
  const first = fixture({}, { storage, locks: sharedLocks, prefix: 'first' }).api;
  const second = fixture({}, { storage, locks: sharedLocks, prefix: 'second' }).api;
  await Promise.all([first.load(), second.load()]);
  assert.equal(storage.writes, 1);
  await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 ? first : second).savePhrase({ text: `Shared phrase ${i}` })));
  const state = await second.load();
  assert.equal(state.phrases.length, 41);
  assert.equal(new Set(state.phrases.map(p => p.id)).size, 41);
  assert.equal(state.attempts.length, 1);
  assert.ok(sharedLocks.requests >= 43);
});

test('meaning and speaking schedules have independent due dates with an exact retry boundary', async () => {
  const { api } = fixture(legacy());
  await api.load();
  const meaning = await api.rateReview('meaning', 'es:hola', 'good', NOW);
  const speaking = await api.rateReview('speaking', 'old-phrase', 'easy', NOW);
  assert.equal(meaning.dueAt, NOW + DAY);
  assert.equal(speaking.dueAt, NOW + 4 * DAY);
  let state = await api.load();
  assert.ok(api.dueItems(state, 'meaning', NOW + DAY).some(v => v.id === 'es:hola'));
  assert.deepEqual(api.dueItems(state, 'speaking', NOW + DAY), []);
  const retry = await api.rateReview('speaking', 'old-phrase', 'again', NOW + DAY);
  assert.equal(retry.repetitions, 0);
  assert.equal(retry.dueAt, NOW + DAY + 600000);
  state = await api.load();
  assert.equal(api.dueItems(state, 'speaking', retry.dueAt - 1).length, 0);
  assert.equal(api.dueItems(state, 'speaking', retry.dueAt).length, 1);
  assert.equal(state.reviews['meaning:es:hola'].lastRating, 'good');
});

test('progress measures real attempts, recorded time and local calendar days and decreases on deletion', async () => {
  const { api } = fixture();
  const p = await api.savePhrase({ text: 'Buenos días.' });
  const a = await api.saveAttempt({ phraseId: p.id, audioUrl: AUDIO, duration: 30, accentId: 'es-MX', createdAt: NOW });
  await api.saveAttempt({ phraseId: p.id, audioUrl: OTHER_AUDIO, duration: 45, accentId: 'es-MX', createdAt: NOW + DAY });
  const state = await api.load();
  assert.deepEqual(api.stats(state, NOW), { attempts: 2, practiceMinutes: 1.3, practicedDays: 2, dueSpeaking: 5, dueMeaning: 0 });
  await api.removeAttempt(a.id);
  assert.equal(api.stats(await api.load()).attempts, 1);
  assert.equal(api.stats(await api.load()).practiceMinutes, 0.8);
});

test('backup roundtrip retains audio, attempts, review schedules, vocabulary and settings', async () => {
  const { api } = fixture(legacy());
  await api.load();
  await api.rateReview('meaning', 'es:hola', 'hard', NOW);
  await api.rateReview('speaking', 'old-phrase', 'good', NOW);
  await api.saveSettings({ accentId: 'es-CO', voiceboxUrl: 'https://voices.example.test/api', theme: 'dark' });
  const backup = await api.exportBackup();
  const restored = fixture();
  await restored.api.importBackup(JSON.stringify(backup));
  const state = await restored.api.load();
  const original = await api.load();
  assert.deepEqual(state, original);
  assert.equal(state.settings.theme, 'dark');
  assert.equal(restored.storage.values.spanishVocabulary, undefined);
  assert.equal(restored.storage.values.sptubeVocabulary_es, undefined);
});

test('backup merge preserves current records, permits new references and favors live vocabulary status', async () => {
  const first = fixture(legacy());
  const original = await first.api.exportBackup();
  const ref = { id: 'incoming-ref', kind: 'upload', label: 'Another speaker', audioUrl: THIRD_AUDIO, createdAt: NOW };
  original.state.phrases[0].references.push(ref);
  original.state.phrases[0].text = 'Backup edit';
  original.state.attempts[0].duration = 999;
  original.state.vocabulary.find(v => v.word === 'hola').status = 'known';
  await first.api.savePhrase({ id: 'old-phrase', text: 'Current edit' });
  await first.api.saveSettings({ accentId: 'es-PE' });
  await first.api.importBackup(original);
  const state = await first.api.load();
  assert.equal(state.phrases[0].text, 'Current edit');
  assert.equal(state.phrases[0].references.length, 3);
  assert.equal(state.attempts[0].duration, 0);
  assert.equal(state.settings.accentId, 'es-PE');
  assert.equal(state.vocabulary.find(v => v.word === 'hola').status, 'learning');
  const again = await first.api.exportBackup();
  await first.api.importBackup(again);
  assert.equal((await first.api.load()).phrases[0].references.length, 3);
});

test('invalid backups and unsafe object keys fail atomically without prototype pollution', async () => {
  const { api, storage } = fixture(legacy());
  const valid = await api.exportBackup();
  const before = copy(storage.values);
  const bad = [
    '{',
    { ...valid, format: 'other' },
    { ...valid, version: 2 },
    { ...valid, state: { ...valid.state, attempts: [{ ...valid.state.attempts[0], phraseId: 'missing' }] } },
    { ...valid, state: { ...valid.state, voices: [{ ...valid.state.voices[0], baseUrl: 'http://public.example.com' }] } },
    { ...valid, state: { ...valid.state, phrases: [valid.state.phrases[0], valid.state.phrases[0]] } },
    { ...valid, state: { ...valid.state, attempts: [{ ...valid.state.attempts[0], audioUrl: 'javascript:alert(1)' }] } },
    { ...valid, state: { ...valid.state, attempts: [{ ...valid.state.attempts[0], createdAt: undefined }] } },
    JSON.parse(JSON.stringify(valid).replace('"settings":{', '"settings":{"__proto__":{"polluted":true},')),
    { ...valid, state: { ...valid.state, settings: { ...valid.state.settings, constructor: { prototype: { polluted: true } } } } }
  ];
  for (const input of bad) {
    await assert.rejects(async () => api.importBackup(input));
    assert.deepEqual(storage.values, before);
  }
  assert.equal({}.polluted, undefined);
  const circular = copy(valid); circular.state.loop = circular;
  await assert.rejects(api.importBackup(circular), /circular/);
});

test('CRUD rejects unsafe endpoints, content, unknown phrases and invalid region/assessment values', async () => {
  const { api } = fixture();
  const p = await api.savePhrase({ text: 'Hola.' });
  await assert.rejects(async () => api.saveSettings({ voiceboxUrl: 'http://external.example.com' }), /HTTPS/);
  await assert.rejects(async () => api.saveSettings({ assessmentUrl: 'https://user:password@example.com' }), /credentials/);
  await assert.rejects(async () => api.saveSettings({ accentId: 'en-US' }), /Spanish/);
  await assert.rejects(async () => api.saveSettings({ theme: 'midnight' }), /light, dark, or system/);
  await assert.rejects(async () => api.savePhrase({ text: 'Hola', sourceUrl: 'javascript:alert(1)' }), /HTTP/);
  await assert.rejects(async () => api.savePhrase({ text: '  ' }), /Spanish phrase/);
  await assert.rejects(async () => api.addReference('missing', { kind: 'upload', audioUrl: AUDIO }), /no longer exists/);
  await assert.rejects(async () => api.addReference(p.id, { kind: 'upload', audioUrl: 'data:text/html;base64,AQID' }), /audio data URL/);
  await assert.rejects(async () => api.saveAttempt({ phraseId: p.id, audioUrl: AUDIO, accentId: 'es-MX', assessment: { provider: 'azure', locale: 'es-MX', accuracy: 101 } }), /score/);
});

test('subscriptions report external changes and unsubscribe cleanly', async () => {
  const { api, storage } = fixture();
  await api.load();
  let calls = 0;
  const stop = api.subscribe(() => { calls++; });
  await api.savePhrase({ text: 'Hola.' });
  assert.equal(calls, 1);
  storage.external({ sptubeVocabulary_es: { hola: 'known' } });
  assert.equal(calls, 2);
  assert.equal((await api.load()).vocabulary[0].status, 'known');
  stop();
  await api.saveSettings({ accentId: 'es-CU' });
  assert.equal(calls, 2);
});

test('MV3 service worker initialization needs no DOM or localStorage and surfaces chrome errors', async () => {
  const values = {};
  const changed = new Set();
  let context;
  const realmCopy = value => vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(value))})`, context);
  const chrome = { runtime: {}, storage: {
    local: {
      get(keys, callback) { callback(realmCopy(Object.fromEntries(keys.filter(key => Object.hasOwn(values, key)).map(key => [key, values[key]])))); },
      set(items, callback) { Object.assign(values, copy(items)); callback(); for (const listener of changed) listener(Object.fromEntries(Object.keys(items).map(key => [key, {}])), 'local'); }
    },
    onChanged: { addListener(fn) { changed.add(fn); }, removeListener(fn) { changed.delete(fn); } }
  } };
  context = vm.createContext({ chrome, URL });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../study-data.js'), 'utf8'), context);
  const state = await context.StudioData.load();
  assert.equal(state.phrases.length, 4);
  assert.equal(typeof context.document, 'undefined');
  assert.equal(typeof context.localStorage, 'undefined');
  // Data objects passed to the browser API originate in the same worker realm.
  const created = await vm.runInContext('StudioData.savePhrase({text:"Capturada en una página",source:"web",sourceUrl:"https://example.com/article"})', context);
  assert.equal(created.source, 'web');
  chrome.runtime.lastError = { message: 'Access denied' };
  await assert.rejects(context.StudioData.load(), /Access denied/);
});

test('localhost preview uses localStorage, propagates quota errors and never overwrites corrupted state', async () => {
  const values = new Map();
  const localStorage = {
    fail: false, writes: 0,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { if (this.fail) throw new Error('QuotaExceeded'); values.set(key, value); this.writes++; }
  };
  const context = vm.createContext({ localStorage, URL, addEventListener() {}, removeEventListener() {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../study-data.js'), 'utf8'), context);
  await context.StudioData.load();
  assert.ok(values.has(KEY));
  assert.equal(localStorage.writes, 1);
  await context.StudioData.load();
  assert.equal(localStorage.writes, 1);
  localStorage.fail = true;
  await assert.rejects(vm.runInContext('StudioData.savePhrase({text:"Hola"})', context), /storage may be full/);
  localStorage.fail = false;
  values.set(KEY, '{invalid');
  await assert.rejects(context.StudioData.load(), /damaged/);
  assert.equal(values.get(KEY), '{invalid');
});
