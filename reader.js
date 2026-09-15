// Gift of Tongues Reading Mode — click-to-learn on any website
// Turns text in an article, ebook, or any other page into the same
// color-coded, clickable words as the YouTube transcript/caption feature,
// using the shared engine in shared.js. Only runs on sites the user has
// explicitly turned Reading Mode on for (see popup.js / background.js).
(function () {
  'use strict';

  // Guard against double-injection (e.g. immediate popup injection landing
  // on top of the persistently-registered content script on the same page).
  if (window.__sptubeReaderActive) return;
  window.__sptubeReaderActive = true;

  const engine = window.SPTubeCore.createEngine({
    // No video to pause/resume on a generic page — plain hover/click behavior.
    onHoverStart() {},
    onHoverEnd() {},
    onActivate() {},
    onStatsChange() {
      updateReaderStats();
    },
  });

  // ── Known / learning / new ratio, shown inline in the Reading Mode badge ──
  // Only reflects words tokenized so far (Reading Mode tokenizes lazily as
  // blocks scroll into view), so the ratio fills in and can shift slightly
  // as the user scrolls through the page.
  function updateReaderStats() {
    const statsEl = document.querySelector('.sptube-reader-badge .sptube-stats-inline');
    if (!statsEl) return;
    const stats = engine.getStats(document);
    if (!stats.total) { statsEl.style.display = 'none'; statsEl.innerHTML = ''; return; }
    statsEl.style.display = 'flex';
    statsEl.innerHTML = window.SPTubeCore.buildStatsMarkup(stats);
  }

  // ── Which elements are worth tokenizing ─────────────────────────────────
  const BLOCK_TAGS = new Set([
    'P','LI','BLOCKQUOTE','FIGCAPTION','DD','DT','TD','TH',
    'H1','H2','H3','H4','H5','H6','SUMMARY','CAPTION'
  ]);
  const CONTAINER_TAGS = new Set(['DIV','SPAN','ARTICLE','SECTION']);
  const SKIP_TAGS = new Set([
    'SCRIPT','STYLE','NOSCRIPT','TEXTAREA','INPUT','SELECT','BUTTON',
    'SVG','CODE','PRE','IFRAME','CANVAS','VIDEO','AUDIO','FORM'
  ]);

  function hasBlockDescendantTag(el) {
    return [...el.children].some(c =>
      BLOCK_TAGS.has(c.tagName) || c.tagName === 'DIV' || c.tagName === 'UL' || c.tagName === 'OL' || c.tagName === 'TABLE'
    );
  }

  function isEligible(el) {
    if (el.isContentEditable) return false;
    if (el.closest('.sptube-popup, .sptube-hover-tooltip, .sptube-reader-badge')) return false;
    const text = el.textContent.trim();
    if (text.length < 8) return false;
    if (!/\s/.test(text)) return false;       // require at least two words
    if (!/\p{L}/u.test(text)) return false;   // require at least one letter
    return true;
  }

  // Finds "leaf" text blocks worth tokenizing under `root`: real prose tags
  // (p, li, headings, ...) that don't themselves wrap further block-level
  // children, plus generic div/span leaves with direct text — the same
  // fallback strategy the YouTube transcript scanner uses for panels whose
  // markup doesn't use semantic tags.
  function findReadableBlocks(root) {
    const found = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(el) {
        if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
        if (el.closest('.sptube-popup, .sptube-hover-tooltip, .sptube-reader-badge')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let el;
    while ((el = walker.nextNode())) {
      if (engine.hasTokenized(el)) continue;
      if (BLOCK_TAGS.has(el.tagName)) {
        if (hasBlockDescendantTag(el)) continue;
        if (isEligible(el)) found.push(el);
      } else if (CONTAINER_TAGS.has(el.tagName)) {
        if (el.children.length === 0 && isEligible(el)) found.push(el);
      }
    }
    return found;
  }

  // ── Lazy tokenizing: only process blocks as they scroll near the
  // viewport, so a huge article or ebook page doesn't get tokenized (and
  // re-rendered) all at once. ─────────────────────────────────────────────
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      io.unobserve(entry.target);
      // Mark as no-longer-pending *before* tokenizing, not after: if the
      // block was empty at this exact moment (e.g. a caption box that
      // hasn't received its first line yet) tokenizeContainer() will bail
      // out without actually tokenizing it, and it needs to be eligible to
      // be picked up again once real text lands — see observeBlocks below.
      observedBlocks.delete(entry.target);
      engine.tokenizeContainer(entry.target);
    });
  }, { rootMargin: '800px 0px' });

  const observedBlocks = new WeakSet();
  function observeBlocks(blocks) {
    blocks.forEach(el => {
      if (engine.hasTokenized(el)) return;    // genuinely done
      if (observedBlocks.has(el)) return;     // already queued, IO will get to it
      observedBlocks.add(el);
      io.observe(el);
    });
  }

  function scan(root) {
    observeBlocks(findReadableBlocks(root || document.body));
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 400);
  }

  // Finds the nearest ancestor (or self) already tokenized by the engine —
  // i.e. a block this scanner has processed before, whether as a one-shot
  // static block (tokenizeContainer) or a live one (tokenizeDynamicElement
  // below). `node` may be an element or a text node (mutation targets on
  // characterData records are always text nodes).
  function closestTokenizedContainer(node) {
    const el = node.nodeType === 3 ? node.parentElement : node;
    return el ? el.closest('.sptube-sentence-container') : null;
  }

  // tokenizeContainer() (used above) only ever renders a block once, which
  // is right for normal article prose — it never changes after it's read.
  // But some sites (e.g. custom video-caption boxes that aren't a plain
  // HTML5 <track>) keep reusing the *same* element and just swap its text
  // for each new line, rather than inserting a fresh element every time.
  // Left alone, that block would only ever get colored/clickable for
  // whichever line happened to be showing the first time it was tokenized,
  // and every line after that would render as plain, unclickable text —
  // exactly the "only some lines are colored" and "still can't click"
  // symptoms. Once a block is seen changing after its first tokenize, treat
  // it as "live" and keep re-rendering it (via tokenizeDynamicElement,
  // which is cheap to call repeatedly — it no-ops unless the text actually
  // changed) instead of leaving it frozen.
  const domObserver = new MutationObserver((mutations) => {
    let sawNewContent = false;
    const liveContainers = new Set();

    mutations.forEach(m => {
      if (m.type === 'characterData') {
        // A text mutation is only reachable here if the site still owns
        // that text node — i.e. it's inside a block we haven't tokenized
        // yet (tokenizing replaces the original text nodes with our own
        // word spans, so the site can no longer mutate them directly).
        // Either way, something worth looking at just changed.
        sawNewContent = true;
        const container = closestTokenizedContainer(m.target);
        if (container) liveContainers.add(container);
        return;
      }
      if (m.addedNodes.length === 0) return;
      const addedRealContent = [...m.addedNodes].some(n => n.nodeType === 1 || n.nodeType === 3);
      if (!addedRealContent) return;
      // If the new content landed inside (or as a full replacement of) a
      // block already tokenized — e.g. `el.textContent = nextLine` swaps in
      // one new text node where our old word spans used to be — refresh
      // that block instead of treating it as brand new.
      const container = closestTokenizedContainer(m.target);
      if (container) { liveContainers.add(container); return; }
      sawNewContent = true;
    });

    liveContainers.forEach(c => engine.tokenizeDynamicElement(c));
    if (sawNewContent) scheduleScan();
  });
  // characterData:true adds a little overhead, but Reading Mode is opt-in
  // per site, and it's the only way to catch a live region that mutates an
  // existing text node in place rather than swapping in new elements.
  domObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

  scan();

  // Re-scan on SPA-style URL changes (e.g. paginated readers, "next chapter"
  // navigation that doesn't reload the page).
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      engine.closePopup();
      setTimeout(() => scan(), 800);
    }
  }, 800);

  // ── On-page toggle badge ────────────────────────────────────────────────
  // Gives the user a quick, visible way to turn Reading Mode off again
  // without opening the extension popup — mirrors "the same coordinated
  // colors" request by keeping the whole experience on-page.
  function addBadge() {
    if (document.querySelector('.sptube-reader-badge')) return;
    const badge = document.createElement('div');
    badge.className = 'sptube-reader-badge';
    badge.innerHTML = `
      <span class="sptube-reader-badge-dot"></span> Reading Mode
      <span class="sptube-stats-inline" style="display:none"></span>
      <button class="sptube-reader-badge-off" title="Turn off Reading Mode on this site">✕</button>
    `;
    document.documentElement.appendChild(badge);
    badge.querySelector('.sptube-reader-badge-off').addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'READER_DISABLE_SITE', hostname: location.hostname }, () => {
        location.reload();
      });
    });
    updateReaderStats();
  }
  addBadge();
})();
