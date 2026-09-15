// Gift of Tongues Popup Script

let LANG = window.SPTubeLang.DEFAULT_LANG;
let KEYS = window.SPTubeLang.storageKeys(LANG);

function renderStats(vocab) {
  const words = Object.values(vocab);
  const learningCount = words.filter(v => v === 'learning').length;
  const knownCount = words.filter(v => v === 'known').length;

  document.getElementById('learningCount').textContent = learningCount;
  document.getElementById('knownCount').textContent = knownCount;
}

function refresh() {
  chrome.storage.local.get([KEYS.vocab], (result) => {
    const vocab = result[KEYS.vocab] || {};
    renderStats(vocab);
  });
}

// ── Language selector ────────────────────────────────────────────────────
function applyLangToUi(info) {
  document.getElementById('headerFlag').textContent = info.flag;
  document.getElementById('headerSub').textContent = `Learn ${info.name} on YouTube`;
  const catchupSub = document.getElementById('catchupSub');
  if (catchupSub) {
    catchupSub.textContent = window.SPTubeLang.CATCHUP_SUPPORTED[info.code]
      ? `Already know some ${info.name}? Mark whole levels known at once`
      : `Not available for ${info.name} yet`;
  }
}

const languageSelect = document.getElementById('languageSelect');
languageSelect.innerHTML = window.SPTubeLang.LANGUAGES.map(l =>
  `<option value="${l.code}">${l.flag} ${l.name}</option>`
).join('');

languageSelect.addEventListener('change', () => {
  window.SPTubeLang.setTargetLanguage(languageSelect.value, () => {
    LANG = languageSelect.value;
    KEYS = window.SPTubeLang.storageKeys(LANG);
    applyLangToUi(window.SPTubeLang.getLanguageInfo(LANG));
    refresh();
  });
});

// ── Native language (which language you already speak) ──────────────────
const nativeLanguageSelect = document.getElementById('nativeLanguageSelect');
nativeLanguageSelect.innerHTML = window.SPTubeLang.LANGUAGES.map(l =>
  `<option value="${l.code}">${l.flag} ${l.name}</option>`
).join('');

nativeLanguageSelect.addEventListener('change', () => {
  window.SPTubeLang.setNativeLanguage(nativeLanguageSelect.value, () => {});
});

window.SPTubeLang.getNativeLanguage((code) => {
  nativeLanguageSelect.value = code;
});

window.SPTubeLang.migrateLegacyIfNeeded(() => {
  window.SPTubeLang.getTargetLanguage((code) => {
    LANG = code;
    KEYS = window.SPTubeLang.storageKeys(LANG);
    languageSelect.value = LANG;
    applyLangToUi(window.SPTubeLang.getLanguageInfo(LANG));
    refresh();
  });
});

document.getElementById('clearBtn').addEventListener('click', () => {
  const info = window.SPTubeLang.getLanguageInfo(LANG);
  if (confirm(`Clear all saved ${info.name} vocabulary? This cannot be undone.`)) {
    chrome.storage.local.remove([KEYS.vocab, KEYS.defs], () => refresh());
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[KEYS.vocab]) refresh();
});

// ── Links to the full-page word manager & fast catch-up tool ───────────────
document.getElementById('openManagerBtn').addEventListener('click', () => {
  window.open(chrome.runtime.getURL('manager.html'), '_blank');
});

document.getElementById('openCatchupBtn').addEventListener('click', () => {
  window.open(chrome.runtime.getURL('catchup.html'), '_blank');
});

// ── Reading Mode (any website) ──────────────────────────────────────────
const readerModeToggle = document.getElementById('readerModeToggle');
const readerSiteLabel = document.getElementById('readerSiteLabel');
const readerUnavailable = document.getElementById('readerUnavailable');
const readerSection = document.getElementById('readerSection');

let currentTab = null;
let currentHostname = null;
let currentOriginPattern = null;

function isEligibleUrl(url) {
  return /^https?:\/\//.test(url || '');
}

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  currentTab = tabs[0];
  const url = currentTab && currentTab.url;

  if (!isEligibleUrl(url)) {
    readerSection.querySelector('.setting-row').style.display = 'none';
    readerUnavailable.style.display = 'block';
    return;
  }

  const u = new URL(url);
  currentHostname = u.hostname;
  currentOriginPattern = u.protocol + '//' + u.hostname + '/*';
  readerSiteLabel.textContent = currentHostname;

  chrome.permissions.contains({ origins: [currentOriginPattern] }, (granted) => {
    chrome.storage.local.get(['readerSites'], (r) => {
      const sites = r.readerSites || {};
      readerModeToggle.checked = !!granted && !!sites[currentHostname];
    });
  });
});

readerModeToggle.addEventListener('change', () => {
  if (!currentTab || !currentOriginPattern) { readerModeToggle.checked = false; return; }

  if (readerModeToggle.checked) {
    chrome.permissions.request({ origins: [currentOriginPattern] }, (granted) => {
      if (!granted) { readerModeToggle.checked = false; return; }

      chrome.storage.local.get(['readerSites'], (r) => {
        const sites = r.readerSites || {};
        sites[currentHostname] = true;
        chrome.storage.local.set({ readerSites: sites });
      });

      // Register reader.js to run automatically on future visits to this site...
      chrome.runtime.sendMessage(
        { type: 'READER_ENABLE_SITE', hostname: currentHostname, originPattern: currentOriginPattern },
        () => {
          // ...and inject it into the current tab right now, so there's no
          // need to refresh the page to see it take effect.
          chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ['languages.js', 'shared.js', 'reader.js', 'videocc.js'] }).catch(() => {});
          chrome.scripting.insertCSS({ target: { tabId: currentTab.id }, files: ['styles.css'] }).catch(() => {});
        }
      );
    });
  } else {
    chrome.storage.local.get(['readerSites'], (r) => {
      const sites = r.readerSites || {};
      delete sites[currentHostname];
      chrome.storage.local.set({ readerSites: sites });
    });
    chrome.runtime.sendMessage({ type: 'READER_DISABLE_SITE', hostname: currentHostname }, () => {
      chrome.tabs.reload(currentTab.id);
    });
  }
});
