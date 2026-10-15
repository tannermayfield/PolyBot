// Polybot — Shared language configuration
// A single source of truth for "which languages can I learn" plus the small
// helpers every other script (popup, manager, catchup, background, content
// scripts) uses to read/write the user's chosen target language and to
// build the per-language storage keys everything else is filed under.
//
// Loaded as a plain script (no modules) so it works the same way in the
// background service worker (via importScripts) and in content scripts
// (declared before shared.js in manifest.json / the dynamic registration
// in background.js).
(function (root) {
  'use strict';

  // code:      Google Translate language code (also used to match
  //             <track lang> / TextTrack.language prefixes for captions).
  // name:      English display name.
  // flag:      Emoji shown throughout the UI.
  // speechLang: BCP-47 tag used for SpeechSynthesisUtterance.lang / picking
  //             a browser TTS voice. Falls back to `code` when omitted.
  // rtl:       true for right-to-left scripts (affects builder textarea only).
  const LANGUAGES = [
    { code: 'en', name: 'English',     flag: '🇬🇧', speechLang: 'en-US' },
    { code: 'es', name: 'Spanish',     flag: '🇪🇸', speechLang: 'es-ES' },
    { code: 'fr', name: 'French',      flag: '🇫🇷', speechLang: 'fr-FR' },
    { code: 'de', name: 'German',      flag: '🇩🇪', speechLang: 'de-DE' },
    { code: 'it', name: 'Italian',     flag: '🇮🇹', speechLang: 'it-IT' },
    { code: 'pt', name: 'Portuguese',  flag: '🇵🇹', speechLang: 'pt-PT' },
    { code: 'nl', name: 'Dutch',       flag: '🇳🇱', speechLang: 'nl-NL' },
    { code: 'sv', name: 'Swedish',     flag: '🇸🇪', speechLang: 'sv-SE' },
    { code: 'no', name: 'Norwegian',   flag: '🇳🇴', speechLang: 'nb-NO' },
    { code: 'da', name: 'Danish',      flag: '🇩🇰', speechLang: 'da-DK' },
    { code: 'fi', name: 'Finnish',     flag: '🇫🇮', speechLang: 'fi-FI' },
    { code: 'pl', name: 'Polish',      flag: '🇵🇱', speechLang: 'pl-PL' },
    { code: 'cs', name: 'Czech',       flag: '🇨🇿', speechLang: 'cs-CZ' },
    { code: 'ro', name: 'Romanian',    flag: '🇷🇴', speechLang: 'ro-RO' },
    { code: 'el', name: 'Greek',       flag: '🇬🇷', speechLang: 'el-GR' },
    { code: 'ru', name: 'Russian',     flag: '🇷🇺', speechLang: 'ru-RU' },
    { code: 'uk', name: 'Ukrainian',   flag: '🇺🇦', speechLang: 'uk-UA' },
    { code: 'tr', name: 'Turkish',     flag: '🇹🇷', speechLang: 'tr-TR' },
    { code: 'ar', name: 'Arabic',      flag: '🇸🇦', speechLang: 'ar-SA', rtl: true },
    { code: 'he', name: 'Hebrew',      flag: '🇮🇱', speechLang: 'he-IL', rtl: true },
    { code: 'hi', name: 'Hindi',       flag: '🇮🇳', speechLang: 'hi-IN' },
    { code: 'ja', name: 'Japanese',    flag: '🇯🇵', speechLang: 'ja-JP' },
    { code: 'ko', name: 'Korean',      flag: '🇰🇷', speechLang: 'ko-KR' },
    { code: 'zh-CN', name: 'Chinese (Simplified)', flag: '🇨🇳', speechLang: 'zh-CN' },
    { code: 'vi', name: 'Vietnamese',  flag: '🇻🇳', speechLang: 'vi-VN' },
    { code: 'th', name: 'Thai',        flag: '🇹🇭', speechLang: 'th-TH' },
    { code: 'id', name: 'Indonesian',  flag: '🇮🇩', speechLang: 'id-ID' },
  ];

  const DEFAULT_LANG = 'es';
  const STORAGE_KEY_TARGET_LANG = 'sptubeTargetLang';

  // ── Native language (the language *you* already speak) ──────────────────
  // Everything the app shows you *about* the language you're learning —
  // word definitions, sentence translations, the Build Phrases tool — gets
  // translated into this language instead of always assuming English.
  // Defaults to English so nothing changes for people who don't touch this.
  const DEFAULT_NATIVE_LANG = 'en';
  const STORAGE_KEY_NATIVE_LANG = 'sptubeNativeLang';

  function getNativeLanguage(callback) {
    chrome.storage.local.get([STORAGE_KEY_NATIVE_LANG], (r) => {
      callback((r && r[STORAGE_KEY_NATIVE_LANG]) || DEFAULT_NATIVE_LANG);
    });
  }

  function setNativeLanguage(code, callback) {
    chrome.storage.local.set({ [STORAGE_KEY_NATIVE_LANG]: code }, () => callback && callback());
  }

  // Only Spanish ships with a frequency word list today (see
  // frequency-data.js) — the Fast Catch-up tool is gated on this.
  const CATCHUP_SUPPORTED = { es: true };

  function getLanguageInfo(code) {
    return LANGUAGES.find(l => l.code === code) || LANGUAGES.find(l => l.code === DEFAULT_LANG);
  }

  function getTargetLanguage(callback) {
    chrome.storage.local.get([STORAGE_KEY_TARGET_LANG], (r) => {
      callback((r && r[STORAGE_KEY_TARGET_LANG]) || DEFAULT_LANG);
    });
  }

  function setTargetLanguage(code, callback) {
    chrome.storage.local.set({ [STORAGE_KEY_TARGET_LANG]: code }, () => callback && callback());
  }

  // Per-language storage keys, so switching target languages doesn't mix
  // vocabulary, saved definitions, or built phrases between languages.
  function storageKeys(code) {
    return {
      vocab: `sptubeVocabulary_${code}`,
      defs: `sptubeDefinitions_${code}`,
      phrases: `sptubePhrases_${code}`,
      catchupLevel: `sptubeCatchupLevel_${code}`,
    };
  }

  // One-time migration for people upgrading from the Spanish-only version,
  // where vocabulary/definitions/phrases were stored under fixed keys
  // ("spanishVocabulary", etc). Copies that data into the new "es"
  // namespaced keys the very first time, then never touches it again.
  const LEGACY_KEYS = { vocab: 'spanishVocabulary', defs: 'spanishDefinitions', phrases: 'spanishPhrases' };
  const MIGRATION_DONE_KEY = 'sptubeLegacyMigrationDone';

  function migrateLegacyIfNeeded(callback) {
    chrome.storage.local.get([MIGRATION_DONE_KEY], (flag) => {
      if (flag && flag[MIGRATION_DONE_KEY]) { callback && callback(); return; }
      chrome.storage.local.get([LEGACY_KEYS.vocab, LEGACY_KEYS.defs, LEGACY_KEYS.phrases], (legacy) => {
        const esKeys = storageKeys('es');
        const toSet = { [MIGRATION_DONE_KEY]: true };
        if (legacy[LEGACY_KEYS.vocab]) toSet[esKeys.vocab] = legacy[LEGACY_KEYS.vocab];
        if (legacy[LEGACY_KEYS.defs]) toSet[esKeys.defs] = legacy[LEGACY_KEYS.defs];
        if (legacy[LEGACY_KEYS.phrases]) toSet[esKeys.phrases] = legacy[LEGACY_KEYS.phrases];
        chrome.storage.local.set(toSet, () => callback && callback());
      });
    });
  }

  root.SPTubeLang = {
    LANGUAGES,
    DEFAULT_LANG,
    STORAGE_KEY_TARGET_LANG,
    DEFAULT_NATIVE_LANG,
    STORAGE_KEY_NATIVE_LANG,
    CATCHUP_SUPPORTED,
    getLanguageInfo,
    getTargetLanguage,
    setTargetLanguage,
    getNativeLanguage,
    setNativeLanguage,
    storageKeys,
    migrateLegacyIfNeeded,
  };
})(typeof self !== 'undefined' ? self : this);
