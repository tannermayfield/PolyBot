// Polybot Insights — learner event emitter (Phase 3, docs/EVENT_TAXONOMY.md).
// Two halves share this file:
//   * record(): used by every surface (studio, popup, page scripts, catch-up).
//     It stamps an event and hands it to the service worker. No-op outside
//     the extension (localhost preview) and harmless when Insights is off.
//   * createHub(): used only by the service worker (ADR-011). It is the single
//     writer of the event buffer, owns learner/session IDs, and syncs batches
//     to the local Insights service with at-least-once delivery.
// Storage, fetch, alarms and the clock are injected so tests run in Node.
(function (root, factory) {
  const api = factory(root);
  root.PolybotEvents = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const CONSENT_VERSION = 1; // ADR-016: bump whenever the consent notice wording changes.
  const CONFIG_KEY = 'polybotInsights';
  const STATE_KEY = 'polybotInsightsState';
  const BUFFER_KEY = 'polybotEventBuffer';
  const SYNC_ALARM = 'polybot-insights-sync';
  const DEFAULT_URL = 'http://127.0.0.1:17495';
  const LIMITS = {
    buffer: 5000, batchEvents: 500, batchBytes: 900 * 1024, syncAt: 50,
    debounceMs: 30 * 1000, maxBackoffMs: 10 * 60 * 1000, sessionIdleMs: 30 * 60 * 1000
  };

  const EVENT_TYPES = new Set([
    'learner_registered', 'session_started', 'session_ended',
    'lesson_started', 'lesson_completed', 'content_skipped', 'answer_submitted', 'hint_requested', 'feedback_viewed',
    'vocab_status_changed', 'vocab_bulk_marked', 'word_looked_up', 'definition_saved', 'phrase_captured', 'review_rated',
    'pronunciation_attempted', 'pronunciation_scored', 'media_response_saved',
    'preference_set', 'difficulty_changed',
    'recommendation_shown', 'recommendation_accepted', 'recommendation_skipped'
  ]);
  const NO_LANGUAGE = new Set(['learner_registered', 'session_started', 'session_ended',
    'recommendation_shown', 'recommendation_accepted', 'recommendation_skipped']);
  const SURFACES = new Set(['studio', 'popup', 'page', 'catchup', 'service', 'simulator']);
  const CONTEXT_KEYS = new Set(['lesson_id', 'exercise_id', 'vocab_item_id', 'recommendation_id', 'decision_id', 'generated_content_id']);
  // EVENT_TAXONOMY §6: privacy exclusions, checked at any depth.
  const FORBIDDEN_KEYS = new Set(['text', 'sentence', 'translation', 'transcript', 'url', 'source_url', 'hostname', 'title', 'audio', 'audio_url']);

  function uuid() {
    const c = root.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    // crypto.randomUUID needs a secure context; reader.js may run on http pages.
    const b = new Uint8Array(16);
    if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function forbiddenKey(value) {
    if (!value || typeof value !== 'object') return null;
    for (const [key, inner] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) return key;
      const nested = forbiddenKey(inner);
      if (nested) return nested;
    }
    return null;
  }

  // Throws on anything the taxonomy forbids, so mistakes surface in tests
  // instead of reaching the database.
  function checkEvent(event) {
    if (!EVENT_TYPES.has(event.event_type)) throw new Error(`Unknown event type: ${event.event_type}`);
    if (!SURFACES.has(event.surface)) throw new Error(`Unknown surface: ${event.surface}`);
    if (!NO_LANGUAGE.has(event.event_type) && !(typeof event.language === 'string' && event.language)) {
      throw new Error(`${event.event_type} requires a language`);
    }
    for (const key of Object.keys(event.context || {})) if (!CONTEXT_KEYS.has(key)) throw new Error(`Unknown context key: ${key}`);
    const bad = forbiddenKey(event.payload) || forbiddenKey(event.context);
    if (bad) throw new Error(`Forbidden field in event: ${bad}`);
    return event;
  }

  function detectSurface() {
    const loc = root.location;
    if (!loc) return 'service';
    if (loc.protocol === 'chrome-extension:') {
      if (/popup\.html$/.test(loc.pathname)) return 'popup';
      if (/catchup\.html$/.test(loc.pathname)) return 'catchup';
      return 'studio';
    }
    return typeof root.document === 'undefined' ? 'service' : 'page';
  }

  // Stamps the facts only the caller knows (what, when, where). The worker
  // adds identity, session, and version.
  function stamp(eventType, fields = {}, at = new Date()) {
    const event = {
      event_id: uuid(), event_type: eventType,
      occurred_at: at.toISOString(), tz_offset_minutes: -at.getTimezoneOffset(),
      surface: fields.surface || detectSurface(),
      context: { ...(fields.context || {}) }, payload: { ...(fields.payload || {}) }
    };
    if (fields.language) event.language = fields.language;
    return checkEvent(event);
  }

  // Surface API. Fire-and-forget: tracking must never break learning.
  function record(eventType, fields) {
    let event;
    try { event = stamp(eventType, fields); } catch (error) { console.warn('[Polybot Insights]', error.message); return false; }
    const runtime = root.chrome && root.chrome.runtime;
    if (!runtime || !runtime.id || typeof runtime.sendMessage !== 'function') return false;
    if (root.PolybotEventHub) { root.PolybotEventHub.record(event).catch(() => {}); return true; }
    try { runtime.sendMessage({ type: 'RECORD_EVENT', event }, () => void runtime.lastError); } catch (_) { return false; }
    return true;
  }

  function backoffMs(failures) {
    return Math.min(LIMITS.maxBackoffMs, LIMITS.debounceMs * 2 ** Math.max(0, failures - 1));
  }

  function createHub(deps) {
    const { storage, fetch: doFetch, alarms, appVersion } = deps;
    const now = deps.now || (() => Date.now());
    let queue = Promise.resolve();
    let syncing = false;
    // Every read-modify-write of the buffer goes through this queue, so
    // overlapping messages cannot lose each other's events.
    const serial = fn => (queue = queue.then(fn, fn));

    async function read() {
      const got = await storage.get([CONFIG_KEY, STATE_KEY, BUFFER_KEY]);
      return {
        config: { enabled: false, url: DEFAULT_URL, ...(got[CONFIG_KEY] || {}) },
        state: { dropped: 0, failures: 0, ...(got[STATE_KEY] || {}) },
        buffer: Array.isArray(got[BUFFER_KEY]) ? got[BUFFER_KEY] : []
      };
    }

    function envelope(event, state) {
      return {
        event_id: event.event_id, schema_version: SCHEMA_VERSION, event_type: event.event_type,
        learner_id: state.learnerId, session_id: state.sessionId,
        occurred_at: event.occurred_at, tz_offset_minutes: event.tz_offset_minutes,
        surface: event.surface, app_version: appVersion,
        ...(event.language ? { language: event.language } : {}),
        context: event.context || {}, payload: event.payload || {}
      };
    }

    function push(buffer, state, items) {
      buffer.push(...items);
      const overflow = buffer.length - LIMITS.buffer;
      if (overflow > 0) { buffer.splice(0, overflow); state.dropped += overflow; }
    }

    // EVENT_TAXONOMY §5.2: a gap of more than 30 minutes starts a new session.
    function sessionEvents(state, at, entrySurface) {
      const out = [];
      if (state.sessionId && state.lastEventAt && at - state.lastEventAt <= LIMITS.sessionIdleMs) return out;
      if (state.sessionId && state.lastEventAt) {
        out.push(envelope(stamp('session_ended', { surface: 'service', payload: { reason: 'idle', last_activity_at: new Date(state.lastEventAt).toISOString() } }, new Date(at)), state));
      }
      state.sessionId = uuid();
      out.push(envelope(stamp('session_started', { surface: 'service', payload: { entry_surface: entrySurface } }, new Date(at)), state));
      return out;
    }

    function scheduleSync(state, buffer, urgent) {
      if (state.failures > 0) return; // A backoff alarm is already pending; don't retry sooner.
      if (urgent || buffer.length >= LIMITS.syncAt) { Promise.resolve().then(sync); return; }
      alarms.create(SYNC_ALARM, { when: now() + LIMITS.debounceMs });
    }

    function enable({ nativeLanguage, url } = {}) {
      return serial(async () => {
        const { config, state, buffer } = await read();
        const at = now();
        config.enabled = true;
        config.url = url || config.url || DEFAULT_URL;
        config.consentVersion = CONSENT_VERSION;
        config.enabledAt = new Date(at).toISOString();
        state.learnerId = state.learnerId || uuid();
        // learner_registered must precede everything else from this learner;
        // re-enabling records the (possibly newer) consent again.
        state.sessionId = uuid();
        const registered = envelope(stamp('learner_registered', { surface: 'service', payload: { native_language: nativeLanguage || 'en', consent_version: CONSENT_VERSION } }, new Date(at)), state);
        const started = envelope(stamp('session_started', { surface: 'service', payload: { entry_surface: 'studio' } }, new Date(at)), state);
        push(buffer, state, [registered, started]);
        state.lastEventAt = at;
        await storage.set({ [CONFIG_KEY]: config, [STATE_KEY]: state, [BUFFER_KEY]: buffer });
        scheduleSync(state, buffer, true);
        return { learnerId: state.learnerId };
      });
    }

    // Withdrawing consent discards anything not yet delivered.
    function disable() {
      return serial(async () => {
        const { config, state } = await read();
        config.enabled = false;
        Object.assign(state, { pending: null, failures: 0, dropped: 0, sessionId: null, lastEventAt: null });
        await storage.set({ [CONFIG_KEY]: config, [STATE_KEY]: state, [BUFFER_KEY]: [] });
        alarms.clear(SYNC_ALARM);
      });
    }

    function record(event) {
      return serial(async () => {
        const { config, state, buffer } = await read();
        if (!config.enabled || !state.learnerId) return { ok: false, reason: 'disabled' };
        checkEvent(event);
        const at = Date.parse(event.occurred_at) || now();
        const items = sessionEvents(state, at, event.surface);
        items.push(envelope(event, state));
        push(buffer, state, items);
        state.lastEventAt = Math.max(state.lastEventAt || 0, at);
        await storage.set({ [STATE_KEY]: state, [BUFFER_KEY]: buffer });
        scheduleSync(state, buffer, event.event_type === 'preference_set');
        return { ok: true };
      });
    }

    // Reuse the pending batch only if every one of its events is still
    // buffered; otherwise a retry would send different events under an ID the
    // server already accepted, and they would be discarded as a duplicate.
    function nextBatch(state, buffer) {
      const ids = new Set(buffer.map(e => e.event_id));
      if (state.pending && state.pending.eventIds.every(id => ids.has(id))) {
        const wanted = new Set(state.pending.eventIds);
        return { ...state.pending, events: buffer.filter(e => wanted.has(e.event_id)) };
      }
      const events = [];
      let bytes = 0;
      for (const event of buffer) {
        const size = JSON.stringify(event).length + 1;
        if (events.length >= LIMITS.batchEvents || (events.length && bytes + size > LIMITS.batchBytes)) break;
        events.push(event); bytes += size;
      }
      return { batchId: uuid(), eventIds: events.map(e => e.event_id), dropped: state.dropped, events };
    }

    async function sync() {
      if (syncing) return { ok: false, reason: 'in_progress' };
      syncing = true;
      try {
        const batch = await serial(async () => {
          const { config, state, buffer } = await read();
          if (!config.enabled || !state.learnerId || !buffer.length) return null;
          const next = nextBatch(state, buffer);
          state.pending = { batchId: next.batchId, eventIds: next.eventIds, dropped: next.dropped };
          await storage.set({ [STATE_KEY]: state });
          return { url: config.url, learnerId: state.learnerId, ...next };
        });
        if (!batch) return { ok: true, sent: 0 };

        let status = 0;
        try {
          const response = await doFetch(`${batch.url.replace(/\/+$/, '')}/v1/event-batches`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              batch_id: batch.batchId, learner_id: batch.learnerId, source: 'extension',
              sent_at: new Date(now()).toISOString(), dropped_since_last_sync: batch.dropped, events: batch.events
            })
          });
          status = response.status;
        } catch (_) { status = 0; }

        // 2xx: delivered. A 4xx other than 408/429 means the batch itself is
        // unacceptable, so retrying forever would block every later event:
        // drop it and report the loss in the next batch's counter.
        const delivered = status >= 200 && status < 300;
        const rejected = status >= 400 && status < 500 && status !== 408 && status !== 429;
        return await serial(async () => {
          const { state, buffer } = await read();
          if (delivered || rejected) {
            const sent = new Set(batch.eventIds);
            const rest = buffer.filter(e => !sent.has(e.event_id));
            state.dropped = Math.max(0, state.dropped - batch.dropped) + (rejected ? buffer.length - rest.length : 0);
            Object.assign(state, { pending: null, failures: 0, lastSyncAt: new Date(now()).toISOString(), lastError: rejected ? `Rejected (HTTP ${status})` : null });
            await storage.set({ [STATE_KEY]: state, [BUFFER_KEY]: rest });
            if (rest.length) scheduleSync(state, rest, rest.length >= LIMITS.syncAt);
            return { ok: delivered, status, sent: batch.events.length };
          }
          state.failures += 1;
          state.lastError = status ? `HTTP ${status}` : 'Insights service unreachable';
          await storage.set({ [STATE_KEY]: state });
          alarms.create(SYNC_ALARM, { when: now() + backoffMs(state.failures) });
          return { ok: false, status, retryInMs: backoffMs(state.failures) };
        });
      } finally { syncing = false; }
    }

    async function status() {
      const { config, state, buffer } = await read();
      return { enabled: Boolean(config.enabled), url: config.url, consentVersion: config.consentVersion || null,
        learnerId: state.learnerId || null, buffered: buffer.length, dropped: state.dropped,
        lastSyncAt: state.lastSyncAt || null, lastError: state.lastError || null };
    }

    return { enable, disable, record, sync, status, idle: () => queue };
  }

  return {
    SCHEMA_VERSION, CONSENT_VERSION, CONFIG_KEY, STATE_KEY, BUFFER_KEY, SYNC_ALARM, DEFAULT_URL, LIMITS,
    EVENT_TYPES, FORBIDDEN_KEYS, record, stamp, checkEvent, createHub, uuid,
    _test: { backoffMs, detectSurface, forbiddenKey }
  };
});
