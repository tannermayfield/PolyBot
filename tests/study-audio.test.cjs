'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const audio = require('../study-audio.js');
const { analyzeSamples, compareMetrics, encodeWav, normalizeBaseUrl, boundedResponse } = audio._test;

test('audio metrics count internal pauses, exclude leading/trailing silence, and do not invent activity', () => {
  const samples = new Float32Array(16000 * 3);
  samples.fill(0.1, 8000, 16000); samples.fill(0.1, 24000, 32000);
  const metrics = analyzeSamples(samples, 16000);
  assert.equal(metrics.duration, 3); assert.equal(metrics.activeDuration, 1); assert.equal(metrics.pauseCount, 1);
  assert.equal(metrics.clippingRatio, 0);
  const silent = analyzeSamples(new Float32Array(16000), 16000);
  assert.equal(silent.activeDuration, 0); assert.equal(silent.pauseCount, 0); assert.equal(silent.rms, 0);
  assert.equal(compareMetrics(silent, silent).paceRatio, null);
  assert.throws(() => analyzeSamples([], 16000), /empty/);
});

test('clipping and timing advice derive from actual sample energy', () => {
  const loud = analyzeSamples(new Float32Array(16000).fill(1), 16000);
  assert.equal(loud.clippingRatio, 1); assert.equal(loud.rms, 1);
  const compared = compareMetrics({ ...loud, activeDuration: 0.5 }, loud);
  assert.equal(compared.paceRatio, 2);
  assert.ok(compared.tips.some(tip => tip.includes('distorted')));
  assert.ok(compared.tips[0].includes('not pronunciation'));
  assert.equal(compared.accentScore, undefined);
});

test('WAV conversion emits signed 16-bit mono PCM with bounded and finite samples', async () => {
  const wav = await encodeWav(new Float32Array([-2, -1, 0, 1, 2, NaN])).arrayBuffer();
  const view = new DataView(wav);
  assert.equal(wav.byteLength, 56); assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(22, true), 1); assert.equal(view.getUint16(34, true), 16);
  assert.deepEqual(Array.from({ length: 6 }, (_, index) => view.getInt16(44 + index * 2, true)), [-32768, -32768, 0, 32767, 32767, 0]);
});

test('service URLs reject unsafe schemes, credentials, nonloopback plaintext, and URL query tokens', () => {
  assert.equal(normalizeBaseUrl('http://localhost:17493/'), 'http://localhost:17493');
  assert.equal(normalizeBaseUrl('https://voice.example/api/'), 'https://voice.example/api');
  for (const url of ['http://public.example', 'ftp://localhost', 'https://name:secret@example.com', 'https://example.com/?token=x', 'javascript:alert(1)', 'file:///tmp/a']) assert.throws(() => normalizeBaseUrl(url));
});

test('profile loading accepts wrapper responses and sanitizes the visible shape', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ profiles: [{ id: 'one', name: 'Regional voice', extra: 'omit' }, { bad: true }] }), { headers: { 'Content-Type': 'application/json' } }));
  assert.deepEqual(await audio.listVoiceboxProfiles('http://localhost:17493'), [{ id: 'one', name: 'Regional voice' }]);
});

test('Voicebox sends Spanish text and keeps export data persistent', async t => {
  const requests = [];
  const blob = encodeWav(new Float32Array(1600));
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/generate')) return new Response(JSON.stringify({ id: 'generation/id', status: 'completed' }));
    return new Response(blob, { headers: { 'Content-Type': 'audio/wav' } });
  });
  const result = await audio.generateVoicebox({ baseUrl: 'http://localhost:17493', profileId: 'voice', text: 'Buenos días.' });
  assert.deepEqual(JSON.parse(requests[0].options.body), { text: 'Buenos días.', profile_id: 'voice', language: 'es' });
  assert.match(requests[1].url, /generation%2Fid\/export-audio$/);
  assert.match(result.audioUrl, /^data:audio\/wav;base64,UklGR/);
});

test('Voicebox rejects failed generation and nonaudio exports', async t => {
  let failed = true;
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.endsWith('/generate')) return new Response(JSON.stringify({ id: 'a', status: failed ? 'failed' : 'completed' }));
    return new Response('<html>not audio</html>', { headers: { 'Content-Type': 'text/html' } });
  });
  await assert.rejects(audio.generateVoicebox({ baseUrl: 'http://localhost:17493', profileId: 'a', text: 'Hola' }), /generation failed/);
  failed = false;
  await assert.rejects(audio.generateVoicebox({ baseUrl: 'http://localhost:17493', profileId: 'a', text: 'Hola' }), /not an audio/);
});

test('queued generation polling can be canceled without issuing an audio fetch', async t => {
  const controller = new AbortController(); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; setTimeout(() => controller.abort(), 15); return new Response(JSON.stringify({ id: 'a', status: 'queued' })); });
  await assert.rejects(audio.generateVoicebox({ baseUrl: 'http://localhost:17493', profileId: 'a', text: 'Hola', signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('oversized streamed responses are rejected even without content-length', async () => {
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(20)); controller.close(); } }));
  await assert.rejects(boundedResponse(response, 10), /too large/);
});

