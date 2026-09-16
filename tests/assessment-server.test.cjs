'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { readConfig, parseOrigins, validateWav, validateAssessmentInput, parseAzureResult, performAssessment, createHandler } = require('../server/assessment-server.cjs');
const { _test: { encodeWav } } = require('../study-audio.js');
const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const azureResult = () => ({ RecognitionStatus: 'Success', NBest: [{ Display: 'Buenos días.', AccuracyScore: 78, FluencyScore: 81, CompletenessScore: 100, ProsodyScore: 99,
  Words: [{ Word: 'Buenos', AccuracyScore: 64, ErrorType: 'Mispronunciation', Phonemes: [{ Phoneme: 'b', AccuracyScore: 70 }] }, { Word: 'días', AccuracyScore: 91, ErrorType: 'None' }] }] });
const sampleWav = async (seconds = 1) => Buffer.from(await encodeWav(new Float32Array(16000 * seconds).fill(0.1)).arrayBuffer());

test('configuration accepts exact origins and keeps keys server side', () => {
  const config = readConfig({ ALLOWED_ORIGINS: `${ORIGIN},http://127.0.0.1:4173`, AZURE_SPEECH_KEY: 'test-secret', AZURE_SPEECH_REGION: 'eastus' });
  assert.equal(config.origins.size, 2); assert.match(config.endpoint, /^https:\/\/eastus\.stt\.speech\.microsoft\.com\//);
  assert.throws(() => parseOrigins('*'), /wildcards/);
  assert.throws(() => parseOrigins('https://public.example'), /exact/);
  assert.throws(() => readConfig({ AZURE_SPEECH_REGION: 'evil.example/path' }), /region name/);
  assert.throws(() => readConfig({ AZURE_SPEECH_ENDPOINT: 'https://attacker.example' }), /official/);
  assert.throws(() => readConfig({ ASSESSMENT_LOCALES: 'es-AR' }), /es-MX/);
  assert.match(readConfig({ AZURE_SPEECH_ENDPOINT: 'https://my-resource.cognitiveservices.azure.com/' }).endpoint, /\/stt\/speech\//);
});

test('WAV parser enforces PCM format, declared sizes, and 30 second bounds', async () => {
  const wav = await sampleWav(); assert.equal(validateWav(wav).duration, 1);
  const stereo = Buffer.from(wav); stereo.writeUInt16LE(2, 22); assert.throws(() => validateWav(stereo), /16 kHz mono/);
  const wrongRate = Buffer.from(wav); wrongRate.writeUInt32LE(48000, 24); assert.throws(() => validateWav(wrongRate), /16 kHz mono/);
  const corruptLength = Buffer.from(wav); corruptLength.writeUInt32LE(99999, 40); assert.throws(() => validateWav(corruptLength), /truncated/);
  assert.throws(() => validateWav(wav.subarray(0, wav.length - 1)), /malformed/);
  assert.equal(validateWav(await sampleWav(30)).duration, 30);
  assert.throws(() => validateWav(Buffer.alloc(980000)), /at most 30/);
});

test('assessment input rejects unsupported locale, malformed base64, arbitrary fields, and oversized text', async () => {
  const input = { audioBase64: (await sampleWav()).toString('base64'), text: 'Buenos días.', locale: 'es-MX' };
  assert.equal(validateAssessmentInput(input).duration, 1);
  for (const override of [{ locale: 'es-AR' }, { text: '' }, { text: 'x'.repeat(1001) }, { audioBase64: 'data:audio/wav;base64,abc' }, { audioBase64: 'abc%' }, { extra: 'ignored?' }]) assert.throws(() => validateAssessmentInput({ ...input, ...override }));
  assert.equal(validateAssessmentInput({ ...input, audioBase64: (await sampleWav(30)).toString('base64') }).duration, 30);
});

test('Azure parser supports REST and SDK score nesting without fabricating missing scores or prosody', () => {
  const result = parseAzureResult(azureResult(), 'es-MX');
  assert.equal(result.accuracy, 78); assert.equal(result.words[0].phonemes[0].accuracy, 70);
  assert.equal(result.prosody, undefined); assert.equal(result.accentScore, undefined);
  assert.ok(result.limitations.some(text => text.includes('not a measurement of similarity')));
  const sdk = { RecognitionStatus: 'Success', NBest: [{ Display: 'Hola', PronunciationAssessment: { AccuracyScore: 90 }, Words: [{ Word: 'Hola', PronunciationAssessment: { AccuracyScore: 85 }, Phonemes: [] }] }] };
  const nested = parseAzureResult(sdk, 'es-ES'); assert.equal(nested.accuracy, 90); assert.equal(nested.fluency, null); assert.equal(nested.words[0].accuracy, 85);
  assert.throws(() => parseAzureResult({ RecognitionStatus: 'NoMatch' }, 'es-MX'), /No reliable/);
  assert.throws(() => parseAzureResult({ RecognitionStatus: 'Success', NBest: [{ Display: 'Hola' }] }, 'es-MX'), /without pronunciation scores/);
  assert.throws(() => parseAzureResult({ RecognitionStatus: 'Success', NBest: [{ Display: 'Hola', PronunciationAssessment: null }] }, 'es-MX'), /without pronunciation scores/);
  assert.throws(() => parseAzureResult(null, 'es-MX'), /could not produce/);
});

test('upstream request attaches only server key and documented pronunciation parameters', async () => {
  const config = readConfig({ AZURE_SPEECH_KEY: 'server-secret', AZURE_SPEECH_REGION: 'eastus', ALLOWED_ORIGINS: ORIGIN });
  const input = { audio: await sampleWav(), text: 'Buenos días.', locale: 'es-MX' };
  let request;
  const result = await performAssessment(input, config, async (url, options) => { request = { url, options }; return new Response(JSON.stringify(azureResult())); });
  assert.equal(request.options.headers['Ocp-Apim-Subscription-Key'], 'server-secret');
  const parameters = JSON.parse(Buffer.from(request.options.headers['Pronunciation-Assessment'], 'base64').toString());
  assert.equal(parameters.ReferenceText, input.text); assert.equal(parameters.EnableMiscue, true); assert.equal(parameters.EnableProsodyAssessment, undefined);
  assert.match(request.url, /language=es-MX/); assert.equal(result.provider, 'azure'); assert.ok(!JSON.stringify(result).includes('server-secret'));
});

test('missing configuration avoids cloud calls and provider errors remain sanitized', async () => {
  const input = { audio: await sampleWav(), text: 'Hola', locale: 'es-MX' };
  let calls = 0; const fetcher = async () => { calls++; return new Response('secret=DO_NOT_LEAK', { status: 401 }); };
  await assert.rejects(performAssessment(input, readConfig({}), fetcher), /not configured/); assert.equal(calls, 0);
  const config = readConfig({ AZURE_SPEECH_KEY: 'secret', AZURE_SPEECH_REGION: 'eastus' });
  await assert.rejects(performAssessment(input, config, fetcher), error => error.status === 502 && /credentials/.test(error.message) && !error.message.includes('DO_NOT_LEAK'));
  await assert.rejects(performAssessment(input, config, async () => { throw new Error('secret transport detail'); }), error => !error.message.includes('secret transport detail'));
});

test('upstream timeout aborts requests and returns an actionable 504', async () => {
  const config = { ...readConfig({ AZURE_SPEECH_KEY: 'secret', AZURE_SPEECH_REGION: 'eastus' }), upstreamTimeoutMs: 15 };
  const fakeFetch = (_, options) => new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))); });
  await assert.rejects(performAssessment({ audio: await sampleWav(), text: 'Hola', locale: 'es-MX' }, config, fakeFetch), error => error.status === 504);
});

