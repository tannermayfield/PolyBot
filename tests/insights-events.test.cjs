'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Events = require('../insights-events.js');

const T0 = Date.UTC(2026, 9, 15, 14);
const MIN = 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function memory(initial = {}) {
  const values = structuredClone(initial);
  return {
    values,
    async get(keys) { return structuredClone(Object.fromEntries(keys.filter(k => k in values).map(k => [k, values[k]]))); },
    async set(items) { await new Promise(resolve => setImmediate(resolve)); Object.assign(values, structuredClone(items)); }
  };
}

function harness({ statuses = [] } = {}) {
  const clock = { t: T0 };
  const storage = memory();
  const alarms = { created: [], cleared: [], create(name, info) { this.created.push({ name, ...info }); }, clear(name) { this.cleared.push(name); } };
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    const status = statuses.length ? statuses.shift() : 200;
    if (status === 'network') throw new TypeError('Failed to fetch');
    return { status };
  };
  const hub = Events.createHub({ storage, fetch, alarms, appVersion: '3.1.0', now: () => clock.t });
  return { clock, storage, alarms, requests, hub };
}

const at = t => new Date(t);
const answer = (t, extra = {}) => Events.stamp('answer_submitted', {
  surface: 'studio', language: 'fr',
  context: { exercise_id: 'vocab_recall_choice:fr:maison', vocab_item_id: 'fr:maison' },
  payload: { exercise_type: 'vocab_recall_choice', is_correct: true, response_time_ms: 1800, attempt_number: 1, hints_used: 0, choice_count: 4 },
  ...extra
}, at(t));
const buffer = h => h.storage.values[Events.BUFFER_KEY] || [];
const settle = async h => { for (let i = 0; i < 5; i++) { await h.hub.idle(); await new Promise(r => setImmediate(r)); } };

test('stamp builds a taxonomy envelope and rejects forbidden or unknown fields', () => {
  const event = answer(T0);
  assert.match(event.event_id, UUID);
  assert.equal(event.occurred_at, '2026-10-15T14:00:00.000Z');
  assert.equal(typeof event.tz_offset_minutes, 'number');
  assert.throws(() => Events.stamp('answer_correct', { surface: 'studio', language: 'es' }), /Unknown event type/);
  assert.throws(() => Events.stamp('definition_saved', { surface: 'studio' }), /requires a language/);
  assert.throws(() => Events.stamp('phrase_captured', { surface: 'page', language: 'es', payload: { capture_source: 'web', text: 'hola' } }), /Forbidden field in event: text/);
  assert.throws(() => Events.stamp('phrase_captured', { surface: 'page', language: 'es', payload: { meta: { source_url: 'https://x' } } }), /source_url/);
  assert.throws(() => Events.stamp('lesson_started', { surface: 'studio', language: 'es', context: { page: 'x' } }), /Unknown context key/);
  assert.doesNotThrow(() => Events.stamp('session_started', { surface: 'service', payload: { entry_surface: 'studio' } }));
});

test('record is a safe no-op outside the extension (preview mode)', () => {
  assert.equal(Events.record('definition_saved', { surface: 'studio', language: 'es', context: { vocab_item_id: 'es:casa' }, payload: { has_context: false, is_custom: false } }), false);
});

test('events are dropped while Insights is disabled', async () => {
  const h = harness();
  assert.deepEqual(await h.hub.record(answer(T0)), { ok: false, reason: 'disabled' });
  assert.equal(buffer(h).length, 0);
});

