-- Polybot Insights — analytics-owned reference data (ADR-015)
-- Skills (ADR-005), the event catalog (docs/EVENT_TAXONOMY.md §3) and preference definitions (ADR-009).
-- Content defined in the extension (languages, lessons, topics) is synced separately in Phase 3.

-- ─── Skill taxonomy v1 ─────────────────────────────────────────────────────
INSERT INTO core.skills (skill_id, parent_skill_id, name, description) VALUES
  ('vocabulary',              NULL, 'Vocabulary',              'Recognizing and recalling the meaning of words and short phrases.'),
  ('grammar',                 NULL, 'Grammar',                 'Understanding and using the patterns that structure sentences.'),
  ('pronunciation',           NULL, 'Pronunciation',           'Producing sounds, rhythm and stress that listeners understand.'),
  ('listening_comprehension', NULL, 'Listening comprehension', 'Understanding spoken material.'),
  ('reading_comprehension',   NULL, 'Reading comprehension',   'Understanding written material.');

-- Grammar subskills mirror the 25 topic slugs in learning-data.js (TOPICS).
INSERT INTO core.skills (skill_id, parent_skill_id, name, description)
SELECT 'grammar.' || slug, 'grammar', title, 'Grammar principle (' || level || '): ' || title || '.'
FROM (VALUES
  ('A1', 'word-order',            'Basic word order'),
  ('A1', 'nouns-articles',        'Nouns and articles'),
  ('A1', 'pronouns',              'Personal pronouns'),
  ('A1', 'present-time',          'Present-time forms'),
  ('A1', 'questions-negation',    'Questions and negation'),
  ('A2', 'description-agreement', 'Description and agreement'),
  ('A2', 'past-events',           'Talking about past events'),
  ('A2', 'future-plans',          'Plans and future time'),
  ('A2', 'comparison',            'Comparison and quantity'),
  ('A2', 'objects-possession',    'Objects and possession'),
  ('B1', 'aspect-habits',         'Time, aspect, and habits'),
  ('B1', 'modality',              'Ability, obligation, and advice'),
  ('B1', 'conditionals',          'Real and hypothetical conditions'),
  ('B1', 'relative-clauses',      'Adding detail with clauses'),
  ('B1', 'reported-speech',       'Reporting what people say'),
  ('B2', 'complex-sentences',     'Complex sentence connections'),
  ('B2', 'voice-focus',           'Changing sentence focus'),
  ('B2', 'stance-register',       'Stance and register'),
  ('B2', 'advanced-conditions',   'Counterfactual meaning'),
  ('B2', 'cohesion',              'Cohesion across a text'),
  ('C1', 'information-structure', 'Emphasis and information structure'),
  ('C1', 'nuance-modality',       'Nuanced modality'),
  ('C1', 'discourse-style',       'Discourse and style'),
  ('C1', 'idiomatic-patterns',    'Idiomatic grammar patterns'),
  ('C1', 'editing-precision',     'Editing for precision')
) AS topic (level, slug, title);

