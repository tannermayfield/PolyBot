/* Balanced language-learning shell with a Spanish pronunciation studio. */
(() => {
'use strict';
const D = window.StudioData, A = window.StudioAudio, L = window.LearningData;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {
chart:'<path d="M4 20V11m5.5 9V5m5.5 15v-8m5.5 8V8M2.5 20.5h19"/>',
sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
signpost:'<path d="M10 22V4m0 2H3l-2 3 2 3h7m0-8h8l3 3-3 3h-8m-3 12h6"/>',
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
const heading = (title, subtitle, action = '', eyebrow = 'YOUR LEARNING SPACE') => `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>${action}</div>`;
const pages = {home:'Home',personalization:'Personalization',understanding:'How Polybot Understands You','learning-method':'Your Learning Method',interests:'Your Interests',regions:'Regions & Accents','my-path':'My Path',vocabulary:'Vocabulary',grammar:'Grammar',pronunciation:'Pronunciation',media:'Media'};
const aliases = {today:['my-path','overview'],review:['vocabulary','review'],practice:['pronunciation','practice'],library:['pronunciation','library'],progress:['home',null]};
let state, learning, page = 'home', operation = false, toastTimer, pendingReload = 0, mountedPersonalization = null;
const ui = {search:'',source:'all',profiles:[],profilesUrl:'',reviewKind:'meaning',reviewId:null,revealed:false,reviewed:new Set(),comparison:null,attemptId:null,assessments:new Set(),pronunciationTab:'overview',dictionaryResult:null,vocabPractice:'list',grammarTopic:null,mediaResponse:null,resourceView:'home'};
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
const sourceLabel = source => ({starter:'Starter phrase',manual:'Your phrase',web:'From the web',video:'From a video',provided:'Provided practice'}[source] || 'Saved phrase');
const safeLink = value => { try { const u = new URL(value); return ['http:','https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
const isAudio = value => typeof value === 'string' && /^data:audio\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(value);
const accentOptions = selected => D.ACCENTS.map(a => `<option value="${esc(a.id)}"${a.id === selected ? ' selected' : ''}>${esc(a.label)}</option>`).join('');
const option = (value,label,selected) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;
const languages = () => window.SPTubeLang?.LANGUAGES || [];
const languageOptions = selected => languages().map(item => `<option value="${esc(item.code)}"${item.code === selected ? ' selected' : ''}>${esc(item.name)}</option>`).join('');
const targetLang = () => learning?.target || {code:'es',name:'Spanish',speechLang:'es-ES',rtl:false};
const nativeLang = () => learning?.native || {code:'en',name:'English',speechLang:'en-US',rtl:false};
// Learner events (EVENT_TAXONOMY §3). Facts only: never the learner's text, audio or transcripts.
const track = (type, fields = {}) => window.PolybotEvents?.record(type, {surface:'studio', language:targetLang().code, ...fields});
const vocabItemId = (word, code = targetLang().code) => `${code}:${String(word).trim().toLowerCase()}`;
const targetLanguages = () =>learning?.targetLanguages?.length ? learning.targetLanguages : [targetLang()];
const isSpanish = () => targetLang().code === 'es';
const languageByCode = code => [targetLang(),nativeLang()].find(item => item.code === code) || {code,name:code || 'Language',rtl:false};
function resolveRoute(value) {
  if(pages[value]) return [value,null];
  return aliases[value] || ['home',null];
}
async function loadLearning() {
  if(L?.load) return L.load();
  return {target:{code:'es',name:'Spanish',speechLang:'es-ES',rtl:false},native:{code:'en',name:'English',speechLang:'en-US',rtl:false},vocabulary:state?.vocabulary || [],grammarTopics:[],path:[],media:[]};
}
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
  $('#library-count').textContent = isSpanish() ? state.phrases.length : (learning?.media?.length || 0); $('#review-count').textContent = learning?.vocabulary?.length || 0;
  $('#language-context-label').textContent = 'STUDYING NOW';
  const switcher = $('#study-language-switch');
  switcher.innerHTML = targetLanguages().map(item => option(item.code,item.name,targetLang().code)).join('');
  switcher.disabled = targetLanguages().length < 2;
  $('#language-context-note').textContent = targetLanguages().length < 2 ? `Add target languages in Settings · meanings in ${nativeLang().name}` : `Meanings in ${nativeLang().name}`;
  document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr';
  document.title = `${pages[page]} · Polybot`;
}
function initPhrase(id) {
  const item = state.phrases.find(item => item.id === id) || D.dueItems(state,'speaking')[0] || state.phrases[0]; stopAudio();
  Object.assign(p,{phraseId:item?.id || null,referenceId:item?.references.find(r => r.accentId === state.settings.accentId)?.id || item?.references[0]?.id || null,text:item?.text || '',translation:false,start:0,end:0,duration:0,confirmed:false,testAttemptId:null});
  ui.attemptId = null; ui.comparison = null;
}
function render() {
  if(!state) return; if(p.phraseId && !phrase()) initPhrase(); shell();
  mountedPersonalization?.unmount?.(); mountedPersonalization = null;
  const module = {'learning-method':window.PersonalizationMethod,interests:window.PersonalizationInterests,regions:window.PersonalizationRegions}[page];
  if(module) {
    const ctx = {target:targetLang(),notify};
    $('#main').innerHTML = `<div id="personalization-view">${module.render(ctx)}</div>`;
    const cleanup = module.mount($('#personalization-view'),ctx);
    mountedPersonalization = typeof cleanup === 'function' ? {unmount:cleanup} : module;
  } else $('#main').innerHTML = ({home:renderHome,personalization:renderPersonalization,understanding:renderUnderstanding,'my-path':renderMyPath,vocabulary:renderVocabulary,grammar:renderGrammar,pronunciation:renderPronunciation,media:renderMedia}[page])();
  const lockedHub = page === 'home' || page === 'personalization' || (page === 'my-path' && ui.resourceView === 'home') || (page === 'vocabulary' && ui.resourceView === 'home') || (page === 'pronunciation' && ui.pronunciationTab === 'overview') || (page === 'media' && ui.resourceView === 'home');
  document.body.classList.toggle('hub-locked',lockedHub);
  $('#main').classList.toggle('hub-shell',lockedHub);
  if(lockedHub) window.scrollTo(0,0);
  if(page === 'pronunciation' && ui.pronunciationTab === 'practice' && isSpanish()) { prepareReference(); recordingUI(); }
}
function go(next,id) {
  if(busy()) return notify('Finish your recording or audio request first.'); stopAudio(); if(id) initPhrase(id);
  const resolved = resolveRoute(next), changed = page !== resolved[0]; page = resolved[0]; if(changed || next === page) { ui.resourceView = 'home'; ui.grammarTopic = null; ui.mediaResponse = null; ui.pronunciationTab = 'overview'; } if(resolved[1]) ui.pronunciationTab = resolved[1];
  if(location.hash !== `#${page}`) history.pushState(null,'',`${location.pathname}${location.search}#${page}`); render();
  if(changed) { window.scrollTo(0,0); $('#main').focus({preventScroll:true}); }
}
async function reload(paint = true) { [state,learning] = await Promise.all([D.load(),loadLearning()]); window.StudioTheme?.apply(state.settings.theme || 'system'); paint ? render() : shell(); }
async function mutate(callback,message,paint = true) {
  if(operation) return; operation = true;
  try { const result = await callback(); [state,learning] = await Promise.all([D.load(),loadLearning()]); window.StudioTheme?.apply(state.settings.theme || 'system'); if(message) notify(message); return result; }
  finally {operation = false; paint ? render() : shell();}
}
// Self-marked completion is self-report, never demonstrated mastery (EVENT_TAXONOMY §3.2).
async function completeLesson(id,message) {
  let completed = false;
  await mutateLearning(async () => { await L.completeActivity(id); completed = true; },message);
  if(completed) track('lesson_completed',{context:{lesson_id:id},payload:{completion:'self_marked'}});
}
async function mutateLearning(callback,message) {
  if(!L) throw new Error('Learning data is unavailable. Reload the extension and try again.');
  if(operation) return; operation = true;
  try { await callback(); learning = await L.load(); if(message) notify(message); }
  finally { operation = false; render(); }
}
const feature = (action,title,description,name,attrs = '') => `<button type="button" class="feature-choice" data-action="${action}" ${attrs}><span class="feature-icon">${icon(name)}</span><span class="feature-copy"><strong>${title}</strong><span>${description}</span></span><span class="feature-arrow">${icon('arrow')}</span></button>`;
const hubHeading = (title,subtitle,eyebrow = 'YOUR LEARNING SPACE') => `<header class="hub-header"><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${subtitle}</p></header>`;
const hubLink = (route,title,description,name,meta = '') => `<a class="feature-choice hub-link" href="#${route}"><span class="feature-icon">${icon(name)}</span><span class="feature-copy"><strong>${title}</strong><span>${description}</span>${meta ? `<small>${meta}</small>` : ''}</span><span class="feature-arrow">${icon('arrow')}</span></a>`;
const back = (label) => `<div class="feature-back">${btn('resource-home',`← ${label}`,null)}</div>`;
function featureFocus() { window.scrollTo(0,0); $('#main').focus({preventScroll:true}); }
const personalizationItems = [
  ['learning-method','Your Learning Method','Discover your balance of listening and doing, explore grammar your way, and choose how you like to practice.','cards','01','Find your approach'],
  ['interests','Your Interests','From food and travel to science and sport, choose up to 10 interests to shape future examples and scenarios.','sun','02','Choose your interests'],
  ['regions','Regions & Accents','Explore the Spanish-speaking world. Get to know regional expressions and find a voice you connect with.','globe','03','Explore Spanish accents'],
  ['understanding','How Polybot Understands You','See what Polybot has learned from your practice, how sure it is, and how it is adapting.','chart','04','See your learning profile']
];
function renderPersonalizationCards() {
  return personalizationItems.map(([route,title,description,symbol,index,cta]) => `<a class="card home-personalization-card" href="#${route}"><div class="home-card-top"><span class="home-card-icon">${icon(symbol)}</span><span>${index}</span></div><h3>${title}</h3><p>${description}</p><span class="home-card-cta">${cta}${icon('arrow')}</span></a>`).join('');
}
function renderHome() {
  const next = (learning?.path || []).find(item => !item.completed);
  const topics = learning?.grammarTopics || [], done = topics.filter(item => item.completed).length;
  const percent = topics.length ? Math.round(done / topics.length * 100) : 0;
  const vocabulary = learning?.vocabulary?.length || 0, recordings = isSpanish() ? state.attempts.length : 0, mediaDone = (learning?.media || []).filter(item => item.completed).length;
  return `<div class="hub-page home-page">${hubHeading('What would you like to practice?',`${esc(targetLang().name)} · Pick one area and give it your full attention.`,'WELCOME BACK')}<div class="feature-grid hub-grid" data-count="6">${hubLink('my-path','My Path',next ? `Up next: ${esc(next.title)}` : 'Follow your guided course.','signpost',`${percent}% complete`)}${hubLink('personalization','Personalization','Shape the examples, topics, and voices you meet.','sun','3 preference areas')}${hubLink('vocabulary','Vocabulary','Build recall from the words you save.','cards',`${vocabulary} saved ${vocabulary === 1 ? 'word' : 'words'}`)}${hubLink('grammar','Grammar','Explore principles and complete focused practice.','library',`${done}/${topics.length} practiced`)}${hubLink('pronunciation','Pronunciation','Train your ear, rhythm, and speaking confidence.','wave',`${recordings} ${recordings === 1 ? 'recording' : 'recordings'}`)}${hubLink('media','Media','Read, listen, and respond to meaningful material.','headphones',`${mediaDone} completed`)}</div></div>`;
}
// ── How Polybot Understands You (Phase 7): rendering lives in insights-dashboard.js.
const Dash = window.PolybotDashboard;
function lessonTitle(id) {
  const topic = (learning?.grammarTopics || []).find(item => item.id === id);
  return topic ? topic.title : String(id).split(':').pop().replace(/-/g,' ');
}
function topicLabels() {
  return Object.fromEntries((window.PersonalizationInterests?.CATEGORIES || []).flatMap(c => c.items.map(i => [i.id,i.label])));
}
// Called from render(): mark loading now, fetch on the next tick. Running synchronously would
// render the result inside the outer render(), which then overwrites it with "Loading…".
function startUnderstandingLoad() {
  const language = targetLang().code;
  ui.understanding = {state:'loading',language};
  setTimeout(() => loadUnderstanding(language),0);
}
async function loadUnderstanding(language) {
  let next;
  if(!insightsAvailable()) next = {state:'preview',language};
  else {
    try { next = {...await runtimeMessage('INSIGHTS_LEARNER',{language}),language}; }
    catch(error) { next = {state:'error',error:error.message,language}; }
  }
  if(ui.understanding?.language !== language || ui.understanding.state !== 'loading') return;
  ui.understanding = next; ui.shownRecommendations = new Set();
  if(page === 'understanding') render();
}
function renderUnderstanding() {
  if(!Dash) return empty('This page is unavailable.','Reload the extension and try again.');
  const u = ui.understanding;
  if(!u || (u.state !== 'sample' && u.language !== targetLang().code)) { startUnderstandingLoad(); return '<div class="understanding-page"><p class="muted" role="status">Loading your learning profile…</p></div>'; }
  if(u.state === 'loading') return '<div class="understanding-page"><p class="muted" role="status">Loading your learning profile…</p></div>';
  const helpers = {lessonTitle,topics:topicLabels(),languageName:targetLang().name};
  if(u.state === 'sample') return Dash.render(Dash.SAMPLE,{...helpers,languageName:'Spanish'});
  if(u.state === 'ready') { setTimeout(() => recordShown(u),0); return Dash.render({model:u.model,decisions:u.decisions},helpers); }
  return Dash.emptyState(u.state,u.error);
}
// recommendation_shown once per displayed recommendation per visit: the denominator of acceptance (spec §28).
function recordShown(u) {
  if(ui.understanding !== u || page !== 'understanding') return;
  ui.shownRecommendations = ui.shownRecommendations || new Set();
  for(const rec of Dash.shownRecommendations(u.decisions)) {
    if(ui.shownRecommendations.has(rec.recommendation_id)) continue;
    ui.shownRecommendations.add(rec.recommendation_id);
    track('recommendation_shown',{context:{recommendation_id:rec.recommendation_id,decision_id:rec.decision_id},payload:{placement:'dashboard',rank:rec.rank}});
  }
}
function openRecommendation(node) {
  const {id,targetType,targetId} = node.dataset;
  if(ui.understanding?.state === 'ready') track('recommendation_accepted',{context:{recommendation_id:id},payload:{}});
  if(targetType === 'lesson') { go('grammar'); ui.grammarTopic = targetId; track('lesson_started',{context:{lesson_id:targetId},payload:{entry:'recommendation'}}); render(); return featureFocus(); }
  if(targetType === 'topic') return go('interests');
  const skill = targetType === 'skill' ? targetId : 'vocabulary';
  if(skill === 'vocabulary') { go('vocabulary'); ui.resourceView = 'practice'; ui.vocabPractice = 'recall'; ui.revealed = false; newRecallQuestion(); render(); return featureFocus(); }
  go(skill === 'pronunciation' ? 'pronunciation' : skill.startsWith('grammar') ? 'grammar' : 'media');
}
function renderPersonalization() {
  return `<div class="personalization-page hub-page">${hubHeading('Make it yours.','Shape your learning around how you practice, what interests you, and the voices you want to hear.','PERSONALIZATION')}<section class="home-personalization personalization-page-content" aria-labelledby="personalization-title"><div class="home-personalization-grid hub-grid" data-count="${personalizationItems.length}">${renderPersonalizationCards()}</div></section></div>`;
}
function renderMyPath() {
  const steps = learning?.path || [];
  const currentStep = steps.findIndex(item => !item.completed);
  const grammarDone = (learning?.grammarTopics || []).filter(item => item.completed).length, grammarTotal = learning?.grammarTopics?.length || 0, mediaDone = (learning?.media || []).filter(item => item.completed).length, mediaTotal = learning?.media?.length || 0;
  const pathSteps = `<section class="card path-course-map">${steps.length ? steps.map((item,index) => `<article class="path-step ${item.completed ? 'completed' : index === currentStep ? 'current' : ''}"><span class="step-number">${String(index + 1).padStart(2,'0')}</span><div><p class="eyebrow">${esc(item.level || 'COURSE')}</p><h3>${esc(item.title)}</h3><p>${esc(item.description)}</p><p class="phrase-meta">${Number(item.progress?.completed || 0)} of ${Number(item.progress?.total || item.topicIds?.length || 0)} topics complete</p></div><a class="button small" href="#grammar">Explore</a></article>`).join('') : empty('Your course map is getting ready.','Explore the resource areas while the curriculum loads.')}</section>`;
  const balance = `<aside class="card skill-balance path-balance-detail"><h2>Your skill balance</h2><p>Only activity you complete or save appears here.</p><div><span>Vocabulary</span><span>Saved words</span><small>${learning?.vocabulary?.length || 0}</small></div><div><span>Grammar</span><progress max="${Math.max(1,grammarTotal)}" value="${grammarDone}"></progress><small>${grammarDone}/${grammarTotal}</small></div><div><span>Pronunciation</span><span>Recordings</span><small>${isSpanish() ? state.attempts.length : 0}</small></div><div><span>Media</span><progress max="${Math.max(1,mediaTotal)}" value="${mediaDone}"></progress><small>${mediaDone}/${mediaTotal}</small></div></aside>`;
  if(ui.resourceView === 'course') return `${back('My Path')}${pathSteps}`;
  if(ui.resourceView === 'balance') return `${back('My Path')}${balance}`;
  const next = steps.find(item => !item.completed);
  return `<div class="hub-page my-path-hub">${hubHeading('Build the whole language.','Choose the part of your path you want to explore.','MY PATH')}<div class="feature-grid hub-grid" data-count="3">${feature('resource-view','Course map',next ? `Continue with ${esc(next.title)}.` : 'Review your guided sequence.','signpost','data-view="course"')}${feature('resource-view','Skill balance','See how your completed work is distributed.','chart','data-view="balance"')}${hubLink('grammar','Grammar curriculum','Open every principle and its focused practice.','library',`${grammarDone}/${grammarTotal} practiced`)}</div></div>`;
}
function renderDictionaryResult() {
  const result = ui.dictionaryResult; if(!result) return '<p class="muted">Look up a word or short phrase to see a saved meaning or request a translation.</p>';
  if(result.status === 'unavailable') return `<div class="inline-note neutral">${icon('info')}<span>${esc(result.message || 'Translation lookup is available when the extension is running in Chrome.')}</span></div>`;
  const translation = result.translation || result.meaning || result.definition, source = languageByCode(result.sourceLang || targetLang().code), destination = languageByCode(result.targetLang || nativeLang().code);
  return `<div><p class="eyebrow">${esc(source.name)} → ${esc(destination.name)}</p><h2 dir="${source.rtl ? 'rtl' : 'ltr'}">${esc(result.term || '')}</h2><p class="flashcard-meaning" dir="${destination.rtl ? 'rtl' : 'ltr'}">${esc(translation || 'No saved meaning yet.')}</p>${result.source === 'saved' ? '<span class="badge">Saved vocabulary</span>' : '<span class="badge outline">Translation result</span>'}</div>`;
}
// ── Quick recall (ADR-004, ADR-017): logic in vocab-recall.js, events here.
const R = window.VocabRecall;
function newRecallQuestion() {
  ui.recall = R?.buildQuestion(learning?.vocabulary || [],{language:targetLang().code,avoidId:ui.recall?.wordId}) || null;
}
function leaveRecall(how) {
  const q = ui.recall, reason = R?.skipReason(q,how);
  if(reason) track('content_skipped',{context:{exercise_id:q.exerciseId,vocab_item_id:q.vocabItemId},payload:{reason}});
}
function renderRecall() {
  const close = `<button class="icon-button" data-action="close-vocab-practice" aria-label="Close quick recall">${icon('close')}</button>`;
  const status = R ? R.readiness(learning?.vocabulary) : {ready:false,needed:R?.MIN_WORDS || 4};
  if(!status.ready) return `<section class="card practice-panel"><div class="section-head"><div><p class="eyebrow">QUICK RECALL</p><h2>Almost ready.</h2></div>${close}</div>${empty(`Save ${status.needed} more ${status.needed === 1 ? 'word' : 'words'} with meanings.`,`Quick recall builds four choices from your own ${esc(targetLang().name)} words, so it needs at least ${R?.MIN_WORDS || 4} saved words that have meanings.`)}</section>`;
  if(!ui.recall || !ui.recall.vocabItemId.startsWith(`${targetLang().code}:`)) newRecallQuestion();
  const q = ui.recall, forward = q.direction === 'forward', dir = targetLang().rtl ? 'rtl' : 'ltr';
  const choiceDir = forward ? 'auto' : dir;
  const feedback = q.solved ? (q.attempts === 1 ? 'Correct on the first try.' : 'Correct.') : q.attempts ? 'Not quite. Try another choice.' : '';
  const choices = q.choices.filter(c => !q.eliminated.includes(c.id)).map(c => {
    const picked = q.picked.includes(c.id), state = picked ? (c.correct ? ' is-correct' : ' is-wrong') : (q.solved && c.correct ? ' is-correct' : '');
    return `<button class="recall-choice${state}" data-action="recall-answer" data-id="${esc(c.id)}" dir="${choiceDir}"${picked || q.solved ? ' disabled' : ''}>${esc(c.label)}</button>`;
  }).join('');
  const controls = q.solved ? btn('recall-next','Next word',null,'primary')
    : `${btn('recall-hint','Remove a wrong choice',null,'small')}${btn('recall-skip','Skip',null,'small')}`;
  return `<section class="card practice-panel recall-panel"><div class="section-head"><div><p class="eyebrow">QUICK RECALL · ${forward ? 'CHOOSE THE MEANING' : 'CHOOSE THE WORD'}</p><h2 dir="${forward ? dir : 'auto'}">${esc(q.prompt)}</h2></div>${close}</div><div class="recall-choices">${choices}</div><p class="recall-feedback" role="status" aria-live="polite">${esc(feedback)}</p><div class="flex-row">${controls}</div></section>`;
}
function renderVocabularyPractice() {
  if(ui.vocabPractice === 'recall') return renderRecall();
  const words = learning?.vocabulary || [], item = words.find(word => word.id === ui.reviewId) || words.find(word => word.meaning) || words[0];
  if(ui.vocabPractice === 'list') return '';
  if(!item) return `<section class="card practice-panel">${empty('Save a word to begin.','Words captured with the extension will appear here for practice.')}</section>`;
  const listening = ui.vocabPractice === 'listening';
  return `<section class="card practice-panel"><div class="section-head"><div><p class="eyebrow">${listening ? 'LISTENING PRACTICE' : 'MEANING PRACTICE'}</p><h2>${listening && !ui.revealed ? 'Listen, then recall.' : esc(item.word)}</h2></div><button class="icon-button" data-action="close-vocab-practice" aria-label="Close practice">${icon('close')}</button></div><div class="flashcard"><div>${listening ? btn('speak-learning-word','Hear the word','headphones','soft',`data-id="${esc(item.id)}"`) : btn('speak-learning-word','Listen','play','small',`data-id="${esc(item.id)}"`)}${ui.revealed ? `<h2 class="flashcard-word" dir="${targetLang().rtl ? 'rtl' : 'ltr'}">${esc(item.word)}</h2><p class="flashcard-meaning">${esc(item.meaning || 'No meaning saved yet.')}</p>` : `<p class="flashcard-context">Bring the meaning to mind, then reveal it.</p>${btn('reveal-learning-word','Reveal meaning',null,'primary')}`}</div></div>${ui.revealed ? `<div class="review-ratings">${[['again','Again'],['hard','Hard'],['good','Good'],['easy','Easy']].map(([rating,label]) => `<button data-action="rate-learning-word" data-id="${esc(item.id)}" data-rating="${rating}">${label}<small>Next word</small></button>`).join('')}</div>` : ''}</section>`;
}
function renderVocabulary() {
  if(ui.resourceView === 'practice') return back('Vocabulary') + renderVocabularyPractice();
  if(ui.resourceView === 'words') return back('Vocabulary') + renderVocabularyDetail();
  if(ui.resourceView === 'lists') return back('Vocabulary') + renderVocabularyLists();
  if(ui.resourceView === 'dictionary') return back('Vocabulary') + renderDictionary();
  return `<div class="hub-page vocabulary-home">${hubHeading('Choose a vocabulary tool.','Look something up, organize saved words, or start a focused recall session.','VOCABULARY')}<div class="feature-grid hub-grid" data-count="6">${feature('vocab-practice','Quick Recall',R?.readiness(learning.vocabulary).ready ? 'Pick the right meaning from four of your own words.' : `Unlocks with ${R?.MIN_WORDS || 4} saved words that have meanings.`,'check','data-mode="recall"')}${feature('resource-view','Dictionary',`Search ${esc(nativeLang().name)} and ${esc(targetLang().name)}.`,`search`,'data-view="dictionary"')}${feature('resource-view','All My Words',`${learning.vocabulary.length} saved words in one place.`,'library','data-view="words"')}${feature('resource-view','My Vocab Lists','Browse your Learning and Known lists.','cards','data-view="lists"')}${feature('vocab-practice','Meaning Cards','Recall a word, then check its meaning.','cards','data-mode="meaning"')}${feature('vocab-practice','Listening Cards','Hear a word and practice recognition.','headphones','data-mode="listening"')}</div></div>`;
}
function renderDictionary() { return `<section class="card dictionary-card"><div class="dictionary-heading"><div><p class="eyebrow">BILINGUAL DICTIONARY</p><h2>${esc(nativeLang().name)} ↔ ${esc(targetLang().name)}</h2><p>Enter either language. The dictionary recognizes the direction automatically.</p></div></div><form id="dictionary-form" class="dictionary-form"><label class="sr-only" for="dictionary-term">Word or short phrase in ${esc(nativeLang().name)} or ${esc(targetLang().name)}</label><input id="dictionary-term" name="term" required maxlength="200" placeholder="Search in ${esc(nativeLang().name)} or ${esc(targetLang().name)}…"><button class="button primary" type="submit">${icon('search')}Look up</button></form><div id="dictionary-result" class="dictionary-result" role="status">${renderDictionaryResult()}</div></section>`; }
function renderWordRows(words,emptyTitle,emptyText) {
  return `<div class="card vocab-list">${words.length ? words.map(item => `<div class="phrase-row"><div class="phrase-details"><p class="phrase-title" dir="${targetLang().rtl ? 'rtl' : 'ltr'}">${esc(item.word)}</p><p class="phrase-translation">${esc(item.meaning || 'Save a meaning from a webpage to make this ready for recall practice.')}</p><div class="phrase-meta">${Number(item.definitionCount || item.definitions?.length || 0)} saved ${Number(item.definitionCount || item.definitions?.length || 0) === 1 ? 'definition' : 'definitions'}</div></div>${btn('speak-learning-word','Listen','play','small',`data-id="${esc(item.id)}"`)}</div>`).join('') : empty(emptyTitle,emptyText)}</div>`;
}
function renderVocabularyDetail() {
  const words = learning?.vocabulary || [];
  return `<div class="vocab-resource-grid" aria-label="All My Words"><section>${renderWordRows(words,'Your vocabulary is ready for its first word.','Use the extension on a webpage to save one.')}</section></div>`;
}
function renderVocabularyLists() {
  const words = learning?.vocabulary || [], learningWords = words.filter(item => item.status === 'learning'), knownWords = words.filter(item => item.status === 'known');
  return `<section class="vocab-lists-view" aria-label="My Vocab Lists"><div class="vocab-list-collections"><section><div class="section-head"><div><h3>Learning</h3><p>${learningWords.length} ${learningWords.length === 1 ? 'word' : 'words'}</p></div></div>${renderWordRows(learningWords,'No learning words yet.','Words you mark as Learning will appear here.')}</section><section><div class="section-head"><div><h3>Known</h3><p>${knownWords.length} ${knownWords.length === 1 ? 'word' : 'words'}</p></div></div>${renderWordRows(knownWords,'No known words yet.','Words you mark as Known will appear here.')}</section></div></section>`;
}
function renderGrammar() {
  const topics = learning?.grammarTopics || [], selected = topics.find(item => item.id === ui.grammarTopic);
  if(selected) return `${btn('close-grammar-practice','← Back to grammar principles',null)}<section class="card practice-panel" id="grammar-practice"><div class="section-head"><div><p class="eyebrow">${esc(selected.level)} PRACTICE</p><h2>${esc(selected.title)}</h2></div><button class="icon-button" data-action="close-grammar-practice" aria-label="Close grammar practice">${icon('close')}</button></div><p>${esc(selected.practice?.instruction || 'Use examples from a trusted source, then make the pattern your own.')}</p><ol>${(selected.practice?.steps || ['Notice the pattern in two examples.','Transform one example.','Create a sentence of your own.']).map(step => `<li>${esc(step)}</li>`).join('')}</ol><div class="field"><label for="grammar-practice-response">Your practice notes</label><textarea id="grammar-practice-response" maxlength="2000" placeholder="Write examples, transformations, or questions here…"></textarea><small>Notes in this draft are not saved yet.</small></div>${btn('complete-grammar','Mark practice complete','check','primary',`data-id="${esc(selected.id)}"`)}</section>`;
  const groups = [
    ['Beginner',['A1','A2']],
    ['Intermediate',['B1','B2']],
    ['Advanced',['C1']]
  ];
  return groups.map(([label,levels]) => {
    const items = topics.filter(item => levels.includes(item.level));
    return `<section class="level-section"><div class="level-heading"><h2>${label}</h2><span class="badge">${items.filter(item => item.completed).length}/${items.length} practiced</span></div><div class="topic-grid">${items.map(item => `<button type="button" class="card topic-card topic-choice" data-action="open-grammar-practice" data-id="${esc(item.id)}"><span class="badge ${item.completed ? 'violet' : 'outline'}">${item.completed ? 'Practiced' : esc(item.level)}</span><h3>${esc(item.title)}</h3><p>${esc(item.description)}</p><span class="feature-arrow">${icon('arrow')}</span></button>`).join('')}</div></section>`;
  }).join('');
}
function renderPronunciationOverview() {
  if(!isSpanish()) return `<div class="feature-grid hub-grid" data-count="2">${feature('open-listening','Listen and respond',`Practice with your saved ${esc(targetLang().name)} material.`,'headphones')}${hubLink('media','Your media','Open saved reading and listening material.','cards')}</div>`;
  return `<div class="feature-grid hub-grid" data-count="2">${feature('pronunciation-tab','Shadowing','Listen, imitate, and compare your recording.','mic','data-tab="practice" data-pronunciation-view="studio"')}${feature('pronunciation-tab','Phrase library','Choose a phrase or add a reference clip.','library','data-tab="library" data-pronunciation-view="library"')}</div>`;
}
function renderPronunciation() {
  if(!isSpanish() || ui.pronunciationTab === 'overview') return `<div class="hub-page pronunciation-hub">${hubHeading('Find your voice.','Choose a focused way to listen, imitate, and speak with more confidence.','PRONUNCIATION')}${renderPronunciationOverview()}</div>`;
  return back('Pronunciation') + (ui.pronunciationTab === 'practice' ? renderPractice() : renderLibrary());
}
function renderMediaInteraction(item) {
  if(ui.mediaResponse !== item.id) return '';
  const savedWriting = item.responses?.writing?.text || '', savedSpeaking = item.responses?.speaking?.text || '';
  return `<div class="interaction-panel"><div class="section-head"><h3>Respond to this item</h3><button class="icon-button" data-action="close-media-response" aria-label="Close response panel">${icon('close')}</button></div><form id="media-response-form"><input type="hidden" id="media-item-id" value="${esc(item.id)}"><div class="field"><label for="media-writing-response">Writing response</label><textarea id="media-writing-response" maxlength="4000" dir="${targetLang().rtl ? 'rtl' : 'ltr'}" placeholder="Summarize it, answer it, or use one idea in your own sentence…">${esc(savedWriting)}</textarea></div><div class="inline-note neutral">${icon('mic')}<span><strong>Speak aloud:</strong> summarize the item without reading, then say one personal response. Use the button to hear the source again before you begin.</span></div><div class="flex-row">${item.audioUrl ? btn('play-media-audio','Hear source again','play','small',`data-id="${esc(item.id)}"`) : btn('speak-media','Hear source again','headphones','small',`data-id="${esc(item.id)}"`)}</div><div class="field"><label for="media-speaking-response">Reflection after speaking aloud</label><textarea id="media-speaking-response" maxlength="4000" placeholder="What did you say comfortably? Which words or structures need another try?">${esc(savedSpeaking)}</textarea><small>This stores your speaking reflection. Audio recording for media responses is planned for a later version.</small></div><button class="button primary" type="submit">Save responses</button></form></div>`;
}
function renderMediaCards(items, allowResponse = true) {
  if(!items.length) return `<div class="card">${empty('Nothing here yet.','New material will appear here as it becomes available.')}</div>`;
  return `<div class="media-grid">${items.map(item => {
    const canRespond = allowResponse && item.experience !== 'carefree';
    return `<article class="card media-card"><div class="card-top"><span class="media-kind">${item.kind === 'listening' ? icon('headphones') : icon('library')}${esc(item.kind || 'reading')}</span><span class="badge ${item.completed ? 'violet' : 'outline'}">${item.completed ? 'Completed' : item.origin === 'provided' ? 'Provided' : 'Saved'}</span></div><h2 dir="${targetLang().rtl ? 'rtl' : 'ltr'}">${esc(item.text)}</h2><p>${esc(item.translation || 'No translation saved.')}</p><div class="phrase-meta">${esc(sourceLabel(item.source))}${safeLink(item.sourceUrl) ? ` · <a href="${esc(safeLink(item.sourceUrl))}" target="_blank" rel="noopener">Open source</a>` : ''}</div><div class="flex-row">${item.audioUrl ? btn('play-media-audio','Listen','play','small',`data-id="${esc(item.id)}"`) : btn('speak-media',item.kind === 'listening' ? 'Listen' : 'Read aloud','headphones','small',`data-id="${esc(item.id)}"`)}${canRespond ? btn('open-media','Write or speak','edit','small',`data-id="${esc(item.id)}"`) : ''}${!item.completed ? btn('complete-media','Mark complete','check','small',`data-id="${esc(item.id)}"`) : ''}</div>${canRespond ? renderMediaInteraction(item) : ''}</article>`;
  }).join('')}</div>`;
}
function renderMedia() {
  const media = learning?.media || [];
  if(ui.resourceView === 'home') return `<div class="hub-page media-hub">${hubHeading('Learn through meaningful media.','Choose a mode, then explore material at your own pace.','MEDIA')}<div class="feature-grid hub-grid" data-count="3">${feature('resource-view','Read','Provided reading practice.','library','data-view="reading"')}${feature('resource-view','Listen','Provided listening practice.','headphones','data-view="listening"')}${feature('resource-view','Your Media','Everything you saved from the browser extension.','cards','data-view="saved"')}</div></div>`;
  let items = ui.resourceView === 'saved' ? media.filter(item => item.origin === 'saved') : media.filter(item => item.origin === 'provided' && item.kind === ui.resourceView);
  if(ui.mediaResponse) items = items.filter(item => item.id === ui.mediaResponse);
  if(ui.mediaResponse) return `${btn('close-media-response','← Back to media',null)}${renderMediaCards(items,true)}`;
  if(ui.resourceView === 'saved') return `${back('Media')}<section class="media-library-groups">${renderMediaCards(items,true)}</section>`;
  const interactive = items.filter(item => item.experience === 'interactive'), carefree = items.filter(item => item.experience !== 'interactive');
  return `${back('Media')}<section class="media-library-groups"><div class="media-section"><div class="section-head"><h2>Interactive ${ui.resourceView === 'listening' ? 'listening' : 'reading'}</h2><span class="badge">Response included</span></div>${renderMediaCards(interactive,true)}</div><div class="media-section"><div class="section-head"><h2>Care-free ${ui.resourceView === 'listening' ? 'listening' : 'reading'}</h2><span class="badge">Enjoy at your pace</span></div>${renderMediaCards(carefree,false)}</div></section>`;
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
  <aside><div class="section-head"><h2>Your listening direction</h2></div><div class="card accent-card"><div class="accent-art"><span class="accent-code">${esc(a.id)}</span><span class="small-wave">${icon('wave')}</span></div><h3>${esc(a.label)}</h3><p>${esc(a.description || 'Explore regional Spanish with your own reference voices.')}</p>${btn('open-settings','Language settings','settings','small')}</div><div class="inline-note neutral">${icon('cards')}<span>Know the word. Learn to say it.<br>Vocabulary and speaking reviews progress separately.</span></div></aside></div>`;
}
function filteredPhrases() { const q = ui.search.trim().toLocaleLowerCase(); return state.phrases.filter(item => (ui.source === 'all' || item.source === ui.source) && (!q || `${item.text} ${item.translation || ''}`.toLocaleLowerCase().includes(q))); }
function renderLibrary() {
  return `<div class="toolbar"><div class="search-wrap">${icon('search')}<label class="sr-only" for="library-search">Search phrases and meanings</label><input id="library-search" type="search" placeholder="Search your phrases…" value="${esc(ui.search)}"></div><label class="sr-only" for="library-source">Filter by source</label><select id="library-source" class="filter-select">${[['all','All sources'],['web','Web pages'],['video','Videos'],['manual','Your phrases'],['starter','Starter phrases']].map(([v,l]) => option(v,l,ui.source)).join('')}</select>${btn('new-phrase','Add a phrase','plus','primary')}</div><div class="section-head"><p class="muted"><span id="filtered-count">${filteredPhrases().length}</span> phrases · ${state.vocabulary.length} saved vocabulary words</p></div><div id="library-results">${renderLibraryItems()}</div>${note('Save words and phrases from websites with the extension. Your Spanish captures appear here automatically.','neutral')}`;
}
function renderLibraryItems() {
  const items = filteredPhrases();
  return items.length ? `<div class="library-grid">${items.map(item => `<article class="card library-card"><div class="card-top"><span class="badge ${item.source === 'starter' ? '' : 'violet'}">${esc(sourceLabel(item.source))}</span><div class="card-actions"><button class="icon-button" data-action="edit-phrase" data-id="${esc(item.id)}" aria-label="Edit phrase: ${esc(item.text)}">${icon('edit')}</button><button class="icon-button" data-action="delete-phrase" data-id="${esc(item.id)}" aria-label="Delete phrase: ${esc(item.text)}">${icon('trash')}</button></div></div><h2 class="phrase-title" lang="es">${esc(item.text)}</h2><p class="phrase-translation">${esc(item.translation || 'No meaning added yet.')}</p><div class="card-bottom"><div class="phrase-meta">${icon('headphones')}${item.references.length ? `${item.references.length} references` : 'Text only'}${safeLink(item.sourceUrl) ? `<a class="source-link" href="${esc(safeLink(item.sourceUrl))}" target="_blank" rel="noopener">Source</a>` : ''}</div>${btn('start-phrase','Practice','arrow','small',`data-id="${esc(item.id)}"`)}</div></article>`).join('')}</div>` : `<div class="card">${empty(ui.search || ui.source !== 'all' ? 'No matching phrases.' : 'Start with something useful.','Add Spanish text and an optional recording from a native speaker.',btn('new-phrase','Add a phrase','plus','small'))}</div>`;
}
function renderPractice() {
  if(!p.phraseId) initPhrase();
  const item = phrase(), ref = reference(), attempt = latest(), hidden = hiddenReference(), disabled = busy() ? ' disabled' : '';
  if(!item) return `<div class="card">${empty('Choose your first phrase.','Add a Spanish phrase to start listening and recording.',btn('new-phrase','Add a phrase','plus','primary'))}</div>`;
  return `<div class="toolbar"><label class="sr-only" for="practice-phrase">Choose a phrase</label><select id="practice-phrase"${disabled}>${state.phrases.map(item => option(item.id,item.text,p.phraseId)).join('')}</select><span class="badge outline">${icon('mic')} ${attempts(item.id).length} attempts</span></div>
  <div class="practice-layout"><div class="practice-main"><section class="card practice-card" aria-label="Shadowing player"><div class="practice-toolbar"><div class="segmented" aria-label="Session mode">${[['practice','Guided practice'],['test','Test yourself']].map(([v,l]) => `<button data-action="mode" data-mode="${v}" aria-pressed="${p.mode === v}" class="${p.mode === v ? 'active' : ''}"${disabled}>${l}</button>`).join('')}</div><span class="practice-source">${icon('globe')}${esc(sourceLabel(item.source))}</span></div>
  <div class="practice-copy"><h2 class="practice-text" lang="es">${esc(p.text)}</h2>${p.translation ? `<p class="practice-translation">${esc(item.translation || 'No translation yet. Add one in your library.')}</p>` : ''}<button class="translation-toggle" data-action="toggle-translation"${disabled}>${p.translation ? 'Hide' : 'Show'} meaning</button></div>
  ${hidden ? `<div class="practice-empty-test">${icon('lock')}Read this phrase aloud before hearing the reference.<br>Your reference unlocks after you save an attempt.</div>` : `<div class="player"><div class="player-top"><span class="player-label">${icon('headphones')}${ref ? esc(ref.label) : 'Browser speech · accent may differ'}</span><span class="playback-time" id="playback-time">${clipTime(0)} / ${clipTime(p.duration)}</span></div><div class="player-main"><button class="player-button" data-action="play-reference" aria-label="Play reference"${disabled}>${icon('play')}</button><div class="player-track"><label class="sr-only" for="playback-seek">Playback position</label><input id="playback-seek" type="range" min="0" max="${p.duration || 1}" step="0.05" value="0"${!ref || busy() ? ' disabled' : ''}><p>${ref ? 'Listen once, then speak along with the reference.' : 'Add native audio for regional shadowing.'}</p></div></div><div class="player-tools"><button class="loop-button ${p.loop ? 'active' : ''}" data-action="toggle-loop" aria-pressed="${p.loop}"${!ref || busy() ? ' disabled' : ''}>${icon('loop')}Loop segment</button><div class="flex-row"><label for="playback-speed" class="sr-only">Playback speed</label><select id="playback-speed" class="compact-select"${disabled}>${[.6,.75,.9,1,1.1].map(n => option(n,`${n}× speed`,p.speed)).join('')}</select>${btn('stop-audio','Stop','stop','small',disabled)}</div></div></div>
  <details class="segment-editor"><summary>Practice a smaller segment</summary>${ref ? `<div class="segment-grid"><div><label for="segment-start">Start (seconds)</label><input id="segment-start" type="number" min="0" step="0.1" value="${p.start}"${disabled}></div><div><label for="segment-end">End (seconds)</label><input id="segment-end" type="number" min="0.1" step="0.1" value="${p.end || ''}" placeholder="Full clip"${disabled}></div></div>` : '<p class="reference-help">Segment looping becomes available when you add reference audio.</p>'}<label for="segment-text">Spanish text for this attempt</label><textarea id="segment-text" lang="es" maxlength="2000"${disabled}>${esc(p.text)}</textarea><label class="check-row"><input id="segment-confirm" type="checkbox"${p.confirmed ? ' checked' : ''}${disabled}>The text above matches the selected audio segment.</label><p class="reference-help">When trimming, enter only the words heard in that segment. The text and boundaries are saved with each attempt.</p>${btn('reset-segment','Use full phrase','refresh','small',disabled)}</details>`}
  <div class="record-zone"><span id="record-timer" class="record-timer"${p.recording ? '' : ' hidden'}>0:00 / 0:30</span><div id="level-meter" class="level-meter"${p.recording ? '' : ' hidden'} aria-hidden="true"><span></span></div><button id="record-button" class="button ${p.recording ? 'recording-button' : 'primary'}" data-action="record"${p.saving || p.starting || p.generating ? ' disabled' : ''}>${icon(p.recording ? 'stop' : 'mic')}${p.recording ? 'Finish recording' : p.starting ? 'Opening microphone…' : p.saving ? 'Saving your attempt…' : 'Record an attempt'}</button><p class="record-help" id="record-help">${p.recording ? 'Reference muted. Speak naturally, then finish your recording.' : 'The reference pauses while you record. Up to 30 seconds; saved on this device.'}</p></div></section>
  ${attempt && !hidden ? renderComparison(attempt) : ''}
  ${attempts(item.id).length ? `<section class="card comparison"><div class="section-head"><h2>Previous attempts</h2><span class="badge">${attempts(item.id).length} saved</span></div><div class="history-list">${attempts(item.id).slice(0,8).map(attempt => `<div class="history-row"><button class="round-play" data-action="play-attempt" data-id="${esc(attempt.id)}" aria-label="Play recording from ${esc(when(attempt.createdAt))}"${busy() || hidden ? ' disabled' : ''}>${icon('play')}</button><div class="phrase-details">${esc(when(attempt.createdAt))} · ${esc(clock(attempt.createdAt))}<br><small>${sec(attempt.duration)} · ${attempt.mode === 'test' ? 'Test' : 'Practice'} · ${esc(accent(attempt.accentId).shortLabel)}</small></div>${btn('select-attempt','Compare',null,'small',`data-id="${esc(attempt.id)}"${busy() || hidden ? ' disabled' : ''}`)}<button class="icon-button" data-action="delete-attempt" data-id="${esc(attempt.id)}" aria-label="Delete this recording"${disabled}>${icon('trash')}</button></div>`).join('')}</div></section>` : ''}
  </div><aside class="practice-aside"><section class="card"><p class="eyebrow">YOUR REFERENCE</p><div class="field"><label for="practice-reference">Recording</label><select id="practice-reference"${busy() || hidden ? ' disabled' : ''}><option value="">Browser speech (fallback)</option>${item.references.map(r => option(r.id,`${r.label}${r.accentId ? ` · ${accent(r.accentId).shortLabel}` : ''}`,p.referenceId)).join('')}</select></div><p class="reference-help">${ref ? `${ref.kind === 'voicebox' ? 'Generated reference' : 'Original audio'}${ref.accentId ? ` · ${esc(accent(ref.accentId).label)}` : ''}. Each attempt keeps its own reference.` : 'Browser speech is a listening aid. Add and manage regional voices under Spanish in Settings.'}</p><hr class="divider"><div class="field"><label for="generate-voice">Generate a new reference</label><select id="generate-voice"${busy() || !state.voices.length || hidden ? ' disabled' : ''}>${state.voices.map(voice => option(voice.id,`${voice.name} · ${accent(voice.accentId).shortLabel}`,state.voices.find(v => v.accentId === state.settings.accentId)?.id)).join('') || '<option>Add a voice in Settings</option>'}</select></div>${btn('generate-reference',p.generating ? 'Generating…' : 'Generate audio','wave','soft full-width',`id="generate-button"${busy() || !state.voices.length || hidden ? ' disabled' : ''}`)}${p.generating ? btn('cancel-generation','Cancel generation',null,'small full-width row-gap') : ''}<p class="reference-help">Creates the full saved phrase in Spanish with your selected Voicebox profile.</p>${btn('upload-reference','Upload audio','upload','small',busy() || hidden ? 'disabled' : '')}</section><section class="card"><p class="eyebrow">A SMALL, USEFUL ROUTINE</p>${[['Listen closely','Notice the pauses and the words that carry the rhythm.'],['Shadow the phrase','Play the reference and speak along. Loop any part you want to repeat.'],['Find one improvement','Record with the reference muted. Compare, choose one change, and retry.']].map(([title,body],i) => `<div class="step ${i === 0 ? 'active' : ''}"><span class="step-number">${i+1}</span><div><h3>${title}</h3><p>${body}</p></div></div>`).join('')}</section></aside></div>`;
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
  return `<section class="card card-pad"><div class="section-head"><div><h2>Connect your Voicebox</h2><p>Bring your own regional voice profiles into the studio.</p></div><span class="badge">Voicebox</span></div><form id="voice-connect-form" class="voice-connect"><div class="field"><label for="voicebox-url">Voicebox address</label><input id="voicebox-url" type="url" required value="${esc(ui.profilesUrl || state.settings.voiceboxUrl)}" placeholder="http://127.0.0.1:17493"><small>Keep Voicebox running. Your voice profiles stay in Voicebox; generated reference clips are saved here.</small></div><button type="submit" class="button primary"${busy() ? ' disabled' : ''}>${icon('headphones')}Load voice profiles</button></form>${ui.profiles.length ? `<div class="section-gap"><h3>Available profiles</h3>${ui.profiles.map((profile,i) => `<div class="profile-row" data-profile-index="${i}"><div class="profile-name"><strong>${esc(profile.name)}</strong><p class="reference-help">${esc(profile.id)}</p></div><div class="field"><label for="profile-name-${i}">Display name</label><input id="profile-name-${i}" maxlength="100" value="${esc(profile.name)}"></div><div class="field"><label for="profile-accent-${i}">Reference accent</label><select id="profile-accent-${i}">${accentOptions(state.settings.accentId)}</select></div>${btn('save-profile','Add voice','plus','small',`data-index="${i}"`)}</div>`).join('')}</div>` : ''}</section>
  <section class="section-gap"><div class="section-head"><div><h2>Your reference voices</h2><p>Preview each voice before using it as a regional reference.</p></div><span class="badge">${state.voices.length} ${state.voices.length === 1 ? 'voice' : 'voices'}</span></div>${state.voices.length ? `<div class="voice-grid">${state.voices.map(voice => `<article class="card voice-card"><div class="card-top"><div class="voice-avatar" aria-hidden="true">${esc(voice.name.split(/\s+/).slice(0,2).map(w => w[0]).join(''))}</div><span class="badge violet">${esc(accent(voice.accentId).shortLabel)}</span></div><h3>${esc(voice.name)}</h3><p>${esc(voice.description || 'Your Voicebox reference. Listen for the regional sounds and delivery you want to practice.')}</p><div class="card-bottom">${btn('preview-voice','Preview voice','play','small',`data-id="${esc(voice.id)}"${busy() ? ' disabled' : ''}`)}<div class="card-actions"><button class="icon-button" data-action="edit-voice" data-id="${esc(voice.id)}" aria-label="Edit ${esc(voice.name)}"${busy() ? ' disabled' : ''}>${icon('edit')}</button><button class="icon-button" data-action="delete-voice" data-id="${esc(voice.id)}" aria-label="Remove ${esc(voice.name)}"${busy() ? ' disabled' : ''}>${icon('trash')}</button></div></div></article>`).join('')}</div>` : `<div class="card">${empty('A familiar voice makes a difference.','Load your Voicebox profiles above, then assign a regional accent. You can also upload native audio directly to any phrase.',btn('go-library','Open phrase library','arrow','small'))}</div>`}</section>${note('Choose your preferred Spanish region from Regions & Accents. Voicebox profiles can be assigned to accents here.','neutral')}`;
}
function dueWords() { return D.dueItems(state,'meaning').filter(item => !ui.reviewed.has(item.id)); }
function reviewWord() { const items = dueWords(); return items.find(item => item.id === ui.reviewId) || items[0]; }
function renderReview() {
  const speaking = ui.reviewKind === 'speaking', items = speaking ? D.dueItems(state,'speaking') : dueWords(), item = speaking ? items[0] : reviewWord();
  if(!speaking) ui.reviewId = item?.id || null;
  const listening = ui.reviewKind === 'listening';
  return `${heading('Keep it within reach.','Remember the meaning. Recognize the sound. Practice saying it.','','YOUR REVIEW QUEUE')}<div class="review-wrap"><div class="review-status"><div class="segmented">${[['meaning','Vocabulary'],['listening','Listening'],['speaking','Speaking']].map(([id,label]) => `<button data-action="review-kind" data-kind="${id}" class="${id === ui.reviewKind ? 'active' : ''}" aria-pressed="${id === ui.reviewKind}">${label}</button>`).join('')}</div><p>${items.length} ready</p></div>
  ${!item ? `<div class="card">${empty(ui.reviewed.size && !speaking ? 'A little more familiar.' : 'Your queue is clear.',speaking ? 'Add phrases to your library to start speaking reviews.' : state.vocabulary.length ? 'No words with saved meanings are due right now. Come back later or save another meaning from the web.' : 'Save Spanish words on a website to build your flashcards.',speaking ? btn('go-library','Open library','arrow','small') : '<a class="button small" href="#vocabulary">Open vocabulary</a>')}</div>` : speaking ? `<div class="card flashcard"><span class="badge violet">SPOKEN RECALL</span><h2 class="flashcard-word" lang="es">${esc(item.text)}</h2><p class="flashcard-context">Say the phrase before listening to the reference. Your saved attempt and self-rating guide your next speaking review.</p>${btn('test-phrase','Test this phrase','mic','primary',`data-id="${esc(item.id)}"`)}</div>` : `<div class="card flashcard"><span class="badge violet">${listening ? 'LISTEN & RECALL' : 'SPANISH → MEANING'}</span>${listening && !ui.revealed ? `<h2 class="flashcard-word">Listen closely.</h2>${btn('speak-card','Hear the word','headphones','soft',`data-id="${esc(item.id)}"`)}<p class="reference-help">Browser speech · reference accent may differ</p>` : `<h2 class="flashcard-word" lang="es">${esc(item.word)}</h2>${btn('speak-card','Listen','play','small',`data-id="${esc(item.id)}"`)}`}${ui.revealed ? `<p class="flashcard-meaning">${esc(item.meaning)}</p>${item.context ? `<p class="flashcard-context" lang="es">${esc(item.context)}</p>` : ''}` : `<p class="flashcard-context">${listening ? 'Can you recognize the word and recall its meaning?' : 'Bring the meaning to mind before you turn the card.'}</p>${btn('reveal-card','Reveal meaning',null,'primary')}`}</div>${ui.revealed ? `<div class="review-ratings">${[['again','Again','Keep practicing'],['hard','Hard','A little more time'],['good','Good','Coming back later'],['easy','Easy','Give it more space']].map(([rating,label,help]) => `<button data-action="rate-card" data-id="${esc(item.id)}" data-rating="${rating}">${label}<small>${help}</small></button>`).join('')}</div>` : ''}`}
  ${note(speaking ? 'Speaking practice has its own review schedule. Knowing a word’s meaning and saying it comfortably are different skills.' : 'Vocabulary and listening cards share your meaning review schedule. Words need a saved meaning before they are ready to review.','neutral')}</div>`;
}
function renderProgressOverview() {
  const now = new Date(), weekEnds = Array.from({length:8},(_,index) => { const date = new Date(now); date.setHours(23,59,59,999); date.setDate(date.getDate() - (7-index)*7); return date; });
  const grammar = learning?.grammarTopics || [], known = (learning?.vocabulary || []).filter(item => item.status === 'known');
  const assessed = [...state.attempts].filter(item => Number.isFinite(Number(item.assessment?.accuracy)));
  const vocabularyHistory = learning?.vocabularyMastery || [];
  const vocabularyPoints = weekEnds.map(end => {
    const snapshot = vocabularyHistory.filter(item => item.recordedAt <= end.getTime()).at(-1);
    return snapshot ? (snapshot.total ? 100 * snapshot.known / snapshot.total : 0) : null;
  });
  const grammarPoints = weekEnds.map(end => grammar.length ? 100 * grammar.filter(item => item.completedAt && item.completedAt <= end.getTime()).length / grammar.length : 0);
  const pronunciationPoints = weekEnds.map(end => { const values = assessed.filter(item => new Date(item.createdAt) <= end).map(item => Number(item.assessment.accuracy)); return values.length ? values.reduce((sum,value) => sum + value,0) / values.length : 0; });
  const chart = (label,value,note,points) => {
    const visible = points.map((point,index) => ({point,index})).filter(item => Number.isFinite(item.point));
    const coordinates = visible.map(({point,index}) => `${(index * 100 / Math.max(1,points.length-1)).toFixed(1)},${(100-Math.max(0,Math.min(100,point))).toFixed(1)}`).join(' ');
    const summary = visible.map(({point,index}) => `${when(weekEnds[index])}: ${Math.round(point)}%`).join('; ');
    return `<article class="mastery-card"><h2>${label}</h2><p><strong>${esc(value)}</strong> · ${note}</p><div class="mastery-chart" role="img" aria-label="${esc(`${label}. ${summary || 'No historical data yet.'}`)}"><svg viewBox="0 0 100 100" preserveAspectRatio="none">${visible.length > 1 ? `<polyline points="${coordinates}"></polyline>` : ''}</svg>${visible.map(({point,index}) => `<span class="mastery-point" style="--x:${index * 100 / Math.max(1,points.length-1)}%;--y:${Math.max(0,Math.min(100,point))}%" title="${esc(when(weekEnds[index]))}: ${Math.round(point)}%"></span>`).join('')}</div></article>`;
  };
  const grammarDone = grammar.filter(item => item.completed).length;
  return `<section class="progress-overview home-progress" aria-labelledby="home-progress-title"><div class="section-head"><div><p class="eyebrow">YOUR PROGRESS</p><h2 id="home-progress-title">See what is starting to stick.</h2><p>Real activity from your vocabulary, grammar, and pronunciation practice.</p></div><span class="badge outline">Last 8 weeks</span></div><div class="mastery-grid">${chart('Vocabulary mastery',`${known.length} of ${learning.vocabulary.length} known`,'Known-word snapshots from your vocabulary tracker',vocabularyPoints)}${chart('Grammar mastery',`${grammarDone} of ${grammar.length} principles`,'Completed grammar practices',grammarPoints)}${chart('Pronunciation mastery',assessed.length ? `${Math.round(pronunciationPoints.at(-1))}% average` : 'No assessed attempts','Accuracy from assessed recordings only',pronunciationPoints)}</div><div class="toolbar">${btn('export-backup','Export backup','download')}<a class="button" href="#pronunciation">Practice pronunciation ${icon('arrow')}</a></div></section>`;
}
function dialog(title,body,actions = '',formId = '') {
  const node = $('#editor-dialog');
  node.classList.toggle('settings-dialog', formId === 'settings-form');
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
  if($('#editor-dialog').open) $('#editor-dialog').close();
  dialog('Edit reference voice',`<input id="edit-voice-id" type="hidden" value="${esc(id)}"><div class="field"><label for="edit-voice-name">Display name</label><input id="edit-voice-name" required maxlength="100" value="${esc(voice.name)}"></div><div class="field"><label for="edit-voice-accent">Reference accent</label><select id="edit-voice-accent">${accentOptions(voice.accentId)}</select></div><div class="field"><label for="edit-voice-description">Speaker and delivery notes</label><textarea id="edit-voice-description" maxlength="500">${esc(voice.description || '')}</textarea></div>`,'<button type="submit" class="button primary">Save voice</button>','voice-edit-form');
}
function targetLanguagePicker() {
  const selected = new Set(targetLanguages().map(item => item.code));
  return `<div class="target-language-grid">${languages().map(item => `<label class="target-language-option"><input type="checkbox" name="target-languages" value="${esc(item.code)}"${selected.has(item.code) ? ' checked' : ''}><span>${esc(item.name)}</span></label>`).join('')}</div>`;
}
function settingsDialog() {
  const theme = state.settings.theme || 'system';
  dialog('Language learning settings',`<section class="settings-section"><div class="settings-section-heading"><span class="settings-section-icon">${icon('globe')}</span><div><h3>Your languages</h3><p>Choose what you are learning and how the studio should explain it.</p></div></div><div class="field"><label for="target-language">Study now</label><select id="target-language">${languageOptions(targetLang().code)}</select><small>This is the language currently shown throughout the app.</small></div><div class="field"><span class="field-label">Your target languages</span><p class="section-description">Choose the languages available in your quick switcher.</p>${targetLanguagePicker()}</div><div class="field"><label for="native-language">Show meanings in</label><select id="native-language">${languageOptions(nativeLang().code)}</select></div></section><section class="settings-section"><div class="settings-section-heading"><span class="settings-section-icon">${icon('settings')}</span><div><h3>Appearance</h3><p>Keep the studio comfortable wherever you study.</p></div></div><div class="field"><label for="settings-theme">Color theme</label><select id="settings-theme"><option value="system"${theme === 'system' ? ' selected' : ''}>Use device setting</option><option value="light"${theme === 'light' ? ' selected' : ''}>Light</option><option value="dark"${theme === 'dark' ? ' selected' : ''}>Dark</option></select><small>Applies across every page and follows your device when set to automatic.</small></div></section><section class="settings-section"><div class="settings-section-heading"><span class="settings-section-icon">${icon('wave')}</span><div><h3>Optional pronunciation assessment</h3><p>Connect a local speech service for word-level feedback.</p></div></div><p class="section-description">Audio leaves this device only after you explicitly choose “Assess pronunciation.”</p><label class="check-row"><input id="assessment-enabled" type="checkbox"${state.settings.assessmentEnabled ? ' checked' : ''}>Enable assessment through my configured speech service</label><div class="field row-gap"><label for="assessment-url">Assessment service address</label><input id="assessment-url" type="url" required value="${esc(state.settings.assessmentUrl)}"><small>The local bridge supports configured es-MX and es-ES assessment. Other regions remain available for shadowing.</small></div><p class="reference-help">Run the assessment bridge with your speech account credentials; keys stay outside the extension. Setup instructions are in server/README.md.</p></section>${insightsSection()}<section class="settings-section"><div class="settings-section-heading"><span class="settings-section-icon">${icon('download')}</span><div><h3>Your saved practice</h3><p>Back up recordings, references, phrases, and review history.</p></div></div><p class="section-description">Everything stays on this device unless you export a studio backup.</p><div class="flex-row">${btn('export-backup','Export backup','download','small')}${btn('import-backup','Import backup','upload','small')}</div></section>`,'<button type="submit" class="button primary">Save settings</button>','settings-form');
  refreshInsightsStatus();
}
// ── Polybot Insights opt-in (ADR-016). Off by default; the notice below is consent version 1.
// Changing its wording means bumping PolybotEvents.CONSENT_VERSION.
const insightsAvailable = () => Boolean(window.chrome?.runtime?.id && window.PolybotEvents);
function runtimeMessage(type,extra = {}) {
  return new Promise((resolve,reject) => chrome.runtime.sendMessage({type,...extra},response => {
    const error = chrome.runtime.lastError;
    if(error || !response?.ok) reject(new Error(error?.message || response?.error || 'Polybot Insights did not respond. Reload the extension and try again.')); else resolve(response.result);
  }));
}
function insightsSection() {
  const status = ui.insightsStatus, enabled = Boolean(status?.enabled);
  const url = status?.url || window.PolybotEvents?.DEFAULT_URL || 'http://127.0.0.1:17495';
  return `<section class="settings-section"><div class="settings-section-heading"><span class="settings-section-icon">${icon('settings')}</span><div><h3>Optional: Polybot Insights</h3><p>Let a service on this computer learn from how you practice.</p></div></div><div class="insights-consent"><p>When this is on, Polybot records learning events: the words you look up, save or mark, how you rate reviews, your recall answers and how long they took, the lessons you open or complete, and the preferences you set. They are sent only to the Polybot Insights service at the address below on this computer.</p><p><strong>Never sent:</strong> anything you type (responses, notes, phrases, translations), page addresses or titles, recordings, or transcripts.</p><p>Turning this off deletes events that have not been sent yet. Events already received stay in your local Insights database.</p></div><label class="check-row"><input id="insights-enabled" type="checkbox"${enabled ? ' checked' : ''}${insightsAvailable() ? '' : ' disabled'}>I have read this and want Polybot Insights on</label><div class="field row-gap"><label for="insights-url">Insights service address</label><input id="insights-url" type="url" required value="${esc(url)}"${insightsAvailable() ? '' : ' disabled'}><small>Start the service with <code>python -m polybot_insights.api</code> (see insights/README.md).</small></div><p class="reference-help" id="insights-status" role="status">${esc(insightsStatusText(status))}</p></section>`;
}
function insightsStatusText(status) {
  if(!insightsAvailable()) return 'Available in the installed extension only.';
  if(!status) return 'Checking Insights status…';
  if(!status.enabled) return 'Off. Nothing is recorded.';
  const synced = status.lastSyncAt ? `last delivered ${when(Date.parse(status.lastSyncAt))}` : 'nothing delivered yet';
  return `On · ${status.buffered} waiting to send · ${synced}${status.lastError ? ` · ${status.lastError}` : ''}${status.dropped ? ` · ${status.dropped} not delivered` : ''}`;
}
async function refreshInsightsStatus() {
  if(!insightsAvailable()) return;
  try { ui.insightsStatus = await runtimeMessage('INSIGHTS_STATUS'); } catch (_) { ui.insightsStatus = null; }
  const line = $('#insights-status'), box = $('#insights-enabled');
  if(line) line.textContent = insightsStatusText(ui.insightsStatus);
  if(box && ui.insightsStatus) box.checked = Boolean(ui.insightsStatus.enabled);
}
function readInsightsForm(form) {
  const box = $('#insights-enabled',form); if(!box || box.disabled) return null;
  const url = new URL($('#insights-url',form).value.trim());
  if(url.username || url.password || !['http:','https:'].includes(url.protocol) || !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('Polybot Insights must run on this computer: use a localhost or 127.0.0.1 address.');
  return {enabled:box.checked,url:url.origin,wasEnabled:Boolean(ui.insightsStatus?.enabled),previousUrl:ui.insightsStatus?.url};
}
async function applyInsights(choice,permission) {
  if(!choice) return;
  if(choice.enabled && (!choice.wasEnabled || choice.url !== choice.previousUrl)) {
    if(!await permission) throw new Error('Allow access to your Insights service address to turn on Polybot Insights.');
    await runtimeMessage('INSIGHTS_ENABLE',{nativeLanguage:nativeLang().code,url:choice.url});
  } else if(!choice.enabled && choice.wasEnabled) await runtimeMessage('INSIGHTS_DISABLE');
  await refreshInsightsStatus();
}
function voiceSettingsDialog() { dialog('Spanish voices and accents',renderVoices()); }
function readSettingsForm(form) {
  const assessmentUrl = $('#assessment-url',form).value.trim(), selectedTargets = $$('input[name="target-languages"]:checked',form).map(input => input.value);
  if(!selectedTargets.length) throw new Error('Choose at least one target language.');
  const url = new URL(assessmentUrl);
  if(url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw new Error('Use HTTPS or a local loopback HTTP address for your assessment service, without credentials in the URL.');
  return {assessmentUrl,assessmentEnabled:$('#assessment-enabled',form).checked,theme:$('#settings-theme',form).value,target:$('#target-language',form).value,native:$('#native-language',form).value,selectedTargets};
}
async function persistSettingsForm(form) {
  const values = readSettingsForm(form);
  await Promise.all([D.saveSettings({assessmentUrl:values.assessmentUrl,assessmentEnabled:values.assessmentEnabled,theme:values.theme}),L.setLanguages(values.target,values.native,values.selectedTargets)]);
  if(L?.recordVocabularySnapshot) await L.recordVocabularySnapshot(values.target);
  [state,learning] = await Promise.all([D.load(),L.load()]); ui.dictionaryResult = null; ui.mediaResponse = null; ui.grammarTopic = null;
  if(!isSpanish()) ui.pronunciationTab = 'overview'; window.StudioTheme?.apply(values.theme);
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
function speak(text, requestedLocale) {
  if(!('speechSynthesis' in window)) throw new Error('Browser speech is unavailable. Upload reference audio or connect Voicebox.');
  stopAudio();
  const utterance = new SpeechSynthesisUtterance(text);
  const locale = requestedLocale || (page === 'pronunciation' && isSpanish() ? state.settings.accentId : targetLang().speechLang) || targetLang().code, voices = speechSynthesis.getVoices();
  utterance.lang = locale; utterance.rate = p.speed;
  utterance.voice = voices.find(v => v.lang.toLowerCase() === locale.toLowerCase()) || voices.find(v => v.lang.toLowerCase().startsWith(targetLang().code.toLowerCase())) || null;
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
  if(page === 'pronunciation' && ui.pronunciationTab === 'practice') $$('#main button, #main input, #main select, #main textarea').forEach(node => {
    if(node.id === 'record-button' || node.dataset.action === 'cancel-generation') return;
    if(p.recording || p.starting || p.saving) {node.dataset.recordDisabled = node.disabled ? 'yes' : 'no'; node.disabled = true;}
  });
  const globalAccent = $('#global-accent'); if(globalAccent) globalAccent.disabled = busy();
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
    const segment = snapshot.referenceSnapshot ? ((snapshot.referenceSnapshot.start || 0) > 0 || Boolean(snapshot.referenceSnapshot.end)) : false;
    track('pronunciation_attempted',{language:'es',context:{lesson_id:`phrase:${snapshot.phraseId}`},payload:{client_attempt_ref:saved.id,mode:snapshot.mode === 'test' ? 'test' : 'practice',duration_ms:Math.round(recorded.duration * 1000),accent:snapshot.accentId,has_reference:Boolean(snapshot.referenceId),is_segment:segment}});
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
    // Scores only: the transcript and per-word text stay on this device.
    const scored = (assessment.words || []).filter(w => Number.isFinite(w.accuracy));
    track('pronunciation_scored',{language:'es',context:{lesson_id:`phrase:${current.phraseId}`},payload:{client_attempt_ref:id,provider:'azure',locale:assessment.locale,accuracy:assessment.accuracy ?? null,fluency:assessment.fluency ?? null,completeness:assessment.completeness ?? null,words_scored:scored.length,words_below_70:scored.filter(w => w.accuracy < 70).length}});
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
    track('feedback_viewed',{language:'es',context:{lesson_id:`phrase:${attempt.phraseId}`},payload:{feedback_type:'timing_comparison'}});
  } catch(error) {ui.comparison = {attemptId:id,error:error.message};}
  finally {operation = false; render();}
}
async function exportBackup() {
  const backup = await D.exportBackup(), blob = new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `polybot-studio-${new Date().toISOString().slice(0,10)}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),5000); notify('Studio backup exported, including saved audio.');
}
async function action(name,node) {
  if(busy() && !['record','cancel-generation','close-dialog','stop-audio'].includes(name)) return notify('Finish your current recording or request first.');
  const id = node.dataset.id;
  switch(name) {
    case 'start-phrase': ui.pronunciationTab = 'practice'; return go('pronunciation',id);
    case 'test-phrase': p.mode = 'test'; ui.pronunciationTab = 'practice'; return go('pronunciation',id);
    case 'go-practice': ui.pronunciationTab = 'practice'; return go('pronunciation');
    case 'go-library': if($('#editor-dialog').open) $('#editor-dialog').close(); ui.pronunciationTab = 'library'; return go('pronunciation');
    case 'pronunciation-tab': ui.pronunciationTab = node.dataset.tab || 'overview'; stopAudio(); render(); return featureFocus();
    case 'resource-home': ui.resourceView = 'home'; ui.grammarTopic = null; ui.mediaResponse = null; ui.pronunciationTab = 'overview'; ui.vocabPractice = 'list'; stopAudio(); render(); return featureFocus();
    case 'resource-view': ui.resourceView = node.dataset.view; render(); return featureFocus();
    case 'open-listening': go('media'); ui.resourceView = 'listening'; render(); return featureFocus();
    case 'speak-sample': return speak(`This is a browser voice sample for ${targetLang().name}.`);
    case 'vocab-practice': ui.resourceView = 'practice'; ui.vocabPractice = node.dataset.mode || 'meaning'; ui.revealed = false; ui.reviewId = null; if(ui.vocabPractice === 'recall') newRecallQuestion(); return render();
    case 'recall-answer': {
      const result = ui.recall && R.answer(ui.recall,id,Date.now()); if(!result) return;
      ui.recall = result.question;
      track('answer_submitted',{context:{exercise_id:result.question.exerciseId,vocab_item_id:result.question.vocabItemId},payload:result.payload});
      return render();
    }
    case 'recall-hint': {
      if(!ui.recall) return; const before = ui.recall.hintsUsed; ui.recall = R.useHint(ui.recall);
      if(ui.recall.hintsUsed > before) track('hint_requested',{context:{exercise_id:ui.recall.exerciseId,vocab_item_id:ui.recall.vocabItemId},payload:{hint_type:'eliminate_choice'}});
      return render();
    }
    case 'understanding-refresh': ui.understanding = null; return render();
    case 'understanding-sample': ui.understanding = {state:'sample'}; render(); return featureFocus();
    case 'open-recommendation': return openRecommendation(node);
    case 'recall-skip': leaveRecall('skip'); newRecallQuestion(); return render();
    case 'recall-next': newRecallQuestion(); render(); return $('.recall-choice')?.focus();
    case 'close-vocab-practice': if(ui.vocabPractice === 'recall') { leaveRecall('close'); ui.recall = null; } ui.resourceView = 'home'; ui.vocabPractice = 'list'; ui.revealed = false; return render();
    case 'reveal-learning-word': ui.revealed = true; return render();
    case 'speak-learning-word': {const word = learning.vocabulary.find(item => item.id === id); if(word) return speak(word.word); return;}
    case 'rate-learning-word': {
      const words = learning.vocabulary.filter(word => word.meaning); const index = Math.max(0,words.findIndex(word => word.id === id));
      // Audit T4: ratings in every language now leave evidence, not just Spanish (ADR-018).
      const rated = learning.vocabulary.find(item => item.id === id);
      if(rated) track('review_rated',{context:{vocab_item_id:vocabItemId(rated.word)},payload:{review_kind:ui.vocabPractice === 'listening' ? 'listening' : 'meaning',rating:node.dataset.rating}});
      if(isSpanish()) { const studioWord = state.vocabulary.find(word => word.id === id || word.word === learning.vocabulary.find(item => item.id === id)?.word); if(studioWord) await D.rateReview('meaning',studioWord.id,node.dataset.rating); }
      ui.reviewId = words.length > 1 ? words[(index + 1) % words.length].id : id; ui.revealed = false; notify(isSpanish() ? 'Meaning review scheduled. Here is the next word.' : 'Here is the next word.'); return render();
    }
    case 'open-grammar-practice': ui.grammarTopic = id; track('lesson_started',{context:{lesson_id:id},payload:{entry:'navigation'}}); render(); return featureFocus();
    case 'close-grammar-practice': ui.grammarTopic = null; return render();
    case 'complete-grammar': return completeLesson(id,'Grammar practice marked complete.');
    case 'open-media': { const item = learning.media.find(entry => entry.id === id); if(!item || (item.origin === 'provided' && item.experience === 'carefree')) return; ui.mediaResponse = id; track('lesson_started',{context:{lesson_id:id},payload:{entry:'navigation'}}); render(); return setTimeout(() => $('#media-response-form textarea')?.focus(),0); }
    case 'close-media-response': ui.mediaResponse = null; return render();
    case 'speak-media': {const item = learning.media.find(entry => entry.id === id); if(item) return speak(item.text); return;}
    case 'play-media-audio': {const item = learning.media.find(entry => entry.id === id); if(item?.audioUrl) return playUrl(item.audioUrl,0,0,'media'); return;}
    case 'complete-media': return completeLesson(id,'Media activity marked complete.');
    case 'new-phrase': return phraseDialog();
    case 'edit-phrase': return phraseDialog(id);
    case 'open-settings': return settingsDialog();
    case 'open-voice-settings': {
      operation = true;
      try { const form = $('#settings-form'); if(form) await persistSettingsForm(form); else { await D.saveSettings({accentId:state.settings.accentId}); state = await D.load(); } }
      finally { operation = false; }
      $('#editor-dialog').close(); return voiceSettingsDialog();
    }
    case 'edit-voice': return voiceDialog(id);
    case 'close-dialog': if(operation) return; $('#editor-dialog').close(); return;
    case 'upload-reference': return uploadDialog();
    case 'delete-phrase': {
      const item = state.phrases.find(p => p.id === id); if(!item) return;
      if(!confirm(`Delete “${item.text}” and its saved recordings? This cannot be undone without a backup.`)) return;
      stopAudio(); return mutate(() => D.removePhrase(id),'Phrase and its recordings deleted.');
    }
    case 'delete-attempt': if(!confirm('Delete this recording and its saved assessment?')) return; stopAudio(); return mutate(() => D.removeAttempt(id),'Recording deleted.');
    case 'delete-voice': {
      if(!confirm('Remove this voice configuration? Existing reference clips and recordings will remain.')) return;
      await mutate(() => D.removeVoice(id),'Voice removed. Saved audio is still available.');
      if($('#editor-dialog').open) { $('#editor-dialog').close(); voiceSettingsDialog(); }
      return;
    }
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
    case 'play-attempt': {if(page === 'pronunciation' && ui.pronunciationTab === 'practice' && hiddenReference()) return; const attempt = state.attempts.find(a => a.id === id); if(attempt) return playUrl(attempt.audioUrl,0,0,'attempt'); return;}
    case 'play-attempt-reference': {if(hiddenReference()) return; const snap = state.attempts.find(a => a.id === id)?.referenceSnapshot; if(snap) return playUrl(snap.audioUrl,snap.start || 0,snap.end || 0,'snapshot'); return;}
    case 'select-attempt': ui.attemptId = id; ui.comparison = null; stopAudio(); return render();
    case 'open-attempt': {const attempt = state.attempts.find(a => a.id === id); if(!attempt) return; p.mode = 'practice'; ui.pronunciationTab = 'practice'; go('pronunciation',attempt.phraseId); ui.attemptId = id; return render();}
    case 'record': return record();
    case 'generate-reference': return generate($('#generate-voice').value);
    case 'cancel-generation': generationController?.abort(); return;
    case 'preview-voice': return generate(id,true);
    case 'compare-timing': return compareTiming(id);
    case 'assess-attempt': return assessAttempt(id);
    case 'rate-speaking': {
      const attempt = state.attempts.find(a => a.id === id); if(!attempt) return;
      if(attempt.selfRating) return notify('This attempt is already rated. Record another attempt to review again.');
      let rated = false;
      await mutate(async () => {await D.saveAttempt({...attempt,selfRating:node.dataset.rating}); await D.rateReview('speaking',attempt.phraseId,node.dataset.rating); rated = true;},'Speaking review scheduled.');
      if(rated) track('review_rated',{language:'es',context:{lesson_id:`phrase:${attempt.phraseId}`},payload:{review_kind:'speaking',rating:node.dataset.rating,client_attempt_ref:attempt.id}});
      return;
    }
    case 'save-profile': {
      const index = Number(node.dataset.index), profile = ui.profiles[index]; if(!profile) return;
      const name = $(`#profile-name-${index}`).value.trim(), accentId = $(`#profile-accent-${index}`).value;
      if(!name) throw new Error('Give your reference voice a display name.');
      const existing = state.voices.find(v => v.profileId === profile.id && v.baseUrl === ui.profilesUrl);
      await mutate(() => D.saveVoice({id:existing?.id,profileId:profile.id,name,accentId,baseUrl:ui.profilesUrl}),'Reference voice saved.');
      if($('#editor-dialog').open) { $('#editor-dialog').close(); voiceSettingsDialog(); }
      return;
    }
    case 'review-kind': stopAudio(); ui.reviewKind = node.dataset.kind; ui.revealed = false; return render();
    case 'reveal-card': ui.revealed = true; return render();
    case 'speak-card': {const word = state.vocabulary.find(w => w.id === id); if(word) return speak(word.word); return;}
    case 'rate-card': {
      if(!ui.revealed || ui.reviewed.has(id)) return;
      let rated = false;
      await mutate(async () => { await D.rateReview('meaning',id,node.dataset.rating); rated = true; },null,false);
      const card = state.vocabulary.find(w => w.id === id);
      if(rated && card) track('review_rated',{language:'es',context:{vocab_item_id:vocabItemId(card.word,'es')},payload:{review_kind:ui.reviewKind === 'listening' ? 'listening' : 'meaning',rating:node.dataset.rating}});
      ui.reviewed.add(id); ui.reviewId = null; ui.revealed = false; stopAudio(); return render();
    }
    case 'export-backup': return exportBackup();
    case 'import-backup': $('#backup-file').value = ''; $('#backup-file').click(); return;
  }
}
async function submit(form) {
  if(busy()) return;
  if(form.id === 'dictionary-form') {
    if(!L?.lookup) throw new Error('Dictionary lookup is unavailable. Reload the extension and try again.');
    const term = $('#dictionary-term').value.trim(); if(!term) throw new Error('Enter a word or short phrase to look up.');
    operation = true; const button = form.querySelector('button'); button.disabled = true;
    try {
      ui.dictionaryResult = await L.lookup(term); learning = await L.load();
      const r = ui.dictionaryResult, toNative = !r?.sourceLang || r.sourceLang === targetLang().code;
      if(term.length <= 300) track('word_looked_up',{...(toNative ? {context:{vocab_item_id:vocabItemId(term)}} : {}),payload:{lookup_surface:'dictionary',direction:toNative ? 'target_to_native' : 'native_to_target',result:r?.status === 'found' ? (r.source === 'saved' ? 'saved' : 'translated') : 'unavailable'}});
    }
    finally { operation = false; render(); }
    return;
  }
  if(form.id === 'media-response-form') {
    const itemId = $('#media-item-id').value, writing = $('#media-writing-response').value.trim(), speaking = $('#media-speaking-response').value.trim();
    const mediaItem = learning.media.find(item => item.id === itemId);
    if(!mediaItem || (mediaItem.origin === 'provided' && mediaItem.experience === 'carefree')) throw new Error('This media item does not accept responses.');
    if(!writing && !speaking) throw new Error('Write a response or add a reflection after speaking aloud.');
    const saved = [];
    await mutateLearning(async () => {
      if(writing) { await L.saveMediaResponse({itemId,mode:'writing',text:writing}); saved.push(['writing',writing.length]); }
      if(speaking) { await L.saveMediaResponse({itemId,mode:'speaking',text:speaking}); saved.push(['speaking_reflection',speaking.length]); }
    },'Your media responses were saved.');
    // The response text is never sent, only its length (EVENT_TAXONOMY §3.4).
    for(const [mode,chars] of saved) track('media_response_saved',{context:{lesson_id:itemId},payload:{mode,response_chars:chars}});
    return;
  }
  if(form.id === 'voice-connect-form') {
    const baseUrl = $('#voicebox-url').value.trim(), permission = A.requestAccess(baseUrl);
    operation = true; form.querySelector('button').disabled = true;
    try {
      if(!await permission) throw new Error('Allow access to your Voicebox address to load profiles.');
      ui.profiles = await A.listVoiceboxProfiles(baseUrl); ui.profilesUrl = baseUrl;
      await D.saveSettings({voiceboxUrl:baseUrl}); state = await D.load();
      notify(ui.profiles.length ? `${ui.profiles.length} voice profiles found. Assign an accent below.` : 'Connected. Create a voice profile in Voicebox, then load profiles again.');
    } finally {
      operation = false; render();
      if($('#editor-dialog').open) { $('#editor-dialog').close(); voiceSettingsDialog(); }
    }
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
    await mutate(() => D.saveVoice({...voice,name,accentId,description}),'Voice updated.');
    if($('#editor-dialog').open) $('#editor-dialog').close(); voiceSettingsDialog(); return;
  }
  if(form.id === 'settings-form') {
    if(!L?.setLanguages) throw new Error('Language profiles are unavailable. Reload the extension and try again.');
    // Ask for loopback access now, while the click still counts as a user gesture.
    const insights = readInsightsForm(form);
    const permission = insights?.enabled && (!insights.wasEnabled || insights.url !== insights.previousUrl) ? A.requestAccess(insights.url) : null;
    operation = true;
    try {
      await persistSettingsForm(form); await applyInsights(insights,permission); $('#editor-dialog').close(); notify('Language learning settings saved.');
    } finally { operation = false; render(); }
    return;
  }
}
document.addEventListener('click',event => {
  const link = event.target.closest('a[href^="#"]');
  if(link) { const route = link.getAttribute('href').slice(1); if(pages[route] || aliases[route]) {event.preventDefault(); go(route); return;} }
  const node = event.target.closest('[data-action]'); if(!node || node.disabled) return;
  event.preventDefault(); Promise.resolve(action(node.dataset.action,node)).catch(report);
});
document.addEventListener('submit',event => {
  if(!['dictionary-form','media-response-form','phrase-form','upload-form','voice-connect-form','voice-edit-form','settings-form'].includes(event.target.id)) return;
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
      case 'study-language-switch': {
        if(node.value === targetLang().code) return;
        operation = true; node.disabled = true; stopAudio();
        try {
          learning = await L.setLanguages(node.value,nativeLang().code,targetLanguages().map(item => item.code));
          if(L?.recordVocabularySnapshot) await L.recordVocabularySnapshot(node.value);
          learning = await L.load();
          ui.dictionaryResult = null; ui.mediaResponse = null; ui.grammarTopic = null; ui.resourceView = 'home'; ui.pronunciationTab = 'overview';
          notify(`Now studying ${targetLang().name}.`);
        } finally { operation = false; render(); }
        return;
      }
      case 'global-accent': {
        stopAudio(); const previous = state.settings.accentId; let changed = false;
        await mutate(async () => { await D.saveSettings({accentId:node.value}); changed = true; },`${accent(node.value).label} selected.`);
        if(changed && previous !== node.value) track('preference_set',{language:'es',payload:{preference_key:'accent',value:node.value,stated_via:'settings',...(previous ? {previous_value:previous} : {})}});
        return;
      }
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
  const next = location.hash.slice(1); if(!pages[next] && !aliases[next]) return;
  if(busy()) {history.replaceState(null,'',`${location.pathname}${location.search}#${page}`); notify('Finish your current recording or request first.'); return;}
  go(next);
});
window.addEventListener('popstate',() => {const next = location.hash.slice(1); if((pages[next] || aliases[next]) && resolveRoute(next)[0] !== page) go(next);});
window.addEventListener('beforeunload',event => {if(p.recording || p.starting || p.saving || p.generating) {event.preventDefault(); event.returnValue = '';}});
window.addEventListener('pagehide',() => {mountedPersonalization?.unmount?.(); stopAudio(); p.recorder?.cancel(); generationController?.abort(); clearInterval(p.timer);});
$('#editor-dialog').addEventListener('cancel',event => {if(operation) event.preventDefault();});
async function boot() {
  $$('[data-icon]').forEach(node => {node.innerHTML = icon(node.dataset.icon);});
  if(!D || !A) throw new Error('Studio files are missing. Reload the extension with study-data.js and study-audio.js included.');
  state = await D.init();
  // Personalization pages read preferences synchronously, so load them before the first render.
  try { await window.PolybotPrefs?.hydrate(); } catch (error) { console.warn('[Polybot] Preferences could not be loaded:', error?.message); }
  if(L?.recordVocabularySnapshot) await L.recordVocabularySnapshot();
  learning = await loadLearning(); window.StudioTheme?.apply(state.settings.theme || 'system');
  const initialRoute = resolveRoute(location.hash.slice(1)); page = initialRoute[0]; if(initialRoute[1]) ui.pronunciationTab = initialRoute[1];
  const linkedPhrase = new URLSearchParams(location.search).get('phrase');
  if(linkedPhrase && page === 'pronunciation' && isSpanish()) ui.pronunciationTab = 'practice';
  if(location.hash !== `#${page}`) history.replaceState(null,'',`${location.pathname}${location.search}#${page}`);
  initPhrase(linkedPhrase); render();
  D.subscribe(async () => {
    const version = ++pendingReload;
    try {
      const fresh = await D.load();
      if(L?.recordVocabularySnapshot) await L.recordVocabularySnapshot();
      const freshLearning = await loadLearning(); if(version !== pendingReload) return; state = fresh; learning = freshLearning; window.StudioTheme?.apply(state.settings.theme || 'system');
      if(busy()) return; shell();
      if($('#editor-dialog').open || ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) return;
      if(page === 'pronunciation' && ui.pronunciationTab === 'practice' && phrase()) {
        // Refresh the selector only: never replace the active session or its transcript.
        const select = $('#practice-phrase'); if(select) select.innerHTML = state.phrases.map(item => option(item.id,item.text,p.phraseId)).join('');
      } else render();
    } catch(error) {report(error);}
  });
  if(window.chrome?.storage?.onChanged) chrome.storage.onChanged.addListener(async (changes,area) => {
    if(area !== 'local') return;
    const changedTargets = [...new Set(Object.keys(changes).filter(key => key.startsWith('sptubeVocabulary_')).map(key => key.slice('sptubeVocabulary_'.length)))];
    if(!changedTargets.length) return;
    try {
      if(L?.recordVocabularySnapshot) for(const code of changedTargets) await L.recordVocabularySnapshot(code);
      learning = await loadLearning();
      if(!busy() && ['home','vocabulary'].includes(page) && !$('#editor-dialog').open) render();
    } catch(error) {report(error);}
  });
}
boot().catch(error => {$('#main').innerHTML = `<div class="card">${empty('The studio could not open.',error.message)}</div>`; report(error);});
})();
