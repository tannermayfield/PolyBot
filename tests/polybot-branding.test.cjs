'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Studio = require('../study-data.js');
const Learning = require('../learning-data.js');
function memory(values = {}) {
  return { values, async get(keys) { return Object.fromEntries(keys.filter(key => Object.hasOwn(values, key)).map(key => [key, structuredClone(values[key])])); }, async set(items) { Object.assign(values, structuredClone(items)); } };
}
test('Polybot reads existing studio data and accepts old backups', async () => {
  const original = await Studio.createStore({ storage: memory() }).exportBackup();
  const legacy = memory({ giftOfTonguesStudio: original.state });
  const store = Studio.createStore({ storage: legacy });
  const exported = await store.exportBackup();
  assert.equal(exported.format, 'polybot-studio');
  assert.deepEqual(exported.state, original.state);
  await store.importBackup({ ...original, format: 'gift-of-tongues-studio' });
  assert.ok(legacy.values.polybotStudio);
});
test('Polybot preserves existing learning progress and prefers current storage', async () => {
  const legacyState = { version: 1, mediaResponses: [], targetLanguages: ['fr'], completedActivities: {} };
  const storage = memory({ giftOfTonguesLearning: legacyState });
  const store = Learning.createStore({ storage, langApi: { DEFAULT_LANG: 'es', DEFAULT_NATIVE_LANG: 'en', LANGUAGES: ['es', 'en', 'fr', 'ja'].map(code => ({ code, name: code })) } });
  assert.ok((await store.load()).targetLanguages.some(language => language.code === 'fr'));
  storage.values.polybotLearning = { ...legacyState, targetLanguages: ['ja'] };
  assert.ok((await store.load()).targetLanguages.some(language => language.code === 'ja'));
  assert.ok(!(await store.load()).targetLanguages.some(language => language.code === 'fr'));
});