test('unsupported regional accents reject assessment before audio decoding or upload', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; });
  await assert.rejects(audio.assess({ audioUrl: 'anything', text: 'Hola', accentId: 'es-AR', endpoint: 'http://localhost:17494' }), /es-MX and es-ES/);
  assert.equal(calls, 0);
});

function mockMicrophone(t, getUserMedia) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia } } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor); else delete globalThis.navigator; });
  const prior = globalThis.MediaRecorder;
  globalThis.MediaRecorder = class {
    static isTypeSupported() { return true; }
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable({ data: new Blob([new Uint8Array(200)]) }); this.onstop(); }); }
  };
  t.after(() => { if (prior) globalThis.MediaRecorder = prior; else delete globalThis.MediaRecorder; });
}

test('recorder deduplicates concurrent starts/stops and releases microphone tracks', async t => {
  let permissions = 0, tracksStopped = 0;
  mockMicrophone(t, async () => { permissions++; return { getTracks: () => [{ stop: () => tracksStopped++ }] }; });
  const recorder = audio.createRecorder();
  await Promise.all([recorder.start(), recorder.start()]);
  await new Promise(resolve => setTimeout(resolve, 170));
  const [first, second] = await Promise.all([recorder.stop(), recorder.stop()]);
  assert.equal(permissions, 1); assert.equal(first, second); assert.ok(first.duration >= 0.15); assert.ok(tracksStopped >= 1);
});

test('cancel during pending microphone permission releases subsequently acquired tracks', async t => {
  let finishPermission, stopped = 0;
  mockMicrophone(t, () => new Promise(resolve => { finishPermission = resolve; }));
  const recorder = audio.createRecorder(); const pending = recorder.start(); recorder.cancel();
  finishPermission({ getTracks: () => [{ stop: () => stopped++ }] });
  await assert.rejects(pending, { name: 'AbortError' }); assert.ok(stopped >= 1);
});

test('microphone denial produces an actionable error', async t => {
  mockMicrophone(t, async () => { throw new DOMException('Denied', 'NotAllowedError'); });
  await assert.rejects(audio.createRecorder().start(), /Microphone access was denied/);
});

test('auto-stop finishes recording, reports the result, and releases the microphone', async t => {
  let stopped = 0;
  mockMicrophone(t, async () => ({ getTracks: () => [{ stop: () => stopped++ }] }));
  let finish;
  const completed = new Promise(resolve => { finish = resolve; });
  const recorder = audio.createRecorder({ maxSeconds: 1, onAutoStop: finish });
  await recorder.start();
  const result = await completed;
  assert.ok(result.duration >= 0.5 && result.duration < 1.5); assert.ok(stopped > 0);
  assert.equal(await recorder.stop(), result);
});

function mockWebAudio(t, duration) {
  let closed = 0; const frames = Math.ceil(duration * 48000);
  const previousContext = globalThis.AudioContext, previousOffline = globalThis.OfflineAudioContext;
  globalThis.AudioContext = class {
    async decodeAudioData() { return { length: frames, duration, sampleRate: 48000, numberOfChannels: 1, getChannelData: () => new Float32Array(frames) }; }
    async close() { closed++; }
  };
  globalThis.OfflineAudioContext = class {
    constructor(channels, length, sampleRate) { assert.equal(channels, 1); assert.equal(sampleRate, 16000); this.length = length; }
    createBufferSource() { return { connect() {}, start() {} }; }
    async startRendering() { return { getChannelData: () => new Float32Array(this.length) }; }
  };
  t.after(() => {
    if (previousContext) globalThis.AudioContext = previousContext; else delete globalThis.AudioContext;
    if (previousOffline) globalThis.OfflineAudioContext = previousOffline; else delete globalThis.OfflineAudioContext;
  });
  return () => closed;
}

test('assessment WAV conversion has a strict decoded 30 second maximum and closes decoder contexts', async t => {
  const closed = mockWebAudio(t, 30.01);
  await assert.rejects(audio.toWav('data:audio/wav;base64,AAAA'), /up to 30 seconds/);
  assert.equal(closed(), 1);
});

test('WAV conversion resamples through the browser to exactly 16 kHz mono', async t => {
  const closed = mockWebAudio(t, 30);
  const wav = await audio.toWav('data:audio/wav;base64,AAAA');
  assert.equal(wav.size, 960044); assert.equal(wav.type, 'audio/wav'); assert.equal(closed(), 1);
});

test('null/malformed error responses from an assessment endpoint remain actionable', async t => {
  mockWebAudio(t, 1); let responseBody = 'null';
  t.mock.method(globalThis, 'fetch', async () => new Response(responseBody, { status: 503 }));
  const request = { audioUrl: 'data:audio/wav;base64,AAAA', text: 'Hola', accentId: 'es-MX', endpoint: 'http://localhost:17494' };
  await assert.rejects(audio.assess(request), /HTTP 503/);
  responseBody = '<html>invalid json</html>';
  await assert.rejects(audio.assess(request), /HTTP 503/);
});
