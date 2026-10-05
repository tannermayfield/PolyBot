# Spanish shadowing studio contracts

Vanilla JavaScript, Manifest V3. The full-tab entry is `studio.html`; the former vocabulary manager page has been removed. Scripts load in this order: languages.js, learning-data.js, study-data.js, study-audio.js, studio.js. All APIs are on `window`; data/audio libraries also export through CommonJS for Node tests. No remote JS, framework, or build step.

## Ownership

- UI agent: studio.html, studio.css, studio.js only.
- Data agent: study-data.js, tests/study-data.test.cjs only.
- Audio agent: study-audio.js, server/**, tests/study-audio.test.cjs, tests/assessment-server.test.cjs only.
- Lead: all other existing files, docs, package.json, testing harness, integration.

## Data API: window.StudioData (async unless stated otherwise)

`init()` and `load()` return `{version:1, phrases:[], voices:[], attempts:[], reviews:{}, settings:{accentId:'es-MX',voiceboxUrl:'http://127.0.0.1:17493',assessmentUrl:'http://127.0.0.1:17494',assessmentEnabled:false,theme:'system'}, vocabulary:[]}`. Theme is `light`, `dark`, or `system`; it is included in backups and mirrored locally so the correct palette can be applied before first paint.

The studio is Spanish-first. Vocabulary is derived from existing Spanish keys without modifying recognition/known status. Legacy Spanish phrases import idempotently on load; imported recordings become attempts and reference clips are retained. Import old Voicebox settings when available. Seed a small set of useful Spanish practice phrases if empty, clearly marked `source:'starter'`; never seed recordings, voices, scores or progress.

Records:

- Phrase: `{id,text,translation,source:'starter'|'manual'|'web'|'video',sourceUrl?,createdAt,accentId?,references:[]}`.
- Reference: `{id,label,kind:'original'|'voicebox'|'upload',audioUrl,voiceId?,accentId?,createdAt}`. Audio URLs are audio data URLs for persistence. Each generated voice reference is retained, not overwritten. User may import a local audio clip.
- Voice: `{id,profileId,name,accentId,baseUrl,description?}`. Voicebox profile id maps to provider; `id` is local voice record id.
- Attempt: `{id,phraseId,text,createdAt,audioUrl,duration,mode:'practice'|'test',accentId,referenceId?,referenceSnapshot?:{label,audioUrl,accentId?,start?,end?,text?},assessment?:AssessmentResult,selfRating?:'again'|'hard'|'good'|'easy'}`. `text` is the immutable expected/practice transcript captured when recording, including when no audio reference exists. Later assessment uses this snapshot, never a subsequently edited phrase. Legacy attempts can derive it from their original phrase during migration.
- Vocabulary item: `{id,word,meaning,status,context?}`; use `matched` before `translation` from legacy definitions; keep words with no meaning visible, but do not quiz undefined meanings.
- Review map key: `meaning:<vocabularyId>` or `speaking:<phraseId>`. Value: `{dueAt,intervalDays,repetitions,lastRating,reviewedAt}`.

Methods:

- `savePhrase({id?,text,translation?,source?,sourceUrl?,accentId?})` -> saved Phrase. Preserve existing references when editing.
- `removePhrase(id)` removes phrase and its attempts/speaking reviews, with tombstone preventing legacy reimport.
- `saveVoice(Voice)` -> saved Voice; `removeVoice(id)` removes configuration only, preserving references and attempts.
- `addReference(phraseId,Reference)` -> saved Reference.
- `saveAttempt(Attempt)` -> saved Attempt; `removeAttempt(id)` deletes that recording.
- `saveSettings(partial)` -> merged settings.
- `rateReview(kind,itemId,rating,now?)` -> Review (`kind` meaning/speaking, rating again/hard/good/easy).
- `dueItems(state,kind,now?)` synchronous -> array of Vocabulary items or Phrases due, including unreviewed items. Do not mix meaning and speaking mastery.
- `stats(state,now?)` synchronous -> `{attempts,practiceMinutes,practicedDays,dueSpeaking,dueMeaning}`.
- `exportBackup()` -> JSON-safe `{format:'gift-of-tongues-studio',version:1,state:<persisted-state>}` including references/attempt audio; `importBackup(backup)` validates and merges safely, preserving existing records.
- `subscribe(callback)` -> unsubscribe. Callback indicates change; caller can load. Use chrome.storage.local; standalone localhost preview fallback localStorage. Serialize read-modify-write via Web Locks where available and a local queue. Never overwrite whole legacy stores. No async state writes during pure render/load unless migration required. Bound/validate imported content and avoid prototype pollution.

`StudioData.ACCENTS` synchronous constant: array `{id,label,shortLabel,description}` for es-MX, es-ES, es-AR, es-CO, es-CL, es-PR, es-CU, es-PE. Labels describe regions, not guarantees of generated accent accuracy.

## Audio API: window.StudioAudio

- `createRecorder({onLevel?,onAutoStop?,maxSeconds?:30})` -> `{start():Promise<void>,stop():Promise<{blob,audioUrl,duration}>,cancel():void}`. Stop all mic tracks; robust repeated clicks, permission errors, empty audio, max duration. `onAutoStop(recording)` receives result at limit. Only clean independent attempt is scored. UI silences reference before recording.
- `analyze(audioUrl)` -> `{duration,activeDuration,pauseCount,rms,clippingRatio}`. Decode audio; honest duration/pauses/level metrics, never an accent score.
- `compare(referenceUrl,attemptUrl)` -> `{reference,attempt,paceRatio,tips:[]}` from above metrics. Label comparisons as timing only; no claims of phoneme/intonation measurement.
- `toWav(audioUrl)` -> Blob (16 kHz mono PCM), <=30 seconds for assessment.
- `listVoiceboxProfiles(baseUrl)` -> array `{id,name}` (accept Voicebox array or wrapper).
- `generateVoicebox({baseUrl,profileId,text,signal?})` -> `{audioUrl}`. Real API POST /generate with language:'es', poll status bounded, GET /history/{id}/export-audio. Validate base URL, audio MIME/size, cancellation/timeouts; errors surface.
- `requestAccess(baseUrl)` -> Promise<boolean>; call from direct user interaction before async work. Chrome optional host permissions; browser preview true. Loopback HTTP or HTTPS allowed, no credentials in URL. Chrome origin permission patterns do not include ports.
- `assess({audioUrl,text,accentId,endpoint,signal?})` -> AssessmentResult. Explicit user action only; no automatic upload. POST to `${endpoint}/assess` JSON `{audioBase64:<raw WAV base64>,text,locale:accentId}`. Fail clearly for unsupported locale or unavailable service; don't relabel unsupported accents as supported.
- AssessmentResult: `{provider:'azure',locale,transcript,accuracy:number|null,fluency:number|null,completeness:number|null,words:[{word,accuracy:number|null,errorType?,phonemes?:[{phoneme,accuracy:number|null}]}],tips:[],limitations:[]}`. No synthetic accent score or Spanish prosody score.

## Optional assessment bridge

Node >=22, built-in APIs only, entry `server/assessment-server.cjs`; `GET /health` and `POST /assess`. AZURE_SPEECH_KEY and AZURE_SPEECH_REGION (or explicitly supported official resource endpoint) read server-side only. Bind 127.0.0.1:17494. Never put vendor secrets in extension. Check Origin against explicit ALLOWED_ORIGINS (extension id or local preview origin), limit body and audio duration, validate PCM WAV and configured Spanish locales, upstream timeout, sanitized errors. Missing setup yields actionable service/configuration error. Export parser/handler helpers for tests without opening listener at import. Include server README and .env.example with actual run instructions and primary documentation links. Real cloud evaluation cannot be claimed without credentials.

## UI acceptance

Polished calm learning app: warm off-white/ink, violet accent, restrained borders, accessible icons, and a responsive sidebar. Main navigation is My Path, Personalization, Vocabulary, Grammar, Pronunciation, and Media. Home keeps the guided course above cross-skill progress graphics. Pronunciation contains Shadowing and Phrase Library; regional selection lives in Regions & Accents, while Voicebox management lives in pronunciation settings. No invented metrics. Working recording and reference playback, segment loop start/end, speed, translation toggle, test mode with reference hidden until attempt, A/B playback, history, retry, self-rating, and explicit optional assessment. Keep reference snapshots consistent with clip bounds and phrase transcripts. Voicebox can connect and assign profiles to accents, generate/save reference audio, and upload audio and text. Existing capture remains visible on reload and subscription. Clear errors and focus states. Export/import studio backup. URL hash navigation and `?phrase=<id>#pronunciation` are canonical. Avoid losing in-flight work when data changes; disable controls during recording or generation as needed.