test('enabling registers the learner before anything else and syncs immediately', async () => {
  const h = harness();
  const { learnerId } = await h.hub.enable({ nativeLanguage: 'en' });
  assert.match(learnerId, UUID);
  await settle(h);
  assert.equal(h.requests.length, 1);
  const { url, body } = h.requests[0];
  assert.equal(url, 'http://127.0.0.1:17495/v1/event-batches');
  assert.equal(body.source, 'extension');
  assert.equal(body.learner_id, learnerId);
  assert.deepEqual(body.events.map(e => e.event_type), ['learner_registered', 'session_started']);
  assert.deepEqual(body.events[0].payload, { native_language: 'en', consent_version: Events.CONSENT_VERSION });
  for (const e of body.events) {
    assert.equal(e.learner_id, learnerId);
    assert.equal(e.schema_version, 1);
    assert.equal(e.app_version, '3.1.0');
    assert.equal(e.language, undefined);
  }
  assert.equal(buffer(h).length, 0, 'delivered events leave the buffer');
});

test('recorded events get identity, session and version, and wait for the debounce alarm', async () => {
  const h = harness();
  await h.hub.enable({ nativeLanguage: 'en' }); await settle(h);
  await h.hub.record(answer(T0 + MIN));
  const [event] = buffer(h);
  assert.equal(event.event_type, 'answer_submitted');
  assert.equal(event.session_id, h.requests[0].body.events[1].session_id, 'same session within 30 minutes');
  assert.equal(event.language, 'fr');
  assert.equal(h.requests.length, 1, 'one event does not sync immediately');
  const alarm = h.alarms.created.at(-1);
  assert.equal(alarm.name, Events.SYNC_ALARM);
  assert.equal(alarm.when, T0 + Events.LIMITS.debounceMs);
});

test('a gap over 30 minutes ends the session and starts a new one', async () => {
  const h = harness();
  await h.hub.enable({ nativeLanguage: 'en' }); await settle(h);
  await h.hub.record(answer(T0 + 10 * MIN));
  await h.hub.record(answer(T0 + 41 * MIN));
  const events = buffer(h);
  assert.deepEqual(events.map(e => e.event_type), ['answer_submitted', 'session_ended', 'session_started', 'answer_submitted']);
  assert.deepEqual(events[1].payload, { reason: 'idle', last_activity_at: new Date(T0 + 10 * MIN).toISOString() });
  assert.equal(events[1].session_id, events[0].session_id, 'session_ended belongs to the old session');
  assert.notEqual(events[2].session_id, events[0].session_id);
  assert.equal(events[3].session_id, events[2].session_id);
  assert.equal(events[2].payload.entry_surface, 'studio');
});

test('preference_set and reaching 50 events both trigger an immediate sync', async () => {
  const h = harness();
  await h.hub.enable({ nativeLanguage: 'en' }); await settle(h);
  await h.hub.record(Events.stamp('preference_set', { surface: 'studio', language: 'es', payload: { preference_key: 'region', value: 'mx', stated_via: 'settings' } }, at(T0)));
  await settle(h);
  assert.equal(h.requests.length, 2);
  for (let i = 0; i < Events.LIMITS.syncAt; i++) await h.hub.record(answer(T0 + i));
  await settle(h);
  assert.equal(h.requests.length, 3);
  assert.equal(h.requests[2].body.events.length, Events.LIMITS.syncAt);
});

test('failed syncs keep events, back off exponentially, and retry with the same batch_id', async () => {
  const h = harness({ statuses: [200, 'network', 503, 200] });
  await h.hub.enable({ nativeLanguage: 'en' }); await settle(h);
  await h.hub.record(answer(T0));
  assert.equal((await h.hub.sync()).ok, false);
  assert.equal(h.alarms.created.at(-1).when, T0 + 30 * 1000);
  assert.equal((await h.hub.sync()).ok, false);
  assert.equal(h.alarms.created.at(-1).when, T0 + 60 * 1000);
  assert.equal(buffer(h).length, 1);
  assert.equal((await h.hub.status()).lastError, 'HTTP 503');
  assert.equal((await h.hub.sync()).ok, true);
  const ids = h.requests.slice(1).map(r => r.body.batch_id);
  assert.equal(new Set(ids).size, 1, 'retries reuse batch_id so the server can deduplicate');
  assert.equal(buffer(h).length, 0);
  assert.equal((await h.hub.status()).lastError, null);
});