-- ─── Event catalog v1 (must match docs/EVENT_TAXONOMY.md §3) ───────────────
INSERT INTO core.event_types (event_type, category, signal_kind, description) VALUES
  ('learner_registered',      'account',        'system',      'Insights enabled for this install; creates the learner.'),
  ('session_started',         'session',        'system',      'Service worker opened a new session after 30+ idle minutes.'),
  ('session_ended',           'session',        'system',      'Best-effort end of the previous session.'),
  ('lesson_started',          'lesson',         'behavioral',  'Learner opened a lesson (grammar topic, media item, phrase, vocab set).'),
  ('lesson_completed',        'lesson',         'self_report', 'Lesson finished; completion=self_marked is self-report, all_items_done is behavioral.'),
  ('content_skipped',         'exercise',       'behavioral',  'Learner skipped an exercise or left a lesson early.'),
  ('answer_submitted',        'exercise',       'objective',   'Answer to a system-graded exercise, with correctness and response time.'),
  ('hint_requested',          'exercise',       'behavioral',  'Learner asked for a hint.'),
  ('feedback_viewed',         'exercise',       'behavioral',  'Learner opened an explanation, assessment detail or timing comparison.'),
  ('vocab_status_changed',    'vocabulary',     'self_report', 'Word marked unmarked, learning or known.'),
  ('vocab_bulk_marked',       'vocabulary',     'self_report', 'Frequency-band catch-up marked many words known at once.'),
  ('word_looked_up',          'vocabulary',     'behavioral',  'Word translated on a page or in the dictionary.'),
  ('definition_saved',        'vocabulary',     'behavioral',  'Learner saved a meaning for a word.'),
  ('phrase_captured',         'vocabulary',     'behavioral',  'Phrase saved from the web or a video (no text is sent).'),
  ('review_rated',            'vocabulary',     'self_report', 'Learner rated recall of a meaning, listening or speaking review.'),
  ('pronunciation_attempted', 'pronunciation',  'behavioral',  'Learner recorded a pronunciation attempt.'),
  ('pronunciation_scored',    'pronunciation',  'objective',   'Speech provider scored an attempt (accuracy, fluency, completeness).'),
  ('media_response_saved',    'media',          'behavioral',  'Learner saved a writing or speaking reflection (length only).'),
  ('preference_set',          'preference',     'explicit',    'Learner stated a preference via quiz, settings or override.'),
  ('difficulty_changed',      'preference',     'explicit',    'Difficulty band changed by the learner or applied by the system (see initiated_by).'),
  ('recommendation_shown',    'recommendation', 'system',      'A recommendation was displayed.'),
  ('recommendation_accepted', 'recommendation', 'behavioral',  'Learner followed a recommendation.'),
  ('recommendation_skipped',  'recommendation', 'behavioral',  'Learner dismissed a recommendation or chose something else.');

-- ─── Preference definitions (shared keys for explicit AND inferred values) ─
INSERT INTO core.preference_definitions
  (preference_key, category, value_type, allowed_values, description, can_be_explicit, can_be_inferred) VALUES
  ('practice_balance',       'learning', 'number',    '{"min": 0, "max": 100}',
   'Input (listening, reading) versus output (speaking, writing): 0 = all input, 100 = all output.', true, true),
  ('grammar_approach',       'learning', 'number',    '{"min": 0, "max": 100}',
   'How grammar is introduced: 0 = examples first, 100 = rules first.', true, true),
  ('content_formats',        'content',  'enum_list', '{"values": ["audio", "reading", "speaking", "writing", "visual", "hands-on"], "max_items": 6}',
   'Content formats the learner enjoys or engages with (formats, not learning styles; spec §3).', true, true),
  ('interests',              'content',  'enum_list', '{"values_from": "core.topics", "max_items": 10}',
   'Topics for examples and practice scenarios.', true, true),
  ('region',                 'content',  'enum',      '{"values_from": "catalog:regions"}',
   'Regional variety the learner wants to explore.', true, false),
  ('accent',                 'content',  'enum',      '{"values": ["es-MX", "es-ES", "es-AR", "es-CO", "es-CL", "es-PR", "es-CU", "es-PE"]}',
   'Reference accent for pronunciation practice.', true, false),
  ('session_length_minutes', 'study',    'number',    '{"min": 3, "max": 90}',
   'Preferred practice session length.', true, true),
  ('difficulty_preference',  'learning', 'enum',      '{"values": ["easier", "standard", "harder"]}',
   'Preferred challenge level; inferred values describe difficulty tolerance.', true, true),
  ('review_frequency',       'study',    'enum',      '{"values": ["less", "standard", "more"]}',
   'How often to bring back material for review; inferred values describe repetition need.', true, true),
  ('focus_skill',            'learning', 'enum',      '{"values_from": "core.skills"}',
   'Skill the learner wants more practice in.', true, true),
  ('feedback_detail',        'feedback', 'enum',      '{"values": ["brief", "detailed"]}',
   'How much explanation to show after an answer.', true, true);
