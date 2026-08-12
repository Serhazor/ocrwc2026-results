(() => {
  'use strict';
  const app = document.getElementById('app');

  async function loadData() {
    if (!window.OCR_DATA_PARTS || !window.OCR_DATA_PARTS.length) throw new Error('Compressed dataset missing');
    if (!('DecompressionStream' in window)) throw new Error('This browser does not support DecompressionStream');
    const raw = atob(window.OCR_DATA_PARTS.join(''));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const text = await new Response(stream).text();
    return JSON.parse(text);
  }

  loadData().then(start).catch(err => {
    console.error(err);
    app.innerHTML = '<div class="notice danger"><strong>Data failed to load</strong>The championship dataset could not be opened in this browser.</div>';
  });

  function start(D) {

  const eventById = Object.fromEntries(D.events.map(x => [x.id, x]));
  const athleteById = Object.fromEntries(D.athletes.map(x => [x.id, x]));
  const teamById = Object.fromEntries(D.teams.map(x => [x.id, x]));
  const resultById = Object.fromEntries(D.results.map(x => [x.id, x]));
  const medalById = Object.fromEntries(D.medals.map(x => [x.id, x]));
  const countryByIso = Object.fromEntries(D.countries.map(x => [x.countryIso, x]));
  const eventOrder = ['100m','100m-team','400m','400m-team','short','standard','xc-team'];
  const PAGE_SIZE = 50;

  const esc = (v='') => String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const num = v => Number(v || 0).toLocaleString();
  const medalIcon = m => m === 'Gold' ? '🥇' : m === 'Silver' ? '🥈' : m === 'Bronze' ? '🥉' : '';
  const statusClass = s => String(s || '').toLowerCase().replace(/\s+/g,'-');
  const eventName = id => eventById[id]?.name || id;

  function setTitle(text) {
    document.title = text ? `${text} · OCR WC 2026` : '2026 OCR World Championships Results';
  }
  function routeTo(hash) { location.hash = hash; }
  function backLink(hash, text='Back') { return `<a class="back-link" href="${hash}">← ${esc(text)}</a>`; }
  function metric(label, value, sub='') {
    return `<div class="metric"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;
  }
  function badgeStatus(s) { return `<span class="status-badge ${statusClass(s)}">${esc(s)}</span>`; }
  function badgeMedal(m) { return m ? `<span class="medal-badge ${m.toLowerCase()}">${medalIcon(m)} ${esc(m)}</span>` : ''; }
  function countryLink(iso, name, flg) { return `<a class="country-link" href="#country/${esc(iso)}">${esc(flg)} ${esc(name)}</a>`; }
  function athleteLink(id, name) { return `<a class="athlete-link" href="#athlete/${esc(id)}">${esc(name)}</a>`; }
  function teamLink(id, name) { return `<a class="team-link" href="#team/${esc(id)}">${esc(name)}</a>`; }
  function rankDisplay(r) {
    if (r.medal) return `${medalIcon(r.medal)} ${r.place}`;
    if (r.place) return String(r.place);
    if (r.qualifyingRank) return `Q${r.qualifyingRank}`;
    return '—';
  }
  function resultDetail(r) {
    if (r.eventId === '100m') {
      if (r.directFinal) return 'Direct final';
      return r.stage || 'Qualification';
    }
    if (r.eventId === '400m') return `Qualification${r.qualifyingRank ? ` · rank ${r.qualifyingRank}` : ''}`;
    return r.status;
  }
  function noteFor400() {
    return `<div class="notice danger"><strong>400m individual finals are missing from the supplied data</strong>${esc(D.meta.combinedMedalNote)}</div>`;
  }

  function renderOverview() {
    setTitle('Overview');
    const combined = D.medalTables.combined;
    const leader = combined[0];
    app.innerHTML = `
      <section class="hero">
        <div class="hero-copy">
          <div class="eyebrow">Interactive championship archive</div>
          <h1>2026 OCR World Championships Results</h1>
          <p>Explore every supplied result by event, country and athlete. Follow athletes across multiple races, inspect qualification and elimination stages, compare medal tables and dig into the statistics behind the championship.</p>
          <div class="quick-links">
            <button class="btn primary" data-go="#results">Explore results</button>
            <button class="btn" data-go="#medals">View medal tables</button>
            <button class="btn" data-go="#athletes">Find an athlete</button>
          </div>
        </div>
        <div class="hero-side">
          <div><div class="flag-big">🇮🇪</div><strong>Ireland · 2026</strong><p>Seven event types across individual and team competition.</p></div>
          <div><span class="event-badge">Data status</span><p>${esc(D.meta.dataStatus)}</p></div>
        </div>
      </section>
      <div class="metric-grid">
        ${metric('Linked athletes', num(D.athletes.length), 'Across all supplied datasets')}
        ${metric('Nations', num(D.countries.length), 'Countries and territories')}
        ${metric('Result records', num(D.results.length), 'Individual + team records')}
        ${metric('Available medals', num(D.medals.length), 'Excludes individual 400m medals')}
      </div>
      ${noteFor400()}
      <section class="section">
        <div class="section-head"><div><h2>Events</h2><p>Open an event for its summary, facts, medal table and results.</p></div></div>
        <div class="event-grid">
          ${eventOrder.map(id => {
            const e=eventById[id], s=D.summaries[id];
            return `<a class="event-card" href="#event/${id}"><span class="event-badge">${e.kind === 'team' ? 'Team' : 'Individual'}</span><h3>${esc(e.name)}</h3><p>${esc(e.description)}</p><div class="mini-stats"><span><strong>${num(s.entries)}</strong> entries</span><span><strong>${num(s.countries)}</strong> nations</span></div></a>`;
          }).join('')}
        </div>
      </section>
      <section class="section grid-2">
        <div class="panel">
          <div class="section-head"><div><h2>Combined medal leaders</h2><p>Available/calculable events.</p></div><a class="btn" href="#medals">Full table</a></div>
          ${medalTableHtml(combined.slice(0,8), false)}
        </div>
        <div class="panel">
          <div class="section-head"><div><h2>Interesting facts</h2><p>A few things the raw spreadsheets were not volunteering.</p></div></div>
          <div class="fact-list">${D.overallFacts.map(x=>`<div class="fact">${esc(x)}</div>`).join('')}</div>
        </div>
      </section>
      <section class="section grid-2">
        <div class="panel">
          <div class="section-head"><div><h2>Most multi-event athletes</h2><p>Linked across the most event types.</p></div></div>
          <div class="list">${D.mostEvents.slice(0,8).map(a=>`<div class="list-item"><div class="main"><strong>${a.flag} ${athleteLink(a.id,a.name)}</strong><small>${esc(a.country)}</small></div><span class="event-badge">${a.eventCount} events</span></div>`).join('')}</div>
        </div>
        <div class="panel">
          <div class="section-head"><div><h2>Largest delegations</h2><p>Unique linked athletes in the available files.</p></div></div>
          <div class="list">${D.largestCountries.slice(0,8).map(c=>`<div class="list-item"><div class="main"><strong>${countryLink(c.countryIso,c.country,c.flag)}</strong><small>${c.total} available medals</small></div><span>${num(c.athletes)} athletes</span></div>`).join('')}</div>
        </div>
      </section>`;
    bindGoButtons();
  }

  function medalTableHtml(rows, includeHeader=true) {
    if (!rows || !rows.length) return '<div class="empty">No medal table is available for this event.</div>';
    return `<div class="table-wrap"><table class="medal-table"><thead><tr><th class="num">#</th><th>Country</th><th class="num">Gold</th><th class="num">Silver</th><th class="num">Bronze</th><th class="num">Total</th></tr></thead><tbody>${rows.map(x=>`<tr><td class="num rank">${x.rank}</td><td>${countryLink(x.countryIso,x.country,x.flag)}</td><td class="num">🥇 ${x.gold}</td><td class="num">🥈 ${x.silver}</td><td class="num">🥉 ${x.bronze}</td><td class="num"><strong>${x.total}</strong></td></tr>`).join('')}</tbody></table></div>`;
  }

  function renderEvent(id) {
    const e=eventById[id]; if (!e) return renderNotFound();
    const s=D.summaries[id], facts=D.eventFacts[id] || [], table=D.medalTables[id] || [];
    setTitle(e.name);
    let extra='';
    if (id==='short' || id==='standard') extra = `${metric('Ranked finishes',num(s.ranked))}${metric('DNC',num(s.dnc),`${s.dncRate}% of timed finishers`)}${metric('DNS / DNF',`${s.dns} / ${s.dnf}`)}`;
    else if (id==='xc-team') extra = `${metric('Ranked teams',num(s.rankedTeams))}${metric('DNC teams',num(s.dnc))}`;
    else if (id==='100m-team' || id==='400m-team') extra = `${metric('Medal-eligible teams',num(s.medalEligibleTeams))}`;
    else if (id==='100m') extra = `${metric('Championship entries',num(s.championshipEntries))}`;
    const fastest=s.fastest;
    app.innerHTML = `
      ${backLink('#overview','Overview')}
      <div class="profile-head"><div><span class="event-badge">${e.kind === 'team' ? 'Team event' : 'Individual event'}</span><h1>${esc(e.name)}</h1><p class="muted">${esc(e.description)}</p></div><a class="btn primary" href="#results/${id}">View all ${esc(e.name)} results</a></div>
      ${id==='400m' ? noteFor400() : ''}
      <div class="metric-grid">
        ${metric('Entries',num(s.entries))}${metric('Nations',num(s.countries))}${metric('Categories',num(s.categories))}
        ${fastest ? metric('Fastest supplied time',fastest.time,`${fastest.name} · ${fastest.country}`) : metric('Fastest supplied time','—')}
        ${extra}
      </div>
      <section class="section grid-2">
        <div class="panel"><div class="section-head"><div><h2>Event facts</h2><p>Derived from the supplied results.</p></div></div><div class="fact-list">${facts.length?facts.map(x=>`<div class="fact">${esc(x)}</div>`).join(''):'<div class="empty">No additional facts calculated.</div>'}</div></div>
        <div class="panel"><div class="section-head"><div><h2>Medal table</h2><p>${e.medalData==='unavailable'?'Not available from the supplied final data.':'Top countries in this event.'}</p></div><a class="btn" href="#medals/${id}">Open table</a></div>${medalTableHtml(table.slice(0,8),false)}</div>
      </section>
      <section class="section"><div class="section-head"><div><h2>Leading results</h2><p>Fastest available records across categories. Use the results explorer for complete filtering.</p></div></div>${resultsTableHtml(D.results.filter(r=>r.eventId===id).filter(r=>r.timeSeconds!=null).sort((a,b)=>a.timeSeconds-b.timeSeconds).slice(0,30))}</section>`;
  }

  function resultsTableHtml(rows) {
    if (!rows.length) return '<div class="empty">No results match these filters.</div>';
    return `<div class="table-wrap"><table><thead><tr><th class="num">Place</th><th>Athlete / Team</th><th>Country</th><th>Event</th><th>Category</th><th>Status / Stage</th><th class="num">Time</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="num rank ${r.place&&r.place<=3?`podium-${r.place}`:''}">${rankDisplay(r)}</td><td>${r.type==='team'?teamLink(r.teamId,r.name):athleteLink(r.athleteId,r.name)}</td><td>${countryLink(r.countryIso,r.country,r.flag)}</td><td><a href="#event/${r.eventId}">${esc(r.event)}</a></td><td>${esc(r.category)}</td><td>${r.medal?badgeMedal(r.medal):badgeStatus(resultDetail(r))}</td><td class="num time">${esc(r.time||'—')}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function renderResults(initialEvent='') {
    setTitle('Results');
    app.innerHTML = `
      <div class="section-head"><div><div class="eyebrow">Results explorer</div><h1>All Results</h1><p>Filter by event, country, category or status. Click an athlete or team to open its profile.</p></div></div>
      <div class="panel">
        <div class="filters">
          <div class="field"><label for="f-search">Search athlete or team</label><input id="f-search" placeholder="Start typing a name…"></div>
          <div class="field"><label for="f-event">Event</label><select id="f-event"><option value="">All events</option>${D.events.map(e=>`<option value="${e.id}" ${initialEvent===e.id?'selected':''}>${esc(e.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="f-country">Country</label><select id="f-country"><option value="">All countries</option>${D.countries.map(c=>`<option value="${c.countryIso}">${c.flag} ${esc(c.country)}</option>`).join('')}</select></div>
          <div class="field"><label for="f-category">Category</label><select id="f-category"><option value="">All categories</option></select></div>
          <div class="field"><label for="f-status">Status</label><select id="f-status"><option value="">All statuses</option><option>Ranked</option><option>DNC</option><option>DNS</option><option>DNF</option><option>No Time</option></select></div>
        </div>
        <div class="filters" style="grid-template-columns:1fr 1fr 3fr">
          <div class="field"><label for="f-sort">Sort</label><select id="f-sort"><option value="place">Place / rank</option><option value="time">Time</option><option value="name">Name</option><option value="country">Country</option><option value="category">Category</option></select></div>
          <div class="field"><label for="f-type">Type</label><select id="f-type"><option value="">Individual + team</option><option value="individual">Individual</option><option value="team">Team</option></select></div>
          <div></div>
        </div>
        <div id="results-count" class="muted" style="margin:6px 0 12px"></div>
        <div id="results-table"></div>
        <div id="results-pagination" class="pagination"></div>
      </div>`;
    const els = Object.fromEntries(['search','event','country','category','status','sort','type'].map(k=>[k,document.getElementById(`f-${k}`)]));
    let page=1;
    const categories = () => [...new Set(D.results.filter(r=>!els.event.value || r.eventId===els.event.value).map(r=>r.category))].sort((a,b)=>a.localeCompare(b));
    const fillCategories = () => { const old=els.category.value; els.category.innerHTML='<option value="">All categories</option>'+categories().map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join(''); if([...els.category.options].some(o=>o.value===old)) els.category.value=old; };
    const apply = () => {
      let rows=D.results.slice(); const q=els.search.value.trim().toLowerCase();
      if(q) rows=rows.filter(r=>r.name.toLowerCase().includes(q));
      if(els.event.value) rows=rows.filter(r=>r.eventId===els.event.value);
      if(els.country.value) rows=rows.filter(r=>r.countryIso===els.country.value);
      if(els.category.value) rows=rows.filter(r=>r.category===els.category.value);
      if(els.status.value) rows=rows.filter(r=>r.status===els.status.value || resultDetail(r)===els.status.value);
      if(els.type.value) rows=rows.filter(r=>r.type===els.type.value);
      const sort=els.sort.value;
      rows.sort((a,b)=>{
        if(sort==='time') return (a.timeSeconds??Infinity)-(b.timeSeconds??Infinity) || a.name.localeCompare(b.name);
        if(sort==='name') return a.name.localeCompare(b.name);
        if(sort==='country') return a.country.localeCompare(b.country)||a.name.localeCompare(b.name);
        if(sort==='category') return a.category.localeCompare(b.category)||(a.place??999)-(b.place??999)||(a.timeSeconds??Infinity)-(b.timeSeconds??Infinity);
        return (a.place??a.qualifyingRank??999)-(b.place??b.qualifyingRank??999)||(a.timeSeconds??Infinity)-(b.timeSeconds??Infinity);
      });
      const pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE)); if(page>pages) page=pages;
      const slice=rows.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
      document.getElementById('results-count').textContent=`${rows.length.toLocaleString()} result${rows.length===1?'':'s'} · page ${page} of ${pages}`;
      document.getElementById('results-table').innerHTML=resultsTableHtml(slice);
      document.getElementById('results-pagination').innerHTML=`<span>Showing ${rows.length?((page-1)*PAGE_SIZE+1):0}–${Math.min(page*PAGE_SIZE,rows.length)} of ${rows.length}</span><div class="buttons"><button id="prev" ${page<=1?'disabled':''}>Previous</button><button id="next" ${page>=pages?'disabled':''}>Next</button></div>`;
      document.getElementById('prev')?.addEventListener('click',()=>{page--;apply();});
      document.getElementById('next')?.addEventListener('click',()=>{page++;apply();});
    };
    fillCategories(); apply();
    ['search','country','category','status','sort','type'].forEach(k=>els[k].addEventListener(k==='search'?'input':'change',()=>{page=1;apply();}));
    els.event.addEventListener('change',()=>{page=1;fillCategories();apply();});
  }

  function renderAthletes() {
    setTitle('Athletes');
    app.innerHTML=`<div class="section-head"><div><div class="eyebrow">Athlete directory</div><h1>Athletes</h1><p>Follow one athlete across every individual race and relay membership we could link.</p></div></div>
      <div class="panel"><div class="filters" style="grid-template-columns:2fr 1fr 1fr 1fr 1fr"><div class="field"><label>Search athlete</label><input id="a-search" placeholder="Name…"></div><div class="field"><label>Country</label><select id="a-country"><option value="">All countries</option>${D.countries.map(c=>`<option value="${c.countryIso}">${c.flag} ${esc(c.country)}</option>`).join('')}</select></div><div class="field"><label>Participation</label><select id="a-events"><option value="0">Any</option><option value="2">2+ events</option><option value="4">4+ events</option><option value="6">6+ events</option></select></div><div class="field"><label>Sort</label><select id="a-sort"><option value="name">Name</option><option value="events">Most events</option><option value="medals">Most medals</option></select></div><div></div></div><div id="athlete-count" class="muted" style="margin-bottom:12px"></div><div id="athlete-table"></div></div>`;
    const search=document.getElementById('a-search'), country=document.getElementById('a-country'), ev=document.getElementById('a-events'), sort=document.getElementById('a-sort');
    const apply=()=>{ let arr=D.athletes.slice(),q=search.value.trim().toLowerCase(); if(q)arr=arr.filter(a=>a.name.toLowerCase().includes(q)||a.aliases.some(x=>x.toLowerCase().includes(q))); if(country.value)arr=arr.filter(a=>a.countryIso===country.value); if(+ev.value)arr=arr.filter(a=>a.eventCount>=+ev.value); if(sort.value==='events')arr.sort((a,b)=>b.eventCount-a.eventCount||b.medalCount-a.medalCount||a.name.localeCompare(b.name)); else if(sort.value==='medals')arr.sort((a,b)=>b.goldCount-a.goldCount||b.silverCount-a.silverCount||b.bronzeCount-a.bronzeCount||a.name.localeCompare(b.name)); else arr.sort((a,b)=>a.name.localeCompare(b.name)); document.getElementById('athlete-count').textContent=`${arr.length.toLocaleString()} athletes`; document.getElementById('athlete-table').innerHTML=`<div class="table-wrap"><table><thead><tr><th>Athlete</th><th>Country</th><th class="num">Events</th><th class="num">🥇</th><th class="num">🥈</th><th class="num">🥉</th></tr></thead><tbody>${arr.map(a=>`<tr><td>${athleteLink(a.id,a.name)}</td><td>${countryLink(a.countryIso,a.country,a.flag)}</td><td class="num"><strong>${a.eventCount}</strong></td><td class="num">${a.goldCount}</td><td class="num">${a.silverCount}</td><td class="num">${a.bronzeCount}</td></tr>`).join('')}</tbody></table></div>`;};
    search.addEventListener('input',apply);[country,ev,sort].forEach(x=>x.addEventListener('change',apply));apply();
  }

  function renderAthlete(id) {
    const a=athleteById[id]; if(!a)return renderNotFound(); setTitle(a.name);
    const indiv=a.results.map(x=>resultById[x]).filter(Boolean).sort((x,y)=>eventOrder.indexOf(x.eventId)-eventOrder.indexOf(y.eventId));
    const tms=a.teamResults.map(x=>teamById[x]).filter(Boolean).sort((x,y)=>eventOrder.indexOf(x.eventId)-eventOrder.indexOf(y.eventId));
    const am=a.medals.map(x=>medalById[x]).filter(Boolean);
    app.innerHTML=`${backLink('#athletes','Athletes')}<div class="profile-head"><div class="profile-title"><div class="profile-flag">${a.flag}</div><div><h1>${esc(a.name)}</h1><p>${esc(a.country)} · ${esc(a.gender)}${a.aliases.length?` · also listed as ${esc(a.aliases.join(', '))}`:''}</p><div class="medal-strip">${a.eventIds.map(e=>`<a class="event-badge" href="#event/${e}">${esc(eventName(e))}</a>`).join('')}</div></div></div><div class="medal-strip"><div class="medal-count"><strong>${a.goldCount}</strong><span>🥇 Gold</span></div><div class="medal-count"><strong>${a.silverCount}</strong><span>🥈 Silver</span></div><div class="medal-count"><strong>${a.bronzeCount}</strong><span>🥉 Bronze</span></div><div class="medal-count"><strong>${a.eventCount}</strong><span>Events</span></div></div></div>
      <section class="section"><div class="section-head"><div><h2>Individual results</h2><p>${indiv.length} linked result${indiv.length===1?'':'s'}.</p></div></div>${indiv.length?resultsTableHtml(indiv):'<div class="empty">No individual result is linked to this athlete.</div>'}</section>
      <section class="section grid-2"><div class="panel"><div class="section-head"><div><h2>Relay teams</h2><p>Team memberships in the supplied results.</p></div></div>${tms.length?`<div class="list">${tms.map(t=>{const r=resultById[t.resultId];return `<div class="list-item"><div class="main"><strong>${teamLink(t.id,t.name)}</strong><small>${esc(t.event)} · ${esc(t.category)}</small></div><div>${r?.medal?badgeMedal(r.medal):`<span class="time">${esc(r?.time||'—')}</span>`}</div></div>`}).join('')}</div>`:'<div class="empty">No relay memberships linked.</div>'}</div><div class="panel"><div class="section-head"><div><h2>Medals</h2><p>Individual and team medals linked to this athlete.</p></div></div>${am.length?`<div class="list">${am.sort((x,y)=>x.place-y.place).map(m=>`<div class="list-item"><div class="main"><strong>${medalIcon(m.medal)} ${esc(m.event)}</strong><small>${esc(m.category)} · ${esc(m.name)}</small></div><span class="time">${esc(m.time)}</span></div>`).join('')}</div>`:'<div class="empty">No available medals linked.</div>'}</div></section>`;
  }

  function renderTeam(id) {
    const t=teamById[id]; if(!t)return renderNotFound(); const r=resultById[t.resultId]; setTitle(t.name);
    app.innerHTML=`${backLink(`#event/${t.eventId}`,t.event)}<div class="profile-head"><div class="profile-title"><div class="profile-flag">${t.flag}</div><div><span class="event-badge">${esc(t.event)}</span><h1>${esc(t.name)}</h1><p>${esc(t.country)} · ${esc(t.category)}</p></div></div><div class="medal-strip">${r?.medal?`<div class="medal-count"><strong>${medalIcon(r.medal)}</strong><span>${r.medal}</span></div>`:''}<div class="medal-count"><strong>${esc(r?.time||'—')}</strong><span>Best time</span></div><div class="medal-count"><strong>${r?.place||'—'}</strong><span>Place</span></div></div></div>
      <section class="section grid-2"><div class="panel"><div class="section-head"><div><h2>Team members</h2><p>${t.memberIds.length||t.members.length} listed athletes.</p></div></div>${t.memberIds.length?`<div class="list">${t.memberIds.map(aid=>{const a=athleteById[aid];return a?`<div class="list-item"><div class="main"><strong>${a.flag} ${athleteLink(a.id,a.name)}</strong><small>${esc(a.country)}</small></div><span class="event-badge">${a.eventCount} events</span></div>`:''}).join('')}</div>`:'<div class="empty">Member names were not present in this source row.</div>'}</div><div class="panel"><div class="section-head"><div><h2>Result details</h2></div></div><div class="list"><div class="list-item"><div class="main"><strong>Status</strong></div>${badgeStatus(r?.status||'Unknown')}</div><div class="list-item"><div class="main"><strong>Best time</strong></div><span class="time">${esc(r?.time||'—')}</span></div>${r?.qualification?`<div class="list-item"><div class="main"><strong>Q1 / Q2</strong><small>Supplied attempts</small></div><span class="time">${esc(r.qualification.attempt1)} / ${esc(r.qualification.attempt2)}</span></div>`:''}</div></div></section>`;
  }

  function renderCountries() {
    setTitle('Countries');
    app.innerHTML=`<div class="section-head"><div><div class="eyebrow">Delegations</div><h1>Countries</h1><p>Open a country to see all linked athletes, event entries and medals.</p></div></div><div class="panel"><div class="filters" style="grid-template-columns:2fr 1fr 2fr"><div class="field"><label>Search country</label><input id="c-search" placeholder="Country…"></div><div class="field"><label>Sort</label><select id="c-sort"><option value="medals">Medal table</option><option value="athletes">Most athletes</option><option value="name">Name</option></select></div><div></div></div><div id="country-grid" class="country-grid"></div></div>`;
    const q=document.getElementById('c-search'),sort=document.getElementById('c-sort'); const apply=()=>{let arr=D.countries.slice(),s=q.value.trim().toLowerCase();if(s)arr=arr.filter(c=>c.country.toLowerCase().includes(s));if(sort.value==='athletes')arr.sort((a,b)=>b.athletes-a.athletes||a.country.localeCompare(b.country));else if(sort.value==='name')arr.sort((a,b)=>a.country.localeCompare(b.country));else arr.sort((a,b)=>b.gold-a.gold||b.silver-a.silver||b.bronze-a.bronze||a.country.localeCompare(b.country));document.getElementById('country-grid').innerHTML=arr.map(c=>`<a class="country-card" href="#country/${c.countryIso}"><div class="top"><div class="flag">${c.flag}</div><h3>${esc(c.country)}</h3></div><div class="stats"><span><strong>${c.athletes}</strong>athletes</span><span><strong>${c.total}</strong>medals</span><span><strong>${c.gold}</strong>gold</span></div></a>`).join('')};q.addEventListener('input',apply);sort.addEventListener('change',apply);apply();
  }

  function renderCountry(iso) {
    const c=countryByIso[iso]; if(!c)return renderNotFound(); setTitle(c.country);
    const ath=D.athletes.filter(a=>a.countryIso===iso).sort((a,b)=>b.medalCount-a.medalCount||b.eventCount-a.eventCount||a.name.localeCompare(b.name));
    const rr=D.results.filter(r=>r.countryIso===iso);
    const eventRows=eventOrder.map(eid=>{const x=D.medalTables[eid]?.find(x=>x.countryIso===iso);return {eid,name:eventName(eid),entries:rr.filter(r=>r.eventId===eid).length,gold:x?.gold||0,silver:x?.silver||0,bronze:x?.bronze||0,total:x?.total||0};});
    app.innerHTML=`${backLink('#countries','Countries')}<div class="profile-head"><div class="profile-title"><div class="profile-flag">${c.flag}</div><div><h1>${esc(c.country)}</h1><p>${c.athletes} linked athletes · ${c.resultEntries} result records</p></div></div><div class="medal-strip"><div class="medal-count"><strong>${c.gold}</strong><span>🥇 Gold</span></div><div class="medal-count"><strong>${c.silver}</strong><span>🥈 Silver</span></div><div class="medal-count"><strong>${c.bronze}</strong><span>🥉 Bronze</span></div><div class="medal-count"><strong>${c.total}</strong><span>Total</span></div></div></div>
      <section class="section"><div class="section-head"><div><h2>Event breakdown</h2><p>Available medals and result records by event.</p></div></div><div class="table-wrap"><table><thead><tr><th>Event</th><th class="num">Entries</th><th class="num">🥇</th><th class="num">🥈</th><th class="num">🥉</th><th class="num">Total</th></tr></thead><tbody>${eventRows.map(x=>`<tr><td><a href="#event/${x.eid}">${esc(x.name)}</a></td><td class="num">${x.entries}</td><td class="num">${x.gold}</td><td class="num">${x.silver}</td><td class="num">${x.bronze}</td><td class="num"><strong>${x.total}</strong></td></tr>`).join('')}</tbody></table></div></section>
      <section class="section grid-2"><div class="panel"><div class="section-head"><div><h2>Athletes</h2><p>Sorted by medals, then event count.</p></div></div><div class="list">${ath.slice(0,35).map(a=>`<div class="list-item"><div class="main"><strong>${athleteLink(a.id,a.name)}</strong><small>${a.eventCount} events</small></div><span>${a.goldCount?`🥇 ${a.goldCount} `:''}${a.silverCount?`🥈 ${a.silverCount} `:''}${a.bronzeCount?`🥉 ${a.bronzeCount}`:''}</span></div>`).join('')}</div>${ath.length>35?`<p class="muted">Showing 35 of ${ath.length} linked athletes.</p>`:''}</div><div class="panel"><div class="section-head"><div><h2>Latest view of results</h2><p>First 35 records sorted by event and place/time.</p></div></div>${resultsTableHtml(rr.slice().sort((a,b)=>eventOrder.indexOf(a.eventId)-eventOrder.indexOf(b.eventId)||(a.place??999)-(b.place??999)||(a.timeSeconds??Infinity)-(b.timeSeconds??Infinity)).slice(0,35))}</div></section>`;
  }

  function renderMedals(initial='combined') {
    setTitle('Medal Tables'); const ids=['combined',...eventOrder];
    app.innerHTML=`<div class="section-head"><div><div class="eyebrow">Podiums</div><h1>Medal Tables</h1><p>Switch between individual events, relays and the available combined championship table.</p></div></div><div class="panel"><div class="field" style="max-width:360px;margin-bottom:16px"><label>Medal table</label><select id="m-event">${ids.map(id=>`<option value="${id}" ${id===initial?'selected':''}>${id==='combined'?'Combined · available events':esc(eventName(id))}</option>`).join('')}</select></div><div id="medal-note"></div><div id="medal-table"></div></div>`;
    const sel=document.getElementById('m-event');const apply=()=>{const id=sel.value;document.getElementById('medal-note').innerHTML=id==='400m'?noteFor400():(id==='combined'?`<div class="notice"><strong>Combined table scope</strong>${esc(D.meta.combinedMedalNote)}</div>`:'');document.getElementById('medal-table').innerHTML=medalTableHtml(D.medalTables[id]||[]);};sel.addEventListener('change',apply);apply();
  }

  function renderInsights() {
    setTitle('Insights');
    const maxEvents=Math.max(...D.mostEvents.map(x=>x.eventCount)); const maxMedals=Math.max(...D.mostMedals.map(x=>x.total));
    app.innerHTML=`<div class="section-head"><div><div class="eyebrow">Championship statistics</div><h1>Insights & Interesting Facts</h1><p>Derived from the linked results rather than merely staring at 2,000 spreadsheet rows until meaning appears.</p></div></div><div class="metric-grid">${D.insights.map(x=>metric(x.title,String(x.value),x.text)).join('')}</div>
      <section class="section grid-2"><div class="panel"><div class="section-head"><div><h2>DNC comparison</h2><p>Percentage of timed finishers classified DNC.</p></div></div>${[['Short · Men',D.dncGender.short.Male],['Short · Women',D.dncGender.short.Female],['Standard · Men',D.dncGender.standard.Male],['Standard · Women',D.dncGender.standard.Female]].map(([n,v])=>`<div class="bar-row"><strong>${n}</strong><div class="bar"><span style="width:${Math.min(100,v*2)}%"></span></div><small>${v}%</small></div>`).join('')}<div class="notice"><strong>DNC</strong>Finished the course, but failed 3 or more obstacles and therefore remained unranked.</div></div><div class="panel"><div class="section-head"><div><h2>Overall facts</h2></div></div><div class="fact-list">${D.overallFacts.map(x=>`<div class="fact">${esc(x)}</div>`).join('')}</div></div></section>
      <section class="section grid-2"><div class="panel"><div class="section-head"><div><h2>Most event types</h2><p>Athletes appearing across the widest range of events.</p></div></div>${D.mostEvents.map(a=>`<div class="bar-row"><strong>${a.flag} ${athleteLink(a.id,a.name)}</strong><div class="bar"><span style="width:${a.eventCount/maxEvents*100}%"></span></div><small>${a.eventCount}</small></div>`).join('')}</div><div class="panel"><div class="section-head"><div><h2>Most available medals</h2><p>Individual + team medals linked to athlete profiles.</p></div></div>${D.mostMedals.map(a=>`<div class="bar-row"><strong>${a.flag} ${athleteLink(a.id,a.name)}</strong><div class="bar"><span style="width:${a.total/maxMedals*100}%"></span></div><small>${a.total}</small></div>`).join('')}</div></section>
      <section class="section"><div class="section-head"><div><h2>Facts by event</h2></div></div><div class="grid-3">${eventOrder.map(id=>`<div class="panel"><h3>${esc(eventName(id))}</h3><div class="fact-list">${(D.eventFacts[id]||[]).map(x=>`<div class="fact">${esc(x)}</div>`).join('')}</div></div>`).join('')}</div></section>`;
  }

  function renderNotes() {
    setTitle('Data Notes');
    app.innerHTML=`<div class="section-head"><div><div class="eyebrow">Methodology & caveats</div><h1>Data Notes</h1><p>What is calculated, what is source data, and where the timing export has decided to make life interesting.</p></div></div><div class="grid-2">${D.dataNotes.map(n=>`<div class="note-card ${n.level==='warning'?'warning':''}"><h3>${n.level==='warning'?'⚠️ ':'ℹ️ '}${esc(n.title)}</h3><p>${esc(n.text)}</p></div>`).join('')}</div><section class="section panel"><div class="section-head"><div><h2>Source files</h2><p>The static dataset used by this site was generated from these supplied workbooks.</p></div></div><ul class="source-list">${D.meta.sourceFiles.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section><section class="section panel"><h2>What the site does not claim</h2><p class="muted">This archive does not silently repair uncertain source records or manufacture missing finals. Calculated medal tables follow the documented methodology above. Where the source is incomplete, the UI says so. An oddly radical approach to sports data, apparently.</p></section>`;
  }

  function renderNotFound(){setTitle('Not found');app.innerHTML=`<div class="empty"><h2>Nothing here</h2><p>That athlete, team, country or page could not be found.</p><a class="btn" href="#overview">Back to overview</a></div>`;}

  function bindGoButtons(){document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>routeTo(b.dataset.go)));}
  function setNav(route){const parent=route==='athlete'?'athletes':route==='country'?'countries':route==='team'||route==='event'?'results':route;document.querySelectorAll('.main-nav a').forEach(a=>a.classList.toggle('active',a.dataset.route===parent));}
  function router(){const raw=(location.hash||'#overview').slice(1);const [route,arg]=raw.split('/');setNav(route);document.getElementById('main-nav').classList.remove('open');document.getElementById('mobile-menu').setAttribute('aria-expanded','false');switch(route){case'overview':renderOverview();break;case'results':renderResults(arg||'');break;case'athletes':renderAthletes();break;case'athlete':renderAthlete(arg);break;case'team':renderTeam(arg);break;case'countries':renderCountries();break;case'country':renderCountry(arg);break;case'medals':renderMedals(arg||'combined');break;case'insights':renderInsights();break;case'notes':renderNotes();break;case'event':renderEvent(arg);break;default:renderNotFound();}window.scrollTo(0,0);app.focus({preventScroll:true});}

  document.getElementById('mobile-menu').addEventListener('click',()=>{const nav=document.getElementById('main-nav');const open=nav.classList.toggle('open');document.getElementById('mobile-menu').setAttribute('aria-expanded',String(open));});
  window.addEventListener('hashchange',router);router();
  }
})();
