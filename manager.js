// Gift of Tongues — Word manager logic
(function () {
  'use strict';

  function escHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Which language this manager view is currently showing/editing ───────
  // Mirrors the global target-language setting (same one set in the popup);
  // changing it here reloads the page against that language's own data.
  let LANG = window.SPTubeLang.DEFAULT_LANG;
  let KEYS = window.SPTubeLang.storageKeys(LANG);
  let LANG_INFO = window.SPTubeLang.getLanguageInfo(LANG);

  // The language definitions/translations should come back in — also set
  // in the popup, mirrored here the same way as LANG above.
  let NATIVE_LANG = window.SPTubeLang.DEFAULT_NATIVE_LANG;
  let NATIVE_LANG_INFO = window.SPTubeLang.getLanguageInfo(NATIVE_LANG);

  function renderLangPicker() {
    const sel = document.getElementById('langPicker');
    if (!sel) return;
    sel.innerHTML = window.SPTubeLang.LANGUAGES.map(l =>
      `<option value="${l.code}" ${l.code === LANG ? 'selected' : ''}>${l.flag} ${l.name}</option>`
    ).join('');
    sel.addEventListener('change', () => {
      window.SPTubeLang.setTargetLanguage(sel.value, () => location.reload());
    });
  }

  let vocabulary = {};
  let definitions = {};
  let filter = 'all';
  let sortMode = 'alpha';
  let searchTerm = '';
  let expanded = null; // currently-expanded word in list view (only one at a time)
  let currentView = 'list';
  let overviewOpenWord = null;
  let builtPhrases = [];

  // Accepts either an array of {start,end} ranges (a definition can be
  // split across two non-adjacent parts of the translation) or, for
  // backward compatibility, a single numeric `start`/`end` pair.
  function buildHighlightedHtml(text, a, b) {
    let ranges;
    if (Array.isArray(a)) ranges = a;
    else if (a != null && b != null) ranges = [{ start: a, end: b }];
    else ranges = [];
    ranges = ranges
      .filter(r => r && r.start != null && r.end != null && r.start >= 0 && r.end <= text.length && r.start < r.end)
      .sort((x, y) => x.start - y.start);
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

  function getDefList(word) {
    let list = definitions[word.toLowerCase()];
    if (!Array.isArray(list)) list = list ? [list] : [];
    return list;
  }

  function latestSavedAt(word) {
    const list = getDefList(word);
    if (list.length === 0) return 0;
    return Math.max(...list.map(e => e.savedAt || 0));
  }

  function renderStats() {
    const words = Object.keys(vocabulary);
    const learning = words.filter(w => vocabulary[w] === 'learning').length;
    const known = words.filter(w => vocabulary[w] === 'known').length;
    const noDef = words.filter(w => getDefList(w).length === 0).length;
    document.getElementById('statsRow').innerHTML = `
      <div class="stat-pill"><strong>${words.length}</strong> total words</div>
      <div class="stat-pill"><strong>${learning}</strong> learning</div>
      <div class="stat-pill"><strong>${known}</strong> known</div>
      <div class="stat-pill"><strong>${noDef}</strong> without a saved meaning</div>
    `;
  }

  // ── Shared "detail" markup for a single word (used in both the expanded
  // grid box in list view, and the popover in overview view) ───────────────
  function wordDetailHtml(word) {
    const status = vocabulary[word];
    const list = getDefList(word);
    return `
      <div class="detail-actions">
        <button class="icon-btn toggle ${status === 'known' ? 'to-learning' : 'to-known'}" data-action="toggle" data-word="${escHtml(word)}">
          ${status === 'known' ? 'Mark learning' : 'Mark known'}
        </button>
        <button class="icon-btn remove" data-action="remove" data-word="${escHtml(word)}">Remove word</button>
      </div>
      ${list.length === 0
        ? `<div class="no-meaning">
             No saved meaning for this word yet.
             <button class="lookup-btn" data-action="lookup" data-word="${escHtml(word)}">🔍 Look up a translation</button>
           </div>`
        : list.map((entry, i) => `
            <div class="meaning-entry">
              <div class="meaning-row">
                <button class="meaning-highlight" data-index="${i}" data-word="${escHtml(word)}">${escHtml(entry.matched || entry.translation || '')}</button>
                ${entry.custom ? '<span class="custom-badge">you</span>' : ''}
                <button class="meaning-delete" data-index="${i}" data-word="${escHtml(word)}" title="Delete this meaning">🗑 Delete</button>
              </div>
              <div class="meaning-sentence" id="sentence-${escHtml(word)}-${i}">
                ${entry.ranges && entry.ranges.length ? buildHighlightedHtml(entry.translation || '', entry.ranges) : buildHighlightedHtml(entry.translation || '', entry.start, entry.end)}
              </div>
            </div>
          `).join('')
      }
      <div class="detail-add-custom">
        <input type="text" class="custom-input" placeholder="Add your own translation…" data-word="${escHtml(word)}" />
        <button class="custom-save-btn" data-word="${escHtml(word)}">Save</button>
      </div>
    `;
  }

  function bindDetailEvents(root, afterChange) {
    root.querySelectorAll('[data-action="toggle"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const word = btn.dataset.word;
        vocabulary[word] = vocabulary[word] === 'known' ? 'learning' : 'known';
        chrome.storage.local.set({ [KEYS.vocab]: vocabulary }, () => { renderStats(); afterChange(); });
      });
    });

    root.querySelectorAll('[data-action="remove"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const word = btn.dataset.word;
        delete vocabulary[word];
        if (expanded === word) expanded = null;
        if (overviewOpenWord === word) overviewOpenWord = null;
        chrome.storage.local.set({ [KEYS.vocab]: vocabulary }, () => { renderStats(); afterChange(); });
      });
    });

    root.querySelectorAll('.meaning-highlight').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const el = root.querySelector(`#sentence-${CSS.escape(btn.dataset.word)}-${btn.dataset.index}`);
        if (el) el.classList.toggle('visible');
      });
    });

    root.querySelectorAll('.meaning-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const word = btn.dataset.word;
        const idx = Number(btn.dataset.index);
        const key = word.toLowerCase();
        const list = getDefList(key);
        list.splice(idx, 1);
        if (list.length) definitions[key] = list; else delete definitions[key];
        chrome.storage.local.set({ [KEYS.defs]: definitions }, () => { renderStats(); afterChange(); });
      });
    });

    root.querySelectorAll('[data-action="lookup"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        lookupWord(btn.dataset.word, btn, afterChange);
      });
    });

    root.querySelectorAll('.custom-save-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const word = btn.dataset.word;
        const input = root.querySelector(`.custom-input[data-word="${CSS.escape(word)}"]`);
        const text = (input?.value || '').trim();
        if (!text) return;
        const key = word.toLowerCase();
        const list = getDefList(key);
        list.push({ word, sentence: word, translation: text, matched: text, start: null, end: null, savedAt: Date.now(), custom: true });
        definitions[key] = list;
        chrome.storage.local.set({ [KEYS.defs]: definitions }, () => { renderStats(); afterChange(); });
      });
    });

    root.querySelectorAll('.custom-input').forEach(input => {
      input.addEventListener('click', e => e.stopPropagation());
      input.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          const word = input.dataset.word;
          root.querySelector(`.custom-save-btn[data-word="${CSS.escape(word)}"]`)?.click();
        }
      });
    });
  }

  function lookupWord(word, btnEl, afterChange) {
    btnEl.disabled = true;
    btnEl.textContent = 'Looking up…';
    chrome.runtime.sendMessage(
      { type: 'TRANSLATE_WORD_IN_CONTEXT', sentence: word, word, occurrence: 0, lang: LANG, nativeLang: NATIVE_LANG },
      (result) => {
        void chrome.runtime.lastError;
        if (!result || !result.translation) {
          btnEl.disabled = false;
          btnEl.textContent = '🔍 Try again';
          return;
        }
        const matched = (result.start != null && result.end != null)
          ? result.translation.slice(result.start, result.end)
          : result.translation;
        const key = word.toLowerCase();
        const list = getDefList(key);
        list.push({
          word, sentence: word, translation: result.translation,
          matched, start: result.start, end: result.end, savedAt: Date.now()
        });
        definitions[key] = list;
        chrome.storage.local.set({ [KEYS.defs]: definitions }, () => {
          expanded = key;
          renderStats();
          afterChange();
        });
      }
    );
  }

  // ── List view (grid of chip boxes) ───────────────────────────────────────
  function getFilteredWords() {
    let words = Object.keys(vocabulary);

    if (filter === 'learning') words = words.filter(w => vocabulary[w] === 'learning');
    else if (filter === 'known') words = words.filter(w => vocabulary[w] === 'known');
    else if (filter === 'nodef') words = words.filter(w => getDefList(w).length === 0);

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      words = words.filter(w => {
        if (w.includes(q)) return true;
        return getDefList(w).some(e =>
          (e.translation || '').toLowerCase().includes(q) ||
          (e.matched || '').toLowerCase().includes(q)
        );
      });
    }

    if (sortMode === 'alpha') {
      words.sort((a, b) => a.localeCompare(b, LANG));
    } else {
      words.sort((a, b) => latestSavedAt(b) - latestSavedAt(a));
    }

    return words;
  }

  function renderListView() {
    const words = getFilteredWords();
    const gridEl = document.getElementById('wordGrid');

    if (words.length === 0) {
      gridEl.innerHTML = `<div class="empty-state">No words match here yet.</div>`;
      return;
    }

    gridEl.innerHTML = words.map(w => {
      const status = vocabulary[w];
      const list = getDefList(w);
      const isExpanded = expanded === w;
      const preview = list.length > 0 ? (list[0].matched || list[0].translation || '') : 'No saved meaning yet';

      return `
        <div class="word-box ${isExpanded ? 'expanded' : ''}" data-word="${escHtml(w)}">
          <div class="word-box-top" data-toggle="${escHtml(w)}">
            <span class="word-text">${escHtml(w)}</span>
            <span class="status-pill ${status}">${status}</span>
          </div>
          ${!isExpanded ? `<div class="preview-text">${escHtml(preview)}</div>` : ''}
          ${isExpanded ? `<div class="word-detail-body">${wordDetailHtml(w)}</div>` : ''}
        </div>
      `;
    }).join('');

    gridEl.querySelectorAll('[data-toggle]').forEach(el => {
      el.addEventListener('click', () => {
        const word = el.dataset.toggle;
        expanded = expanded === word ? null : word;
        renderListView();
      });
    });

    bindDetailEvents(gridEl, renderListView);
  }

  // ── Overview view (everything on one screen, sized to fit) ──────────────
  function renderOverviewView() {
    const words = Object.keys(vocabulary).sort((a, b) => a.localeCompare(b, LANG));
    const container = document.getElementById('overviewGrid');
    const countEl = document.getElementById('overviewCount');
    countEl.textContent = `${words.length} word${words.length === 1 ? '' : 's'}`;

    if (words.length === 0) {
      container.style.gridTemplateColumns = '';
      container.style.gridTemplateRows = '';
      container.innerHTML = `<div class="empty-state">No words yet — mark some as learning or known on YouTube first.</div>`;
      return;
    }

    const rectW = container.clientWidth || 800;
    const rectH = container.clientHeight || 400;
    const n = words.length;
    const aspect = rectW / Math.max(rectH, 1);

    let cols = Math.max(1, Math.round(Math.sqrt(n * aspect)));
    let rows = Math.max(1, Math.ceil(n / cols));
    // Nudge columns down if it leaves a lot of empty trailing cells in the last row.
    while (cols > 1 && (rows * cols - n) >= cols) {
      cols -= 1;
      rows = Math.ceil(n / cols);
    }

    container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    container.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

    const cellW = rectW / cols;
    const cellH = rectH / rows;
    const fontSize = Math.max(7, Math.min(16, Math.min(cellW, cellH) / 3.6));

    container.innerHTML = words.map(w => {
      const status = vocabulary[w];
      return `<div class="overview-box status-${status}" data-word="${escHtml(w)}" style="font-size:${fontSize.toFixed(1)}px" title="${escHtml(w)}">${escHtml(w)}</div>`;
    }).join('');

    container.querySelectorAll('.overview-box').forEach(box => {
      box.addEventListener('click', () => {
        overviewOpenWord = box.dataset.word;
        renderOverviewDetail();
      });
    });
  }

  function renderOverviewDetail() {
    const detailEl = document.getElementById('overviewDetail');
    if (!overviewOpenWord || !vocabulary[overviewOpenWord]) {
      detailEl.style.display = 'none';
      detailEl.innerHTML = '';
      return;
    }
    const word = overviewOpenWord;
    detailEl.style.display = 'block';
    detailEl.innerHTML = `
      <button class="overview-detail-close" id="overviewDetailClose">✕</button>
      <div class="word-box-top" style="margin-bottom:6px;">
        <span class="word-text" style="font-size:18px;">${escHtml(word)}</span>
        <span class="status-pill ${vocabulary[word]}">${vocabulary[word]}</span>
      </div>
      <div class="word-detail-body" style="margin-top:6px; padding-top:0; border-top:none;">
        ${wordDetailHtml(word)}
      </div>
    `;
    document.getElementById('overviewDetailClose').addEventListener('click', () => {
      overviewOpenWord = null;
      renderOverviewDetail();
    });
    bindDetailEvents(detailEl, () => { renderOverviewView(); renderOverviewDetail(); });
  }

  // ── Build Phrases ─────────────────────────────────────────────────────
  // The learner writes an English phrase, attempts their own translation,
  // translation, checks it against the app's (Google-translated) version
  // with a word-level diff, records their own pronunciation, can play a
  // computer (speech-synthesis) pronunciation to compare against, and
  // saves the phrase — with whichever translation they choose — for
  // later review.

  let computerTranslation = null;   // last-checked computer translation, or null before a check
  let currentRecordingDataUrl = null; // base64 data: URL of the in-progress (unsaved) recording, if any

  function normalizeWordsForDiff(text) {
    return (text || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(w => ({ raw: w, key: w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') }));
  }

  // Simple LCS-based word diff so matching words (regardless of order
  // drift) are highlighted the same on both sides, and words that don't
  // line up are flagged as differing — enough to help the learner see
  // where their translation departs from the app's without being a
  // full grammar checker.
  function diffWords(a, b) {
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i].key === b[j].key ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const aTags = new Array(n).fill('diff');
    const bTags = new Array(m).fill('diff');
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i].key === b[j].key) {
        aTags[i] = 'match'; bTags[j] = 'match';
        i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        i++;
      } else {
        j++;
      }
    }
    return { aTags, bTags };
  }

  function renderDiffHtml(words, tags) {
    if (!words.length) return '<span style="color:var(--gt-text-faint2)">(empty)</span>';
    return words.map((w, idx) => `<span class="diff-word ${tags[idx]}">${escHtml(w.raw)}</span>`).join(' ');
  }

  function setBuilderHint(text, kind) {
    const el = document.getElementById('builderHint');
    el.textContent = text;
    el.className = 'builder-hint' + (kind ? ' ' + kind : '');
  }

  function setRecordHint(text, kind) {
    const el = document.getElementById('builderRecordHint');
    el.textContent = text;
    el.className = 'builder-hint' + (kind ? ' ' + kind : '');
  }

  // ── Text-to-speech "computer pronunciation" ──────────────────────────
  function pickVoiceForLang() {
    const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    const speechLang = LANG_INFO.speechLang || LANG;
    return voices.find(v => v.lang === speechLang)
      || voices.find(v => new RegExp('^' + LANG, 'i').test(v.lang))
      || null;
  }

  function speakTargetText(text) {
    if (!text) return;
    if (!('speechSynthesis' in window)) {
      setBuilderHint('Your browser doesn\u2019t support computer speech playback.', 'err');
      return;
    }
    window.speechSynthesis.cancel(); // stop anything already speaking
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = LANG_INFO.speechLang || LANG;
    const voice = pickVoiceForLang();
    if (voice) utter.voice = voice;
    utter.rate = 0.92;
    window.speechSynthesis.speak(utter);
  }
  // Voices often load asynchronously; make sure pickVoiceForLang() has
  // something to find once they do.
  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => { /* voices now populated */ };
  }

  // ── Voicebox integration ──────────────────────────────────────────────
  // Lets the learner import one of their own voice profiles from a local
  // Voicebox instance (voicebox.sh) and have it read a saved phrase aloud,
  // as an alternative to the built-in computer voice above. Voicebox runs
  // entirely on the user's machine with a REST API (default
  // http://127.0.0.1:17493) — nothing here leaves the computer.
  let voiceboxSettings = { baseUrl: '', profileId: '', profileName: '' };
  let voiceboxProfiles = [];
  const voiceboxAudioCache = new Map(); // "profileId::text" -> object URL (this session only)

  function normalizeBaseUrl(url) {
    return (url || '').trim().replace(/\/+$/, '');
  }

  function voiceboxOriginPattern(baseUrl) {
    try {
      const u = new URL(baseUrl);
      return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}/*`;
    } catch (err) {
      return null;
    }
  }

  function setVoiceboxHint(text, kind) {
    const el = document.getElementById('voiceboxHint');
    if (!el) return;
    el.textContent = text;
    el.className = 'builder-hint' + (kind ? ' ' + kind : '');
  }

  function renderVoiceboxPanel() {
    const connectedRow = document.getElementById('voiceboxConnectedRow');
    const setupRow = document.getElementById('voiceboxSetupRow');
    if (!connectedRow || !setupRow) return; // builder view not yet in the DOM
    if (voiceboxSettings.profileId) {
      connectedRow.style.display = 'flex';
      setupRow.style.display = 'none';
      document.getElementById('voiceboxProfileSelectRow').style.display = 'none';
      document.getElementById('voiceboxProfileLabel').textContent = voiceboxSettings.profileName || 'Imported voice';
    } else {
      connectedRow.style.display = 'none';
      setupRow.style.display = 'flex';
      if (voiceboxSettings.baseUrl) document.getElementById('voiceboxUrlInput').value = voiceboxSettings.baseUrl;
    }
    document.querySelectorAll('.voicebox-speak-btn').forEach(btn => {
      btn.style.display = voiceboxSettings.profileId ? 'inline-flex' : 'none';
    });
  }

  async function voiceboxFetch(path, options) {
    const res = await fetch(normalizeBaseUrl(voiceboxSettings.baseUrl) + path, options);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  }

  function populateVoiceboxProfileSelect() {
    const select = document.getElementById('voiceboxProfileSelect');
    select.innerHTML = voiceboxProfiles.map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name || p.id)}</option>`).join('');
  }

  document.getElementById('voiceboxConnectBtn').addEventListener('click', () => {
    const input = document.getElementById('voiceboxUrlInput');
    const baseUrl = normalizeBaseUrl(input.value) || 'http://127.0.0.1:17493';
    input.value = baseUrl;
    const pattern = voiceboxOriginPattern(baseUrl);
    if (!pattern) { setVoiceboxHint('That doesn\u2019t look like a valid URL.', 'err'); return; }

    const btn = document.getElementById('voiceboxConnectBtn');
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    setVoiceboxHint('', '');

    chrome.permissions.request({ origins: [pattern] }, async (granted) => {
      if (!granted) {
        btn.disabled = false;
        btn.textContent = '🔌 Connect';
        setVoiceboxHint('Permission to reach that address was declined.', 'err');
        return;
      }
      try {
        const res = await fetch(baseUrl + '/profiles');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        voiceboxProfiles = Array.isArray(data) ? data : (data.profiles || data.items || []);
        voiceboxSettings.baseUrl = baseUrl;
        if (!voiceboxProfiles.length) {
          setVoiceboxHint('Connected, but no voice profiles found \u2014 create one in Voicebox first.', 'err');
          document.getElementById('voiceboxProfileSelectRow').style.display = 'none';
        } else {
          setVoiceboxHint(`Connected \u2014 found ${voiceboxProfiles.length} voice${voiceboxProfiles.length === 1 ? '' : 's'}.`, 'ok');
          populateVoiceboxProfileSelect();
          document.getElementById('voiceboxProfileSelectRow').style.display = 'flex';
        }
        chrome.storage.local.set({ voiceboxSettings });
      } catch (err) {
        setVoiceboxHint(`Couldn\u2019t reach Voicebox at ${baseUrl} \u2014 make sure the app is open.`, 'err');
      }
      btn.disabled = false;
      btn.textContent = '🔌 Connect';
    });
  });

  document.getElementById('voiceboxImportBtn').addEventListener('click', () => {
    const select = document.getElementById('voiceboxProfileSelect');
    const profile = voiceboxProfiles.find(p => p.id === select.value);
    if (!profile) return;
    voiceboxSettings.profileId = profile.id;
    voiceboxSettings.profileName = profile.name || profile.id;
    chrome.storage.local.set({ voiceboxSettings }, () => {
      setVoiceboxHint(`Imported "${voiceboxSettings.profileName}".`, 'ok');
      renderVoiceboxPanel();
      renderBuiltPhraseList();
    });
  });

  document.getElementById('voiceboxChangeVoiceBtn').addEventListener('click', () => {
    document.getElementById('voiceboxProfileSelectRow').style.display = 'flex';
    if (voiceboxProfiles.length) populateVoiceboxProfileSelect();
  });

  document.getElementById('voiceboxDisconnectBtn').addEventListener('click', () => {
    voiceboxSettings = { baseUrl: voiceboxSettings.baseUrl, profileId: '', profileName: '' };
    voiceboxAudioCache.clear();
    chrome.storage.local.set({ voiceboxSettings }, () => {
      renderVoiceboxPanel();
      renderBuiltPhraseList();
    });
  });

  // Polls GET /history/{id} until the generation finishes, in case the
  // backend queues generation asynchronously rather than blocking the
  // original POST /generate call until audio is ready.
  async function pollVoiceboxGeneration(id) {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const res = await voiceboxFetch(`/history/${encodeURIComponent(id)}`);
      const data = await res.json();
      if (data.status === 'completed' || data.status === 'failed' || !data.status) return data;
      await new Promise(r => setTimeout(r, 1200));
    }
    throw new Error('Timed out waiting for Voicebox');
  }

  // Converts a Blob to a base64 data: URL so audio can be persisted in
  // chrome.storage.local (the extension has the unlimitedStorage permission,
  // the same approach already used for microphone recordings below).
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Could not read audio blob'));
      reader.readAsDataURL(blob);
    });
  }

  // `persistFn`, if given, is called with a base64 data: URL of the freshly
  // generated audio once it's ready, so the caller can save it (e.g. onto a
  // saved phrase record) and skip hitting Voicebox again next time.
  async function speakWithVoicebox(text, button, hintFn, persistFn) {
    if (!voiceboxSettings.profileId || !text) return;
    const cacheKey = voiceboxSettings.profileId + '::' + text;
    const originalLabel = button.textContent;

    if (voiceboxAudioCache.has(cacheKey)) {
      new Audio(voiceboxAudioCache.get(cacheKey)).play();
      return;
    }

    button.disabled = true;
    button.textContent = '⏳ Generating…';
    hintFn && hintFn('Generating with Voicebox…', '');

    try {
      const genRes = await voiceboxFetch('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, profile_id: voiceboxSettings.profileId, language: 'es' }),
      });
      let generation = await genRes.json();
      const id = generation.id || generation.generation_id;
      if (!id) throw new Error('No generation id returned');

      if (generation.status && generation.status !== 'completed') {
        generation = await pollVoiceboxGeneration(id);
        if (generation.status === 'failed') throw new Error(generation.error || 'Generation failed');
      }

      const audioRes = await voiceboxFetch(`/history/${encodeURIComponent(id)}/export-audio`);
      const blob = await audioRes.blob();
      const objectUrl = URL.createObjectURL(blob);
      voiceboxAudioCache.set(cacheKey, objectUrl);
      new Audio(objectUrl).play();
      hintFn && hintFn('', '');

      if (persistFn) {
        try {
          const dataUrl = await blobToDataUrl(blob);
          persistFn(dataUrl);
        } catch (persistErr) {
          // Playback already succeeded; failing to persist just means it'll
          // regenerate next time, so don't surface this as an error.
        }
      }
    } catch (err) {
      hintFn && hintFn('Couldn\u2019t generate with Voicebox \u2014 is the app still running?', 'err');
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }

  document.getElementById('builderVoiceboxBtn').addEventListener('click', (e) => {
    const text = computerTranslation || document.getElementById('builderUserTranslation').value.trim();
    const hintFn = (t, k) => {
      const el = document.getElementById('builderVoiceboxHint');
      if (el) { el.textContent = t; el.className = 'builder-hint' + (k ? ' ' + k : ''); }
    };
    speakWithVoicebox(text, e.currentTarget, hintFn);
  });

  // ── Microphone recording ─────────────────────────────────────────────
  // Generic recorder shared by the builder's "in progress" recording and
  // by the "record/re-record" button on each already-saved phrase card,
  // so pronunciation can be captured (or replaced) at any time, not just
  // at save time. Only one recording can be active at once — starting a
  // new one anywhere stops whichever was already running.
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  let activeRecorder = null; // { mediaRecorder, stream, button, idleLabel }

  function stopActiveRecording() {
    if (!activeRecorder) return;
    const { mediaRecorder: rec, button, idleLabel } = activeRecorder;
    if (rec.state !== 'inactive') rec.stop();
    if (button) { button.textContent = idleLabel; button.classList.remove('recording'); }
  }

  // button: the toggle button element (its label/recording class are
  // managed here). idleLabel: text to restore the button to once
  // recording stops. hintFn(text, kind): where to report status/errors.
  // onComplete(dataUrl): called with the recorded clip once it's ready.
  async function toggleRecording(button, idleLabel, hintFn, onComplete) {
    if (activeRecorder && activeRecorder.button === button) {
      stopActiveRecording();
      return;
    }
    if (activeRecorder) stopActiveRecording();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      hintFn && hintFn('This browser can\u2019t access a microphone here.', 'err');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      hintFn && hintFn('Microphone access was blocked. Allow it and try again.', 'err');
      return;
    }
    let recorder;
    try {
      recorder = new MediaRecorder(stream);
    } catch (err) {
      hintFn && hintFn('Recording isn\u2019t supported in this browser.', 'err');
      stream.getTracks().forEach(t => t.stop());
      return;
    }

    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      activeRecorder = null;
      if (blob.size > 0) {
        const dataUrl = await blobToDataUrl(blob);
        onComplete(dataUrl);
      }
    };

    recorder.start();
    activeRecorder = { mediaRecorder: recorder, stream, button, idleLabel };
    button.textContent = '⏹️ Stop recording';
    button.classList.add('recording');
    hintFn && hintFn('Recording… click again to stop.', '');
  }

  document.getElementById('builderRecordBtn').addEventListener('click', (e) => {
    toggleRecording(e.currentTarget, '🎙️ Record my pronunciation', setRecordHint, (dataUrl) => {
      currentRecordingDataUrl = dataUrl;
      const player = document.getElementById('builderRecordingPlayer');
      player.src = dataUrl;
      player.style.display = 'inline-block';
      setRecordHint('Recorded. Play it back, or record again to replace it.', 'ok');
    });
  });

  document.getElementById('builderPlayComputer').addEventListener('click', () => {
    const text = computerTranslation || document.getElementById('builderUserTranslation').value.trim();
    speakTargetText(text);
  });

  // ── Check translation ────────────────────────────────────────────────
  document.getElementById('builderCheckBtn').addEventListener('click', () => {
    const english = document.getElementById('builderEnglish').value.trim();
    const userTranslation = document.getElementById('builderUserTranslation').value.trim();
    if (!english) { setBuilderHint(`Write a phrase in ${NATIVE_LANG_INFO.name} first.`, 'err'); return; }
    if (!userTranslation) { setBuilderHint(`Try your own ${LANG_INFO.name} translation before checking.`, 'err'); return; }

    const btn = document.getElementById('builderCheckBtn');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    setBuilderHint('', '');

    chrome.runtime.sendMessage({ type: 'TRANSLATE_NATIVE_TO_TARGET', text: english, targetLang: LANG, nativeLang: NATIVE_LANG }, (result) => {
      void chrome.runtime.lastError;
      btn.disabled = false;
      btn.textContent = '✅ Check my translation';

      if (!result) {
        setBuilderHint('Couldn\u2019t reach the translator — check your connection and try again.', 'err');
        return;
      }
      computerTranslation = result;

      const aWords = normalizeWordsForDiff(userTranslation);
      const bWords = normalizeWordsForDiff(computerTranslation);
      const { aTags, bTags } = diffWords(aWords, bWords);

      document.getElementById('diffUser').innerHTML = renderDiffHtml(aWords, aTags);
      document.getElementById('diffComputer').innerHTML = renderDiffHtml(bWords, bTags);
      document.getElementById('builderResult').style.display = 'block';

      // Reset any in-progress recording state for this fresh check.
      currentRecordingDataUrl = null;
      const player = document.getElementById('builderRecordingPlayer');
      player.style.display = 'none';
      player.removeAttribute('src');
      setRecordHint('', '');
    });
  });

  // ── Save built phrase ────────────────────────────────────────────────
  function saveBuiltPhrase(source) {
    const english = document.getElementById('builderEnglish').value.trim();
    const userTranslation = document.getElementById('builderUserTranslation').value.trim();
    if (!english || !computerTranslation) return;
    const chosen = source === 'computer' ? computerTranslation : userTranslation;
    if (!chosen) return;

    const record = {
      id: 'p' + Date.now() + Math.random().toString(36).slice(2, 8),
      english,
      userTranslation,
      computerTranslation,
      savedTranslation: chosen,
      source, // 'user' | 'computer'
      recording: currentRecordingDataUrl,
      savedAt: Date.now(),
    };
    builtPhrases = [record, ...builtPhrases];
    chrome.storage.local.set({ [KEYS.phrases]: builtPhrases }, () => {
      setBuilderHint(`Saved \u2014 "${chosen}"`, 'ok');
      renderBuiltPhraseList();
      // Clear the builder for the next phrase, but leave the diff/inputs
      // visible for a moment so the save confirmation makes sense.
      document.getElementById('builderEnglish').value = '';
      document.getElementById('builderUserTranslation').value = '';
      document.getElementById('builderResult').style.display = 'none';
      computerTranslation = null;
      currentRecordingDataUrl = null;
      const player = document.getElementById('builderRecordingPlayer');
      player.style.display = 'none';
      player.removeAttribute('src');
    });
  }

  document.getElementById('builderSaveUser').addEventListener('click', () => saveBuiltPhrase('user'));
  document.getElementById('builderSaveComputer').addEventListener('click', () => saveBuiltPhrase('computer'));

  // ── Saved phrase list ─────────────────────────────────────────────────
  function renderBuiltPhraseList() {
    const listEl = document.getElementById('builtPhraseList');
    const countEl = document.getElementById('builtPhraseCount');
    countEl.textContent = builtPhrases.length
      ? `${builtPhrases.length} phrase${builtPhrases.length === 1 ? '' : 's'} saved`
      : '';

    if (builtPhrases.length === 0) {
      listEl.innerHTML = `<div class="empty-state">No built phrases yet — write one above to get started.</div>`;
      return;
    }

    listEl.innerHTML = builtPhrases.map(p => `
      <div class="phrase-card" data-id="${escHtml(p.id)}">
        <div class="phrase-card-english">${escHtml(p.english)}</div>
        <div class="phrase-card-translation">${escHtml(p.savedTranslation)}</div>
        <div class="phrase-card-meta">
          <span class="phrase-source-badge">${p.source === 'computer' ? 'app\u2019s translation' : p.source === 'video' ? 'found while watching' : 'your translation'}</span>
        </div>
        <div class="phrase-card-audio-row">
          <button class="icon-btn" data-action="hear" data-id="${escHtml(p.id)}">🔊 Computer pronunciation</button>
          <button class="icon-btn voicebox-speak-btn" data-action="voicebox-speak" data-id="${escHtml(p.id)}" style="${voiceboxSettings.profileId ? '' : 'display:none'}">${p.voiceboxAudio && p.voiceboxAudioProfileId === voiceboxSettings.profileId ? '🎭 Play my Voicebox voice' : '🎭 My Voicebox voice'}</button>
          ${p.voiceboxAudio && p.voiceboxAudioProfileId === voiceboxSettings.profileId ? `<button class="icon-btn" data-action="voicebox-regenerate" data-id="${escHtml(p.id)}" title="Generate a fresh take instead of the saved one">🔄</button>` : ''}
          ${p.videoClip ? `<button class="icon-btn" data-action="video-clip" data-id="${escHtml(p.id)}">🎬 As heard in the video</button>` : ''}
          <button class="icon-btn record-btn" data-action="record" data-id="${escHtml(p.id)}"
                  data-idle-label="${p.recording ? '🎙️ Re-record my pronunciation' : '🎙️ Record my pronunciation'}">
            ${p.recording ? '🎙️ Re-record my pronunciation' : '🎙️ Record my pronunciation'}
          </button>
          <audio class="phrase-card-audio" controls ${p.recording ? `src="${p.recording}"` : ''} style="${p.recording ? '' : 'display:none'}" id="phrase-audio-${escHtml(p.id)}"></audio>
        </div>
        <span class="builder-hint" id="phrase-hint-${escHtml(p.id)}"></span>
        <div class="phrase-card-actions">
          <button class="icon-btn remove" data-action="remove-phrase" data-id="${escHtml(p.id)}">Remove phrase</button>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('[data-action="hear"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = builtPhrases.find(x => x.id === btn.dataset.id);
        if (p) speakTargetText(p.savedTranslation);
      });
    });

    listEl.querySelectorAll('[data-action="video-clip"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = builtPhrases.find(x => x.id === btn.dataset.id);
        if (p && p.videoClip) new Audio(p.videoClip).play();
      });
    });

    // Plays a saved phrase's Voicebox audio: if we've already generated it
    // with the currently-connected voice, reuse the saved audio instantly
    // instead of calling Voicebox again. If the voice profile changed since
    // it was saved, we fall through and generate fresh (and re-save it).
    function playOrGenerateVoicebox(p, button, hintFn) {
      if (p.voiceboxAudio && p.voiceboxAudioProfileId === voiceboxSettings.profileId) {
        new Audio(p.voiceboxAudio).play();
        return;
      }
      speakWithVoicebox(p.savedTranslation, button, hintFn, (dataUrl) => {
        p.voiceboxAudio = dataUrl;
        p.voiceboxAudioProfileId = voiceboxSettings.profileId;
        chrome.storage.local.set({ [KEYS.phrases]: builtPhrases }, () => {
          renderBuiltPhraseList();
        });
      });
    }

    listEl.querySelectorAll('[data-action="voicebox-speak"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const p = builtPhrases.find(x => x.id === btn.dataset.id);
        if (!p) return;
        const hintEl = listEl.querySelector(`#phrase-hint-${CSS.escape(p.id)}`);
        const hintFn = (text, kind) => {
          if (!hintEl) return;
          hintEl.textContent = text;
          hintEl.className = 'builder-hint' + (kind ? ' ' + kind : '');
        };
        playOrGenerateVoicebox(p, e.currentTarget, hintFn);
      });
    });

    // Forces a brand-new generation even though a saved take already
    // exists, for when the user just wants to hear a different reading.
    listEl.querySelectorAll('[data-action="voicebox-regenerate"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const p = builtPhrases.find(x => x.id === btn.dataset.id);
        if (!p) return;
        const hintEl = listEl.querySelector(`#phrase-hint-${CSS.escape(p.id)}`);
        const hintFn = (text, kind) => {
          if (!hintEl) return;
          hintEl.textContent = text;
          hintEl.className = 'builder-hint' + (kind ? ' ' + kind : '');
        };
        // Drop the in-memory session cache for this text/voice too, so
        // speakWithVoicebox doesn't just hand back the same cached clip.
        voiceboxAudioCache.delete(voiceboxSettings.profileId + '::' + p.savedTranslation);
        const speakBtn = listEl.querySelector(`[data-action="voicebox-speak"][data-id="${CSS.escape(p.id)}"]`);
        speakWithVoicebox(p.savedTranslation, speakBtn || e.currentTarget, hintFn, (dataUrl) => {
          p.voiceboxAudio = dataUrl;
          p.voiceboxAudioProfileId = voiceboxSettings.profileId;
          chrome.storage.local.set({ [KEYS.phrases]: builtPhrases }, () => {
            renderBuiltPhraseList();
          });
        });
      });
    });

    listEl.querySelectorAll('[data-action="record"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = btn.dataset.id;
        const hintEl = listEl.querySelector(`#phrase-hint-${CSS.escape(id)}`);
        const hintFn = (text, kind) => {
          if (!hintEl) return;
          hintEl.textContent = text;
          hintEl.className = 'builder-hint' + (kind ? ' ' + kind : '');
        };
        toggleRecording(e.currentTarget, btn.dataset.idleLabel, hintFn, (dataUrl) => {
          const p = builtPhrases.find(x => x.id === id);
          if (!p) return;
          p.recording = dataUrl;
          chrome.storage.local.set({ [KEYS.phrases]: builtPhrases }, () => {
            renderBuiltPhraseList();
          });
        });
      });
    });

    listEl.querySelectorAll('[data-action="remove-phrase"]').forEach(btn => {
      btn.addEventListener('click', () => {
        builtPhrases = builtPhrases.filter(x => x.id !== btn.dataset.id);
        chrome.storage.local.set({ [KEYS.phrases]: builtPhrases }, renderBuiltPhraseList);
      });
    });
  }

  function refresh() {
    chrome.storage.local.get([KEYS.vocab, KEYS.defs, KEYS.phrases, 'voiceboxSettings'], (r) => {
      vocabulary = r[KEYS.vocab] || {};
      definitions = r[KEYS.defs] || {};
      builtPhrases = Array.isArray(r[KEYS.phrases]) ? r[KEYS.phrases] : [];
      if (r.voiceboxSettings) voiceboxSettings = r.voiceboxSettings;
      renderStats();
      renderVoiceboxPanel();
      if (currentView === 'list') renderListView();
      else if (currentView === 'overview') { renderOverviewView(); renderOverviewDetail(); }
      else renderBuiltPhraseList();
    });
  }

  // ── View switching ────────────────────────────────────────────────────
  document.getElementById('viewTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.view-tab');
    if (!btn) return;
    document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    document.getElementById('listView').style.display = currentView === 'list' ? 'flex' : 'none';
    document.getElementById('overviewView').style.display = currentView === 'overview' ? 'flex' : 'none';
    document.getElementById('builderView').style.display = currentView === 'builder' ? 'flex' : 'none';
    document.getElementById('statsRow').style.display = currentView === 'builder' ? 'none' : 'flex';
    if (currentView !== 'builder') stopActiveRecording();
    if (currentView === 'list') renderListView();
    else if (currentView === 'overview') renderOverviewView();
    else renderBuiltPhraseList();
  });

  window.addEventListener('resize', () => {
    if (currentView === 'overview') renderOverviewView();
  });

  window.addEventListener('beforeunload', () => stopActiveRecording());

  document.getElementById('searchInput').addEventListener('input', (e) => {
    searchTerm = e.target.value.trim();
    renderListView();
  });

  document.getElementById('filterTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filter = btn.dataset.filter;
    renderListView();
  });

  document.getElementById('sortSelect').addEventListener('change', (e) => {
    sortMode = e.target.value;
    renderListView();
  });

  document.getElementById('closeLink').addEventListener('click', () => window.close());

  // ── Export / Import (save progress to a file, restore it elsewhere) ─────
  // Exports cover every language the learner has any words in, in one file,
  // so there's no more switching the language picker back and forth to back
  // up (or restore) each language separately. Each language's data still
  // lives under its own key both in the file (schema v3: a `languages` map
  // keyed by language code) and in storage (storageKeys(code).vocab/.defs),
  // so importing a multi-language file can never blend two languages'
  // vocabulary together — a word only ever merges into the vocabulary of
  // the language it was exported from.
  //
  // Older single-language files (schema v2, carrying a top-level `lang` +
  // `vocabulary`/`definitions`) and the original Spanish-only files
  // (LEGACY_EXPORT_SCHEMA, no `lang` field at all — treated as Spanish)
  // still import fine: each one just merges into that one language's slot,
  // regardless of which language happens to be selected in the picker right
  // now.
  const EXPORT_SCHEMA = 'linguatube-export';
  const LEGACY_EXPORT_SCHEMA = 'spanishtube-export';
  const EXPORT_VERSION = 3;

  function setBackupStatus(text, kind) {
    const el = document.getElementById('backupStatus');
    el.textContent = text;
    el.className = 'backup-status' + (kind ? ' ' + kind : '');
    if (text) setTimeout(() => { if (el.textContent === text) { el.textContent = ''; el.className = 'backup-status'; } }, 6000);
  }

  // Merges one language's imported vocab/defs into its own storage slot.
  // Imported entries win on a word conflict; definitions are merged and
  // de-duplicated by their highlighted "matched" text, same as before.
  // Fully self-contained (reads + writes only that language's own keys),
  // so it's safe to call once per language found in an import file without
  // any risk of cross-language bleed.
  function importIntoLanguage(langCode, importedVocab, importedDefs, callback) {
    const keys = window.SPTubeLang.storageKeys(langCode);
    chrome.storage.local.get([keys.vocab, keys.defs], (r) => {
      const currentVocab = r[keys.vocab] || {};
      const currentDefs = r[keys.defs] || {};

      const mergedVocab = { ...currentVocab, ...(importedVocab || {}) };

      const mergedDefs = { ...currentDefs };
      if (importedDefs) {
        Object.keys(importedDefs).forEach((word) => {
          let importedList = importedDefs[word];
          if (!Array.isArray(importedList)) importedList = importedList ? [importedList] : [];
          let existingList = mergedDefs[word];
          if (!Array.isArray(existingList)) existingList = existingList ? [existingList] : [];

          const seen = new Set(existingList.map(en => (en.matched || en.translation || '').trim().toLowerCase()));
          const combined = existingList.slice();
          importedList.forEach((entry) => {
            const key = (entry.matched || entry.translation || '').trim().toLowerCase();
            if (!key || seen.has(key)) return;
            seen.add(key);
            combined.push(entry);
          });
          if (combined.length) mergedDefs[word] = combined;
        });
      }

      chrome.storage.local.set({ [keys.vocab]: mergedVocab, [keys.defs]: mergedDefs }, () => {
        callback(Object.keys(mergedVocab).length);
      });
    });
  }

  document.getElementById('exportBtn').addEventListener('click', () => {
    // Pull every stored key at once and pick out each language's vocab/defs
    // by its own storage-key pattern, rather than looping storageKeys() over
    // just the languages currently listed in languages.js — this way a
    // language's data is never silently dropped from the backup even if it
    // was learned under an older build with a different language list.
    chrome.storage.local.get(null, (all) => {
      const languages = {};
      Object.keys(all).forEach((key) => {
        const vocabMatch = key.match(/^sptubeVocabulary_(.+)$/);
        if (vocabMatch) {
          const code = vocabMatch[1];
          languages[code] = languages[code] || {};
          languages[code].vocabulary = all[key] || {};
        }
        const defsMatch = key.match(/^sptubeDefinitions_(.+)$/);
        if (defsMatch) {
          const code = defsMatch[1];
          languages[code] = languages[code] || {};
          languages[code].definitions = all[key] || {};
        }
      });

      // Drop languages with nothing actually saved in them (an empty
      // {} for both fields), and fill in wordCount per language.
      let totalWords = 0;
      let langCount = 0;
      Object.keys(languages).forEach((code) => {
        const vocab = languages[code].vocabulary || {};
        const wordCount = Object.keys(vocab).length;
        const hasDefs = languages[code].definitions && Object.keys(languages[code].definitions).length > 0;
        if (wordCount === 0 && !hasDefs) { delete languages[code]; return; }
        languages[code].vocabulary = vocab;
        languages[code].definitions = languages[code].definitions || {};
        languages[code].wordCount = wordCount;
        totalWords += wordCount;
        langCount++;
      });

      if (langCount === 0) {
        setBackupStatus('Nothing saved yet — mark a few words first.', 'err');
        return;
      }

      const payload = {
        schema: EXPORT_SCHEMA,
        version: EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        languages,
      };
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const date = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `linguatube-vocabulary-${date}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setBackupStatus(`Exported ${totalWords} word${totalWords === 1 ? '' : 's'} across ${langCount} language${langCount === 1 ? '' : 's'}.`, 'ok');
    });
  });

  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });

  document.getElementById('importFile').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (err) {
        setBackupStatus('That file isn\u2019t valid JSON.', 'err');
        return;
      }

      const isLegacy = parsed && parsed.schema === LEGACY_EXPORT_SCHEMA;
      const isMultiLang = parsed && parsed.version >= 3 && parsed.languages && typeof parsed.languages === 'object';

      // ── New multi-language file: one entry per language, each merging
      // only into that language's own storage. ───────────────────────────
      if (isMultiLang) {
        const codes = Object.keys(parsed.languages).filter(code => {
          const entry = parsed.languages[code];
          return entry && typeof entry === 'object' && (entry.vocabulary || entry.definitions);
        });
        if (!codes.length) {
          setBackupStatus('That doesn\u2019t look like a Gift of Tongues export file.', 'err');
          return;
        }

        const summary = codes
          .map(code => `${window.SPTubeLang.getLanguageInfo(code).name}: ${Object.keys(parsed.languages[code].vocabulary || {}).length} word(s)`)
          .join('\n');
        const proceed = confirm(
          `Import vocabulary for ${codes.length} language${codes.length === 1 ? '' : 's'}?\n\n${summary}\n\n` +
          `Your saved words in each language will be kept. Where the same word exists in both, the imported status and meanings win.`
        );
        if (!proceed) return;

        let remaining = codes.length;
        codes.forEach((code) => {
          const entry = parsed.languages[code];
          importIntoLanguage(code, entry.vocabulary, entry.definitions, () => {
            remaining--;
            if (remaining === 0) {
              setBackupStatus(`Imported ${codes.length} language${codes.length === 1 ? '' : 's'}.`, 'ok');
              refresh();
            }
          });
        });
        return;
      }

      // ── Older single-language file (v2, or the original Spanish-only
      // export with no schema/lang field at all). ────────────────────────
      const importedVocab = parsed && typeof parsed.vocabulary === 'object' && parsed.vocabulary !== null
        ? parsed.vocabulary
        : (parsed && typeof parsed.spanishVocabulary === 'object' && parsed.spanishVocabulary !== null ? parsed.spanishVocabulary : null);
      const importedDefs = parsed && typeof parsed.definitions === 'object' && parsed.definitions !== null
        ? parsed.definitions
        : (parsed && typeof parsed.spanishDefinitions === 'object' && parsed.spanishDefinitions !== null ? parsed.spanishDefinitions : null);
      const importedLang = (parsed && parsed.lang) || (isLegacy ? 'es' : null) || LANG;

      if (!importedVocab) {
        setBackupStatus('That doesn\u2019t look like a Gift of Tongues export file.', 'err');
        return;
      }

      const importedCount = Object.keys(importedVocab).length;
      const langName = window.SPTubeLang.getLanguageInfo(importedLang).name;
      const proceed = confirm(
        `Import ${importedCount} ${langName} word${importedCount === 1 ? '' : 's'} from this file?\n\n` +
        `Your saved ${langName} words will be kept. Where the same word exists in both, the imported status and meanings win.`
      );
      if (!proceed) return;

      importIntoLanguage(importedLang, importedVocab, importedDefs, (wordCount) => {
        setBackupStatus(`Imported. You now have ${wordCount} ${langName} word${wordCount === 1 ? '' : 's'}.`, 'ok');
        refresh();
      });
    };
    reader.onerror = () => setBackupStatus('Couldn\u2019t read that file.', 'err');
    reader.readAsText(file);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[KEYS.vocab] || changes[KEYS.defs] || changes[KEYS.phrases]) refresh();
  });


  // ── Resolve which language we're managing, then do the first render ─────
  window.SPTubeLang.migrateLegacyIfNeeded(() => {
    window.SPTubeLang.getTargetLanguage((code) => {
      LANG = code;
      KEYS = window.SPTubeLang.storageKeys(LANG);
      LANG_INFO = window.SPTubeLang.getLanguageInfo(LANG);
      renderLangPicker();
      const label = document.getElementById('builderTranslateLabel');
      if (label) label.textContent = `2. Do your best to translate it into ${LANG_INFO.name}`;
      window.SPTubeLang.getNativeLanguage((nativeCode) => {
        NATIVE_LANG = nativeCode;
        NATIVE_LANG_INFO = window.SPTubeLang.getLanguageInfo(NATIVE_LANG);
        const englishLabel = document.getElementById('builderEnglishLabel');
        if (englishLabel) englishLabel.textContent = `1. Write a phrase in ${NATIVE_LANG_INFO.name}`;
        refresh();
      });
    });
  });
})();
