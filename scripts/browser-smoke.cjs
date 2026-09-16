'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPreviewServer } = require('./preview.cjs');
const { _test } = require('../study-audio.js');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  const output = path.resolve(__dirname, '..', 'test-results'); fs.mkdirSync(output, { recursive: true });
  const samples = Float32Array.from({ length: 16000 * 4 }, (_, i) => Math.sin(i * Math.PI * 2 * 240 / 16000) * (i % 16000 < 12000 ? 0.2 : 0));
  const wav = Buffer.from(await (await _test.encodeWav(samples)).arrayBuffer());
  const fixture = path.join(output, 'synthetic-microphone.wav'); fs.writeFileSync(fixture, wav);
  const server = createPreviewServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}),
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${fixture}`, '--autoplay-policy=no-user-gesture-required'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, permissions: ['microphone'], reducedMotion: 'reduce' });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin); await page.locator('.hero').waitFor();
    assert.equal(await page.locator('h1').innerText(), 'A little closer to fluent.');
    const initial = await page.evaluate(() => StudioData.load()); assert.equal(initial.attempts.length, 0);
    await page.screenshot({ path: path.join(output, 'studio-today.png'), fullPage: true });

    // Create through the visible form, including an actual audio-file import.
    await page.locator('[data-action="new-phrase"]').first().click();
    await page.locator('#phrase-text').fill('Hola, ¿cómo estás?');
    await page.locator('#phrase-meaning').fill('Hello, how are you?');
    await page.locator('#phrase-audio').setInputFiles({ name: 'native-reference-test.wav', mimeType: 'audio/wav', buffer: wav });
    await page.evaluate(() => {
      const original = StudioData.addReference;
      StudioData.addReference = (...args) => { StudioData.addReference = original; throw new Error('Simulated storage failure'); };
    });
    await page.getByRole('button', { name: 'Save phrase', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#form-error')?.textContent.includes('Your phrase is saved'));
    assert.ok(await page.locator('#phrase-id').inputValue(), 'Partial save should retain its phrase ID for retry');
    await page.getByRole('button', { name: 'Save phrase', exact: true }).click();
    await page.locator('#editor-dialog').waitFor({ state: 'hidden' });
    const phrase = await page.evaluate(async () => (await StudioData.load()).phrases.find(p => p.text === 'Hola, ¿cómo estás?'));
    assert.ok(phrase && phrase.references.length === 1);
    assert.equal(await page.evaluate(async () => (await StudioData.load()).phrases.filter(p => p.text === 'Hola, ¿cómo estás?').length), 1);
    await page.goto(`${origin}/studio.html?phrase=${encodeURIComponent(phrase.id)}#practice`);
    await page.locator('#record-button').waitFor();
    await page.locator('#practice-reference').selectOption(phrase.references[0].id);
    await page.locator('#playback-speed').selectOption('0.75');
    await page.locator('[data-action="play-reference"]').click();
    await page.locator('[data-action="toggle-loop"]').click();
    await page.locator('[data-action="stop-audio"]').click();
    assert.equal(await page.locator('#toast.error:visible').count(), 0, 'Normal playback cancellation should be quiet');
    await page.screenshot({ path: path.join(output, 'studio-practice.png'), fullPage: true });
    await page.locator('.segment-editor summary').click();
    await page.locator('#segment-start').fill('0.5');
    await page.locator('#segment-end').fill('2');
    await page.locator('#segment-text').fill('Hola');
    await page.locator('#record-button').click();
    assert.match(await page.locator('#toast').innerText(), /Confirm that the practice text/);
    await page.locator('#segment-confirm').check();
    await page.locator('#record-button').click();
    await page.getByRole('button', { name: 'Finish recording', exact: true }).waitFor();
    await page.waitForTimeout(1250);
    await page.locator('#record-button').click();
    await page.locator('[aria-label="Compare your recording"]').waitFor();
    const first = await page.evaluate(async () => (await StudioData.load()).attempts.at(-1));
    assert.equal(first.text, 'Hola'); assert.equal(first.referenceSnapshot.audioUrl, phrase.references[0].audioUrl);
    assert.equal(first.referenceSnapshot.start, 0.5); assert.equal(first.referenceSnapshot.end, 2);
    assert.ok(first.duration > 0.8);
    await page.locator('[data-action="play-attempt-reference"]').click();
    await page.locator('[data-action="play-attempt"]').first().click();
    await page.locator('[data-action="compare-timing"]').click();
    await page.getByRole('heading', { name: 'Timing & recording quality' }).waitFor();
    await page.locator('[data-action="rate-speaking"][data-rating="good"]').click();
    await page.waitForFunction(async id => Boolean((await StudioData.load()).reviews['speaking:' + id]), phrase.id);

    // Test mode hides the reference even when this phrase has previous attempts.
    await page.locator('[data-action="mode"][data-mode="test"]').click();
    await page.locator('.practice-empty-test').waitFor();
    assert.equal(await page.locator('[data-action="play-reference"]').count(), 0);
    await page.locator('#record-button').click();
    await page.getByRole('button', { name: 'Finish recording', exact: true }).waitFor();
    await page.waitForTimeout(1000); await page.locator('#record-button').click();
    await page.locator('[aria-label="Compare your recording"]').waitFor();
    const second = await page.evaluate(async () => (await StudioData.load()).attempts.at(-1));
    assert.equal(second.mode, 'test'); assert.notEqual(second.id, first.id);

    // Assessment is opt-in and sends the immutable segment transcript only on request.
    let assessmentCalls = 0;
    await page.route('http://127.0.0.1:17494/**', async route => {
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      assessmentCalls++;
      const body = route.request().postDataJSON(); assert.equal(body.text, 'Hola'); assert.equal(body.locale, 'es-MX'); assert.ok(body.audioBase64);
      return route.fulfill({ headers, json: { provider: 'azure', locale: 'es-MX', transcript: 'Hola', accuracy: 82, fluency: 80, completeness: 100, words: [{ word: 'Hola', accuracy: 82, errorType: 'None' }], tips: [], limitations: ['Synthetic test response; not an actual speech assessment.'] } });
    });
    await page.locator('[data-action="assess-attempt"]').click();
    await page.locator('#assessment-enabled').check();
    await page.locator('#settings-theme').selectOption('dark');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.locator('#editor-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.equal(await page.evaluate(() => (getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())), '#17161d');
    await page.locator('[data-action="open-settings"]').click();
    assert.equal(await page.locator('#settings-theme').inputValue(), 'dark');
    await page.screenshot({ path: path.join(output, 'studio-settings-dark.png'), fullPage: true });
    await page.locator('[data-action="close-dialog"]').first().click();
    assert.equal(assessmentCalls, 0);
    await page.locator('[data-action="assess-attempt"]').click();
    await page.waitForFunction(async id => Boolean((await StudioData.load()).attempts.find(a => a.id === id)?.assessment), second.id);
    assert.equal(assessmentCalls, 1);

    // Existing vocabulary creates real flashcards; meaning reviews do not mark speaking mastered.
    await page.evaluate(() => {
      localStorage.setItem('sptubeVocabulary_es', JSON.stringify({ hola: 'learning', desconocido: 'learning' }));
      localStorage.setItem('sptubeDefinitions_es', JSON.stringify({ hola: [{ matched: 'hello', translation: 'hello', sentence: 'Hola, amiga.' }] }));
    });
    await page.goto(origin + '/studio.html#review'); await page.locator('[data-action="reveal-card"]').waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark', 'Theme should persist after navigation');
    assert.equal(await page.locator('.flashcard-word').innerText(), 'hola');
    await page.locator('[data-action="reveal-card"]').click(); assert.equal(await page.locator('.flashcard-meaning').innerText(), 'hello');
    await page.locator('[data-action="rate-card"][data-rating="good"]').click();
    await page.waitForFunction(async () => Boolean((await StudioData.load()).reviews['meaning:es:hola']));
    const reviews = await page.evaluate(async () => (await StudioData.load()).reviews);
    assert.ok(reviews['speaking:' + phrase.id]); assert.equal(reviews['speaking:es:hola'], undefined);

    // Mock provider traffic only: exercise the real client and visible connect/generate actions.
    await page.route('http://127.0.0.1:17493/**', async route => {
      const url = new URL(route.request().url()); const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (url.pathname === '/profiles') return route.fulfill({ json: [{ id: 'test-voice', name: 'Test reference' }], headers });
      if (url.pathname === '/generate') { const body = route.request().postDataJSON(); assert.equal(body.language, 'es'); return route.fulfill({ json: { id: 'test-generation', status: 'completed' }, headers }); }
      if (url.pathname.endsWith('/export-audio')) return route.fulfill({ contentType: 'audio/wav', body: wav, headers });
      return route.fulfill({ status: 404, headers });
    });
    await page.locator('nav a[data-page="voices"]').click();
    await page.locator('#voicebox-url').fill('http://127.0.0.1:17493');
    await page.locator('#voice-connect-form button[type="submit"]').click();
    await page.locator('#profile-name-0').waitFor(); await page.locator('#profile-accent-0').selectOption('es-AR');
    await page.locator('[data-action="save-profile"]').first().click();
    await page.waitForFunction(async () => (await StudioData.load()).voices.length === 1);
    await page.goto(`${origin}/studio.html?phrase=${encodeURIComponent(phrase.id)}#practice`);
    await page.locator('#generate-button').click();
    await page.waitForFunction(async id => (await StudioData.load()).phrases.find(p => p.id === id).references.length === 2, phrase.id);

    // Dialog export/import, persistence, responsive layout, and safe rendering.
    await page.locator('[data-action="open-settings"]').click();
    const downloadPromise = page.waitForEvent('download'); await page.locator('[data-action="export-backup"]').click();
    const download = await downloadPromise; const backupPath = path.join(output, 'studio-test-backup.json'); await download.saveAs(backupPath);
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8')); assert.equal(backup.format, 'gift-of-tongues-studio');
    await page.locator('#backup-file').setInputFiles(backupPath);
    await page.locator('#editor-dialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(async id => (await StudioData.load()).attempts.some(a => a.id === id), first.id);
    await page.goto(origin + '/studio.html#progress'); await page.locator('.progress-table').waitFor();
    for (const route of ['today','practice','library','voices','review','progress']) {
      await page.goto(`${origin}/studio.html#${route}`); await page.waitForFunction(() => !document.querySelector('.loading-state'));
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark', `Dark mode should cover ${route}`);
    }
    assert.equal(await page.locator('.progress-table tbody tr').count(), 2);
    await page.screenshot({ path: path.join(output, 'studio-progress.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin); await page.locator('.hero').waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile layout overflows horizontally');
    await page.screenshot({ path: path.join(output, 'studio-mobile.png'), fullPage: true });
    const restoreContext = await browser.newContext();
    const restorePage = await restoreContext.newPage();
    await restorePage.goto(origin); await restorePage.locator('.hero').waitFor();
    await restorePage.locator('[data-action="open-settings"]').click();
    await restorePage.locator('#backup-file').setInputFiles(backupPath);
    await restorePage.locator('#editor-dialog').waitFor({ state: 'hidden' });
    const restored = await restorePage.evaluate(() => StudioData.load());
    assert.equal(restored.attempts.length, 2);
    assert.equal(restored.attempts.find(a => a.id === first.id).audioUrl, first.audioUrl);
    assert.equal(restored.phrases.find(p => p.id === phrase.id).references.length, 2);
    assert.equal(restored.settings.theme, 'dark');
    await restorePage.locator('[data-action="open-settings"]').click();
    await restorePage.locator('#settings-theme').selectOption('system');
    await restorePage.getByRole('button', { name: 'Save settings', exact: true }).click();
    await restorePage.emulateMedia({ colorScheme: 'light' });
    await restorePage.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await restorePage.emulateMedia({ colorScheme: 'dark' });
    await restorePage.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await restoreContext.close();
    assert.deepEqual(errors, []);
    console.log('Studio browser smoke passed: phrase/audio import, playback/loop/speed, segment validation and snapshots, native mic recordings, A/B comparison, timing, self-rating, test mode, opt-in mocked assessment, vocabulary reviews, mocked Voicebox, backup export/restore, dark/system theme persistence, and mobile layout.');
  } finally { if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
