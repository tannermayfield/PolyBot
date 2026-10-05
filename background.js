// Gift of Tongues Background Service Worker
// Translates the transcript sentence + highlights what the clicked word maps to.
// Which language it translates from/to is passed in on each message: msg.lang
// is the language being learned, msg.nativeLang is the language definitions
// should come back in (defaults to English so nothing changes for people who
// haven't set one).

// Cache keyed by "sentence::<text>" (plain sentence) or "ctx::<sentence>::<word>"
const cache = {};
const DEFAULT_LANG = 'es';
const DEFAULT_NATIVE_LANG = 'en';
importScripts('study-data.js');

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  if (msg.type === 'SAVE_STUDIO_PHRASE') {
    saveStudioPhrase(msg, _sender)
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(() => sendResponse({ ok: false, error: 'Could not save this phrase. Please try again.' }));
    return true;
  }

  if (msg.type === 'OPEN_STUDIO') {
    const id = typeof msg.phraseId === 'string' ? msg.phraseId.slice(0, 200) : '';
    const page = msg.lang && msg.lang !== 'es' ? 'studio.html#vocabulary' : `studio.html${id ? '?phrase=' + encodeURIComponent(id) + '#pronunciation' : '#my-path'}`;
    chrome.tabs.create({ url: chrome.runtime.getURL(page) })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === 'TRANSLATE_WORD_IN_CONTEXT') {
    const word = (msg.word || '').toLowerCase().trim();
    const sentence = msg.sentence || '';
    const occurrence = Number(msg.occurrence) || 0;
    const lang = msg.lang || DEFAULT_LANG;
    const nativeLang = msg.nativeLang || DEFAULT_NATIVE_LANG;
    const key = 'ctx::' + lang + '::' + nativeLang + '::' + sentence + '::' + word + '::' + occurrence;
    if (cache[key] !== undefined) { sendResponse(cache[key]); return false; }

    const task = lang === nativeLang
      ? synonymInContext(sentence, word, occurrence, lang)
      : translateWordInContext(sentence, word, occurrence, lang, nativeLang);
    task
      .then(r => { cache[key] = r; sendResponse(r); })
      .catch(() => { cache[key] = null; sendResponse(null); });
    return true;
  }

  if (msg.type === 'TRANSLATE_PHRASE_DIRECT') {
    const text = (msg.text || '').trim();
    const lang = msg.lang || DEFAULT_LANG;
    const nativeLang = msg.nativeLang || DEFAULT_NATIVE_LANG;
    const key = 'direct::' + lang + '::' + nativeLang + '::' + text;
    if (cache[key] !== undefined) { sendResponse(cache[key]); return false; }
    if (!text) { sendResponse(null); return false; }

    const task = lang === nativeLang
      ? synonymPhraseDirect(text, lang)
      : translateWordDirect(text, lang, nativeLang);
    task
      .then(r => { cache[key] = r; sendResponse(r); })
      .catch(() => { cache[key] = null; sendResponse(null); });
    return true;
  }

  if (msg.type === 'TRANSLATE_DICTIONARY_AUTO') {
    const text = (msg.text || '').trim();
    const targetLang = validLanguageCode(msg.targetLang) || DEFAULT_LANG;
    const nativeLang = validLanguageCode(msg.nativeLang) || DEFAULT_NATIVE_LANG;
    if (!text) { sendResponse(null); return false; }
    const key = 'dictionary::' + targetLang + '::' + nativeLang + '::' + text;
    if (cache[key] !== undefined) { sendResponse(cache[key]); return false; }

    translateDictionaryAuto(text, targetLang, nativeLang)
      .then(r => { cache[key] = r; sendResponse(r); })
      .catch(() => { cache[key] = null; sendResponse(null); });
    return true;
  }

  if (msg.type === 'TRANSLATE_NATIVE_TO_TARGET' || msg.type === 'TRANSLATE_EN_TO_TARGET' || msg.type === 'TRANSLATE_EN_TO_ES') {
    const text = (msg.text || '').trim();
    const targetLang = msg.targetLang || msg.lang || DEFAULT_LANG;
    // Older message types (TRANSLATE_EN_TO_*) always meant "from English";
    // the current one carries the learner's actual native language.
    const sourceLang = msg.type === 'TRANSLATE_NATIVE_TO_TARGET' ? (msg.nativeLang || DEFAULT_NATIVE_LANG) : 'en';
    const key = 'src2xx::' + sourceLang + '::' + targetLang + '::' + text;
    if (cache[key] !== undefined) { sendResponse(cache[key]); return false; }
    if (!text) { sendResponse(null); return false; }

    translateBetween(text, sourceLang, targetLang)
      .then(r => { cache[key] = r; sendResponse(r); })
      .catch(() => { cache[key] = null; sendResponse(null); });
    return true;
  }

  if (msg.type === 'READER_ENABLE_SITE') {
    registerReaderScript(msg.hostname, msg.originPattern)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === 'READER_DISABLE_SITE') {
    unregisterReaderScript(msg.hostname)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === 'FETCH_VIDEO_TRANSCRIPT') {
    fetchVideoTranscript(msg.videoId, msg.lang)
      .then(r => sendResponse(r))
      .catch(err => sendResponse({ ok: false, reason: 'error', error: String(err) }));
    return true;
  }

  return false;
});

