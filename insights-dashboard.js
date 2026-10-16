// "How Polybot Understands You" (Phase 7, spec §19–24). Pure rendering: given the learner
// model and decisions from the local Insights service, return HTML. Every section answers
// three questions (spec §33): what does Polybot know, why does it think so, and how is that
// changing my practice? Confidence is shown in words, never as false precision (spec §22).
(function (root, factory) {
  const api = factory();
  root.PolybotDashboard = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = value => `${Math.round(Number(value) * 100)}%`;
  const TOP_SKILLS = ['vocabulary', 'grammar', 'pronunciation', 'listening_comprehension', 'reading_comprehension'];
  const HOURS = { early_morning: 'early morning', morning: 'in the morning', afternoon: 'in the afternoon', evening: 'in the evening', night: 'at night' };
  const PREFERENCE_NAMES = {
    practice_balance: 'Listening and reading vs speaking and writing', grammar_approach: 'How grammar is introduced',
    content_formats: 'Formats you engage with', interests: 'Interests', region: 'Region', accent: 'Accent',
    session_length_minutes: 'Session length', difficulty_preference: 'Challenge level', review_frequency: 'Amount of review',
    focus_skill: 'Skill to focus on', feedback_detail: 'Feedback detail'
  };
  const DECISION_NAMES = {
    next_skill_priority: 'Practising first', recommended_difficulty: 'Challenge level', review_needed: 'Review',
    recommended_session_length: 'Session length', recommended_exercise_count: 'Questions per round',
    recommended_content_type: 'Kinds of practice', recommended_topic: 'Topics', feedback_style: 'Feedback',
    explanation_style: 'Grammar explanations'
  };

  const chip = label => {
    const kind = /High/.test(label) ? 'high' : /Moderate/.test(label) ? 'moderate' : 'low';
    return `<span class="confidence-chip ${kind}">${esc(label)}</span>`;
  };
  const termOf = id => String(id || '').split(':').slice(1).join(':');

  function describeValue(key, value, topics = {}) {
    if (value === null || value === undefined) return '—';
    switch (key) {
      case 'practice_balance': return `${value}% speaking and writing`;
      case 'grammar_approach': return value > 60 ? 'Rules first' : value < 40 ? 'Examples first' : 'A mix of both';
      case 'session_length_minutes': return `About ${value} minutes`;
      case 'interests': return value.map(t => topics[t] || t).join(', ');
      case 'focus_skill': return String(value).replace(/[._]/g, ' ');
      default: return Array.isArray(value) ? value.join(', ') : String(value);
    }
  }

  function sparkline(points) {
    if (!points || points.length < 2) return '';
    const w = 120, h = 32, max = points.length - 1;
    const coords = points.map((p, i) => `${(i / max * w).toFixed(1)},${(h - 2 - p * (h - 4)).toFixed(1)}`).join(' ');
    return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" role="img" aria-label="Weekly accuracy from ${pct(points[0])} to ${pct(points[points.length - 1])}"><polyline points="${coords}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  function skillRow(skill, trend) {
    const measured = skill.mastery_score !== null && skill.mastery_score !== undefined;
    const evidence = `${skill.attempt_count} graded ${skill.attempt_count === 1 ? 'attempt' : 'attempts'}` +
      (skill.self_report_count ? ` · ${skill.self_report_count} self-rated` : '');
    const direction = skill.trend_per_week > 0.02 ? 'Improving' : skill.trend_per_week < -0.02 ? 'Dipping lately' : skill.trend_per_week !== null && skill.trend_per_week !== undefined ? 'Steady' : '';
    return `<div class="skill-row"><div class="skill-row-head"><strong>${esc(skill.skill_name)}</strong>${measured ? chip(skill.confidence_label) : '<span class="confidence-chip low">Not measured yet</span>'}</div>
      ${measured ? `<div class="mastery-bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(skill.mastery_score * 100)}" aria-label="${esc(skill.skill_name)} mastery"><span style="width:${Math.round(skill.mastery_score * 100)}%"></span></div>` : ''}
      <p class="skill-row-meta">${measured ? `${pct(skill.mastery_score)} mastery · ` : 'No graded exercises yet · '}${esc(evidence)}${direction ? ` · ${direction}` : ''}</p>${sparkline(trend)}</div>`;
  }

  function performance(model) {
    const p = model.profile || {};
    const skills = (model.skills || []).filter(s => TOP_SKILLS.includes(s.skill_id));
    const trends = {};
    for (const t of model.progress_trends || []) (trends[t.skill_id] = trends[t.skill_id] || []).push(t.accuracy);
    const estimate = p.proficiency_estimate !== null && p.proficiency_estimate !== undefined
      ? `<p class="big-number">${pct(p.proficiency_estimate)}</p><p>Overall estimate ${p.proficiency_band ? `· roughly ${esc(p.proficiency_band)}` : ''} ${chip(p.proficiency_confidence_label || 'Still learning')}</p><p class="muted">A rough estimate from your graded practice, not a test result.</p>`
      : '<p>Polybot needs a few graded answers before it can estimate your level.</p>';
    const list = (items, empty) => items.length ? `<ul>${items.map(s => `<li><strong>${esc(s.skill_name)}</strong> · ${pct(s.mastery_score)} ${chip(s.confidence_label)}</li>`).join('')}</ul>` : `<p class="muted">${empty}</p>`;
    return `<section class="card understanding-section" aria-labelledby="u-performance"><p class="eyebrow">01 · YOUR PROGRESS</p><h2 id="u-performance">How you are doing</h2>
      <div class="understanding-grid"><div>${estimate}
        <dl class="mini-stats"><div><dt>Remembering words days later</dt><dd>${p.retention_score !== null && p.retention_score !== undefined ? pct(p.retention_score) : 'Not enough repeats yet'}</dd></div>
        <div><dt>Practice consistency (4 weeks)</dt><dd>${p.consistency_score !== null && p.consistency_score !== undefined ? pct(p.consistency_score) : '—'}</dd></div>
        <div><dt>Total practice</dt><dd>${Math.round(p.total_practice_minutes || 0)} minutes</dd></div></dl></div>
        <div class="skill-list">${skills.map(s => skillRow(s, trends[s.skill_id])).join('') || '<p class="muted">No skills measured yet.</p>'}</div></div>
      <div class="understanding-grid two"><div><h3>Strengths</h3>${list(model.strengths || [], 'None Polybot is sure about yet.')}</div><div><h3>Areas to strengthen</h3>${list(model.weaker_areas || [], 'Nothing stands out as weaker right now.')}</div></div>
      ${(model.recurring_errors || []).length ? `<div><h3>Words that keep coming back</h3><p class="muted">Answered wrong at least twice in the last 4 weeks.</p><p class="word-chips">${model.recurring_errors.map(e => `<span>${esc(termOf(e.vocab_item_id))} <small>×${e.errors_28d}</small></span>`).join('')}</p></div>` : ''}</section>`;
  }

  function studyPatterns(model) {
    const s = model.study_patterns;
    if (!s || !s.sessions_count) return `<section class="card understanding-section" aria-labelledby="u-patterns"><p class="eyebrow">02 · HOW YOU STUDY</p><h2 id="u-patterns">Your study patterns</h2><p class="muted">No sessions in the last 4 weeks yet.</p></section>`;
    const weeks = (model.weekly_sessions || []).slice(-6);
    const maxSessions = Math.max(1, ...weeks.map(w => w.sessions));
    const bars = weeks.length ? `<div class="week-bars" role="img" aria-label="Sessions per week: ${weeks.map(w => w.sessions).join(', ')}">${weeks.map(w => `<span style="height:${Math.round(w.sessions / maxSessions * 100)}%" title="${esc(w.week_start)}: ${w.sessions} sessions"></span>`).join('')}</div>` : '';
    const rate = (value, words) => value === null || value === undefined ? 'Not enough data yet' : `${pct(value)} ${words}`;
    return `<section class="card understanding-section" aria-labelledby="u-patterns"><p class="eyebrow">02 · HOW YOU STUDY</p><h2 id="u-patterns">Your study patterns</h2>
      <p class="muted">Last 4 weeks. These describe habits; there is no right way to study.</p>
      <dl class="mini-stats wide">
        <div><dt>Typical session</dt><dd>${s.median_session_minutes !== null ? `About ${Math.round(s.median_session_minutes)} minutes` : '—'}</dd></div>
        <div><dt>How often</dt><dd>${s.sessions_count} sessions on ${s.active_days} days</dd></div>
        <div><dt>Usual time</dt><dd>${s.preferred_hour_bucket ? `Mostly ${HOURS[s.preferred_hour_bucket]}` : 'Not enough sessions yet to say'}</dd></div>
        <div><dt>Answer speed</dt><dd>${s.avg_response_time_ms ? `About ${(s.avg_response_time_ms / 1000).toFixed(1)} seconds per recall question` : '—'}</dd></div>
        <div><dt>Lessons finished</dt><dd>${rate(s.completion_rate, 'of lessons you started')}</dd></div>
        <div><dt>Hints</dt><dd>${rate(s.hint_rate, 'of questions')}</dd></div>
      </dl>${bars ? `<h3>Sessions per week</h3>${bars}` : ''}</section>`;
  }

  function preferences(model, topics) {
    const prefs = model.preferences || [];
    const told = prefs.filter(p => p.source === 'You told us');
    const seen = prefs.filter(p => p.source === 'Polybot observed');
    const row = p => `<li><strong>${esc(PREFERENCE_NAMES[p.preference_key] || p.preference_key)}</strong>: ${esc(describeValue(p.preference_key, p.value, topics))}
      ${p.source === 'Polybot observed' ? `${chip(p.confidence_label)}<p class="muted">${esc(p.detail)}</p>${p.is_effective ? '' : '<p class="muted">You told Polybot something different, so your choice is used.</p>'}` : ''}</li>`;
    return `<section class="card understanding-section" aria-labelledby="u-preferences"><p class="eyebrow">03 · PREFERENCES</p><h2 id="u-preferences">What you told us, and what Polybot observed</h2>
      <div class="understanding-grid two"><div><h3>You told us</h3>${told.length ? `<ul class="pref-list">${told.map(row).join('')}</ul>` : '<p class="muted">Nothing yet. Your Learning Method, Interests and Regions pages let you say how you like to practise.</p>'}</div>
      <div><h3>Polybot observed</h3>${seen.length ? `<ul class="pref-list">${seen.map(row).join('')}</ul>` : '<p class="muted">Not enough practice yet to notice patterns.</p>'}</div></div>
      <p class="muted">When the two disagree, your own choice always wins.</p></section>`;
  }

  function recommendationLabel(rec, helpers) {
    if (rec.target_type === 'lesson') return helpers.lessonTitle ? helpers.lessonTitle(rec.target_id) : rec.target_id;
    if (rec.target_type === 'vocab_item') return `Review “${termOf(rec.target_id)}”`;
    if (rec.target_type === 'skill') return `Practise ${String(rec.target_id).replace(/[._]/g, ' ')}`;
    return helpers.topics?.[rec.target_id] || rec.target_id;
  }

  function decisionsSection(decisions, helpers) {
    const list = (decisions && decisions.decisions) || [];
    const card = d => {
      const recs = (d.recommendations || []).slice(0, 4);
      return `<article class="decision-card"><div class="decision-head"><h3>${esc(DECISION_NAMES[d.decision_type] || d.decision_type)}</h3>${d.follows_learner_choice ? '<span class="confidence-chip high">Your choice</span>' : chip(d.confidence_label)}</div>
        <p><strong>Why:</strong> ${esc(d.reason)}</p><p><strong>What changes:</strong> ${esc(d.adaptation)}</p>
        ${recs.length ? `<div class="decision-recs">${recs.map(r => `<button type="button" class="button small" data-action="open-recommendation" data-id="${esc(r.recommendation_id)}" data-decision="${esc(d.decision_id)}" data-target-type="${esc(r.target_type)}" data-target-id="${esc(r.target_id)}">${esc(recommendationLabel(r, helpers))}</button>`).join('')}</div>` : ''}
        <details><summary>How Polybot decided</summary><p class="muted">Rule ${esc(d.rule_id)} (v${esc(d.rule_version)}): ${esc(d.rule_description || '')}</p><p class="muted">Based on: ${esc(Object.entries(d.source_metrics || {}).map(([k, v]) => `${k.replace(/_/g, ' ')} ${Array.isArray(v) ? v.join(', ') : v}`).join(' · '))}</p></details></article>`;
    };
    return `<section class="card understanding-section" aria-labelledby="u-decisions"><p class="eyebrow">04 · HOW POLYBOT ADAPTS</p><h2 id="u-decisions">What Polybot is doing for you</h2>
      ${list.length ? `<div class="decision-grid">${list.map(card).join('')}</div>` : '<p class="muted">No adjustments yet. They appear once Polybot has enough practice to go on.</p>'}
      <p class="muted">Want something different? Change it in Your Learning Method, Interests or Settings, and your choice takes priority.</p></section>`;
  }

  // data: { model, decisions, sample }  helpers: { lessonTitle(id), topics }
  function render(data, helpers = {}) {
    const model = data.model;
    const banner = data.sample || model.simulated
      ? '<p class="inline-note sample-note"><strong>Sample data.</strong> This is a simulated learner, shown so you can see how the page works. It is not about you.</p>' : '';
    return `<div class="understanding-page">${banner}
      <header class="page-heading"><div><p class="eyebrow">YOUR LEARNING PROFILE</p><h1>How Polybot understands you</h1><p class="subtitle">What Polybot has learned from your ${esc(helpers.languageName || model.language || '')} practice, how sure it is, and how it is adapting.</p></div>
      ${data.sample ? '' : '<button type="button" class="button small" data-action="understanding-refresh">Refresh</button>'}</header>
      ${performance(model)}${studyPatterns(model)}${preferences(model, helpers.topics || {})}${decisionsSection(data.decisions, helpers)}
      <p class="muted understanding-footnote">Everything here is computed by Polybot Insights on this computer from your practice. Polybot never labels you with a learning style. You can turn Insights off in Settings at any time.</p></div>`;
  }

  function emptyState(kind, detail = '') {
    const messages = {
      preview: ['Available in the installed extension', 'Your learning profile is built from practice recorded by the installed extension.'],
      off: ['Polybot Insights is off', 'Turn on Polybot Insights in Settings to let Polybot learn from your practice on this computer.'],
      unreachable: ['The Insights service is not running', 'Start it with python -m polybot_insights.api (see insights/README.md), then refresh.'],
      no_data: ['Nothing to show yet', 'Practise a little, then run the Insights pipeline and learner model. Your profile appears here afterwards.'],
      error: ['Your profile could not be loaded', detail || 'Please try again.']
    };
    const [title, text] = messages[kind] || messages.error;
    const actions = `${kind === 'off' ? '<button type="button" class="button primary" data-action="open-settings">Open Settings</button>' : ''}${kind !== 'preview' && kind !== 'off' ? '<button type="button" class="button" data-action="understanding-refresh">Refresh</button>' : ''}<button type="button" class="button" data-action="understanding-sample">See a sample profile</button>`;
    return `<div class="understanding-page"><header class="page-heading"><div><p class="eyebrow">YOUR LEARNING PROFILE</p><h1>How Polybot understands you</h1></div></header>
      <section class="card understanding-empty"><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="flex-row">${actions}</div></section></div>`;
  }

  // Recommendations actually displayed, so the studio can record recommendation_shown.
  function shownRecommendations(decisions) {
    const out = [];
    for (const d of (decisions && decisions.decisions) || []) {
      (d.recommendations || []).slice(0, 4).forEach(r => out.push({ recommendation_id: r.recommendation_id, decision_id: d.decision_id, rank: r.rank }));
    }
    return out;
  }

  const SAMPLE = {
    sample: true,
    model: {
      learner_id: 'sample', language: 'es', simulated: true,
      profile: { as_of_date: '2026-10-14', proficiency_estimate: 0.71, proficiency_band: 'B2', proficiency_confidence: 0.62,
        proficiency_confidence_label: 'Moderate confidence', retention_score: 0.78, consistency_score: 0.69, days_since_last_practice: 0, total_practice_minutes: 412 },
      skills: [
        { skill_id: 'vocabulary', skill_name: 'Vocabulary', mastery_score: 0.81, attempt_count: 214, self_report_count: 46, trend_per_week: 0.031, confidence_label: 'High confidence' },
        { skill_id: 'pronunciation', skill_name: 'Pronunciation', mastery_score: 0.58, attempt_count: 23, self_report_count: 9, trend_per_week: 0.012, confidence_label: 'Moderate confidence' },
        { skill_id: 'grammar', skill_name: 'Grammar', mastery_score: null, attempt_count: 0, self_report_count: 7, trend_per_week: null, confidence_label: 'Still learning' },
        { skill_id: 'listening_comprehension', skill_name: 'Listening comprehension', mastery_score: null, attempt_count: 0, self_report_count: 12, trend_per_week: null, confidence_label: 'Still learning' }
      ],
      strengths: [{ skill_id: 'vocabulary', skill_name: 'Vocabulary', mastery_score: 0.81, confidence_label: 'High confidence' }],
      weaker_areas: [{ skill_id: 'pronunciation', skill_name: 'Pronunciation', mastery_score: 0.58, confidence_label: 'Moderate confidence' }],
      study_patterns: { sessions_count: 17, active_days: 15, median_session_minutes: 14, avg_session_minutes: 16.2, preferred_hour_bucket: 'evening',
        avg_response_time_ms: 2600, completion_rate: 0.74, revisit_rate: 0.12, hint_rate: 0.09 },
      preferences: [
        { preference_key: 'practice_balance', value: 60, source: 'You told us', is_effective: true },
        { preference_key: 'interests', value: ['cooking', 'travel-planning'], source: 'You told us', is_effective: true },
        { preference_key: 'practice_balance', value: 31, source: 'Polybot observed', confidence_label: 'High confidence', is_effective: false,
          detail: '58 of your last 187 practice actions were speaking or writing (31% output) over the past 28 days.' },
        { preference_key: 'content_formats', value: ['reading', 'speaking'], source: 'Polybot observed', confidence_label: 'High confidence', is_effective: true,
          detail: 'Most of your recent activity used these formats: reading 52%, speaking 29% (of 126 format-specific actions in 28 days).' }
      ],
      progress_trends: [
        { skill_id: 'vocabulary', accuracy: 0.62 }, { skill_id: 'vocabulary', accuracy: 0.68 }, { skill_id: 'vocabulary', accuracy: 0.74 }, { skill_id: 'vocabulary', accuracy: 0.81 },
        { skill_id: 'pronunciation', accuracy: 0.52 }, { skill_id: 'pronunciation', accuracy: 0.55 }, { skill_id: 'pronunciation', accuracy: 0.58 }
      ],
      recurring_errors: [{ vocab_item_id: 'es:aprovechar', errors_28d: 3 }, { vocab_item_id: 'es:desarrollar', errors_28d: 2 }],
      weekly_sessions: [{ week_start: '2026-09-21', sessions: 3 }, { week_start: '2026-09-28', sessions: 5 }, { week_start: '2026-10-05', sessions: 4 }, { week_start: '2026-10-12', sessions: 5 }]
    },
    decisions: { decisions: [
      { decision_id: 'd1', decision_type: 'next_skill_priority', reason: 'Pronunciation accuracy is 58% across your graded attempts (23 so far), below the 70% target.',
        adaptation: 'Upcoming practice puts Pronunciation first until it passes 70%.', confidence_label: 'Moderate confidence', follows_learner_choice: false,
        rule_id: 'LOW_SKILL_ACCURACY', rule_version: 1, rule_description: 'Lowest-mastery skill with first-try accuracy below 70% over at least 10 graded attempts.',
        source_metrics: { accuracy: 0.58, attempt_count: 23, threshold: 0.7 }, recommendations: [{ recommendation_id: 'r1', target_type: 'skill', target_id: 'pronunciation', rank: 1 }] },
      { decision_id: 'd2', decision_type: 'recommended_content_type', reason: 'You wanted about 60% speaking and writing, but recently it has been 31%.',
        adaptation: 'More speaking and writing practice is suggested to match the balance you chose.', confidence_label: 'High confidence', follows_learner_choice: false,
        rule_id: 'PRACTICE_BALANCE_GAP', rule_version: 1, rule_description: "Observed input/output balance differs from the learner's chosen balance by 20 points or more.",
        source_metrics: { explicit_practice_balance: 60, observed_output_share: 31 }, recommendations: [] },
      { decision_id: 'd3', decision_type: 'review_needed', reason: '3 words were answered wrong at least twice on the first try in the last 4 weeks.',
        adaptation: 'Those words come back first in Quick Recall.', confidence_label: 'Moderate confidence', follows_learner_choice: false,
        rule_id: 'RECURRING_ERRORS', rule_version: 1, rule_description: 'Three or more words answered wrong twice or more in 4 weeks.',
        source_metrics: { recurring_error_words: 3 }, recommendations: [{ recommendation_id: 'r2', target_type: 'vocab_item', target_id: 'es:aprovechar', rank: 1 }] },
      { decision_id: 'd4', decision_type: 'recommended_topic', reason: 'You picked Cooking, Travel planning as interests.',
        adaptation: 'Example sentences and practice scenarios will use these topics as topic-tagged content is added.', confidence_label: 'High confidence', follows_learner_choice: true,
        rule_id: 'EXPLICIT_INTERESTS', rule_version: 1, rule_description: 'The learner picked interests.', source_metrics: { explicit_topics: ['cooking', 'travel-planning'] }, recommendations: [] }
    ] }
  };

  return { render, emptyState, shownRecommendations, describeValue, SAMPLE, _test: { esc, sparkline } };
});
