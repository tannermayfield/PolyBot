'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Recall = require('../vocab-recall.js');
const Events = require('../insights-events.js');

const FR = [
  { id: 'w1', word: 'Maison', meaning: 'house' },
  { id: 'w2', word: 'chat', meaning: 'cat' },
  { id: 'w3', word: 'chien', meaning: 'dog' },
  { id: 'w4', word: 'pain', meaning: 'bread' },
  { id: 'w5', word: 'eau', meaning: 'water' }
];
function seeded(seed = 7) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

test('recall needs four distinct words with meanings', () => {
  const words = [...FR.slice(0, 3), { id: 'x', word: 'sans sens' }, { id: 'y', word: 'chat', meaning: 'cat again' }, { id: 'z', word: 'minou', meaning: 'Cat' }];
  assert.deepEqual(Recall.readiness(words), { ready: false, count: 3, needed: 1 });
  assert.equal(Recall.buildQuestion(words, { language: 'fr' }), null);
  assert.deepEqual(Recall.readiness(FR), { ready: true, count: 5, needed: 0 });
});

test('a forward question shows the word and offers four meanings with exactly one correct', () => {
  const q = Recall.buildQuestion(FR, { language: 'fr', direction: 'forward', rng: seeded(), now: 1000 });
  const target = FR.find(w => w.id === q.wordId);
  assert.equal(q.prompt, target.word);
  assert.equal(q.choices.length, 4);
  assert.equal(q.choices.filter(c => c.correct).length, 1);
  assert.equal(q.choices.find(c => c.correct).label, target.meaning);
  assert.equal(new Set(q.choices.map(c => c.id)).size, 4);
  assert.equal(q.vocabItemId, `fr:${target.word.toLowerCase()}`);
  assert.equal(q.exerciseId, `vocab_recall_choice:${q.vocabItemId}`);
});

test('a reverse question shows the meaning and asks for the word', () => {
  const q = Recall.buildQuestion(FR, { language: 'fr', direction: 'reverse', rng: seeded(3) });
  const target = FR.find(w => w.id === q.wordId);
  assert.equal(q.prompt, target.meaning);
  assert.equal(q.choices.find(c => c.correct).label, target.word);
  assert.equal(q.exerciseType, 'vocab_recall_reverse_choice');
});

test('the previous word is not asked twice in a row when there are alternatives', () => {
  for (let seed = 1; seed < 40; seed++) {
    const q = Recall.buildQuestion(FR, { language: 'fr', avoidId: 'w1', rng: seeded(seed) });
    assert.notEqual(q.wordId, 'w1');
  }
});

test('answers record attempt number, timing, hints and visible choices', () => {
  let q = Recall.buildQuestion(FR, { language: 'fr', direction: 'forward', rng: seeded(), now: 10000 });
  const wrong = q.choices.find(c => !c.correct), right = q.choices.find(c => c.correct);
  q = Recall.useHint(q, seeded(9));
  assert.equal(q.hintsUsed, 1);
  assert.equal(q.eliminated.length, 1);
  const pickable = q.choices.find(c => !c.correct && !q.eliminated.includes(c.id));
  const first = Recall.answer(q, pickable.id, 12500);
  assert.deepEqual(first.payload, { exercise_type: 'vocab_recall_choice', is_correct: false, response_time_ms: 2500,
    attempt_number: 1, hints_used: 1, choice_count: 3 });
  const second = Recall.answer(first.question, right.id, 13000);
  assert.equal(second.payload.is_correct, true);
  assert.equal(second.payload.attempt_number, 2);
  assert.equal(second.payload.response_time_ms, 500, 'timed from the previous attempt');
  assert.equal(second.question.solved, true);
  assert.equal(Recall.answer(second.question, wrong.id, 14000), null, 'no answers after solving');
});

test('a choice cannot be picked twice and hints never remove the answer or leave fewer than two', () => {
  let q = Recall.buildQuestion(FR, { language: 'fr', rng: seeded(5) });
  const wrong = q.choices.find(c => !c.correct);
  const once = Recall.answer(q, wrong.id, q.shownAt + 1);
  assert.equal(Recall.answer(once.question, wrong.id, q.shownAt + 2), null);
  q = once.question;
  for (let i = 0; i < 5; i++) q = Recall.useHint(q, seeded(i + 1));
  const visible = q.choices.filter(c => !q.eliminated.includes(c.id));
  assert.equal(visible.length, 2);
  assert.ok(visible.some(c => c.correct));
  assert.equal(q.hintsUsed, 2, 'stops once only the answer and the already-picked wrong choice remain');
  assert.ok(visible.some(c => c.id === wrong.id));
});

test('skip reasons follow the taxonomy and solved questions are not skips', () => {
  const q = Recall.buildQuestion(FR, { language: 'fr', rng: seeded() });
  assert.equal(Recall.skipReason(q, 'skip'), 'skip_button');
  assert.equal(Recall.skipReason(q, 'close'), 'closed_early');
  const solved = Recall.answer(q, q.choices.find(c => c.correct).id).question;
  assert.equal(Recall.skipReason(solved, 'close'), null);
});

test('recall events pass the emitter checks in a non-Spanish language', () => {
  let q = Recall.buildQuestion(FR, { language: 'fr', rng: seeded() });
  q = Recall.useHint(q);
  const { payload } = Recall.answer(q, q.choices.find(c => c.correct).id, q.shownAt + 900);
  const context = { exercise_id: q.exerciseId, vocab_item_id: q.vocabItemId };
  assert.doesNotThrow(() => Events.stamp('answer_submitted', { surface: 'studio', language: 'fr', context, payload }));
  assert.doesNotThrow(() => Events.stamp('hint_requested', { surface: 'studio', language: 'fr', context, payload: { hint_type: 'eliminate_choice' } }));
  assert.doesNotThrow(() => Events.stamp('content_skipped', { surface: 'studio', language: 'fr', context, payload: { reason: 'skip_button' } }));
});
