/* Spanish study storage. Legacy vocabulary remains owned by the existing extension. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StudioData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const STORAGE_KEY = 'giftOfTonguesStudio';
  const DAY = 86400000;
  const MAX_AUDIO = 28 * 1024 * 1024; // Encoded length: approximately 21 MB of audio.
  const MAX_BACKUP = 120 * 1024 * 1024;
  const LIMITS = { phrases: 5000, voices: 200, attempts: 10000, references: 200, vocabulary: 50000 };
  const LEGACY_KEYS = ['sptubePhrases_es', 'spanishPhrases', 'voiceboxSettings',
    'sptubeVocabulary_es', 'spanishVocabulary', 'sptubeDefinitions_es', 'spanishDefinitions'];
  const ACCENTS = Object.freeze([
    { id: 'es-MX', label: 'Mexico', shortLabel: 'Mexico', description: 'Explore Mexican Spanish reference speakers.' },
    { id: 'es-ES', label: 'Spain', shortLabel: 'Spain', description: 'Explore Spanish reference speakers from Spain.' },
    { id: 'es-AR', label: 'Argentina', shortLabel: 'Argentina', description: 'Explore Argentine Spanish reference speakers.' },
    { id: 'es-CO', label: 'Colombia', shortLabel: 'Colombia', description: 'Explore Colombian Spanish reference speakers.' },
    { id: 'es-CL', label: 'Chile', shortLabel: 'Chile', description: 'Explore Chilean Spanish reference speakers.' },
    { id: 'es-PR', label: 'Puerto Rico', shortLabel: 'Puerto Rico', description: 'Explore Puerto Rican Spanish reference speakers.' },
    { id: 'es-CU', label: 'Cuba', shortLabel: 'Cuba', description: 'Explore Cuban Spanish reference speakers.' },
    { id: 'es-PE', label: 'Peru', shortLabel: 'Peru', description: 'Explore Peruvian Spanish reference speakers.' }
  ].map(Object.freeze));
  const ACCENT_IDS = new Set(ACCENTS.map(accent => accent.id));
  const RATINGS = new Set(['again', 'hard', 'good', 'easy']);
  const META_KEYS = ['deletedPhraseIds', 'deletedAttemptIds', 'deletedVoiceIds', 'legacyAttemptIds',
    'legacyReferenceIds', 'legacyVoiceIds'];
  const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
  const STARTERS = [
    ['starter-repeat', '¿Podrías repetirlo un poco más despacio?', 'Could you repeat that a little more slowly?'],
    ['starter-weekend', '¿Qué te gustaría hacer este fin de semana?', 'What would you like to do this weekend?'],
    ['starter-coffee', 'Me gustaría un café con leche, por favor.', 'I would like a coffee with milk, please.'],
    ['starter-learning', 'Estoy aprendiendo español y quiero practicar contigo.', 'I am learning Spanish and I want to practice with you.']
  ];

  function fail(message) { throw new Error(message); }
  function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
  function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
    return value;
  }
  function safeTree(value, depth = 0, ancestors = new Set()) {
    if (depth > 30) fail('Data is nested too deeply.');
    if (!value || typeof value !== 'object') return;
    if (ancestors.has(value)) fail('Data must not contain circular references.');
    const proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) fail('Data must contain plain objects.');
    ancestors.add(value);
    for (const key of Object.keys(value)) {
      if (BAD_KEYS.has(key)) fail('Data contains an unsafe property name.');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor.get || descriptor.set) fail('Data must not contain accessors.');
      safeTree(value[key], depth + 1, ancestors);
    }
    ancestors.delete(value);
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function string(value, label, max = 20000, required = false) {
    if (value == null && !required) return '';
    if (typeof value !== 'string') fail(`${label} must be text.`);
    const result = value.trim();
    if (result.length > max || (required && !result)) fail(`${label} must contain ${required ? '1' : '0'}–${max} characters.`);
    return result;
  }
  function id(value, label = 'ID') {
    const result = string(value, label, 300, true);
    if (BAD_KEYS.has(result) || /[\u0000-\u001f\u007f]/.test(result)) fail(`${label} is invalid.`);
    return result;
  }
  function number(value, label, min = 0, max = Number.MAX_SAFE_INTEGER) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${label} is invalid.`);
    return value;
  }
  function timestamp(value, label = 'Date') { return number(value, label, 0, 8640000000000000); }
  function accent(value) {
    if (!ACCENT_IDS.has(value)) fail('Choose a supported Spanish accent region.');
    return value;
  }
  function endpoint(value) {
    let url;
    try { url = new URL(string(value, 'Service URL', 2048, true)); } catch (_) { fail('Enter a valid service URL.'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash) {
      fail('Service URLs must use HTTPS, or HTTP on localhost, without credentials, query, or fragment.');
    }
    return url.href.replace(/\/+$/, '');
  }
  function sourceUrl(value) {
    if (!value) return undefined;
    let url;
    try { url = new URL(string(value, 'Source URL', 4096, true)); } catch (_) { fail('Source URL is invalid.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('Source URL must be an HTTP or HTTPS page.');
    return url.href;
  }
  function audio(value) {
    if (typeof value !== 'string' || value.length > MAX_AUDIO) fail('Audio must be a data URL smaller than 21 MB.');
    const match = /^data:audio\/(?:webm|ogg|wav|x-wav|wave|mpeg|mp3|mp4|aac|x-m4a|flac)(?:;codecs=[a-zA-Z0-9., _-]+)?;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match || match[1].length % 4 !== 0) fail('Audio must be a valid base64 audio data URL.');
    return value;
  }
  function array(value, label, max) {
    if (!Array.isArray(value) || value.length > max) fail(`${label} must be a list of at most ${max} items.`);
    return value;
  }
  function unique(records, label) {
    const ids = new Set();
    for (const record of records) {
      if (ids.has(record.id)) fail(`${label} contains duplicate IDs.`);
      ids.add(record.id);
    }
    return records;
  }
  function defaults() {
    return { version: 1, phrases: [], voices: [], attempts: [], reviews: {}, vocabulary: [],
      settings: { accentId: 'es-MX', voiceboxUrl: 'http://127.0.0.1:17493', assessmentUrl: 'http://127.0.0.1:17494', assessmentEnabled: false, theme: 'system' },
      _meta: Object.fromEntries([['seeded', false], ...META_KEYS.map(key => [key, []])]) };
  }
  function settings(input, existing = defaults().settings) {
    object(input, 'Settings');
    const result = { ...defaults().settings, ...existing };
    if (own(input, 'accentId')) result.accentId = accent(input.accentId);
    if (own(input, 'voiceboxUrl')) result.voiceboxUrl = endpoint(input.voiceboxUrl);
    if (own(input, 'assessmentUrl')) result.assessmentUrl = endpoint(input.assessmentUrl);
    if (own(input, 'assessmentEnabled')) {
      if (typeof input.assessmentEnabled !== 'boolean') fail('Assessment setting must be true or false.');
      result.assessmentEnabled = input.assessmentEnabled;
    }
    if (own(input, 'theme')) {
      if (!['light', 'dark', 'system'].includes(input.theme)) fail('Theme must be light, dark, or system.');
      result.theme = input.theme;
    }
    return result;
  }
  function reference(input, now, makeId) {
    object(input, 'Reference');
    if (!['original', 'voicebox', 'upload'].includes(input.kind)) fail('Reference kind is invalid.');
    const result = { id: input.id ? id(input.id) : makeId('ref'), label: string(input.label || 'Reference clip', 'Reference label', 300, true),
      kind: input.kind, audioUrl: audio(input.audioUrl), createdAt: timestamp(input.createdAt == null ? now : input.createdAt) };
    if (input.voiceId) result.voiceId = id(input.voiceId, 'Voice ID');
    if (input.accentId) result.accentId = accent(input.accentId);
    return result;
  }
  function phrase(input, now, makeId, existing) {
    object(input, 'Phrase');
    const result = { id: input.id ? id(input.id) : makeId('phrase'), text: string(input.text, 'Spanish phrase', 10000, true),
      translation: string(own(input, 'translation') ? input.translation : existing && existing.translation, 'Translation', 10000), source: input.source || (existing && existing.source) || 'manual',
      createdAt: timestamp(existing ? existing.createdAt : (input.createdAt == null ? now : input.createdAt)), references: existing ? existing.references : [] };
    if (!['starter', 'manual', 'web', 'video'].includes(result.source)) fail('Phrase source is invalid.');
    const url = sourceUrl(own(input, 'sourceUrl') ? input.sourceUrl : existing && existing.sourceUrl);
    if (url) result.sourceUrl = url;
    const region = own(input, 'accentId') ? input.accentId : existing && existing.accentId;
    if (region) result.accentId = accent(region);
    return result;
  }
  function voice(input, makeId) {
    object(input, 'Voice');
    const result = { id: input.id ? id(input.id) : makeId('voice'), profileId: id(input.profileId, 'Voicebox profile ID'),
      name: string(input.name, 'Voice name', 300, true), accentId: accent(input.accentId), baseUrl: endpoint(input.baseUrl) };
    if (input.description) result.description = string(input.description, 'Voice description', 2000);
    return result;
  }
  function score(value) { return value == null ? null : number(value, 'Assessment score', 0, 100); }
  function assessment(input) {
    object(input, 'Assessment');
    if (input.provider !== 'azure') fail('Assessment provider is unsupported.');
    return { provider: 'azure', locale: accent(input.locale), transcript: string(input.transcript, 'Transcript', 20000),
      accuracy: score(input.accuracy), fluency: score(input.fluency), completeness: score(input.completeness),
      words: array(input.words || [], 'Assessment words', 2000).map(item => {
        object(item, 'Assessment word');
        const result = { word: string(item.word, 'Assessment word', 300), accuracy: score(item.accuracy) };
        if (item.errorType) result.errorType = string(item.errorType, 'Error type', 100);
        if (item.phonemes) result.phonemes = array(item.phonemes, 'Phonemes', 100).map(p => ({ phoneme: string(p.phoneme, 'Phoneme', 100), accuracy: score(p.accuracy) }));
        return result;
      }), tips: array(input.tips || [], 'Assessment tips', 100).map(tip => string(tip, 'Tip', 2000)),
      limitations: array(input.limitations || [], 'Assessment limitations', 100).map(tip => string(tip, 'Limitation', 2000)) };
  }
  function snapshot(input) {
    object(input, 'Reference snapshot');
    const result = { label: string(input.label, 'Reference label', 300, true), audioUrl: audio(input.audioUrl) };
    if (input.accentId) result.accentId = accent(input.accentId);
    if (input.text != null) result.text = string(input.text, 'Reference transcript', 10000, true);
    if (input.start != null) result.start = number(input.start, 'Segment start', 0, 86400);
    if (input.end != null) result.end = number(input.end, 'Segment end', 0, 86400);
    if (result.end != null && result.end <= (result.start || 0)) fail('Segment end must follow segment start.');
    return result;
  }
  function attempt(input, now, makeId) {
    object(input, 'Attempt');
    const result = { id: input.id ? id(input.id) : makeId('attempt'), phraseId: id(input.phraseId, 'Phrase ID'),
      createdAt: timestamp(input.createdAt == null ? now : input.createdAt), audioUrl: audio(input.audioUrl),
      duration: number(input.duration == null ? 0 : input.duration, 'Recording duration', 0, 86400),
      mode: input.mode || 'practice', accentId: accent(input.accentId) };
    if (input.text != null) result.text = string(input.text, 'Attempt transcript', 10000, true);
    if (!['practice', 'test'].includes(result.mode)) fail('Attempt mode is invalid.');
    if (input.referenceId) result.referenceId = id(input.referenceId, 'Reference ID');
    if (input.referenceSnapshot) result.referenceSnapshot = snapshot(input.referenceSnapshot);
    if (input.assessment) result.assessment = assessment(input.assessment);
    if (input.selfRating) {
      if (!RATINGS.has(input.selfRating)) fail('Self-rating is invalid.');
      result.selfRating = input.selfRating;
    }
    return result;
  }
  function review(input) {
    object(input, 'Review');
    if (!RATINGS.has(input.lastRating)) fail('Review rating is invalid.');
    return { dueAt: timestamp(input.dueAt), intervalDays: number(input.intervalDays, 'Review interval', 0, 36500),
      repetitions: number(input.repetitions, 'Review repetitions', 0, 1000000), lastRating: input.lastRating, reviewedAt: timestamp(input.reviewedAt) };
  }
  function vocabularyItem(input) {
    object(input, 'Vocabulary item');
    const result = { id: id(input.id, 'Vocabulary ID'), word: string(input.word, 'Vocabulary word', 1000, true),
      meaning: string(input.meaning, 'Vocabulary meaning', 20000), status: string(input.status || 'learning', 'Vocabulary status', 100) };
    if (input.context) result.context = string(input.context, 'Vocabulary context', 20000);
    return result;
  }
  function normalizeState(input) {
    object(input, 'Studio state');
    safeTree(input);
    if (input.version !== 1) fail('This studio data version is not supported.');
    const result = defaults();
    const noId = () => fail('Backup records must have IDs.');
    result.phrases = unique(array(input.phrases, 'Phrases', LIMITS.phrases).map(p => {
      timestamp(p.createdAt, 'Phrase creation date');
      const item = phrase(p, 0, noId);
      item.references = unique(array(p.references || [], 'References', LIMITS.references).map(r => {
        timestamp(r.createdAt, 'Reference creation date'); return reference(r, 0, noId);
      }), 'References');
      return item;
    }), 'Phrases');
    result.voices = unique(array(input.voices, 'Voices', LIMITS.voices).map(v => voice(v, noId)), 'Voices');
    result.attempts = unique(array(input.attempts, 'Attempts', LIMITS.attempts).map(a => {
      timestamp(a.createdAt, 'Recording creation date');
      number(a.duration, 'Recording duration', 0, 86400);
      return attempt(a, 0, noId);
    }), 'Attempts');
    result.settings = settings(input.settings);
    result.vocabulary = unique(array(input.vocabulary || [], 'Vocabulary', LIMITS.vocabulary).map(vocabularyItem), 'Vocabulary');
    object(input.reviews, 'Reviews');
    const phraseIds = new Set(result.phrases.map(p => p.id));
    for (const record of result.attempts) {
      if (!phraseIds.has(record.phraseId)) fail('A recording refers to a missing phrase.');
      // Older studio exports did not have a separate frozen attempt transcript.
      if (!record.text) record.text = record.referenceSnapshot && record.referenceSnapshot.text || result.phrases.find(p => p.id === record.phraseId).text;
    }
    const reviewKeys = Object.keys(input.reviews);
    if (reviewKeys.length > LIMITS.vocabulary + LIMITS.phrases) fail('Too many reviews.');
    for (const key of reviewKeys) {
      if (!/^(meaning|speaking):.+$/.test(key)) fail('Review key is invalid.');
      const colon = key.indexOf(':');
      id(key.slice(colon + 1), 'Review item ID');
      if (key.startsWith('speaking:') && !phraseIds.has(key.slice(colon + 1))) fail('A speaking review refers to a missing phrase.');
      result.reviews[key] = review(input.reviews[key]);
    }
    if (input._meta != null) {
      object(input._meta, 'Migration metadata');
      if (own(input._meta, 'seeded') && typeof input._meta.seeded !== 'boolean') fail('Migration seed flag is invalid.');
      result._meta.seeded = input._meta.seeded === true;
      for (const key of META_KEYS) result._meta[key] = [...new Set(array(input._meta[key] || [], 'Migration IDs', 100000).map(v => id(v)))];
    }
    return result;
  }
  // IDs derived from existing sources are stable; two independent hashes reduce collisions.
  function fingerprint(value) {
    let a = 2166136261, b = 5381;
    for (let i = 0; i < value.length; i++) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ value.charCodeAt(i); }
    return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
  }
  function tryValue(fn) { try { return fn(); } catch (_) { return null; } }
  function deriveVocabulary(all, fallback = []) {
    const vocab = objectOrEmpty(own(all, 'sptubeVocabulary_es') ? all.sptubeVocabulary_es : all.spanishVocabulary);
    const defs = objectOrEmpty(own(all, 'sptubeDefinitions_es') ? all.sptubeDefinitions_es : all.spanishDefinitions);
    const merged = new Map(fallback.map(item => [item.id, item]));
    for (const word of Object.keys(vocab)) {
      if (BAD_KEYS.has(word)) continue;
      const value = vocab[word];
      const key = word.toLowerCase();
      let entries = own(defs, key) ? defs[key] : undefined;
      entries = Array.isArray(entries) ? entries : entries ? [entries] : [];
      const entry = entries.find(item => item && (typeof item.matched === 'string' && item.matched.trim())) ||
        entries.find(item => item && typeof item.translation === 'string' && item.translation.trim());
      const parsed = tryValue(() => vocabularyItem({ id: `es:${key}`, word,
        meaning: entry ? (entry.matched || entry.translation || '') : '',
        status: typeof value === 'string' ? value : value && value.status || 'learning', context: entry && entry.sentence }));
      if (parsed) merged.set(parsed.id, parsed);
    }
    return [...merged.values()].sort((a, b) => a.word.localeCompare(b.word, 'es'));
  }
  function objectOrEmpty(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }

  function migrate(state, all, now, isNew) {
    let changed = isNew;
    const meta = state._meta;
    const legacy = objectOrEmpty(all.voiceboxSettings);
    const legacyBase = legacy.baseUrl ? tryValue(() => endpoint(legacy.baseUrl)) : null;
    if (isNew && legacyBase) state.settings.voiceboxUrl = legacyBase;
    if (legacy.profileId && legacyBase) {
      const voiceId = `legacy-voice-${fingerprint(legacyBase + ':' + legacy.profileId)}`;
      if (!meta.legacyVoiceIds.includes(voiceId) && !meta.deletedVoiceIds.includes(voiceId)) {
        const item = tryValue(() => voice({ id: voiceId, profileId: legacy.profileId, name: legacy.profileName || 'Imported Voicebox voice',
          accentId: 'es-MX', baseUrl: legacyBase, description: 'Imported voice. Confirm its region before using it as an accent reference.' }));
        if (item && state.voices.length < LIMITS.voices) {
          if (!state.voices.some(v => v.id === voiceId)) state.voices.push(item);
          meta.legacyVoiceIds.push(voiceId); changed = true;
        }
      }
    }
    // The namespaced list supersedes the old Spanish-only list, including deletions.
    const legacyPhrases = own(all, 'sptubePhrases_es') ? all.sptubePhrases_es : all.spanishPhrases;
    for (const old of Array.isArray(legacyPhrases) ? legacyPhrases : []) {
      if (!old || typeof old !== 'object' || !old.savedTranslation) continue;
      const phraseId = tryValue(() => id(old.id)) || `legacy-phrase-${fingerprint(`${old.savedAt || 0}:${old.savedTranslation}`)}`;
      if (meta.deletedPhraseIds.includes(phraseId)) continue;
      let item = state.phrases.find(p => p.id === phraseId);
      if (!item) {
        item = tryValue(() => phrase({ id: phraseId, text: old.savedTranslation, translation: old.english || '',
          source: old.source === 'video' ? 'video' : old.source === 'web' ? 'web' : 'manual', sourceUrl: old.sourceUrl,
          createdAt: typeof old.savedAt === 'number' ? old.savedAt : now }, now));
        if (!item || state.phrases.length >= LIMITS.phrases) continue;
        state.phrases.push(item); changed = true;
      }
      for (const [field, kind, label] of [['videoClip', 'original', 'Original native clip'], ['voiceboxAudio', 'voicebox', 'Imported Voicebox reference']]) {
        if (!old[field]) continue;
        const referenceId = `legacy-ref-${fingerprint(`${phraseId}:${field}:${old[field]}`)}`;
        if (meta.legacyReferenceIds.includes(referenceId)) continue;
        const candidate = tryValue(() => reference({ id: referenceId, kind, label, audioUrl: old[field], createdAt: item.createdAt,
          ...(kind === 'voicebox' && old.voiceboxAudioProfileId && legacyBase ? { voiceId: `legacy-voice-${fingerprint(legacyBase + ':' + old.voiceboxAudioProfileId)}` } : {}) }, now));
        if (candidate && item.references.length < LIMITS.references) {
          if (!item.references.some(r => r.id === referenceId)) item.references.push(candidate);
          meta.legacyReferenceIds.push(referenceId); changed = true;
        }
      }
      if (old.recording) {
        const attemptId = `legacy-attempt-${fingerprint(`${phraseId}:${old.recording}`)}`;
        if (!meta.legacyAttemptIds.includes(attemptId) && !meta.deletedAttemptIds.includes(attemptId)) {
          const candidate = tryValue(() => attempt({ id: attemptId, phraseId, createdAt: item.createdAt, audioUrl: old.recording,
            duration: 0, mode: 'practice', accentId: state.settings.accentId, text: old.savedTranslation }, now));
          if (candidate && state.attempts.length < LIMITS.attempts) {
            // Old recordings have no reliable reference association or measured duration.
            if (!state.attempts.some(a => a.id === attemptId)) state.attempts.push(candidate);
            meta.legacyAttemptIds.push(attemptId); changed = true;
          }
        }
      }
    }
    if (!meta.seeded) {
      if (!state.phrases.length && !meta.deletedPhraseIds.length) {
        state.phrases = STARTERS.map(([phraseId, text, translation]) => phrase({ id: phraseId, text, translation, source: 'starter' }, now));
      }
      meta.seeded = true; changed = true;
    }
    return changed;
  }

  function browserStorage() {
    if (root.chrome && root.chrome.storage && root.chrome.storage.local) {
      const chrome = root.chrome;
      return {
        emitsChanges: true,
        get(keys) { return new Promise((resolve, reject) => chrome.storage.local.get(keys, result => {
          const error = chrome.runtime && chrome.runtime.lastError;
          if (error) reject(new Error(error.message || 'Could not read study data.')); else resolve(result || {});
        })); },
        set(values) { return new Promise((resolve, reject) => chrome.storage.local.set(values, () => {
          const error = chrome.runtime && chrome.runtime.lastError;
          if (error) reject(new Error(error.message || 'Could not save study data.')); else resolve();
        })); },
        subscribe(callback) {
          const handler = (changes, area) => { if (area === 'local' && Object.keys(changes).some(key => key === STORAGE_KEY || LEGACY_KEYS.includes(key))) callback(); };
          chrome.storage.onChanged.addListener(handler);
          return () => chrome.storage.onChanged.removeListener(handler);
        }
      };
    }
    return {
      get(keys) {
        if (!root.localStorage) return Promise.reject(new Error('Local storage is unavailable. Open the extension or localhost preview.'));
        const result = {};
        for (const key of keys) {
          const value = root.localStorage.getItem(key);
          if (value != null) {
            try { result[key] = JSON.parse(value); } catch (_) { if (key === STORAGE_KEY) fail('Stored studio data is damaged. Export or restore a backup before continuing.'); }
          }
        }
        return Promise.resolve(result);
      },
      set(values) {
        try { for (const [key, value] of Object.entries(values)) root.localStorage.setItem(key, JSON.stringify(value)); }
        catch (error) { throw new Error('Could not save study data. Browser preview storage may be full; use the extension for recordings.'); }
        return Promise.resolve();
      },
      subscribe(callback) {
        const handler = event => { if (event.key === null || event.key === STORAGE_KEY || LEGACY_KEYS.includes(event.key)) callback(); };
        if (root.addEventListener) root.addEventListener('storage', handler);
        return () => { if (root.removeEventListener) root.removeEventListener('storage', handler); };
      }
    };
  }

  function createStore(options = {}) {
    const storage = options.storage || browserStorage();
    const locks = own(options, 'locks') ? options.locks : root.navigator && root.navigator.locks;
    const clock = options.now || Date.now;
    const makeId = options.makeId || (prefix => `${prefix}-${root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)}`);
    let queue = Promise.resolve();
    const listeners = new Set();
    let unsubscribeStorage;
    function notify() { for (const callback of [...listeners]) { try { callback(); } catch (_) { /* A subscriber cannot block storage. */ } } }
    function serialized(fn) {
      const operation = queue.then(() => locks && typeof locks.request === 'function' ? locks.request(`${STORAGE_KEY}:write`, fn) : fn());
      queue = operation.catch(() => {});
      return operation;
    }
    async function transact(mutation, includeMeta = false, beforeMigration) {
      return serialized(async () => {
        const all = await storage.get([STORAGE_KEY, ...LEGACY_KEYS]);
        const existed = own(all, STORAGE_KEY);
        const state = existed ? normalizeState(all[STORAGE_KEY]) : defaults();
        if (beforeMigration) beforeMigration(state, existed);
        let changed = migrate(state, all, clock(), !existed);
        let result;
        if (mutation) { result = mutation(state, all, existed); changed = true; }
        if (changed) {
          await storage.set({ [STORAGE_KEY]: state });
          if (!storage.emitsChanges) notify();
        }
        if (mutation) return clone(result == null ? null : result);
        const output = { ...state, vocabulary: deriveVocabulary(all, state.vocabulary) };
        if (!includeMeta) delete output._meta;
        return clone(output);
      });
    }
    const api = {
      ACCENTS, STORAGE_KEY,
      init() { return transact(); },
      load() { return transact(); },
      savePhrase(input) {
        safeTree(input);
        return transact(state => {
          const existing = input.id ? state.phrases.find(p => p.id === input.id) : null;
          const item = phrase(input, clock(), makeId, existing);
          if (state._meta.deletedPhraseIds.includes(item.id)) fail('This phrase was deleted. Save a new phrase instead.');
          if (existing) state.phrases[state.phrases.indexOf(existing)] = item;
          else { if (state.phrases.length >= LIMITS.phrases) fail('The phrase limit has been reached.'); state.phrases.push(item); }
          return item;
        });
      },
      removePhrase(phraseId) {
        id(phraseId);
        return transact(state => {
          state.phrases = state.phrases.filter(p => p.id !== phraseId);
          for (const item of state.attempts.filter(a => a.phraseId === phraseId)) if (!state._meta.deletedAttemptIds.includes(item.id)) state._meta.deletedAttemptIds.push(item.id);
          state.attempts = state.attempts.filter(a => a.phraseId !== phraseId);
          delete state.reviews[`speaking:${phraseId}`];
          if (!state._meta.deletedPhraseIds.includes(phraseId)) state._meta.deletedPhraseIds.push(phraseId);
          return true;
        });
      },
      saveVoice(input) {
        safeTree(input);
        return transact(state => {
          const item = voice(input, makeId);
          if (state._meta.deletedVoiceIds.includes(item.id)) fail('This voice was removed. Add it again as a new voice.');
          const index = state.voices.findIndex(v => v.id === item.id);
          if (index >= 0) state.voices[index] = item;
          else { if (state.voices.length >= LIMITS.voices) fail('The voice limit has been reached.'); state.voices.push(item); }
          return item;
        });
      },
      removeVoice(voiceId) {
        id(voiceId);
        return transact(state => {
          state.voices = state.voices.filter(v => v.id !== voiceId);
          if (!state._meta.deletedVoiceIds.includes(voiceId)) state._meta.deletedVoiceIds.push(voiceId);
          return true;
        });
      },
      addReference(phraseId, input) {
        id(phraseId); safeTree(input);
        return transact(state => {
          const target = state.phrases.find(p => p.id === phraseId);
          if (!target) fail('That phrase no longer exists.');
          const item = reference(input, clock(), makeId);
          if (target.references.some(r => r.id === item.id)) fail('Reference IDs must be unique.');
          if (target.references.length >= LIMITS.references) fail('The reference limit has been reached for this phrase.');
          target.references.push(item); return item;
        });
      },
      saveAttempt(input) {
        safeTree(input);
        return transact(state => {
          const existing = input.id && state.attempts.find(a => a.id === input.id);
          const item = attempt(input, clock(), makeId);
          const target = state.phrases.find(p => p.id === item.phraseId);
          if (!target) fail('That phrase no longer exists.');
          item.text = existing ? existing.text : string(input.text || input.referenceSnapshot && input.referenceSnapshot.text || target.text, 'Attempt transcript', 10000, true);
          if (state._meta.deletedAttemptIds.includes(item.id)) fail('That recording was deleted.');
          if (existing) {
            if (item.phraseId !== existing.phraseId || item.audioUrl !== existing.audioUrl) fail('An existing recording cannot be replaced. Save a new attempt.');
            // Assessment and self-rating may be appended; the original reference remains immutable.
            item.createdAt = existing.createdAt; item.duration = existing.duration; item.mode = existing.mode; item.accentId = existing.accentId;
            delete item.referenceId; delete item.referenceSnapshot;
            if (existing.referenceId) item.referenceId = existing.referenceId;
            if (existing.referenceSnapshot) item.referenceSnapshot = existing.referenceSnapshot;
            if (!item.assessment && existing.assessment) item.assessment = existing.assessment;
            if (!item.selfRating && existing.selfRating) item.selfRating = existing.selfRating;
            state.attempts[state.attempts.indexOf(existing)] = item;
          } else {
            if (item.referenceId && !item.referenceSnapshot) {
              const ref = target.references.find(r => r.id === item.referenceId);
              if (!ref) fail('The selected reference no longer exists.');
              item.referenceSnapshot = snapshot({ label: ref.label, audioUrl: ref.audioUrl, accentId: ref.accentId, text: target.text });
            }
            if (state.attempts.length >= LIMITS.attempts) fail('The recording limit has been reached. Export a backup and remove older recordings.');
            state.attempts.push(item);
          }
          return item;
        });
      },
      removeAttempt(attemptId) {
        id(attemptId);
        return transact(state => {
          state.attempts = state.attempts.filter(a => a.id !== attemptId);
          if (!state._meta.deletedAttemptIds.includes(attemptId)) state._meta.deletedAttemptIds.push(attemptId);
          return true;
        });
      },
      saveSettings(input) { safeTree(input); return transact(state => { state.settings = settings(input, state.settings); return state.settings; }); },
      rateReview(kind, itemId, rating, now = clock()) {
        if (!['meaning', 'speaking'].includes(kind) || !RATINGS.has(rating)) return Promise.reject(new Error('Review kind or rating is invalid.'));
        id(itemId); timestamp(now);
        return transact((state, all) => {
          const candidates = kind === 'meaning' ? deriveVocabulary(all, state.vocabulary) : state.phrases;
          const item = candidates.find(candidate => candidate.id === itemId);
          if (!item || (kind === 'meaning' && !item.meaning.trim())) fail('This review item is unavailable or has no saved meaning.');
          const key = `${kind}:${itemId}`;
          const previous = state.reviews[key];
          const prior = previous ? previous.intervalDays : 0;
          let intervalDays;
          if (rating === 'again') intervalDays = 10 / (24 * 60);
          else if (rating === 'hard') intervalDays = Math.max(1, Math.round(prior * 1.2));
          else if (rating === 'good') intervalDays = Math.max(1, Math.round(prior * 2.5));
          else intervalDays = Math.max(4, Math.round(prior * 3.5));
          intervalDays = Math.min(intervalDays, 365);
          const result = { dueAt: now + intervalDays * DAY, intervalDays,
            repetitions: rating === 'again' ? 0 : (previous ? previous.repetitions : 0) + 1, lastRating: rating, reviewedAt: now };
          state.reviews[key] = result; return result;
        });
      },
      dueItems,
      stats,
      async exportBackup() { return { format: 'gift-of-tongues-studio', version: 1, state: await transact(null, true) }; },
      importBackup(input) {
        let candidate;
        try {
          if (typeof input === 'string') {
            if (input.length > MAX_BACKUP) fail('Backup is too large (maximum 120 MB).');
            input = JSON.parse(input);
          }
          object(input, 'Backup'); safeTree(input);
          if (input.format !== 'gift-of-tongues-studio' || input.version !== 1) fail('Choose a supported Gift of Tongues studio backup.');
          if (JSON.stringify(input).length > MAX_BACKUP) fail('Backup is too large (maximum 120 MB).');
          candidate = normalizeState(input.state);
        } catch (error) { return Promise.reject(error); }
        return transact((state, all, existed) => {
          const merge = (existing, incoming, removed, limit, label) => {
            const present = new Set(existing.map(item => item.id));
            const merged = [...existing, ...incoming.filter(item => !present.has(item.id) && !removed.includes(item.id))];
            if (merged.length > limit) fail(`Merged backup exceeds the ${label} limit.`);
            return merged;
          };
          const existingIds = new Set(state.phrases.map(p => p.id));
          state.phrases = merge(state.phrases, candidate.phrases, state._meta.deletedPhraseIds, LIMITS.phrases, 'phrase');
          // Merge reference additions, while preserving the existing phrase text and reference content.
          for (const incoming of candidate.phrases) {
            const target = state.phrases.find(p => p.id === incoming.id);
            if (target && existingIds.has(target.id)) target.references = merge(target.references, incoming.references, [], LIMITS.references, 'reference');
          }
          state.voices = merge(state.voices, candidate.voices, state._meta.deletedVoiceIds, LIMITS.voices, 'voice');
          const phraseIds = new Set(state.phrases.map(p => p.id));
          state.attempts = merge(state.attempts, candidate.attempts.filter(a => phraseIds.has(a.phraseId)), state._meta.deletedAttemptIds, LIMITS.attempts, 'recording');
          state.vocabulary = merge(state.vocabulary, candidate.vocabulary, [], LIMITS.vocabulary, 'vocabulary');
          for (const [key, value] of Object.entries(candidate.reviews)) {
            if (!own(state.reviews, key) && (!key.startsWith('speaking:') || phraseIds.has(key.slice(9)))) state.reviews[key] = value;
          }
          // Imported deletion history blocks future legacy resurrection without deleting current records.
          const activeIds = { deletedPhraseIds: phraseIds, deletedAttemptIds: new Set(state.attempts.map(a => a.id)), deletedVoiceIds: new Set(state.voices.map(v => v.id)) };
          for (const key of META_KEYS) state._meta[key] = [...new Set([...state._meta[key], ...candidate._meta[key].filter(value => !activeIds[key] || !activeIds[key].has(value))])];
          if (!existed || JSON.stringify(state.settings) === JSON.stringify(defaults().settings)) state.settings = candidate.settings;
          state._meta.seeded = true;
          return { phrases: state.phrases.length, voices: state.voices.length, attempts: state.attempts.length };
        }, false, (state, existed) => {
          if (!existed) {
            // Apply backup tombstones before the very first legacy import can resurrect a source.
            for (const key of META_KEYS) state._meta[key] = [...candidate._meta[key]];
            state._meta.seeded = true;
            state.settings = candidate.settings;
          }
        });
      },
      subscribe(callback) {
        if (typeof callback !== 'function') fail('A change listener must be a function.');
        if (!listeners.size && storage.subscribe) unsubscribeStorage = storage.subscribe(notify);
        listeners.add(callback);
        return () => { listeners.delete(callback); if (!listeners.size && unsubscribeStorage) { unsubscribeStorage(); unsubscribeStorage = undefined; } };
      }
    };
    return api;
  }
  function dueItems(state, kind, now = Date.now()) {
    if (!['meaning', 'speaking'].includes(kind)) fail('Review kind must be meaning or speaking.');
    const items = kind === 'meaning' ? (state.vocabulary || []).filter(item => typeof item.meaning === 'string' && item.meaning.trim()) : state.phrases || [];
    return items.filter(item => !state.reviews || !state.reviews[`${kind}:${item.id}`] || state.reviews[`${kind}:${item.id}`].dueAt <= now)
      .sort((a, b) => ((state.reviews || {})[`${kind}:${a.id}`]?.dueAt || 0) - ((state.reviews || {})[`${kind}:${b.id}`]?.dueAt || 0));
  }
  function stats(state, now = Date.now()) {
    const attempts = state.attempts || [];
    const days = new Set();
    let seconds = 0;
    for (const item of attempts) {
      if (Number.isFinite(item.duration) && item.duration > 0) seconds += item.duration;
      if (Number.isFinite(item.createdAt)) {
        const date = new Date(item.createdAt);
        days.add(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`);
      }
    }
    return { attempts: attempts.length, practiceMinutes: Math.round(seconds / 60 * 10) / 10, practicedDays: days.size,
      dueSpeaking: dueItems(state, 'speaking', now).length, dueMeaning: dueItems(state, 'meaning', now).length };
  }
  return Object.assign(createStore(), { createStore });
});
