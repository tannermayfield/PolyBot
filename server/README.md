# Optional pronunciation assessment

The studio records, compares playback, and estimates timing locally. This optional Node bridge adds Azure pronunciation assessment when the learner explicitly selects **Assess**. Only that recording (converted to 16 kHz mono PCM WAV), its reference text, and its selected locale are sent to Azure. The bridge does not save or log recordings, transcripts, assessment results, or keys; the studio saves returned feedback alongside the attempt.

## Run

Requires Node 22 or later and an Azure Speech resource. No npm dependencies are needed.

1. Copy `server/.env.example` to `server/.env`.
2. Set `AZURE_SPEECH_KEY` and the matching `AZURE_SPEECH_REGION`, or set `AZURE_SPEECH_ENDPOINT` to the official resource origin, such as `https://your-resource.cognitiveservices.azure.com`.
3. Open `chrome://extensions`, enable Developer mode, and copy the loaded extension's ID. Set `ALLOWED_ORIGINS=chrome-extension://<that-id>`. For browser development, explicitly add the exact localhost preview origin, separated by a comma. Wildcards and public website origins are rejected.
4. From the project root, run:

   ```powershell
   node --env-file=server/.env server/assessment-server.cjs
   ```

5. Open the studio's assessment settings, enable optional assessment, and connect `http://127.0.0.1:17494`. Allow the requested browser host permission. Record an independent attempt with reference audio muted, then choose Assess.

The server binds only to `127.0.0.1`. `GET /health` reports configuration readiness and supported locales without exposing credentials. A local check is `Invoke-RestMethod http://127.0.0.1:17494/health`. No listener opens when this module is imported by tests.

Use short matching text and audio, between 0.2 and 30 seconds. A reference segment needs its own corresponding transcript. A voice clone supplies an example; the assessment is against Azure's locale model, not against that speaker's identity or exact accent.

## Supported feedback and limits

- Supported Spanish assessment locales: `es-MX` and `es-ES`. Other accent collections remain fully usable for shadowing and recording; the bridge rejects unsupported locales instead of silently mapping them.
- Provider feedback includes available accuracy, fluency, completeness, word details, and phoneme details. Missing provider scores remain null.
- Spanish prosody, intonation, and a synthetic native-accent score are not calculated or displayed. Timing comparison is an energy-based estimate that can be affected by noise; it is not a speech or phoneme detector.
- Automated feedback can misinterpret speech and regional variation. Listen to the recording and example to confirm suggestions. This implementation has not been calibrated against human judgments or tested with live cloud credentials.
- Azure requests may incur your resource's normal usage charges. Upstream requests time out after 35 seconds; client cancellation aborts upstream work where possible. Cancellation cannot undo audio already transmitted or guarantee a provider will stop charging for a request it accepted.
- Requests require an explicit allowed Origin. The server bounds uploads, validates WAV format/duration, permits two concurrent assessments, rejects nonlocal Host headers and redirects, and returns sanitized upstream errors.

## Voicebox references

Run Voicebox locally (the studio default is `http://127.0.0.1:17493`). Connect in Voices, import a profile, assign its regional label, and generate a reference from a Spanish phrase. The app calls `GET /profiles`, `POST /generate` with `language: 'es'`, polls `GET /history/{id}` for queued generations, and downloads `GET /history/{id}/export-audio`. Generation times out after two minutes; stopping the wait does not cancel a job already accepted by Voicebox. Voice setup and cloning occur in Voicebox. Confirm the chosen engine supports Spanish and listen to a generated sample before using it as a regional reference. No default voices or reference recordings are fabricated.

## Primary references

- [Azure short-audio REST API and pronunciation request/response fields](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text-short)
- [Azure pronunciation assessment language support](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=pronunciation-assessment)
- [Azure pronunciation assessment configuration and prosody support](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment)
- [Voicebox generation API flow](https://docs.voicebox.sh/developer/tts-generation)
- [Voicebox documentation](https://docs.voicebox.sh/)

Keep `server/.env` private. Never enter the Azure key in the extension, a browser console, shared screenshots, or a backup.