async function saveStudioPhrase(msg, sender) {
  const text = typeof msg.text === 'string' ? msg.text.trim() : '';
  const translation = typeof msg.translation === 'string' ? msg.translation.trim() : '';
  if (!text || text.length > 2000 || translation.length > 4000) throw new Error('Invalid phrase');
  const audio = msg.audioUrl;
  if (audio && (typeof audio !== 'string' || audio.length > 12 * 1024 * 1024 || !/^data:audio\/[\w.+-]+(?:;[^,]*)?;base64,[A-Za-z0-9+/=\s]+$/.test(audio))) throw new Error('Invalid audio');
  let sourceUrl = '';
  try {
    const url = new URL(sender.url || sender.tab?.url || '');
    if (/^https?:$/.test(url.protocol)) { url.hash = ''; sourceUrl = url.href; }
  } catch (_) { /* Source attribution is optional. */ }
  const phrase = await StudioData.savePhrase({ text, translation, source: audio ? 'video' : 'web', sourceUrl });
  if (audio) {
    try {
      await StudioData.addReference(phrase.id, { label: 'Original clip', kind: 'original', audioUrl: audio, createdAt: Date.now() });
    } catch (_) {
      // Text is already saved. Return its ID so a retry cannot duplicate it.
      return { id: phrase.id, warning: 'The phrase was saved, but its audio could not be saved. Add a reference in the studio.' };
    }
  }
  return { id: phrase.id };
}

// ── Reading Mode: persist reader.js as a content script for sites the user
// has opted into, so it keeps running on future page loads there without
// the person needing to reopen the popup every time. ──────────────────────
function readerScriptId(hostname) {
  return 'sptube-reader-' + hostname.replace(/[^a-z0-9.-]/gi, '_');
}

async function registerReaderScript(hostname, originPattern) {
  const id = readerScriptId(hostname);
  const config = {
    id,
    matches: [originPattern],
    js: ['languages.js', 'shared.js', 'reader.js', 'videocc.js'],
    css: ['styles.css'],
    runAt: 'document_idle',
    persistAcrossSessions: true,
  };
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] }).catch(() => []);
  if (existing && existing.length) {
    await chrome.scripting.updateContentScripts([config]);
  } else {
    await chrome.scripting.registerContentScripts([config]);
  }
}

async function unregisterReaderScript(hostname) {
  const id = readerScriptId(hostname);
  await chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => {});
}

// ── Sentence + in-context word translation ─────────────────────────────────
// Rather than translating the clicked word on its own and hunting for that
// phrase inside the sentence translation (which fails a lot for conjugated
// verbs — an isolated "fuimos" and the "we went"/"I went" that actually
// appears in a specific sentence often don't match), we wrap the *exact*
// word in the sentence with a placeholder-style marker before translating,
// then see where the marker landed in the output. This uses the real
// per-sentence translation's own word alignment instead of a separate guess.
const MARK_OPEN = '{{';
const MARK_CLOSE = '}}';

