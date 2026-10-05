// Gift of Tongues — Fast catch-up logic
(function () {
  'use strict';

  function escHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  let LANG = window.SPTubeLang.DEFAULT_LANG;
  let KEYS = window.SPTubeLang.storageKeys(LANG);
  let vocabulary = {};
  // Tracks the highest level the user has confirmed via this tool, purely
  // for the UI (which cards show as "done"). Not required for correctness.
  let highestConfirmedLevel = 0;

  function render() {
    const container = document.getElementById('levels');
    container.innerHTML = SPANISH_FREQUENCY_LEVELS.map(lvl => {
      const done = lvl.level <= highestConfirmedLevel;
      return `
        <div class="level-card ${done ? 'done' : ''}" data-level="${lvl.level}">
          <div class="level-top">
            <div class="level-name">
              <span class="level-num">LV ${lvl.level}</span>
              <div>
                <div class="level-title">${escHtml(lvl.title)}</div>
                <div class="level-subtitle">${escHtml(lvl.subtitle)}</div>
              </div>
            </div>
          </div>
          <div class="sample-words">
            ${lvl.sample.map(w => `<span class="sample-chip">${escHtml(w)}</span>`).join('')}
          </div>
          <div class="level-actions">
            ${done
              ? `<span class="done-label">✓ Marked known through Level ${lvl.level}</span>`
              : `<button class="know-btn" data-level="${lvl.level}">I know all these + everything simpler →</button>`
            }
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.know-btn').forEach(btn => {
      btn.addEventListener('click', () => applyLevel(Number(btn.dataset.level)));
    });
  }

  function applyLevel(level) {
    const wordsToMark = new Set();
    SPANISH_FREQUENCY_LEVELS.forEach(lvl => {
      if (lvl.level <= level) lvl.words.forEach(w => wordsToMark.add(w.toLowerCase()));
    });

    let newlyMarked = 0;
    let skippedLearning = 0;
    wordsToMark.forEach(w => {
      const current = vocabulary[w];
      if (current === 'learning') { skippedLearning++; return; } // respect explicit choice
      if (current !== 'known') newlyMarked++;
      vocabulary[w] = 'known';
    });

    chrome.storage.local.set({ [KEYS.vocab]: vocabulary }, () => {
      highestConfirmedLevel = level;
      render();
      let msg = `✓ Marked ${newlyMarked} new word${newlyMarked === 1 ? '' : 's'} as known (Level ${level} and below)`;
      if (skippedLearning > 0) msg += ` — kept ${skippedLearning} you'd already marked "learning"`;
      showToast(msg);
    });
  }

  let toastTimer = null;
  function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 4200);
  }

  document.getElementById('closeLink').addEventListener('click', () => window.close());

  function showUnavailable(langInfo) {
    document.getElementById('levels').style.display = 'none';
    const el = document.getElementById('unavailable');
    el.style.display = 'block';
    el.innerHTML = `
      <p style="margin-bottom:10px;">Fast catch-up isn't available for <strong>${escHtml(langInfo.name)}</strong> yet —
      it needs a word-frequency list for that language, and only Spanish has one built in so far.</p>
      <p>You can still mark words known/learning individually as you go, or use the
      <a href="studio.html#vocabulary" style="color:var(--gt-blue)" target="_blank">Vocabulary</a> to review what you have saved.</p>
    `;
  }

  window.SPTubeLang.migrateLegacyIfNeeded(() => {
    window.SPTubeLang.getTargetLanguage((code) => {
      LANG = code;
      KEYS = window.SPTubeLang.storageKeys(LANG);
      const langInfo = window.SPTubeLang.getLanguageInfo(LANG);

      if (!window.SPTubeLang.CATCHUP_SUPPORTED[LANG]) {
        showUnavailable(langInfo);
        return;
      }

      chrome.storage.local.get([KEYS.vocab], (r) => {
        vocabulary = r[KEYS.vocab] || {};
        render();
      });
    });
  });
})();
