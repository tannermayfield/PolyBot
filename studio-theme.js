/* Applies the saved studio theme before the page paints. */
(() => {
  'use strict';
  const KEY = 'polybotTheme';
  const choices = new Set(['light', 'dark', 'system']);
  const media = matchMedia('(prefers-color-scheme: dark)');

  function stored() {
    try { const value = (localStorage.getItem(KEY) ?? localStorage.getItem(KEY.replace('polybot', 'giftOfTongues'))); return choices.has(value) ? value : 'system'; }
    catch (_) { return 'system'; }
  }
  function apply(preference = stored(), persist = true) {
    if (!choices.has(preference)) preference = 'system';
    if (persist) { try { localStorage.setItem(KEY, preference); } catch (_) { /* StudioData remains authoritative. */ } }
    const effective = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = effective;
    document.documentElement.dataset.themePreference = preference;
    document.documentElement.style.colorScheme = effective;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', effective === 'dark' ? '#17161d' : '#f7f6f2');
    return effective;
  }

  media.addEventListener?.('change', () => {
    if (document.documentElement.dataset.themePreference === 'system') apply('system', false);
  });
  apply(stored(), false);
  window.StudioTheme = { apply, getPreference: stored };
})();
