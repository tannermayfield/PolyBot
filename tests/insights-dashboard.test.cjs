'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Dash = require('../insights-dashboard.js');

const clone = value => structuredClone(value);

test('the sample renders every section and says it is simulated', () => {
  const html = Dash.render(Dash.SAMPLE, { lessonTitle: id => `Lesson ${id}`, topics: { cooking: 'Cooking' } });
  for (const heading of ['How you are doing', 'Your study patterns', 'What you told us, and what Polybot observed', 'What Polybot is doing for you']) {
    assert.ok(html.includes(heading), heading);
  }
  assert.match(html, /Sample data\./);
  assert.match(html, /not a test result/);
  assert.match(html, /never labels you with a learning style/);
});

test('unmeasured skills say so instead of showing zero', () => {
  const html = Dash.render(Dash.SAMPLE);
  const grammar = html.slice(html.indexOf('<strong>Grammar</strong>'), html.indexOf('<strong>Grammar</strong>') + 400);
  assert.match(grammar, /Not measured yet/);
  assert.match(grammar, /No graded exercises yet/);
  assert.doesNotMatch(grammar, /0% mastery/);
});

test('inferred preferences show confidence in words and yield to the learner', () => {
  const html = Dash.render(Dash.SAMPLE);
  assert.match(html, /High confidence/);
  assert.match(html, /your choice is used/, 'an overridden observation is labelled');
  assert.match(html, /Your choice<\/span>/, 'decisions that follow the learner are badged');
});

test('everything from the service is escaped', () => {
  const data = clone(Dash.SAMPLE);
  data.sample = false;
  data.model.simulated = false;
  data.decisions.decisions[0].reason = '<img src=x onerror=alert(1)>';
  data.model.skills[0].skill_name = '<script>bad()</script>';
  data.model.recurring_errors[0].vocab_item_id = 'es:<b>x</b>';
  const html = Dash.render(data);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>bad/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /Sample data\./, 'real data has no sample banner');
});

test('preferred time and patterns degrade honestly without enough data', () => {
  const data = clone(Dash.SAMPLE);
  data.model.study_patterns.preferred_hour_bucket = null;
  data.model.study_patterns.completion_rate = null;
  const html = Dash.render(data);
  assert.match(html, /Not enough sessions yet to say/);
  assert.match(html, /Not enough data yet/);
  data.model.study_patterns = null;
  assert.match(Dash.render(data), /No sessions in the last 4 weeks yet/);
});

test('recommendations become buttons and are listed for recommendation_shown', () => {
  const html = Dash.render(Dash.SAMPLE, { lessonTitle: () => 'Talking about past events' });
  assert.match(html, /data-action="open-recommendation" data-id="r1" data-decision="d1" data-target-type="skill" data-target-id="pronunciation"/);
  assert.match(html, /Review “aprovechar”/);
  assert.deepEqual(Dash.shownRecommendations(Dash.SAMPLE.decisions), [
    { recommendation_id: 'r1', decision_id: 'd1', rank: 1 }, { recommendation_id: 'r2', decision_id: 'd3', rank: 1 }]);
});

test('empty states explain the next step', () => {
  assert.match(Dash.emptyState('off'), /Turn on Polybot Insights in Settings/);
  assert.match(Dash.emptyState('off'), /data-action="open-settings"/);
  assert.match(Dash.emptyState('unreachable'), /python -m polybot_insights.api/);
  assert.match(Dash.emptyState('no_data'), /Nothing to show yet/);
  assert.match(Dash.emptyState('error', '<x>'), /&lt;x&gt;/);
  for (const kind of ['preview', 'off', 'unreachable', 'no_data']) assert.match(Dash.emptyState(kind), /understanding-sample/);
});

test('preference values read naturally', () => {
  assert.equal(Dash.describeValue('practice_balance', 70), '70% speaking and writing');
  assert.equal(Dash.describeValue('grammar_approach', 80), 'Rules first');
  assert.equal(Dash.describeValue('interests', ['cooking', 'chess'], { cooking: 'Cooking' }), 'Cooking, chess');
  assert.equal(Dash.describeValue('session_length_minutes', 12), 'About 12 minutes');
});

test('the sparkline describes its trend for screen readers', () => {
  assert.match(Dash._test.sparkline([0.5, 0.75]), /aria-label="Weekly accuracy from 50% to 75%"/);
  assert.equal(Dash._test.sparkline([0.5]), '');
});
