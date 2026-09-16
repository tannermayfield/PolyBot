# Balanced language app contracts

This iteration restructures the existing extension into a language-neutral learning shell while preserving the mature Spanish pronunciation studio. It must never imply that unfinished AI lesson generation or language-specific grammar content already exists.

## Navigation and routes

The canonical routes are:

- `#my-path` — visually dominant primary destination directly below the logo.
- `#vocabulary` — dictionary lookup, saved vocabulary, and review practice.
- `#grammar` — beginner-to-advanced topic map with a useful self-guided practice action for every topic.
- `#pronunciation` — existing recording, shadowing, phrase library, voices, and progress features grouped under internal tabs.
- `#media` — saved web/video phrases and reading, listening, writing, or speaking prompts.

The sidebar label is **Explore Resources** and resource links appear in the order above, excluding My Path. Existing links remain compatible: `today` maps to `my-path`; `review` maps to `vocabulary`; `practice`, `library`, `voices`, and `progress` map to the corresponding internal pronunciation view.

## Language profile API

`learning-data.js` exposes `window.LearningData` and CommonJS exports for tests:

- `load()` returns `{target,native,vocabulary,grammarTopics,path,media}`, where languages are `{code,name,speechLang,rtl}`.
- `setLanguages(targetCode,nativeCode)` validates against `SPTubeLang.LANGUAGES`, persists the existing `sptubeTargetLang` and `sptubeNativeLang` keys, then returns `load()`.
- `lookup(term)` returns a saved definition when available; otherwise it calls the existing extension translation message when available and returns an explicit unavailable state in standalone preview.
- `saveMediaResponse({itemId,mode,text})` persists a bounded writing or speaking-reflection response under `giftOfTonguesLearning`.
- `completeActivity(id)` records actual user completion only. No progress is seeded.

Vocabulary is read from `sptubeVocabulary_<target>` and `sptubeDefinitions_<target>`, using `matched` before `translation`. Grammar topics are universal curriculum structure (`A1`, `A2`, `B1`, `B2`, `C1`) with descriptions and self-guided practice formats; language-specific explanations and AI-authored lessons are future work. Media derives from saved phrases for the selected target language and does not fabricate completed listening or reading activity.

## UI ownership contract

`studio.html` and `studio.js` own routes, accessibility, events, state coordination, and reuse of the existing pronunciation functions. `studio.css` owns presentation only. New shared class names are:

- Shell: `.my-path-link`, `.resource-nav-label`, `.language-context`.
- My Path: `.path-hero`, `.path-layout`, `.path-step`, `.skill-balance`.
- Vocabulary: `.dictionary-card`, `.dictionary-form`, `.dictionary-result`, `.vocab-resource-grid`, `.vocab-list`.
- Grammar: `.level-section`, `.level-heading`, `.topic-grid`, `.topic-card`, `.practice-panel`.
- Pronunciation: `.resource-tabs`, `.pronunciation-overview`.
- Media: `.media-grid`, `.media-card`, `.media-kind`, `.interaction-panel`.

All views must work in light and dark themes and at 390px width without horizontal page overflow. User-controlled text must use text escaping. Buttons that are intentionally future work must say so and remain non-deceptive.

## Compatibility boundaries

The advanced recording/Voicebox/assessment store remains the current Spanish studio in this iteration. When a different target language is selected, the UI explains that advanced pronunciation tooling is currently optimized for Spanish; it still exposes language-neutral browser listening and saved-media resources without labeling Spanish references as another language. Existing vocabulary manager, capture, migration, backups, recordings, and review schedules remain intact.