async function translateWordInContext(sentence, word, occurrence, lang, nativeLang) {
  const loc = findWordOccurrence(sentence, word, occurrence);
  if (!loc) {
    // Couldn't even find the word in its own sentence (shouldn't normally
    // happen) — just translate plain, no highlight.
    const translation = await translateSentence(sentence, lang, nativeLang);
    return translation ? { translation, start: null, end: null } : null;
  }

  const marked = sentence.slice(0, loc.start) + MARK_OPEN + sentence.slice(loc.start, loc.end) + MARK_CLOSE + sentence.slice(loc.end);

  const [markedTranslation, wordTranslation] = await Promise.all([
    translateSentence(marked, lang, nativeLang),
    translateWordDirect(word, lang, nativeLang), // kept only as a fallback anchor, see below
  ]);
  if (!markedTranslation) return null;

  const markers = extractMarkerRange(markedTranslation);
  if (markers) {
    return { translation: markers.text, start: markers.start, end: markers.end };
  }

  // Markers didn't survive translation intact — fall back to the isolated
  // word-translation heuristic, searching within the marker-stripped text.
  const cleanText = markedTranslation.split(MARK_OPEN).join('').split(MARK_CLOSE).join('');
  const range = wordTranslation ? findHighlightRange(cleanText, wordTranslation) : null;
  return { translation: cleanText, start: range ? range.start : null, end: range ? range.end : null };
}

// Locate the `occurrence`-th (0-indexed) case-insensitive whole-word match
// of `word` in `sentence`. Falls back to the first match if the requested
// occurrence is out of range.
function findWordOccurrence(sentence, word, occurrence) {
  if (!sentence || !word) return null;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b(${escaped})\\b`, 'gi');
  const matches = [...sentence.matchAll(re)];
  if (matches.length === 0) return null;
  const m = matches[occurrence] || matches[0];
  return { start: m.index, end: m.index + m[0].length };
}

// Pull the {{...}} marked span out of the translated text, returning the
// text with markers removed and the highlight range within that clean text.
function extractMarkerRange(text) {
  const openIdx = text.indexOf(MARK_OPEN);
  const closeIdx = text.indexOf(MARK_CLOSE, openIdx + MARK_OPEN.length);
  if (openIdx === -1 || closeIdx === -1) return null;

  const before = text.slice(0, openIdx);
  const highlighted = text.slice(openIdx + MARK_OPEN.length, closeIdx);
  const after = text.slice(closeIdx + MARK_CLOSE.length);
  // Strip any other stray marker leftovers from before/after just in case.
  const clean = (s) => s.split(MARK_OPEN).join('').split(MARK_CLOSE).join('');
  const cleanBefore = clean(before);
  const cleanHighlighted = clean(highlighted);
  const cleanAfter = clean(after);

  if (!cleanHighlighted.trim()) return null;

  return {
    text: cleanBefore + cleanHighlighted + cleanAfter,
    start: cleanBefore.length,
    end: cleanBefore.length + cleanHighlighted.length,
  };
}

// Plain single-word/phrase translation (dt=t) — used both as the primary
// translator for multi-word selections (TRANSLATE_PHRASE_DIRECT, which
// intentionally skips the sentence-context logic below) and as a fallback
// anchor if the marker trick in translateWordInContext doesn't survive
// translation. `nativeLang` is which language the result comes back in.
async function translateWordDirect(word, lang, nativeLang) {
  if (!word) return null;
  const sl = lang || DEFAULT_LANG;
  const tl = nativeLang || DEFAULT_NATIVE_LANG;
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(word)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const translated = data[0]?.[0]?.[0]?.trim();
  return translated && translated.toLowerCase() !== word.toLowerCase() ? translated : (translated || null);
}

// Try to find `phrase` inside `text` so we can highlight it. Falls back to
// progressively looser matching (stripped punctuation, then just the phrase's
// longest word) rather than giving up outright.
function findHighlightRange(text, phrase) {
  const tryMatch = (p) => {
    if (!p) return null;
    const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b(${escaped})\\b`, 'i');
    const m = text.match(re);
    return m ? { start: m.index, end: m.index + m[0].length } : null;
  };

  let range = tryMatch(phrase);
  if (range) return range;

  const stripped = phrase.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (stripped !== phrase) {
    range = tryMatch(stripped);
    if (range) return range;
  }

  const words = stripped.split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const w of words) {
    if (w.length < 3) continue; // too short to be a meaningful anchor
    range = tryMatch(w);
    if (range) return range;
  }

  return null;
}

