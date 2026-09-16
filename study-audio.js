/* Browser audio and optional service adapters. No microphone or network access at import. */
(function (root) {
  'use strict';
  const MAX_SECONDS = 30;
  const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
  const ASSESSMENT_LOCALES = Object.freeze(['es-MX', 'es-ES']);
  const abortError = () => new DOMException('Operation canceled.', 'AbortError');

  function normalizeBaseUrl(value) {
    let url;
    try { url = new URL(String(value).trim()); } catch (_) { throw new Error('Enter a complete service URL.'); }
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash) {
      throw new Error('Use HTTPS or local HTTP, without credentials, query parameters, or a fragment.');
    }
    return url.href.replace(/\/+$/, '');
  }

  function requestAccess(baseUrl) {
    const url = new URL(normalizeBaseUrl(baseUrl));
    const permissions = root.chrome && root.chrome.permissions;
    if (!permissions) return Promise.resolve(true);
    // Invoke permissions.request synchronously while the calling click still has user activation.
    return new Promise((resolve, reject) => {
      permissions.request({ origins: [`${url.protocol}//${url.hostname}/*`] }, granted => {
        const error = root.chrome.runtime && root.chrome.runtime.lastError;
        if (error) reject(new Error(error.message)); else resolve(Boolean(granted));
      });
    });
  }

  function scopeSignal(signal, timeoutMs) {
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort(signal.reason);
    if (signal && signal.aborted) onAbort();
    else if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    return {
      signal: controller.signal,
      timedOut: () => timedOut,
      dispose() { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); }
    };
  }

  async function boundedResponse(response, limit) {
    if (Number(response.headers.get('content-length')) > limit) throw new Error('Service response is too large.');
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader();
    const chunks = []; let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > limit) throw new Error('Service response is too large.');
        chunks.push(value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  }

  async function serviceJson(url, options, label) {
    let response;
    try { response = await root.fetch(url, { credentials: 'omit', redirect: 'error', cache: 'no-store', ...options }); }
    catch (error) {
      if (options.signal && options.signal.aborted) throw abortError();
      throw new Error(`Cannot reach ${label}. Check its URL, that it is running, and browser access permissions.`);
    }
    if (!response.ok) {
      if (label === 'assessment bridge') {
        const bytes = await boundedResponse(response, 8192);
        try {
          const data = JSON.parse(new TextDecoder().decode(bytes));
          if (data && typeof data.error === 'string') throw new Error(data.error.slice(0, 400));
        } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      }
      throw new Error(`${label} returned HTTP ${response.status}. Check the service configuration.`);
    }
    const bytes = await boundedResponse(response, 1024 * 1024);
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch (_) { throw new Error(`${label} returned an invalid JSON response.`); }
  }

  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(abortError());
      const abort = () => { clearTimeout(timer); reject(abortError()); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  async function listVoiceboxProfiles(baseUrl) {
    const base = normalizeBaseUrl(baseUrl); const scope = scopeSignal(null, 15000);
    try {
      const data = await serviceJson(`${base}/profiles`, { signal: scope.signal }, 'Voicebox');
      const profiles = Array.isArray(data) ? data : data && (data.profiles || data.items);
      if (!Array.isArray(profiles)) throw new Error('Voicebox did not return a profile list.');
      return profiles.slice(0, 500).filter(p => p && typeof p.id === 'string' && p.id.length <= 200)
        .map(p => ({ id: p.id, name: String(p.name || p.id).slice(0, 200) }));
    } catch (error) { if (scope.timedOut()) throw new Error('Voicebox connection timed out.'); throw error; }
    finally { scope.dispose(); }
  }

  async function blobToDataUrl(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return `data:${blob.type || 'audio/wav'};base64,${root.btoa(binary)}`;
  }

  function validText(text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 1000) throw new Error('Enter a phrase between 1 and 1,000 characters.');
    return text.trim();
  }

  async function generateVoicebox({ baseUrl, profileId, text, signal } = {}) {
    const base = normalizeBaseUrl(baseUrl); text = validText(text);
    if (typeof profileId !== 'string' || !profileId.trim() || profileId.length > 200) throw new Error('Choose a Voicebox profile.');
    const scope = scopeSignal(signal, 120000);
    try {
      let generation = await serviceJson(`${base}/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: scope.signal,
        body: JSON.stringify({ text, profile_id: profileId, language: 'es' })
      }, 'Voicebox');
      const id = generation && (generation.id || generation.generation_id);
      if (typeof id !== 'string' || !id || id.length > 200) throw new Error('Voicebox did not return a generation ID.');
      while (generation.status && !['completed', 'complete', 'success', 'succeeded'].includes(generation.status)) {
        if (['failed', 'error', 'canceled', 'cancelled'].includes(generation.status)) throw new Error('Voicebox generation failed. Check the selected profile and Spanish support in Voicebox.');
        await delay(1200, scope.signal);
        generation = await serviceJson(`${base}/history/${encodeURIComponent(id)}`, { signal: scope.signal }, 'Voicebox');
        if (!generation || typeof generation !== 'object' || Array.isArray(generation)) throw new Error('Voicebox returned invalid generation status.');
      }
      const response = await root.fetch(`${base}/history/${encodeURIComponent(id)}/export-audio`, {
        signal: scope.signal, credentials: 'omit', redirect: 'error', cache: 'no-store'
      });
      if (!response.ok) throw new Error(`Voicebox audio export returned HTTP ${response.status}.`);
      const mime = (response.headers.get('content-type') || '').split(';')[0].toLowerCase().trim();
      if (!/^audio\/[a-z0-9.+-]+$/.test(mime)) throw new Error('Voicebox export was not an audio file.');
      const bytes = await boundedResponse(response, MAX_AUDIO_BYTES);
      if (bytes.byteLength < 44) throw new Error('Voicebox returned an empty audio file.');
      return { audioUrl: await blobToDataUrl(new Blob([bytes], { type: mime })) };
    } catch (error) {
      if (scope.timedOut()) throw new Error('Voicebox timed out after two minutes. Check generation progress in Voicebox before retrying.');
      if (scope.signal.aborted) throw abortError();
      throw error;
    } finally { scope.dispose(); }
  }

  async function decode(audioUrl) {
    if (typeof audioUrl !== 'string' || !/^data:audio\/[a-z0-9.+-]+(?:;[^,]*)?;base64,/i.test(audioUrl) || audioUrl.length > MAX_AUDIO_BYTES * 1.38) {
      throw new Error('Choose a saved audio recording under 12 MB.');
    }
    const Context = root.AudioContext || root.webkitAudioContext;
    if (!Context) throw new Error('Audio analysis is not available in this browser.');
    const context = new Context();
    try {
      const data = audioUrl.slice(audioUrl.indexOf(',') + 1);
      const binary = root.atob(data);
      const buffer = Uint8Array.from(binary, char => char.charCodeAt(0)).buffer;
      const decoded = await context.decodeAudioData(buffer);
      if (!decoded.length || !Number.isFinite(decoded.duration) || decoded.duration > 180) throw new Error('Use an audio clip no longer than three minutes.');
      return decoded;
    } catch (error) {
      if (error.message && error.message.includes('three minutes')) throw error;
      throw new Error('This audio could not be decoded. Try a WAV, MP3, OGG, or WebM audio file.');
    } finally { await context.close().catch(() => {}); }
  }

  function mixToMono(buffer) {
    const mono = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let i = 0; i < mono.length; i++) mono[i] += samples[i] / buffer.numberOfChannels;
    }
    return mono;
  }

  // Energy-based activity estimate, not speech recognition. Background noise affects these metrics.
  function analyzeSamples(samples, sampleRate) {
    if (!samples || !samples.length || !Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('Audio samples are empty or invalid.');
    const frameSize = Math.max(1, Math.round(sampleRate * 0.02));
    const frames = []; let squared = 0; let clipped = 0;
    for (let offset = 0; offset < samples.length; offset += frameSize) {
      let frameEnergy = 0; const end = Math.min(samples.length, offset + frameSize);
      for (let i = offset; i < end; i++) {
        const value = Number.isFinite(samples[i]) ? samples[i] : 0;
        frameEnergy += value * value;
        if (Math.abs(value) >= 0.99) clipped++;
      }
      squared += frameEnergy;
      frames.push({ rms: Math.sqrt(frameEnergy / (end - offset)), length: end - offset });
    }
    const peak = frames.reduce((max, frame) => Math.max(max, frame.rms), 0);
    const threshold = Math.max(0.008, peak * 0.08);
    let activeSamples = 0; let pauseSamples = 0; let pauseCount = 0; let heardActivity = false;
    for (const frame of frames) {
      if (frame.rms >= threshold) {
        if (heardActivity && pauseSamples / sampleRate >= 0.18) pauseCount++;
        heardActivity = true; pauseSamples = 0; activeSamples += frame.length;
      } else if (heardActivity) pauseSamples += frame.length;
    }
    return { duration: samples.length / sampleRate, activeDuration: activeSamples / sampleRate,
      pauseCount, rms: Math.sqrt(squared / samples.length), clippingRatio: clipped / samples.length };
  }

  async function analyze(audioUrl) {
    const buffer = await decode(audioUrl);
    return analyzeSamples(mixToMono(buffer), buffer.sampleRate);
  }

  function compareMetrics(reference, attempt) {
    const paceRatio = reference.activeDuration > 0 && attempt.activeDuration > 0 ? attempt.activeDuration / reference.activeDuration : null;
    const tips = ['Timing comparison only: activity and pauses are estimated from audio volume, not pronunciation, accent, or intonation.'];
    if (attempt.rms < 0.008) tips.push('This recording is very quiet. Move closer to the microphone and try again.');
    if (attempt.clippingRatio > 0.01) tips.push('The recording may be distorted. Move slightly away from the microphone.');
    if (paceRatio && paceRatio > 1.25) tips.push('Your audible delivery lasted longer than the reference. Replay both and compare where you paused.');
    if (paceRatio && paceRatio < 0.8) tips.push('Your audible delivery was shorter than the reference. Listen for any rushed or missing sections.');
    if (attempt.pauseCount > reference.pauseCount) tips.push('More quiet gaps were detected in your attempt. Listen to how the reference connects the phrase.');
    return { reference, attempt, paceRatio, tips };
  }

  async function compare(referenceUrl, attemptUrl) {
    const [reference, attempt] = await Promise.all([analyze(referenceUrl), analyze(attemptUrl)]);
    return compareMetrics(reference, attempt);
  }

  function encodeWav(samples, sampleRate = 16000) {
    const buffer = new ArrayBuffer(44 + samples.length * 2); const view = new DataView(buffer);
    const write = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    write(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); write(8, 'WAVE'); write(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const sample = Math.max(-1, Math.min(1, Number.isFinite(samples[i]) ? samples[i] : 0));
      view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  async function toWav(audioUrl) {
    const decoded = await decode(audioUrl);
    if (decoded.duration > MAX_SECONDS) throw new Error('Assessment accepts recordings up to 30 seconds. Record a shorter phrase.');
    const OfflineContext = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!OfflineContext) throw new Error('Audio conversion is not available in this browser.');
    const context = new OfflineContext(1, Math.max(1, Math.ceil(decoded.duration * 16000)), 16000);
    const source = context.createBufferSource(); source.buffer = decoded; source.connect(context.destination); source.start();
    const rendered = await context.startRendering();
    return encodeWav(rendered.getChannelData(0));
  }

  async function assess({ audioUrl, text, accentId, endpoint, signal } = {}) {
    if (!ASSESSMENT_LOCALES.includes(accentId)) throw new Error('Azure assessment currently supports es-MX and es-ES. This accent can still be practiced using recording and playback.');
    const base = normalizeBaseUrl(endpoint); text = validText(text);
    if (signal && signal.aborted) throw abortError();
    const wav = await toWav(audioUrl);
    if (signal && signal.aborted) throw abortError();
    const dataUrl = await blobToDataUrl(wav); const scope = scopeSignal(signal, 45000);
    try {
      const result = await serviceJson(`${base}/assess`, {
        method: 'POST', signal: scope.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64: dataUrl.slice(dataUrl.indexOf(',') + 1), text, locale: accentId })
      }, 'assessment bridge');
      if (!result || result.provider !== 'azure' || result.locale !== accentId || !Array.isArray(result.words) || !Array.isArray(result.limitations)) {
        throw new Error('The assessment bridge returned an incompatible response.');
      }
      return result;
    } catch (error) { if (scope.timedOut()) throw new Error('Assessment timed out. Your recording is still saved locally.'); throw error; }
    finally { scope.dispose(); }
  }

  function createRecorder({ onLevel, onAutoStop, onError, maxSeconds = MAX_SECONDS } = {}) {
    const limit = Math.min(MAX_SECONDS, Math.max(1, Number(maxSeconds) || MAX_SECONDS));
    let recorder, stream, context, levelTimer, stopTimer, chunks, startedAt, startPromise, finishPromise;
    let resolveFinish, rejectFinish, canceled = false, result, failure, stopping = false;
    const safeCallback = (fn, value) => { if (typeof fn === 'function') { try { fn(value); } catch (_) { /* UI callbacks cannot leak the microphone. */ } } };
    const cleanup = () => {
      clearInterval(levelTimer); clearTimeout(stopTimer);
      if (stream) stream.getTracks().forEach(track => track.stop());
      if (context) { context.close().catch(() => {}); context = null; }
      safeCallback(onLevel, 0);
    };
    const fail = error => { failure = error; cleanup(); if (rejectFinish) rejectFinish(error); safeCallback(onError, error); };
    function start() {
      if (startPromise) return startPromise;
      if (canceled) return Promise.reject(abortError());
      startPromise = (async () => {
        if (!root.navigator || !root.navigator.mediaDevices || !root.MediaRecorder) throw new Error('Microphone recording requires a supported browser and a secure page.');
        try {
          stream = await root.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
          if (canceled) { cleanup(); throw abortError(); }
          const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find(type => root.MediaRecorder.isTypeSupported(type));
          recorder = new root.MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
          chunks = [];
          finishPromise = new Promise((resolve, reject) => { resolveFinish = resolve; rejectFinish = reject; });
          finishPromise.catch(() => {}); // Auto-stop and device errors can precede a user stop call.
          recorder.ondataavailable = event => { if (event.data && event.data.size) chunks.push(event.data); };
          recorder.onerror = () => fail(new Error('Microphone recording failed. Check your input device and try again.'));
          recorder.onstop = async () => {
            const duration = Math.max(0, (performance.now() - startedAt) / 1000);
            const stoppedByDevice = !stopping;
            cleanup();
            if (canceled) { rejectFinish(abortError()); return; }
            if (failure) return;
            try {
              const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
              if (blob.size < 100 || duration < 0.15) throw new Error('No usable audio was recorded. Hold the recording for a moment and try again.');
              result = { blob, audioUrl: await blobToDataUrl(blob), duration }; resolveFinish(result);
              if (stoppedByDevice) safeCallback(onAutoStop, result);
            } catch (error) { fail(error); }
          };
          recorder.start(200); startedAt = performance.now();
          const Context = root.AudioContext || root.webkitAudioContext;
          if (Context && onLevel) {
            try {
              context = new Context(); const source = context.createMediaStreamSource(stream); const analyser = context.createAnalyser();
              analyser.fftSize = 512; source.connect(analyser); const samples = new Float32Array(analyser.fftSize);
              context.resume().catch(() => {});
              levelTimer = setInterval(() => { analyser.getFloatTimeDomainData(samples); const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length); safeCallback(onLevel, Math.min(1, rms * 4)); }, 60);
            } catch (_) { /* Recording remains available when metering is unavailable. */ }
          }
          // Finish before the strict 30 s assessment bound; container duration can have codec padding.
          stopTimer = setTimeout(() => { stop().then(recording => safeCallback(onAutoStop, recording)).catch(() => {}); }, Math.max(500, limit * 1000 - 250));
        } catch (error) {
          cleanup();
          if (error.name === 'NotAllowedError') throw new Error('Microphone access was denied. Allow the microphone for this page and try again.');
          if (error.name === 'NotFoundError') throw new Error('No microphone was found. Connect an input device and try again.');
          throw error;
        }
      })();
      return startPromise;
    }
    async function stop() {
      if (!startPromise) throw new Error('Start a recording first.');
      await startPromise;
      if (failure) throw failure;
      if (result) return result;
      if (!stopping && recorder.state !== 'inactive') {
        stopping = true;
        try { recorder.stop(); } catch (_) { fail(new Error('The microphone could not finish recording. Check the input device and try again.')); }
        cleanup();
      }
      return finishPromise;
    }
    function cancel() {
      canceled = true;
      if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch (_) {} }
      cleanup();
      if (rejectFinish) rejectFinish(abortError());
    }
    return { start, stop, cancel };
  }

  const api = { createRecorder, analyze, compare, toWav, listVoiceboxProfiles, generateVoicebox, requestAccess, assess, ASSESSMENT_LOCALES };
  root.StudioAudio = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = { ...api, _test: { normalizeBaseUrl, analyzeSamples, compareMetrics, encodeWav, mixToMono, boundedResponse } };
})(typeof window !== 'undefined' ? window : globalThis);
