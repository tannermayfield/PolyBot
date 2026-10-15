'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createVocabWriter, _test } = require('../vocab-writer.js');

// Storage whose reads and writes yield, so unserialized updates would interleave.
function slowStorage(initial = {}) {
  const values = structuredClone(initial);
  const tick = () => new Promise(resolve => setImmediate(resolve));
  return {
    values,
    async get(keys) { await tick(); return structuredClone(Object.fromEntries(keys.filter(k => k in values).map(k => [k, values[k]]))); },
    async set(items) { await tick(); Object.assign(values, structuredClone(items)); }
  };
}
function setup(initial) {
  const storage = slowStorage(initial);
  const events = [];
  const writer = createVocabWriter({ storage, keyFor: lang => `vocab_${lang}`, record: (type, fields) => events.push({ type, ...fields }) });
  return { storage, events, writer };
}

test('overlapping updates from different pages both survive (audit T3)', async () => {
  const { storage, writer } = setup({ vocab_es: { casa: 'known' } });
  await Promise.all([
    writer.update({ lang: 'es', changes: { perro: 'learning' }, method: 'page_click', surface: 'page' }),
    writer.update({ lang: 'es', changes: { gato: 'known' }, method: 'quick_mark', surface: 'page' }),
    writer.update({ lang: 'es', changes: { casa: null }, method: 'page_click', surface: 'page' })
  ]);
  assert.deepEqual(storage.values.vocab_es, { perro: 'learning', gato: 'known' });
});

test('status changes record one event per changed word with from/to', async () => {
  const { events, writer } = setup({ vocab_fr: { maison: 'learning' } });
  const result = await writer.update({ lang: 'fr', changes: { maison: 'known', chat: 'known', chien: null }, method: 'quick_mark', surface: 'page' });
  assert.equal(result.changed, 2, 'removing an unmarked word is not a change');
  assert.deepEqual(events, [
    { type: 'vocab_status_changed', surface: 'page', language: 'fr', context: { vocab_item_id: 'fr:maison' }, payload: { from: 'learning', to: 'known', method: 'quick_mark' } },
    { type: 'vocab_status_changed', surface: 'page', language: 'fr', context: { vocab_item_id: 'fr:chat' }, payload: { from: 'unmarked', to: 'known', method: 'quick_mark' } }
  ]);
});

test('bulk marking keeps "learning" words, counts from fresh data, and records one event', async () => {
  const { storage, events, writer } = setup({ vocab_es: { el: 'known', que: 'learning' } });
  const result = await writer.update({ lang: 'es', changes: { el: 'known', que: 'known', de: 'known' }, keepLearning: true,
    bulk: { frequency_level: 1 }, surface: 'catchup' });
  assert.deepEqual(result, { changed: 1, skippedLearning: 1, alreadyKnown: 1 });
  assert.deepEqual(storage.values.vocab_es, { el: 'known', que: 'learning', de: 'known' });
  assert.deepEqual(events, [{ type: 'vocab_bulk_marked', surface: 'catchup', language: 'es',
    payload: { frequency_level: 1, words_marked: 1, words_already_known: 1 } }]);
});

test('terms are normalized to lower case and dangerous keys are refused', async () => {
  const { storage, writer } = setup();
  await writer.update({ lang: 'de', changes: { Haus: 'known' }, method: 'page_click' });
  assert.deepEqual(storage.values.vocab_de, { haus: 'known' });
  assert.throws(() => _test.cleanChanges({ __proto__: 'known', constructor: 'known' }), /Invalid vocabulary term/);
  await assert.rejects(writer.update({ lang: 'de', changes: { haus: 'mastered' } }), /Invalid vocabulary status/);
  await assert.rejects(writer.update({ lang: '../x', changes: {} }), /Invalid language/);
});

test('a failed update does not block later ones', async () => {
  const { storage, writer } = setup();
  await assert.rejects(writer.update({ lang: 'es', changes: [] }));
  await writer.update({ lang: 'es', changes: { sol: 'known' }, method: 'page_click' });
  assert.deepEqual(storage.values.vocab_es, { sol: 'known' });
});
