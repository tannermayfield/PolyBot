'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function background(overrides = {}, environment = {}) {
  const listeners = [];
  const phrases = [];
  const references = [];
  const tabs = [];
  const stored = {};
  const context = vm.createContext({
    URL, console, setTimeout, clearTimeout, crypto,
    fetch: environment.fetch,
    importScripts: (...names) => {
      assert.deepEqual(names, ['study-data.js', 'insights-events.js', 'languages.js', 'vocab-writer.js']);
      for (const name of names.slice(1)) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'), context);
    },
    chrome: {
      runtime: { id: 'test', onMessage: { addListener: fn => listeners.push(fn) }, getURL: file => 'chrome-extension://test/' + file, getManifest: () => ({ version: '3.0.0' }) },
      ...(environment.detectLanguage ? { i18n: { detectLanguage: environment.detectLanguage } } : {}),
      tabs: { create: async tab => { tabs.push(tab); } },
      alarms: { create() {}, clear() {}, onAlarm: { addListener() {} } },
      scripting: {},
      storage: { local: {
        get: async keys => structuredClone(Object.fromEntries(keys.filter(k => k in stored).map(k => [k, stored[k]]))),
        set: async items => { Object.assign(stored, structuredClone(items)); }
      } }
    },
    StudioData: {
      savePhrase: async phrase => { const result = { ...phrase, id: 'phrase-1' }; phrases.push(result); return result; },
      addReference: async (id, ref) => { references.push({ id, ...ref }); }, ...overrides
    }
  });
  context.self = context;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'), context);
  return { phrases, references, tabs, stored, context, send: (msg, sender = { url: 'https://example.com/article#selection' }) => new Promise(resolve => listeners[0](msg, sender, resolve)) };
}

function translationEnvironment(detectLanguage) {
  const requests = [];
  return {
    requests,
    environment: {
      detectLanguage,
      fetch: async value => {
        const url = new URL(value);
        requests.push(url);
        const source = url.searchParams.get('sl');
        const target = url.searchParams.get('tl');
        const translated = source === 'en' && target === 'es' ? 'Buenos días' : source === 'es' && target === 'en' ? 'Good morning' : 'translated';
        return { ok: true, json: async () => [[[translated]]] };
      }
    }
  };
}
test('web capture stores Spanish phrase and attributes the actual source tab', async () => {
  const bg = background();
  const result = await bg.send({ type: 'SAVE_STUDIO_PHRASE', text: '  Buenos días.  ', translation: 'Good morning.', sourceUrl: 'https://untrusted.invalid' });
  assert.equal(result.ok, true);
  assert.equal(bg.phrases[0].text, 'Buenos días.');
  assert.equal(bg.phrases[0].sourceUrl, 'https://example.com/article');
  assert.equal(bg.phrases[0].source, 'web');
});
test('captured original audio attaches to saved phrase', async () => {
  const bg = background();
  const result = await bg.send({ type: 'SAVE_STUDIO_PHRASE', text: 'Hola.', audioUrl: 'data:audio/webm;codecs=opus;base64,AAAA' });
  assert.equal(result.ok, true);
  assert.equal(bg.phrases[0].source, 'video');
  assert.equal(bg.references[0].id, result.id);
  assert.equal(bg.references[0].kind, 'original');
});
test('rejects missing text, oversized input, and non-audio capture without writes', async () => {
  const bg = background();
  for (const value of [{ text: ' ' }, { text: 'x'.repeat(2001) }, { text: 'Hola', audioUrl: 'data:text/html;base64,AAAA' }]) {
    assert.equal((await bg.send({ type: 'SAVE_STUDIO_PHRASE', ...value })).ok, false);
  }
  assert.equal(bg.phrases.length, 0);
});
test('storage failure returns actionable error rather than success', async () => {
  const bg = background({ savePhrase: async () => { throw new Error('Private failure detail'); } });
  const result = await bg.send({ type: 'SAVE_STUDIO_PHRASE', text: 'Hola' });
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.error, /Private/);
});
test('a reference failure returns the saved phrase ID and a warning without suggesting a duplicate retry', async () => {
  const bg = background({ addReference: async () => { throw new Error('Private quota detail'); } });
  const result = await bg.send({ type: 'SAVE_STUDIO_PHRASE', text: 'Hola', audioUrl: 'data:audio/webm;base64,AAAA' });
  assert.equal(result.ok, true);
  assert.equal(result.id, 'phrase-1');
  assert.equal(bg.phrases.length, 1);
  assert.match(result.warning, /phrase was saved/);
  assert.doesNotMatch(result.warning, /Private/);
});
test('learning app opens encoded pronunciation and all-language vocabulary routes', async () => {
  const bg = background();
  await bg.send({ type: 'OPEN_STUDIO', phraseId: 'id?&evil=1' });
  assert.equal(bg.tabs[0].url, 'chrome-extension://test/studio.html?phrase=id%3F%26evil%3D1#pronunciation');
  await bg.send({ type: 'OPEN_STUDIO', lang: 'fr' });
  assert.equal(bg.tabs[1].url, 'chrome-extension://test/studio.html#vocabulary');
});