// ── Sentence translation: plain dt=t on the full sentence ─────────────────
async function translateSentence(text, lang, nativeLang) {
  const sl = lang || DEFAULT_LANG;
  const tl = nativeLang || DEFAULT_NATIVE_LANG;
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  // Concatenate all translation segments
  const parts = (data[0] || []).map(s => s?.[0] || '').join('');
  return parts.trim() || null;
}

// ── Native-language → target-language translation, used by the "Build
// Phrases" tool so the learner can check their own attempted translation
// against the app's. `sourceLang` is whichever language the learner typed
// their phrase in (their native language, or English for older callers). ──
async function translateBetween(text, sourceLang, targetLang) {
  if (!text) return null;
  const sl = sourceLang || 'en';
  const tl = targetLang || DEFAULT_LANG;
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const parts = (data[0] || []).map(s => s?.[0] || '').join('');
  return parts.trim() || null;
}

function validLanguageCode(value) {
  return typeof value === 'string' && /^[a-z]{2,3}(?:-[a-z]{2,4})?$/i.test(value) ? value : '';
}

function languageMatches(detected, configured) {
  if (!validLanguageCode(detected) || !validLanguageCode(configured)) return false;
  const detectedCode = detected.toLowerCase().replace('_', '-');
  const configuredCode = configured.toLowerCase().replace('_', '-');
  return detectedCode === configuredCode || detectedCode.split('-')[0] === configuredCode.split('-')[0];
}

function detectWithChrome(text) {
  const detector = chrome.i18n && chrome.i18n.detectLanguage;
  if (typeof detector !== 'function') return Promise.resolve(null);
  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      const languages = result && Array.isArray(result.languages) ? result.languages : [];
      const candidates = languages
        .filter(item => item && validLanguageCode(item.language))
        .sort((a, b) => (Number(b.percentage) || 0) - (Number(a.percentage) || 0));
      resolve(candidates.length ? candidates : null);
    };
    try {
      const returned = detector.call(chrome.i18n, text, result => {
        try { if (chrome.runtime.lastError) { finish(null); return; } } catch (_) { /* Ignore runtime shims. */ }
        finish(result);
      });
      if (returned && typeof returned.then === 'function') returned.then(finish, () => finish(null));
    } catch (_) { finish(null); }
  });
}

function detectByScript(text, targetLang, nativeLang) {
  const scripts = [
    [/[぀-ヿ㐀-鿿]/u, ['ja', 'zh']],
    [/[가-힯]/u, ['ko']],
    [/[؀-ۿ]/u, ['ar']],
    [/[֐-׿]/u, ['he']],
    [/[Ѐ-ӿ]/u, ['ru', 'uk']],
    [/[Ͱ-Ͽ]/u, ['el']],
    [/[ऀ-ॿ]/u, ['hi']],
    [/[฀-๿]/u, ['th']]
  ];
  for (const [pattern, codes] of scripts) {
    if (!pattern.test(text)) continue;
    if (codes.some(code => languageMatches(code, targetLang))) return targetLang;
    if (codes.some(code => languageMatches(code, nativeLang))) return nativeLang;
  }
  return null;
}

