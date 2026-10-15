'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Prefs = require('../prefs-store.js');

function local(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: key => { values.delete(key); }
  };
}
function area(initial = {}) {
  const values = { ...initial };
  return {
    values, failNext: false,
    async get(keys) { return Object.fromEntries(keys.filter(k => k in values).map(k => [k, structuredClone(values[k])])); },
    async set(items) {
      if (this.failNext) { this.failNext = false; throw new Error('quota'); }
      Object.assign(values, structuredClone(items));
    }
  };
}

const METHOD = { version: 1, output: 70, grammar: 30, modalities: ['audio', 'speaking'] };
const INTERESTS = { version: 1, selected: ['cooking', 'hiking'] };

test('hydrate moves localStorage preferences, including legacy keys, without loss', async () => {
  const ls = local({ polybotMethod: JSON.stringify(METHOD), giftOfTonguesInterests: JSON.stringify(INTERESTS) });
  const chromeArea = area();
  const prefs = Prefs.create({ area: chromeArea, local: ls });
  await prefs.hydrate();
  assert.deepEqual(chromeArea.values.polybotMethod, METHOD);
  assert.deepEqual(chromeArea.values.polybotInterests, INTERESTS);
  assert.equal(chromeArea.values.polybotRegion, undefined);
  assert.deepEqual(JSON.parse(prefs.getItem('polybotMethod')), METHOD);
  assert.deepEqual(JSON.parse(prefs.getItem('polybotInterests')), INTERESTS);
  assert.equal(prefs.getItem('polybotRegion'), null);
  assert.equal(ls.values.size, 0, 'old copies are removed after the move');
});

test('chrome.storage wins over a stale localStorage copy', async () => {
  const ls = local({ polybotMethod: JSON.stringify({ ...METHOD, output: 5 }) });
  const prefs = Prefs.create({ area: area({ polybotMethod: METHOD }), local: ls });
  await prefs.hydrate();
  assert.equal(JSON.parse(prefs.getItem('polybotMethod')).output, 70);
  assert.equal(ls.values.size, 1, 'not moved, so not removed');
});

test('a failed move keeps the localStorage copy', async () => {
  const ls = local({ polybotRegion: JSON.stringify({ version: 1, countryCode: 'MX' }) });
  const chromeArea = area();
  chromeArea.failNext = true;
  const prefs = Prefs.create({ area: chromeArea, local: ls });
  await assert.rejects(prefs.hydrate(), /quota/);
  assert.equal(ls.values.size, 1);
  assert.equal(prefs.isHydrated(), false);
  assert.equal(prefs.getItem('polybotRegion'), ls.getItem('polybotRegion'), 'falls back to localStorage');
});

test('setItem is visible immediately and written durably', async () => {
  const chromeArea = area();
  const prefs = Prefs.create({ area: chromeArea, local: local() });
  await prefs.hydrate();
  const write = prefs.setItem('polybotInterests', JSON.stringify(INTERESTS));
  assert.deepEqual(JSON.parse(prefs.getItem('polybotInterests')), INTERESTS);
  await write;
  assert.deepEqual(chromeArea.values.polybotInterests, INTERESTS);
});

test('a failed write restores the previous value and reports the error', async () => {
  const chromeArea = area({ polybotMethod: METHOD });
  const prefs = Prefs.create({ area: chromeArea, local: local() });
  await prefs.hydrate();
  chromeArea.failNext = true;
  let reported = null;
  await prefs.setItem('polybotMethod', JSON.stringify({ ...METHOD, output: 0 }), error => { reported = error; });
  assert.match(reported.message, /quota/);
  assert.equal(JSON.parse(prefs.getItem('polybotMethod')).output, 70);
});

test('without chrome storage (preview) it is plain localStorage', async () => {
  const ls = local();
  const prefs = Prefs.create({ area: null, local: ls });
  assert.equal(await prefs.hydrate(), false);
  await prefs.setItem('polybotRegion', '{"version":1}');
  assert.equal(ls.getItem('polybotRegion'), '{"version":1}');
});
