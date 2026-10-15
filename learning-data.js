/* Language-neutral learning resources backed by the extension's existing stores. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LearningData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const STORAGE_KEY = 'polybotLearning';
  const TARGET_KEY = 'sptubeTargetLang';
  const NATIVE_KEY = 'sptubeNativeLang';
  const MAX_RESPONSES = 500;
  const MAX_COMPLETIONS = 2000;
  const MAX_VOCABULARY_SNAPSHOTS = 1000;
  const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
  const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
  const PROVIDED_MEDIA = Object.freeze({
    es: Object.freeze([
      Object.freeze({
        id: 'media:es:provided:reading:interactive:daily-routine', kind: 'reading', experience: 'interactive',
        text: 'Cada mañana, Elena prepara café, abre la ventana y escribe tres cosas que quiere hacer durante el día.',
        translation: 'Every morning, Elena makes coffee, opens the window, and writes three things she wants to do during the day.'
      }),
      Object.freeze({
        id: 'media:es:provided:reading:carefree:the-plaza', kind: 'reading', experience: 'carefree',
        text: 'Al atardecer, la plaza se llena de conversaciones. Unos niños juegan cerca de la fuente y las familias pasean bajo los árboles.',
        translation: 'At sunset, the plaza fills with conversations. Some children play near the fountain and families walk beneath the trees.'
      }),
      Object.freeze({
        id: 'media:es:provided:listening:interactive:weekend-plan', kind: 'listening', experience: 'interactive',
        text: 'Este sábado voy a visitar el mercado temprano. Después, prepararé el almuerzo con mis amigos.',
        translation: 'This Saturday I am going to visit the market early. Afterwards, I will make lunch with my friends.'
      }),
      Object.freeze({
        id: 'media:es:provided:listening:carefree:rainy-afternoon', kind: 'listening', experience: 'carefree',
        text: 'La lluvia cae suavemente sobre los tejados mientras una radio suena en la cocina.',
        translation: 'Rain falls softly on the rooftops while a radio plays in the kitchen.'
      })
    ])
  });
  const TOPICS = Object.freeze([
    ['A1', 'word-order', 'Basic word order', 'Notice how simple statements and questions arrange their parts.'],
    ['A1', 'nouns-articles', 'Nouns and articles', 'Explore how nouns are marked for definiteness, number, and grammatical class where relevant.'],
    ['A1', 'pronouns', 'Personal pronouns', 'Recognize the forms speakers use for I, you, we, and other people.'],
    ['A1', 'present-time', 'Present-time forms', 'Build simple sentences about routines, facts, and actions happening now.'],
    ['A1', 'questions-negation', 'Questions and negation', 'Form basic information questions, yes-or-no questions, and negative statements.'],
    ['A2', 'description-agreement', 'Description and agreement', 'Connect descriptive words to nouns and notice agreement patterns where the language uses them.'],
    ['A2', 'past-events', 'Talking about past events', 'Tell what happened and place completed events in sequence.'],
    ['A2', 'future-plans', 'Plans and future time', 'Express intentions, predictions, and scheduled events.'],
    ['A2', 'comparison', 'Comparison and quantity', 'Compare people and things and express amounts with common quantifiers.'],
    ['A2', 'objects-possession', 'Objects and possession', 'Track who receives an action and show ownership or association.'],
    ['B1', 'aspect-habits', 'Time, aspect, and habits', 'Contrast ongoing, repeated, and completed situations across time.'],
    ['B1', 'modality', 'Ability, obligation, and advice', 'Use modal expressions to describe possibility, permission, need, and recommendations.'],
    ['B1', 'conditionals', 'Real and hypothetical conditions', 'Connect a condition with its likely, possible, or imagined result.'],
    ['B1', 'relative-clauses', 'Adding detail with clauses', 'Join ideas by identifying or describing a person, place, or thing.'],
    ['B1', 'reported-speech', 'Reporting what people say', 'Retell statements and questions while keeping time and viewpoint clear.'],
    ['B2', 'complex-sentences', 'Complex sentence connections', 'Link causes, contrasts, purposes, and consequences with precise connectors.'],
    ['B2', 'voice-focus', 'Changing sentence focus', 'Shift attention between the person acting, the action, and its result.'],
    ['B2', 'stance-register', 'Stance and register', 'Choose forms that express certainty, politeness, distance, and formality.'],
    ['B2', 'advanced-conditions', 'Counterfactual meaning', 'Discuss unreal pasts, alternative outcomes, and mixed-time conditions.'],
    ['B2', 'cohesion', 'Cohesion across a text', 'Use reference words, substitution, and transitions to make longer speech and writing flow.'],
    ['C1', 'information-structure', 'Emphasis and information structure', 'Reorder or frame information to highlight contrast and guide attention.'],
    ['C1', 'nuance-modality', 'Nuanced modality', 'Fine-tune probability, obligation, inference, and interpersonal distance.'],
    ['C1', 'discourse-style', 'Discourse and style', 'Control rhythm, density, and register across academic, professional, and conversational contexts.'],
    ['C1', 'idiomatic-patterns', 'Idiomatic grammar patterns', 'Notice recurring constructions whose meaning extends beyond their individual words.'],
    ['C1', 'editing-precision', 'Editing for precision', 'Diagnose ambiguity, awkward reference, and unintended shifts in time, viewpoint, or register.']
  ].map(Object.freeze));

  function fail(message) { throw new Error(message); }
  function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
  function plainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }
  function safeTree(value, depth = 0, seen = new Set()) {
    if (depth > 20) fail('Data is nested too deeply.');
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) fail('Data must not contain circular references.');
    if (!Array.isArray(value) && !plainObject(value)) fail('Data must contain plain objects.');
    seen.add(value);
    for (const key of Object.keys(value)) {
      if (BAD_KEYS.has(key)) fail('Data contains an unsafe property name.');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.get || descriptor.set) fail('Data must not contain accessors.');
      safeTree(value[key], depth + 1, seen);
    }
    seen.delete(value);
  }
  function text(value, label, max, required = true) {
    if (typeof value !== 'string') fail(`${label} must be text.`);
    const result = value.trim();
    if ((required && !result) || result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) {
      fail(`${label} must contain ${required ? '1' : '0'}–${max} characters.`);
    }
    return result;
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function defaultState() { return { version: 1, mediaResponses: [], completedActivities: {}, targetLanguages: [], vocabularyMasterySnapshots: [] }; }
  function normalizeState(value) {
    if (!plainObject(value)) return defaultState();
    const result = defaultState();
    if (Array.isArray(value.mediaResponses)) {
      for (const item of value.mediaResponses.slice(-MAX_RESPONSES)) {
        if (!plainObject(item)) continue;
        try {
          const mode = item.mode;
          if (!['writing', 'speaking'].includes(mode)) continue;
          result.mediaResponses.push({
            itemId: text(item.itemId, 'Media item ID', 300), mode,
            text: text(item.text, 'Response', 4000),
            updatedAt: validTime(item.updatedAt) ? item.updatedAt : 0
          });
        } catch (_) { /* Ignore a damaged record without blocking other learning data. */ }
      }
    }
    if (plainObject(value.completedActivities)) {
      for (const key of Object.keys(value.completedActivities).slice(0, MAX_COMPLETIONS)) {
        if (BAD_KEYS.has(key)) continue;
        const when = value.completedActivities[key];
        if (validId(key) && validTime(when)) result.completedActivities[key] = when;
      }
    }
    if (Array.isArray(value.targetLanguages)) {
      result.targetLanguages = [...new Set(value.targetLanguages.filter(validId))].slice(0, 30);
    }
    if (Array.isArray(value.vocabularyMasterySnapshots)) {
      for (const item of value.vocabularyMasterySnapshots.slice(-MAX_VOCABULARY_SNAPSHOTS)) {
        if (!plainObject(item) || !validId(item.targetCode) || !validTime(item.recordedAt)) continue;
        const known = Number(item.known), total = Number(item.total);
        if (!Number.isInteger(known) || !Number.isInteger(total) || known < 0 || total < 0 || known > total) continue;
        result.vocabularyMasterySnapshots.push({ targetCode: item.targetCode, known, total, recordedAt: item.recordedAt });
      }
    }
    return result;
  }
  function validTime(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8640000000000000; }
  function validId(value) { return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 300 && !BAD_KEYS.has(value) && !/[\u0000-\u001f\u007f]/.test(value); }
  function activityId(value) { if (!validId(value)) fail('Activity ID is invalid.'); return value; }

  function fallbackLanguages() {
    return [
      { code: 'en', name: 'English', speechLang: 'en-US' },
      { code: 'es', name: 'Spanish', speechLang: 'es-ES' }
    ];
  }
  function languageApi(options) {
    const api = options.langApi || root.SPTubeLang;
    const languages = api && Array.isArray(api.LANGUAGES) ? api.LANGUAGES : fallbackLanguages();
    return {
      languages,
      targetDefault: api && api.DEFAULT_LANG || 'es',
      nativeDefault: api && api.DEFAULT_NATIVE_LANG || 'en',
      keys(code) { return api && typeof api.storageKeys === 'function' ? api.storageKeys(code) : {
        vocab: `sptubeVocabulary_${code}`, defs: `sptubeDefinitions_${code}`, phrases: `sptubePhrases_${code}`
      }; }
    };
  }
  function describeLanguage(candidate, fallback, languages) {
    const found = languages.find(item => item && item.code === candidate) || languages.find(item => item && item.code === fallback);
    if (!found) fail('No supported languages are configured.');
    return { code: found.code, name: found.name, speechLang: found.speechLang || found.code, rtl: found.rtl === true };
  }
  function browserStorage() {
    if (root.chrome && root.chrome.storage && root.chrome.storage.local) {
      const chrome = root.chrome;
      return {
        get(keys) { return new Promise((resolve, reject) => chrome.storage.local.get(keys, result => {
          const error = chrome.runtime && chrome.runtime.lastError;
          if (error) reject(new Error(error.message || 'Could not read learning data.')); else resolve(result || {});
        })); },
        set(values) { return new Promise((resolve, reject) => chrome.storage.local.set(values, () => {
          const error = chrome.runtime && chrome.runtime.lastError;
          if (error) reject(new Error(error.message || 'Could not save learning data.')); else resolve();
        })); }
      };
    }
    return {
      get(keys) {
        if (!root.localStorage) return Promise.reject(new Error('Learning storage is unavailable. Open the extension or localhost preview.'));
        const result = {};
        for (const key of keys) {
          const raw = root.localStorage.getItem(key);
          if (raw != null) { try { result[key] = JSON.parse(raw); } catch (_) { /* Treat one damaged preview key as empty. */ } }
        }
        return Promise.resolve(result);
      },
      set(values) {
        if (!root.localStorage) return Promise.reject(new Error('Learning storage is unavailable. Open the extension or localhost preview.'));
        try { for (const [key, value] of Object.entries(values)) root.localStorage.setItem(key, JSON.stringify(value)); }
        catch (_) { return Promise.reject(new Error('Could not save learning data. Browser storage may be full.')); }
        return Promise.resolve();
      }
    };
  }

  function definitionRecords(value) {
    const values = Array.isArray(value) ? value : value ? [value] : [];
    const result = [];
    for (const item of values) {
      if (!plainObject(item)) continue;
      const meaning = typeof item.matched === 'string' && item.matched.trim()
        ? item.matched.trim() : typeof item.translation === 'string' ? item.translation.trim() : '';
      if (!meaning || meaning.length > 10000) continue;
      result.push({
        meaning,
        sentence: typeof item.sentence === 'string' ? item.sentence.slice(0, 20000) : '',
        savedAt: validTime(item.savedAt) ? item.savedAt : 0,
        custom: item.custom === true
      });
    }
    return result;
  }
  function deriveVocabulary(all, keys, code) {
    const vocabulary = plainObject(all[keys.vocab]) ? all[keys.vocab] : {};
    const definitions = plainObject(all[keys.defs]) ? all[keys.defs] : {};
    const rows = [];
    for (const rawWord of Object.keys(vocabulary)) {
      if (BAD_KEYS.has(rawWord) || typeof vocabulary[rawWord] !== 'string') continue;
      const word = rawWord.trim();
      if (!word || word.length > 300) continue;
      const status = vocabulary[rawWord] === 'known' ? 'known' : 'learning';
      const lower = word.toLocaleLowerCase();
      const records = definitionRecords(own(definitions, lower) ? definitions[lower] : definitions[rawWord]);
      rows.push({ id: `${code}:${lower}`, word, status, meaning: records[0] ? records[0].meaning : '', definitions: records, definitionCount: records.length });
    }
    return rows.sort((a, b) => a.word.localeCompare(b.word));
  }
  function practiceFor(title) {
    return {
      format: 'notice-transform-create',
      instruction: `Use examples from your own ${title.toLowerCase()} resources; this activity does not invent language-specific rules.`,
      steps: [
        `Find three authentic examples of ${title.toLowerCase()} in saved media or another trusted source.`,
        'Underline the part that changes the meaning and write what you notice.',
        'Transform each example by changing its person, time, number, or polarity where appropriate.',
        'Create two new examples about your life, then check them with a teacher or trusted reference.'
      ]
    };
  }
  function deriveGrammar(state, targetCode) {
    return TOPICS.map(([level, slug, title, description]) => {
      const id = `grammar:${targetCode}:${level}:${slug}`, legacyId = `grammar:${level}:${slug}`;
      const completedAt = state.completedActivities[id] || (targetCode === 'es' ? state.completedActivities[legacyId] : undefined);
      return { id, level, title, description, practice: practiceFor(title), completed: validTime(completedAt), ...(validTime(completedAt) ? { completedAt } : {}) };
    });
  }
  function derivePath(grammar, state, targetCode) {
    const labels = {
      A1: ['Foundations', 'Build the patterns needed for simple introductions and everyday needs.'],
      A2: ['Everyday communication', 'Extend familiar conversations across past, present, and future situations.'],
      B1: ['Connected expression', 'Link ideas and tell fuller stories with greater independence.'],
      B2: ['Confident communication', 'Handle complex relationships between ideas and adapt your register.'],
      C1: ['Precision and nuance', 'Shape emphasis, style, and subtle meaning for demanding contexts.']
    };
    return LEVELS.map(level => {
      const id = `path:${targetCode}:${level}`, legacyId = `path:${level}`;
      const topics = grammar.filter(item => item.level === level);
      const completedAt = state.completedActivities[id] || (targetCode === 'es' ? state.completedActivities[legacyId] : undefined);
      return {
        id, level, title: labels[level][0], description: labels[level][1], topicIds: topics.map(item => item.id),
        completed: validTime(completedAt), ...(validTime(completedAt) ? { completedAt } : {}),
        progress: { completed: topics.filter(item => item.completed).length, total: topics.length },
        aiLessonStatus: 'planned'
      };
    });
  }
  function audioUrl(value) {
    return typeof value === 'string' && value.length <= 30 * 1024 * 1024 && /^data:audio\/[a-zA-Z0-9.+-]+(?:;[^,]*)?;base64,[A-Za-z0-9+/]+=*$/.test(value) ? value : '';
  }
  function deriveMedia(all, keys, targetCode, state) {
    const phrases = Array.isArray(all[keys.phrases]) ? all[keys.phrases] : [];
    const responsesByItem = new Map();
    for (const response of state.mediaResponses) {
      if (!responsesByItem.has(response.itemId)) responsesByItem.set(response.itemId, {});
      responsesByItem.get(response.itemId)[response.mode] = clone(response);
    }
    const result = (PROVIDED_MEDIA[targetCode] || []).map(item => {
      const completedAt = state.completedActivities[item.id];
      return {
        ...item, origin: 'provided', source: 'provided', savedAt: 0,
        interactionModes: item.experience === 'interactive'
          ? (item.kind === 'listening' ? ['listen', 'write', 'speak'] : ['read', 'write', 'speak'])
          : [item.kind === 'listening' ? 'listen' : 'read'],
        responses: responsesByItem.get(item.id) || {}, completed: validTime(completedAt),
        ...(validTime(completedAt) ? { completedAt } : {})
      };
    });
    const usedIds = new Set();
    for (let index = 0; index < phrases.length; index++) {
      const phrase = phrases[index];
      if (!plainObject(phrase)) continue;
      const phraseText = typeof phrase.savedTranslation === 'string' ? phrase.savedTranslation.trim() : '';
      if (!phraseText || phraseText.length > 20000) continue;
      const legacyId = validId(phrase.id) ? phrase.id : `saved-${validTime(phrase.savedAt) ? phrase.savedAt : index}`;
      let id = `media:${targetCode}:${legacyId}`;
      if (usedIds.has(id)) id += `-${index}`;
      usedIds.add(id);
      const clip = audioUrl(phrase.videoClip) || audioUrl(phrase.voiceboxAudio) || audioUrl(phrase.recording);
      const completedAt = state.completedActivities[id];
      const item = {
        id, text: phraseText,
        translation: typeof phrase.english === 'string' ? phrase.english.slice(0, 20000).trim() : '',
        origin: 'saved', experience: 'interactive',
        source: ['video', 'web', 'user', 'computer'].includes(phrase.source) ? phrase.source : 'saved',
        savedAt: validTime(phrase.savedAt) ? phrase.savedAt : 0,
        kind: clip ? 'listening' : 'reading',
        interactionModes: clip ? ['read', 'listen', 'write', 'speak'] : ['read', 'write', 'speak'],
        responses: responsesByItem.get(id) || {}, completed: validTime(completedAt),
        ...(validTime(completedAt) ? { completedAt } : {})
      };
      if (clip) item.audioUrl = clip;
      if (typeof phrase.sourceUrl === 'string') {
        try { const url = new URL(phrase.sourceUrl); if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) item.sourceUrl = url.href; } catch (_) { /* Ignore unsafe source URLs. */ }
      }
      result.push(item);
    }
    return result.sort((a, b) => b.savedAt - a.savedAt);
  }

  function createStore(options = {}) {
    const backend = options.storage || browserStorage();
    // Read pre-Polybot data when no value exists under the current key.
    const legacyKey = STORAGE_KEY.replace('polybot', 'giftOfTongues');
    const storage = Object.assign({}, backend, {
      async get(keys) {
        const values = await backend.get(keys.includes(STORAGE_KEY) ? [...keys, legacyKey] : keys);
        if (!Object.prototype.hasOwnProperty.call(values, STORAGE_KEY) &&
            Object.prototype.hasOwnProperty.call(values, legacyKey)) values[STORAGE_KEY] = values[legacyKey];
        return values;
      }
    });
    const lang = languageApi(options);
    const now = options.now || Date.now;
    const runtime = own(options, 'runtime') ? options.runtime : root.chrome && root.chrome.runtime;
    const locks = own(options, 'locks') ? options.locks : root.navigator && root.navigator.locks;
    let queue = Promise.resolve();
    function serialized(operation) {
      const pending = queue.then(() => locks && typeof locks.request === 'function' ? locks.request(`${STORAGE_KEY}:write`, operation) : operation());
      queue = pending.catch(() => {});
      return pending;
    }
    function chooseLanguages(all) {
      return {
        target: describeLanguage(all[TARGET_KEY], lang.targetDefault, lang.languages),
        native: describeLanguage(all[NATIVE_KEY], lang.nativeDefault, lang.languages)
      };
    }
    async function readAll() {
      const languageValues = await storage.get([TARGET_KEY, NATIVE_KEY]);
      const selected = chooseLanguages(languageValues);
      const keys = lang.keys(selected.target.code);
      const all = await storage.get([TARGET_KEY, NATIVE_KEY, STORAGE_KEY, keys.vocab, keys.defs, keys.phrases]);
      // Keep this read internally consistent if another extension page changes
      // languages between the two storage reads. The following load sees the new
      // choice; this one continues using the profile that selected these keys.
      return { all, selected, keys };
    }
    function assemble(all, selected, keys) {
      const state = normalizeState(all[STORAGE_KEY]);
      const grammarTopics = deriveGrammar(state, selected.target.code);
      const targetCodes = [...new Set([selected.target.code, ...state.targetLanguages])];
      const targetLanguages = targetCodes.map(code => lang.languages.find(item => item && item.code === code)).filter(Boolean)
        .map(item => ({ code: item.code, name: item.name, speechLang: item.speechLang || item.code, rtl: item.rtl === true, flag: item.flag || '' }));
      return {
        target: selected.target, native: selected.native, targetLanguages,
        vocabulary: deriveVocabulary(all, keys, selected.target.code), grammarTopics,
        vocabularyMastery: state.vocabularyMasterySnapshots.filter(item => item.targetCode === selected.target.code),
        path: derivePath(grammarTopics, state, selected.target.code), media: deriveMedia(all, keys, selected.target.code, state)
      };
    }
    async function load() {
      const { all, selected, keys } = await readAll();
      return clone(assemble(all, selected, keys));
    }
    function findLanguage(code) { return lang.languages.find(item => item && item.code === code); }
    function sendTranslation(message) {
      if (!runtime || typeof runtime.sendMessage !== 'function') return Promise.resolve(null);
      return new Promise(resolve => {
        let settled = false;
        const finish = value => { if (!settled) { settled = true; resolve(value); } };
        try {
          const returned = runtime.sendMessage(message, result => {
            try { if (runtime.lastError) { finish(null); return; } } catch (_) { /* Some test/runtime shims throw on lastError. */ }
            finish(result || null);
          });
          if (returned && typeof returned.then === 'function') returned.then(finish, () => finish(null));
        } catch (_) { finish(null); }
      });
    }
    const api = {
      STORAGE_KEY, load,
      recordVocabularySnapshot(targetCode) {
        return serialized(async () => {
          let all, selected, keys;
          if (targetCode == null) {
            ({ all, selected, keys } = await readAll());
          } else {
            const target = findLanguage(targetCode);
            if (!target) fail('Choose a supported target language.');
            selected = { target: describeLanguage(targetCode, lang.targetDefault, lang.languages) };
            keys = lang.keys(targetCode);
            all = await storage.get([STORAGE_KEY, keys.vocab, keys.defs]);
          }
          const state = normalizeState(all[STORAGE_KEY]);
          const vocabulary = deriveVocabulary(all, keys, selected.target.code);
          const snapshot = {
            targetCode: selected.target.code,
            known: vocabulary.filter(item => item.status === 'known').length,
            total: vocabulary.length,
            recordedAt: now()
          };
          const previous = [...state.vocabularyMasterySnapshots].reverse().find(item => item.targetCode === selected.target.code);
          if (!previous || previous.known !== snapshot.known || previous.total !== snapshot.total) {
            state.vocabularyMasterySnapshots.push(snapshot);
            if (state.vocabularyMasterySnapshots.length > MAX_VOCABULARY_SNAPSHOTS) {
              state.vocabularyMasterySnapshots.splice(0, state.vocabularyMasterySnapshots.length - MAX_VOCABULARY_SNAPSHOTS);
            }
            await storage.set({ [STORAGE_KEY]: state });
          }
          return clone(previous && previous.known === snapshot.known && previous.total === snapshot.total ? previous : snapshot);
        });
      },
      setLanguages(targetCode, nativeCode, targetCodes) {
        if (!findLanguage(targetCode) || !findLanguage(nativeCode)) return Promise.reject(new Error('Choose supported target and native languages.'));
        if (targetCodes != null && (!Array.isArray(targetCodes) || targetCodes.some(code => !findLanguage(code)))) return Promise.reject(new Error('Choose supported target languages.'));
        return serialized(async () => {
          const values = { [TARGET_KEY]: targetCode, [NATIVE_KEY]: nativeCode };
          if (targetCodes != null) {
            const current = await storage.get([STORAGE_KEY]);
            const state = normalizeState(current[STORAGE_KEY]);
            state.targetLanguages = [...new Set([targetCode, ...targetCodes])];
            values[STORAGE_KEY] = state;
          }
          await storage.set(values);
          return load();
        });
      },
      async lookup(value) {
        const term = text(value, 'Lookup term', 300);
        const { all, selected, keys } = await readAll();
        const definitions = plainObject(all[keys.defs]) ? all[keys.defs] : {};
        const normalized = term.toLocaleLowerCase();
        const records = definitionRecords(own(definitions, normalized) ? definitions[normalized] : definitions[term]);
        const base = { term, targetCode: selected.target.code, nativeCode: selected.native.code };
        if (records[0]) return { status: 'found', source: 'saved', ...base, sourceLang:selected.target.code, targetLang:selected.native.code, translation: records[0].meaning };
        if (!runtime || typeof runtime.sendMessage !== 'function') return { status: 'unavailable', source: 'preview', ...base, translation: '', message: 'Live dictionary lookup is available in the installed extension.' };
        const translated = await sendTranslation({
          type: 'TRANSLATE_DICTIONARY_AUTO', text: term,
          targetLang: selected.target.code, nativeLang: selected.native.code
        });
        const translation = translated && typeof translated.matched === 'string' && translated.matched.trim()
          ? translated.matched.trim() : translated && typeof translated.translation === 'string' ? translated.translation.trim()
            : typeof translated === 'string' ? translated.trim() : '';
        if (translation) {
          const sourceLang = [selected.target.code,selected.native.code].includes(translated?.sourceLang) ? translated.sourceLang : selected.target.code;
          const targetLang = [selected.target.code,selected.native.code].includes(translated?.targetLang) && translated.targetLang !== sourceLang
            ? translated.targetLang : sourceLang === selected.native.code ? selected.target.code : selected.native.code;
          return { status: 'found', source: 'translation', ...base, sourceLang, targetLang, translation };
        }
        return { status: 'unavailable', source: 'translation', ...base, translation: '', message: 'A translation could not be retrieved. Try again when the extension is online.' };
      },
      saveMediaResponse(input) {
        try { safeTree(input); } catch (error) { return Promise.reject(error); }
        if (!plainObject(input)) return Promise.reject(new Error('Media response must be an object.'));
        let itemId;
        let responseText;
        try { itemId = activityId(input.itemId); responseText = text(input.text, 'Response', 4000); } catch (error) { return Promise.reject(error); }
        if (!['writing', 'speaking'].includes(input.mode)) return Promise.reject(new Error('Response mode must be writing or speaking.'));
        return serialized(async () => {
          const { all, selected, keys } = await readAll();
          const state = normalizeState(all[STORAGE_KEY]);
          const validMedia = deriveMedia(all, keys, selected.target.code, state).some(item => item.id === itemId);
          if (!validMedia) fail('That media item is unavailable for the selected language.');
          const record = { itemId, mode: input.mode, text: responseText, updatedAt: now() };
          const existing = state.mediaResponses.findIndex(item => item.itemId === itemId && item.mode === input.mode);
          if (existing >= 0) state.mediaResponses.splice(existing, 1);
          state.mediaResponses.push(record);
          if (state.mediaResponses.length > MAX_RESPONSES) state.mediaResponses.splice(0, state.mediaResponses.length - MAX_RESPONSES);
          await storage.set({ [STORAGE_KEY]: state });
          return clone(record);
        });
      },
      completeActivity(value) {
        let id;
        try { id = activityId(value); } catch (error) { return Promise.reject(error); }
        return serialized(async () => {
          const { all, selected, keys } = await readAll();
          const state = normalizeState(all[STORAGE_KEY]);
          const grammar = deriveGrammar(state, selected.target.code);
          const allowed = new Set([...grammar.map(item => item.id), ...derivePath(grammar, state, selected.target.code).map(item => item.id), ...deriveMedia(all, keys, selected.target.code, state).map(item => item.id)]);
          if (!allowed.has(id)) fail('That learning activity is unavailable.');
          if (!own(state.completedActivities, id) && Object.keys(state.completedActivities).length >= MAX_COMPLETIONS) fail('The completed activity limit has been reached.');
          const completedAt = now();
          state.completedActivities[id] = completedAt;
          await storage.set({ [STORAGE_KEY]: state });
          return { id, completedAt };
        });
      }
    };
    return api;
  }

  return Object.assign(createStore(), { createStore, STORAGE_KEY, LEVELS: Object.freeze([...LEVELS]) });
});