async function translateDictionaryAuto(text, targetLang, nativeLang) {
  if (languageMatches(targetLang, nativeLang)) {
    return { translation: await synonymPhraseDirect(text, targetLang), sourceLang: targetLang, targetLang: nativeLang, detection: 'same-language' };
  }
  const candidates = await detectWithChrome(text);
  const detected = candidates && candidates.find(item => languageMatches(item.language, targetLang) || languageMatches(item.language, nativeLang));
  const sourceLang = detected
    ? (languageMatches(detected.language, nativeLang) ? nativeLang : targetLang)
    : (detectByScript(text, targetLang, nativeLang) || targetLang);
  const destinationLang = languageMatches(sourceLang, nativeLang) ? targetLang : nativeLang;
  return {
    translation: await translateBetween(text, sourceLang, destinationLang),
    sourceLang, targetLang: destinationLang,
    detection: detected ? 'chrome' : (detectByScript(text, targetLang, nativeLang) ? 'script' : 'fallback')
  };
}

// ── Same-language mode: synonyms instead of translation ────────────────────
// When the language being learned and the native language are the same
// (e.g. English → English, for practicing an English video without a second
// language involved), a "translation" doesn't mean anything — so the word
// popup shows a synonym substituted into the sentence instead. Word list
// (📙 Learning / ✅ Know it) works exactly the same either way.

async function getSynonyms(word, lang) {
  if (!word) return [];
  const base = (lang || '').split('-')[0].toLowerCase();
  return base === 'en' ? getEnglishSynonyms(word) : getSynonymsViaPivot(word, lang);
}

// English gets a dedicated, well-documented synonym source (Datamuse, free
// and keyless, built on WordNet) rather than the round-trip guess below.
async function getEnglishSynonyms(word) {
  try {
    const res = await fetch(`https://api.datamuse.com/words?rel_syn=${encodeURIComponent(word.toLowerCase())}&max=10`);
    if (!res.ok) return [];
    const data = await res.json();
    return (Array.isArray(data) ? data : [])
      .map(e => e && e.word)
      .filter(w => w && w.toLowerCase() !== word.toLowerCase());
  } catch (e) {
    return [];
  }
}

// Datamuse's synonym data only covers English, and Google Translate has no
// documented same-language "synonym" mode (an earlier attempt at faking one
// via dt=ss just echoed back the language code, not an actual synonym —
// that's what was showing up as "es" for every word). Every other language
// instead gets a round-trip translation: translate the word into a pivot
// language and back again. When the round trip lands somewhere different
// than where it started, that's usually a related word — a real, if
// occasionally imperfect, stand-in for a synonym, built entirely on the
// same translate endpoint already used everywhere else in the extension.
const SYNONYM_PIVOTS = ['en', 'fr', 'pt', 'de', 'it'];

async function getSynonymsViaPivot(word, lang) {
  const found = [];
  const seen = new Set([word.toLowerCase()]);
  for (const pivot of SYNONYM_PIVOTS) {
    if (pivot === lang) continue;
    try {
      const viaPivot = await translateWordDirect(word, lang, pivot);
      if (!viaPivot) continue;
      const back = await translateWordDirect(viaPivot, pivot, lang);
      const norm = (back || '').trim();
      const lower = norm.toLowerCase();
      if (norm && !seen.has(lower)) {
        seen.add(lower);
        found.push(norm);
        if (found.length >= 3) break; // enough candidates; stop spending requests
      }
    } catch (e) {
      // try the next pivot
    }
  }
  return found;
}

// Roughly matches the capitalization of `source` onto `target` (e.g. a
// capitalized word at the start of a sentence gets a capitalized synonym)
// so the substituted word doesn't look out of place.
function matchCase(source, target) {
  if (!source || !target) return target;
  if (source === source.toUpperCase() && source !== source.toLowerCase()) return target.toUpperCase();
  if (source[0] === source[0].toUpperCase() && source[0] !== source[0].toLowerCase()) {
    return target.charAt(0).toUpperCase() + target.slice(1);
  }
  return target;
}