test('backoff is capped at 10 minutes', () => {
  assert.equal(Events._test.backoffMs(1), 30 * 1000);
  assert.equal(Events._test.backoffMs(4), 4 * 60 * 1000);
  assert.equal(Events._test.backoffMs(20), 10 * 60 * 1000);
});

test('overflow drops the oldest events and reports the count once', async () => {
  const h = harness({ statuses: [200, 'network'] });
  await h.hub.enable({ nativeLanguage: 'en' }); await settle(h);
  const total = Events.LIMITS.buffer + 7;
  h.storage.values[Events.BUFFER_KEY] = Array.from({ length: total - 1 }, (_, i) => ({ event_id: `e${i}` }));
  await h.hub.record(answer(T0));
  await settle(h); // the full buffer triggers a sync, which fails ('network')
  assert.equal(h.requests.length, 2);
  assert.equal(buffer(h).length, Events.LIMITS.buffer);
  assert.equal(buffer(h)[0].event_id, 'e7', 'the oldest seven were dropped');
  assert.equal((await h.hub.status()).dropped, 7);
  await h.hub.sync();
  const sent = h.requests.at(-1).body;
  assert.equal(sent.dropped_since_last_sync, 7);
  assert.equal(sent.events.length, Events.LIMITS.batchEvents);
  assert.equal((await h.hub.status()).dropped, 0, 'reported loss is not reported twice');
});

test('a pending batch whose events overflowed gets a fresh batch_id', async () => {
  const h = harness({ statuses: [200, 'network', 200] });
  await h.hub.enable({ nativeLanguage: 'en' }); await settle(h);
  await h.hub.record(answer(T0));
  await h.hub.sync();
  const firstId = h.requests.at(-1).body.batch_id;
  h.storage.values[Events.BUFFER_KEY] = Array.from({ length: Events.LIMITS.buffer }, (_, i) => ({ event_id: `x${i}` }));
  await h.hub.sync();
  assert.notEqual(h.requests.at(-1).body.batch_id, firstId);
});

test('a non-retryable 4xx drops the batch and counts it as lost', async () => {
  const h = harness({ statuses: [200, 422] });
  await h.hub.enable({ nativeLanguage: 'en' }); await settle(h);
  await h.hub.record(answer(T0));
  await h.hub.record(answer(T0 + 1));
  const result = await h.hub.sync();
  assert.equal(result.status, 422);
  assert.equal(buffer(h).length, 0);
  const status = await h.hub.status();
  assert.equal(status.dropped, 2);
  assert.equal(status.lastError, 'Rejected (HTTP 422)');
});

test('overlapping records never lose each other', async () => {
  const h = harness();
  await h.hub.enable({ nativeLanguage: 'en' }); await settle(h);
  await Promise.all(Array.from({ length: 20 }, (_, i) => h.hub.record(answer(T0 + i))));
  assert.equal(buffer(h).length, 20);
});

test('disabling discards undelivered events and stops syncing', async () => {
  const h = harness({ statuses: [200] });
  await h.hub.enable({ nativeLanguage: 'en' }); await settle(h);
  await h.hub.record(answer(T0));
  await h.hub.disable();
  assert.equal(buffer(h).length, 0);
  assert.deepEqual(h.alarms.cleared, [Events.SYNC_ALARM]);
  assert.deepEqual(await h.hub.record(answer(T0 + 1)), { ok: false, reason: 'disabled' });
  assert.deepEqual(await h.hub.sync(), { ok: true, sent: 0 });
});

test('re-enabling keeps the learner and records consent again', async () => {
  const h = harness();
  const first = await h.hub.enable({ nativeLanguage: 'en' }); await settle(h);
  await h.hub.disable();
  const second = await h.hub.enable({ nativeLanguage: 'de' }); await settle(h);
  assert.equal(second.learnerId, first.learnerId);
  assert.equal(h.requests.at(-1).body.events[0].payload.native_language, 'de');
});
