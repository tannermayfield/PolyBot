const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'personalization-interests.js'), 'utf8');

function setup(saved, failWrites = false) {
  let stored = saved;
  const notifications = [];
  const context = { window: { localStorage: {
    getItem: () => stored,
    setItem: (_key, value) => { if (failWrites) throw new Error('Quota exceeded'); stored = value; }
  } } };
  vm.runInNewContext(source, context);
  const nodes = new Map();
  const events = {};
  const page = {
    matches: () => true,
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, { textContent: '', innerHTML: '', value: '', classList: { toggle() {} } });
      return nodes.get(selector);
    },
    querySelectorAll: () => [],
    contains: () => true,
    addEventListener: (name, handler) => { events[name] = handler; }
  };
  context.window.PersonalizationInterests.mount(page, { notify: (...args) => notifications.push(args) });
  return {
    nodes, notifications, html: context.window.PersonalizationInterests.render(),
    saved: () => JSON.parse(stored),
    click(id, attribute) {
      const button = { dataset: { interest: id }, hasAttribute: name => name === attribute };
      events.click({ target: { closest: () => button } });
    },
    search(value) { events.input({ target: { id: 'interest-search', value } }); },
    category(value) { events.change({ target: { id: 'interest-category', value } }); }
  };
}

test('enforces ten interests, supports removal at the limit, and persists selection', () => {
  const app = setup();
  const choices = ['cooking', 'baking', 'coffee-tea', 'restaurants', 'street-food', 'vegetarian-food', 'wine-drinks', 'food-traditions', 'city-breaks', 'road-trips'];
  choices.forEach(id => app.click(id));
  assert.deepEqual(app.saved().selected, choices);
  app.click('backpacking');
  assert.equal(app.saved().selected.length, 10);
  assert.match(app.nodes.get('[data-interest-save-status]').textContent, /Remove one/);
  app.click('cooking');
  app.click('backpacking');
  assert.equal(app.saved().selected.length, 10);
  assert.ok(app.saved().selected.includes('backpacking'));
  assert.ok(!app.saved().selected.includes('cooking'));
});

test('restores known IDs and rejects malformed or unsupported saved data', () => {
  const app = setup(JSON.stringify({ version: 1, selected: ['cooking', 'unknown', 'cooking', '<script>'] }));
  assert.equal(app.nodes.get('[data-interest-count]').textContent, '1 / 10 selected');
  for (const raw of ['{invalid', JSON.stringify({ selected: ['cooking'] }), JSON.stringify({ version: 1, selected: 'cooking' })]) {
    const invalid = setup(raw);
    assert.equal(invalid.nodes.get('[data-interest-count]').textContent, '0 / 10 selected');
    assert.match(invalid.nodes.get('[data-interest-save-status]').textContent, /could not be read/);
  }
});

test('failed writes leave the previous selection intact and show an error', () => {
  const app = setup(JSON.stringify({ version: 1, selected: ['cooking'] }), true);
  app.click('baking');
  assert.deepEqual(app.saved().selected, ['cooking']);
  assert.equal(app.nodes.get('[data-interest-count]').textContent, '1 / 10 selected');
  assert.match(app.nodes.get('[data-interest-save-status]').textContent, /previous selection is unchanged/);
  assert.equal(app.notifications[0][1], true);
});

test('filters combine category and search; no matches offer reset; clearing persists', () => {
  const app = setup(JSON.stringify({ version: 1, selected: ['cooking'] }));
  assert.match(app.nodes.get('[data-interest-results]').textContent, /88 interests/);
  app.search('COOKING');
  assert.equal(app.nodes.get('[data-interest-results]').textContent, '1 interest to explore');
  app.category('category-1');
  assert.match(app.nodes.get('[data-interest-categories]').innerHTML, /No interests found/);
  app.click(null, 'data-interest-reset');
  assert.match(app.nodes.get('[data-interest-results]').textContent, /88 interests/);
  app.click(null, 'data-interest-clear');
  assert.deepEqual(app.saved().selected, []);
  assert.match(app.nodes.get('[data-interest-selected]').innerHTML, /Pick a few interests/);
});

test('unknown selections cannot be persisted', () => {
  const app = setup(JSON.stringify({ version: 1, selected: [] }));
  app.click('invented-interest');
  assert.deepEqual(app.saved().selected, []);
});
