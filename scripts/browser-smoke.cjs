'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPreviewServer } = require('./preview.cjs');
const { _test } = require('../study-audio.js');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  const output = path.resolve(__dirname, '..', 'test-results');
  fs.mkdirSync(output, { recursive: true });
  const samples = Float32Array.from({ length: 16000 * 4 }, (_, i) => Math.sin(i * Math.PI * 2 * 240 / 16000) * (i % 16000 < 12000 ? 0.2 : 0));
  const wav = Buffer.from(await (await _test.encodeWav(samples)).arrayBuffer());
  const fixture = path.join(output, 'synthetic-microphone.wav');
  fs.writeFileSync(fixture, wav);
  const server = createPreviewServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}),
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${fixture}`, '--autoplay-policy=no-user-gesture-required']
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, permissions: ['microphone'], reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    // Home leads with the course and keeps real progress graphics directly below it.
    await page.goto(origin);
    await page.locator('.home-path').waitFor();
    assert.equal(await page.locator('.mastery-card').count(), 3);
    await page.getByRole('link', { name: 'Continue My Path' }).click();
    await page.locator('.path-hero').waitFor();
    assert.equal(await page.locator('.path-hero h2').innerText(), 'Build the whole language, one useful step at a time.');
    assert.deepEqual(await page.locator('#navigation a[data-page]').evaluateAll(nodes => nodes.map(node => node.dataset.page)), ['my-path', 'personalization', 'vocabulary', 'grammar', 'pronunciation', 'media']);
    assert.equal((await page.locator('.resource-nav-label').innerText()).trim(), 'EXPLORE RESOURCES');
    assert.equal(await page.locator('#navigation > :first-child').getAttribute('data-page'), 'my-path');
    assert.match(await page.locator('.path-hero').innerText(), /AI-assisted lesson builder is planned/i);

    // Seed the existing extension stores so every resource area uses real saved data.
    await page.evaluate(() => {
      localStorage.setItem('sptubeVocabulary_es', JSON.stringify({ hola: 'learning', mundo: 'known' }));
      localStorage.setItem('sptubeDefinitions_es', JSON.stringify({
        hola: [{ matched: 'hello', translation: 'hello', sentence: 'Hola, amiga.', savedAt: Date.now() }],
        mundo: [{ matched: 'world', translation: 'world', sentence: 'Hola, mundo.', savedAt: Date.now() }]
      }));
      localStorage.setItem('sptubePhrases_es', JSON.stringify([{
        id: 'media-seed', savedTranslation: 'La práctica abre puertas.', english: 'Practice opens doors.',
        source: 'web', sourceUrl: 'https://example.com/spanish', savedAt: Date.now()
      }]));
    });
    await page.reload();
    await page.locator('.path-hero').waitFor();
    assert.match(await page.locator('.skill-balance').textContent(), /Saved words\s*2/);
    await page.screenshot({ path: path.join(output, 'learning-my-path.png'), fullPage: true });

    // Vocabulary begins with a bilingual dictionary, separates saved-word views, and
    // keeps the practice choices in their own section.
    await page.locator('#navigation a[data-page="vocabulary"]').click();
    await page.locator('#dictionary-form').waitFor();
    assert.equal(await page.locator('.dictionary-card .eyebrow').innerText(), 'BILINGUAL DICTIONARY');
    assert.equal(await page.locator('.dictionary-card h2').innerText(), 'English ↔ Spanish');
    assert.deepEqual(await page.locator('.vocab-home-section > h2').allInnerTexts(), ['My Vocabulary', 'Practice Vocabulary']);
    assert.equal(await page.locator('[data-action="dictionary-direction"]').count(), 0);
    assert.equal(await page.locator('#dictionary-term').getAttribute('placeholder'), 'Search in English or Spanish…');
    await page.locator('#dictionary-term').fill('hola');
    await page.locator('#dictionary-form button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('#dictionary-result')?.textContent.includes('hello'));
    assert.match(await page.locator('#dictionary-result').innerText(), /Saved vocabulary/);
    await page.locator('[data-action="resource-view"][data-view="words"]').click();
    assert.equal(await page.locator('.vocab-resource-grid').getAttribute('aria-label'), 'All My Words');
    assert.equal(await page.locator('.vocab-resource-grid > section > .section-head').count(), 0);
    assert.match(await page.locator('.vocab-resource-grid').innerText(), /hola/);
    assert.match(await page.locator('.vocab-resource-grid').innerText(), /mundo/);
    await page.locator('[data-action="resource-home"]').click();
    await page.locator('[data-action="resource-view"][data-view="lists"]').click();
    assert.equal(await page.locator('.vocab-lists-view').getAttribute('aria-label'), 'My Vocab Lists');
    assert.equal(await page.locator('.vocab-lists-view > .section-head').count(), 0);
    assert.deepEqual(await page.locator('.vocab-list-collections h3').allInnerTexts(), ['Learning', 'Known']);
    assert.match(await page.locator('.vocab-list-collections > section').nth(0).innerText(), /hola/);
    assert.match(await page.locator('.vocab-list-collections > section').nth(1).innerText(), /mundo/);
    await page.locator('[data-action="resource-home"]').click();
    await page.getByRole('button', { name: /Meaning Cards/i }).click();
    await page.locator('[data-action="reveal-learning-word"]').click();
    assert.equal(await page.locator('.practice-panel .flashcard-meaning').innerText(), 'hello');
    await page.locator('[data-action="rate-learning-word"][data-rating="good"]').click();
    await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('Meaning review scheduled'));
    await page.screenshot({ path: path.join(output, 'learning-vocabulary.png'), fullPage: true });

    // Grammar exposes every principle directly in three difficulty groups.
    await page.locator('#navigation a[data-page="grammar"]').click();
    await page.locator('.level-section').first().waitFor();
    assert.equal(await page.locator('[data-action=grammar-level]').count(), 0);
    assert.deepEqual(await page.locator('.level-section .level-heading h2').allInnerTexts(), ['Beginner', 'Intermediate', 'Advanced']);
    assert.equal(await page.locator('.level-section').count(), 3);
    assert.equal(await page.locator('.topic-card').count(), 25);
    assert.deepEqual(await page.locator('.level-section').evaluateAll(nodes => nodes.map(node => node.querySelectorAll('.topic-card').length)), [10,10,5]);
    const grammarButton = page.locator('[data-action="open-grammar-practice"]').first();
    const grammarId = await grammarButton.getAttribute('data-id');
    await grammarButton.click();
    await page.locator('#grammar-practice-response').fill('I noticed the pattern, transformed an example, and wrote one about my day.');
    await page.locator(`[data-action="complete-grammar"][data-id="${grammarId}"]`).click();
    await page.waitForFunction(async id => (await LearningData.load()).grammarTopics.find(item => item.id === id)?.completed, grammarId);
    await page.locator('[data-action=close-grammar-practice]').first().click();
    await page.waitForFunction(() => document.querySelector('.level-section')?.textContent.includes('1/10 practiced'));
    assert.match(await page.locator('.level-section').first().innerText(), /1\/10 practiced/);
    await page.screenshot({ path: path.join(output, 'learning-grammar.png'), fullPage: true });

    // Media separates provided Read/Listen material from extension-saved media.
    await page.locator('#navigation a[data-page="media"]').click();
    assert.deepEqual(await page.locator('.media-feature-row').first().locator('.feature-copy strong').allInnerTexts(), ['Read','Listen']);
    assert.deepEqual(await page.locator('.media-feature-row.single .feature-copy strong').allInnerTexts(), ['Your Media']);
    await page.locator('[data-action=resource-view][data-view=reading]').click();
    await page.locator('.media-card').first().waitFor();
    assert.deepEqual(await page.locator('.media-library-groups > .media-section .section-head h2').allInnerTexts(), ['Interactive reading','Care-free reading']);
    assert.doesNotMatch(await page.locator('.media-library-groups').innerText(), /La práctica abre puertas/);
    assert.equal(await page.locator('.media-library-groups > .media-section').nth(1).locator('[data-action="open-media"]').count(), 0);
    const mediaButton = page.locator('.media-library-groups > .media-section').first().locator('[data-action="open-media"]').first();
    const mediaId = await mediaButton.getAttribute('data-id');
    await mediaButton.click();
    await page.locator('#media-writing-response').fill('La práctica diaria me ayuda a recordar palabras.');
    await page.locator('#media-speaking-response').fill('I spoke without reading and need to retry the rhythm of práctica.');
    await page.locator('#media-response-form button[type="submit"]').click();
    await page.waitForFunction(async id => {
      const item = (await LearningData.load()).media.find(entry => entry.id === id);
      return Boolean(item?.responses?.writing?.text && item?.responses?.speaking?.text);
    }, mediaId);
    await page.locator(`[data-action="complete-media"][data-id="${mediaId}"]`).click();
    await page.waitForFunction(async id => (await LearningData.load()).media.find(entry => entry.id === id)?.completed, mediaId);
    await page.locator('[data-action="close-media-response"]').first().click();
    await page.locator('[data-action="resource-home"]').click();
    await page.locator('[data-action=resource-view][data-view=saved]').click();
    assert.match(await page.locator('.media-library-groups').innerText(), /La práctica abre puertas/);
    await page.screenshot({ path: path.join(output, 'learning-media.png'), fullPage: true });

    // Home reports every learning dimension honestly below the guided course.
    await page.locator('.brand').click();
    assert.deepEqual(await page.locator('.mastery-card h2').allInnerTexts(), ['Vocabulary mastery','Grammar mastery','Pronunciation mastery']);
    assert.match(await page.locator('.mastery-card').nth(0).innerText(), /1 of 2 known/);
    assert.match(await page.locator('.mastery-card').nth(1).innerText(), /1 of 25 principles/);
    assert.match(await page.locator('.mastery-card').nth(2).innerText(), /No assessed attempts/);

    // Add an authentic reference through the pronunciation library.
    await page.locator('#navigation a[data-page="pronunciation"]').click();
    await page.locator('[data-pronunciation-view="library"]').click();
    assert.equal(await page.locator('main > .feature-back + .page-heading').count(), 0);
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
    const phrase = await page.evaluate(async () => (await StudioData.load()).phrases.find(item => item.text === 'Hola, ¿cómo estás?'));
    assert.ok(phrase && phrase.references.length === 1);

    // A canonical deep link opens the selected phrase directly in the recording studio.
    await page.goto(`${origin}/studio.html?phrase=${encodeURIComponent(phrase.id)}#pronunciation`);
    await page.locator('#record-button').waitFor();
    assert.equal(await page.locator('#record-button').isVisible(), true);
    await page.locator('#practice-reference').selectOption(phrase.references[0].id);
    await page.locator('#playback-speed').selectOption('0.75');
    await page.locator('[data-action="play-reference"]').click();
    await page.locator('[data-action="toggle-loop"]').click();
    await page.locator('[data-action="stop-audio"]').click();
    assert.equal(await page.locator('#toast.error:visible').count(), 0, 'Normal playback cancellation should be quiet');
    await page.screenshot({ path: path.join(output, 'learning-pronunciation.png'), fullPage: true });
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
    assert.equal(first.text, 'Hola');
    assert.equal(first.referenceSnapshot.audioUrl, phrase.references[0].audioUrl);
    assert.equal(first.referenceSnapshot.start, 0.5);
    assert.equal(first.referenceSnapshot.end, 2);
    assert.ok(first.duration > 0.8);
    await page.locator('[data-action="play-attempt-reference"]').click();
    await page.locator('[data-action="play-attempt"]').first().click();
    await page.locator('[data-action="compare-timing"]').click();
    await page.getByRole('heading', { name: 'Timing & recording quality' }).waitFor();
    await page.locator('[data-action="rate-speaking"][data-rating="good"]').click();
    await page.waitForFunction(async id => Boolean((await StudioData.load()).reviews[`speaking:${id}`]), phrase.id);

    // Test mode keeps the reference hidden until the new attempt is saved.
    await page.locator('[data-action="mode"][data-mode="test"]').click();
    await page.locator('.practice-empty-test').waitFor();
    assert.equal(await page.locator('[data-action="play-reference"]').count(), 0);
    await page.locator('#record-button').click();
    await page.getByRole('button', { name: 'Finish recording', exact: true }).waitFor();
    await page.waitForTimeout(1000);
    await page.locator('#record-button').click();
    await page.locator('[aria-label="Compare your recording"]').waitFor();
    const second = await page.evaluate(async () => (await StudioData.load()).attempts.at(-1));
    assert.equal(second.mode, 'test');
    assert.notEqual(second.id, first.id);
    assert.equal(Boolean(second.assessment), false);

    // Assessment remains opt-in and dark mode applies to the whole shell.
    let assessmentCalls = 0;
    await page.route('http://127.0.0.1:17494/**', async route => {
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      assessmentCalls++;
      const body = route.request().postDataJSON();
      assert.equal(body.text, 'Hola');
      assert.equal(body.locale, 'es-MX');
      assert.ok(body.audioBase64);
      return route.fulfill({ headers, json: { provider: 'azure', locale: 'es-MX', transcript: 'Hola', accuracy: 82, fluency: 80, completeness: 100, words: [{ word: 'Hola', accuracy: 82, errorType: 'None' }], tips: [], limitations: ['Synthetic test response; not an actual speech assessment.'] } });
    });
    await page.locator('[data-action="assess-attempt"]').click();
    await page.locator('#assessment-enabled').check();
    await page.locator('#settings-theme').selectOption('dark');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.locator('#editor-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.equal((await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg'))).trim(), '#17161d');
    assert.equal(assessmentCalls, 0);
    assert.equal(await page.evaluate(async () => (await StudioData.load()).settings.assessmentEnabled), true);

    // Exercise the configured Voicebox client and attach its generated reference.
    await page.route('http://127.0.0.1:17493/**', async route => {
      const url = new URL(route.request().url());
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (url.pathname === '/profiles') return route.fulfill({ json: [{ id: 'test-voice', name: 'Test reference' }], headers });
      if (url.pathname === '/generate') {
        const body = route.request().postDataJSON();
        assert.equal(body.language, 'es');
        return route.fulfill({ json: { id: 'test-generation', status: 'completed' }, headers });
      }
      if (url.pathname.endsWith('/export-audio')) return route.fulfill({ contentType: 'audio/wav', body: wav, headers });
      return route.fulfill({ status: 404, headers });
    });
    await page.locator('#navigation a[data-page=pronunciation]').click();
    assert.deepEqual(await page.locator('[data-pronunciation-view]').evaluateAll(nodes => nodes.map(node => node.dataset.pronunciationView)), ['studio','library']);
    await page.locator('[data-action="open-settings"]').first().click();
    const spanishOptions = page.locator('.language-options').filter({ has: page.locator('input[value="es"]') });
    assert.equal(await spanishOptions.getAttribute('open'), '');
    await page.screenshot({ path: path.join(output, 'learning-language-settings.png'), fullPage: true });
    await spanishOptions.locator('#settings-accent').selectOption('es-AR');
    await spanishOptions.locator('[data-action="open-voice-settings"]').click();
    assert.equal(await page.evaluate(async () => (await StudioData.load()).settings.accentId), 'es-AR');
    await page.locator('#voicebox-url').fill('http://127.0.0.1:17493');
    await page.locator('#voice-connect-form button[type="submit"]').click();
    await page.locator('#profile-name-0').waitFor();
    await page.locator('#profile-accent-0').selectOption('es-AR');
    await page.locator('[data-action="save-profile"]').first().click();
    await page.waitForFunction(async () => (await StudioData.load()).voices.length === 1);
    await page.getByRole('button', { name: 'Edit Test reference' }).click();
    await page.locator('#edit-voice-name').fill('Regional test reference');
    await page.locator('#voice-edit-form button[type="submit"]').click();
    await page.getByRole('heading', { name: 'Spanish voices and accents' }).waitFor();
    assert.match(await page.locator('#editor-dialog').innerText(), /Regional test reference/);
    await page.goto(`${origin}/studio.html?phrase=${encodeURIComponent(phrase.id)}#pronunciation`);
    await page.reload();
    await page.locator('#generate-button').click();
    await page.waitForFunction(async id => (await StudioData.load()).phrases.find(item => item.id === id).references.length === 2, phrase.id);

    // Backup remains valid after the IA migration.
    await page.locator('[data-action="open-settings"]').first().click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-action="export-backup"]').click();
    const download = await downloadPromise;
    const backupPath = path.join(output, 'learning-test-backup.json');
    await download.saveAs(backupPath);
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    assert.equal(backup.format, 'gift-of-tongues-studio');
    await page.locator('[data-action="close-dialog"]').first().click();

    // Language settings reconfigure resources and expose honest capability limits.
    await page.locator('[data-action="open-settings"]').first().click();
    await page.locator('#target-language').selectOption('fr');
    await page.locator('input[name="target-languages"][value="fr"]').check();
    await page.locator('#native-language').selectOption('en');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.locator('#editor-dialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(async () => (await LearningData.load()).target.code === 'fr');
    await page.locator('#navigation a[data-page="pronunciation"]').click();
    assert.match(await page.locator('main').innerText(), /currently support Spanish/i);
    assert.equal(await page.locator('[data-pronunciation-view="studio"]').count(), 0);
    assert.deepEqual(await page.locator('#study-language-switch option').evaluateAll(options => options.map(option => option.value)), ['fr', 'es']);
    await page.screenshot({ path: path.join(output, 'learning-french-pronunciation.png'), fullPage: true });
    await page.locator('#study-language-switch').selectOption('es');
    await page.waitForFunction(async () => (await LearningData.load()).target.code === 'es');

    // Every canonical route inherits dark mode and fits the desktop viewport.
    for (const route of ['home', 'personalization', 'my-path', 'vocabulary', 'grammar', 'pronunciation', 'media']) {
      await page.goto(`${origin}/studio.html#${route}`);
      await page.waitForFunction(() => !document.querySelector('.loading-state'));
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark', `Dark mode should cover ${route}`);
      const layout = await page.evaluate(() => ({
        viewport: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        offenders: [...document.querySelectorAll('body *')].filter(node => node.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(node => ({ tag: node.tagName, className: String(node.className), right: Math.round(node.getBoundingClientRect().right), scrollWidth: node.scrollWidth }))
      }));
      assert.ok(layout.scrollWidth <= layout.viewport + 1, `${route} overflows horizontally: ${JSON.stringify(layout)}`);
    }
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({width, height:900});
      for (const theme of ['light','dark']) {
        await page.evaluate(value => StudioTheme.apply(value), theme);
        for (const route of ['home','personalization','my-path','vocabulary','grammar','pronunciation','media']) {
          await page.goto(`${origin}/studio.html#${route}`);
          await page.waitForFunction(() => !document.querySelector('.loading-state'));
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${route} overflows at ${width} in ${theme}`);
          await page.screenshot({path:path.join(output, `ui-${route}-${width}-${theme}.png`),fullPage:true});
        }
      }
    }
    await page.locator('[data-action="open-settings"]').first().click();
    await page.screenshot({ path: path.join(output, 'learning-settings-dark.png'), fullPage: true });
    await page.locator('[data-action="close-dialog"]').first().click();

    // The full navigation and primary path stay usable on a phone-sized viewport.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/studio.html#my-path`);
    await page.locator('.path-hero').waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile My Path overflows horizontally');
    assert.equal(await page.locator('#navigation a[data-page]').count(), 6);
    await page.screenshot({ path: path.join(output, 'learning-mobile.png'), fullPage: true });

    // System theme follows live device changes after being selected.
    await page.locator('[data-action="open-settings"]').first().click();
    await page.locator('#settings-theme').selectOption('system');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.locator('#editor-dialog').waitFor({ state: 'hidden' });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');

    assert.deepEqual(errors, []);
    console.log('Learning app browser smoke passed: My Path IA, automatic bilingual dictionary, grouped grammar principles, provided and saved media, cross-skill progress, Spanish recording and comparison, opt-in assessment, Voicebox generation, language switching, backup, themes, and responsive layout.');
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
