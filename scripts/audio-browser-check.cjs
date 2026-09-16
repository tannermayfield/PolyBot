'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPreviewServer } = require('./preview.cjs');
const { _test } = require('../study-audio.js');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
async function main() {
  const output = path.resolve(__dirname, '..', 'test-results'); fs.mkdirSync(output, { recursive: true });
  const samples = Float32Array.from({ length: 16000 * 5 }, (_, i) => Math.sin(i * Math.PI * 2 * 240 / 16000) * (i % 16000 < 12000 ? 0.2 : 0));
  const wav = await _test.encodeWav(samples).arrayBuffer();
  const fixture = path.join(output, 'synthetic-microphone.wav'); fs.writeFileSync(fixture, Buffer.from(wav));
  const server = createPreviewServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}),
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${fixture}`] });
    const context = await browser.newContext({ permissions: ['microphone'] });
    const page = await context.newPage();
    await page.route(origin + '/audio-harness', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><h1>Audio verification</h1><script src="/study-audio.js"></script></body></html>' }));
    await page.goto(origin + '/audio-harness');
    const result = await page.evaluate(async reference => {
      let levels = 0; const streams = []; const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => { const stream = await nativeGetUserMedia(constraints); streams.push(stream); return stream; };
      const recorder = StudioAudio.createRecorder({ onLevel: value => { if (value > 0) levels++; } });
      await recorder.start(); await new Promise(resolve => setTimeout(resolve, 1450));
      const recorded = await recorder.stop(); const duplicate = await recorder.stop();
      const metrics = await StudioAudio.analyze(recorded.audioUrl);
      const comparison = await StudioAudio.compare(reference, recorded.audioUrl);
      const wav = await StudioAudio.toWav(recorded.audioUrl); const view = new DataView(await wav.arrayBuffer());
      const automatic = await new Promise(async (resolve, reject) => {
        const rec = StudioAudio.createRecorder({ maxSeconds: 1, onAutoStop: resolve, onError: reject });
        try { await rec.start(); } catch (error) { reject(error); }
      });
      const canceled = StudioAudio.createRecorder(); const pending = canceled.start(); canceled.cancel();
      let cancellation = false; try { await pending; } catch (error) { cancellation = error.name === 'AbortError'; }
      return { duration: recorded.duration, bytes: recorded.blob.size, levels, metrics, duplicate: duplicate.audioUrl === recorded.audioUrl,
        rate: view.getUint32(24, true), channels: view.getUint16(22, true), comparison: comparison.tips,
        automaticDuration: automatic.duration, cancellation, allTracksEnded: streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')) };
    }, 'data:audio/wav;base64,' + Buffer.from(wav).toString('base64'));
    assert.ok(result.duration > 1 && result.duration < 3);
    assert.ok(result.bytes > 100 && result.levels > 0 && result.metrics.rms > 0);
    assert.equal(result.duplicate, true);
    assert.equal(result.rate, 16000); assert.equal(result.channels, 1);
    assert.ok(result.automaticDuration > 0 && result.automaticDuration < 2);
    assert.equal(result.cancellation, true); assert.equal(result.allTracksEnded, true);
    assert.match(result.comparison.join(' '), /Timing comparison only/);
    console.log('Native Chromium audio checks passed: recording, levels, analysis, comparison, WAV conversion, auto-stop, cancellation, and released microphone tracks.');
  } finally { if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
