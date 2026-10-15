# Balanced language app contracts

This iteration restructures the existing extension into a language-neutral learning shell while preserving the mature Spanish pronunciation studio. It must never imply that unfinished AI lesson generation or language-specific grammar content already exists.

## Navigation and routes

The canonical routes are:

- `#home` — default landing page and logo destination, with the guided course followed by actual cross-skill progress graphics.
- `#personalization` — learning method, interests, and regional preference cards.
- `#learning-method` — an eight-question preference quiz and editable input/output, grammar, and practice-format preferences.
- `#interests` — 88 interests in 11 categories, with at most 10 saved selections.
- `#regions` — Spanish regional map, country information, and original regional speech samples.
- `#my-path` — visually dominant primary destination directly below the logo.
- `#vocabulary` — bilingual target/native dictionary lookup, All My Words, status-based vocab lists, and separate review practice choices.
- `#grammar` — every principle shown directly under Beginner, Intermediate, or Advanced.
- `#pronunciation` — shadowing and phrase-library tools; regional configuration lives in Regions & Accents and Voicebox management lives in pronunciation settings.
- `#media` — provided Read and Listen libraries plus browser-saved Your Media.

The sidebar label is **Explore Resources** and resource links appear in the order above, excluding My Path and Personalization. Existing `practice`, `library`, and legacy `progress` links map to their current home or pronunciation destinations.

## Language profile API

`learning-data.js` exposes `window.LearningData` and CommonJS exports for tests:

- `load()` returns `{target,native,targetLanguages,vocabulary,vocabularyMastery,grammarTopics,path,media}`, where languages are `{code,name,speechLang,rtl}`. `targetLanguages` is the saved set shown in the sidebar quick switcher. Vocabulary records are `{id,word,status,meaning,definitions:[{meaning,sentence,savedAt,custom}],definitionCount}`. `vocabularyMastery` contains bounded, language-scoped `{targetCode,known,total,recordedAt}` snapshots. Grammar records are `{id,level,title,description,practice:{format:'notice-transform-create',instruction,steps:[]},completed,completedAt}`. Path stages are `{id,level,title,description,topicIds,completed,completedAt,progress:{completed,total},aiLessonStatus:'planned'}`. Media records include `origin:'provided'|'saved'`, `experience:'interactive'|'carefree'`, and `kind:'listening'|'reading'` alongside content, response, and completion fields.
- `setLanguages(targetCode,nativeCode,targetCodes?)` validates against `SPTubeLang.LANGUAGES`, persists the active target, native language, and optional quick-switcher target set, then returns `load()`.
- `recordVocabularySnapshot(targetCode?)` records a mastery point only when that language's known or total count changes. The studio calls it on startup, language switches, and vocabulary-store changes.
- `lookup(term)` checks saved target-language definitions, then requests automatic detection between the configured target and native languages. Translation results include `sourceLang` and `targetLang`; standalone preview keeps an explicit unavailable state.
- `saveMediaResponse({itemId,mode,text})` persists a bounded writing or speaking-reflection response under `polybotLearning`.
- `completeActivity(id)` records actual user completion only. No progress is seeded.

Vocabulary is read from `sptubeVocabulary_<target>` and `sptubeDefinitions_<target>`, using `matched` before `translation`. Grammar topics keep CEFR metadata internally but render under Beginner (A1/A2), Intermediate (B1/B2), and Advanced (C1). Spanish includes stable provided reading and listening items for interactive and care-free use. Browser extension captures appear only in Your Media. No completion is fabricated.

## UI ownership contract

`studio.html` and `studio.js` own routes, accessibility, events, state coordination, and reuse of the existing pronunciation functions. `studio.css` owns presentation only. New shared class names are:

- Shell: `.my-path-link`, `.resource-nav-label`, `.language-context`.
- My Path: `.path-hero`, `.path-layout`, `.path-step`, `.skill-balance`.
- Vocabulary: `.dictionary-card`, `.dictionary-form`, `.dictionary-result`, `.vocab-resource-grid`, `.vocab-lists-view`, `.vocab-list-collections`, `.vocab-list`.
- Grammar: `.level-section`, `.level-heading`, `.topic-grid`, `.topic-card`, `.practice-panel`.
- Pronunciation: `.pronunciation-overview`; regional configuration is owned by the Regions & Accents page.
- Media: `.media-feature-row`, `.media-library-groups`, `.media-grid`, `.media-card`, `.media-kind`, `.interaction-panel`.
- Home progress: `.progress-overview`, `.mastery-grid`, `.mastery-card`, `.mastery-chart`.

All views must work in light and dark themes and at 390px width without horizontal page overflow. User-controlled text must use text escaping. Buttons that are intentionally future work must say so and remain non-deceptive.

## Personalization modules

`personalization-method.js`, `personalization-interests.js`, and `personalization-regions.js` expose `render(context)` and `mount(root, context)`. Context supplies the current `target` language and `notify(message, error)`. Mount can return a cleanup function; otherwise the shell calls an optional `unmount()` before replacing the view or leaving the page. Each module owns scoped styles and local events. Preferences use separate browser-local keys (`polybotMethod`, `polybotInterests`, `polybotRegion`) and are not part of existing studio backup exports. They do not yet modify generated lessons. Quiz results describe flexible preferences, not a validated learning-style diagnosis.

The home progress bar counts completed curriculum topics for the active language, matching My Path. The map uses local Natural Earth outlines; remote speech samples require internet access and retain their source attribution. Spanish regions remain explicitly Spanish when another target language is active.

## Compatibility boundaries

The advanced recording/Voicebox/assessment store remains the current Spanish studio in this iteration. When a different target language is selected, the UI explains that advanced pronunciation tooling is currently optimized for Spanish; it still exposes language-neutral browser listening and saved-media resources without labeling Spanish references as another language. Existing capture, migration, backups, recordings, and review schedules remain intact.
