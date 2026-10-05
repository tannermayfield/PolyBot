'use strict';

// Run against an unpacked extension in an isolated browser profile. All website/provider
// responses are fixtures; this never loads a real YouTube page or uses a user microphone.
// PLAYWRIGHT_MODULE may point to a separately installed Playwright module.
// BROWSER_PATH may override Edge/Chromium. No permanent browser profile is modified.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.resolve(__dirname, '..');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const FIXTURE_URL = 'https://www.youtube.com/watch?v=studio-smoke-fixture';
const FIXTURE_HTML = `<!doctype html><html lang="es"><meta charset="utf-8"><title>Offline Spanish captions fixture</title>
<style>body{font:24px Arial;padding:60px;background:#fafafa}.ytp-caption-window-container{margin-top:40px;padding:20px;border:1px solid #ccc}
.ytp-caption-segment{font-size:32px;line-height:2}ytd-transcript-segment-renderer{display:block;margin:20px}</style>
<body><h1>Offline caption fixture</h1><div class="ytp-caption-window-container"><span class="ytp-caption-segment">Hola mundo amigos</span></div>
<ytd-transcript-renderer><ytd-transcript-segment-renderer><span class="segment-timestamp">0:01</span><span class="segment-text">Hola mundo amigos</span></ytd-transcript-segment-renderer></ytd-transcript-renderer>
</body></html>`;

function fixtureAudio() {
  const bytes = Buffer.alloc(44 + 8000);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  return 'data:audio/wav;base64,' + bytes.toString('base64');
}

async function poll(read, accept, label, timeout = 7000) {
  const deadline = Date.now() + timeout;
  let last;
  do {
    last = await read();
    if (accept(last)) return last;
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  assert.fail(`${label}: ${JSON.stringify(last)}`);
}

async function selectCaptionPhrase(page) {
  const first = await page.locator('.ytp-caption-segment .sptube-word').nth(0).boundingBox();
  const second = await page.locator('.ytp-caption-segment .sptube-word').nth(1).boundingBox();
  assert.ok(first && second, 'Caption words should be visible');
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.locator('.sptube-popup [data-action="build-phrase"]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.sptube-popup-word').textContent(), 'Hola mundo');
}

