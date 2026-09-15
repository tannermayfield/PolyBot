// Gift of Tongues Video Captions — click-to-learn on any <video> with subtitles,
// on any site the user has turned Reading Mode on for (see popup.js).
//
// A plain HTML5 <video> with a <track kind="subtitles"|"captions"> renders
// its captions in a closed rendering layer the browser draws itself —
// there's no DOM text to tokenize in place the way YouTube's own caption
// overlay works (content.js reads that directly, since YouTube renders its
// captions as ordinary elements). Instead, this reads the active cue text
// straight from the TextTrack API, sets the track to "hidden" (keeps cues
// firing, suppresses the native rendering) so there's no double captions,
// and draws our own overlay of clickable word spans positioned over the
// video, kept in sync every time the active cue changes.
(function () {
  'use strict';

  if (window.__sptubeVideoCCActive) return;
  window.__sptubeVideoCCActive = true;

  // YouTube already gets bespoke, more capable handling (transcript panel +
  // native caption overlay) from content.js — don't double up here even if
  // the user has also turned Reading Mode on for youtube.com.
  if (/(^|\.)youtube\.com$/.test(location.hostname)) return;

  // ── Pause/resume the video on click ──────────────────────────────────
  // Unlike YouTube (content.js), most third-party video players show their
  // own hover-triggered chrome (a control bar, a big pause button, etc.)
  // that can end up sitting on top of our caption overlay. Auto-pausing on
  // *hover* would trigger that chrome right as the user moves toward a
  // word to click it — so this only pauses on an actual click.
  function videoForSpan(span) {
    const overlay = span.closest('.sptube-videocc-overlay');
    return overlay ? overlay.__sptubeVideo : null;
  }

  const engine = window.SPTubeCore.createEngine({
    onHoverStart() {},
    onHoverEnd() {},
    onActivate(spans) {
      const video = videoForSpan(spans[0]);
      if (!video) return;
      if (!video.paused) video.pause();
    },
    onStatsChange() {},
  });

  // ── Guard against the page swallowing our clicks ─────────────────────
  // Many sites (menus, modals, and especially video players' own
  // "click anywhere on the player to toggle play/pause" handlers) attach
  // a document-level click listener that calls stopPropagation(), which
  // would prevent our word span's own click handler from ever firing.
  // A capture-phase listener on `window` runs before any such
  // document/body-level handler (capture travels window → document → …
  // → target), so intercept it there, stop it from reaching page code,
  // and re-fire a synthetic click directly at the word span so the
  // engine's normal click handling still runs. The isTrusted check keeps
  // this from re-triggering itself on that synthetic re-dispatch.
  window.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    const wordSpan = e.target && e.target.closest && e.target.closest('.sptube-videocc-overlay .sptube-word');
    if (!wordSpan) return;
    e.stopPropagation();
    e.preventDefault();
    wordSpan.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, composed: true,
      ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey,
      clientX: e.clientX, clientY: e.clientY, button: e.button,
    }));
  }, true);

  // ── Cue text extraction ──────────────────────────────────────────────
  // A VTTCue's .text is raw WebVTT payload and can carry markup (<i>, <c>,
  // <v Speaker>, timestamps…). getCueAsHTML() (where available) parses that
  // the same way the browser would before rendering it — take its plain
  // text rather than trying to strip tags by hand.
  function cueText(cue) {
    try {
      if (typeof cue.getCueAsHTML === 'function') {
        const frag = cue.getCueAsHTML();
        const div = document.createElement('div');
        div.appendChild(frag);
        return div.textContent.replace(/\s+/g, ' ').trim();
      }
    } catch (e) {}
    return String(cue.text || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  // ── Choosing which track to read ─────────────────────────────────────
  function pickTrack(video) {
    const tracks = [...video.textTracks].filter(t => t.kind === 'subtitles' || t.kind === 'captions');
    if (!tracks.length) return null;
    // Only read whatever the page/user has already turned on with the
    // site's own captions control — same as YouTube (content.js), this
    // never turns captions on by itself.
    return tracks.find(t => t.mode === 'showing') || null;
  }

  // ── Per-video overlay wiring ──────────────────────────────────────────
  const videoStates = new Map(); // video -> { track, overlay, lineEl, onCueChange }

  function teardownVideo(video) {
    const state = videoStates.get(video);
    if (!state) return;
    state.track.removeEventListener('cuechange', state.onCueChange);
    state.overlay.remove();
    videoStates.delete(video);
    if (videoStates.size === 0) stopPositionLoop();
  }

  function wireVideo(video) {
    const track = pickTrack(video);
    const state = videoStates.get(video);

    if (!track) { teardownVideo(video); return; }
    if (state && state.track === track) {
      // Some players periodically reset a track's mode back to "showing"
      // on their own (e.g. on each segment/quality switch) — a native
      // <track> render layer isn't part of normal CSS stacking, so if
      // that happens it can cover our overlay regardless of z-index.
      // Keep forcing it back to "hidden" so that never sticks.
      if (track.mode !== 'hidden') track.mode = 'hidden';
      return;
    }
    if (state) teardownVideo(video);

    track.mode = 'hidden'; // keep cues firing, suppress the browser's own rendering

    const overlay = document.createElement('div');
    overlay.className = 'sptube-videocc-overlay';
    overlay.__sptubeVideo = video;
    const lineEl = document.createElement('div');
    lineEl.className = 'sptube-videocc-line sptube-sentence-container';
    overlay.appendChild(lineEl);
    (document.fullscreenElement && document.fullscreenElement.contains(video) ? document.fullscreenElement : document.documentElement)
      .appendChild(overlay);

    function onCueChange() {
      if (track.mode !== 'hidden') track.mode = 'hidden'; // re-assert on every cue change too
      const cues = track.activeCues;
      const text = cues && cues.length ? [...cues].map(cueText).filter(Boolean).join(' ') : '';
      if (!text) {
        lineEl.textContent = '';
        delete lineEl.dataset.sptubeRaw;
        overlay.classList.remove('sptube-videocc-visible');
        return;
      }
      lineEl.textContent = text;
      engine.tokenizeDynamicElement(lineEl);
      overlay.classList.add('sptube-videocc-visible');
    }

    track.addEventListener('cuechange', onCueChange);
    onCueChange(); // pick up a cue that's already active

    videoStates.set(video, { track, overlay, lineEl, onCueChange });
    startPositionLoop();
  }

  // ── Keep the overlay positioned over its video ───────────────────────
  function positionOverlay(video, overlay) {
    const rect = video.getBoundingClientRect();
    const onScreen = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight
      && rect.right > 0 && rect.left < window.innerWidth;
    if (!onScreen) { overlay.style.visibility = 'hidden'; return; }
    overlay.style.visibility = 'visible';
    const left = rect.left + rect.width / 2;
    const bottom = Math.max(8, window.innerHeight - rect.bottom + rect.height * 0.14);
    overlay.style.left = `${left}px`;
    overlay.style.bottom = `${bottom}px`;
    overlay.style.maxWidth = `${Math.max(120, Math.min(rect.width * 0.94, 900))}px`;
  }

  let rafId = null;
  function positionLoop() {
    videoStates.forEach((state, video) => {
      if (!video.isConnected) { teardownVideo(video); return; }
      positionOverlay(video, state.overlay);
    });
    if (videoStates.size > 0) rafId = requestAnimationFrame(positionLoop);
    else rafId = null;
  }
  function startPositionLoop() {
    if (rafId == null) rafId = requestAnimationFrame(positionLoop);
  }
  function stopPositionLoop() {
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  document.addEventListener('fullscreenchange', () => {
    const fsEl = document.fullscreenElement;
    videoStates.forEach((state, video) => {
      const target = (fsEl && fsEl.contains(video)) ? fsEl : document.documentElement;
      if (state.overlay.parentElement !== target) target.appendChild(state.overlay);
    });
  });

  // ── Scan the page for videos ─────────────────────────────────────────
  // Skip tiny/thumbnail-sized videos (e.g. autoplaying previews in a
  // "related content" rail) — wiring those too would create a second,
  // independent caption overlay on the page that can end up visually
  // stacked on the real one and steal its cues/clicks.
  const MIN_VIDEO_SIZE = 160;

  function scan() {
    document.querySelectorAll('video').forEach(video => {
      if (video.closest('.sptube-popup, .sptube-hover-tooltip')) return;
      const rect = video.getBoundingClientRect();
      const bigEnough = rect.width >= MIN_VIDEO_SIZE && rect.height >= MIN_VIDEO_SIZE * 0.5;
      if (!bigEnough) { teardownVideo(video); return; }
      wireVideo(video);
    });
    // Drop tracking for videos that were removed from the page.
    videoStates.forEach((_, video) => { if (!video.isConnected) teardownVideo(video); });
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 500);
  }

  const domObserver = new MutationObserver((mutations) => {
    const relevant = mutations.some(m =>
      m.addedNodes.length > 0 && [...m.addedNodes].some(n => n.nodeType === 1)
    );
    if (relevant) scheduleScan();
  });
  domObserver.observe(document.body, { childList: true, subtree: true });

  scan();
  // Re-scan periodically too — text tracks can be added to an existing
  // <video> element (e.g. captions loading in async) without any DOM
  // mutation the observer above would catch, and a track's mode can also
  // be flipped by the page's own player UI at any time.
  setInterval(scan, 2000);
})();