test('automatic dictionary lookup translates English to Spanish and Spanish to English', async () => {
  const setup = translationEnvironment((text, callback) => callback({
    isReliable: true,
    languages: [{ language: text === 'Good morning' ? 'en' : 'es', percentage: 100 }]
  }));
  const bg = background({}, setup.environment);
  const english = await bg.send({ type: 'TRANSLATE_DICTIONARY_AUTO', text: 'Good morning', targetLang: 'es', nativeLang: 'en' });
  const spanish = await bg.send({ type: 'TRANSLATE_DICTIONARY_AUTO', text: 'Buenos días', targetLang: 'es', nativeLang: 'en' });
  assert.deepEqual({ ...english }, { translation: 'Buenos días', sourceLang: 'en', targetLang: 'es', detection: 'chrome' });
  assert.deepEqual({ ...spanish }, { translation: 'Good morning', sourceLang: 'es', targetLang: 'en', detection: 'chrome' });
  assert.deepEqual(setup.requests.map(url => [url.searchParams.get('sl'), url.searchParams.get('tl')]), [['en', 'es'], ['es', 'en']]);
});

test('automatic dictionary lookup safely falls back when detection is invalid or unavailable', async () => {
  const invalid = translationEnvironment((_text, callback) => callback({ languages: [
    { language: '../invalid', percentage: 100 }, { language: 'de', percentage: 80 }
  ] }));
  const invalidBg = background({}, invalid.environment);
  const invalidResult = await invalidBg.send({ type: 'TRANSLATE_DICTIONARY_AUTO', text: 'hola', targetLang: 'es', nativeLang: 'en' });
  assert.deepEqual({ ...invalidResult }, { translation: 'Good morning', sourceLang: 'es', targetLang: 'en', detection: 'fallback' });
  assert.deepEqual(invalid.requests.map(url => [url.searchParams.get('sl'), url.searchParams.get('tl')]), [['es', 'en']]);

  const missing = translationEnvironment(undefined);
  const missingBg = background({}, missing.environment);
  const missingResult = await missingBg.send({ type: 'TRANSLATE_DICTIONARY_AUTO', text: '¿Cómo estás?', targetLang: 'es', nativeLang: 'en' });
  assert.equal(missingResult.detection, 'fallback');
  assert.equal(missingResult.sourceLang, 'es');
  assert.equal(missingResult.targetLang, 'en');
});

test('Insights settings messages are refused from web pages; events flow once enabled from the studio', async () => {
  const bg = background();
  const plain = value => JSON.parse(JSON.stringify(value));
  const studio = { id: 'test', url: 'chrome-extension://test/studio.html' };
  const page = { id: 'test', url: 'https://example.com/article' };
  assert.deepEqual(plain(await bg.send({ type: 'INSIGHTS_ENABLE', nativeLanguage: 'en' }, page)), { ok: false });
  const event = bg.context.PolybotEvents.stamp('definition_saved', { surface: 'page', language: 'es', context: { vocab_item_id: 'es:casa' }, payload: { has_context: true, is_custom: false } });
  assert.deepEqual(plain(await bg.send({ type: 'RECORD_EVENT', event }, page)), { ok: false, reason: 'disabled' });
  const enabled = await bg.send({ type: 'INSIGHTS_ENABLE', nativeLanguage: 'en' }, studio);
  assert.equal(enabled.ok, true);
  assert.deepEqual(plain(await bg.send({ type: 'RECORD_EVENT', event }, page)), { ok: true });
  const buffer = bg.stored[bg.context.PolybotEvents.BUFFER_KEY];
  assert.deepEqual(plain(buffer.map(e => e.event_type)), ['learner_registered', 'session_started', 'definition_saved']);
  assert.equal(buffer[2].learner_id, enabled.result.learnerId);
  const bad = { ...event, event_id: 'x', payload: { text: 'hola' } };
  assert.equal((await bg.send({ type: 'RECORD_EVENT', event: bad }, page)).reason, 'invalid');
  assert.equal(bg.stored[bg.context.PolybotEvents.BUFFER_KEY].length, 3);
});

test('the dashboard message reports "off" until Insights is enabled and is refused from web pages', async () => {
  const bg = background();
  const plain = value => JSON.parse(JSON.stringify(value));
  const studio = { id: 'test', url: 'chrome-extension://test/studio.html' };
  assert.deepEqual(plain(await bg.send({ type: 'INSIGHTS_LEARNER', language: 'es' }, { id: 'test', url: 'https://example.com/' })), { ok: false });
  assert.deepEqual(plain(await bg.send({ type: 'INSIGHTS_LEARNER', language: 'es' }, studio)), { ok: true, result: { state: 'off' } });
});
