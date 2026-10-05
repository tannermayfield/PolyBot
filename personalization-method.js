/* Personal learning preferences: a reflective quiz, not a diagnostic test. */
(() => {
'use strict';
const KEY = 'giftOfTonguesMethod';
const modalities = [
  ['visual','Visual','Pictures, diagrams, and visual examples'],
  ['audio','Listening','Conversations, stories, and sound'],
  ['reading','Reading','Texts, transcripts, and explanations'],
  ['speaking','Speaking','Conversation, repetition, and role-play'],
  ['writing','Writing','Journaling, messages, and written practice'],
  ['hands-on','Hands-on','Activities, games, and real-life tasks']
];
const questions = [
  {axis:'output',title:'When you meet a new phrase, what feels like a good first step?',options:[['Hear or read it in several examples.',0],['See an example, then try it myself.',50],['Use it in my own sentence right away.',100]]},
  {axis:'output',title:'Which short practice session would you choose?',options:[['Follow a short story or conversation.',0],['Listen to a conversation, then respond.',50],['Have a conversation or write a message.',100]]},
  {axis:'output',title:'When a topic is unfamiliar, you prefer to…',options:[['Build familiarity by listening and reading first.',0],['Alternate understanding examples and trying things.',50],['Start experimenting with words I already know.',100]]},
  {axis:'grammar',title:'How do you like to approach a new grammar pattern?',options:[['Notice the pattern in meaningful examples.',0],['Compare examples with a short explanation.',50],['Read the rule before trying examples.',100]]},
  {axis:'grammar',title:'If a sentence sounds different from what you expected, what helps?',options:[['Hear more natural sentences with that pattern.',0],['See another example and a brief explanation.',50],['Find an explanation of exactly how the rule works.',100]]},
  {axis:'grammar',title:'Which grammar activity would you choose?',options:[['Use a story or conversation to pick up patterns.',0],['Explore a pattern, then review a short rule.',50],['Study a clear rule and apply it in exercises.',100]]},
  {axis:'modality',title:'Which format makes you most eager to begin?',options:modalities.map(([id,label,description])=>[`${label}: ${description.toLowerCase()}`,id])},
  {axis:'modality',title:'Which format would you enjoy when reviewing?',options:modalities.map(([id,label,description])=>[`${label}: ${description.toLowerCase()}`,id])}
];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function valid(value) {
  return !!value && value.version === 1 && ['output','grammar'].every(k=>Number.isFinite(value[k]) && value[k]>=0 && value[k]<=100) && Array.isArray(value.modalities) && value.modalities.length>0 && value.modalities.length<=modalities.length && new Set(value.modalities).size===value.modalities.length && value.modalities.every(id=>modalities.some(m=>m[0]===id));
}
function score(answers) {
  if (!Array.isArray(answers) || answers.length!==questions.length || answers.some((a,i)=>!Number.isInteger(a)||a<0||a>=questions[i].options.length)) throw new Error('Answer every question before viewing your results.');
  const average = axis => Math.round(questions.reduce((sum,q,i)=>sum+(q.axis===axis?q.options[answers[i]][1]:0),0)/questions.filter(q=>q.axis===axis).length);
  return {version:1,output:average('output'),grammar:average('grammar'),modalities:[...new Set(questions.flatMap((q,i)=>q.axis==='modality'?[q.options[answers[i]][1]]:[]))]};
}
function read() {
  try { const raw=localStorage.getItem(KEY); if(!raw) return {value:null}; const value=JSON.parse(raw); return valid(value)?{value}:{value:null,error:'Your saved learning preferences could not be read. Choose and save new preferences below.'}; }
  catch { return {value:null,error:'Learning preferences could not be loaded from this browser. You can still explore the quiz.'}; }
}
const defaultValue = () => ({version:1,output:50,grammar:50,modalities:['audio','reading']});
const balanceLabel = (n,a,b) => n<40?a:n>60?b:'A balanced mix';
function render(ctx={}) {
  return `<section class="method-page"><div class="page-heading"><div><p class="eyebrow">PERSONALIZATION</p><h1>Your Learning Method</h1><p class="subtitle">Find a rhythm for learning ${esc(ctx.target?.name || 'a language')}. Explore what you enjoy, then make it your own.</p></div><a class="button" href="#home">Back to Home</a></div><div data-method-content></div></section>`;
}
function mount(root,ctx={}) {
  const container=root.querySelector('[data-method-content]'); if(!container) return;
  const initial=read(); let preferences=initial.value || defaultValue(),saved=!!initial.value,mode='preferences',step=0,answers=Array(questions.length).fill(null),message=initial.error || '',error=!!initial.error;
  function draw(focus=false) {
    container.innerHTML=mode==='quiz'?quiz():editor();
    if(focus) container.querySelector('h2')?.focus();
  }
  function notice() {return `<p class="method-message${error?' is-error':''}" role="status" aria-live="polite">${esc(message)}</p>`;}
  function quiz() {
    const q=questions[step];
    return `<div class="card method-quiz"><div class="method-step"><span>YOUR PREFERENCES</span><span>Question ${step+1} of ${questions.length}</span></div><progress aria-label="Quiz progress" value="${step+1}" max="${questions.length}"></progress><h2 tabindex="-1" id="method-question">${q.title}</h2><p class="method-muted">There are no right answers. Choose what feels most like you today.</p><fieldset aria-labelledby="method-question" class="method-options">${q.options.map(([label],i)=>`<label class="method-option${answers[step]===i?' selected':''}"><input type="radio" name="method-answer" value="${i}"${answers[step]===i?' checked':''}><span>${label}</span></label>`).join('')}</fieldset><div class="method-actions"><button type="button" class="text-button" data-method="cancel">Cancel quiz</button><div><button type="button" class="button" data-method="back"${step===0?' disabled':''}>Back</button><button type="button" class="button primary" data-method="next"${answers[step]===null?' disabled':''}>${step===questions.length-1?'See my method':'Continue'}</button></div></div>${notice()}</div>`;
  }
  function editor() {
    return `<div class="method-intro card"><div><span class="badge violet">${saved?'YOUR SAVED PREFERENCES':'A METHOD THAT FEELS LIKE YOU'}</span><h2 tabindex="-1">${saved?'Your way to practice':'Start with a little self-discovery'}</h2><p>Take an eight-question quiz to suggest a starting point, or choose your preferences below. These are flexible preferences, not fixed learning styles. A mix of practice can be useful.</p></div><button type="button" class="button primary" data-method="start">${saved?'Retake the quiz':'Take the learning quiz'} <span aria-hidden="true">→</span></button></div><div class="method-grid"><section class="card method-axis"><p class="eyebrow">01 / PRACTICE BALANCE</p><h2>Output vs Input</h2><p>Input is listening and reading. Output is speaking and writing. Choose the mix you would enjoy.</p><label for="method-output">Your preference: <strong data-output-label>${balanceLabel(preferences.output,'More input','More output')}</strong></label><input id="method-output" data-method-range="output" type="range" min="0" max="100" step="1" value="${preferences.output}"><div class="method-range-labels"><span>Input</span><span>Balanced</span><span>Output</span></div><p class="method-suggestion" data-output-suggestion>${100-preferences.output}% input · ${preferences.output}% output</p></section><section class="card method-axis"><p class="eyebrow">02 / GRAMMAR APPROACH</p><h2>Implicit vs Explicit Grammar</h2><p>Pick up patterns through examples, study clear rules, or combine the two approaches.</p><label for="method-grammar">Your preference: <strong data-grammar-label>${balanceLabel(preferences.grammar,'More implicit','More explicit')}</strong></label><input id="method-grammar" data-method-range="grammar" type="range" min="0" max="100" step="1" value="${preferences.grammar}"><div class="method-range-labels"><span>Implicit</span><span>Balanced</span><span>Explicit</span></div><p class="method-suggestion" data-grammar-suggestion>${100-preferences.grammar}% implicit · ${preferences.grammar}% explicit</p></section></div><section class="card method-modalities"><p class="eyebrow">03 / LEARNING STYLE</p><h2>How do you like to engage?</h2><p class="method-muted">Select the formats you enjoy. Choose at least one; you can enjoy all six.</p><fieldset class="method-modality-grid"><legend class="sr-only">Preferred learning formats</legend>${modalities.map(([id,label,description])=>`<label class="method-modality${preferences.modalities.includes(id)?' selected':''}"><input type="checkbox" data-method-modality="${id}"${preferences.modalities.includes(id)?' checked':''}><span><strong>${label}</strong><small>${description}</small></span></label>`).join('')}</fieldset></section><div class="method-save"><p>Saved on this browser. These preferences are a planning profile; they do not yet change your lessons.</p><button type="button" class="button primary" data-method="save">Save my preferences</button></div>${notice()}`;
  }
  function updateMessage(text,isError=false){message=text;error=isError;const el=container.querySelector('.method-message');if(el){el.textContent=text;el.classList.toggle('is-error',isError);}}
  function onInput(event) {
    const axis=event.target.dataset.methodRange;if(!axis)return;
    preferences[axis]=Number(event.target.value);
    container.querySelector(`[data-${axis}-label]`).textContent=balanceLabel(preferences[axis],axis==='output'?'More input':'More implicit',axis==='output'?'More output':'More explicit');
    container.querySelector(`[data-${axis}-suggestion]`).textContent=axis==='output'?`${100-preferences.output}% input · ${preferences.output}% output`:`${100-preferences.grammar}% implicit · ${preferences.grammar}% explicit`;
    updateMessage('You have unsaved changes.');
  }
  function onChange(event) {
    if(event.target.name==='method-answer') {answers[step]=Number(event.target.value);container.querySelectorAll('.method-option').forEach(el=>el.classList.toggle('selected',el.contains(event.target)));container.querySelector('[data-method="next"]').disabled=false;}
    const id=event.target.dataset.methodModality;if(!id)return;
    preferences.modalities=event.target.checked?[...preferences.modalities,id]:preferences.modalities.filter(value=>value!==id);
    event.target.closest('label').classList.toggle('selected',event.target.checked);updateMessage('You have unsaved changes.');
  }
  function onClick(event) {
    const action=event.target.closest('[data-method]')?.dataset.method;if(!action)return;
    if(action==='start'){mode='quiz';step=0;answers=Array(questions.length).fill(null);message='';draw(true);}
    if(action==='cancel'){mode='preferences';message='Quiz canceled. Your current preferences are unchanged.';error=false;draw(true);}
    if(action==='back' && step>0){step--;draw(true);}
    if(action==='next' && answers[step]!==null){if(step<questions.length-1){step++;}else{preferences=score(answers);mode='preferences';message='Your suggested method is ready. Adjust anything, then save your preferences.';error=false;}draw(true);}
    if(action==='save') {
      if(!valid(preferences)){updateMessage('Select at least one learning format before saving.',true);return;}
      try {localStorage.setItem(KEY,JSON.stringify(preferences));saved=true;message='Your learning preferences are saved.';error=false;draw();ctx.notify?.(message);}
      catch {updateMessage('Your preferences could not be saved. Browser storage may be full or unavailable. Your choices remain here; try saving again.',true);}
    }
  }
  container.addEventListener('click',onClick);container.addEventListener('input',onInput);container.addEventListener('change',onChange);draw();
  return ()=>{container.removeEventListener('click',onClick);container.removeEventListener('input',onInput);container.removeEventListener('change',onChange);};
}
const api={render,mount,score,valid,questions};
if(typeof window!=='undefined')window.PersonalizationMethod=api;
if(typeof module!=='undefined' && module.exports)module.exports=api;
})();
