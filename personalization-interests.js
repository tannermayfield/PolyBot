(function () {
  'use strict';

  const STORAGE_KEY = 'polybotInterests';
  const LIMIT = 10;
  const store = () => window.PolybotPrefs || window.localStorage;
  const CATEGORIES = [
    ['Food & drink', 'Cooking', 'Baking', 'Coffee & tea', 'Restaurants', 'Street food', 'Vegetarian food', 'Wine & drinks', 'Food traditions'],
    ['Travel & places', 'City breaks', 'Road trips', 'Backpacking', 'Beaches', 'Architecture', 'Local culture', 'Travel planning', 'Museums'],
    ['Arts & creativity', 'Photography', 'Drawing & painting', 'Design', 'Crafts & making', 'Creative writing', 'Fashion', 'Theater', 'Dance'],
    ['Music & entertainment', 'Live music', 'Playing instruments', 'Pop music', 'Latin music', 'Film', 'TV series', 'Comedy', 'Podcasts'],
    ['Sports & movement', 'Soccer', 'Basketball', 'Tennis', 'Running', 'Cycling', 'Swimming', 'Yoga', 'Strength training'],
    ['Nature & outdoors', 'Hiking', 'Camping', 'Gardening', 'Wildlife', 'Birdwatching', 'Oceans', 'Sustainability', 'Adventure sports'],
    ['Science & technology', 'Space', 'Biology', 'Psychology', 'Computers', 'Programming', 'Artificial intelligence', 'Engineering', 'Inventions'],
    ['Books & ideas', 'Fiction', 'Fantasy & science fiction', 'Mystery stories', 'Poetry', 'History', 'Philosophy', 'Languages', 'Current events'],
    ['Work & ambitions', 'Business', 'Entrepreneurship', 'Marketing', 'Education', 'Healthcare', 'Career development', 'Personal finance', 'Remote work'],
    ['Everyday life', 'Family', 'Friendship', 'Pets', 'Home & interiors', 'Shopping', 'Wellness', 'Community', 'Daily routines'],
    ['Games & hobbies', 'Video games', 'Board games', 'Puzzles', 'Chess', 'Collecting', 'DIY projects', 'Cars & motorcycles', 'Animation & comics']
  ].map(([name, ...labels], index) => ({
    name,
    id: `category-${index}`,
    items: labels.map(label => ({ id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, ''), label }))
  }));
  const ITEMS = new Map(CATEGORIES.flatMap(category => category.items.map(item => [item.id, item])));
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function chip(item, selected, remove) {
    return `<button type="button" class="interest-chip${selected ? ' is-selected' : ''}" data-interest="${item.id}"${remove ? ` aria-label="Remove ${escape(item.label)}"` : ` aria-pressed="${selected}"`}><span>${escape(item.label)}</span><span class="interest-chip-mark" aria-hidden="true">${remove ? '×' : selected ? '✓' : '+'}</span></button>`;
  }

  function render() {
    return `<section class="interests-page" aria-labelledby="interests-title">
      <div class="page-heading"><div><p class="eyebrow">Personalization</p><h1 id="interests-title">Your Interests</h1><p class="subtitle">Make room for the things you love. Choose up to 10 interests for future example sentences and practice scenarios.</p></div><a class="button" href="#home">Back to home</a></div>
      <section class="card interests-selection" aria-labelledby="interests-selection-title"><div class="interests-selection-head"><div><h2 id="interests-selection-title">Your collection</h2><p>Mix familiar favorites with something you’re curious about.</p></div><span class="interest-count" data-interest-count>0 / 10 selected</span></div><div class="interest-selected-list" data-interest-selected></div><div class="interests-selection-foot"><p data-interest-save-status role="status" aria-live="polite">Preferences are saved on this device.</p><button class="text-button" type="button" data-interest-clear>Clear selection</button></div></section>
      <div class="interests-filters"><div><label for="interest-search">Find an interest</label><input type="search" id="interest-search" placeholder="Try cooking, music, or hiking…" autocomplete="off"></div><div><label for="interest-category">Browse a category</label><select id="interest-category"><option value="all">All categories</option>${CATEGORIES.map(category => `<option value="${category.id}">${escape(category.name)}</option>`).join('')}</select></div></div>
      <p class="interest-results-count" data-interest-results role="status" aria-live="polite"></p><div class="interests-categories" data-interest-categories></div>
      <p class="interests-footnote">These preferences are saved for personalization. They don’t change existing lessons yet. You can update your selection any time.</p>
    </section>`;
  }

  function mount(root, ctx = {}) {
    const page = root.matches?.('.interests-page') ? root : root.querySelector('.interests-page');
    if (!page) return;
    let selected = new Set();
    let query = '';
    let categoryFilter = 'all';
    let storageIssue = '';
    const status = page.querySelector('[data-interest-save-status]');
    try {
      const raw = (store().getItem(STORAGE_KEY) ?? store().getItem(STORAGE_KEY.replace('polybot', 'giftOfTongues')));
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved?.version !== 1 || !Array.isArray(saved.selected)) throw new Error('Invalid interests');
        selected = new Set(saved.selected.filter(id => typeof id === 'string' && ITEMS.has(id)).slice(0, LIMIT));
      }
    } catch (_) {
      storageIssue = 'Saved interests could not be read. Choose your interests to start a new selection.';
    }

    function announce(message, error = false) {
      status.textContent = message;
      status.classList.toggle('interest-save-error', error);
    }
    function updateSelection() {
      page.querySelector('[data-interest-count]').textContent = `${selected.size} / ${LIMIT} selected`;
      page.querySelector('[data-interest-selected]').innerHTML = selected.size
        ? [...selected].map(id => chip(ITEMS.get(id), true, true)).join('')
        : '<p class="interest-selection-empty">Your collection is waiting. Pick a few interests below to begin.</p>';
      page.querySelector('[data-interest-clear]').disabled = !selected.size;
      page.querySelectorAll('[data-interest-categories] [data-interest]').forEach(button => {
        const active = selected.has(button.dataset.interest);
        button.classList.toggle('is-selected', active);
        button.setAttribute('aria-pressed', String(active));
        button.querySelector('.interest-chip-mark').textContent = active ? '✓' : '+';
      });
    }
    function drawCategories() {
      const groups = CATEGORIES.filter(category => categoryFilter === 'all' || categoryFilter === category.id).map(category => ({
        ...category,
        items: category.items.filter(item => `${item.label} ${category.name}`.toLowerCase().includes(query))
      })).filter(category => category.items.length);
      const count = groups.reduce((sum, category) => sum + category.items.length, 0);
      page.querySelector('[data-interest-results]').textContent = `${count} ${count === 1 ? 'interest' : 'interests'} to explore`;
      page.querySelector('[data-interest-categories]').innerHTML = groups.length
        ? groups.map(category => `<section class="card interest-category" aria-labelledby="${category.id}"><div class="interest-category-heading"><h2 id="${category.id}">${escape(category.name)}</h2><span>${category.items.length} interests</span></div><div class="interest-options">${category.items.map(item => chip(item, selected.has(item.id), false)).join('')}</div></section>`).join('')
        : '<div class="card empty-state"><h3>No interests found</h3><p>Try another search or explore all categories.</p><button type="button" class="button" data-interest-reset>Reset filters</button></div>';
    }
    function save(next) {
      try {
        const previous = [...selected];
        store().setItem(STORAGE_KEY, JSON.stringify({ version: 1, selected: [...next] }), () => {
          selected = new Set(previous);
          updateSelection();
          announce('Could not save your changes. Your previous selection is unchanged. Please try again.', true);
        });
        selected = next;
        if (previous.join() !== [...next].join()) window.PolybotEvents?.record('preference_set', { language: ctx.target?.code, payload: { preference_key: 'interests', value: [...next], stated_via: 'settings', previous_value: previous } });
        updateSelection();
        announce(selected.size === LIMIT ? 'All 10 spots filled. Remove an interest to choose another.' : 'Preferences saved on this device.');
      } catch (_) {
        announce('Could not save your changes. Your previous selection is unchanged. Please try again.', true);
        ctx.notify?.('Could not save your interests on this device.', true);
      }
    }
    function click(event) {
      const button = event.target.closest('button');
      if (!button || !page.contains(button)) return;
      if (button.hasAttribute('data-interest-clear')) { save(new Set()); return; }
      if (button.hasAttribute('data-interest-reset')) {
        query = ''; categoryFilter = 'all';
        page.querySelector('#interest-search').value = '';
        page.querySelector('#interest-category').value = 'all';
        drawCategories(); return;
      }
      const id = button.dataset.interest;
      if (!ITEMS.has(id)) return;
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else if (next.size < LIMIT) next.add(id);
      else { announce('You’ve selected 10 interests. Remove one before adding another.', true); return; }
      save(next);
    }
    function input(event) {
      if (event.target.id !== 'interest-search') return;
      query = event.target.value.trim().toLowerCase();
      drawCategories();
    }
    function change(event) {
      if (event.target.id !== 'interest-category') return;
      categoryFilter = event.target.value;
      drawCategories();
    }
    page.addEventListener('click', click);
    page.addEventListener('input', input);
    page.addEventListener('change', change);
    drawCategories();
    updateSelection();
    if (storageIssue) announce(storageIssue, true);
  }

  window.PersonalizationInterests = { render, mount, CATEGORIES };
})();
