# Learner Event Taxonomy — v1

The contract between the extension's event emitter (Phase 3) and the insights pipeline (Phase 4). The database copy of this catalog is `core.event_types` (seeded by migration `002_reference_data.sql`); the two must stay identical.

## 1. Principles

1. **Meaningful only.** Every event type below states which learner-model signal it feeds. If no signal needs it, it is not collected (spec §6, §34). Page views, clicks, scrolls, and theme changes are deliberately absent.
2. **Facts, not conclusions** (ADR-008). Emit `answer_submitted` with `is_correct`. Never also emit `answer_correct`, because SQL derives it.
3. **Signal kind is explicit.** Each type is labeled `objective` (graded by the system), `self_report` (the learner's own judgment), `behavioral` (what they did), `explicit` (a stated preference), or `system`. The learner model never blends these into one number.
4. **Privacy by construction.** No free text, page content, URLs, or audio ever enters an event (§6).
5. **IDs, not names.** Events carry content identifiers; the pipeline resolves skill and difficulty from the catalog (ADR-010).

## 2. Transport: batch and envelope

### 2.1 Batch (`POST /v1/event-batches`)

| Field | Type | Required | Rules |
|---|---|---|---|
| `batch_id` | UUID | ✓ | Client-generated. Retries reuse it, which makes ingest idempotent |
| `learner_id` | UUID | ✓ | Must equal every event's `learner_id` |
| `source` | enum | ✓ | `extension` \| `simulator` \| `backfill` |
| `sent_at` | timestamp | ✓ | Client clock, RFC 3339 UTC |
| `dropped_since_last_sync` | integer ≥ 0 | ✓ | Events lost to buffer overflow since the previous successful sync (loss is reported, never silent) |
| `events` | array | ✓ | 1–500 envelopes; whole body ≤ 1 MB |

### 2.2 Event envelope

| Field | Type | Required | Rules |
|---|---|---|---|
| `event_id` | UUID v4 | ✓ | Client-generated, unique forever; the deduplication key |
| `schema_version` | integer | ✓ | `1` for this document |
| `event_type` | string | ✓ | One of §3 |
| `learner_id` | UUID | ✓ | ADR-002 |
| `session_id` | UUID | ✓ | Assigned by the service worker (§5.2) |
| `occurred_at` | timestamp | ✓ | RFC 3339 with milliseconds, UTC (`Z`) |
| `tz_offset_minutes` | integer | — | Local offset from UTC, −840…840. Used only for "preferred practice time" (spec §21) |
| `surface` | enum | ✓ | `studio` \| `popup` \| `page` \| `catchup` \| `service` \| `simulator` |
| `app_version` | string | ✓ | Extension `manifest.json` version |
| `language` | string | conditional | Target language code; required for every event except `learner_registered`, `session_*`, and `recommendation_*` |
| `context` | object | — | Only the keys in §2.3 |
| `payload` | object | ✓ | Event-specific fields from §3 (may be `{}`) |

### 2.3 Context keys

| Key | Format | Example |
|---|---|---|
| `lesson_id` | existing activity IDs, ≤ 300 chars | `grammar:es:A2:past-events`, `media:es:provided:reading:interactive:daily-routine`, `phrase:starter-repeat` |
| `exercise_id` | `<exercise_type>:<target id>` | `vocab_recall_choice:es:casa` |
| `vocab_item_id` | `<language>:<lower-cased term>`, the ID the extension already uses | `es:casa` |
| `recommendation_id` | UUID | from `personalization.recommendations` |
| `decision_id` | UUID | from `personalization.decisions` |
| `generated_content_id` | string ≤ 300 | reserved for future generated content |

### 2.4 Example

```json
{
  "event_id": "1b9f4c2e-7d0a-4f7e-9a51-3c2d8e6f0a11",
  "schema_version": 1,
  "event_type": "answer_submitted",
  "learner_id": "6c0e2f6b-5b9e-4d8a-8f2a-0d4f7b1e9c33",
  "session_id": "e2a7c1d4-0f3b-4c6e-9b8a-5d1f2e3c4b77",
  "occurred_at": "2026-10-15T14:03:22.418Z",
  "tz_offset_minutes": -300,
  "surface": "studio",
  "app_version": "3.1.0",
  "language": "es",
  "context": { "exercise_id": "vocab_recall_choice:es:casa", "vocab_item_id": "es:casa" },
  "payload": { "exercise_type": "vocab_recall_choice", "is_correct": true, "response_time_ms": 2140,
               "attempt_number": 1, "hints_used": 0, "choice_count": 4 }
}
```

## 3. Event catalog (23 types)

**Req. context** lists context keys that must be present. Payload fields are required unless marked *opt*.

### 3.1 Account and session

| Event | Kind | Req. context | Payload | Feeds |
|---|---|---|---|---|
| `learner_registered` | system | — | `native_language`, `consent_version` | Creates the learner. Every other event from an unregistered learner is invalid |
| `session_started` | system | — | `entry_surface` | Sessions, consistency, preferred practice time |
| `session_ended` | system | — | `reason`: `idle` \| `rotated`; `last_activity_at` | Session length (best-effort; the pipeline also derives sessions from event times) |

### 3.2 Lessons and exercises

| Event | Kind | Req. context | Payload | Feeds |
|---|---|---|---|---|
| `lesson_started` | behavioral | `lesson_id` | `entry`: `navigation` \| `path` \| `recommendation` | Revisit rate, recommendation follow-through |
| `lesson_completed` | self_report or behavioral | `lesson_id` | `completion`: `self_marked` \| `all_items_done`; *opt* `items_completed` | Completion rate. `self_marked` is self-report and never counted as demonstrated mastery |
| `content_skipped` | behavioral | `exercise_id` or `lesson_id` | `reason`: `skip_button` \| `next_without_answer` \| `closed_early` | Engagement by content type, difficulty tolerance |
| `answer_submitted` | **objective** | `exercise_id` | `exercise_type`, `is_correct` (bool), `response_time_ms` (0–3,600,000), `attempt_number` (≥ 1), `hints_used` (≥ 0); *opt* `choice_count` (2–6), `score` (0–1) | Accuracy, trend, mastery, response speed, difficulty success |
| `hint_requested` | behavioral | `exercise_id` | `hint_type`: `first_letter` \| `eliminate_choice` \| `show_context` | Hint usage rate |
| `feedback_viewed` | behavioral | `exercise_id` or `lesson_id` | `feedback_type`: `answer_explanation` \| `assessment_detail` \| `timing_comparison`; *opt* `dwell_ms` | Explanation-style inference (spec §22) |

### 3.3 Vocabulary

| Event | Kind | Req. context | Payload | Feeds |
|---|---|---|---|---|
| `vocab_status_changed` | self_report | `vocab_item_id` | `from`, `to`: `unmarked` \| `learning` \| `known`; `method`: `page_click` \| `quick_mark` \| `popup` \| `studio` | Self-reported vocabulary size (kept apart from recall accuracy) |
| `vocab_bulk_marked` | self_report | — | `frequency_level` (1–4), `words_marked`, `words_already_known` | Placement signal. One event per bulk action, never one per word |
| `word_looked_up` | behavioral | `vocab_item_id` when `direction = target_to_native` | `lookup_surface`: `page` \| `dictionary`; `direction`; `result`: `saved` \| `translated` \| `unavailable` | Repeated lookups of the same word are a struggle signal |
| `definition_saved` | behavioral | `vocab_item_id` | `has_context` (bool), `is_custom` (bool) | Interest and active vocabulary building |
| `phrase_captured` | behavioral | *opt* `lesson_id` | `capture_source`: `web` \| `video`; `has_audio` (bool); `word_count` (1–200) | Content-type engagement (video vs web) |
| `review_rated` | self_report | `vocab_item_id` (meaning/listening) or `lesson_id` (speaking) | `review_kind`: `meaning` \| `listening` \| `speaking`; `rating`: `again` \| `hard` \| `good` \| `easy`; *opt* `revealed_after_ms`, `client_attempt_ref` | Repetition need, retention (self-assessed) |

### 3.4 Pronunciation and media

| Event | Kind | Req. context | Payload | Feeds |
|---|---|---|---|---|
| `pronunciation_attempted` | behavioral | `lesson_id` (`phrase:<id>`) | `client_attempt_ref`, `mode`: `practice` \| `test`; `duration_ms`; `accent`; `has_reference`; `is_segment` | Practice volume, speaking engagement |
| `pronunciation_scored` | **objective** | `lesson_id` | `client_attempt_ref`, `provider`: `azure`; `locale`; `accuracy`, `fluency`, `completeness` (0–100 or null); `words_scored`; `words_below_70` (≤ `words_scored`) | Pronunciation skill score |
| `media_response_saved` | behavioral | `lesson_id` | `mode`: `writing` \| `speaking_reflection`; `response_chars` | Output practice volume. **The text itself is never sent** |

### 3.5 Preferences and adaptation

| Event | Kind | Req. context | Payload | Feeds |
|---|---|---|---|---|
| `preference_set` | **explicit** | — | `preference_key` (from `core.preference_definitions`), `value`, `stated_via`: `quiz` \| `settings` \| `override`; *opt* `previous_value` | `core.explicit_preferences`, the "You told us" panel |
| `difficulty_changed` | explicit or system | *opt* `decision_id` | `from_band`, `to_band` (1–5), `initiated_by`: `learner` \| `system` | Difficulty tolerance; audit of system adaptations |

### 3.6 Recommendations

| Event | Kind | Req. context | Payload | Feeds |
|---|---|---|---|---|
| `recommendation_shown` | system | `recommendation_id`, `decision_id` | `placement`: `home` \| `dashboard` \| `path`; `rank` | Acceptance-rate denominator |
| `recommendation_accepted` | behavioral | `recommendation_id` | — | Personalization outcomes (spec §28) |
| `recommendation_skipped` | behavioral | `recommendation_id` | `reason`: `dismissed` \| `chose_other` | Personalization outcomes |

## 4. Mapping to the spec's candidate events (spec §6)

| Spec name | v1 handling | How |
|---|---|---|
| `lesson_started`, `lesson_completed` | **Emitted** | as named |
| `exercise_started` | Derived | presented = `answer_submitted` + `content_skipped`; time-on-item is `response_time_ms` |
| `exercise_completed` | Derived | the final `answer_submitted` for an `exercise_id` in a session |
| `answer_submitted` | **Emitted** | as named |
| `answer_correct`, `answer_incorrect` | Derived | `answer_submitted.is_correct` |
| `hint_requested`, `feedback_viewed` | **Emitted** | as named |
| `pronunciation_attempted` | **Emitted** | as named |
| `pronunciation_score_recorded` | **Emitted** as `pronunciation_scored` | shorter name, same meaning |
| `vocabulary_reviewed` | **Emitted** as `review_rated` | also covers listening and speaking reviews |
| `grammar_exercise_completed` | Derived | `lesson_completed` where the lesson type is `grammar_topic` |
| `conversation_completed` | Deferred | Polybot has no conversation feature yet |
| `content_skipped` | **Emitted** | as named |
| `content_repeated` | Derived | the same `lesson_id` or `exercise_id` started more than once in a session |
| `lesson_revisited` | Derived | `lesson_started` for a lesson already completed in an earlier session |
| `session_started`, `session_ended` | **Emitted** by the service worker | best-effort end; durations derived from event times |
| `difficulty_changed` | **Emitted** | as named |
| `recommendation_shown/accepted/skipped` | **Emitted** | as named |

Added beyond the spec, each because a learner-model signal needs it: `learner_registered` (identity validation), `vocab_status_changed` and `vocab_bulk_marked` (Polybot's most common existing signal), `word_looked_up` (struggle signal), `definition_saved` and `phrase_captured` (interest and engagement), `media_response_saved` (output practice), `preference_set` (explicit preferences, spec §9, §26).

## 5. Delivery semantics

### 5.1 Buffer and sync
- Surfaces send `{type: 'RECORD_EVENT', event}` to the service worker, the only writer of `polybotEventBuffer` (ADR-011).
- The buffer holds up to 5,000 events. On overflow the oldest are dropped and counted in `dropped_since_last_sync`.
- Sync runs when the buffer reaches 50 events, 30 seconds after the last event, or immediately after `preference_set`. Failures back off exponentially (capped at 10 minutes).
- Events are removed from the buffer only after a 2xx response. That is **at-least-once** delivery; the server deduplicates (`batch_id`, then `event_id`).

### 5.2 Sessions
The service worker owns `session_id`. A new session begins when more than **30 minutes** have passed since the previous event; the worker then emits `session_ended` (reason `idle`, `last_activity_at` = previous event time) followed by `session_started`. No `beforeunload` handlers are needed.

## 6. Privacy exclusions (ADR-006)

Never sent in any event: media-response text, grammar notes, phrase or sentence text, translation text, Azure transcripts, source URLs, hostnames, page titles, audio, or any account identifier. The ingest validator rejects payloads containing the keys `text`, `sentence`, `translation`, `transcript`, `url`, `source_url`, `hostname`, `title`, `audio`, or `audio_url` (`PAYLOAD_FORBIDDEN_FIELD`).

Allowed with care: target-language vocabulary terms appear inside `vocab_item_id` because the learner model needs per-word evidence. They stay in the local database and are **excluded from BI exports**, which aggregate to skill level (spec §28).

## 7. Validation rules (implemented in Phase 4)

A rule with severity **error** marks the raw row `invalid` and adds an `ops.validation_issues` row. A **warning** keeps the row valid and records the issue. Nothing is deleted (spec §12).

| Code | Severity | Check | Run counter |
|---|---|---|---|
| `ENVELOPE_MISSING_FIELD` | error | a required envelope field is absent or null | `rows_invalid`, `rows_missing_fields` |
| `PAYLOAD_MISSING_FIELD` | error | a required payload or context field is absent | `rows_invalid`, `rows_missing_fields` |
| `INVALID_UUID` | error | `event_id`, `learner_id`, `session_id`, or a UUID context key is malformed | `rows_invalid` |
| `UNKNOWN_EVENT_TYPE` | error | not in `core.event_types` (active) | `rows_invalid` |
| `UNSUPPORTED_SCHEMA_VERSION` | error | `schema_version` not supported | `rows_invalid` |
| `UNKNOWN_LEARNER` | error | no `learner_registered` for this learner (in the database or earlier in the batch) | `rows_invalid` |
| `LEARNER_MISMATCH` | error | event `learner_id` ≠ batch `learner_id` | `rows_invalid` |
| `TIMESTAMP_UNPARSEABLE` | error | `occurred_at` is not RFC 3339 | `rows_invalid` |
| `TIMESTAMP_IN_FUTURE` | error | `occurred_at` more than 5 minutes after `received_at` | `rows_invalid` |
| `TIMESTAMP_TOO_OLD` | error | `occurred_at` before 2024-01-01 | `rows_invalid` |
| `UNKNOWN_LANGUAGE` | error | `language` not in `core.languages` | `rows_invalid` |
| `UNKNOWN_REFERENCE` | error | `lesson_id`, `recommendation_id`, or `decision_id` does not exist (learner-owned `phrase:` lessons and new `vocab_item_id`s are registered on first sight instead) | `rows_invalid` |
| `VALUE_OUT_OF_RANGE` | error | a score, count, band, or duration is outside its documented range (e.g. accuracy > 100, `attempt_number` < 1, negative `response_time_ms`) | `rows_invalid` |
| `INVALID_ENUM` | error | an enum field has an undocumented value | `rows_invalid` |
| `INCONSISTENT_FIELDS` | error | logically impossible combination (e.g. `words_below_70` > `words_scored`; `from` = `to` in a status change) | `rows_invalid` |
| `PAYLOAD_FORBIDDEN_FIELD` | error | a privacy-excluded key is present (§6) | `rows_invalid` |
| `DUPLICATE_EVENT` | — | `event_id` already loaded | `rows_duplicate` (status `duplicate`) |
| `RESPONSE_TIME_OUTLIER` | warning | `response_time_ms` > 10 minutes (likely the learner walked away) | — |
| `NEAR_DUPLICATE` | warning | same learner, type, and context within 1 second (likely a double click) | — |

Accounting identity enforced by `ops.pipeline_runs`: `rows_processed = rows_valid + rows_invalid + rows_duplicate`.

## 8. Versioning

- Adding an optional payload field: same `schema_version`; validators ignore unknown *optional* fields only after they are documented here.
- Renaming, removing, or changing the meaning of a field: bump `schema_version`. The pipeline supports the current and previous version.
- New event types: add to §3 and to `core.event_types` in a new migration; never edit an applied migration.

## 9. Instrumentation map (Phase 3 plan)

| Event | Emitted from |
|---|---|
| `vocab_status_changed` | `shared.js` quick-mark (≈ line 930) and popup status actions (≈ line 1302) |
| `vocab_bulk_marked` | `catchup.js` level marking (≈ line 63) |
| `word_looked_up` | `shared.js` translation requests; `learning-data.js` `lookup()` |
| `definition_saved` | `shared.js` `saveDefinition` / `saveCustomDefinition` |
| `phrase_captured` | `shared.js` `saveToBuildPhrases`; `background.js` `saveStudioPhrase` |
| `review_rated` | `studio.js` actions `rate-learning-word` (also fixes audit T4), `rate-card`, `rate-speaking` |
| `pronunciation_attempted` / `_scored` | `studio.js` `finishRecording` / `assessAttempt` |
| `feedback_viewed` | `studio.js` `compareTiming`; assessment detail |
| `lesson_started` / `lesson_completed` | `studio.js` grammar and media open/complete actions |
| `media_response_saved` | `studio.js` media response form submit |
| `preference_set` | `personalization-method.js`, `personalization-interests.js`, `personalization-regions.js` save handlers; accent setting |
| `answer_submitted`, `hint_requested`, `content_skipped` | new vocabulary recall exercise (ADR-004) |
| `session_*`, `learner_registered` | `background.js` (service worker) |
| `recommendation_*`, `difficulty_changed` | dashboard and recommendation surfaces (Phases 6–7) |