async function withServer(t, configured = true) {
  const config = readConfig({ ALLOWED_ORIGINS: ORIGIN, ...(configured ? { AZURE_SPEECH_KEY: 'never-expose', AZURE_SPEECH_REGION: 'eastus' } : {}) });
  let cloudCalls = 0;
  const handler = createHandler(config, { fetchImpl: async () => { cloudCalls++; return new Response(JSON.stringify(azureResult())); } });
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); config.port = server.address().port;
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { base: `http://127.0.0.1:${config.port}`, cloudCalls: () => cloudCalls };
}

test('HTTP origin and Host protection blocks untrusted websites and no-origin uploads', async t => {
  const server = await withServer(t);
  const untrusted = await fetch(`${server.base}/assess`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(untrusted.status, 403); assert.equal(untrusted.headers.get('access-control-allow-origin'), null);
  const missing = await fetch(`${server.base}/assess`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(missing.status, 403);
  // fetch normalizes Host; use the HTTP transport to exercise a rebinding request.
  const reboundStatus = await new Promise((resolve, reject) => {
    const request = http.get(`${server.base}/health`, { headers: { Host: 'evil.example' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject);
  });
  assert.equal(reboundStatus, 403);
  assert.equal(server.cloudCalls(), 0);
});

test('HTTP health, preflight, explicit assessment, and malformed requests', async t => {
  const server = await withServer(t); const headers = { Origin: ORIGIN, 'Content-Type': 'application/json' };
  const health = await fetch(`${server.base}/health`); const status = await health.json(); assert.equal(status.configured, true); assert.equal(status.key, undefined);
  const preflight = await fetch(`${server.base}/assess`, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const body = JSON.stringify({ audioBase64: (await sampleWav()).toString('base64'), text: 'Buenos días.', locale: 'es-MX' });
  const valid = await fetch(`${server.base}/assess`, { method: 'POST', headers, body }); assert.equal(valid.status, 200); assert.equal((await valid.json()).accuracy, 78);
  const malformed = await fetch(`${server.base}/assess`, { method: 'POST', headers, body: '{' }); assert.equal(malformed.status, 400);
  const wrongMime = await fetch(`${server.base}/assess`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'text/plain' }, body }); assert.equal(wrongMime.status, 415);
  const oversized = await fetch(`${server.base}/assess`, { method: 'POST', headers, body: 'x'.repeat(1_350_001) }); assert.equal(oversized.status, 413);
  assert.equal(server.cloudCalls(), 1);
});

test('HTTP missing provider setup returns 503 with setup directions', async t => {
  const server = await withServer(t, false);
  const response = await fetch(`${server.base}/assess`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ audioBase64: (await sampleWav()).toString('base64'), text: 'Hola', locale: 'es-ES' }) });
  assert.equal(response.status, 503); assert.match((await response.json()).error, /AZURE_SPEECH_KEY/); assert.equal(server.cloudCalls(), 0);
});
