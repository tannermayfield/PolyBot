const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname,'../personalization-regions.js'),'utf8');
function fixture(initial, code='es') {
  let value=initial, paused=0;
  const events={};
  const nodes={audio:{pause(){paused++;},addEventListener(){}},'.regions-save':{textContent:'',addEventListener(name,fn){events.save=fn;}},'.regions-audio-status':{textContent:''}};
  const detail={innerHTML:'',querySelector:s=>nodes[s],querySelectorAll:()=>[nodes.audio]};
  const map={querySelectorAll:()=>[]};
  const select={value:'',addEventListener(name,fn){events.change=fn;}};
  const root={querySelector:s=>s==='[data-region-map]'?map:s==='[data-region-detail]'?detail:select};
  const window={};
  vm.runInNewContext(src,{window,localStorage:{getItem:()=>value,setItem:(k,v)=>{assert.equal(k,'giftOfTonguesRegion');value=v;}},AbortController,fetch:()=>new Promise(()=>{})});
  const api=window.PersonalizationRegions;
  const cleanup=api.mount(root,{target:{code}});
  return {api,detail,select,events,cleanup,get saved(){return JSON.parse(value)},get paused(){return paused}};
}
test('all 21 selectable regions have outlines and sourced native recording playback',()=>{
  const f=fixture();
  const html=f.api.render({target:{code:'es'}});
  const ids=[...html.matchAll(/<option value="([A-Z]{2})"/g)].map(m=>m[1]);
  assert.equal(ids.length,21);
  const map=JSON.parse(fs.readFileSync(path.join(__dirname,'../regions-map.json')));
  for(const id of ids){
    assert.ok(map.paths.some(p=>p.id===id && p.d.startsWith('M')),id+' outline');
    f.select.value=id;f.events.change();
    assert.match(f.detail.innerHTML,/<audio controls preload="none"/);
    assert.match(f.detail.innerHTML,/src="https:\/\/(pragmatics.indiana.edu|cvc.cervantes.es|labfon.flog.uned.es)\//);
  }
});
test('changing region saves and restores validated Spanish preference',()=>{
  const f=fixture('{bad json');
  assert.equal(f.select.value,'MX');
  f.select.value='GQ';f.events.change();f.events.save();
  assert.equal(f.saved.countryCode,'GQ');assert.equal(f.saved.locale,'es-GQ');
  const restored=fixture(JSON.stringify(f.saved));
  assert.equal(restored.select.value,'GQ');
  assert.match(restored.detail.innerHTML,/Preferred region/);
  f.cleanup();assert.ok(f.paused>1);
});
test('other languages can preview but do not overwrite their region',()=>{
  const f=fixture('null','fr');
  assert.match(f.api.render({target:{code:'fr'}}),/your current language are coming later/);
  assert.match(f.detail.innerHTML,/type="button" disabled/);
  f.events.save();assert.equal(f.saved,null);
});
