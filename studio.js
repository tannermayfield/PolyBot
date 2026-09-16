/* Spanish shadowing studio: vanilla JS, local recordings, explicit cloud assessment. */
(() => {
'use strict';
const D = window.StudioData, A = window.StudioAudio;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {
sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
wave:'<path d="M3 10v4m4-8v12m5-16v20m5-16v12m4-9v6"/>',
library:'<path d="M4 4h4v16H4zM10 4h4v16h-4zM17 4l4 15-3 1-4-15z"/>',
headphones:'<path d="M4 13v-1a8 8 0 0 1 16 0v1M4 12H3v7h4v-7zm16 0h1v7h-4v-7z"/>',
cards:'<rect x="5" y="6" width="15" height="15" rx="2"/><path d="M15 3H4a2 2 0 0 0-2 2v11m7-5h7m-7 4h4"/>',
chart:'<path d="M4 3v17h17M8 16v-4m5 4V8m5 8V5"/>',
settings:'<path d="m10 3-.6 2.2-2 .9-2-.6-2 3.4L5 10.5v2.3l-1.6 1.6 2 3.4 2-.6 2 .9.6 2.2h4l.6-2.2 2-.9 2 .6 2-3.4-1.6-1.6v-2.3l1.6-1.6-2-3.4-2 .6-2-.9L14 3z"/><circle cx="12" cy="11.8" r="3"/>',
external:'<path d="M14 3h7v7m0-7L10 14m0-10H4v16h16v-6"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',plus:'<path d="M12 4v16M4 12h16"/>',
play:'<path d="m8 4 12 8-12 8z" fill="currentColor" stroke="none"/>',pause:'<path d="M8 5v14m8-14v14" stroke-width="4"/>',stop:'<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
mic:'<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',edit:'<path d="m14 4 6 6m-1-8 3 3-14 14-6 2 2-6z"/>',trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',close:'<path d="m5 5 14 14M5 19 19 5"/>',loop:'<path d="m4 3-3 4 3 4M1 7h16a4 4 0 0 1 4 4m-1 10 3-4-3-4m3 4H7a4 4 0 0 1-4-4"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',check:'<path d="m5 12 4 4L19 6"/>',upload:'<path d="M12 16V2m-5 5 5-5 5 5M3 15v6h18v-6"/>',download:'<path d="M12 2v14m-5-5 5 5 5-5M3 15v6h18v-6"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v1"/>',lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/>',globe:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',refresh:'<path d="M20 7v5h-5m-11 5v-5h5m10-1a7 7 0 0 0-12-5m-2 7a7 7 0 0 0 12 5"/>'};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.wave}</svg>`;
const btn = (action, label, name, variant = '', attrs = '') => `<button type="button" class="button ${variant}" data-action="${action}" ${attrs}>${name ? icon(name) : ''}${label}</button>`;
const note = (text, kind = '') => `<div class="inline-note ${kind}">${icon('info')}<span>${text}</span></div>`;
const empty = (title, text, action = '') => `<div class="empty-state"><div class="empty-icon">${icon('wave')}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
const heading = (title, subtitle, action = '', eyebrow = 'YOUR SPANISH STUDIO') => `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>${action}</div>`;
const pages = {today:'Today',practice:'Practice',library:'Library',voices:'Voices & accents',review:'Flashcards',progress:'Progress'};
let state, page = 'today', operation = false, toastTimer, pendingReload = 0;
const ui = {search:'',source:'all',profiles:[],profilesUrl:'',reviewKind:'meaning',reviewId:null,revealed:false,reviewed:new Set(),comparison:null,attemptId:null,assessments:new Set()};
const p = {phraseId:null,referenceId:null,mode:'practice',translation:false,text:'',start:0,end:0,duration:0,speed:1,loop:false,confirmed:false,testAttemptId:null,recording:false,starting:false,saving:false,generating:false,recorder:null,timer:null,startedAt:0};
const player = new Audio(); player.preload = 'metadata';
let playback = {role:null,url:'',start:0,end:0,loop:false,token:0}, generationController = null, recordingSnapshot = null;
const accent = id => D.ACCENTS.find(a => a.id === id) || {id:id || 'es',label:'Spanish',shortLabel:'Spanish',description:''};
const phrase = () => state.phrases.find(item => item.id === p.phraseId);
const reference = () => phrase()?.references.find(item => item.id === p.referenceId);
const attempts = id => state.attempts.filter(item => item.phraseId === id).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
const latest = () => state.attempts.find(item => item.id === ui.attemptId) || attempts(p.phraseId)[0];
const hiddenReference = () => p.mode === 'test' && !p.testAttemptId;
const busy = () => operation || p.recording || p.starting || p.saving || p.generating;
const sec = n => Number.isFinite(Number(n)) ? Number(n).toFixed(1) + 's' : '—';
const when = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Unknown date' : d.toLocaleDateString(undefined,{month:'short',day:'numeric'}); };
const clock = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}); };
const clipTime = n => `${Math.floor(Math.max(0,n || 0)/60)}:${String(Math.floor(Math.max(0,n || 0)%60)).padStart(2,'0')}`;
const sourceLabel = source => ({starter:'Starter phrase',manual:'Your phrase',web:'From the web',video:'From a video'}[source] || 'Saved phrase');
const safeLink = value => { try { const u = new URL(value); return ['http:','https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
const isAudio = value => typeof value === 'string' && /^data:audio\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(value);
const accentOptions = selected => D.ACCENTS.map(a => `<option value="${esc(a.id)}"${a.id === selected ? ' selected' : ''}>${esc(a.label)}</option>`).join('');
const option = (value,label,selected) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;
function notify(message,error = false) { const node = $('#toast'); clearTimeout(toastTimer); node.textContent = String(message); node.classList.toggle('error',error); node.hidden = false; toastTimer = setTimeout(() => {node.hidden = true;}, error ? 10000 : 4500); }
function report(error) {
  // A rapid pause/stop can reject play() after the user has already moved on.
  // Playback handles this locally; keep this guard for browser event callbacks too.
  if(error?.name === 'AbortError' && /play\(\).*interrupted/i.test(error.message || '')) return;
  const raw = error?.message || 'Something went wrong. Please try again.';
  const message = /play\(\)|HTMLMediaElement|goo\.gl\/LdLk22/.test(raw)
    ? 'Audio playback could not start. Click Play to try again, or choose another recording.' : raw;
  notify(message,true); const target = $('#form-error'); if(target) target.textContent = message;
}
function shell() {
  $$('#navigation a').forEach(link => { const active = link.dataset.page === page; link.classList.toggle('active',active); active ? link.setAttribute('aria-current','page') : link.removeAttribute('aria-current'); });
  $('#page-label').textContent = pages[page]; $('#library-count').textContent = state.phrases.length; $('#review-count').textContent = D.dueItems(state,'meaning').length;
  $('#global-accent').innerHTML = accentOptions(state.settings.accentId); $('#global-accent').disabled = busy(); document.title = `${pages[page]} · Gift of Tongues`;
}
function initPhrase(id) {
  const item = state.phrases.find(item => item.id === id) || D.dueItems(state,'speaking')[0] || state.phrases[0]; stopAudio();
  Object.assign(p,{phraseId:item?.id || null,referenceId:item?.references.find(r => r.accentId === state.settings.accentId)?.id || item?.references[0]?.id || null,text:item?.text || '',translation:false,start:0,end:0,duration:0,confirmed:false,testAttemptId:null});
  ui.attemptId = null; ui.comparison = null;
}
function render() {
  if(!state) return; if(p.phraseId && !phrase()) initPhrase(); shell();
  $('#main').innerHTML = ({today:renderToday,practice:renderPractice,library:renderLibrary,voices:renderVoices,review:renderReview,progress:renderProgress}[page])();
  if(page === 'practice') { prepareReference(); recordingUI(); }
}
function go(next,id) {
  if(busy()) return notify('Finish your recording or audio request first.'); stopAudio(); if(id) initPhrase(id);
  const changed = page !== next; page = pages[next] ? next : 'today';
  if(location.hash !== `#${page}`) history.pushState(null,'',`${location.pathname}${location.search}#${page}`); render();
  if(changed) { window.scrollTo(0,0); $('#main').focus({preventScroll:true}); }
}
async function reload(paint = true) { state = await D.load(); window.StudioTheme?.apply(state.settings.theme || 'system'); paint ? render() : shell(); }
async function mutate(callback,message,paint = true) {
  if(operation) return; operation = true;
  try { const result = await callback(); state = await D.load(); window.StudioTheme?.apply(state.settings.theme || 'system'); if(message) notify(message); return result; }
  finally {operation = false; paint ? render() : shell();}
}
function renderStats() {
  const s = D.stats(state), m = Number(s.practiceMinutes || 0);
  return `<div class="stats-grid">${[['mic','RECORDINGS',s.attempts,'Every attempt is a step forward'],['clock','MINUTES PRACTICED',m > 0 && m < 1 ? '<1' : Math.round(m),'Time spent finding your voice'],['sun','DAYS PRACTICED',s.practicedDays,'Built one session at a time'],['cards','WORDS DUE',s.dueMeaning,'Keep your vocabulary fresh']].map(([i,label,value,caption]) => `<div class="card stat-card"><span class="stat-label">${icon(i)}${label}</span><strong class="stat-value">${esc(value)}</strong><span class="stat-caption">${caption}</span></div>`).join('')}</div>`;
}
function renderToday() {
  const due = D.dueItems(state,'speaking'), next = due[0] || state.phrases[0], a = accent(state.settings.accentId);
  const date = new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}).toUpperCase();
  const bars = [8,14,24,19,34,46,29,21,36,50,31,40,23,15,30,43,28,18,36,26,12,20,10].map(n => `<span style="--bar:${n}px"></span>`).join('');
  return `${heading('A little closer to fluent.','Make the Spanish you discover part of the Spanish you speak.',btn('new-phrase','Add a phrase','plus'),date)}
  <section class="card hero"><div class="hero-copy"><span class="badge violet">${icon('headphones')} YOUR DAILY PRACTICE</span><h2>Listen closely.<br>Find your own voice.</h2><p>Pick a phrase. Follow its rhythm. Record yourself, listen back, and make it yours.</p>${btn(next ? 'start-phrase' : 'new-phrase',next ? 'Start shadowing' : 'Add your first phrase','arrow','primary',next ? `data-id="${esc(next.id)}"` : '')}</div><div class="hero-visual"><div class="sound-illustration" aria-hidden="true">${bars}</div><p class="quote" lang="es">${esc(next?.text || 'Poco a poco, cada día.')}</p><span class="quote-source">${esc(next ? sourceLabel(next.source) : 'A LITTLE, EVERY DAY')}</span></div></section>${renderStats()}
  <div class="two-column"><section><div class="section-head"><div><h2>Your next phrases</h2><p>${due.length ? `${due.length} ready to practice at your own pace` : 'Choose something you want to say'}</p></div><a class="text-button" href="#library">View library ${icon('arrow')}</a></div><div class="card phrase-list">${state.phrases.length ? (due.length ? due : state.phrases).slice(0,4).map((item,i) => `<div class="phrase-row"><span class="phrase-number">${String(i+1).padStart(2,'0')}</span><div class="phrase-details"><p class="phrase-title" lang="es">${esc(item.text)}</p><p class="phrase-translation">${esc(item.translation || 'Add a meaning in your library')}</p><div class="phrase-meta">${esc(sourceLabel(item.source))}<span>·</span>${item.references.length ? 'Reference audio ready' : 'Add a reference voice'}</div></div><button class="round-play" data-action="start-phrase" data-id="${esc(item.id)}" aria-label="Practice ${esc(item.text)}">${icon('arrow')}</button></div>`).join('') : empty('Your next phrase is out there.','Save a phrase from the web, or add one of your own.',btn('new-phrase','Add a phrase','plus','small'))}</div></section>
  <aside><div class="section-head"><h2>Your listening direction</h2></div><div class="card accent-card"><div class="accent-art"><span class="accent-code">${esc(a.id)}</span><span class="small-wave">${icon('wave')}</span></div><h3>${esc(a.label)}</h3><p>${esc(a.description || 'Explore regional Spanish with your own reference voices.')}</p><a class="text-button" href="#voices">Explore voices & accents ${icon('arrow')}</a></div><div class="inline-note neutral">${icon('cards')}<span>Know the word. Learn to say it.<br>Vocabulary and speaking reviews progress separately.</span></div></aside></div>`;
}
function filteredPhrases() { const q = ui.search.trim().toLocaleLowerCase(); return state.phrases.filter(item => (ui.source === 'all' || item.source === ui.source) && (!q || `${item.text} ${item.translation || ''}`.toLocaleLowerCase().includes(q))); }
function renderLibrary() {
  return `${heading('Words worth saying.','Everything you save, ready to become something you can say.',btn('new-phrase','Add a phrase','plus','primary'),'YOUR LIBRARY')}<div class="toolbar"><div class="search-wrap">${icon('search')}<label class="sr-only" for="library-search">Search phrases and meanings</label><input id="library-search" type="search" placeholder="Search your phrases…" value="${esc(ui.search)}"></div><label class="sr-only" for="library-source">Filter by source</label><select id="library-source" class="filter-select">${[['all','All sources'],['web','Web pages'],['video','Videos'],['manual','Your phrases'],['starter','Starter phrases']].map(([v,l]) => option(v,l,ui.source)).join('')}</select><a class="button" href="manager.html" target="_blank" rel="noopener">Vocabulary manager ${icon('external')}</a></div><div class="section-head"><p class="muted"><span id="filtered-count">${filteredPhrases().length}</span> phrases · ${state.vocabulary.length} saved vocabulary words</p></div><div id="library-results">${renderLibraryItems()}</div>${note('Save words and phrases from websites with the extension. Your Spanish captures appear here automatically; full word editing remains in the vocabulary manager.','neutral')}`;
}
function renderLibraryItems() {
  const items = filteredPhrases();
  return items.length ? `<div class="library-grid">${items.map(item => `<article class="card library-card"><div class="card-top"><span class="badge ${item.source === 'starter' ? '' : 'violet'}">${esc(sourceLabel(item.source))}</span><div class="card-actions"><button class="icon-button" data-action="edit-phrase" data-id="${esc(item.id)}" aria-label="Edit phrase: ${esc(item.text)}">${icon('edit')}</button><button class="icon-button" data-action="delete-phrase" data-id="${esc(item.id)}" aria-label="Delete phrase: ${esc(item.text)}">${icon('trash')}</button></div></div><h2 class="phrase-title" lang="es">${esc(item.text)}</h2><p class="phrase-translation">${esc(item.translation || 'No meaning added yet.')}</p><div class="card-bottom"><div class="phrase-meta">${icon('headphones')}${item.references.length ? `${item.references.length} references` : 'Text only'}${safeLink(item.sourceUrl) ? `<a class="source-link" href="${esc(safeLink(item.sourceUrl))}" target="_blank" rel="noopener">Source</a>` : ''}</div>${btn('start-phrase','Practice','arrow','small',`data-id="${esc(item.id)}"`)}</div></article>`).join('')}</div>` : `<div class="card">${empty(ui.search || ui.source !== 'all' ? 'No matching phrases.' : 'Start with something useful.','Add Spanish text and an optional recording from a native speaker.',btn('new-phrase','Add a phrase','plus','small'))}</div>`;
}
function renderPractice() {
  if(!p.phraseId) initPhrase();
  const item = phrase(), ref = reference(), attempt = latest(), hidden = hiddenReference(), disabled = busy() ? ' disabled' : '';
  if(!item) return `${heading('Make it sound like you.','A short phrase, a native reference, and room to try again.','','THE PRACTICE STUDIO')}<div class="card">${empty('Choose your first phrase.','Add a Spanish phrase to start listening and recording.',btn('new-phrase','Add a phrase','plus','primary'))}</div>`;
  return `${heading('Make it sound like you.','Listen for the rhythm. Try it out. Listen to yourself.',`<span class="badge outline">${icon('mic')} ${attempts(item.id).length} attempts</span>`,'THE PRACTICE STUDIO')}<div class="toolbar"><label class="sr-only" for="practice-phrase">Choose a phrase</label><select id="practice-phrase"${disabled}>${state.phrases.map(item => option(item.id,item.text,p.phraseId)).join('')}</select></div>
  <div class="practice-layout"><div class="practice-main"><section class="card practice-card" aria-label="Shadowing player"><div class="practice-toolbar"><div class="segmented" aria-label="Session mode">${[['practice','Guided practice'],['test','Test yourself']].map(([v,l]) => `<button data-action="mode" data-mode="${v}" aria-pressed="${p.mode === v}" class="${p.mode === v ? 'active' : ''}"${disabled}>${l}</button>`).join('')}</div><span class="practice-source">${icon('globe')}${esc(sourceLabel(item.source))}</span></div>
  <div class="practice-copy"><h2 class="practice-text" lang="es">${esc(p.text)}</h2>${p.translation ? `<p class="practice-translation">${esc(item.translation || 'No translation yet. Add one in your library.')}</p>` : ''}<button class="translation-toggle" data-action="toggle-translation"${disabled}>${p.translation ? 'Hide' : 'Show'} meaning</button></div>
  ${hidden ? `<div class="practice-empty-test">${icon('lock')}Read this phrase aloud before hearing the reference.<br>Your reference unlocks after you save an attempt.</div>` : `<div class="player"><div class="player-top"><span class="player-label">${icon('headphones')}${ref ? esc(ref.label) : 'Browser speech · accent may differ'}</span><span class="playback-time" id="playback-time">${clipTime(0)} / ${clipTime(p.duration)}</span></div><div class="player-main"><button class="player-button" data-action="play-reference" aria-label="Play reference"${disabled}>${icon('play')}</button><div class="player-track"><label class="sr-only" for="playback-seek">Playback position</label><input id="playback-seek" type="range" min="0" max="${p.duration || 1}" step="0.05" value="0"${!ref || busy() ? ' disabled' : ''}><p>${ref ? 'Listen once, then speak along with the reference.' : 'Add native audio for regional shadowing.'}</p></div></div><div class="player-tools"><button class="loop-button ${p.loop ? 'active' : ''}" data-action="toggle-loop" aria-pressed="${p.loop}"${!ref || busy() ? ' disabled' : ''}>${icon('loop')}Loop segment</button><div class="flex-row"><label for="playback-speed" class="sr-only">Playback speed</label><select id="playback-speed" class="compact-select"${disabled}>${[.6,.75,.9,1,1.1].map(n => option(n,`${n}× speed`,p.speed)).join('')}</select>${btn('stop-audio','Stop','stop','small',disabled)}</div></div></div>
  <details class="segment-editor"><summary>Practice a smaller segment</summary>${ref ? `<div class="segment-grid"><div><label for="segment-start">Start (seconds)</label><input id="segment-start" type="number" min="0" step="0.1" value="${p.start}"${disabled}></div><div><label for="segment-end">End (seconds)</label><input id="segment-end" type="number" min="0.1" step="0.1" value="${p.end || ''}" placeholder="Full clip"${disabled}></div></div>` : '<p class="reference-help">Segment looping becomes available when you add reference audio.</p>'}<label for="segment-text">Spanish text for this attempt</label><textarea id="segment-text" lang="es" maxlength="2000"${disabled}>${esc(p.text)}</textarea><label class="check-row"><input id="segment-confirm" type="checkbox"${p.confirmed ? ' checked' : ''}${disabled}>The text above matches the selected audio segment.</label><p class="reference-help">When trimming, enter only the words heard in that segment. The text and boundaries are saved with each attempt.</p>${btn('reset-segment','Use full phrase','refresh','small',disabled)}</details>`}
  <div class="record-zone"><span id="record-timer" class="record-timer"${p.recording ? '' : ' hidden'}>0:00 / 0:30</span><div id="level-meter" class="level-meter"${p.recording ? '' : ' hidden'} aria-hidden="true"><span></span></div><button id="record-button" class="button ${p.recording ? 'recording-button' : 'primary'}" data-action="record"${p.saving || p.starting || p.generating ? ' disabled' : ''}>${icon(p.recording ? 'stop' : 'mic')}${p.recording ? 'Finish recording' : p.starting ? 'Opening microphone…' : p.saving ? 'Saving your attempt…' : 'Record an attempt'}</button><p class="record-help" id="record-help">${p.recording ? 'Reference muted. Speak naturally, then finish your recording.' : 'The reference pauses while you record. Up to 30 seconds; saved on this device.'}</p></div></section>
  ${attempt && !hidden ? renderComparison(attempt) : ''}
  ${attempts(item.id).length ? `<section class="card comparison"><div class="section-head"><h2>Previous attempts</h2><span class="badge">${attempts(item.id).length} saved</span></div><div class="history-list">${attempts(item.id).slice(0,8).map(attempt => `<div class="history-row"><button class="round-play" data-action="play-attempt" data-id="${esc(attempt.id)}" aria-label="Play recording from ${esc(when(attempt.createdAt))}"${busy() || hidden ? ' disabled' : ''}>${icon('play')}</button><div class="phrase-details">${esc(when(attempt.createdAt))} · ${esc(clock(attempt.createdAt))}<br><small>${sec(attempt.duration)} · ${attempt.mode === 'test' ? 'Test' : 'Practice'} · ${esc(accent(attempt.accentId).shortLabel)}</small></div>${btn('select-attempt','Compare',null,'small',`data-id="${esc(attempt.id)}"${busy() || hidden ? ' disabled' : ''}`)}<button class="icon-button" data-action="delete-attempt" data-id="${esc(attempt.id)}" aria-label="Delete this recording"${disabled}>${icon('trash')}</button></div>`).join('')}</div></section>` : ''}
  </div><aside class="practice-aside"><section class="card"><p class="eyebrow">YOUR REFERENCE</p><div class="field"><label for="practice-reference">Recording</label><select id="practice-reference"${busy() || hidden ? ' disabled' : ''}><option value="">Browser speech (fallback)</option>${item.references.map(r => option(r.id,`${r.label}${r.accentId ? ` · ${accent(r.accentId).shortLabel}` : ''}`,p.referenceId)).join('')}</select></div><p class="reference-help">${ref ? `${ref.kind === 'voicebox' ? 'Generated reference' : 'Original audio'}${ref.accentId ? ` · ${esc(accent(ref.accentId).label)}` : ''}. Each attempt keeps its own reference.` : 'Browser speech is a listening aid. A native clip or checked Voicebox reference is best for accent practice.'}</p><hr class="divider"><div class="field"><label for="generate-voice">Generate a new reference</label><select id="generate-voice"${busy() || !state.voices.length || hidden ? ' disabled' : ''}>${state.voices.map(voice => option(voice.id,`${voice.name} · ${accent(voice.accentId).shortLabel}`,state.voices.find(v => v.accentId === state.settings.accentId)?.id)).join('') || '<option>Add a voice first</option>'}</select></div>${btn('generate-reference',p.generating ? 'Generating…' : 'Generate audio','wave','soft full-width',`id="generate-button"${busy() || !state.voices.length || hidden ? ' disabled' : ''}`)}${p.generating ? btn('cancel-generation','Cancel generation',null,'small full-width row-gap') : ''}<p class="reference-help">Creates the full saved phrase in Spanish with your selected Voicebox profile.</p><div class="flex-row">${btn('upload-reference','Upload audio','upload','small',busy() || hidden ? 'disabled' : '')}<a class="text-button" href="#voices">Manage voices</a></div></section><section class="card"><p class="eyebrow">A SMALL, USEFUL ROUTINE</p>${[['Listen closely','Notice the pauses and the words that carry the rhythm.'],['Shadow the phrase','Play the reference and speak along. Loop any part you want to repeat.'],['Find one improvement','Record with the reference muted. Compare, choose one change, and retry.']].map(([title,body],i) => `<div class="step ${i === 0 ? 'active' : ''}"><span class="step-number">${i+1}</span><div><h3>${title}</h3><p>${body}</p></div></div>`).join('')}</section></aside></div>`;
}
function renderComparison(attempt) {
  const snap = attempt.referenceSnapshot, disabled = busy() ? ' disabled' : '';
  return `<section class="card comparison" aria-label="Compare your recording"><div class="comparison-top"><div><h2>Hear the difference.</h2><p>${esc(when(attempt.createdAt))} · ${sec(attempt.duration)} · ${attempt.mode === 'test' ? 'Test attempt' : 'Your saved attempt'}</p></div><span class="badge green">${icon('check')} Saved</span></div><div class="ab-controls"><button data-action="play-attempt-reference" data-id="${esc(attempt.id)}"${!isAudio(snap?.audioUrl) || busy() ? ' disabled' : ''}><span class="ab-letter">A</span><span class="ab-copy">Your reference<small>${esc(snap?.label || 'No recorded reference')}</small></span>${icon('play')}</button><button data-action="play-attempt" data-id="${esc(attempt.id)}"${disabled}><span class="ab-letter">B</span><span class="ab-copy">Your voice<small>Clean recording · ${sec(attempt.duration)}</small></span>${icon('play')}</button></div>${snap?.text ? `<p class="reference-help" lang="es">Attempt text: ${esc(snap.text)}</p>` : ''}<div class="flex-row">${btn('compare-timing','Compare timing','chart','small',`data-id="${esc(attempt.id)}"${disabled}`)}${btn('assess-attempt',ui.assessments.has(attempt.id) ? 'Assessing…' : 'Assess pronunciation','mic','small',`data-id="${esc(attempt.id)}"${busy() || ui.assessments.has(attempt.id) ? ' disabled' : ''}`)}</div>${ui.comparison?.attemptId === attempt.id ? renderTiming(ui.comparison) : ''}${attempt.assessment ? renderAssessment(attempt.assessment) : '<p class="reference-help">Listen for rhythm and clarity. Optional assessment sends this attempt to your configured speech service only when you click.</p>'}<div class="assessment"><h3>How did this attempt feel?</h3><p>Your self-rating schedules the next speaking review.</p><div class="rating-row">${['again','hard','good','easy'].map(rating => `<button class="rating-button ${attempt.selfRating === rating ? 'selected' : ''}" data-action="rate-speaking" data-id="${esc(attempt.id)}" data-rating="${rating}" aria-pressed="${attempt.selfRating === rating}"${disabled}>${{again:'Again',hard:'Needs work',good:'Getting there',easy:'Feels natural'}[rating]}</button>`).join('')}</div></div></section>`;
}
function renderTiming(result) {
  if(result.error) return note(esc(result.error),'warning');
  const data = result.data, attempt = data.attempt || data;
  return `<div class="assessment"><h3>Timing & recording quality</h3><div class="metrics"><div class="metric"><strong>${sec(attempt.duration)}</strong><small>Your recording</small></div>${data.reference ? `<div class="metric"><strong>${sec(data.reference.duration)}</strong><small>Reference recording</small></div>` : result.segmentDuration ? `<div class="metric"><strong>${sec(result.segmentDuration)}</strong><small>Reference segment</small></div>` : ''}<div class="metric"><strong>${Number.isFinite(attempt.pauseCount) ? attempt.pauseCount : '—'}</strong><small>Detected pauses</small></div></div><p>Timing observations only; these do not measure accent, pronunciation, or intonation.</p>${(data.tips || []).length ? `<ul>${data.tips.map(tip => `<li>${esc(tip)}</li>`).join('')}</ul>` : ''}${result.segmentDuration ? '<p>Trimmed references are compared by duration only.</p>' : ''}</div>`;
}
function renderAssessment(result) {
  const metric = (name,value) => `<div class="metric"><strong>${Number.isFinite(value) ? Math.round(value) : '—'}</strong><small>${name}</small></div>`;
  return `<div class="assessment"><h3>Pronunciation assessment <span class="badge">Azure · ${esc(result.locale)}</span></h3><div class="metrics">${metric('Accuracy',result.accuracy)}${metric('Fluency',result.fluency)}${metric('Completeness',result.completeness)}</div>${result.transcript ? `<p>Heard: <span lang="es">${esc(result.transcript)}</span></p>` : ''}<div class="word-feedback">${(result.words || []).map(word => `<span class="word-score ${Number.isFinite(word.accuracy) && word.accuracy < 70 ? 'concern' : ''}" title="${esc(word.errorType || 'Word accuracy')}">${esc(word.word)}<small>${Number.isFinite(word.accuracy) ? Math.round(word.accuracy) : '—'}</small></span>`).join('')}</div>${(result.tips || []).length ? `<ul>${result.tips.map(tip => `<li>${esc(tip)}</li>`).join('')}</ul>` : ''}${(result.limitations || []).map(text => `<p>${esc(text)}</p>`).join('')}<p>Provider estimates describe this attempt, not an accent score. Regional Spanish can vary.</p></div>`;
}
function renderVoices() {
  return `${heading('Spanish has many voices.','Choose the speakers you want to learn from. Explore a region, or stay with one familiar reference.',btn('open-settings','Studio settings','settings'),'VOICES & ACCENTS')}
  <section class="card card-pad"><div class="section-head"><div><h2>Connect your Voicebox</h2><p>Bring your own regional voice profiles into the studio.</p></div><span class="badge">Voicebox</span></div><form id="voice-connect-form" class="voice-connect"><div class="field"><label for="voicebox-url">Voicebox address</label><input id="voicebox-url" type="url" required value="${esc(ui.profilesUrl || state.settings.voiceboxUrl)}" placeholder="http://127.0.0.1:17493"><small>Keep Voicebox running. Your voice profiles stay in Voicebox; generated reference clips are saved here.</small></div><button type="submit" class="button primary"${busy() ? ' disabled' : ''}>${icon('headphones')}Load voice profiles</button></form>${ui.profiles.length ? `<div class="section-gap"><h3>Available profiles</h3>${ui.profiles.map((profile,i) => `<div class="profile-row" data-profile-index="${i}"><div class="profile-name"><strong>${esc(profile.name)}</strong><p class="reference-help">${esc(profile.id)}</p></div><div class="field"><label for="profile-name-${i}">Display name</label><input id="profile-name-${i}" maxlength="100" value="${esc(profile.name)}"></div><div class="field"><label for="profile-accent-${i}">Reference accent</label><select id="profile-accent-${i}">${accentOptions(state.settings.accentId)}</select></div>${btn('save-profile','Add voice','plus','small',`data-index="${i}"`)}</div>`).join('')}</div>` : ''}</section>
  <section class="section-gap"><div class="section-head"><div><h2>Your reference voices</h2><p>Preview each voice before using it as a regional reference.</p></div><span class="badge">${state.voices.length} ${state.voices.length === 1 ? 'voice' : 'voices'}</span></div>${state.voices.length ? `<div class="voice-grid">${state.voices.map(voice => `<article class="card voice-card"><div class="card-top"><div class="voice-avatar" aria-hidden="true">${esc(voice.name.split(/\s+/).slice(0,2).map(w => w[0]).join(''))}</div><span class="badge violet">${esc(accent(voice.accentId).shortLabel)}</span></div><h3>${esc(voice.name)}</h3><p>${esc(voice.description || 'Your Voicebox reference. Listen for the regional sounds and delivery you want to practice.')}</p><div class="card-bottom">${btn('preview-voice','Preview voice','play','small',`data-id="${esc(voice.id)}"${busy() ? ' disabled' : ''}`)}<div class="card-actions"><button class="icon-button" data-action="edit-voice" data-id="${esc(voice.id)}" aria-label="Edit ${esc(voice.name)}"${busy() ? ' disabled' : ''}>${icon('edit')}</button><button class="icon-button" data-action="delete-voice" data-id="${esc(voice.id)}" aria-label="Remove ${esc(voice.name)}"${busy() ? ' disabled' : ''}>${icon('trash')}</button></div></div></article>`).join('')}</div>` : `<div class="card">${empty('A familiar voice makes a difference.','Load your Voicebox profiles above, then assign a regional accent. You can also upload native audio directly to any phrase.',btn('go-library','Open phrase library','arrow','small'))}</div>`}</section>
  <section class="section-gap"><div class="section-head"><div><h2>Pick your listening direction</h2><p>Regional labels organize your references; they do not guarantee a generated accent.</p></div></div><div class="accent-grid">${D.ACCENTS.map(a => `<button class="accent-tile ${a.id === state.settings.accentId ? 'selected' : ''}" data-action="set-accent" data-id="${esc(a.id)}" aria-pressed="${a.id === state.settings.accentId}"${busy() ? ' disabled' : ''}><strong>${esc(a.label)}</strong><small>${esc(a.description)}</small></button>`).join('')}</div></section>${note('The goal is understandable speech and the patterns you choose to practice. Matching a speaker’s vocal identity or pitch is not the objective.','neutral')}`;
}
function dueWords() { return D.dueItems(state,'meaning').filter(item => !ui.reviewed.has(item.id)); }
function reviewWord() { const items = dueWords(); return items.find(item => item.id === ui.reviewId) || items[0]; }
function renderReview() {
  const speaking = ui.reviewKind === 'speaking', items = speaking ? D.dueItems(state,'speaking') : dueWords(), item = speaking ? items[0] : reviewWord();
  if(!speaking) ui.reviewId = item?.id || null;
  const listening = ui.reviewKind === 'listening';
  return `${heading('Keep it within reach.','Remember the meaning. Recognize the sound. Practice saying it.','','YOUR REVIEW QUEUE')}<div class="review-wrap"><div class="review-status"><div class="segmented">${[['meaning','Vocabulary'],['listening','Listening'],['speaking','Speaking']].map(([id,label]) => `<button data-action="review-kind" data-kind="${id}" class="${id === ui.reviewKind ? 'active' : ''}" aria-pressed="${id === ui.reviewKind}">${label}</button>`).join('')}</div><p>${items.length} ready</p></div>
  ${!item ? `<div class="card">${empty(ui.reviewed.size && !speaking ? 'A little more familiar.' : 'Your queue is clear.',speaking ? 'Add phrases to your library to start speaking reviews.' : state.vocabulary.length ? 'No words with saved meanings are due right now. Come back later or add a meaning in the vocabulary manager.' : 'Save Spanish words on a website to build your flashcards.',speaking ? btn('go-library','Open library','arrow','small') : '<a class="button small" href="manager.html" target="_blank" rel="noopener">Open vocabulary manager</a>')}</div>` : speaking ? `<div class="card flashcard"><span class="badge violet">SPOKEN RECALL</span><h2 class="flashcard-word" lang="es">${esc(item.text)}</h2><p class="flashcard-context">Say the phrase before listening to the reference. Your saved attempt and self-rating guide your next speaking review.</p>${btn('test-phrase','Test this phrase','mic','primary',`data-id="${esc(item.id)}"`)}</div>` : `<div class="card flashcard"><span class="badge violet">${listening ? 'LISTEN & RECALL' : 'SPANISH → MEANING'}</span>${listening && !ui.revealed ? `<h2 class="flashcard-word">Listen closely.</h2>${btn('speak-card','Hear the word','headphones','soft',`data-id="${esc(item.id)}"`)}<p class="reference-help">Browser speech · reference accent may differ</p>` : `<h2 class="flashcard-word" lang="es">${esc(item.word)}</h2>${btn('speak-card','Listen','play','small',`data-id="${esc(item.id)}"`)}`}${ui.revealed ? `<p class="flashcard-meaning">${esc(item.meaning)}</p>${item.context ? `<p class="flashcard-context" lang="es">${esc(item.context)}</p>` : ''}` : `<p class="flashcard-context">${listening ? 'Can you recognize the word and recall its meaning?' : 'Bring the meaning to mind before you turn the card.'}</p>${btn('reveal-card','Reveal meaning',null,'primary')}`}</div>${ui.revealed ? `<div class="review-ratings">${[['again','Again','Keep practicing'],['hard','Hard','A little more time'],['good','Good','Coming back later'],['easy','Easy','Give it more space']].map(([rating,label,help]) => `<button data-action="rate-card" data-id="${esc(item.id)}" data-rating="${rating}">${label}<small>${help}</small></button>`).join('')}</div>` : ''}`}
  ${note(speaking ? 'Speaking practice has its own review schedule. Knowing a word’s meaning and saying it comfortably are different skills.' : 'Vocabulary and listening cards share your meaning review schedule. Words without a saved meaning remain in your vocabulary manager until they are ready to review.','neutral')}</div>`;
}
function renderProgress() {
  const sorted = [...state.attempts].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  const days = Array.from({length:14},(_,i) => { const day = new Date(); day.setHours(0,0,0,0); day.setDate(day.getDate() - 13 + i); const next = new Date(day); next.setDate(next.getDate()+1); return {day,count:sorted.filter(a => new Date(a.createdAt) >= day && new Date(a.createdAt) < next).length}; });
  const maximum = Math.max(1,...days.map(d => d.count));
  return `${heading('Hear how far you’ve come.','A record of your practice, with your own voice as the evidence.',btn('export-backup','Export backup','download'),'YOUR PROGRESS')}${renderStats()}<div class="two-column"><section class="card card-pad"><div class="section-head"><div><h2>Show up. Say something.</h2><p>Recordings over the last 14 days</p></div></div><div class="progress-activity" role="img" aria-label="${esc(days.map(d => `${when(d.day)}: ${d.count} recordings`).join('; '))}">${days.map(d => `<div class="day-column" title="${esc(when(d.day))}: ${d.count} recordings"><div class="day-bar ${d.count ? 'has-activity' : ''}" style="height:${d.count ? Math.max(8,65*d.count/maximum) : 3}px"></div><small>${d.day.getDate()}</small></div>`).join('')}</div></section><section class="card card-pad"><p class="eyebrow">PROGRESS YOU CAN HEAR</p><h2>Compare across days.</h2><p class="section-description row-gap">Revisit a phrase and switch between earlier and recent attempts. Listen for clearer words, more comfortable pacing, and fewer restarts.</p><a class="text-button" href="#practice">Back to the studio ${icon('arrow')}</a></section></div>
  <section class="section-gap"><div class="section-head"><h2>Your recordings</h2><span class="badge">${sorted.length} saved locally</span></div><div class="card table-wrap">${sorted.length ? `<table class="progress-table"><thead><tr><th scope="col">Phrase</th><th scope="col">Recorded</th><th scope="col">Practice</th><th scope="col">Actions</th></tr></thead><tbody>${sorted.map(attempt => { const item = state.phrases.find(p => p.id === attempt.phraseId); return `<tr><td lang="es">${esc(attempt.text || attempt.referenceSnapshot?.text || item?.text || 'Saved phrase')}<small>${esc(accent(attempt.accentId).label)}</small></td><td>${esc(when(attempt.createdAt))}<small>${esc(clock(attempt.createdAt))}</small></td><td>${sec(attempt.duration)}<small>${attempt.mode === 'test' ? 'Test' : 'Guided'}${attempt.selfRating ? ` · ${esc(attempt.selfRating)}` : ''}</small></td><td><div class="flex-row"><button class="icon-button" data-action="play-attempt" data-id="${esc(attempt.id)}" aria-label="Play this recording">${icon('play')}</button><button class="icon-button" data-action="open-attempt" data-id="${esc(attempt.id)}" aria-label="Open recording comparison">${icon('arrow')}</button><button class="icon-button" data-action="delete-attempt" data-id="${esc(attempt.id)}" aria-label="Delete recording">${icon('trash')}</button></div></td></tr>`; }).join('')}</tbody></table>` : empty('Your first attempt belongs here.','Record a phrase to start your history. No scores, streaks, or progress are added until you practice.',btn('go-practice','Start practicing','mic','primary'))}</div></section>`;
}
function dialog(title,body,actions = '',formId = '') {
  const node = $('#editor-dialog');
  $('#dialog-content').innerHTML = `${formId ? `<form id="${formId}">` : ''}<div class="dialog-header"><h2 id="dialog-title">${title}</h2><button type="button" class="icon-button" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div><div class="dialog-body">${body}<p class="form-error" id="form-error" role="alert"></p></div><div class="dialog-actions">${btn('close-dialog','Cancel',null)}${actions}</div>${formId ? '</form>' : ''}`;
  node.showModal(); setTimeout(() => $('#dialog-content input:not([type=hidden]), #dialog-content textarea')?.focus(),0);
}
function phraseDialog(id) {
  const item = state.phrases.find(item => item.id === id);
  dialog(item ? 'Edit your phrase' : 'Add something worth saying',`<input id="phrase-id" type="hidden" value="${esc(item?.id || '')}"><div class="field"><label for="phrase-text">Spanish phrase</label><textarea id="phrase-text" lang="es" required maxlength="2000" placeholder="Me gustaría hablar con más confianza.">${esc(item?.text || '')}</textarea></div><div class="field"><label for="phrase-meaning">Meaning</label><textarea id="phrase-meaning" maxlength="2000" placeholder="I would like to speak with more confidence.">${esc(item?.translation || '')}</textarea></div><div class="field"><label for="phrase-source">Source link (optional)</label><input id="phrase-source" type="url" value="${esc(safeLink(item?.sourceUrl))}" placeholder="https://…"></div>${!item ? `<div class="field"><label for="phrase-audio">Native audio clip (optional)</label><input id="phrase-audio" type="file" accept="audio/*"><small>Use a short clip matching the Spanish text. Maximum 12 MB.</small></div><div class="field"><label for="phrase-accent">Reference accent</label><select id="phrase-accent">${accentOptions(state.settings.accentId)}</select></div>` : item.references.length ? note('Existing audio stays attached. If you change the Spanish words, check that the reference recordings still match. Earlier attempts keep their original text.','warning') : ''}`,'<button type="submit" class="button primary">Save phrase</button>','phrase-form');
}
function uploadDialog() {
  dialog('Add a native reference',`<p class="section-description" lang="es">${esc(phrase()?.text)}</p><div class="field"><label for="reference-file">Audio clip</label><input id="reference-file" type="file" accept="audio/*" required><small>Choose a short recording, up to 12 MB. Keep the spoken text and saved phrase consistent.</small></div><div class="field"><label for="reference-label">Reference label</label><input id="reference-label" required maxlength="100" placeholder="Ana · café conversation"></div><div class="field"><label for="reference-accent">Speaker’s reference accent</label><select id="reference-accent">${accentOptions(state.settings.accentId)}</select></div><label class="check-row"><input id="reference-confirm" type="checkbox" required>The recording contains the saved phrase above.</label>`,'<button type="submit" class="button primary">Save reference</button>','upload-form');
}
function voiceDialog(id) {
  const voice = state.voices.find(v => v.id === id); if(!voice) return;
  dialog('Edit reference voice',`<input id="edit-voice-id" type="hidden" value="${esc(id)}"><div class="field"><label for="edit-voice-name">Display name</label><input id="edit-voice-name" required maxlength="100" value="${esc(voice.name)}"></div><div class="field"><label for="edit-voice-accent">Reference accent</label><select id="edit-voice-accent">${accentOptions(voice.accentId)}</select></div><div class="field"><label for="edit-voice-description">Speaker and delivery notes</label><textarea id="edit-voice-description" maxlength="500">${esc(voice.description || '')}</textarea></div>`,'<button type="submit" class="button primary">Save voice</button>','voice-edit-form');
}
function settingsDialog() {
  const theme = state.settings.theme || 'system';
  dialog('Your studio settings',`<section class="settings-section"><h3>Appearance</h3><div class="field"><label for="settings-theme">Color theme</label><select id="settings-theme"><option value="system"${theme === 'system' ? ' selected' : ''}>Use device setting</option><option value="light"${theme === 'light' ? ' selected' : ''}>Light</option><option value="dark"${theme === 'dark' ? ' selected' : ''}>Dark</option></select><small>Applies across every studio page and follows your device when set to automatic.</small></div></section><section class="settings-section"><h3>Listening direction</h3><div class="field"><label for="settings-accent">Default reference accent</label><select id="settings-accent">${accentOptions(state.settings.accentId)}</select></div></section><section class="settings-section"><h3>Optional pronunciation assessment</h3><p class="section-description">Send an attempt for word-level pronunciation feedback when you choose. Audio leaves this device only after you click “Assess pronunciation.”</p><label class="check-row"><input id="assessment-enabled" type="checkbox"${state.settings.assessmentEnabled ? ' checked' : ''}>Enable assessment through my configured speech service</label><div class="field row-gap"><label for="assessment-url">Assessment service address</label><input id="assessment-url" type="url" required value="${esc(state.settings.assessmentUrl)}"><small>The local bridge supports configured es-MX and es-ES assessment. Other accents remain available for shadowing. No Spanish intonation score is provided.</small></div><p class="reference-help">Run the assessment bridge with your speech account credentials; keys stay outside the extension. Setup instructions are in server/README.md.</p></section><section class="settings-section"><h3>Your saved practice</h3><p class="section-description">Recordings and references stay on this device. A studio backup includes their audio, voice configuration, phrases, and review history.</p><div class="flex-row">${btn('export-backup','Export backup','download','small')}${btn('import-backup','Import backup','upload','small')}</div></section>`,'<button type="submit" class="button primary">Save settings</button>','settings-form');
}
let metadataToken = 0;
function prepareReference() {
  const ref = reference(); if(!ref || p.duration || !isAudio(ref.audioUrl)) return;
  const token = ++metadataToken, id = ref.id, probe = new Audio();
  const applyDuration = duration => {
    if(token !== metadataToken || reference()?.id !== id || !Number.isFinite(duration) || duration <= 0) return;
    p.duration = duration;
    const seek = $('#playback-seek'); if(seek) {seek.max = duration; seek.disabled = busy();}
    const end = $('#segment-end'); if(end) {end.max = duration; end.placeholder = duration.toFixed(1);}
    const start = $('#segment-start'); if(start) start.max = Math.max(0,duration - .1);
    const time = $('#playback-time'); if(time && player.paused) time.textContent = `${clipTime(p.start)} / ${clipTime(duration)}`;
  };
  probe.onloadedmetadata = () => {
    if(Number.isFinite(probe.duration)) applyDuration(probe.duration);
    else A.analyze(ref.audioUrl).then(result => applyDuration(result.duration)).catch(() => {});
    probe.removeAttribute('src'); probe.load();
  };
  probe.onerror = () => {probe.removeAttribute('src');};
  probe.src = ref.audioUrl;
}
function stopAudio() {
  player.pause(); playback.token++; playback.role = null;
  if('speechSynthesis' in window) window.speechSynthesis.cancel();
  updatePlayback();
}
function updatePlayback() {
  const control = $('[data-action="play-reference"]');
  const playing = playback.role === 'current' && !player.paused;
  if(control) {control.innerHTML = icon(playing ? 'pause' : 'play'); control.setAttribute('aria-label',playing ? 'Pause reference' : 'Play reference');}
  if(playback.role === 'current') {
    const seek = $('#playback-seek'), time = $('#playback-time');
    if(seek) {seek.max = Number.isFinite(player.duration) ? player.duration : p.duration || 1; seek.value = player.currentTime || 0;}
    if(time) time.textContent = `${clipTime(player.currentTime)} / ${clipTime(Number.isFinite(player.duration) ? player.duration : p.duration)}`;
  }
}
async function resumePlayer(token = playback.token) {
  try { await player.play(); }
  catch(error) {
    if(token !== playback.token || error?.name === 'AbortError') return false;
    if(error?.name === 'NotAllowedError') throw new Error('The browser blocked audio playback. Click Play again to allow it.');
    throw new Error('This recording could not be played. Try another audio format or choose a different reference.');
  }
  return token === playback.token;
}
async function playUrl(url,start = 0,end = 0,role = 'other',loop = false) {
  if(!isAudio(url)) throw new Error('This recording is unavailable or is not valid audio.');
  stopAudio(); const token = playback.token;
  playback = {role,url,start:Number(start) || 0,end:Number(end) || 0,loop,token};
  if(player.src !== url) {
    player.src = url;
    try { await new Promise((resolve,reject) => {
      const cleanup = () => {clearTimeout(timer); player.removeEventListener('loadedmetadata',done); player.removeEventListener('error',fail);};
      const done = () => {cleanup(); resolve();};
      const fail = () => {cleanup(); reject(new Error('This recording could not be played. Try another audio format.'));};
      const timer = setTimeout(fail,12000);
      player.addEventListener('loadedmetadata',done,{once:true}); player.addEventListener('error',fail,{once:true});
      if(player.readyState >= 1) done();
    }); } catch(error) { if(token !== playback.token) return; throw error; }
  }
  if(playback.token !== token || busy()) return;
  if(Number.isFinite(player.duration) && start >= player.duration) throw new Error('The segment starts after the end of the recording.');
  player.currentTime = Math.max(0,start); player.playbackRate = p.speed;
  await resumePlayer(token); updatePlayback();
}
function speak(text) {
  if(!('speechSynthesis' in window)) throw new Error('Browser speech is unavailable. Upload reference audio or connect Voicebox.');
  stopAudio();
  const utterance = new SpeechSynthesisUtterance(text);
  const locale = state.settings.accentId || 'es-MX', voices = speechSynthesis.getVoices();
  utterance.lang = locale; utterance.rate = p.speed;
  utterance.voice = voices.find(v => v.lang.toLowerCase() === locale.toLowerCase()) || voices.find(v => /^es[-_]/i.test(v.lang)) || null;
  utterance.onerror = event => {if(!['interrupted','canceled'].includes(event.error)) report(new Error('Browser speech is unavailable. Add a native clip or Voicebox reference.'));};
  ui.utterance = utterance; speechSynthesis.speak(utterance);
}
player.addEventListener('timeupdate',() => {
  if(playback.end && player.currentTime >= playback.end - .025) {
    if(playback.loop) {player.currentTime = playback.start; if(player.paused) resumePlayer().catch(report);}
    else player.pause();
  }
  updatePlayback();
});
player.addEventListener('ended',() => {if(playback.loop && !busy()) {player.currentTime = playback.start; resumePlayer().catch(report);} updatePlayback();});
player.addEventListener('pause',updatePlayback); player.addEventListener('play',updatePlayback);
function segmentChanged() {
  p.start = Math.max(0,Number($('#segment-start')?.value) || 0);
  p.end = Math.max(0,Number($('#segment-end')?.value) || 0);
  p.confirmed = false; const check = $('#segment-confirm'); if(check) check.checked = false;
  stopAudio();
}
function validateSegment(requireTextMatch = true) {
  if(!p.text.trim()) throw new Error('Enter the Spanish text for this attempt.');
  if(reference()) {
    const end = p.end || p.duration;
    if(p.start && !end) throw new Error('Wait for the clip to load, or set its end time.');
    if(end && end <= p.start) throw new Error('Set a segment end later than its start.');
    if(p.duration && (p.start >= p.duration || p.end > p.duration + .1)) throw new Error('Keep the segment inside the reference recording.');
    const trimmed = p.start > 0 || (p.end > 0 && (!p.duration || p.end < p.duration - .15));
    if(requireTextMatch && (trimmed || p.text.trim() !== phrase().text.trim()) && !p.confirmed) throw new Error('Confirm that the practice text matches this audio segment before recording.');
  }
}
function recordingUI() {
  const button = $('#record-button');
  if(button) {button.disabled = p.starting || p.saving || p.generating; button.classList.toggle('recording-button',p.recording); button.innerHTML = `${icon(p.recording ? 'stop' : 'mic')}${p.recording ? 'Finish recording' : p.starting ? 'Opening microphone…' : p.saving ? 'Saving your attempt…' : 'Record an attempt'}`;}
  const timer = $('#record-timer'), meter = $('#level-meter'); if(timer) timer.hidden = !p.recording; if(meter) meter.hidden = !p.recording;
  if(timer) timer.textContent = `${clipTime((Date.now()-p.startedAt)/1000)} / 0:30`;
  const help = $('#record-help'); if(help) help.textContent = p.recording ? 'Reference muted. Speak naturally, then finish your recording.' : 'The reference pauses while you record. Up to 30 seconds; saved on this device.';
  if(page === 'practice') $$('#main button, #main input, #main select, #main textarea').forEach(node => {
    if(node.id === 'record-button' || node.dataset.action === 'cancel-generation') return;
    if(p.recording || p.starting || p.saving) {node.dataset.recordDisabled = node.disabled ? 'yes' : 'no'; node.disabled = true;}
  });
  if(state) $('#global-accent').disabled = busy();
}
async function record() {
  if(p.recording) {
    p.recording = false; p.saving = true; clearInterval(p.timer); recordingUI();
    try {const recorded = await p.recorder.stop(); await finishRecording(recorded);}
    catch(error) {recordingFailed(error);}
    return;
  }
  if(busy()) return;
  validateSegment(); stopAudio();
  const item = phrase(), ref = reference();
  recordingSnapshot = {phraseId:item.id,text:p.text.trim(),mode:p.mode,accentId:ref?.accentId || state.settings.accentId};
  if(ref) Object.assign(recordingSnapshot,{referenceId:ref.id,referenceSnapshot:{label:ref.label,audioUrl:ref.audioUrl,accentId:ref.accentId || state.settings.accentId,start:p.start,end:p.end || p.duration || undefined,text:p.text.trim()}});
  p.starting = true; recordingUI();
  p.recorder = A.createRecorder({maxSeconds:30,onLevel:level => {const bar = $('#level-meter span'); if(bar) bar.style.width = `${Math.max(0,Math.min(100,Number(level)*100))}%`;},onAutoStop:recording => {finishRecording(recording).catch(recordingFailed);},onError:recordingFailed});
  try {
    await p.recorder.start(); p.starting = false; p.recording = true; p.startedAt = Date.now();
    p.timer = setInterval(() => {const timer = $('#record-timer'); if(timer) timer.textContent = `${clipTime(Math.min(30,(Date.now()-p.startedAt)/1000))} / 0:30`;},200);
    recordingUI();
  } catch(error) {recordingFailed(error);}
}
let finalizingRecording = false;
async function finishRecording(recorded) {
  if(finalizingRecording || !recordingSnapshot) return;
  finalizingRecording = true; p.recording = false; p.starting = false; p.saving = true; clearInterval(p.timer); recordingUI();
  const snapshot = recordingSnapshot;
  try {
    if(!recorded?.audioUrl || !(recorded.duration > 0)) throw new Error('No audio was captured. Check your microphone and try again.');
    const saved = await D.saveAttempt({...snapshot,audioUrl:recorded.audioUrl,duration:recorded.duration,createdAt:Date.now()});
    ui.attemptId = saved.id; ui.comparison = null; if(snapshot.mode === 'test') p.testAttemptId = saved.id;
    state = await D.load(); notify('Your attempt is saved. Listen back and choose one thing to improve.');
  } finally {recordingSnapshot = null; finalizingRecording = false; p.saving = false; p.recorder = null; render();}
}
function recordingFailed(error) {
  clearInterval(p.timer); p.recorder?.cancel();
  Object.assign(p,{recording:false,starting:false,saving:false,recorder:null}); recordingSnapshot = null; finalizingRecording = false; render(); report(error);
}
async function fileAudio(file) {
  if(!file) return null;
  if(file.size > 12*1024*1024) throw new Error('Choose an audio clip smaller than 12 MB.');
  if(file.size === 0) throw new Error('This audio file is empty.');
  const inferred = {mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',mp4:'audio/mp4',ogg:'audio/ogg',oga:'audio/ogg',webm:'audio/webm',flac:'audio/flac'}[file.name.split('.').pop().toLowerCase()];
  const type = file.type.startsWith('audio/') ? file.type : inferred;
  if(!type) throw new Error('Choose an MP3, WAV, M4A, Ogg, WebM, or FLAC audio recording.');
  const value = await new Promise((resolve,reject) => {const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('The selected file could not be read.')); reader.readAsDataURL(new Blob([file],{type}));});
  await A.analyze(value); return value;
}
async function generate(voiceId,preview = false) {
  const voice = state.voices.find(v => v.id === voiceId);
  if(!voice) throw new Error('Choose a reference voice first.');
  const permission = A.requestAccess(voice.baseUrl || state.settings.voiceboxUrl);
  const item = phrase(); if(!preview && !item) throw new Error('Choose a phrase first.');
  p.generating = true; generationController = new AbortController(); stopAudio(); render(); notify(preview ? 'Generating a short voice preview…' : 'Generating your reference audio…');
  try {
    if(!await permission) throw new Error('Allow access to your Voicebox address to generate audio.');
    const result = await A.generateVoicebox({baseUrl:voice.baseUrl || state.settings.voiceboxUrl,profileId:voice.profileId,text:preview ? 'Poco a poco, cada día hablo con más confianza.' : item.text,signal:generationController.signal});
    if(!preview) {
      const ref = await D.addReference(item.id,{label:voice.name,kind:'voicebox',audioUrl:result.audioUrl,voiceId:voice.id,accentId:voice.accentId,createdAt:Date.now()});
      state = await D.load(); p.referenceId = ref.id; p.duration = 0; p.start = 0; p.end = 0; p.text = item.text; p.confirmed = false; notify('Reference saved. Listen and check the pronunciation before practicing.');
    } else {p.generating = false; await playUrl(result.audioUrl,0,0,'preview'); notify('Voicebox preview · check the accent and delivery by listening.');}
  } finally {p.generating = false; generationController = null; render();}
}
async function assessAttempt(id) {
  const attempt = state.attempts.find(a => a.id === id); if(!attempt || ui.assessments.has(id)) return;
  if(!state.settings.assessmentEnabled) {settingsDialog(); notify('Enable and configure your speech service, then choose Assess pronunciation again.'); return;}
  const permission = A.requestAccess(state.settings.assessmentUrl);
  const text = attempt.text || attempt.referenceSnapshot?.text;
  if(!text) throw new Error('This older recording has no saved practice text. Record a new attempt for reliable assessment.');
  ui.assessments.add(id); render();
  try {
    if(!await permission) throw new Error('Allow access to the assessment service to assess this recording.');
    const assessment = await A.assess({audioUrl:attempt.audioUrl,text,accentId:attempt.accentId,endpoint:state.settings.assessmentUrl});
    const current = (await D.load()).attempts.find(item => item.id === id);
    if(!current) throw new Error('This recording was removed before its assessment finished.');
    await D.saveAttempt({...current,assessment}); state = await D.load(); notify('Assessment saved with this attempt.');
  } finally {ui.assessments.delete(id); if(!busy()) render();}
}
async function compareTiming(id) {
  const attempt = state.attempts.find(a => a.id === id); if(!attempt) return;
  operation = true; stopAudio();
  try {
    const snap = attempt.referenceSnapshot; let data, segmentDuration;
    if(isAudio(snap?.audioUrl)) {
      const analysis = await A.analyze(snap.audioUrl);
      const trimmed = (snap.start || 0) > 0 || (snap.end && snap.end < analysis.duration - .15);
      if(trimmed) {data = await A.analyze(attempt.audioUrl); segmentDuration = (snap.end || analysis.duration) - (snap.start || 0);}
      else data = await A.compare(snap.audioUrl,attempt.audioUrl);
    } else data = await A.analyze(attempt.audioUrl);
    ui.comparison = {attemptId:id,data,segmentDuration};
  } catch(error) {ui.comparison = {attemptId:id,error:error.message};}
  finally {operation = false; render();}
}
async function exportBackup() {
  const backup = await D.exportBackup(), blob = new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `spanish-studio-${new Date().toISOString().slice(0,10)}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),5000); notify('Studio backup exported, including saved audio.');
}
async function action(name,node) {
  if(busy() && !['record','cancel-generation','close-dialog','stop-audio'].includes(name)) return notify('Finish your current recording or request first.');
  const id = node.dataset.id;
  switch(name) {
    case 'start-phrase': return go('practice',id);
    case 'test-phrase': p.mode = 'test'; return go('practice',id);
    case 'go-practice': return go('practice');
    case 'go-library': return go('library');
    case 'new-phrase': return phraseDialog();
    case 'edit-phrase': return phraseDialog(id);
    case 'open-settings': return settingsDialog();
    case 'edit-voice': return voiceDialog(id);
    case 'close-dialog': if(operation) return; $('#editor-dialog').close(); return;
    case 'upload-reference': return uploadDialog();
    case 'delete-phrase': {
      const item = state.phrases.find(p => p.id === id); if(!item) return;
      if(!confirm(`Delete “${item.text}” and its saved recordings? This cannot be undone without a backup.`)) return;
      stopAudio(); return mutate(() => D.removePhrase(id),'Phrase and its recordings deleted.');
    }
    case 'delete-attempt': if(!confirm('Delete this recording and its saved assessment?')) return; stopAudio(); return mutate(() => D.removeAttempt(id),'Recording deleted.');
    case 'delete-voice': if(!confirm('Remove this voice configuration? Existing reference clips and recordings will remain.')) return; return mutate(() => D.removeVoice(id),'Voice removed. Saved audio is still available.');
    case 'mode': stopAudio(); p.mode = node.dataset.mode; p.testAttemptId = null; ui.attemptId = null; ui.comparison = null; return render();
    case 'toggle-translation': p.translation = !p.translation; return render();
    case 'toggle-loop': p.loop = !p.loop; if(playback.role === 'current') playback.loop = p.loop; return render();
    case 'reset-segment': stopAudio(); Object.assign(p,{start:0,end:0,text:phrase().text,confirmed:false}); return render();
    case 'stop-audio': return stopAudio();
    case 'play-reference': {
      if(hiddenReference()) return;
      const ref = reference();
      if(!ref) return speak(p.text);
      validateSegment(false);
      if(playback.role === 'current' && playback.url === ref.audioUrl && !player.paused) {player.pause(); return;}
      const activeEnd = p.end || (Number.isFinite(player.duration) ? player.duration : 0);
      if(playback.role === 'current' && playback.url === ref.audioUrl && player.currentTime >= p.start && (!activeEnd || player.currentTime < activeEnd - .03)) {await resumePlayer(); return;}
      return playUrl(ref.audioUrl,p.start,p.end,'current',p.loop);
    }
    case 'play-attempt': {if(page === 'practice' && hiddenReference()) return; const attempt = state.attempts.find(a => a.id === id); if(attempt) return playUrl(attempt.audioUrl,0,0,'attempt'); return;}
    case 'play-attempt-reference': {if(hiddenReference()) return; const snap = state.attempts.find(a => a.id === id)?.referenceSnapshot; if(snap) return playUrl(snap.audioUrl,snap.start || 0,snap.end || 0,'snapshot'); return;}
    case 'select-attempt': ui.attemptId = id; ui.comparison = null; stopAudio(); return render();
    case 'open-attempt': {const attempt = state.attempts.find(a => a.id === id); if(!attempt) return; p.mode = 'practice'; go('practice',attempt.phraseId); ui.attemptId = id; return render();}
    case 'record': return record();
    case 'generate-reference': return generate($('#generate-voice').value);
    case 'cancel-generation': generationController?.abort(); return;
    case 'preview-voice': return generate(id,true);
    case 'compare-timing': return compareTiming(id);
    case 'assess-attempt': return assessAttempt(id);
    case 'rate-speaking': {
      const attempt = state.attempts.find(a => a.id === id); if(!attempt) return;
      if(attempt.selfRating) return notify('This attempt is already rated. Record another attempt to review again.');
      return mutate(async () => {await D.saveAttempt({...attempt,selfRating:node.dataset.rating}); await D.rateReview('speaking',attempt.phraseId,node.dataset.rating);},'Speaking review scheduled.');
    }
    case 'save-profile': {
      const index = Number(node.dataset.index), profile = ui.profiles[index]; if(!profile) return;
      const name = $(`#profile-name-${index}`).value.trim(), accentId = $(`#profile-accent-${index}`).value;
      if(!name) throw new Error('Give your reference voice a display name.');
      const existing = state.voices.find(v => v.profileId === profile.id && v.baseUrl === ui.profilesUrl);
      return mutate(() => D.saveVoice({id:existing?.id,profileId:profile.id,name,accentId,baseUrl:ui.profilesUrl}),'Reference voice saved.');
    }
    case 'set-accent': return mutate(() => D.saveSettings({accentId:id}),`${accent(id).label} selected.`);
    case 'review-kind': stopAudio(); ui.reviewKind = node.dataset.kind; ui.revealed = false; return render();
    case 'reveal-card': ui.revealed = true; return render();
    case 'speak-card': {const word = state.vocabulary.find(w => w.id === id); if(word) return speak(word.word); return;}
    case 'rate-card': {
      if(!ui.revealed || ui.reviewed.has(id)) return;
      await mutate(() => D.rateReview('meaning',id,node.dataset.rating),null,false);
      ui.reviewed.add(id); ui.reviewId = null; ui.revealed = false; stopAudio(); return render();
    }
    case 'export-backup': return exportBackup();
    case 'import-backup': $('#backup-file').value = ''; $('#backup-file').click(); return;
  }
}
async function submit(form) {
  if(busy()) return;
  if(form.id === 'voice-connect-form') {
    const baseUrl = $('#voicebox-url').value.trim(), permission = A.requestAccess(baseUrl);
    operation = true; form.querySelector('button').disabled = true;
    try {
      if(!await permission) throw new Error('Allow access to your Voicebox address to load profiles.');
      ui.profiles = await A.listVoiceboxProfiles(baseUrl); ui.profilesUrl = baseUrl;
      await D.saveSettings({voiceboxUrl:baseUrl}); state = await D.load();
      notify(ui.profiles.length ? `${ui.profiles.length} voice profiles found. Assign an accent below.` : 'Connected. Create a voice profile in Voicebox, then load profiles again.');
    } finally {operation = false; render();}
    return;
  }
  if(form.id === 'phrase-form') {
    const id = $('#phrase-id').value, existing = state.phrases.find(p => p.id === id), text = $('#phrase-text').value.trim(), translation = $('#phrase-meaning').value.trim(), sourceUrl = $('#phrase-source').value.trim();
    if(!text) throw new Error('Enter a Spanish phrase.');
    const file = $('#phrase-audio')?.files[0], accentId = $('#phrase-accent')?.value || existing?.accentId || state.settings.accentId;
    operation = true; form.querySelector('[type=submit]').disabled = true;
    try {
      const audioUrl = await fileAudio(file);
      const saved = await D.savePhrase({id:id || undefined,text,translation,source:existing?.source || 'manual',sourceUrl,accentId});
      // Retain the successful write even if attaching audio runs out of storage.
      $('#phrase-id').value = saved.id;
      if(audioUrl) {
        try {await D.addReference(saved.id,{label:file.name.replace(/\.[^.]+$/,''),kind:'upload',audioUrl,accentId,createdAt:Date.now()});}
        catch(error) {throw new Error(`Your phrase is saved, but its audio could not be attached. Retry Save phrase or choose a smaller clip. ${error.message || ''}`);}
        $('#phrase-audio').value = '';
      }
      state = await D.load(); if(saved.id === p.phraseId || !p.phraseId) initPhrase(saved.id);
      $('#editor-dialog').close(); notify('Phrase saved to your library.');
    } finally {operation = false; const save = form.querySelector('[type=submit]'); if(save) save.disabled = false; render();}
    return;
  }
  if(form.id === 'upload-form') {
    const file = $('#reference-file').files[0], label = $('#reference-label').value.trim(), accentId = $('#reference-accent').value, phraseId = p.phraseId;
    if(!file || !label || !$('#reference-confirm').checked) throw new Error('Choose audio, name the reference, and confirm that its text matches.');
    operation = true; form.querySelector('[type=submit]').disabled = true;
    try {
      const audioUrl = await fileAudio(file), ref = await D.addReference(phraseId,{label,kind:'upload',audioUrl,accentId,createdAt:Date.now()});
      state = await D.load(); Object.assign(p,{referenceId:ref.id,start:0,end:0,duration:0,text:phrase().text,confirmed:false});
      $('#editor-dialog').close(); notify('Native reference saved.');
    } finally {operation = false; const save = form.querySelector('[type=submit]'); if(save) save.disabled = false; render();}
    return;
  }
  if(form.id === 'voice-edit-form') {
    const voice = state.voices.find(v => v.id === $('#edit-voice-id').value); if(!voice) throw new Error('This voice is no longer available.');
    const name = $('#edit-voice-name').value.trim(), accentId = $('#edit-voice-accent').value, description = $('#edit-voice-description').value.trim();
    if(!name) throw new Error('Enter a voice name.');
    await mutate(() => D.saveVoice({...voice,name,accentId,description}),'Voice updated.'); $('#editor-dialog').close(); return;
  }
  if(form.id === 'settings-form') {
    const assessmentUrl = $('#assessment-url').value.trim(), assessmentEnabled = $('#assessment-enabled').checked, accentId = $('#settings-accent').value, theme = $('#settings-theme').value;
    const url = new URL(assessmentUrl);
    if(url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw new Error('Use HTTPS or a local loopback HTTP address for your assessment service, without credentials in the URL.');
    await mutate(() => D.saveSettings({assessmentUrl,assessmentEnabled,accentId,theme}),'Studio settings saved.'); window.StudioTheme?.apply(theme); $('#editor-dialog').close(); return;
  }
}
document.addEventListener('click',event => {
  const link = event.target.closest('a[href^="#"]');
  if(link && pages[link.getAttribute('href').slice(1)]) {event.preventDefault(); go(link.getAttribute('href').slice(1)); return;}
  const node = event.target.closest('[data-action]'); if(!node || node.disabled) return;
  event.preventDefault(); Promise.resolve(action(node.dataset.action,node)).catch(report);
});
document.addEventListener('submit',event => {
  if(!['phrase-form','upload-form','voice-connect-form','voice-edit-form','settings-form'].includes(event.target.id)) return;
  event.preventDefault(); submit(event.target).catch(report);
});
document.addEventListener('input',event => {
  const node = event.target;
  if(node.id === 'library-search') {ui.search = node.value; $('#library-results').innerHTML = renderLibraryItems(); $('#filtered-count').textContent = filteredPhrases().length;}
  else if(node.id === 'segment-text' && !busy()) {p.text = node.value; p.confirmed = false; const check = $('#segment-confirm'); if(check) check.checked = false; const text = $('.practice-text'); if(text) text.textContent = p.text;}
  else if(node.id === 'playback-seek' && !busy() && playback.role === 'current' && Number.isFinite(player.duration)) {player.currentTime = Math.max(p.start,Math.min(Number(node.value),p.end || player.duration)); updatePlayback();}
});
document.addEventListener('change',event => {
  const node = event.target;
  const run = async () => {
    if(node.id === 'backup-file') {
      const file = node.files[0]; if(!file) return;
      if(file.size > 100*1024*1024) throw new Error('Choose a studio backup smaller than 100 MB.');
      const backup = JSON.parse(await file.text());
      await mutate(() => D.importBackup(backup),'Studio backup imported. Existing practice has been kept.');
      $('#editor-dialog').close(); return;
    }
    if(busy()) return;
    switch(node.id) {
      case 'global-accent': stopAudio(); return mutate(() => D.saveSettings({accentId:node.value}),`${accent(node.value).label} selected.`);
      case 'library-source': ui.source = node.value; return render();
      case 'practice-phrase': initPhrase(node.value); return render();
      case 'practice-reference': stopAudio(); metadataToken++; Object.assign(p,{referenceId:node.value || null,start:0,end:0,duration:0,text:phrase().text,confirmed:false}); return render();
      case 'playback-speed': p.speed = Number(node.value); player.playbackRate = p.speed; return;
      case 'segment-start': case 'segment-end': return segmentChanged();
      case 'segment-confirm': p.confirmed = node.checked; return;
      case 'reference-file': if(node.files[0] && !$('#reference-label').value) $('#reference-label').value = node.files[0].name.replace(/\.[^.]+$/,''); return;
    }
  };
  run().catch(report);
});
window.addEventListener('hashchange',() => {
  const next = location.hash.slice(1); if(!pages[next]) return;
  if(busy()) {history.replaceState(null,'',`${location.pathname}${location.search}#${page}`); notify('Finish your current recording or request first.'); return;}
  go(next);
});
window.addEventListener('popstate',() => {const next = location.hash.slice(1); if(pages[next] && next !== page) go(next);});
window.addEventListener('beforeunload',event => {if(p.recording || p.starting || p.saving || p.generating) {event.preventDefault(); event.returnValue = '';}});
window.addEventListener('pagehide',() => {stopAudio(); p.recorder?.cancel(); generationController?.abort(); clearInterval(p.timer);});
$('#editor-dialog').addEventListener('cancel',event => {if(operation) event.preventDefault();});
async function boot() {
  $$('[data-icon]').forEach(node => {node.innerHTML = icon(node.dataset.icon);});
  if(!D || !A) throw new Error('Studio files are missing. Reload the extension with study-data.js and study-audio.js included.');
  state = await D.init(); window.StudioTheme?.apply(state.settings.theme || 'system'); page = pages[location.hash.slice(1)] ? location.hash.slice(1) : 'today';
  initPhrase(new URLSearchParams(location.search).get('phrase')); render();
  D.subscribe(async () => {
    const version = ++pendingReload;
    try {
      const fresh = await D.load(); if(version !== pendingReload) return; state = fresh; window.StudioTheme?.apply(state.settings.theme || 'system');
      if(busy()) return; shell();
      if($('#editor-dialog').open || ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) return;
      if(page === 'practice' && phrase()) {
        // Refresh the selector only: never replace the active session or its transcript.
        const select = $('#practice-phrase'); if(select) select.innerHTML = state.phrases.map(item => option(item.id,item.text,p.phraseId)).join('');
      } else render();
    } catch(error) {report(error);}
  });
}
boot().catch(error => {$('#main').innerHTML = `<div class="card">${empty('The studio could not open.',error.message)}</div>`; report(error);});
})();