async function main() {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const profile = fs.mkdtempSync(path.join(tempRoot, 'gift-of-tongues-extension-'));
  let context;
  const checked = [];
  const errors = [];
  try {
    const executablePath = process.env.BROWSER_PATH || (process.platform === 'win32' && fs.existsSync(EDGE) ? EDGE : undefined);
    context = await chromium.launchPersistentContext(profile, {
      headless: true, ...(executablePath ? { executablePath } : {}), viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`]
    });
    context.setDefaultTimeout(10000);
    // This route also prevents accidental document/subresource network access in new tabs.
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url === FIXTURE_URL || url.startsWith(FIXTURE_URL + '#')) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: FIXTURE_HTML });
      if (/^https?:/.test(url)) return route.abort('blockedbyclient');
      return route.continue();
    });
    const worker = context.serviceWorkers().find(w => w.url().endsWith('/background.js')) ||
      await context.waitForEvent('serviceworker', { predicate: w => w.url().endsWith('/background.js'), timeout: 15000 });
    const origin = new URL(worker.url()).origin;
    // URL.origin for chrome-extension is "null" in Node, so retain its actual scheme/host.
    const extensionOrigin = origin === 'null' ? worker.url().slice(0, worker.url().lastIndexOf('/')) : origin;
    assert.match(extensionOrigin, /^chrome-extension:\/\/[a-p]{32}$/);
    const audio = fixtureAudio();
    await worker.evaluate(async audioUrl => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({
        sptubeTargetLang: 'es', sptubeNativeLang: 'en',
        spanishVocabulary: { hola: 'known', mundo: 'learning', practicar: 'learning' },
        spanishDefinitions: { hola: { matched: 'hello', translation: 'hello there' }, mundo: { matched: 'world' } },
        spanishPhrases: [{ id: 'legacy-smoke', savedTranslation: 'Quiero practicar contigo.', english: 'I want to practice with you.',
          source: 'video', savedAt: 1700000000000, videoClip: audioUrl, recording: audioUrl }],
        sptubeVocabulary_fr: { bonjour: 'learning', monde: 'known', ami: 'known' },
        sptubeDefinitions_fr: { bonjour: { matched: 'hello' } },
        sptubePhrases_fr: [{ id: 'french-smoke', savedTranslation: 'Bonjour mon ami.', english: 'Hello my friend.' }]
      });
      globalThis.__smokeTranslations = 0;
      // Only the external translation provider is mocked. Extension messaging, storage,
      // migration, DOM content scripts, word selection, and save/open behavior remain real.
      globalThis.fetch = async input => {
        const url = new URL(typeof input === 'string' ? input : input.url);
        if (url.hostname !== 'translate.googleapis.com') throw new Error('External network disabled by smoke test');
        globalThis.__smokeTranslations++;
        const text = url.searchParams.get('q') || '';
        const translated = text.replace(/Hola/gi, 'Hello').replace(/mundo/gi, 'world').replace(/amigos/gi, 'friends');
        return new Response(JSON.stringify([[[translated, text, null, null]], null, 'es']), { headers: { 'Content-Type': 'application/json' } });
      };
    }, audio);
    const migrated = await worker.evaluate(async () => {
      const before = await chrome.storage.local.get(['spanishPhrases', 'spanishVocabulary', 'spanishDefinitions', 'sptubePhrases_fr']);
      const first = await StudioData.load(); await StudioData.load();
      const after = await chrome.storage.local.get(['spanishPhrases', 'spanishVocabulary', 'spanishDefinitions', 'sptubePhrases_fr']);
      return { first, sameLegacy: JSON.stringify(before) === JSON.stringify(after), locks: !!navigator.locks };
    });
    assert.equal(migrated.sameLegacy, true);
    assert.equal(migrated.first.phrases.length, 1);
    assert.equal(migrated.first.phrases[0].id, 'legacy-smoke');
    assert.equal(migrated.first.phrases[0].references[0].audioUrl, audio);
    assert.equal(migrated.first.attempts.length, 1);
    assert.equal(migrated.first.attempts[0].text, 'Quiero practicar contigo.');
    assert.equal(migrated.first.vocabulary.find(v => v.word === 'hola').meaning, 'hello');
    assert.equal(migrated.first.vocabulary.some(v => v.word === 'bonjour'), false);
    checked.push('real MV3 worker + idempotent Spanish-only migration without legacy writes');

    const popup = await context.newPage();
    popup.on('pageerror', error => errors.push(`Popup: ${error.message}`));
    await popup.goto(`${extensionOrigin}/popup.html`);
    await poll(() => popup.locator('#learningCount').textContent(), value => value === '2', 'Spanish learning count');
    assert.equal(await popup.locator('#knownCount').textContent(), '1');
    await poll(() => popup.locator('#practiceNote').textContent(), value => value === '1 pronunciation phrase ready', 'Practice queue count');
    await popup.locator('details.settings > summary').click();
    await popup.locator('#languageSelect').selectOption('fr');
    await poll(() => popup.locator('#knownCount').textContent(), value => value === '2', 'French known count');
    assert.equal(await popup.locator('#learningCount').textContent(), '1');
    assert.equal(await popup.locator('#openCatchupBtn').isDisabled(), true);
    assert.equal(await popup.locator('#headerFlag').textContent(), 'FR');
    const frenchTab = context.waitForEvent('page');
    await popup.locator('#openManagerBtn').click();
    const manager = await frenchTab;
    await manager.waitForURL(`${extensionOrigin}/studio.html#vocabulary`);
    await manager.close();
    await popup.locator('#languageSelect').selectOption('es');
    await poll(() => popup.locator('#knownCount').textContent(), value => value === '1', 'Spanish restored count');
    assert.equal(await popup.locator('#openCatchupBtn').isDisabled(), false);
    checked.push('popup vocabulary counts, practice queue, language switching and learning-app routing');

    const captured = await popup.evaluate(audioUrl => chrome.runtime.sendMessage({ type: 'SAVE_STUDIO_PHRASE',
      text: 'Una frase capturada.', translation: 'A captured phrase.', audioUrl }), audio);
    assert.equal(captured.ok, true);
    assert.ok(captured.id);
    const capturedState = await worker.evaluate(async phraseId => (await StudioData.load()).phrases.find(p => p.id === phraseId), captured.id);
    assert.equal(capturedState.text, 'Una frase capturada.');
    assert.equal(capturedState.references.length, 1);
    assert.equal(capturedState.references[0].kind, 'original');
    const beforeInvalid = await worker.evaluate(async () => (await StudioData.load()).phrases.length);
    const invalid = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'SAVE_STUDIO_PHRASE', text: 'Invalid capture', audioUrl: 'data:text/html;base64,AQID' }));
    assert.equal(invalid.ok, false);
    assert.equal(await worker.evaluate(async () => (await StudioData.load()).phrases.length), beforeInvalid);
    const openResponse = await popup.evaluate(id => chrome.runtime.sendMessage({ type: 'OPEN_STUDIO', phraseId: id, lang: 'es' }), captured.id);
    assert.equal(openResponse.ok, true);
    const deepLink = `${extensionOrigin}/studio.html?phrase=${encodeURIComponent(captured.id)}#pronunciation`;
    await poll(() => Promise.resolve(context.pages().map(page => page.url())), urls => urls.includes(deepLink), 'Practice deep link');
    // Read browser tab URLs without requesting an additional extension tabs permission.
    for (const page of context.pages()) if (page.url() === deepLink) await page.close();
    checked.push('SAVE_STUDIO_PHRASE audio retention, invalid-payload rejection and OPEN_STUDIO deep link');

    await worker.evaluate(() => {
      globalThis.__smokeOriginalAddReference = StudioData.addReference;
      StudioData.addReference = async () => { throw new Error('Simulated recording storage failure'); };
    });
    try {
      const partial = await popup.evaluate(audioUrl => chrome.runtime.sendMessage({ type: 'SAVE_STUDIO_PHRASE',
        text: 'Conserva esta frase.', translation: 'Keep this phrase.', audioUrl }), audio);
      assert.equal(partial.ok, true, 'A saved phrase should remain a success when only clip attachment fails');
      assert.equal(typeof partial.warning, 'string');
      const preserved = await worker.evaluate(async phraseId => (await StudioData.load()).phrases.find(p => p.id === phraseId), partial.id);
      assert.equal(preserved.text, 'Conserva esta frase.');
      assert.deepEqual(preserved.references, []);
    } finally {
      await worker.evaluate(() => { StudioData.addReference = globalThis.__smokeOriginalAddReference; delete globalThis.__smokeOriginalAddReference; });
    }
    checked.push('partial clip-save failure preserves phrase and reports warning');

    const youtube = await context.newPage();
    youtube.on('pageerror', error => errors.push(`Caption fixture: ${error.message}`));
    await youtube.goto(FIXTURE_URL);
    await youtube.locator('.ytp-caption-segment .sptube-known[data-word="Hola"]').waitFor();
    assert.equal(await youtube.locator('.ytp-caption-segment .sptube-learning[data-word="mundo"]').count(), 1);
    assert.equal(await youtube.locator('.ytp-caption-segment .sptube-unknown[data-word="amigos"]').count(), 1);
    const colors = await youtube.locator('.ytp-caption-segment .sptube-word').evaluateAll(words => words.map(word => getComputedStyle(word).color));
    assert.ok(new Set(colors).size > 1, 'Recognition states need distinct visible styles');
    await youtube.locator('.segment-text .sptube-known[data-word="Hola"]').waitFor();
    checked.push('actual manifest content injection + known/learning/unknown caption and transcript recognition');

    await selectCaptionPhrase(youtube);
    await popup.locator('#nativeLanguageSelect').selectOption('fr');
    await youtube.locator('.sptube-popup').waitFor({ state: 'detached' });
    await popup.locator('#nativeLanguageSelect').selectOption('en');
    await selectCaptionPhrase(youtube);
    await popup.locator('#languageSelect').selectOption('fr');
    await youtube.locator('.sptube-popup').waitFor({ state: 'detached' });
    await popup.locator('#languageSelect').selectOption('es');
    await youtube.locator('.ytp-caption-segment .sptube-known[data-word="Hola"]').waitFor();
    checked.push('changing target/native language dismisses stale caption translation popups');

    await selectCaptionPhrase(youtube);
    assert.equal(await youtube.locator('.sptube-popup .sptube-sentence-translation').textContent(), 'Hello world');
    await youtube.locator('.sptube-popup [data-action="build-phrase"]').click();
    const savedSelection = await poll(() => worker.evaluate(async () => (await StudioData.load()).phrases.find(p => p.text === 'Hola mundo')),
      value => !!value, 'Caption phrase saved to studio');
    assert.equal(savedSelection.translation, 'Hello world');
    assert.equal(savedSelection.source, 'web');
    assert.equal(savedSelection.sourceUrl, FIXTURE_URL);
    assert.equal(savedSelection.references.length, 0, 'Fixture without video must not invent source audio');
    const selectionLink = `${extensionOrigin}/studio.html?phrase=${encodeURIComponent(savedSelection.id)}#pronunciation`;
    await poll(() => Promise.resolve(context.pages().map(page => page.url())), urls => urls.includes(selectionLink), 'Caption capture opens its practice phrase');
    assert.ok(await worker.evaluate(() => globalThis.__smokeTranslations > 0));
    const raw = await worker.evaluate(() => chrome.storage.local.get(['sptubePhrases_es', 'sptubePhrases_fr']));
    assert.equal(raw.sptubePhrases_es.length, 1, 'Studio capture does not rewrite legacy phrase stores');
    assert.equal(raw.sptubePhrases_fr.length, 1);
    checked.push('real drag selection → mocked translation → saved phrase/source → practice tab');

    const beforeConcurrent = await worker.evaluate(async () => (await StudioData.load()).phrases.length);
    assert.equal(migrated.locks, true, 'This browser needs Web Locks for tab/worker write isolation');
    await Promise.all([
      worker.evaluate(() => Promise.all(Array.from({ length: 6 }, (_, i) => StudioData.savePhrase({ text: `Worker concurrent ${i}` })))),
      popup.evaluate(() => Promise.all(Array.from({ length: 6 }, (_, i) => StudioData.savePhrase({ text: `Popup concurrent ${i}` }))))
    ]);
    assert.equal(await worker.evaluate(async () => (await StudioData.load()).phrases.length), beforeConcurrent + 12);
    checked.push('real chrome.storage concurrency across popup and service worker without lost writes');
    assert.deepEqual(errors, [], 'Unexpected JavaScript errors');
    console.log(`Unpacked extension smoke passed: ${checked.length} checks, isolated ${executablePath ? path.basename(executablePath) : 'Chromium'} profile, offline fixtures.`);
    for (const label of checked) console.log(`  PASS ${label}`);
  } finally {
    if (context) await context.close();
    const resolvedProfile = path.resolve(profile);
    // Verify this exact mkdtemp-created target stays within the named temporary directory.
    if (path.dirname(resolvedProfile) !== path.resolve(tempRoot) || !path.basename(resolvedProfile).startsWith('gift-of-tongues-extension-')) {
      throw new Error('Refusing to remove a profile outside the smoke-test temporary directory.');
    }
    fs.rmSync(resolvedProfile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
