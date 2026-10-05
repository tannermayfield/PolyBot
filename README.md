# Gift of Tongues — Language Learning

A Manifest V3 Chrome extension that turns words and phrases from the web into a balanced language-learning workspace. The app brings vocabulary, grammar, pronunciation, and saved media together around a structured **My Path** experience for every supported target language.

## Run the extension

1. Open Chrome's extensions page (`chrome://extensions`) and enable Developer mode.
2. Choose **Load unpacked** and select this project folder. For an existing installation, choose **Reload** after updating these files.
3. Open the extension popup, then **Open My Path**. Choose the language you are learning and the language used for explanations in Settings.
4. On a website, turn on word recognition from the popup. Select a word or phrase on the page or in YouTube captions to save it. Spanish phrase captures can open directly in the advanced pronunciation studio with original audio when clip capture is available.

Existing vocabulary, language settings, definitions, and phrase recordings remain available. Vocabulary is kept separate for each language. The app imports Spanish phrases and recordings without deleting the original stores.

## Learning resources

- **My Path** organizes a balanced sequence across vocabulary, grammar, pronunciation, and media. The future AI lesson builder is labeled as planned; this version does not simulate generated lessons.
- **Vocabulary** starts with an English ↔ target-language dictionary, then separates All My Words, My Vocab Lists, and vocabulary practice.
- **Grammar** shows every principle directly under Beginner, Intermediate, or Advanced. Each principle includes a notice, transform, and create self-guided practice routine.
- **Pronunciation** contains Shadowing and Phrase Library. Accent, region, and Voicebox options expand under each language in Settings; advanced tools currently support Spanish.
- **Media** separates provided Read and Listen material from Your Media, which contains browser extension captures. Provided libraries include interactive and care-free activities.
- **Home** keeps the guided course at the top and shows vocabulary, grammar, and assessed pronunciation progress below it.
- **Personalization** contains learning method, interests, and regional preferences.
- Choose Light, Dark, or Use device setting in studio settings. The theme applies to every studio page and is included in studio backups.

Starter phrases contain text only. Browser speech playback, where available, is a general synthetic reference; a region selection alone cannot guarantee a regional voice.

## Voicebox

Create voice profiles in your local Voicebox app. In **Regions & Accents**, choose the Spanish region you want to explore. Then open pronunciation settings to connect to Voicebox (normally `http://127.0.0.1:17493`), assign profiles to accents, and generate reference recordings. Saved references remain available while Voicebox is offline.

## Optional pronunciation assessment

Recording, shadowing, local timing comparison, and self-review work without a cloud service. Timing comparison measures pace/pauses/recording level, not pronunciation or accent accuracy.

For automated pronunciation assessment, configure the local bridge described in [server/README.md](server/README.md), then enable assessment in the studio. The bridge keeps Azure credentials outside the extension. Only an explicit assessment action sends the selected attempt to the configured service. Supported Spanish scoring locales are Mexico (`es-MX`) and Spain (`es-ES`); other accent profiles can still be used for shadowing. No Spanish prosody or accent-matching score is invented.

## Development and verification

Use Node.js 22 or later. The extension and assessment bridge have no required npm dependencies or build step.

```sh
npm test
npm run check
npm run preview
```

Preview opens at `http://127.0.0.1:4173` and uses a separate local browser store. Page recognition, Chrome permissions, and extension data require the unpacked extension. Preview data does not replace extension data.

The optional browser smoke script uses Playwright and an installed Chromium browser; see [docs/verification.md](docs/verification.md). The assessment service has its own configuration instructions in `server/README.md`.

Use the studio's export/import controls for studio recordings, references, schedules, and settings. Vocabulary captured from websites remains in its existing per-language browser stores.
