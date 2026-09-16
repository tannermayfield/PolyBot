# Verification

## Automated checks

`npm test` runs Node's test runner. It covers data migration, scheduling, recording snapshots, backup validation, audio helpers and lifecycle, assessment request validation, mocked provider responses, capture routing, and preview boundaries. No cloud credentials or real speech recordings are used by tests.

`npm run check` checks JavaScript syntax, MV3 metadata, and local asset references. This project has no framework build, TypeScript compiler, or configured linter.

## Browser smoke tests

The optional `scripts/browser-smoke.cjs` needs Playwright available through Node module resolution. Set `PLAYWRIGHT_MODULE` to its installed module directory if necessary, and `BROWSER_PATH` to an installed Chromium-compatible browser executable if Playwright's Chromium isn't installed. Run:

```sh
node scripts/browser-smoke.cjs
node scripts/audio-browser-check.cjs
node scripts/extension-smoke.cjs
```

This starts an isolated preview server and fresh browser context. Browser microphone tests use generated synthetic audio; they do not access the user's microphone. Screenshots are written to ignored `test-results/`. Test data belongs to that temporary browser context and does not modify the installed extension's store.

`audio-browser-check.cjs` verifies native recording, decoding, resampling, automatic stopping, and microphone cleanup. `extension-smoke.cjs` loads the unpacked extension in a temporary profile (Edge by default on Windows), uses offline page fixtures, and removes the profile afterward. Set `BROWSER_PATH` to a browser that supports command-line unpacked extension loading for this check.

## Verified integration — September 15, 2026

- **56 Node tests passed**, plus JavaScript syntax, MV3 metadata, local asset checks, and `git diff --check`.
- **Studio browser flow passed** in Chrome: audio import, recovery from partial save without duplicate phrases, playback/speed/loop, segment confirmation and immutable snapshots, recording, A/B comparison, timing feedback, speaking reviews, test mode, vocabulary cards, explicit mocked assessment, mocked Voicebox generation, backup merge and restoration into a fresh store, saved dark mode, live system-theme changes, and mobile layout. Desktop, settings, and mobile screenshots were visually inspected.
- **Native browser audio checks passed** with synthetic microphone input: recording, level metering, decoding, timing comparison, WAV conversion, automatic stop, permission-race cancellation, and release of microphone tracks.
- **8 unpacked extension checks passed** in Edge: service-worker migration with legacy data preserved; popup counts, languages, and routing; phrase/audio message validation and deep links; partial audio-save failure; injected caption vocabulary colors; dismissal of stale popups after language changes; caption selection through capture to studio; and concurrent writes from worker and popup without loss.

Provider fixtures verify request/response handling, not live speech quality. No real Voicebox profiles or Azure credentials were used.

## Hands-on acceptance

- Reload/load the extension in Chrome, then open the new popup and studio.
- Enable reading on a normal website; confirm saved known/learning colors and translation still work. Select a Spanish phrase and choose Practice this phrase. Confirm text/source and any available original audio appear in the studio.
- Try a native clip: loop a section, set matching practice text, shadow it, record independently, replay A/B, and save a self-rating. In test mode, verify the reference stays hidden until recording.
- Reload to verify attempts, immutable references, chosen accents, and independent review schedules persist.
- Connect the user's actual Voicebox instance, assign profiles to different accents, and generate and replay references. Verify cached references play while Voicebox is offline.
- Configure the optional assessment bridge and evaluate real Spanish recordings. Verify unsupported accents and provider failures show actionable feedback, without made-up scores.
- Export/import studio data and separately export legacy vocabulary. Verify existing words and recordings survive migration.

Live Voicebox profile quality, real microphone quality, YouTube's current captions UI, Azure credentials, and the usefulness of scoring against human judgments require hands-on checks with the user's setup. Mocked provider tests do not establish those outcomes.