async function synonymInContext(sentence, word, occurrence, lang) {
  const synonyms = await getSynonyms(word, lang);
  const best = synonyms[0];
  if (!best) return null;
  const styled = matchCase(word, best);

  const loc = findWordOccurrence(sentence, word, occurrence);
  if (!loc) {
    // Couldn't re-locate the exact word in its own sentence (shouldn't
    // normally happen) — hand back just the synonym so there's still
    // something to show.
    return { translation: styled, start: 0, end: styled.length, isSynonym: true };
  }
  const rewritten = sentence.slice(0, loc.start) + styled + sentence.slice(loc.end);
  return { translation: rewritten, start: loc.start, end: loc.start + styled.length, isSynonym: true };
}

async function synonymPhraseDirect(text, lang) {
  const synonyms = await getSynonyms(text, lang);
  const best = synonyms[0];
  return best ? matchCase(text, best) : null;
}

// ── On-demand transcript fetch for the "% known" video-grid scan ──────────
// Pulls a video's caption track straight from its watch page — same-origin
// to youtube.com, so no extra host permission is needed beyond what's
// already granted. Only ever called one video at a time, and only when the
// person explicitly asks content.js to scan the cards on screen (see
// content.js) — never run automatically in the background.
async function fetchVideoTranscript(videoId, lang) {
  if (!videoId) return { ok: false, reason: 'no_id' };
  const targetLang = lang || 'es';

  let html;
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`, {
      credentials: 'omit',
    });
    if (!res.ok) return { ok: false, reason: 'fetch_failed' };
    html = await res.text();
  } catch (e) {
    return { ok: false, reason: 'fetch_failed' };
  }

  const playerResponse = extractJsonAfter(html, 'ytInitialPlayerResponse');
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks) || !tracks.length) return { ok: false, reason: 'no_captions' };

  const track = pickCaptionTrack(tracks, targetLang);
  if (!track || !track.baseUrl) return { ok: false, reason: 'no_matching_captions' };

  let xml;
  try {
    const res = await fetch(track.baseUrl, { credentials: 'omit' });
    if (!res.ok) return { ok: false, reason: 'fetch_failed' };
    xml = await res.text();
  } catch (e) {
    return { ok: false, reason: 'fetch_failed' };
  }

  const text = extractTranscriptText(xml);
  if (!text) return { ok: false, reason: 'parse_failed' };
  return { ok: true, text, isAuto: track.kind === 'asr' };
}

// Prefer an exact language-code match, then a same-base-language match
// (e.g. "es-419" for a learner targeting "es"), then fall back to any
// auto-generated ("asr") track — better than nothing, though noisier.
function pickCaptionTrack(tracks, targetLang) {
  const exact = tracks.find(t => t.languageCode === targetLang);
  if (exact) return exact;
  const sameBase = tracks.find(t => (t.languageCode || '').split('-')[0] === targetLang);
  if (sameBase) return sameBase;
  const anyAsrSameBase = tracks.find(t => t.kind === 'asr' && (t.languageCode || '').split('-')[0] === targetLang);
  return anyAsrSameBase || null;
}

// Extracts the JSON object assigned to `var <marker> = {...};` in a page's
// HTML. Regex alone isn't reliable here (the JSON itself contains `};`
// sequences inside strings), so this walks the text tracking brace depth
// and string/escape state to find the matching closing brace instead.
function extractJsonAfter(html, marker) {
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) return null;
  const braceStart = html.indexOf('{', markerIdx);
  if (braceStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = braceStart; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const jsonText = html.slice(braceStart, i + 1);
        try { return JSON.parse(jsonText); } catch (e) { return null; }
      }
    }
  }
  return null;
}

// YouTube's timedtext endpoint returns `<transcript><text ...>chunk</text>...`
// (HTML-entity-encoded, occasionally with nested formatting tags) — pull out
// just the words.
function extractTranscriptText(xml) {
  const chunks = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(m => m[1]);
  if (!chunks.length) return '';
  const decoded = chunks.map(decodeHtmlEntities).join(' ');
  return decoded.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
