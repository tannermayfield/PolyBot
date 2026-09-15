// Gift of Tongues Content Script — YouTube transcript + on-screen caption word lookup
// Site-specific glue only: finding transcript/caption DOM elements and
// pausing the video while a caption word is hovered/clicked. Whether
// YouTube's own captions are on at all is left entirely up to YouTube's own
// CC button — this only makes caption words clickable when they're already
// showing. All the actual tokenizing/popup/translation/storage logic lives
// in the shared engine (shared.js), so it behaves identically here and in
// Reading Mode on any other website.
(function () {
  'use strict';

  // ── Video helper ─────────────────────────────────────────────────────────
  function getVideoEl() {
    return document.querySelector('video.html5-main-video') || document.querySelector('video');
  }

  function isCaptionWord(span) {
    return !!span.closest('.ytp-caption-window-container');
  }

  // ── Figuring out when a selection was actually spoken, for clip capture ──
  // Transcript-panel entries show a "0:15"-style timestamp per line; parse
  // that into seconds. On-screen caption words don't carry a timestamp in
  // the DOM at all, so those fall back to the video's current playback
  // position (captured right as the word was hovered/clicked, since
  // hovering/clicking a caption word already pauses the video there).
  function parseTimestampToSeconds(text) {
    const parts = String(text || '').trim().split(':').map(Number);
    if (!parts.length || parts.some(n => Number.isNaN(n))) return null;
    let secs = 0;
    for (const p of parts) secs = secs * 60 + p;
    return secs;
  }

  function getTranscriptSegmentStart(span) {
    const seg = span.closest('ytd-transcript-segment-renderer');
    if (!seg) return null;
    const tsEl = seg.querySelector('[class*="timestamp"]');
    if (!tsEl) return null;
    return parseTimestampToSeconds(tsEl.textContent);
  }

  // Estimated speaking duration for a run of words, used both as an
  // end-time fallback (transcript lines with no next segment to bound
  // against) and for the whole caption-word case (no per-word timing at
  // all) — rough, but good enough for a short reference clip.
  function estimateSpokenSeconds(wordCount) {
    return Math.min(10, Math.max(1.2, wordCount / 2.3));
  }

  function getClipRangeForSpans(spans) {
    const video = getVideoEl();
    if (!video) return null;
    const first = spans[0];
    const duration = estimateSpokenSeconds(spans.length);

    if (isCaptionWord(first)) {
      const end = Math.min(video.duration || Infinity, video.currentTime + 0.6);
      const start = Math.max(0, end - duration - 0.6);
      return { video, start, end };
    }

    const segStart = getTranscriptSegmentStart(first);
    if (segStart == null) return null;
    const lastSeg = spans[spans.length - 1].closest('ytd-transcript-segment-renderer');
    let end = null;
    if (lastSeg && lastSeg.nextElementSibling) {
      end = getTranscriptSegmentStart(lastSeg.nextElementSibling);
    }
    if (end == null || end <= segStart) end = segStart + duration;
    return { video, start: Math.max(0, segStart - 0.15), end };
  }

  // Pausing/resuming the video while a caption word is hovered or clicked is
  // the only real YouTube-specific interaction behavior — everything else
  // (colors, popup, translation, saving) is handled by the shared engine.
  let hoveredCaptionWordEl = null;
  let pausedByHover = false;
  let resumeTimer = null;

  const engine = window.SPTubeCore.createEngine({
    onHoverStart(span) {
      clearTimeout(resumeTimer);
      if (!isCaptionWord(span)) return;
      hoveredCaptionWordEl = span;
      const video = getVideoEl();
      if (video && !video.paused) { video.pause(); pausedByHover = true; }
    },
    onHoverEnd(span) {
      if (hoveredCaptionWordEl === span) hoveredCaptionWordEl = null;
      if (!isCaptionWord(span)) return;
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        if (!pausedByHover) return;
        if (engine.isPopupOpen()) return; // a click popup is open — leave it paused
        const video = getVideoEl();
        if (video && video.paused) video.play();
        pausedByHover = false;
      }, 150);
    },
    onActivate(spans) {
      const anchorSpan = spans[0];
      if (!isCaptionWord(anchorSpan)) return;
      const video = getVideoEl();
      if (video && !video.paused) video.pause();
      pausedByHover = false;
    },
    onStatsChange() {
      updateStatsBadge();
    },
    async captureVideoClip(spans) {
      const range = getClipRangeForSpans(spans);
      if (!range) return null;
      return window.SPTubeCore.captureVideoClip(range.video, range.start, range.end);
    },
  });

  // ── Known / learning / new ratio badge for the transcript panel ─────────
  // Shown in the bottom corner whenever the transcript panel is open and
  // contains at least one tracked word; hidden again once the panel closes.
  const transcriptRoots = new Set();
  let statsBadgeEl = null;

  function removeStatsBadge() {
    if (statsBadgeEl) { statsBadgeEl.remove(); statsBadgeEl = null; }
  }

  function updateStatsBadge() {
    // Drop roots whose elements were removed (transcript panel closed / re-rendered).
    transcriptRoots.forEach(el => { if (!el.isConnected) transcriptRoots.delete(el); });
    if (transcriptRoots.size === 0) { removeStatsBadge(); return; }

    const stats = engine.getStats([...transcriptRoots]);
    if (stats.total === 0) { removeStatsBadge(); return; }

    if (!statsBadgeEl) {
      statsBadgeEl = document.createElement('div');
      statsBadgeEl.className = 'sptube-stats-badge';
      document.documentElement.appendChild(statsBadgeEl);
    }
    statsBadgeEl.innerHTML = `<span class="sptube-stats-badge-label">Transcript</span>${window.SPTubeCore.buildStatsMarkup(stats)}`;
  }

  // ── Find transcript segments ───────────────────────────────────────────────
  function findTranscriptSegments() {
    const selectors = [
      'ytd-transcript-segment-renderer .segment-text',
      'ytd-transcript-segment-renderer yt-formatted-string',
      'ytd-transcript-segment-renderer .cue',
      'ytd-transcript-segment-renderer',
      '[class*="transcript"] [class*="segment"]',
      '[class*="transcript"] yt-formatted-string',
      'ytd-transcript-body-renderer yt-formatted-string',
      'ytd-transcript-renderer yt-formatted-string',
      '#transcript yt-formatted-string',
    ];
    const found = new Set();
    for (const sel of selectors) {
      try { document.querySelectorAll(sel).forEach(el => found.add(el)); }
      catch (e) {}
    }
    const panels = document.querySelectorAll(
      'ytd-transcript-body-renderer, ytd-transcript-renderer, ytd-engagement-panel-section-list-renderer'
    );
    panels.forEach(panel => {
      if (!panel.textContent.includes(' ')) return;
      panel.querySelectorAll('yt-formatted-string, span, div').forEach(el => {
        if (el.children.length === 0 && el.textContent.trim().length > 0) found.add(el);
      });
    });
    return [...found];
  }

  // ── Make the on-screen caption words clickable ──────────────────────────────
  let captionObserver = null;
  let captionContainerEl = null;

  function findCaptionSegments(container) {
    if (!container) return [];
    const found = new Set();
    container.querySelectorAll('.ytp-caption-segment').forEach(el => found.add(el));
    if (found.size === 0) {
      container.querySelectorAll('*').forEach(el => {
        if (el.children.length === 0 && el.textContent.trim().length > 0) found.add(el);
      });
    }
    return [...found];
  }

  function tokenizeCaptions() {
    if (!captionContainerEl) return;
    findCaptionSegments(captionContainerEl).forEach(el => engine.tokenizeDynamicElement(el));
  }

  function bindCaptionObserver() {
    const container = document.querySelector('.ytp-caption-window-container');
    if (container === captionContainerEl) return;
    if (captionObserver) captionObserver.disconnect();
    captionContainerEl = container || null;
    if (!captionContainerEl) { captionObserver = null; return; }
    captionObserver = new MutationObserver(() => tokenizeCaptions());
    captionObserver.observe(captionContainerEl, { characterData: true, childList: true, subtree: true });
    tokenizeCaptions();
  }

  // ── "% known" scan for video thumbnails on screen ────────────────────────
  // Deliberately opt-in and one-shot: this never runs on its own. The
  // floating button below only appears when there's at least one video card
  // on the page, and clicking it scores only the cards currently loaded —
  // it doesn't scroll for more, doesn't re-run on a timer, and doesn't touch
  // any video off screen. Scrolling for more results and clicking again is a
  // separate, equally deliberate action each time.
  const SCAN_CARD_SELECTOR = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-playlist-video-renderer',
    'ytd-playlist-panel-video-renderer',
    'ytd-reel-item-renderer',
  ].join(', ');
  const SCAN_CONCURRENCY = 4;

  let scanBtnEl = null;
  let scanning = false;
  let scanGeneration = 0;

  function extractVideoId(href) {
    if (!href) return null;
    try {
      const url = new URL(href, location.origin);
      if (url.pathname === '/watch') return url.searchParams.get('v');
      const shortsMatch = url.pathname.match(/^\/shorts\/([^/?]+)/);
      if (shortsMatch) return shortsMatch[1];
    } catch (e) {}
    return null;
  }

  // One entry per unique video currently rendered on the page — cards that
  // repeat the same video (e.g. in both a shelf and the sidebar) are only
  // scored once.
  function findVideoCards() {
    const cards = new Map();
    document.querySelectorAll(SCAN_CARD_SELECTOR).forEach(card => {
      const link = card.querySelector('a#thumbnail, ytd-thumbnail a, a.ytd-thumbnail');
      const id = link && extractVideoId(link.getAttribute('href'));
      if (!id || cards.has(id)) return;
      const anchor = card.querySelector('ytd-thumbnail') || link;
      if (!anchor) return;
      cards.set(id, { anchor });
    });
    return cards;
  }

  function ensureScanButton() {
    const hasCards = findVideoCards().size > 0;
    if (!hasCards) { removeScanButton(); return; }
    if (scanBtnEl) return;
    scanBtnEl = document.createElement('button');
    scanBtnEl.type = 'button';
    scanBtnEl.className = 'sptube-scan-btn';
    scanBtnEl.textContent = '% known for videos on screen';
    scanBtnEl.addEventListener('click', runScan);
    document.documentElement.appendChild(scanBtnEl);
  }

  function removeScanButton() {
    if (scanBtnEl) { scanBtnEl.remove(); scanBtnEl = null; }
    scanning = false;
  }

  function clearBadge(anchor) {
    const existing = anchor.querySelector(':scope > .sptube-video-badge');
    if (existing) existing.remove();
  }

  function placeBadge(anchor, el) {
    if (getComputedStyle(anchor).position === 'static') anchor.style.position = 'relative';
    clearBadge(anchor);
    anchor.appendChild(el);
  }

  function showLoadingBadge(anchor) {
    const el = document.createElement('div');
    el.className = 'sptube-video-badge sptube-video-badge-loading';
    el.textContent = '···';
    placeBadge(anchor, el);
  }

  function renderVideoBadge(anchor, result, langName) {
    const el = document.createElement('div');
    if (!result.ok) {
      el.className = 'sptube-video-badge sptube-video-badge-none';
      el.textContent = 'no captions';
      el.title = `No ${langName} captions found for this video`;
      placeBadge(anchor, el);
      return;
    }
    const pct = result.stats.knownPct;
    const tier = pct >= 75 ? 'high' : pct >= 40 ? 'mid' : 'low';
    el.className = `sptube-video-badge sptube-video-badge-${tier}`;
    el.textContent = `${pct}% known`;
    el.title = `${result.stats.known} known, ${result.stats.learning} learning, ${result.stats.unknown} new word${result.stats.unknown === 1 ? '' : 's'}`
      + (result.isAuto ? ' (auto-generated captions)' : '');
    placeBadge(anchor, el);
  }

  function fetchAndScoreVideo(id, lang, vocabulary) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'FETCH_VIDEO_TRANSCRIPT', videoId: id, lang }, (res) => {
        if (chrome.runtime.lastError || !res || !res.ok) { resolve({ ok: false, reason: res && res.reason }); return; }
        const stats = window.SPTubeCore.computeTextStats(res.text, vocabulary);
        resolve({ ok: true, stats, isAuto: res.isAuto });
      });
    });
  }

  async function runScan() {
    if (scanning) return;
    const cards = findVideoCards();
    if (cards.size === 0) return;

    scanning = true;
    const myGeneration = scanGeneration;
    scanBtnEl.disabled = true;
    scanBtnEl.classList.add('scanning');

    const vocabulary = engine.getVocabularySnapshot();
    const lang = engine.getTargetLangCode();
    const langName = (window.SPTubeLang.getLanguageInfo(lang) || {}).name || lang;

    const entries = [...cards.entries()];
    entries.forEach(([, info]) => showLoadingBadge(info.anchor));

    let idx = 0, done = 0;
    scanBtnEl.textContent = `checking videos… 0/${entries.length}`;

    async function worker() {
      while (idx < entries.length) {
        const [id, info] = entries[idx++];
        const result = await fetchAndScoreVideo(id, lang, vocabulary);
        if (myGeneration !== scanGeneration) return; // page navigated away mid-scan
        if (info.anchor.isConnected) renderVideoBadge(info.anchor, result, langName);
        done++;
        if (scanBtnEl) scanBtnEl.textContent = `checking videos… ${done}/${entries.length}`;
      }
    }
    await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, entries.length) }, worker));

    if (myGeneration !== scanGeneration) return;
    scanning = false;
    if (scanBtnEl) {
      scanBtnEl.disabled = false;
      scanBtnEl.classList.remove('scanning');
      scanBtnEl.textContent = '↻ re-check % known';
    }
  }

  // ── Scan ───────────────────────────────────────────────────────────────────
  function scan() {
    findTranscriptSegments().forEach(el => {
      transcriptRoots.add(el);
      engine.tokenizeContainer(el);
    });
    updateStatsBadge();
    ensureScanButton();
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 600);
  }

  const domObserver = new MutationObserver((mutations) => {
    const relevant = mutations.some(m =>
      m.addedNodes.length > 0 && [...m.addedNodes].some(n => n.nodeType === 1)
    );
    if (relevant) scheduleScan();
  });
  domObserver.observe(document.body, { childList: true, subtree: true });

  scan();
  bindCaptionObserver();
  let lastUrl = location.href;
  setInterval(() => {
    bindCaptionObserver();         // caption container gets replaced on SPA navigation
    updateStatsBadge();     // prune the transcript ratio badge if the panel was closed
    ensureScanButton();     // show/hide the "% known" scan button depending on whether any video cards are present
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      engine.closePopup();
      hoveredCaptionWordEl = null;
      transcriptRoots.clear();
      removeStatsBadge();
      scanGeneration++;      // invalidate any scan still in flight from the previous page
      removeScanButton();
      setTimeout(scan, 2000);
    }
  }, 500);

})();
