(function () {
  'use strict';
  const KEY = 'polybotRegion';
  const store = () => window.PolybotPrefs || localStorage;
  const CVC = 'https://cvc.cervantes.es/LENGUA/voces_hispanicas/';
  const IU = 'https://pragmatics.indiana.edu/';
  const UNED = 'https://labfon.flog.uned.es/en/laboratorio/antonioquilis/legado/guineaecuatorial';
  // Each recording retains its original institution-hosted URL; no generated accents.
  const rows = [
    ['MX','Mexico','North America',-102,24,'Mexico City','Central Mexican Spanish often preserves a clear final s. Tú and ustedes are common forms of address.','Platicar is widely used for “to chat.”','mexico/mexicodf','MexicoCuernavacaFem.mp3','Cuernavaca: the city of eternal spring'],
    ['GT','Guatemala','Central America',-90.3,15.6,'Antigua','Voseo is part of informal speech. Highland and coastal speech have different pronunciation patterns.','Spanish shares the country with many Mayan languages.','guatemala/antigua','guatemala_antigua.mp4','Antigua: local speaker'],
    ['HN','Honduras','Central America',-86.6,15.2,'Tegucigalpa','Vos is used in familiar conversation. S at the end of a syllable may be softened.','Local vocabulary includes catracho, a word for a Honduran.','honduras/tegucigalpa','HondurasTegucigalpaFem.mp3','Memories of Tegucigalpa'],
    ['SV','El Salvador','Central America',-88.9,13.7,'Joya de Cerén','Vos is common in familiar address. Final-s pronunciation varies with the speaker and setting.','The archaeological site Joya de Cerén preserves a former farming village.','elsalvador/ceren','el-salvador_joya_de_cerun.mp4','Joya de Cerén: local speaker'],
    ['NI','Nicaragua','Central America',-85.1,12.8,'Nicaragua','Vos is common in everyday conversation, alongside usted in more formal contexts.','Listen for regional food vocabulary in this first-person recording.','', 'NicaraguaMale.mp3','Nicaraguan food'],
    ['CR','Costa Rica','Central America',-84.2,9.8,'San José','Usted is used even in some close relationships; vos is also used.','Tico and tica are familiar words for Costa Ricans.','costarica/sanjose','CostaRicaMale-Tico.mp3','Ticos and Costa Rican coffee'],
    ['PA','Panama','Central America',-80,8.5,'Portobelo','Coastal speech often softens s at the end of a syllable. Tú and ustedes are common.','Portobelo lies on the Caribbean coast, an important setting for local cultural traditions.','panama/portobelo','panama_portobelo.mp4','Portobelo: local speaker'],
    ['CU','Cuba','Caribbean',-79.6,22,'Havana','Syllable-final consonants can be softened or omitted in casual speech.','Guagua is a local word for a bus.','cuba/la_habana','CubaHabanaMale.mp3','Life in Havana'],
    ['DO','Dominican Republic','Caribbean',-70.5,19,'Santo Domingo','Final s is often weakened in everyday speech; pronunciation varies across the island.','The carnival recording introduces local celebration vocabulary.','republicadominicana/santodomingo','DominicanRepublic-Vega-Fem.mp3','Dominican carnival'],
    ['PR','Puerto Rico','Caribbean',-66.4,18.2,'San Juan','Syllable-final s may be aspirated; some speakers pronounce final r with an l-like sound.','Boricua is a word Puerto Ricans use for their identity. Puerto Rico is a US territory.','puertorico/sanjuan','PuertoRicoRincon-Female.mp3','Rincón: los boricuas'],
    ['CO','Colombia','South America',-73.4,4,'Bogotá','Highland and Caribbean varieties differ substantially. Bogotá speech often retains final s.','Usted can convey closeness as well as formality, depending on the region.','colombia/bogota','ColombiaBucaramangaMale-_B4.mp3','Bucaramanga: a local food tradition'],
    ['VE','Venezuela','South America',-66.5,8,'Caracas','Caracas speech often softens syllable-final s. Tú is common; other areas also use vos.','Local speech includes vocabulary shared with the Caribbean.','venezuela/caracas','VenezuelaCaracasFem.mp3','Venezuelan food and dance'],
    ['EC','Ecuador','South America',-78.5,-1.5,'Guayaquil','Coastal and highland pronunciation differ. Coastal speech may soften syllable-final s.','Kichwa has contributed vocabulary to Ecuadorian Spanish.','ecuador/guayaquil','EcuadorQuitoFem.mp3','Quito: the middle of the world'],
    ['PE','Peru','South America',-75.2,-10,'Lima','Lima and the Andean highlands have distinct varieties. Coastal speech may soften s.','Quechua has contributed words such as cancha to Spanish.','peru/lima','peru_lima.mp4','Lima: local speaker'],
    ['BO','Bolivia','South America',-64.8,-17,'La Paz','La Paz Spanish often retains final s; some speakers distinguish ll from y.','Spanish coexists with Indigenous languages including Quechua and Aymara.','bolivia/lapaz','bolivia_la_paz.mp4','La Paz: art and Andean traditions'],
    ['PY','Paraguay','South America',-58.3,-23.1,'Asunción','Vos is used in everyday speech. Spanish and Guaraní interact in many communities.','Jopara describes forms of mixed Guaraní and Spanish speech.','paraguay/asuncion','paraguay_asuncion.mp4','Asunción: local speaker'],
    ['CL','Chile','South America',-71,-30,'Santiago','In casual Santiago speech, final s may be softened and intervocalic d may be omitted.','Chilean conversation includes distinctive local words and informal verb forms.','chile/santiago','chile_santiago.mp4','Santiago: local speaker'],
    ['AR','Argentina','South America',-64,-36,'Buenos Aires','Rioplatense Spanish uses vos. In Buenos Aires, ll and y often have a sh- or zh-like sound.','Colectivo is a common word for a bus. Argentina has many varieties beyond Buenos Aires.','argentina/buenosaires','ArgentinaBuenosAiresFem.mp3','Buenos Aires: Argentine mate'],
    ['UY','Uruguay','South America',-56,-32.6,'Montevideo','Rioplatense features include a sh- or zh-like pronunciation of ll and y. Vos is common.','Mate is an everyday social tradition. Tú and vos usage varies.','uruguay/montevideo','UruguayMercedezMale.mp3','Mercedes: Uruguayan mate'],
    ['ES','Spain','Europe',-3.7,40,'Madrid','Much of central and northern Spain distinguishes s from the th-like sound of z and soft c.','Vosotros is used for informal plural address in much of Spain; regional varieties differ.','espana/madrid','SpainAlmeriaFem.mp3','Almería: a southern Spanish voice'],
    ['GQ','Equatorial Guinea','Africa',10.3,1.7,'Equatorial Guinea','Spanish is used alongside languages including Fang and Bubi; multilingual experience shapes local speech.','This country spans mainland Río Muni and islands including Bioko.','', 'https://labfon.flog.uned.es/sites/default/files/2021-11/3_El%20secadero%20de%20cacao.WAV','Field recording: the cocoa drying shed']
  ];
  const countries = rows.map(([id,name,group,lon,lat,city,accent,fact,page,file,title]) => ({id,name,group,lon,lat,city,accent,fact,
    source: id === 'GQ' ? UNED : page ? CVC + page + '.htm' : IU + 'pragmaticvariation/voces.html',
    audio: file.startsWith('https:') ? file : file.endsWith('.mp4') ? CVC + 'videos/' + file : IU + 'audio/voces-hispanas/' + file,
    recordingSource: id === 'GQ' ? UNED : file.endsWith('.mp4') ? CVC + page + '.htm' : IU + 'pragmaticvariation/voces.html',
    institution: id === 'GQ' ? 'UNED · Antonio Quilis Phonetics Laboratory' : file.endsWith('.mp4') ? 'Instituto Cervantes · Catálogo de voces hispánicas' : 'Indiana University · Voces Hispanas', title
  }));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function saved() { try { const value=JSON.parse((store().getItem(KEY) ?? store().getItem(KEY.replace('polybot', 'giftOfTongues'))));return countries.some(c=>c.id===value?.countryCode)?value.countryCode:null; } catch { return null; } }
  const isSpanish = ctx => /^es(?:-|$)/i.test(ctx?.target?.code || 'es');
  function render(ctx) {
    return `<section class="regions-page"><a href="#home" class="text-button">← Home</a><header class="page-heading"><div><p class="eyebrow">Personalization · Spanish</p><h1>Regions &amp; Accents</h1><p class="subtitle">Find a voice you connect with. Explore the Spanish-speaking world, listen, and choose a region for your learning.</p></div></header>${!isSpanish(ctx)?'<p class="regions-notice">Regions for your current language are coming later. Explore Spanish below; your current language will stay unchanged.</p>':''}<div class="regions-layout"><section class="regions-map-card card"><div class="regions-map-heading"><h2>A world of Spanish</h2><p>Choose a country on the map, or use the country selector.</p></div><div class="regions-map" data-region-map><p class="regions-map-loading">Loading geographic map…</p></div><div class="regions-selector"><label for="region-country">Country or territory</label><select id="region-country">${[...new Set(countries.map(c=>c.group))].map(group=>`<optgroup label="${group}">${countries.filter(c=>c.group===group).map(c=>`<option value="${c.id}">${c.name}</option>`).join('')}</optgroup>`).join('')}</select><p>20 countries and Puerto Rico. Spanish-speaking communities also flourish elsewhere.</p></div></section><section class="regions-detail card" aria-label="Selected region" data-region-detail></section></div><p class="regions-footnote">Every country contains many accents. These recordings illustrate individual speakers, not a single national standard. Map: <a href="https://github.com/datasets/geo-countries" target="_blank" rel="noopener noreferrer">Natural Earth geographic data</a>.</p></section>`;
  }
  function mount(root, ctx = {}) {
    let alive = true, selected = saved() || 'MX';
    const map = root.querySelector('[data-region-map]'), detail = root.querySelector('[data-region-detail]'), select = root.querySelector('#region-country');
    if (!map || !detail || !select) return () => {};
    const abort = new AbortController();
    const stop = () => detail.querySelectorAll('audio').forEach(a=>a.pause());
    function drawDetail() {
      stop();
      const c = countries.find(c=>c.id===selected);
      detail.innerHTML = `<p class="eyebrow">${c.group} · ${c.id === 'PR' ? 'Territory' : 'Country'}</p><h2>${c.name}</h2><span class="badge violet">Spanish · es-${c.id}</span><div class="regions-fact"><h3>Listen for</h3><p>${c.accent}</p></div><div class="regions-fact"><h3>A little local context</h3><p>${c.fact}</p></div><a class="text-button" href="${esc(c.source)}" target="_blank" rel="noopener noreferrer">Read the regional source ↗</a><div class="regions-listen"><h3>Hear a local voice</h3><p>${c.title}</p><audio controls preload="none" aria-label="${esc(c.name+' recording: '+c.title)}" src="${esc(c.audio)}"></audio><p class="regions-audio-status" role="status">Original recording · internet connection required</p><a href="${esc(c.recordingSource)}" target="_blank" rel="noopener noreferrer">${c.institution} ↗</a></div><button class="button primary regions-save" type="button" ${!isSpanish(ctx)?'disabled':''}>${saved()===c.id?'Preferred region ✓':'Choose '+c.name}</button><p class="regions-save-note">${!isSpanish(ctx)?'Switch your learning language to Spanish to save a region.':'Saves your Spanish preference on this device. You can change it anytime.'}</p>`;
      detail.querySelector('audio').addEventListener('error',()=>{detail.querySelector('.regions-audio-status').textContent='This recording could not load. Open the source link to listen on the original site.';});
      detail.querySelector('.regions-save').addEventListener('click',()=>{
        if(!isSpanish(ctx))return;
        try { const previous = saved(); store().setItem(KEY, JSON.stringify({version:1,language:'es',countryCode:c.id,name:c.name,locale:'es-'+c.id,updatedAt:new Date().toISOString()}), () => { drawDetail(); ctx.notify?.('Your region could not be saved on this device.',true); }); if (previous !== c.id) window.PolybotEvents?.record('preference_set', {language:'es',payload:{preference_key:'region',value:c.id,stated_via:'settings',...(previous?{previous_value:previous}:{})}}); detail.querySelector('.regions-save').textContent='Preferred region ✓'; ctx.notify?.(c.name+' saved as your preferred Spanish region.'); }
        catch { ctx.notify?.('Your region could not be saved on this device.',true); }
      });
    }
    function choose(id) {
      if(!countries.some(c=>c.id===id))return;
      selected=id;select.value=id;
      map.querySelectorAll('[data-country]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.country===id)));
      drawDetail();
    }
    select.addEventListener('change',()=>choose(select.value),{signal:abort.signal});
    choose(selected);
    fetch('regions-map.json',{signal:abort.signal}).then(r=>{if(!r.ok)throw new Error('map');return r.json();}).then(data=>{
      if(!alive)return;
      const outline = data.paths.map(p=>`<path class="regions-land${countries.some(c=>c.id===p.id)?' regions-spanish':''}" d="${esc(p.d)}"/>`).join('');
      const targets = countries.map(c=>{
        const p=data.paths.find(p=>p.id===c.id),x=(c.lon+120)*4,y=(53-c.lat)*4;
        return `<g class="regions-country" tabindex="0" role="button" aria-label="Explore ${c.name}" aria-pressed="${c.id===selected}" data-country="${c.id}">${p?`<path d="${esc(p.d)}"/>`:''}<circle class="regions-hit" cx="${x}" cy="${y}" r="6"/><circle class="regions-dot" cx="${x}" cy="${y}" r="2.8"/><title>${c.name}</title></g>`;
      }).join('');
      map.innerHTML=`<svg class="regions-world" viewBox="${data.viewBox}" aria-label="Interactive map of Spanish-speaking countries"><g>${outline}</g><text class="regions-ocean" x="365" y="180">ATLANTIC</text><text class="regions-ocean" x="365" y="195">OCEAN</text>${targets}</svg><span class="regions-tooltip" role="tooltip" hidden></span>`;
      const tip=map.querySelector('.regions-tooltip');
      map.querySelectorAll('[data-country]').forEach(el=>{
        const c=countries.find(c=>c.id===el.dataset.country);
        const show=()=>{tip.textContent=c.name;tip.style.left=((c.lon+120)*4/568*100)+'%';tip.style.top=((53-c.lat)*4/444*100)+'%';tip.hidden=false;};
        el.addEventListener('mouseenter',show);el.addEventListener('focus',show);
        el.addEventListener('mouseleave',()=>{tip.hidden=true;});el.addEventListener('blur',()=>{tip.hidden=true;});
        el.addEventListener('click',()=>choose(c.id));
        el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(c.id);}});
      });
    }).catch(e=>{if(alive&&e.name!=='AbortError')map.innerHTML='<p class="regions-map-loading">The map could not load. You can still explore every region using the selector below.</p>';});
    return () => {alive=false;abort.abort();stop();};
  }
  window.PersonalizationRegions = {render,mount};
})();
