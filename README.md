# Gift of Tongues — Spanish Shadowing Studio

A Manifest V3 Chrome extension for turning words and phrases from the web into Spanish speaking practice. The full-tab studio includes regional Voicebox profiles, original audio clips, recording and comparison, vocabulary flashcards, speaking reviews, and attempt history.

## Run the extension

1. Open Chrome's extensions page (`chrome://extensions`) and enable Developer mode.
2. Choose **Load unpacked** and select this project folder. For an existing installation, choose **Reload** after updating these files.
3. Open the extension popup, then **Open shadowing studio**. Allow microphone access when you first record.
4. On a website, turn on word recognition from the popup. Select a phrase on the page or in YouTube captions and choose **Practice this phrase**. Where clip capture is available, the original audio accompanies the phrase.

Existing vocabulary, language settings, definitions, phrase recordings, and the vocabulary editor remain available. The studio imports Spanish phrases and recordings without deleting the original stores. Other languages remain supported by the existing reading and vocabulary tools.

## A practice session

- Choose an accent and a phrase. Add an original audio clip or generate a reference with one of your Voicebox profiles.
- Listen, adjust speed, and loop a short segment. Confirm the practice text matches the segment before recording.
- Shadow along with playback, then record an independent attempt with the reference muted.
- Compare recordings, retry, and rate the phrase for a later speaking review. Test mode keeps the reference hidden until the initial attempt.
- Meaning flashcards and speaking reviews have separate schedules. Progress comes from saved attempts, with no example scores or invented activity.
- Choose Light, Dark, or Use device setting in studio settings. The theme applies to every studio page and is included in studio backups.

Starter phrases contain text only. Browser speech playback, where available, is a general synthetic reference; a region selection alone cannot guarantee a regional voice.

## Voicebox

Create voice profiles in your local Voicebox app. In **Voices**, connect to its server (normally `http://127.0.0.1:17493`), assign profiles to accents, and generate reference recordings. You can also upload short audio recordings. Review generated speech before using it as a regional reference. Saved reference recordings stay available when Voicebox is offline.

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

Use the studio's export/import controls for studio recordings, references, schedules, and settings. The legacy vocabulary editor retains its all-language vocabulary backup controls. Keep both exports when backing up the complete extension.
