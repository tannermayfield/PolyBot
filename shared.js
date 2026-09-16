// Gift of Tongues Shared Engine
// Site-agnostic core: tokenizing text into clickable word spans, the
// click/hover definition popups, drag-to-select phrases, translation
// requests, and vocabulary/definition storage. Both content.js (YouTube)
// and reader.js (any website "Reading Mode") create one engine instance
// each and feed it the DOM containers they find; everything downstream
// (colors, popups, saving) behaves identically on every site.
//
// All vocabulary/definitions/phrases are namespaced per target language
// (see languages.js) so switching the language you're learning doesn't mix
// data between languages. The engine loads the current target language
// asynchronously on creation (same pattern as the vocabulary load below),
// re-coloring once it's known and again any time it changes.
(function () {
  'use strict';

  // ── Quick Mark mode ───────────────────────────────────────────────────
  // A page-wide singleton (not per-engine) so it behaves consistently no
  // matter which engine instance (YouTube transcript, Reading Mode, plain
  // <video> captions) tokenized the word under the cursor, and survives
  // shared.js being injected more than once on the same page (see the
  // double-injection note in reader.js). While active — either by holding
  // Shift or by turning on the on-page "Quick Mark" pill — a click or a
  // click-and-drag across words marks each one "known" immediately, with
  // no popup in between, so plowing through a wall of already-familiar
  // words takes one pass instead of a click-plus-button-press per word.
  window.__sptubeQuickMark = window.__sptubeQuickMark || (function () {
    let shiftHeld = false;
    let toggleOn = false;
    const renderers = new Set();

    function isActive() { return shiftHeld || toggleOn; }

    function updateCursorClass() {
      document.documentElement.classList.toggle('sptube-quickmark-active', isActive());
    }

    function setToggle(value) {
      toggleOn = value;
      updateCursorClass();
      renderers.forEach(fn => fn(toggleOn));
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Shift' && !shiftHeld) { shiftHeld = true; updateCursorClass(); }
      if (e.key === 'Escape' && toggleOn) setToggle(false);
    });
    document.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') { shiftHeld = false; updateCursorClass(); }
    });
    window.addEventListener('blur', () => { shiftHeld = false; updateCursorClass(); });

    // Small on-page toggle so the mode is reachable without a keyboard
    // (touch devices) and discoverable at all (Shift-hold alone is
    // invisible until someone stumbles onto it). Idempotent — safe to
    // call from every engine instance created on the page.
    function ensurePill() {
      if (document.querySelector('.sptube-quickmark-pill')) return;
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'sptube-quickmark-pill';
      pill.title = 'Click, or click-and-drag across several words, to instantly mark them known — no popup. (Or just hold Shift any time, without turning this on.)';
      pill.innerHTML = `<span class="sptube-quickmark-dot"></span><span class="sptube-quickmark-label">Quick Mark</span>`;
      document.documentElement.appendChild(pill);

      function render(active) {
        pill.classList.toggle('active', active);
        pill.querySelector('.sptube-quickmark-label').textContent = active ? 'Quick Mark: ON' : 'Quick Mark';
      }
      render(toggleOn);
      renderers.add(render);

      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        setToggle(!toggleOn);
      });
    }

    return { isActive, ensurePill };
  })();

  // ── Click-through rescue for invisible video overlays ───────────────────
  // Some players keep an invisible "click anywhere to play/pause" layer
  // sitting on top of the whole video — including its captions — so a real
  // pointerdown/click never reaches our word span at all: the browser hands
  // the event to whatever's topmost at that pixel, and no amount of
  // pointer-events tweaking on our own span changes that if something else
  // is genuinely stacked in front of it. This only steps in for events that
  // land within a <video> element's bounds (so it can never hijack unrelated
  // clicks elsewhere on the page) and only when a caption word is actually
  // stacked underneath the real click target — then it forwards the event
  // straight to that word, as if the overlay wasn't there.
  //
  // Rescuing pointerdown specifically (not just click) matters beyond the
  // single click case too: once the word's own pointerdown handler calls
  // setPointerCapture(), the browser routes the rest of that gesture
  // (pointermove/pointerup, and the eventual click) straight to the
  // capturing element regardless of what's on top at the pointer's later
  // positions — so rescuing the very first pointerdown is what makes
  // dragging a selection, or Quick Mark painting, work through one of these
  // overlays too, not just a single tap.
  window.__sptubeOverlayRescue = window.__sptubeOverlayRescue || (function () {
    function landsOnVideo(x, y) {
      const videos = document.querySelectorAll('video');
      for (let i = 0; i < videos.length; i++) {
        const r = videos[i].getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
      }
      return false;
    }

    function findCoveredWord(x, y, realTarget) {
      if (realTarget && realTarget.closest && realTarget.closest('.sptube-word')) return null; // already landed fine
      if (!landsOnVideo(x, y)) return null;
      const stack = document.elementsFromPoint(x, y);
      for (let i = 0; i < stack.length; i++) {
        if (stack[i].classList && stack[i].classList.contains('sptube-word')) return stack[i];
      }
      return null;
    }

    document.addEventListener('pointerdown', (e) => {
      if (!e.isTrusted) return; // ignore our own rescued/re-dispatched events
      const covered = findCoveredWord(e.clientX, e.clientY, e.target);
      if (!covered) return;
      e.preventDefault();
      e.stopPropagation();
      covered.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, composed: true,
        pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary,
        clientX: e.clientX, clientY: e.clientY, button: e.button, buttons: e.buttons,
        ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey,
      }));
    }, true);

    document.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      const covered = findCoveredWord(e.clientX, e.clientY, e.target);
      if (!covered) return;
      e.preventDefault();
      e.stopPropagation();
      covered.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, composed: true,
        clientX: e.clientX, clientY: e.clientY, button: e.button,
        ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey,
      }));
    }, true);

    return {};
  })();

  // ── Fullscreen support ───────────────────────────────────────────────────
  // Video players' native fullscreen (the Fullscreen API) only renders the
  // fullscreen element and its own descendants — anything appended to
  // document.body, which sits *outside* that element while fullscreen, is
  // just not painted at all, even though it's still present in the DOM and
  // "working" from JS's point of view. That's why the popup/tooltip would
  // otherwise silently vanish (not error, just never appear) the moment a
  // video goes fullscreen. Appending them into whatever element is
  // currently fullscreen — falling back to document.body the rest of the
  // time — keeps them inside the part of the page that's actually shown.
  window.__sptubeFullscreen = window.__sptubeFullscreen || (function () {
    function currentRoot() {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement ||
                   document.mozFullScreenElement || document.msFullscreenElement;
      return fsEl || document.body;
    }

    // Also handles the case where fullscreen is entered/exited *while* a
    // popup or tooltip is already open — move it along rather than leaving
    // it behind (invisible) in the old root.
    function reparentOverlays() {
      const root = currentRoot();
      document.querySelectorAll('.sptube-popup, .sptube-hover-tooltip').forEach(el => {
        if (el.parentElement !== root) root.appendChild(el);
      });
    }
    ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach(evt => {
      document.addEventListener(evt, reparentOverlays);
    });

    return { currentRoot };
  })();

  function createEngine(hooks) {
    hooks = Object.assign({
      onHoverStart: function () {},   // called when hover begins on a word span
      onHoverEnd: function () {},     // called when hover ends on a word span
      onActivate: function () {},     // called right before a click/drag popup opens, with the array of spans involved
      onStatsChange: function () {},  // called whenever new words are tokenized or word statuses change (known/learning/new ratio may have moved)
      captureVideoClip: null,         // optional: async (spans) => Blob|null — grabs a short audio clip of the moment those spans were spoken, straight from the page's own <video>. Left null on sites/modes with no video (e.g. plain article Reading Mode).
    }, hooks || {});

    // ── State (one set per engine instance / per page) ──────────────────────
    let vocabulary = {};
    let activePopup = null;
    let activeWordSpans = [];
    let activeTerm = null;
    const tokenizedSegments = new WeakSet();

    // ── Target language (which language the person is learning) ────────────
    let targetLang = window.SPTubeLang.DEFAULT_LANG;
    let langInfo = window.SPTubeLang.getLanguageInfo(targetLang);
    let storageKeys = window.SPTubeLang.storageKeys(targetLang);

    // ── Native language (which language definitions/translations come back
    // in). Loaded independently of the target language above and only
    // changes what future translations are shown in — it doesn't affect
    // word tracking, so no re-tokenizing/re-coloring is needed when it
    // changes, just picking it up for the next translation request. ────────
    let nativeLang = window.SPTubeLang.DEFAULT_NATIVE_LANG;
    window.SPTubeLang.getNativeLanguage((code) => { nativeLang = code; });

    // tokenizeContainer() is called once per transcript segment, and a
    // YouTube transcript panel renders every line at once — often
    // hundreds or thousands of them in a single burst. If each of those
    // calls synchronously triggered onStatsChange() (which walks the DOM
    // to recount every word seen so far), that recount would itself grow
    // with the number of segments already tokenized, turning the whole
    // scan into O(n^2) work and freezing/crashing the tab on long videos.
    // Instead, batch all the notifications from one synchronous burst of
    // tokenizing into a single onStatsChange() call via a microtask.
    let statsChangeScheduled = false;
    function notifyStatsChange() {
      if (statsChangeScheduled) return;
      statsChangeScheduled = true;
      Promise.resolve().then(() => {
        statsChangeScheduled = false;
        hooks.onStatsChange();
      });
    }

    function loadVocabularyForLang(code, callback) {
      targetLang = code;
      langInfo = window.SPTubeLang.getLanguageInfo(code);
      storageKeys = window.SPTubeLang.storageKeys(code);
      chrome.storage.local.get([storageKeys.vocab], (r) => {
        vocabulary = r[storageKeys.vocab] || {};
        callback && callback();
      });
    }

    window.SPTubeLang.migrateLegacyIfNeeded(() => {
      window.SPTubeLang.getTargetLanguage((code) => {
        loadVocabularyForLang(code, reColor);
      });
    });

    window.__sptubeQuickMark.ensurePill();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[window.SPTubeLang.STORAGE_KEY_TARGET_LANG]) {
        closePopup();
        loadVocabularyForLang(changes[window.SPTubeLang.STORAGE_KEY_TARGET_LANG].newValue || window.SPTubeLang.DEFAULT_LANG, reColor);
        return;
      }
      if (changes[window.SPTubeLang.STORAGE_KEY_NATIVE_LANG]) {
        closePopup();
        nativeLang = changes[window.SPTubeLang.STORAGE_KEY_NATIVE_LANG].newValue || window.SPTubeLang.DEFAULT_NATIVE_LANG;
        return;
      }
      if (changes[storageKeys.vocab]) { vocabulary = changes[storageKeys.vocab].newValue || {}; reColor(); }
    });

    function saveVocabulary() {
      chrome.storage.local.set({ [storageKeys.vocab]: vocabulary });
    }

    // Sends a multi-word selection straight into the Build Phrases list
    // (the same per-language "phrases" storage the Build Phrases tool in the
    // manager tab reads/writes), so the learner doesn't have to retype a
    // phrase they've already found and translated on the page. Reads
    // current storage first rather than relying on a locally-cached copy,
    // since the manager tab may have written to it more recently.
    function saveToBuildPhrases(targetText, englishText, videoClipDataUrl, callback, captureLang = targetLang) {
      if (captureLang === 'es') {
        chrome.runtime.sendMessage({ type: 'SAVE_STUDIO_PHRASE', text: targetText, translation: englishText, audioUrl: videoClipDataUrl }, result => {
          const error = chrome.runtime.lastError;
          callback && callback(error || !result?.ok ? null : result.id, error?.message || result?.error, result?.warning);
        });
        return;
      }
      const captureKeys = window.SPTubeLang.storageKeys(captureLang);
      chrome.storage.local.get([captureKeys.phrases], (r) => {
        const phrases = Array.isArray(r[captureKeys.phrases]) ? r[captureKeys.phrases] : [];
        const record = {
          id: 'p' + Date.now() + Math.random().toString(36).slice(2, 8),
          english: englishText,
          userTranslation: '',
          computerTranslation: targetText,
          savedTranslation: targetText,
          source: 'video', // distinguishes "found on the page" from the builder's own 'user'/'computer' choices
          recording: null,
          videoClip: videoClipDataUrl || null, // short audio clip of how it actually sounded, if we managed to capture one
          savedAt: Date.now(),
        };
        chrome.storage.local.set({ [captureKeys.phrases]: [record, ...phrases] }, () => {
          callback && callback(record.id, chrome.runtime.lastError?.message);
        });
      });
    }

    function blobToDataUrl(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('Could not read clip audio'));
        reader.readAsDataURL(blob);
      });
    }

    function getWordStatus(word) {
      return vocabulary[(word || '').toLowerCase()] || 'unknown';
    }

    function statusClass(status) {
      if (status === 'known')    return 'sptube-known';
      if (status === 'learning') return 'sptube-learning';
      return 'sptube-unknown';
    }

    // ── Shared word-span builder ──────────────────────────────────────────
    function buildWordFragment(text, sentence, occurrenceCounts) {
      const fragment = document.createDocumentFragment();
      const tokens = text.split(/(\s+)/);

      tokens.forEach(token => {
        if (/^\s*$/.test(token)) {
          fragment.appendChild(document.createTextNode(token));
          return;
        }
        const core = token.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
        if (!core) {
          fragment.appendChild(document.createTextNode(token));
          return;
        }
        const status = getWordStatus(core);
        const span = document.createElement('span');
        span.className = `sptube-word ${statusClass(status)}`;
        span.dataset.word = core;
        span.dataset.sentence = sentence;
        const key = core.toLowerCase();
        const occurrence = occurrenceCounts.get(key) || 0;
        occurrenceCounts.set(key, occurrence + 1);
        span.dataset.occurrence = String(occurrence);
        span.textContent = token;
        span.addEventListener('click', onWordClick);
        span.addEventListener('pointerdown', onWordMouseDown);
        span.addEventListener('mouseenter', onWordMouseEnter);
        span.addEventListener('mouseleave', onWordMouseLeave);
        fragment.appendChild(span);
      });

      return fragment;
    }

    // ── Tokenize a static block of text (transcript segment, article
    // paragraph, book chapter, etc.) into clickable word spans. Safe to
    // call repeatedly — a container is only ever tokenized once. ─────────
    function tokenizeContainer(container) {
      if (!container) return;
      if (tokenizedSegments.has(container)) return;
      if (!container.textContent.trim()) return;
      if (container.querySelector('.sptube-word')) return;
      tokenizedSegments.add(container);
      container.classList.add('sptube-sentence-container');

      const sentence = container.textContent.trim();

      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
          if (node.parentElement?.classList.contains('sptube-word')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const textNodes = [];
      let n;
      while ((n = walker.nextNode())) textNodes.push(n);
      const occurrenceCounts = new Map();
      textNodes.forEach(tn => replaceTextNode(tn, sentence, occurrenceCounts));
      applyPhraseOverrides(container);
      notifyStatsChange();
    }

    function replaceTextNode(textNode, sentence, occurrenceCounts) {
      const parent = textNode.parentNode;
      if (!parent) return;
      const fragment = buildWordFragment(textNode.textContent, sentence, occurrenceCounts);
      try { parent.replaceChild(fragment, textNode); }
      catch (e) {}
    }

    // ── Tokenize an element whose text content can change in place (e.g.
    // YouTube's live caption line). Re-renders whenever the text differs
    // from what was last rendered, rather than skipping after the first
    // pass like tokenizeContainer does. ───────────────────────────────────
    function tokenizeDynamicElement(el) {
      const text = el.textContent;
      if (!text || !text.trim()) return;
      if (el.dataset.sptubeRaw === text) return;
      el.dataset.sptubeRaw = text;
      el.classList.add('sptube-sentence-container');

      const sentence = text.trim();
      const occurrenceCounts = new Map();
      const fragment = buildWordFragment(text, sentence, occurrenceCounts);

      el.textContent = '';
      el.appendChild(fragment);
      applyPhraseOverrides(el);
      notifyStatsChange();
    }

    // ── Re-color rendered word spans ─────────────────────────────────────
    function reColor() {
      document.querySelectorAll('.sptube-word').forEach(span => {
        span.className = `sptube-word ${statusClass(getWordStatus(span.dataset.word))}`;
      });
      document.querySelectorAll('.sptube-sentence-container').forEach(applyPhraseOverrides);
      notifyStatsChange();
    }

    // ── Saved phrases override individual words ────────────────────────────
    // If the user has saved a multi-word phrase (e.g. "me di cuenta"), that
    // phrase should be treated as one term wherever it's found again — even
    // though its individual words might separately be saved (or not saved)
    // on their own. This scans each sentence container's word spans for any
    // saved phrase (longest match wins) and, where found, re-colors those
    // spans with the phrase's status and marks them so a click on any word
    // in the run opens/edits the phrase as a whole rather than that one word.
    let phraseGroupCounter = 0;

    function getPhraseVocabEntries() {
      // Only contiguous, same-line phrases (space-joined) can be matched by
      // scanning text; cross-line phrases are saved with a "…" separator
      // and have no single contiguous run of spans to match against.
      return Object.keys(vocabulary)
        .map(key => ({ key, words: key.split(/\s+/).filter(Boolean) }))
        .filter(entry => entry.words.length > 1 && entry.key.indexOf('…') === -1)
        .sort((a, b) => b.words.length - a.words.length); // longest phrase first
    }

    function clearPhraseOverrides(container) {
      getOrderedWordSpans(container).forEach(span => {
        if (!span.dataset.sptubePhraseId) return;
        delete span.dataset.sptubePhraseId;
        delete span.dataset.sptubePhraseTerm;
        span.className = `sptube-word ${statusClass(getWordStatus(span.dataset.word))}`;
      });
    }

    function applyPhraseOverrides(container) {
      if (!container || !container.querySelectorAll) return;
      clearPhraseOverrides(container);
      const phraseEntries = getPhraseVocabEntries();
      if (!phraseEntries.length) return;

      const spans = getOrderedWordSpans(container);
      const lower = spans.map(s => (s.dataset.word || '').toLowerCase());

      let i = 0;
      while (i < spans.length) {
        let match = null;
        for (const entry of phraseEntries) {
          const len = entry.words.length;
          if (i + len > spans.length) continue;
          let ok = true;
          for (let j = 0; j < len; j++) {
            if (lower[i + j] !== entry.words[j]) { ok = false; break; }
          }
          if (ok) { match = entry; break; }
        }
        if (match) {
          const groupSpans = spans.slice(i, i + match.words.length);
          const groupId = 'pg' + (++phraseGroupCounter);
          const term = groupSpans.map(s => s.dataset.word).join(' ');
          const status = getWordStatus(match.key);
          groupSpans.forEach(s => {
            s.dataset.sptubePhraseId = groupId;
            s.dataset.sptubePhraseTerm = term;
            s.className = `sptube-word sptube-phrase-word ${statusClass(status)}`;
          });
          i += match.words.length;
        } else {
          i += 1;
        }
      }
    }

    function getPhraseGroupSpans(span) {
      const id = span.dataset.sptubePhraseId;
      if (!id) return null;
      const container = span.closest('.sptube-sentence-container') || span.parentElement;
      const scope = container || document;
      const groupSpans = Array.from(scope.querySelectorAll('.sptube-word'))
        .filter(s => s.dataset.sptubePhraseId === id);
      return groupSpans.length > 1 ? groupSpans : null;
    }

    // ── Known / learning / new ratio ───────────────────────────────────────
    // Tallies the word spans found within `roots` (a single element, an
    // array/NodeList of elements, or omitted for the whole document) by
    // status. Used to power the on-page "% known / learning / new" badges.
    function getStats(roots) {
      const list = roots == null ? [document]
        : (roots.length !== undefined && typeof roots !== 'string') ? [...roots]
        : [roots];
      const seen = new Set();
      let known = 0, learning = 0, unknown = 0;
      list.forEach(scope => {
        if (!scope || !scope.querySelectorAll) return;
        scope.querySelectorAll('.sptube-word').forEach(span => {
          if (seen.has(span)) return;
          seen.add(span);
          const status = getWordStatus(span.dataset.word);
          if (status === 'known') known++;
          else if (status === 'learning') learning++;
          else unknown++;
        });
      });
      const total = known + learning + unknown;
      const knownPct = total ? Math.round((known / total) * 100) : 0;
      const learningPct = total ? Math.round((learning / total) * 100) : 0;
      const unknownPct = total ? Math.max(0, 100 - knownPct - learningPct) : 0;
      return { total, known, learning, unknown, knownPct, learningPct, unknownPct };
    }

    // ── Message helpers ───────────────────────────────────────────────────
    function translateWordInContext(sentence, word, occurrence) {
      return new Promise(resolve => {
        const clean = (word || '')
          .toLowerCase()
          .replace(/[^\p{L}\s]/gu, '')
          .trim()
          .replace(/\s+/g, ' ');
        if (!clean || !sentence) { resolve(null); return; }
        chrome.runtime.sendMessage({ type: 'TRANSLATE_WORD_IN_CONTEXT', sentence, word: clean, occurrence: occurrence || 0, lang: targetLang, nativeLang }, r => {
          void chrome.runtime.lastError;
          resolve(r ?? null);
        });
      });
    }

    // Translates exactly the given text on its own — no surrounding sentence
    // sent along, no context-based word alignment. Used for multi-word
    // selections, where showing/translating the full sentence around them
    // would be more (and different) than what the person actually selected.
    function translatePhraseDirect(text) {
      return new Promise(resolve => {
        // " … " is just how non-contiguous multi-line selections are
        // *displayed* (see openPhrasePopupFromGroups) — collapse it to a
        // plain space before sending, so it doesn't show up literally in
        // the translation.
        const clean = (text || '').split(' … ').join(' ').trim();
        if (!clean) { resolve(null); return; }
        chrome.runtime.sendMessage({ type: 'TRANSLATE_PHRASE_DIRECT', text: clean, lang: targetLang, nativeLang }, r => {
          void chrome.runtime.lastError;
          resolve(r ? { translation: r, start: null, end: null } : null);
        });
      });
    }

    // ── Persisted definitions for saved words ─────────────────────────────
    function normalizeRanges(a, b) {
      let list;
      if (Array.isArray(a)) list = a;
      else if (a != null && b != null) list = [{ start: a, end: b }];
      else return [];
      return list
        .filter(r => r && r.start != null && r.end != null && r.start >= 0 && r.start < r.end)
        .sort((x, y) => x.start - y.start);
    }

    function extractMatched(translation, a, b) {
      const ranges = normalizeRanges(a, b).filter(r => r.end <= translation.length);
      if (!ranges.length) return translation;
      return ranges.map(r => translation.slice(r.start, r.end)).join(' … ');
    }

    function getSavedDefinitions(word, callback) {
      const key = (word || '').toLowerCase();
      chrome.storage.local.get([storageKeys.defs], (r) => {
        let list = r[storageKeys.defs] ? r[storageKeys.defs][key] : null;
        if (!Array.isArray(list)) list = list ? [list] : [];
        callback(list);
      });
    }

    function saveDefinition(word, sentence, translation, ranges, end) {
      const key = (word || '').toLowerCase();
      if (!key || !translation) return;
      const normRanges = normalizeRanges(ranges, end);
      const matched = extractMatched(translation, normRanges);
      chrome.storage.local.get([storageKeys.defs], (r) => {
        const defs = r[storageKeys.defs] || {};
        let list = defs[key];
        if (!Array.isArray(list)) list = list ? [list] : [];
        const isDuplicate = list.some(entry =>
          (entry.matched || '').trim().toLowerCase() === matched.trim().toLowerCase()
        );
        if (!isDuplicate) {
          list.push({
            word, sentence, translation, matched,
            start: normRanges[0] ? normRanges[0].start : null,
            end: normRanges[0] ? normRanges[0].end : null,
            ranges: normRanges,
            savedAt: Date.now()
          });
        }
        defs[key] = list;
        chrome.storage.local.set({ [storageKeys.defs]: defs });
      });
    }

    function saveCustomDefinition(word, sentence, text, callback) {
      const key = (word || '').toLowerCase();
      const clean = (text || '').trim();
      if (!key || !clean) return;
      chrome.storage.local.get([storageKeys.defs], (r) => {
        const defs = r[storageKeys.defs] || {};
        let list = defs[key];
        if (!Array.isArray(list)) list = list ? [list] : [];
        list.push({
          word, sentence, translation: clean, matched: clean,
          start: null, end: null, savedAt: Date.now(), custom: true
        });
        defs[key] = list;
        chrome.storage.local.set({ [storageKeys.defs]: defs }, () => callback && callback(list));
      });
    }

    function deleteDefinition(word, index, callback) {
      const key = (word || '').toLowerCase();
      chrome.storage.local.get([storageKeys.defs], (r) => {
        const defs = r[storageKeys.defs] || {};
        let list = defs[key];
        if (!Array.isArray(list)) list = list ? [list] : [];
        list.splice(index, 1);
        if (list.length) defs[key] = list; else delete defs[key];
        chrome.storage.local.set({ [storageKeys.defs]: defs }, () => callback && callback(list));
      });
    }

    function updateDefinitionHighlight(word, index, matched, ranges, callback) {
      const key = (word || '').toLowerCase();
      const normRanges = normalizeRanges(ranges);
      chrome.storage.local.get([storageKeys.defs], (r) => {
        const defs = r[storageKeys.defs] || {};
        let list = defs[key];
        if (!Array.isArray(list)) list = list ? [list] : [];
        if (list[index]) {
          list[index] = {
            ...list[index],
            matched,
            ranges: normRanges,
            start: normRanges[0] ? normRanges[0].start : null,
            end: normRanges[0] ? normRanges[0].end : null,
          };
        }
        defs[key] = list;
        chrome.storage.local.set({ [storageKeys.defs]: defs }, () => callback && callback(list));
      });
    }

    function renderSavedMeanings(word, containerEl, listEl) {
      getSavedDefinitions(word, (list) => {
        if (!activePopup || !containerEl.isConnected) return;
        if (list.length === 0) {
          containerEl.style.display = 'none';
          listEl.innerHTML = '';
          return;
        }
        containerEl.style.display = 'block';
        listEl.innerHTML = list.map((entry, i) => {
          const highlight = entry.matched || entry.translation || '';
          return `
            <div class="sptube-saved-entry" data-index="${i}">
              <div class="sptube-saved-row">
                <button class="sptube-saved-highlight" data-index="${i}">${escHtml(highlight)}</button>
                ${entry.custom ? '<span class="sptube-custom-badge" title="Your own translation">you</span>' : ''}
                <button class="sptube-saved-edit" data-index="${i}" title="Edit highlight">✎</button>
                <button class="sptube-saved-delete" data-index="${i}" title="Delete this meaning">🗑</button>
              </div>
              <div class="sptube-saved-sentence" id="sptube-saved-sentence-${i}" style="display:none">
                <div class="sptube-saved-sentence-text">${buildHighlightedSentenceHtml(entry.translation || '', entry.ranges && entry.ranges.length ? entry.ranges : entry.start, entry.ranges && entry.ranges.length ? undefined : entry.end)}</div>
                <div class="sptube-saved-sentence-controls"></div>
              </div>
            </div>
          `;
        }).join('');

        listEl.querySelectorAll('.sptube-saved-highlight').forEach(btn => {
          btn.addEventListener('click', ev => {
            ev.stopPropagation();
            const el = listEl.querySelector(`#sptube-saved-sentence-${btn.dataset.index}`);
            if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
          });
        });

        listEl.querySelectorAll('.sptube-saved-delete').forEach(btn => {
          btn.addEventListener('click', ev => {
            ev.stopPropagation();
            const idx = Number(btn.dataset.index);
            deleteDefinition(word, idx, () => renderSavedMeanings(word, containerEl, listEl));
          });
        });

        listEl.querySelectorAll('.sptube-saved-edit').forEach(btn => {
          btn.addEventListener('click', ev => {
            ev.stopPropagation();
            const idx = Number(btn.dataset.index);
            const entry = list[idx];
            const wrap = listEl.querySelector(`#sptube-saved-sentence-${idx}`);
            if (!wrap || !entry) return;
            wrap.style.display = 'block';
            const textEl = wrap.querySelector('.sptube-saved-sentence-text');
            const controlsHost = wrap.querySelector('.sptube-saved-sentence-controls');
            if (!controlsHost.dataset.bound) {
              controlsHost.dataset.bound = '1';
              attachHighlightEditor(textEl, entry.translation || '', controlsHost, (ranges, matchedText) => {
                if (!ranges || !ranges.length) return;
                updateDefinitionHighlight(word, idx, matchedText, ranges, () => {
                  renderSavedMeanings(word, containerEl, listEl);
                });
              });
            }
            const editBtn = controlsHost.querySelector('.sptube-edit-highlight-btn');
            if (editBtn) editBtn.click();
          });
        });
      });
    }

    // ── Highlight editor ───────────────────────────────────────────────────
    function computeSelectionOffsets(containerEl) {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      const range = sel.getRangeAt(0);
      if (!containerEl.contains(range.startContainer) || !containerEl.contains(range.endContainer)) return null;
      const preRange = document.createRange();
      preRange.selectNodeContents(containerEl);
      preRange.setEnd(range.startContainer, range.startOffset);
      const start = preRange.toString().length;
      const end = start + range.toString().length;
      if (end <= start) return null;
      return { start, end };
    }

    function attachHighlightEditor(containerEl, plainText, controlsHost, onSave) {
      const editBtn = document.createElement('button');
      editBtn.className = 'sptube-edit-highlight-btn';
      editBtn.type = 'button';
      editBtn.textContent = '✎ Edit highlight';
      controlsHost.appendChild(editBtn);

      editBtn.addEventListener('click', ev => {
        ev.stopPropagation();
        const originalHtml = containerEl.innerHTML;
        containerEl.textContent = plainText;
        containerEl.classList.add('sptube-highlight-editing');
        editBtn.style.display = 'none';

        let ranges = [];

        const hint = document.createElement('div');
        hint.className = 'sptube-highlight-hint';
        hint.textContent = 'Select the word(s) to highlight. Since word order can differ from the translation, hold Ctrl (⌘ on Mac) while selecting again to add a second, separate part — then Save.';
        const controls = document.createElement('div');
        controls.className = 'sptube-highlight-controls';
        controls.innerHTML = `<button class="sptube-highlight-save" type="button">💾 Save</button><button class="sptube-highlight-clear" type="button">Clear</button><button class="sptube-highlight-cancel" type="button">Cancel</button>`;

        controlsHost.insertBefore(hint, editBtn);
        controlsHost.insertBefore(controls, editBtn);

        function renderPreview() {
          containerEl.innerHTML = ranges.length
            ? buildHighlightedSentenceHtml(plainText, ranges)
            : escHtml(plainText);
        }

        function onContainerMouseUp(e) {
          const offsets = computeSelectionOffsets(containerEl);
          if (!offsets) return;
          if ((e.ctrlKey || e.metaKey) && ranges.length >= 1) {
            ranges = [ranges[0], offsets];
          } else {
            ranges = [offsets];
          }
          renderPreview();
          const sel = window.getSelection();
          if (sel) sel.removeAllRanges();
        }
        containerEl.addEventListener('mouseup', onContainerMouseUp);

        function cleanup() {
          containerEl.removeEventListener('mouseup', onContainerMouseUp);
          hint.remove();
          controls.remove();
          containerEl.classList.remove('sptube-highlight-editing');
          editBtn.style.display = '';
        }

        controls.querySelector('.sptube-highlight-cancel').addEventListener('click', ev2 => {
          ev2.stopPropagation();
          containerEl.innerHTML = originalHtml;
          cleanup();
        });
        controls.querySelector('.sptube-highlight-clear').addEventListener('click', ev2 => {
          ev2.stopPropagation();
          ranges = [];
          renderPreview();
        });
        controls.querySelector('.sptube-highlight-save').addEventListener('click', ev2 => {
          ev2.stopPropagation();
          if (!ranges.length) {
            containerEl.innerHTML = originalHtml;
            cleanup();
            return;
          }
          const sorted = ranges.slice().sort((x, y) => x.start - y.start);
          containerEl.innerHTML = buildHighlightedSentenceHtml(plainText, sorted);
          cleanup();
          const matched = sorted.map(r => plainText.slice(r.start, r.end)).join(' … ');
          onSave(sorted, matched);
        });
      });
    }

    // ── Hover tooltip (definition in context, no click needed) ────────────
    let hoverTooltip = null;
    let hoverTimer = null;
    let hoverToken = 0;
    let currentHoverSpan = null;
    const HOVER_DELAY_MS = 300;

    // ── Drag-to-select multiple words ──────────────────────────────────────
    // Normally one drag (or one click) finalizes immediately. Holding Ctrl
    // (Cmd on Mac) while releasing a selection instead "banks" it and waits
    // for another selection — anywhere, including a different transcript
    // line/container — so a phrase split across two lines (e.g. "no me di"
    // on one line, "cuenta" on the next) can be built up as one term. The
    // next selection made *without* Ctrl held finalizes everything banked
    // so far into one phrase and opens the popup.
    let dragActive = false;
    let dragAnchorSpan = null;
    let dragContainer = null;
    let dragSelectedSpans = [];
    let justFinishedDragSelection = false;
    let phraseGroups = [];              // banked ranges, each an array of spans, in selection order
    let phraseExpiryTimer = null;

    function clearSelectionHighlight() {
      dragSelectedSpans.forEach(s => s.classList.remove('sptube-selecting'));
      dragSelectedSpans = [];
    }

    function schedulePhraseExpiry() {
      clearTimeout(phraseExpiryTimer);
      // If the user banks a selection and then walks away instead of
      // finishing the phrase, don't leave it silently waiting forever —
      // drop it (and its highlight) after a few seconds of inactivity.
      phraseExpiryTimer = setTimeout(cancelPendingPhrase, 8000);
    }

    function cancelPendingPhrase() {
      clearTimeout(phraseExpiryTimer);
      phraseExpiryTimer = null;
      phraseGroups.forEach(group => group.forEach(s => s.classList.remove('sptube-selecting')));
      phraseGroups = [];
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && phraseGroups.length) cancelPendingPhrase();
    });

    function finalizePendingPhrase(finalSpans) {
      clearTimeout(phraseExpiryTimer);
      phraseExpiryTimer = null;
      if (finalSpans && finalSpans.length) phraseGroups.push(finalSpans);
      const groups = phraseGroups;
      phraseGroups = [];
      const allSpans = [].concat(...groups);
      if (allSpans.length === 0) return;
      if (allSpans.length === 1) {
        const span = allSpans[0];
        span.classList.remove('sptube-selecting');
        openPopupForTerm(span.dataset.word, span.dataset.sentence || '', Number(span.dataset.occurrence || 0), [span]);
        return;
      }
      openPhrasePopupFromGroups(groups);
    }

    function getOrderedWordSpans(container) {
      return Array.from(container.querySelectorAll('.sptube-word'));
    }

    function updateDragSelection(currentSpan) {
      if (!dragContainer) return;
      dragSelectedSpans.forEach(s => s.classList.remove('sptube-selecting'));
      const spans = getOrderedWordSpans(dragContainer);
      const ai = spans.indexOf(dragAnchorSpan);
      const ci = spans.indexOf(currentSpan);
      if (ai === -1 || ci === -1) { dragSelectedSpans = []; return; }
      const lo = Math.min(ai, ci), hi = Math.max(ai, ci);
      dragSelectedSpans = spans.slice(lo, hi + 1);
      dragSelectedSpans.forEach(s => s.classList.add('sptube-selecting'));
    }

    // ── Quick Mark painting ─────────────────────────────────────────────
    // See window.__sptubeQuickMark above for the mode itself; this is the
    // per-engine mechanics of actually applying it to that engine's own
    // vocabulary/spans. Dragging back over an already-known word mid-pass
    // is left alone rather than toggled off, so one pass never accidentally
    // un-marks something it merely re-crossed; to undo mistakes instead,
    // start the drag ON an already-known word and the whole pass flips
    // into "erase" mode.
    let quickPainting = false;
    let quickPaintAnchor = null;
    let quickPaintMode = 'mark';
    let quickPaintTouched = null;

    function applyQuickPaint(span) {
      const word = span.dataset.word;
      if (!word || quickPaintTouched.has(span)) return;
      quickPaintTouched.add(span);
      const key = word.toLowerCase();
      if (quickPaintMode === 'erase') {
        if (vocabulary[key] === 'known') delete vocabulary[key];
      } else if (vocabulary[key] !== 'known') {
        vocabulary[key] = 'known';
      }
      span.className = `sptube-word ${statusClass(getWordStatus(word))} sptube-quick-marked`;
    }

    function startQuickMarkPaint(span, e) {
      closePopup();
      hideHoverTooltip();
      clearTimeout(hoverTimer);
      quickPainting = true;
      quickPaintAnchor = span;
      quickPaintMode = getWordStatus(span.dataset.word) === 'known' ? 'erase' : 'mark';
      quickPaintTouched = new Set();
      applyQuickPaint(span);

      if (e.pointerId != null && span.setPointerCapture) {
        try { span.setPointerCapture(e.pointerId); } catch (err) {}
      }
      span.addEventListener('pointermove', onQuickPaintMove);
      span.addEventListener('pointerup', onQuickPaintUp);
      span.addEventListener('pointercancel', onQuickPaintUp);
    }

    function onQuickPaintMove(e) {
      if (!quickPainting) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const span = el ? el.closest('.sptube-word') : null;
      if (span) applyQuickPaint(span);
    }

    function onQuickPaintUp(e) {
      const anchor = quickPaintAnchor;
      if (anchor) {
        if (e.pointerId != null && anchor.releasePointerCapture) {
          try { anchor.releasePointerCapture(e.pointerId); } catch (err) {}
        }
        anchor.removeEventListener('pointermove', onQuickPaintMove);
        anchor.removeEventListener('pointerup', onQuickPaintUp);
        anchor.removeEventListener('pointercancel', onQuickPaintUp);
      }
      quickPainting = false;
      quickPaintAnchor = null;
      quickPaintTouched = null;
      saveVocabulary();
      reColor(); // also clears the transient .sptube-quick-marked highlight and reapplies phrase overrides
      justFinishedDragSelection = true; // swallow the trailing synthetic click
      setTimeout(() => { justFinishedDragSelection = false; }, 60);
    }

    function onWordMouseDown(e) {
      if (e.button !== 0) return;
      if (activePopup) return;
      if (e.pointerType !== 'touch') e.preventDefault();

      const span = e.currentTarget;

      if (window.__sptubeQuickMark.isActive()) {
        startQuickMarkPaint(span, e);
        return;
      }

      dragActive = true;
      dragAnchorSpan = span;
      dragContainer = span.closest('.sptube-sentence-container') || span.parentElement;
      clearSelectionHighlight();
      updateDragSelection(span);

      if (e.pointerId != null && span.setPointerCapture) {
        try { span.setPointerCapture(e.pointerId); } catch (err) {}
      }
      span.addEventListener('pointermove', onDragPointerMove);
      span.addEventListener('pointerup', onDragPointerUp);
      span.addEventListener('pointercancel', onDragPointerUp);
    }

    function onDragPointerMove(e) {
      if (!dragActive) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const span = el ? el.closest('.sptube-word') : null;
      if (span && span.closest('.sptube-sentence-container') === dragContainer) {
        updateDragSelection(span);
      }
    }

    function onDragPointerUp(e) {
      const anchor = dragAnchorSpan;
      if (anchor) {
        if (e.pointerId != null && anchor.releasePointerCapture) {
          try { anchor.releasePointerCapture(e.pointerId); } catch (err) {}
        }
        anchor.removeEventListener('pointermove', onDragPointerMove);
        anchor.removeEventListener('pointerup', onDragPointerUp);
        anchor.removeEventListener('pointercancel', onDragPointerUp);
      }
      dragActive = false;
      const thisRange = dragSelectedSpans.slice();
      dragSelectedSpans = [];
      dragAnchorSpan = null;
      dragContainer = null;

      if (thisRange.length <= 1 && phraseGroups.length === 0) {
        // Plain click-through-drag with nothing banked — let the upcoming
        // native 'click' event handle it exactly like a normal single click.
        thisRange.forEach(s => s.classList.remove('sptube-selecting'));
        return;
      }

      justFinishedDragSelection = true; // swallow the trailing synthetic click either way
      setTimeout(() => { justFinishedDragSelection = false; }, 60);

      if (e.ctrlKey || e.metaKey) {
        // More to come — bank this range and wait for the next Ctrl-held
        // selection, which can be anywhere (e.g. the next transcript line).
        if (thisRange.length) {
          phraseGroups.push(thisRange);
          schedulePhraseExpiry();
        }
        return;
      }

      finalizePendingPhrase(thisRange);
    }


    function onWordMouseEnter(e) {
      if (dragActive || quickPainting) return;
      if (window.__sptubeQuickMark.isActive()) return; // skip the translate-on-hover fetch while quick-marking
      const span = e.currentTarget;
      currentHoverSpan = span;
      hooks.onHoverStart(span);

      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => {
        if (currentHoverSpan === span) showHoverTooltip(span);
      }, HOVER_DELAY_MS);
    }

    function onWordMouseLeave(e) {
      const span = e.currentTarget;
      if (currentHoverSpan === span) currentHoverSpan = null;
      clearTimeout(hoverTimer);
      hideHoverTooltip();
      hooks.onHoverEnd(span);
    }

    function hideHoverTooltip() {
      if (hoverTooltip) { hoverTooltip.remove(); hoverTooltip = null; }
    }

    function isSameLanguageMode() {
      return targetLang === nativeLang;
    }

    async function showHoverTooltip(span) {
      if (activePopup) return;
      const phraseGroup = getPhraseGroupSpans(span);
      const word = phraseGroup ? (span.dataset.sptubePhraseTerm || span.dataset.word) : span.dataset.word;
      const sentence = span.dataset.sentence || '';
      const occurrence = phraseGroup ? 0 : Number(span.dataset.occurrence || 0);
      if (!word || !sentence) return;

      const myToken = ++hoverToken;
      const sameLang = isSameLanguageMode();

      hideHoverTooltip();
      const tooltip = document.createElement('div');
      tooltip.className = 'sptube-hover-tooltip';
      tooltip.innerHTML = `
        <div class="sptube-hover-word">${escHtml(word)}</div>
        <div class="sptube-hover-body">${sameLang ? 'Finding a synonym…' : 'Translating…'}</div>
      `;
      positionNearSpan(tooltip, span);
      window.__sptubeFullscreen.currentRoot().appendChild(tooltip);
      hoverTooltip = tooltip;

      const result = await (phraseGroup ? translatePhraseDirect(word) : translateWordInContext(sentence, word, occurrence));
      if (myToken !== hoverToken || hoverTooltip !== tooltip) return;

      const bodyEl = tooltip.querySelector('.sptube-hover-body');
      if (result && result.translation) {
        bodyEl.innerHTML = buildHighlightedSentenceHtml(result.translation, result.start, result.end);
      } else {
        bodyEl.innerHTML = sameLang
          ? `No synonym found for "<em>${escHtml(word)}</em>"`
          : `No translation found for "<em>${escHtml(word)}</em>"`;
      }
      positionNearSpan(tooltip, span);
    }

    function positionNearSpan(el, span) {
      const rect = span.getBoundingClientRect();
      el.style.cssText = `
        position: fixed;
        top: ${Math.min(rect.bottom + 6, window.innerHeight - 160)}px;
        left: ${Math.min(Math.max(rect.left, 4), window.innerWidth - 296)}px;
        z-index: 2147483646;
      `;
    }

    // ── Popup ────────────────────────────────────────────────────────────
    function closePopup() {
      if (activePopup) { activePopup.remove(); activePopup = null; }
      activeWordSpans.forEach(s => s.classList.remove('sptube-active-word', 'sptube-selecting'));
      activeWordSpans = [];
      activeTerm = null;
    }

    function buildHighlightedSentenceHtml(text, a, b) {
      const ranges = normalizeRanges(a, b).filter(r => r.end <= text.length);
      if (!ranges.length) return escHtml(text);
      let html = '';
      let cursor = 0;
      ranges.forEach(r => {
        if (r.start < cursor) return;
        html += escHtml(text.slice(cursor, r.start));
        html += `<mark class="sptube-context-highlight">${escHtml(text.slice(r.start, r.end))}</mark>`;
        cursor = r.end;
      });
      html += escHtml(text.slice(cursor));
      return html;
    }

    function onWordClick(e) {
      if (justFinishedDragSelection) { justFinishedDragSelection = false; return; }
      e.stopPropagation();
      e.preventDefault();

      const span = e.currentTarget;
      const word = span.dataset.word;
      if (!word) return;

      const ctrlHeld = e.ctrlKey || e.metaKey;
      if (ctrlHeld || phraseGroups.length > 0) {
        hideHoverTooltip();
        clearTimeout(hoverTimer);
        if (ctrlHeld) {
          // Bank this single word and wait for the next Ctrl-held selection.
          span.classList.add('sptube-selecting');
          phraseGroups.push([span]);
          schedulePhraseExpiry();
        } else {
          // Non-Ctrl click while a phrase is pending — this word finishes it.
          finalizePendingPhrase([span]);
        }
        return;
      }

      closePopup();
      hideHoverTooltip();
      clearTimeout(hoverTimer);

      // A saved phrase overpowers the individual word: clicking any word
      // that's part of a matched saved phrase opens/edits the phrase as
      // one term instead of just that single word.
      const phraseGroup = getPhraseGroupSpans(span);
      if (phraseGroup) {
        const term = span.dataset.sptubePhraseTerm || phraseGroup.map(s => s.dataset.word).join(' ');
        openPopupForTerm(term, span.dataset.sentence || '', 0, phraseGroup, phraseGroup, 1, true);
        return;
      }

      const sentence = span.dataset.sentence || '';
      const occurrence = Number(span.dataset.occurrence || 0);
      openPopupForTerm(word, sentence, occurrence, [span]);
    }

    function openPhrasePopupFromGroups(groups) {
      const allSpans = [].concat(...groups);
      if (allSpans.length < 2) return;
      closePopup();
      hideHoverTooltip();
      clearTimeout(hoverTimer);
      // Non-contiguous parts (from different lines/containers) are joined
      // with " … " both in the term shown to the user and — since it gets
      // stripped by translateWordInContext's cleanup — invisibly in what's
      // sent for translation, so it reads as one continuous phrase there.
      const phrase = groups.map(g => g.map(s => s.dataset.word).join(' ')).join(' … ');
      const sentences = [];
      groups.forEach(g => {
        const s = g[0] && g[0].dataset.sentence;
        if (s && !sentences.includes(s)) sentences.push(s);
      });
      const sentence = sentences.join(' … ');
      const lastGroup = groups[groups.length - 1];
      openPopupForTerm(phrase, sentence, 0, allSpans, lastGroup, groups.length);
    }


    async function openPopupForTerm(term, sentence, occurrence, spans, anchorSpans, partCount, matchedPhrase) {
      const isPhrase = spans.length > 1;
      const posSpans = anchorSpans && anchorSpans.length ? anchorSpans : spans;
      const anchorSpan = posSpans[0];

      hooks.onActivate(spans);

      spans.forEach(s => s.classList.remove('sptube-selecting'));
      spans.forEach(s => s.classList.add('sptube-active-word'));
      activeWordSpans = spans;
      activeTerm = term;

      const status = getWordStatus(term);
      const sameLang = isSameLanguageMode();
      const popup = document.createElement('div');
      popup.className = 'sptube-popup';

      const firstRect = anchorSpan.getBoundingClientRect();
      const lastRect = posSpans[posSpans.length - 1].getBoundingClientRect();
      const rect = {
        left: Math.min(firstRect.left, lastRect.left),
        bottom: Math.max(firstRect.bottom, lastRect.bottom),
      };

      popup.innerHTML = `
        <div class="sptube-popup-header">
          <span class="sptube-popup-word">${escHtml(term)}</span>
          <button class="sptube-popup-close" title="Close">✕</button>
        </div>
        ${isPhrase ? `<div class="sptube-phrase-note">${matchedPhrase ? `🔗 Saved phrase — these ${spans.length} words are treated as one term` : `📎 Selected ${spans.length} words${partCount > 1 ? ` across ${partCount} lines` : ''} as one term`}</div>` : ''}
        <div class="sptube-saved-meanings" style="display:none">
          <div class="sptube-saved-title">Saved meanings</div>
          <div class="sptube-saved-list"></div>
        </div>
        <div class="sptube-popup-loading">
          <div class="sptube-spinner"></div>
          <span>${sameLang ? 'Finding a synonym…' : 'Translating…'}</span>
        </div>
        <div class="sptube-sentence-block" style="display:none">
          <p class="sptube-sentence-translation"></p>
          <div class="sptube-sentence-controls"></div>
        </div>
        <div class="sptube-custom-block">
          <div class="sptube-custom-label">${sameLang ? 'Add your own synonym' : 'Add your own translation'}</div>
          <div class="sptube-custom-row">
            <input type="text" class="sptube-custom-input" placeholder="${sameLang ? 'Type a synonym…' : 'Type your translation…'}" />
            <button class="sptube-custom-save" type="button">Save</button>
          </div>
        </div>
        <div class="sptube-save-variant" style="display:none"></div>
        <div class="sptube-popup-actions">
          <button class="sptube-btn sptube-btn-learning ${status === 'learning' ? 'active' : ''}" data-action="learning">📙 Learning</button>
          <button class="sptube-btn sptube-btn-known ${status === 'known' ? 'active' : ''}" data-action="known">✅ Know it</button>
        </div>
        ${isPhrase ? `<button class="sptube-btn sptube-btn-buildphrase" data-action="build-phrase" style="display:none">${targetLang === 'es' ? 'Practice this phrase ↗' : 'Save to Build Phrases'}</button>` : ''}
        <div class="sptube-status-label">
          ${status !== 'unknown' ? `Marked: <strong>${status}</strong>` : 'Not yet categorized'}
        </div>
      `;

      popup.style.cssText = `
        position: fixed;
        top: ${Math.min(rect.bottom + 6, window.innerHeight - 340)}px;
        left: ${Math.min(Math.max(rect.left, 4), window.innerWidth - 316)}px;
        z-index: 2147483647;
      `;

      window.__sptubeFullscreen.currentRoot().appendChild(popup);
      activePopup = popup;
      makePopupDraggable(popup);

      let currentTranslation = null;

      popup.querySelector('.sptube-popup-close').addEventListener('click', ev => {
        ev.stopPropagation(); closePopup();
      });
      popup.querySelectorAll('.sptube-popup-actions [data-action]').forEach(btn => {
        btn.addEventListener('click', ev => {
          ev.stopPropagation();
          const action = btn.dataset.action;
          const turningOn = getWordStatus(term) !== action;
          if (getWordStatus(term) === action) {
            delete vocabulary[term.toLowerCase()];
          } else {
            vocabulary[term.toLowerCase()] = action;
          }
          saveVocabulary();
          if (turningOn && currentTranslation && currentTranslation.translation) {
            const ranges = currentTranslation.ranges || normalizeRanges(currentTranslation.start, currentTranslation.end);
            saveDefinition(term, sentence, currentTranslation.translation, ranges);
          }
          reColor();
          closePopup();
        });
      });

      // Multi-word selections can be sent straight into the Build Phrases
      // list once we know the translation (the button stays hidden until
      // then, since there's nothing useful to save before that). If the
      // site script offers video-clip capture (YouTube's content.js does;
      // plain Reading Mode doesn't), grab a short clip of the actual
      // audio first and save it alongside the phrase.
      const buildPhraseBtn = popup.querySelector('[data-action="build-phrase"]');
      if (buildPhraseBtn) {
        buildPhraseBtn.addEventListener('click', async ev => {
          ev.stopPropagation();
          if (!currentTranslation || !currentTranslation.translation || buildPhraseBtn.disabled) return;
          buildPhraseBtn.disabled = true;
          const captureLang = targetLang;
          const captureTranslation = currentTranslation.translation;

          const canCaptureClip = typeof hooks.captureVideoClip === 'function';
          buildPhraseBtn.textContent = canCaptureClip ? 'Grabbing the clip…' : 'Saving…';

          let clipDataUrl = null;
          if (canCaptureClip) {
            try {
              const blob = await hooks.captureVideoClip(spans);
              if (blob) {
                buildPhraseBtn.textContent = 'Saving…';
                clipDataUrl = await blobToDataUrl(blob);
              }
            } catch (err) {
              // No clip — still save the phrase itself below.
            }
          }

          saveToBuildPhrases(term, captureTranslation, clipDataUrl, (id, error, warning) => {
            if (error || !id) {
              buildPhraseBtn.textContent = 'Could not save. Try again';
              buildPhraseBtn.disabled = false;
              return;
            }
            buildPhraseBtn.textContent = warning ? 'Phrase saved; add audio in the studio' : clipDataUrl ? 'Saved with original audio' : 'Saved for practice';
            if (warning) buildPhraseBtn.title = warning;
            if (captureLang === 'es') chrome.runtime.sendMessage({ type: 'OPEN_STUDIO', phraseId: id, lang: captureLang }, () => { void chrome.runtime.lastError; });
          }, captureLang);
        });
      }

      const loadingEl = popup.querySelector('.sptube-popup-loading');
      const sentenceBlockEl = popup.querySelector('.sptube-sentence-block');
      const sentenceEl = popup.querySelector('.sptube-sentence-translation');
      const sentenceControlsEl = popup.querySelector('.sptube-sentence-controls');
      const variantEl = popup.querySelector('.sptube-save-variant');
      const savedMeaningsEl = popup.querySelector('.sptube-saved-meanings');
      const savedListEl = popup.querySelector('.sptube-saved-list');
      const customInput = popup.querySelector('.sptube-custom-input');
      const customSaveBtn = popup.querySelector('.sptube-custom-save');

      ['click', 'mousedown', 'keydown'].forEach(evt => {
        customInput.addEventListener(evt, ev => ev.stopPropagation());
      });
      customSaveBtn.addEventListener('click', ev => {
        ev.stopPropagation();
        const txt = customInput.value.trim();
        if (!txt) return;
        saveCustomDefinition(term, sentence, txt, () => {
          customInput.value = '';
          renderSavedMeanings(term, savedMeaningsEl, savedListEl);
        });
      });
      customInput.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); customSaveBtn.click(); }
      });

      renderSavedMeanings(term, savedMeaningsEl, savedListEl);

      const result = sentence
        ? await (isPhrase ? translatePhraseDirect(term) : translateWordInContext(sentence, term, occurrence))
        : null;
      currentTranslation = result;

      if (activePopup !== popup || activeTerm !== term) return;
      loadingEl.style.display = 'none';

      if (result && result.translation) {
        renderCurrentTranslation(result.translation, result.start, result.end);
        if (buildPhraseBtn) buildPhraseBtn.style.display = 'block';

        const status2 = getWordStatus(term);
        if (status2 === 'learning' || status2 === 'known') {
          const matched = extractMatched(result.translation, result.start, result.end);
          getSavedDefinitions(term, (list) => {
            if (activePopup !== popup || activeTerm !== term) return;
            if (list.length === 0) {
              saveDefinition(term, sentence, result.translation, result.start, result.end);
              renderSavedMeanings(term, savedMeaningsEl, savedListEl);
              return;
            }
            const alreadySaved = list.some(entry =>
              (entry.matched || '').trim().toLowerCase() === matched.trim().toLowerCase()
            );
            if (alreadySaved) return;
            variantEl.style.display = 'block';
            variantEl.innerHTML = `<button class="sptube-btn sptube-btn-variant">➕ Save "${escHtml(matched)}" as another meaning</button>`;
            variantEl.querySelector('button').addEventListener('click', ev => {
              ev.stopPropagation();
              saveDefinition(term, sentence, result.translation, result.start, result.end);
              variantEl.innerHTML = `<span class="sptube-variant-saved">✓ Saved as a new meaning</span>`;
              renderSavedMeanings(term, savedMeaningsEl, savedListEl);
            });
          });
        }
      } else {
        sentenceEl.innerHTML = sameLang
          ? `No synonym found for "<em>${escHtml(term)}</em>"`
          : `No translation found for "<em>${escHtml(term)}</em>"`;
        sentenceBlockEl.style.display = 'block';
      }

      function renderCurrentTranslation(transText, start, end) {
        sentenceEl.innerHTML = buildHighlightedSentenceHtml(transText, start, end);
        sentenceBlockEl.style.display = 'block';
        sentenceControlsEl.innerHTML = '';
        attachHighlightEditor(sentenceEl, transText, sentenceControlsEl, (ranges) => {
          if (!ranges || !ranges.length) return;
          currentTranslation = { translation: transText, ranges };
        });
      }
    }

    function escHtml(s) {
      return String(s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // ── Draggable popup ──────────────────────────────────────────────────
    // Lets the user grab the popup by its header and reposition it, e.g. to
    // get it out of the way of the transcript line it's covering.
    function makePopupDraggable(popup) {
      const header = popup.querySelector('.sptube-popup-header');
      if (!header) return;
      header.style.cursor = 'move';
      header.style.touchAction = 'none';

      let dragging = false;
      let startX = 0, startY = 0, startLeft = 0, startTop = 0;

      function onPointerDown(e) {
        if (e.button !== 0) return;
        if (e.target.closest('.sptube-popup-close')) return;
        dragging = true;
        const rect = popup.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;
        startX = e.clientX;
        startY = e.clientY;
        popup.style.left = `${startLeft}px`;
        popup.style.top = `${startTop}px`;
        popup.style.right = 'auto';
        popup.style.bottom = 'auto';
        if (e.pointerId != null && header.setPointerCapture) {
          try { header.setPointerCapture(e.pointerId); } catch (err) {}
        }
        e.preventDefault();
      }

      function onPointerMove(e) {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const maxLeft = Math.max(4, window.innerWidth - popup.offsetWidth - 4);
        const maxTop = Math.max(4, window.innerHeight - popup.offsetHeight - 4);
        popup.style.left = `${Math.min(Math.max(startLeft + dx, 4), maxLeft)}px`;
        popup.style.top = `${Math.min(Math.max(startTop + dy, 4), maxTop)}px`;
      }

      function onPointerUp(e) {
        dragging = false;
        if (e.pointerId != null && header.releasePointerCapture) {
          try { header.releasePointerCapture(e.pointerId); } catch (err) {}
        }
      }

      header.addEventListener('pointerdown', onPointerDown);
      header.addEventListener('pointermove', onPointerMove);
      header.addEventListener('pointerup', onPointerUp);
      header.addEventListener('pointercancel', onPointerUp);
    }

    // Close the popup when clicking anywhere outside it.
    //
    // Gotcha: releasing a drag-selection on a different word than it started
    // on still causes the browser to fire a trailing "click" event right
    // after pointerup (even with preventDefault() on pointerdown). On the
    // YouTube transcript specifically, each line is itself a clickable
    // element that seeks the video when clicked — so that phantom click
    // was reaching YouTube's own row handler and seeking/re-rendering the
    // transcript right after our popup opened, on top of nearly-instantly
    // closing our own popup via the check below. Fully swallowing the
    // event (stopPropagation + preventDefault) during the capturing phase
    // stops it before it reaches YouTube's listener OR our target-phase
    // ones. justFinishedDragSelection is set for a brief window right
    // after a drag-release for exactly this.
    document.addEventListener('click', (e) => {
      if (justFinishedDragSelection) {
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      if (activePopup && !activePopup.contains(e.target)) closePopup();
    }, true);

    return {
      tokenizeContainer,
      tokenizeDynamicElement,
      reColor,
      closePopup,
      isPopupOpen: () => !!activePopup,
      hasTokenized: (el) => tokenizedSegments.has(el),
      getStats,
      getVocabularySnapshot: () => vocabulary,
      getTargetLangCode: () => targetLang,
      getNativeLangCode: () => nativeLang,
    };
  }

  // ── Shared markup for the "% known / learning / new" badges ─────────────
  // Used both by the standalone YouTube-transcript badge (content.js) and
  // inline inside the Reading Mode badge (reader.js), so the two features
  // always look and label things identically.
  function buildStatsMarkup(stats) {
    if (!stats || !stats.total) return '';
    return `
      <span class="sptube-stat sptube-stat-known" title="${stats.known} known word${stats.known === 1 ? '' : 's'}"><i></i>${stats.knownPct}%</span>
      <span class="sptube-stat sptube-stat-learning" title="${stats.learning} word${stats.learning === 1 ? '' : 's'} being learned"><i></i>${stats.learningPct}%</span>
      <span class="sptube-stat sptube-stat-new" title="${stats.unknown} new word${stats.unknown === 1 ? '' : 's'}"><i></i>${stats.unknownPct}%</span>
    `;
  }

  // ── Plain-text word stats (no DOM/tokenizing involved) ──────────────────
  // Same tokenizing rule as buildWordFragment() above (split on whitespace,
  // strip leading/trailing non-letter characters per "word") but run over a
  // raw string instead of live DOM spans. Used to score a video's fetched
  // transcript against the learner's saved vocabulary before they've ever
  // opened it — see the on-screen "% known" scan in content.js.
  function computeTextStats(text, vocabulary) {
    vocabulary = vocabulary || {};
    let known = 0, learning = 0, unknown = 0;
    const tokens = String(text || '').split(/\s+/);
    for (const token of tokens) {
      const core = token.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
      if (!core) continue;
      const status = vocabulary[core.toLowerCase()] || 'unknown';
      if (status === 'known') known++;
      else if (status === 'learning') learning++;
      else unknown++;
    }
    const total = known + learning + unknown;
    const knownPct = total ? Math.round((known / total) * 100) : 0;
    const learningPct = total ? Math.round((learning / total) * 100) : 0;
    const unknownPct = total ? Math.max(0, 100 - knownPct - learningPct) : 0;
    return { total, known, learning, unknown, knownPct, learningPct, unknownPct };
  }

  // ── Capturing a short audio clip straight from a <video> element ────────
  // Used by site scripts (content.js for YouTube) to grab "how it actually
  // sounded" for a phrase being saved, so it can sit alongside the computer
  // voice and Voicebox voice on that phrase's card. This only touches audio
  // the browser is already decoding for on-screen playback (via
  // HTMLMediaElement.captureStream()) — there's no download or network
  // request involved. Site scripts are responsible for figuring out which
  // start/end timestamps correspond to a given selection; this just does
  // the seek → play → record → restore mechanics generically.
  const MAX_CLIP_SECONDS = 12;

  function waitForEvent(el, eventName, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; cleanup(); resolve(false); } }, timeoutMs);
      function onEvent() { if (!done) { done = true; cleanup(); resolve(true); } }
      function cleanup() { clearTimeout(timer); el.removeEventListener(eventName, onEvent); }
      el.addEventListener(eventName, onEvent);
    });
  }

  async function captureVideoClip(video, startTime, endTime) {
    if (!video || typeof video.captureStream !== 'function') return null;
    if (!(endTime > startTime)) return null;
    const clampedEnd = Math.min(endTime, startTime + MAX_CLIP_SECONDS);
    if (video.duration && !Number.isNaN(video.duration)) {
      startTime = Math.min(startTime, Math.max(0, video.duration - 0.2));
    }
    startTime = Math.max(0, startTime);

    let stream;
    try { stream = video.captureStream(); } catch (e) { return null; }
    const audioTracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
    if (!audioTracks.length) return null;

    let recorder;
    try { recorder = new MediaRecorder(new MediaStream(audioTracks)); }
    catch (e) { return null; }

    const wasPaused = video.paused;
    const originalTime = video.currentTime;
    const originalMuted = video.muted;

    return new Promise((resolve) => {
      let settled = false;
      const chunks = [];
      const safetyTimer = setTimeout(() => finish(), (clampedEnd - startTime + 4) * 1000);

      function restore() {
        video.muted = originalMuted;
        try { video.currentTime = originalTime; } catch (e) {}
        if (wasPaused) { try { video.pause(); } catch (e) {} }
      }

      function finish(blob) {
        if (settled) return;
        settled = true;
        clearTimeout(safetyTimer);
        video.removeEventListener('timeupdate', onTimeUpdate);
        restore();
        resolve(blob || null);
      }

      recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      recorder.onerror = () => finish(null);
      recorder.onstop = () => finish(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));

      function onTimeUpdate() {
        if (video.currentTime >= clampedEnd) {
          try { recorder.stop(); } catch (e) { finish(null); }
        }
      }

      (async () => {
        try {
          video.muted = false; // captureStream can otherwise pick up silence from a muted element
          video.currentTime = startTime;
          await waitForEvent(video, 'seeked', 1500);
          recorder.start();
          video.addEventListener('timeupdate', onTimeUpdate);
          await video.play();
        } catch (e) {
          finish(null);
        }
      })();
    });
  }

  window.SPTubeCore = { createEngine, buildStatsMarkup, computeTextStats, captureVideoClip };
})();
