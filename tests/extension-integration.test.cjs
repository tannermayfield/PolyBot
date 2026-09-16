'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function background(overrides = {}) {
  const listeners = [];
  const phrases = [];
  const references = [];
  const tabs = [];
  const context = {
    URL, console, setTimeout, clearTimeout,
    importScripts: name => assert.equal(name, 'study-data.js'),
    chrome: {
      runtime: { onMessage: { addListener: fn => listeners.push(fn) }, getURL: file => 'chrome-extension://test/' + file },
      tabs: { create: async tab => { tabs.push(tab); } },
      scripting: {}, storage: {}
    },
    StudioData: {
      savePhrase: async phrase => { const result = { ...phrase, id: 'phrase-1' }; phrases.push(result); return result; },
      addReference: async (id, ref) => { references.push({ id, ...ref }); }, ...overrides
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'), context);
  return { phrases, references, tabs, send: (msg, sender = { url: 'https://example.com/article#selection' }) => new Promise(resolve => listeners[0](msg, sender, resolve)) };
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
test('studio opens an encoded internal deep link and retains other-language manager', async () => {
  const bg = background();
  await bg.send({ type: 'OPEN_STUDIO', phraseId: 'id?&evil=1' });
  assert.equal(bg.tabs[0].url, 'chrome-extension://test/studio.html?phrase=id%3F%26evil%3D1#practice');
  await bg.send({ type: 'OPEN_STUDIO', lang: 'fr' });
  assert.equal(bg.tabs[1].url, 'chrome-extension://test/manager.html');
});
