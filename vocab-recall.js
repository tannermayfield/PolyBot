// Quick recall: multiple-choice vocabulary recall from the learner's own words
// (ADR-004, ADR-017). This module builds questions and scores answers; studio.js
// draws them. It is Polybot's first gradable exercise, so every answer is an
// objective answer_submitted event (EVENT_TAXONOMY §3.2).
(function (root, factory) {
  const api = factory();
  root.VocabRecall = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MIN_WORDS = 4;
  const CHOICES = 4;
  const TYPES = { forward: 'vocab_recall_choice', reverse: 'vocab_recall_reverse_choice' };
  const norm = value => String(value || '').trim().toLowerCase();

  // Words with a saved meaning, one per term and one per meaning, so no question
  // can have two correct answers.
  function eligibleWords(words) {
    const terms = new Set(), meanings = new Set(), out = [];
    for (const word of words || []) {
      const term = norm(word.word), meaning = norm(word.meaning);
      if (!term || !meaning || terms.has(term) || meanings.has(meaning)) continue;
      terms.add(term); meanings.add(meaning); out.push(word);
    }
    return out;
  }

  function readiness(words) {
    const count = eligibleWords(words).length;
    return { ready: count >= MIN_WORDS, count, needed: Math.max(0, MIN_WORDS - count) };
  }

  function shuffle(items, rng) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  // direction: 'forward' shows the word and asks for its meaning; 'reverse' shows the
  // meaning and asks for the word. Omitted = chosen at random.
  function buildQuestion(words, { language, direction, avoidId, rng = Math.random, now = Date.now() } = {}) {
    const pool = eligibleWords(words);
    if (pool.length < MIN_WORDS) return null;
    const candidates = pool.length > MIN_WORDS && avoidId ? pool.filter(w => w.id !== avoidId) : pool;
    const target = candidates[Math.floor(rng() * candidates.length)];
    const distractors = shuffle(pool.filter(w => w.id !== target.id), rng).slice(0, CHOICES - 1);
    const dir = direction || (rng() < 0.5 ? 'forward' : 'reverse');
    const label = w => (dir === 'forward' ? w.meaning : w.word);
    const choices = shuffle([target, ...distractors], rng).map(w => ({ id: w.id, label: label(w), correct: w.id === target.id }));
    const vocabItemId = `${language}:${norm(target.word)}`;
    return {
      exerciseType: TYPES[dir], direction: dir, wordId: target.id,
      prompt: dir === 'forward' ? target.word : target.meaning,
      choices, vocabItemId, exerciseId: `${TYPES[dir]}:${vocabItemId}`,
      shownAt: now, lastAnswerAt: now, attempts: 0, hintsUsed: 0, eliminated: [], solved: false, picked: []
    };
  }

  // Removes one wrong, not-yet-picked choice. Returns the new question state, or the
  // same one when only one wrong choice is left (two choices must remain).
  function useHint(question, rng = Math.random) {
    const remaining = question.choices.filter(c => !question.eliminated.includes(c.id));
    const removable = remaining.filter(c => !c.correct && !question.picked.includes(c.id));
    if (question.solved || remaining.length <= 2 || !removable.length) return question;
    const drop = removable[Math.floor(rng() * removable.length)];
    return { ...question, hintsUsed: question.hintsUsed + 1, eliminated: [...question.eliminated, drop.id] };
  }

  // Scores one pick and returns the updated question plus the event payload.
  function answer(question, choiceId, now = Date.now()) {
    const choice = question.choices.find(c => c.id === choiceId);
    if (!choice || question.solved || question.eliminated.includes(choiceId) || question.picked.includes(choiceId)) return null;
    const visible = question.choices.length - question.eliminated.length;
    const attempt = question.attempts + 1;
    const payload = {
      exercise_type: question.exerciseType, is_correct: choice.correct,
      response_time_ms: Math.max(0, Math.min(3600000, Math.round(now - question.lastAnswerAt))),
      attempt_number: attempt, hints_used: question.hintsUsed, choice_count: visible
    };
    const next = { ...question, attempts: attempt, lastAnswerAt: now, solved: choice.correct, picked: [...question.picked, choiceId] };
    return { question: next, payload };
  }

  // Why the learner left a question that was never answered correctly
  // ('skip' = the Skip button, 'close' = leaving the exercise).
  function skipReason(question, how) {
    if (!question || question.solved) return null;
    return how === 'close' ? 'closed_early' : 'skip_button';
  }

  return { MIN_WORDS, TYPES, eligibleWords, readiness, buildQuestion, useHint, answer, skipReason };
});
