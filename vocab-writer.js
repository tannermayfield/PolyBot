// Single writer for per-language vocabulary status maps (ADR-019, audit T3).
// Pages used to write their whole cached map back to storage, so two pages could
// silently erase each other's changes. They now send only the words they changed;
// the service worker applies those changes to the freshest stored map, one update
// at a time, and records the matching learner events.
(function (root, factory) {
  const api = factory();
  root.PolybotVocabWriter = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STATUSES = new Set(['known', 'learning']);
  const METHODS = new Set(['page_click', 'quick_mark', 'popup', 'studio']);
  const MAX_CHANGES = 20000;
  const BAD_TERMS = new Set(['__proto__', 'prototype', 'constructor']);

  function cleanChanges(changes) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('Invalid vocabulary changes');
    const entries = Object.entries(changes);
    if (entries.length > MAX_CHANGES) throw new Error('Too many vocabulary changes');
    return entries.map(([term, status]) => {
      const key = String(term).trim().toLowerCase();
      if (!key || key.length > 300 || BAD_TERMS.has(key)) throw new Error('Invalid vocabulary term');
      if (status !== null && !STATUSES.has(status)) throw new Error('Invalid vocabulary status');
      return [key, status];
    });
  }

  function createVocabWriter({ storage, keyFor, record = () => {} }) {
    let queue = Promise.resolve();
    const serial = fn => (queue = queue.then(fn, fn));

    // request: { lang, changes: {term: 'known'|'learning'|null}, method,
    //            keepLearning?: bool, bulk?: { frequency_level } }
    function update(request) {
      return serial(async () => {
        const lang = String(request.lang || '');
        if (!/^[a-z]{2,3}(-[A-Z]{2})?$/.test(lang)) throw new Error('Invalid language');
        const changes = cleanChanges(request.changes);
        const key = keyFor(lang);
        const stored = await storage.get([key]);
        const vocabulary = stored[key] && typeof stored[key] === 'object' ? { ...stored[key] } : {};
        const changed = [];
        let skippedLearning = 0, alreadyKnown = 0;
        for (const [term, status] of changes) {
          const before = Object.prototype.hasOwnProperty.call(vocabulary, term) ? vocabulary[term] : null;
          // Bulk marking respects an explicit "learning" choice made anywhere, even after the page loaded.
          if (request.keepLearning && before === 'learning' && status !== 'learning') { skippedLearning++; continue; }
          if (before === status) { if (status === 'known') alreadyKnown++; continue; }
          if (status === null) delete vocabulary[term]; else vocabulary[term] = status;
          changed.push({ term, from: before || 'unmarked', to: status || 'unmarked' });
        }
        if (changed.length) await storage.set({ [key]: vocabulary });

        const surface = ['page', 'popup', 'catchup', 'studio'].includes(request.surface) ? request.surface : 'page';
        if (request.bulk) {
          record('vocab_bulk_marked', { surface, language: lang, payload: {
            frequency_level: request.bulk.frequency_level, words_marked: changed.length, words_already_known: alreadyKnown } });
        } else if (METHODS.has(request.method)) {
          for (const c of changed) {
            record('vocab_status_changed', { surface, language: lang, context: { vocab_item_id: `${lang}:${c.term}` },
              payload: { from: c.from, to: c.to, method: request.method } });
          }
        }
        return { changed: changed.length, skippedLearning, alreadyKnown };
      });
    }

    return { update };
  }

  return { createVocabWriter, _test: { cleanChanges } };
});
