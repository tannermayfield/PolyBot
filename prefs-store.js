// Personalization preferences in chrome.storage.local (ADR-006 item 2).
// The personalization pages read preferences synchronously while rendering, so this
// keeps a localStorage-shaped API (getItem/setItem with JSON strings) over an
// in-memory copy that hydrate() fills once at startup. Values saved by older
// versions in localStorage are moved over on first hydrate. Outside the extension
// (localhost preview) it simply uses localStorage.
(function (root, factory) {
  const api = factory(root);
  root.PolybotPrefs = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const KEYS = ['polybotMethod', 'polybotInterests', 'polybotRegion'];
  const legacyKey = key => key.replace('polybot', 'giftOfTongues');

  function create({ area, local } = {}) {
    const cache = new Map();
    let hydrated = false;
    const fallback = () => local || root.localStorage;
    const parse = raw => { try { return JSON.parse(raw); } catch (_) { return raw; } };

    async function hydrate() {
      if (!area) return false;
      const stored = await area.get(KEYS);
      const moved = {};
      const ls = fallback();
      for (const key of KEYS) {
        if (stored[key] !== undefined) { cache.set(key, stored[key]); continue; }
        let raw = null;
        try { raw = ls ? (ls.getItem(key) ?? ls.getItem(legacyKey(key))) : null; } catch (_) { raw = null; }
        if (raw !== null) { moved[key] = parse(raw); cache.set(key, moved[key]); }
      }
      if (Object.keys(moved).length) {
        await area.set(moved);
        // Remove the old copies only after the new ones are safely written.
        for (const key of Object.keys(moved)) {
          try { ls.removeItem(key); ls.removeItem(legacyKey(key)); } catch (_) { /* Nothing left to clean. */ }
        }
      }
      hydrated = true;
      return true;
    }

    function getItem(key) {
      if (!hydrated) return fallback().getItem(key);
      if (!cache.has(key)) return null;
      const value = cache.get(key);
      return typeof value === 'string' ? value : JSON.stringify(value);
    }

    // Synchronous like localStorage. The durable write is asynchronous; a failure is
    // reported through onError and the previous value is restored in memory.
    function setItem(key, raw, onError) {
      if (!hydrated) { fallback().setItem(key, raw); return Promise.resolve(); }
      const value = parse(raw);
      const had = cache.has(key), previous = cache.get(key);
      cache.set(key, value);
      return area.set({ [key]: value }).catch(error => {
        if (had) cache.set(key, previous); else cache.delete(key);
        if (typeof onError === 'function') onError(error);
        else console.warn('[Polybot] Preference could not be saved:', error && error.message);
      });
    }

    return { KEYS, hydrate, getItem, setItem, isHydrated: () => hydrated };
  }

  const chromeArea = root.chrome && root.chrome.runtime && root.chrome.runtime.id && root.chrome.storage && root.chrome.storage.local;
  const area = chromeArea ? { get: keys => chromeArea.get(keys), set: items => chromeArea.set(items) } : null;
  return Object.assign(create({ area }), { create });
});
