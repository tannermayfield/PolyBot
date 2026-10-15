'use strict';

// Optional local bridge. Secrets stay in this Node process, never in extension storage.
const http = require('node:http');
const SUPPORTED_LOCALES = Object.freeze(['es-MX', 'es-ES']);
const MAX_BODY_BYTES = 1_350_000;
const MAX_WAV_BYTES = 970_000;
const MAX_UPSTREAM_BYTES = 1_000_000;

class ServiceError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function parseOrigins(value = '') {
  const origins = new Set();
  for (const item of value.split(',').map(item => item.trim()).filter(Boolean)) {
    const extension = /^chrome-extension:\/\/[a-p]{32}$/.test(item);
    let local = false;
    try {
      const url = new URL(item);
      local = ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.origin === item;
    } catch (_) {}
    if (!extension && !local) throw new ServiceError(503, 'ALLOWED_ORIGINS must contain exact Chrome extension or localhost origins; wildcards are not allowed.');
    origins.add(item);
  }
  return origins;
}

function readConfig(env = process.env) {
  const port = Number(env.ASSESSMENT_PORT || 17494);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new ServiceError(503, 'ASSESSMENT_PORT must be between 1024 and 65535.');
  const key = (env.AZURE_SPEECH_KEY || '').trim();
  const region = (env.AZURE_SPEECH_REGION || '').trim();
  let endpoint = '';
  if (env.AZURE_SPEECH_ENDPOINT) {
    let url;
    try { url = new URL(env.AZURE_SPEECH_ENDPOINT); } catch (_) { throw new ServiceError(503, 'AZURE_SPEECH_ENDPOINT must be an official HTTPS Speech resource origin.'); }
    if (url.protocol !== 'https:' || !/^[a-z0-9][a-z0-9-]*\.cognitiveservices\.azure\.com$/.test(url.hostname) || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') {
      throw new ServiceError(503, 'AZURE_SPEECH_ENDPOINT must be an official HTTPS Speech resource origin.');
    }
    endpoint = `${url.origin}/stt/speech/recognition/conversation/cognitiveservices/v1`;
  } else if (region) {
    if (!/^[a-z][a-z0-9]{1,40}$/.test(region)) throw new ServiceError(503, 'AZURE_SPEECH_REGION must be an Azure region name, such as eastus.');
    endpoint = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`;
  }
  const origins = parseOrigins(env.ALLOWED_ORIGINS);
  const locales = (env.ASSESSMENT_LOCALES || SUPPORTED_LOCALES.join(',')).split(',').map(x => x.trim()).filter(Boolean);
  if (!locales.length || locales.some(locale => !SUPPORTED_LOCALES.includes(locale))) throw new ServiceError(503, 'ASSESSMENT_LOCALES may contain only es-MX and es-ES.');
  return { port, key, endpoint, origins, locales, upstreamTimeoutMs: 35000 };
}

function validateWav(buffer) {
  const bad = message => { throw new ServiceError(400, message); };
  if (!Buffer.isBuffer(buffer) || buffer.length < 44 || buffer.length > MAX_WAV_BYTES) bad('Audio must be a PCM WAV recording of at most 30 seconds.');
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE' || buffer.readUInt32LE(4) !== buffer.length - 8) bad('The WAV file is malformed.');
  let position = 12, format, data;
  while (position < buffer.length) {
    if (position + 8 > buffer.length) bad('The WAV file contains a truncated chunk.');
    const name = buffer.toString('ascii', position, position + 4); const length = buffer.readUInt32LE(position + 4);
    const start = position + 8; const end = start + length;
    if (end > buffer.length) bad('The WAV file contains a truncated chunk.');
    if (name === 'fmt ') {
      if (format || length < 16) bad('The WAV format chunk is invalid.');
      format = { encoding: buffer.readUInt16LE(start), channels: buffer.readUInt16LE(start + 2), sampleRate: buffer.readUInt32LE(start + 4),
        byteRate: buffer.readUInt32LE(start + 8), blockAlign: buffer.readUInt16LE(start + 12), bits: buffer.readUInt16LE(start + 14) };
    }
    if (name === 'data') { if (data) bad('The WAV file contains multiple audio chunks.'); data = { start, length }; }
    position = end + (length % 2);
  }
  if (position !== buffer.length || !format || !data) bad('The WAV file is incomplete.');
  if (format.encoding !== 1 || format.channels !== 1 || format.sampleRate !== 16000 || format.bits !== 16 || format.blockAlign !== 2 || format.byteRate !== 32000) bad('Audio must be 16 kHz mono, 16-bit PCM WAV.');
  const duration = data.length / format.byteRate;
  if (data.length % 2 || duration < 0.2 || duration > 30) bad('Record between 0.2 and 30 seconds of audio.');
  return { duration, ...format };
}

function validateAssessmentInput(body, locales = SUPPORTED_LOCALES) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ServiceError(400, 'Send a JSON object containing audioBase64, text, and locale.');
  if (Object.keys(body).some(key => !['audioBase64', 'text', 'locale'].includes(key))) throw new ServiceError(400, 'The request contains unsupported fields.');
  if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 1000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(body.text)) throw new ServiceError(400, 'Reference text must contain between 1 and 1,000 characters.');
  if (!SUPPORTED_LOCALES.includes(body.locale) || !locales.includes(body.locale)) throw new ServiceError(400, 'This bridge supports Spanish pronunciation assessment for es-MX and es-ES only. Other accents are available for local shadowing.');
  if (typeof body.audioBase64 !== 'string' || body.audioBase64.length > Math.ceil(MAX_WAV_BYTES / 3) * 4 || body.audioBase64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.audioBase64)) throw new ServiceError(400, 'audioBase64 must contain a bounded base64 WAV file.');
  const audio = Buffer.from(body.audioBase64, 'base64');
  if (audio.toString('base64') !== body.audioBase64) throw new ServiceError(400, 'Audio base64 encoding is invalid.');
  const metadata = validateWav(audio);
  return { audio, text: body.text.trim(), locale: body.locale, duration: metadata.duration };
}

const score = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const scoreObject = object => object && object.PronunciationAssessment && typeof object.PronunciationAssessment === 'object' && !Array.isArray(object.PronunciationAssessment) ? object.PronunciationAssessment : object || {};

function parseAzureResult(body, locale) {
  if (!body || typeof body !== 'object' || body.RecognitionStatus !== 'Success') {
    const silence = body && ['InitialSilenceTimeout', 'BabbleTimeout', 'NoMatch'].includes(body.RecognitionStatus);
    throw new ServiceError(silence ? 422 : 502, silence ? 'No reliable Spanish speech was recognized. Check the microphone, recording, and selected locale before retrying.' : 'The speech service could not produce an assessment. Try again later.');
  }
  const best = body.NBest && body.NBest[0];
  if (!best || typeof best !== 'object') throw new ServiceError(502, 'The speech service returned an incomplete assessment.');
  const summary = scoreObject(best);
  const accuracy = score(summary.AccuracyScore), fluency = score(summary.FluencyScore), completeness = score(summary.CompletenessScore);
  if (accuracy === null && fluency === null && completeness === null) throw new ServiceError(502, 'The speech service returned transcription without pronunciation scores. Check the Speech resource configuration.');
  const words = (Array.isArray(best.Words) ? best.Words : []).slice(0, 500).filter(word => word && typeof word.Word === 'string').map(word => {
    const assessment = scoreObject(word);
    const result = { word: word.Word.slice(0, 200), accuracy: score(assessment.AccuracyScore) };
    if (['None', 'Omission', 'Insertion', 'Mispronunciation'].includes(assessment.ErrorType)) result.errorType = assessment.ErrorType;
    if (Array.isArray(word.Phonemes)) result.phonemes = word.Phonemes.slice(0, 100).filter(p => p && typeof p.Phoneme === 'string').map(p => ({ phoneme: p.Phoneme.slice(0, 100), accuracy: score(scoreObject(p).AccuracyScore) }));
    return result;
  });
  const tips = [];
  const omissions = words.filter(word => word.errorType === 'Omission');
  if (omissions.length) tips.push('Some reference words were not detected. Listen to your recording and check the transcript before retrying.');
  const practice = words.filter(word => word.accuracy !== null && word.accuracy < 75 && word.errorType !== 'Omission').sort((a, b) => a.accuracy - b.accuracy).slice(0, 2);
  if (practice.length) tips.push(`Replay and practice: ${practice.map(word => word.word).join(', ')}. The provider marked these words for closer listening.`);
  if (fluency !== null && fluency < 70) tips.push('Listen to the pauses in your recording. Try the phrase in a few connected groups.');
  return { provider: 'azure', locale, transcript: String(best.Display || body.DisplayText || best.Lexical || '').slice(0, 4000), accuracy, fluency, completeness, words, tips,
    limitations: ['Automated feedback can be wrong. Confirm suggestions by listening to the recordings.',
      'This is a locale-based pronunciation assessment, not a measurement of similarity to your selected speaker or their regional accent.',
      'Spanish prosody and intonation are not scored. Regional features may not match the provider model.'] };
}

async function readBoundedJson(response) {
  if (Number(response.headers.get('content-length')) > MAX_UPSTREAM_BYTES) throw new ServiceError(502, 'The speech service returned an oversized response.');
  const chunks = []; let size = 0;
  if (!response.body) throw new ServiceError(502, 'The speech service returned an empty response.');
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > MAX_UPSTREAM_BYTES) throw new ServiceError(502, 'The speech service returned an oversized response.');
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch (_) { throw new ServiceError(502, 'The speech service returned an invalid response.'); }
}

async function performAssessment(input, config, fetchImpl = fetch, signal) {
  if (!config.key || !config.endpoint) throw new ServiceError(503, 'Assessment is not configured. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION (or AZURE_SPEECH_ENDPOINT) in the local server environment.');
  const url = new URL(config.endpoint); url.searchParams.set('language', input.locale); url.searchParams.set('format', 'detailed');
  const header = Buffer.from(JSON.stringify({ ReferenceText: input.text, GradingSystem: 'HundredMark', Granularity: 'Phoneme', Dimension: 'Comprehensive', EnableMiscue: true })).toString('base64');
  const controller = new AbortController(); let timedOut = false;
  const abort = () => controller.abort();
  if (signal && signal.aborted) abort(); else if (signal) signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, config.upstreamTimeoutMs || 35000);
  try {
    const response = await fetchImpl(url.href, { method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'Ocp-Apim-Subscription-Key': config.key, 'Pronunciation-Assessment': header, 'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000', Accept: 'application/json' }, body: input.audio });
    if (!response.ok) {
      if (response.body) await response.body.cancel().catch(() => {});
      if ([401, 403].includes(response.status)) throw new ServiceError(502, 'Azure rejected the credentials. Check the Speech key and matching region or endpoint on the server.');
      if (response.status === 429) throw new ServiceError(429, 'Azure is rate limited. Wait a moment before trying again.');
      throw new ServiceError(502, 'Azure could not process this assessment. Check the service configuration or try a fresh recording.');
    }
    return parseAzureResult(await readBoundedJson(response), input.locale);
  } catch (error) {
    if (timedOut) throw new ServiceError(504, 'The speech service timed out. Your recording remains in the studio.');
    if (signal && signal.aborted) throw new ServiceError(499, 'The assessment request was canceled.');
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(502, 'Could not connect to the speech service. Check the server network and Azure configuration.');
  } finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', abort); }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > MAX_BODY_BYTES) { req.resume(); reject(new ServiceError(413, 'Recording request exceeds the size limit.')); return; }
    let size = 0; const chunks = [];
    const timer = setTimeout(() => { cleanup(); req.resume(); reject(new ServiceError(408, 'Recording upload timed out.')); }, 10000);
    const cleanup = () => { clearTimeout(timer); req.off('data', onData); req.off('end', onEnd); req.off('aborted', onAbort); req.off('error', onError); };
    const onData = chunk => { size += chunk.length; if (size > MAX_BODY_BYTES) { cleanup(); req.resume(); reject(new ServiceError(413, 'Recording request exceeds the size limit.')); } else chunks.push(chunk); };
    const onEnd = () => {
      cleanup();
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (_) { reject(new ServiceError(400, 'Request body must be valid JSON.')); }
    };
    const onAbort = () => { cleanup(); reject(new ServiceError(400, 'Recording upload was interrupted.')); };
    const onError = () => { cleanup(); reject(new ServiceError(400, 'Recording upload failed.')); };
    req.on('data', onData); req.on('end', onEnd); req.on('aborted', onAbort); req.on('error', onError);
  });
}

function createHandler(config = readConfig(), { fetchImpl = fetch } = {}) {
  let active = 0;
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    const respond = (status, value) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value));
    };
    try {
      // Reject DNS rebinding and requests routed through arbitrary public host names.
      if (![ `127.0.0.1:${config.port}`, `localhost:${config.port}`, `[::1]:${config.port}` ].includes(req.headers.host)) throw new ServiceError(403, 'This service accepts local requests only.');
      const origin = req.headers.origin;
      if (origin && !config.origins.has(origin)) throw new ServiceError(403, 'Origin is not allowed. Add the exact studio origin to ALLOWED_ORIGINS on the server.');
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
      if (req.method === 'GET' && req.url === '/health') {
        return respond(200, { service: 'polybot-assessment', configured: Boolean(config.key && config.endpoint && config.origins.size), locales: config.locales });
      }
      if (!origin || !config.origins.size) throw new ServiceError(403, 'Set ALLOWED_ORIGINS to the exact extension or localhost studio origin.');
      if (req.url !== '/assess') throw new ServiceError(404, 'Route not found.');
      if (req.method === 'OPTIONS') {
        if (req.headers['access-control-request-method'] !== 'POST' || (req.headers['access-control-request-headers'] || '').split(',').some(header => header.trim() && header.trim().toLowerCase() !== 'content-type')) throw new ServiceError(403, 'Preflight request is not allowed.');
        res.setHeader('Access-Control-Allow-Methods', 'POST'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true');
        res.writeHead(204); res.end(); return;
      }
      if (req.method !== 'POST') throw new ServiceError(405, 'Use POST for pronunciation assessment.');
      if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new ServiceError(415, 'Use application/json for assessment requests.');
      if (active >= 2) throw new ServiceError(429, 'Two assessments are already running. Wait for one to finish.');
      active++;
      const controller = new AbortController(); const cancel = () => { if (!res.writableEnded) controller.abort(); };
      res.on('close', cancel);
      try {
        const input = validateAssessmentInput(await readBody(req), config.locales);
        respond(200, await performAssessment(input, config, fetchImpl, controller.signal));
      } finally { active--; res.off('close', cancel); }
    } catch (error) { respond(error instanceof ServiceError ? error.status : 500, { error: error instanceof ServiceError ? error.message : 'The local assessment service encountered an error.' }); }
  };
}

function startServer(env = process.env) {
  const config = readConfig(env); const server = http.createServer(createHandler(config));
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxHeadersCount = 30;
  server.listen(config.port, '127.0.0.1', () => {
    console.log(`Assessment bridge listening on http://127.0.0.1:${config.port}`);
    console.log(config.key && config.endpoint && config.origins.size ? 'Configured. Audio is sent to Azure only on an explicit assessment request.' : 'Setup incomplete. See server/README.md for credentials and allowed origins.');
  });
  return server;
}

module.exports = { SUPPORTED_LOCALES, MAX_BODY_BYTES, ServiceError, parseOrigins, readConfig, validateWav, validateAssessmentInput, parseAzureResult, performAssessment, createHandler, startServer };
if (require.main === module) {
  try { startServer().on('error', () => { console.error('Could not start the assessment bridge. Check the configured port and server setup.'); process.exitCode = 1; }); }
  catch (error) { console.error(error instanceof ServiceError ? error.message : 'Could not configure the assessment bridge.'); process.exitCode = 1; }
}
