// Polybot — non-YouTube caption diagnostic
// Read-only: doesn't change anything on the page. Paste into the DevTools
// Console while a captioned video is playing, then copy the full output
// back.
//
// IMPORTANT: if the video is inside an <iframe> (common for embedded
// players), the extension's content scripts run separately *inside* that
// iframe's own context — the top-level page's console won't see them. In
// DevTools, click the context dropdown at the top of the Console panel
// (next to "top") and pick the iframe's origin before pasting this in. Run
// it once in "top" and once in the iframe context if you're not sure which
// one has the video.
(function () {
  const log = [];
  const say = (...args) => log.push(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));

  say('=== Polybot caption diagnostic ===');
  say('URL:', location.href);
  say('In iframe:', window !== window.top);

  say('\n--- Extension activity on this frame ---');
  say('Reading Mode active (reader.js ran):', !!window.__sptubeReaderActive);
  say('Video captions active (videocc.js ran):', !!window.__sptubeVideoCCActive);
  say('SPTubeCore engine loaded (shared.js ran):', !!window.SPTubeCore);

  say('\n--- <video> elements & their text tracks ---');
  const videos = [...document.querySelectorAll('video')];
  say('video element count:', videos.length);
  videos.forEach((v, i) => {
    const tracks = [...v.textTracks].map(t => ({
      kind: t.kind, label: t.label, language: t.language, mode: t.mode, cueCount: t.cues ? t.cues.length : null,
    }));
    say(`video[${i}]`, {
      paused: v.paused, currentSrc: v.currentSrc ? v.currentSrc.slice(0, 80) : null,
      trackElementCount: v.querySelectorAll('track').length,
      textTracks: tracks,
    });
  });

  say('\n--- Our overlay (videocc.js), if any ---');
  const overlays = [...document.querySelectorAll('.sptube-videocc-overlay')];
  say('videocc overlay count:', overlays.length);
  overlays.forEach((o, i) => say(`overlay[${i}] visible:`, o.classList.contains('sptube-videocc-visible'), 'text:', o.textContent.slice(0, 80)));

  say('\n--- Tokenized word spans on the page ---');
  const words = [...document.querySelectorAll('.sptube-word')];
  say('total .sptube-word spans:', words.length);
  const containers = new Set(words.map(w => w.closest('.sptube-sentence-container')).filter(Boolean));
  say('distinct tokenized containers:', containers.size);
  [...containers].slice(0, 5).forEach((c, i) => {
    const rect = c.getBoundingClientRect();
    say(`container[${i}]`, {
      tag: c.tagName, class: c.className.slice(0, 60), text: c.textContent.slice(0, 60),
      rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
      onScreen: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight,
    });
  });

  say('\n--- Click-through check on the first on-screen word ---');
  const visibleWord = words.find(w => {
    const r = w.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
  });
  if (!visibleWord) {
    say('No .sptube-word span is currently on-screen — scroll/play so a caption word is visible, then re-run.');
  } else {
    const r = visibleWord.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const topElement = document.elementFromPoint(cx, cy);
    say('sample word text:', visibleWord.textContent);
    say('sample word rect center:', { x: Math.round(cx), y: Math.round(cy) });
    say('element actually on top at that point:', topElement ? topElement.outerHTML.slice(0, 120) : null);
    say('is the word itself on top?', topElement === visibleWord);
    if (topElement !== visibleWord) {
      say('>>> Something else is intercepting clicks at that spot — see "element actually on top" above.');
    }
    // Walk up from the word checking computed pointer-events, in case
    // something still has none despite our override.
    let el = visibleWord;
    const chain = [];
    while (el && el !== document.documentElement) {
      const cs = getComputedStyle(el);
      chain.push({ tag: el.tagName, class: String(el.className).slice(0, 40), pointerEvents: cs.pointerEvents, zIndex: cs.zIndex, position: cs.position });
      el = el.parentElement;
    }
    say('pointer-events/z-index chain from word up to <html>:');
    chain.forEach(c => say('  ', c));
  }

  const output = log.join('\n');
  console.log(output);
  console.log('\n(Diagnostic also copied to your clipboard if the page allows it.)');
  try { copy(output); } catch (e) { /* clipboard access may be blocked; the console.log above still has it */ }
})();
