(() => {
  'use strict';
  const app = document.getElementById('app');

  async function loadData() {
    if (window.OCR_DATA) return window.OCR_DATA;

    const compressedData = window.OCR_DATA_PARTS?.join('') || window.OCR_DATA_GZIP_B64;
    if (!compressedData) throw new Error('Championship dataset missing');
    if (!('DecompressionStream' in window)) throw new Error('This browser does not support DecompressionStream');
    const raw = atob(compressedData);
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
  const FLAG_ASSET_BASE = 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.5.0/flags/4x3';

  function flagHtml(iso, country, size='') {
    const code = String(iso || '').toUpperCase();
    const validCode = /^[A-Z]{2}$/.test(code) && code !== 'XX';
    const sizeClass = size ? ` country-flag-${size}` : '';
    const label = country ? `${country} flag` : `${code || 'Unknown'} flag`;
    const fallback = code || '?';
    const image = validCode
      ? `<img class="country-flag-image" src="${FLAG_ASSET_BASE}/${code.toLowerCase()}.svg" alt="" loading="lazy" decoding="async" onerror="this.hidden=true">`
      : '';
    return `<span class="country-flag${sizeClass}" role="img" aria-label="${esc(label)}"><span class="country-flag-fallback" aria-hidden="true">${esc(fallback)}</span>${image}</span>`;
  }

  function flagText(value) {
    const text = String(value || '');
    let html = '', lastIndex = 0;
    for (const match of text.matchAll(/\p{Regional_Indicator}{2}/gu)) {
      html += esc(text.slice(lastIndex, match.index));
      const code = [...match[0]].map(char => String.fromCharCode(char.codePointAt(0) - 0x1F1E6 + 65)).join('');
      html += flagHtml(code, countryByIso[code]?.country || code);
      lastIndex = match.index + match[0].length;
    }
    return html + esc(text.slice(lastIndex));
  }

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
  function countryLink(iso, name) { return `<a class="country-link" href="#country/${esc(iso)}">${flagHtml(iso, name)} ${esc(name)}</a>`; }
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
    if (r.eventId === '400m') {
      if (r.directFinal) return 'Direct final';
      return r.stage || 'Qualification';
    }
    return r.status;
  }

  const CAROUSEL_WIDTH = 1080;
  const CAROUSEL_HEIGHT = 1350;
  const CAROUSEL_LOGO = '/assets/ocr-ireland-logo-white-text.png';

  function recordedSeconds(value) {
    const raw=String(value??'').trim();
    if(!raw || /^(DNS|DNF|DNC|No Time)$/i.test(raw)) return null;
    if(/^\d+$/.test(raw)) return null;
    const minute=raw.match(/^(\d+):(\d{2})(?:\.(\d+))?$/);
    if(minute) return Number(minute[1])*60+Number(minute[2])+Number(`0.${minute[3]||0}`);
    return /^\d+\.\d+$/.test(raw)?Number(raw):null;
  }

  function formatRaceDuration(seconds) {
    if(!Number.isFinite(seconds) || seconds<=0) return '—';
    const rounded=Math.round(seconds), hours=Math.floor(rounded/3600), minutes=Math.floor((rounded%3600)/60), secs=rounded%60;
    if(hours) return `${hours}h ${minutes}m ${secs}s`;
    if(minutes) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  }

  function formatDistance(km) {
    if(!Number.isFinite(km) || km<=0) return '—';
    return `${Number.isInteger(km)?km:km.toFixed(1)} km`;
  }

  function athleteDistanceStats(indiv) {
    let distance=0, totalSeconds=0, starts=0, minimum=false;
    const breakdown=[];
    const add=(label,km,seconds,min=false)=>{distance+=km;totalSeconds+=seconds;starts++;minimum=minimum||min;breakdown.push(label);};
    for(const result of indiv){
      if(result.eventId==='100m' || result.eventId==='400m'){
        const km=result.eventId==='100m'?.1:.4;
        const runs=[];
        ['attempt1','attempt2'].forEach(key=>{const seconds=recordedSeconds(result.qualification?.[key]);if(seconds!=null)runs.push(seconds);});
        Object.values(result.elimination||{}).forEach(run=>{if(run?.seconds!=null)runs.push(run.seconds);});
        if(!runs.length && result.timeSeconds!=null) runs.push(result.timeSeconds);
        runs.forEach(seconds=>add(result.eventId,km,seconds));
      } else if(result.eventId==='short' && result.timeSeconds!=null) add('Short',3.5,result.timeSeconds);
      else if(result.eventId==='standard' && result.timeSeconds!=null) add('Standard',11,result.timeSeconds);
    }
    const counts=breakdown.reduce((map,label)=>map.set(label,(map.get(label)||0)+1),new Map());
    return {
      distance,
      totalSeconds,
      starts,
      minimum,
      breakdown:[...counts].map(([label,count])=>label==='Short'?'Short · 3.5 km':label==='Standard'?'Standard · 11 km':`${label} × ${count}`).join('  ·  '),
    };
  }

  function loadCarouselImage(src) {
    return new Promise(resolve=>{
      const image=new Image(); if(/^https?:/i.test(src)) image.crossOrigin='anonymous'; image.onload=()=>resolve(image); image.onerror=()=>resolve(null); image.src=src;
    });
  }

  function carouselPngBlob(canvas) {
    return new Promise((resolve,reject)=>{
      try{canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG creation failed')),'image/png');}
      catch(error){reject(error);}
    });
  }

  function downloadCarouselBlob(blob,filename) {
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function carouselZip(files) {
    const encoder=new TextEncoder(),crcTable=new Uint32Array(256);
    for(let n=0;n<256;n++){let c=n;for(let bit=0;bit<8;bit++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0;}
    const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&0xff]^(crc>>>8);return (crc^0xffffffff)>>>0;};
    const concat=parts=>{const output=new Uint8Array(parts.reduce((sum,part)=>sum+part.length,0));let offset=0;for(const part of parts){output.set(part,offset);offset+=part.length;}return output;};
    const localParts=[],centralParts=[];let localOffset=0;
    files.forEach(file=>{
      const name=encoder.encode(file.name),crc=crc32(file.bytes),local=new Uint8Array(30),lv=new DataView(local.buffer);
      lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint32(14,crc,true);lv.setUint32(18,file.bytes.length,true);lv.setUint32(22,file.bytes.length,true);lv.setUint16(26,name.length,true);
      localParts.push(local,name,file.bytes);
      const central=new Uint8Array(46),cv=new DataView(central.buffer);cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint32(16,crc,true);cv.setUint32(20,file.bytes.length,true);cv.setUint32(24,file.bytes.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,localOffset,true);centralParts.push(central,name);
      localOffset+=local.length+name.length+file.bytes.length;
    });
    const centralData=concat(centralParts),end=new Uint8Array(22),ev=new DataView(end.buffer);ev.setUint32(0,0x06054b50,true);ev.setUint16(8,files.length,true);ev.setUint16(10,files.length,true);ev.setUint32(12,centralData.length,true);ev.setUint32(16,localOffset,true);
    return new Blob([...localParts,centralData,end],{type:'application/zip'});
  }

  function canvasRoundRect(ctx,x,y,width,height,radius,fill,stroke='') {
    const r=Math.min(radius,width/2,height/2);
    ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+width,y,x+width,y+height,r);ctx.arcTo(x+width,y+height,x,y+height,r);ctx.arcTo(x,y+height,x,y,r);ctx.arcTo(x,y,x+width,y,r);ctx.closePath();
    if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke();}
  }

  function canvasText(ctx,text,x,y,maxWidth,lineHeight,maxLines=99) {
    const words=String(text).split(/\s+/);let line='',lines=[];
    for(const word of words){const test=line?`${line} ${word}`:word;if(ctx.measureText(test).width>maxWidth&&line){lines.push(line);line=word;}else line=test;}
    if(line)lines.push(line);if(lines.length>maxLines){lines=lines.slice(0,maxLines);let last=lines.at(-1);while(ctx.measureText(`${last}…`).width>maxWidth&&last.length>1)last=last.slice(0,-1);lines[lines.length-1]=`${last}…`;}
    lines.forEach((item,index)=>ctx.fillText(item,x,y+index*lineHeight));return y+lines.length*lineHeight;
  }

  function drawCarouselBackground(ctx,accent='#65e6a5') {
    const gradient=ctx.createLinearGradient(0,0,CAROUSEL_WIDTH,CAROUSEL_HEIGHT);gradient.addColorStop(0,'#06130f');gradient.addColorStop(.55,'#0b2d22');gradient.addColorStop(1,'#123a2c');ctx.fillStyle=gradient;ctx.fillRect(0,0,CAROUSEL_WIDTH,CAROUSEL_HEIGHT);
    ctx.globalAlpha=.13;ctx.fillStyle=accent;ctx.beginPath();ctx.arc(930,180,320,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(90,1230,280,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
    ctx.strokeStyle='rgba(255,255,255,.07)';ctx.lineWidth=2;for(let x=-200;x<1300;x+=92){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+600,CAROUSEL_HEIGHT);ctx.stroke();}
  }

  function drawCarouselBrand(ctx,logo,page,total) {
    if(logo){
      ctx.save();
      ctx.globalAlpha=1;ctx.drawImage(logo,850,18,160,172);ctx.restore();
    }else{ctx.fillStyle='#65e6a5';ctx.font='900 24px Inter, sans-serif';ctx.textAlign='right';ctx.fillText('OCR IRELAND',1010,105);ctx.textAlign='left';}
    ctx.fillStyle='rgba(255,255,255,.68)';ctx.font='700 22px Inter, sans-serif';ctx.fillText('OCR WORLD CHAMPIONSHIPS · IRELAND 2026',70,1292);
    ctx.textAlign='right';ctx.fillText(`${page} / ${total}`,1010,1292);ctx.textAlign='left';
  }

  function drawCarouselFlag(ctx,flagImage,athlete,x,y,width=150,height=112) {
    canvasRoundRect(ctx,x,y,width,height,18,'#0a1914','rgba(255,255,255,.22)');
    if(flagImage){ctx.save();ctx.beginPath();ctx.roundRect(x,y,width,height,18);ctx.clip();ctx.drawImage(flagImage,x,y,width,height);ctx.restore();}
    else{ctx.fillStyle='#f3f8f5';ctx.font='900 34px Inter, sans-serif';ctx.textAlign='center';ctx.fillText(athlete.countryIso||'?',x+width/2,y+height/2+12);ctx.textAlign='left';}
  }

  function drawCarouselMetric(ctx,x,y,width,value,label,accent='#65e6a5') {
    canvasRoundRect(ctx,x,y,width,176,28,'rgba(3,17,12,.56)','rgba(255,255,255,.12)');ctx.fillStyle=accent;ctx.font='900 54px Inter, sans-serif';ctx.fillText(String(value),x+28,y+72);ctx.fillStyle='#b8cdc3';ctx.font='700 22px Inter, sans-serif';canvasText(ctx,label,x+28,y+112,width-56,27,2);
  }

  function buildCarouselSlides(a,indiv,tms,am) {
    const nation=countryByIso[a.countryIso],distance=athleteDistanceStats(indiv);
    const entries=[
      ...indiv.map(result=>({event:result.event,category:result.category,time:result.time||'—',detail:result.medal?`${medalIcon(result.medal)} ${result.medal}`:result.place?`#${result.place}`:resultDetail(result)})),
      ...tms.map(team=>{const result=resultById[team.resultId];return {event:team.event,category:team.category,time:result?.time||'—',detail:result?.medal?`${medalIcon(result.medal)} ${result.medal}`:result?.place?`#${result.place}`:result?.status||'Team relay'};})
    ].sort((x,y)=>eventOrder.indexOf(D.events.find(event=>event.name===x.event)?.id)-eventOrder.indexOf(D.events.find(event=>event.name===y.event)?.id));
    const resultRows=entries.slice(0,7);
    const placedResults=[...indiv,...tms.map(team=>resultById[team.resultId]).filter(Boolean)].filter(result=>result.place).sort((x,y)=>x.place-y.place||(x.timeSeconds??Infinity)-(y.timeSeconds??Infinity));
    const topFinish=am.slice().sort((x,y)=>x.place-y.place)[0]||placedResults[0]||null;
    const linkedResults=indiv.length+tms.length;
    const nationPossessive=/s$/i.test(a.country)?`${a.country}'`:`${a.country}'s`;
    const contribution=a.medalCount&&nation?.total?`Contributed to ${a.medalCount} of ${nationPossessive} ${nation.total} championship medal${nation.total===1?'':'s'}.`:`One of ${nation?.athletes??'—'} athletes proudly representing ${a.country}.`;
    return [
      {accent:'#65e6a5',draw(ctx,assets){
        ctx.fillStyle='#65e6a5';ctx.font='850 24px Inter, sans-serif';ctx.letterSpacing='3px';ctx.fillText('MY WORLD CHAMPIONSHIP',70,108);drawCarouselFlag(ctx,assets.flag,a,70,176);
        ctx.fillStyle='#f7fbf9';ctx.font=`900 ${a.name.length>24?68:82}px Inter, sans-serif`;const next=canvasText(ctx,a.name,70,390,900,a.name.length>24?78:94,3);
        ctx.fillStyle='#b8cdc3';ctx.font='700 30px Inter, sans-serif';ctx.fillText(`${a.country} · ${a.gender}`,70,next+18);
        ctx.fillStyle='#f7fbf9';ctx.font='800 32px Inter, sans-serif';ctx.fillText('I showed up on the world stage.',70,705);
        drawCarouselMetric(ctx,70,770,280,a.eventCount,'event types','#65e6a5');drawCarouselMetric(ctx,400,770,280,a.medalCount,'medals won','#c5ff72');drawCarouselMetric(ctx,730,770,280,distance.starts,'recorded starts','#ffd36a');
        ctx.fillStyle='#a7beb3';ctx.font='600 24px Inter, sans-serif';canvasText(ctx,`One of ${D.athletes.length.toLocaleString()} athletes competing in Ireland.`,70,1018,850,34,2);
      }},
      {accent:'#c5ff72',draw(ctx){
        ctx.fillStyle='#c5ff72';ctx.font='850 24px Inter, sans-serif';ctx.fillText('THE RESULTS',70,108);ctx.fillStyle='#f7fbf9';ctx.font='900 62px Inter, sans-serif';ctx.fillText('Every start tells a story.',70,205);
        let y=278;resultRows.forEach((result,index)=>{canvasRoundRect(ctx,70,y,940,112,22,index%2?'rgba(255,255,255,.055)':'rgba(3,17,12,.48)','rgba(255,255,255,.09)');ctx.fillStyle='#f7fbf9';ctx.font='800 27px Inter, sans-serif';ctx.fillText(result.event,96,y+42);ctx.fillStyle='#9db9ad';ctx.font='600 20px Inter, sans-serif';ctx.fillText(result.category,96,y+76);ctx.textAlign='right';ctx.fillStyle='#c5ff72';ctx.font='850 25px Inter, sans-serif';ctx.fillText(result.detail,984,y+42);ctx.fillStyle='#f7fbf9';ctx.font='800 25px Inter, sans-serif';ctx.fillText(result.time,984,y+78);ctx.textAlign='left';y+=124;});
        if(entries.length>resultRows.length){ctx.fillStyle='#a7beb3';ctx.font='650 22px Inter, sans-serif';ctx.fillText(`+ ${entries.length-resultRows.length} more linked result${entries.length-resultRows.length===1?'':'s'}`,70,y+20);}
      }},
      {accent:'#ffd36a',draw(ctx){
        ctx.fillStyle='#ffd36a';ctx.font='850 24px Inter, sans-serif';ctx.fillText('THE DISTANCE',70,108);ctx.fillStyle='#f7fbf9';ctx.font='900 58px Inter, sans-serif';ctx.fillText('Obstacle by obstacle.',70,205);
        canvasRoundRect(ctx,70,285,940,380,38,'rgba(3,17,12,.55)','rgba(255,255,255,.12)');ctx.fillStyle='#ffd36a';ctx.font='900 116px Inter, sans-serif';ctx.fillText(`${distance.minimum?'≥ ':''}${formatDistance(distance.distance)}`,110,445);ctx.fillStyle='#f7fbf9';ctx.font='800 29px Inter, sans-serif';ctx.fillText('recorded individual championship distance',110,502);ctx.fillStyle='#9db9ad';ctx.font='600 23px Inter, sans-serif';canvasText(ctx,distance.breakdown||'No timed individual distance recorded',110,558,820,34,3);
        drawCarouselMetric(ctx,70,730,430,distance.starts,'individual race starts','#ffd36a');drawCarouselMetric(ctx,540,730,470,formatRaceDuration(distance.totalSeconds),'recorded racing time','#65e6a5');
        ctx.fillStyle='#a7beb3';ctx.font='600 21px Inter, sans-serif';canvasText(ctx,'Distance uses recorded individual rounds: 100m, 400m, Short (3.5 km) and Standard (11 km). Relay legs are excluded because split distances were not supplied.',70,980,930,31,4);
      }},
      {accent:'#65e6a5',draw(ctx,assets){
        ctx.fillStyle='#65e6a5';ctx.font='850 24px Inter, sans-serif';ctx.fillText('MY CHAMPIONSHIP SNAPSHOT',70,108);drawCarouselFlag(ctx,assets.flag,a,70,160,126,94);
        ctx.fillStyle='#f7fbf9';ctx.font=`900 ${a.name.length>25?40:48}px Inter, sans-serif`;const nameEnd=canvasText(ctx,a.name,230,194,520,a.name.length>25?48:56,2);ctx.fillStyle='#b8cdc3';ctx.font='700 24px Inter, sans-serif';ctx.fillText(`${a.country} · ${a.gender}`,230,Math.max(257,nameEnd+6));
        drawCarouselMetric(ctx,70,350,280,a.eventCount,'event types','#65e6a5');drawCarouselMetric(ctx,400,350,280,linkedResults,'linked results','#c5ff72');drawCarouselMetric(ctx,730,350,280,a.medalCount,'championship medals','#ffd36a');
        canvasRoundRect(ctx,70,575,940,390,34,'rgba(3,17,12,.58)','rgba(255,255,255,.14)');ctx.fillStyle='#65e6a5';ctx.font='850 23px Inter, sans-serif';ctx.fillText('MY BIGGEST MOMENT',110,638);
        if(topFinish){const headline=topFinish.medal?`${medalIcon(topFinish.medal)} ${topFinish.medal.toUpperCase()} · ${topFinish.event.toUpperCase()}`:`#${topFinish.place} · ${topFinish.event.toUpperCase()}`;ctx.fillStyle=topFinish.medal==="Gold"?'#f2c94c':topFinish.medal==="Silver"?'#dbe4ec':topFinish.medal==="Bronze"?'#df9867':'#f7fbf9';ctx.font=`900 ${headline.length>28?45:55}px Inter, sans-serif`;canvasText(ctx,headline,110,722,820,64,2);ctx.fillStyle='#f7fbf9';ctx.font='800 29px Inter, sans-serif';canvasText(ctx,`${topFinish.category} · ${topFinish.time||'Recorded result'}`,110,846,820,38,2);}else{ctx.fillStyle='#f7fbf9';ctx.font='900 48px Inter, sans-serif';canvasText(ctx,'WORLD CHAMPIONSHIP FINISHER',110,730,820,56,2);ctx.fillStyle='#b8cdc3';ctx.font='750 29px Inter, sans-serif';ctx.fillText(`${a.eventCount} event type${a.eventCount===1?'':'s'} completed`,110,852);}
        ctx.fillStyle='#b8cdc3';ctx.font='700 25px Inter, sans-serif';canvasText(ctx,contribution,110,910,820,34,2);
        ctx.fillStyle='#c5ff72';ctx.font='850 29px Inter, sans-serif';ctx.fillText(`Proud to represent ${a.country}.`,70,1070);ctx.fillStyle='#f7fbf9';ctx.font='900 38px Inter, sans-serif';ctx.fillText('Ireland 2026 · My championship story.',70,1132);
      }},
    ];
  }

  function openAthleteCarousel(a,indiv,tms,am) {
    document.getElementById('athlete-carousel')?.remove();
    const slides=buildCarouselSlides(a,indiv,tms,am),overlay=document.createElement('div');
    overlay.id='athlete-carousel';overlay.className='carousel-overlay';overlay.innerHTML=`<div class="carousel-dialog" role="dialog" aria-modal="true" aria-labelledby="carousel-title"><div class="carousel-head"><div><div class="eyebrow">Instagram carousel</div><h2 id="carousel-title">${esc(a.name)} · Championship story</h2><p>Four portrait slides, ready to download and post.</p></div><button class="carousel-close" aria-label="Close carousel">×</button></div><div class="carousel-workspace"><div class="carousel-preview"><canvas width="${CAROUSEL_WIDTH}" height="${CAROUSEL_HEIGHT}" aria-label="Athlete carousel slide preview"></canvas><div class="carousel-nav"><button class="btn carousel-prev">← Previous</button><div class="carousel-dots">${slides.map((_,index)=>`<button aria-label="Show slide ${index+1}" data-slide="${index}"></button>`).join('')}</div><button class="btn carousel-next">Next →</button></div></div><aside class="carousel-actions"><div class="carousel-slide-label"></div><p class="muted">PNG · 1080 × 1350 · Instagram portrait</p><button class="btn primary carousel-download">Download this slide</button><button class="btn carousel-download-all">Download all as ZIP</button><button class="btn carousel-caption">Copy Instagram caption</button><div class="notice"><strong>Distance methodology</strong>Uses only recorded individual race distances. Team and XC relay distance is excluded because individual splits were not supplied.</div><p class="carousel-feedback muted" aria-live="polite"></p></aside></div></div>`;
    document.body.appendChild(overlay);document.body.classList.add('carousel-open');
    const canvas=overlay.querySelector('canvas'),ctx=canvas.getContext('2d'),feedback=overlay.querySelector('.carousel-feedback');let current=0,logo=null,flag=null;
    const draw=()=>{drawCarouselBackground(ctx,slides[current].accent);slides[current].draw(ctx,{logo,flag});drawCarouselBrand(ctx,logo,current+1,slides.length);overlay.querySelector('.carousel-slide-label').innerHTML=`<strong>Slide ${current+1} of ${slides.length}</strong><span>${['Cover','Results','Distance & effort','Championship snapshot'][current]}</span>`;overlay.querySelectorAll('.carousel-dots button').forEach((dot,index)=>dot.classList.toggle('active',index===current));overlay.querySelector('.carousel-prev').disabled=current===0;overlay.querySelector('.carousel-next').disabled=current===slides.length-1;};
    const go=index=>{current=Math.max(0,Math.min(slides.length-1,index));draw();};
    const close=()=>{overlay.remove();document.body.classList.remove('carousel-open');document.removeEventListener('keydown',keys);};
    const keys=event=>{if(event.key==='Escape')close();else if(event.key==='ArrowLeft')go(current-1);else if(event.key==='ArrowRight')go(current+1);};
    const filename=index=>`${a.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'athlete'}-ocrwc2026-${index+1}.png`;
    const slug=a.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'athlete';
    const download=async index=>{go(index);const blob=await carouselPngBlob(canvas);downloadCarouselBlob(blob,filename(index));};
    const caption=`${a.flag||''} ${a.name} at the 2026 OCR World Championships in Ireland.\n\n${a.eventCount} event type${a.eventCount===1?'':'s'} · ${a.medalCount} medal${a.medalCount===1?'':'s'} · one of ${D.athletes.length.toLocaleString()} championship athletes.\n\n#OCRWorldChampionships #OCRIreland #ObstacleCourseRacing #OCRWC2026`;
    overlay.querySelector('.carousel-close').addEventListener('click',close);overlay.addEventListener('click',event=>{if(event.target===overlay)close();});document.addEventListener('keydown',keys);
    overlay.querySelector('.carousel-prev').addEventListener('click',()=>go(current-1));overlay.querySelector('.carousel-next').addEventListener('click',()=>go(current+1));overlay.querySelectorAll('.carousel-dots button').forEach(dot=>dot.addEventListener('click',()=>go(+dot.dataset.slide)));
    overlay.querySelector('.carousel-download').addEventListener('click',async()=>{try{await download(current);feedback.textContent=`Slide ${current+1} downloaded.`;}catch{feedback.textContent='This browser could not create the PNG.';}});
    overlay.querySelector('.carousel-download-all').addEventListener('click',async event=>{const button=event.currentTarget,original=current;button.disabled=true;button.textContent='Preparing ZIP…';try{const files=[];for(let index=0;index<slides.length;index++){go(index);const blob=await carouselPngBlob(canvas);files.push({name:filename(index),bytes:new Uint8Array(await blob.arrayBuffer())});}downloadCarouselBlob(carouselZip(files),`${slug}-ocrwc2026-carousel.zip`);feedback.textContent='Carousel ZIP downloaded.';}catch{feedback.textContent='This browser could not create the carousel ZIP.';}finally{go(original);button.disabled=false;button.textContent='Download all as ZIP';}});
    overlay.querySelector('.carousel-caption').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(caption);feedback.textContent='Instagram caption copied.';}catch{feedback.textContent='Caption copy was blocked by this browser.';}});
    draw();Promise.all([loadCarouselImage(CAROUSEL_LOGO),loadCarouselImage(`${FLAG_ASSET_BASE}/${String(a.countryIso||'').toLowerCase()}.svg`)]).then(images=>{[logo,flag]=images;draw();});
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
          <div><div class="flag-big">${flagHtml('IE', 'Ireland', 'hero')}</div><strong>Ireland · 2026</strong><p>Seven event types across individual and team competition.</p></div>
          <div><span class="event-badge">Data status</span><p>${esc(D.meta.dataStatus)}</p></div>
        </div>
      </section>
      <div class="metric-grid">
        ${metric('Linked athletes', num(D.athletes.length), 'Across all supplied datasets')}
        ${metric('Nations', num(D.countries.length), 'Countries and territories')}
        ${metric('Result records', num(D.results.length), 'Individual + team records')}
        ${metric('Available medals', num(D.medals.length), 'Across all supplied events')}
      </div>
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
          <div class="section-head"><div><h2>Combined medal leaders</h2><p>All supplied events.</p></div><a class="btn" href="#medals">Full table</a></div>
          ${medalTableHtml(combined.slice(0,8), false)}
        </div>
        <div class="panel">
          <div class="section-head"><div><h2>Interesting facts</h2><p>A few things the raw spreadsheets were not volunteering.</p></div></div>
          <div class="fact-list">${D.overallFacts.map(x=>`<div class="fact">${flagText(x)}</div>`).join('')}</div>
        </div>
      </section>
      <section class="section grid-2">
        <div class="panel">
          <div class="section-head"><div><h2>Most multi-event athletes</h2><p>Linked across the most event types.</p></div></div>
          <div class="list">${D.mostEvents.slice(0,8).map(a=>`<div class="list-item"><div class="main"><strong>${flagHtml(a.countryIso,a.country)} ${athleteLink(a.id,a.name)}</strong><small>${esc(a.country)}</small></div><span class="event-badge">${a.eventCount} events</span></div>`).join('')}</div>
        </div>
        <div class="panel">
          <div class="section-head"><div><h2>Largest delegations</h2><p>Unique linked athletes in the available files.</p></div></div>
          <div class="list">${D.largestCountries.slice(0,8).map(c=>`<div class="list-item"><div class="main"><strong>${countryLink(c.countryIso,c.country)}</strong><small>${c.total} available medals</small></div><span>${num(c.athletes)} athletes</span></div>`).join('')}</div>
        </div>
      </section>`;
    bindGoButtons();
  }

  function medalTableHtml(rows, includeHeader=true) {
    if (!rows || !rows.length) return '<div class="empty">No medal table is available for this event.</div>';
    return `<div class="table-wrap"><table class="medal-table"><thead><tr><th class="num">#</th><th>Country</th><th class="num">Gold</th><th class="num">Silver</th><th class="num">Bronze</th><th class="num">Total</th></tr></thead><tbody>${rows.map(x=>`<tr><td class="num rank">${x.rank}</td><td>${countryLink(x.countryIso,x.country)}</td><td class="num">🥇 ${x.gold}</td><td class="num">🥈 ${x.silver}</td><td class="num">🥉 ${x.bronze}</td><td class="num"><strong>${x.total}</strong></td></tr>`).join('')}</tbody></table></div>`;
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
      <div class="metric-grid">
        ${metric('Entries',num(s.entries))}${metric('Nations',num(s.countries))}${metric('Categories',num(s.categories))}
        ${fastest ? metric('Fastest supplied time',fastest.time,`${fastest.name} · ${fastest.country}`) : metric('Fastest supplied time','—')}
        ${extra}
      </div>
      <section class="section grid-2">
        <div class="panel"><div class="section-head"><div><h2>Event facts</h2><p>Derived from the supplied results.</p></div></div><div class="fact-list">${facts.length?facts.map(x=>`<div class="fact">${flagText(x)}</div>`).join(''):'<div class="empty">No additional facts calculated.</div>'}</div></div>
        <div class="panel"><div class="section-head"><div><h2>Medal table</h2><p>${e.medalData==='unavailable'?'Not available from the supplied final data.':'Top countries in this event.'}</p></div><a class="btn" href="#medals/${id}">Open table</a></div>${medalTableHtml(table.slice(0,8),false)}</div>
      </section>
      <section class="section"><div class="section-head"><div><h2>Leading results</h2><p>Fastest available records across categories. Use the results explorer for complete filtering.</p></div></div>${resultsTableHtml(D.results.filter(r=>r.eventId===id).filter(r=>r.timeSeconds!=null).sort((a,b)=>a.timeSeconds-b.timeSeconds).slice(0,30))}</section>`;
  }

  function resultsTableHtml(rows) {
    if (!rows.length) return '<div class="empty">No results match these filters.</div>';
    return `<div class="table-wrap"><table><thead><tr><th class="num">Place</th><th>Athlete / Team</th><th>Country</th><th>Event</th><th>Category</th><th>Status / Stage</th><th class="num">Time</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="num rank ${r.place&&r.place<=3?`podium-${r.place}`:''}">${rankDisplay(r)}</td><td>${r.type==='team'?teamLink(r.teamId,r.name):athleteLink(r.athleteId,r.name)}</td><td>${countryLink(r.countryIso,r.country)}</td><td><a href="#event/${r.eventId}">${esc(r.event)}</a></td><td>${esc(r.category)}</td><td>${r.medal?badgeMedal(r.medal):badgeStatus(resultDetail(r))}</td><td class="num time">${esc(r.time||'—')}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function renderResults(initialEvent='') {
    setTitle('Results');
    app.innerHTML = `
      <div class="section-head"><div><div class="eyebrow">Results explorer</div><h1>All Results</h1><p>Filter by event, country, category or status. Click an athlete or team to open its profile.</p></div></div>
      <div class="panel">
        <div class="filters">
          <div class="field"><label for="f-search">Search athlete or team</label><input id="f-search" placeholder="Start typing a name…"></div>
          <div class="field"><label for="f-event">Event</label><select id="f-event"><option value="">All events</option>${D.events.map(e=>`<option value="${e.id}" ${initialEvent===e.id?'selected':''}>${esc(e.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="f-country">Country</label><select id="f-country"><option value="">All countries</option>${D.countries.map(c=>`<option value="${esc(c.countryIso)}">${esc(c.countryIso)} · ${esc(c.country)}</option>`).join('')}</select></div>
          <div class="field"><label for="f-category">Category</label><select id="f-category"><option value="">All categories</option></select></div>
          <div class="field"><label for="f-status">Status / stage</label><select id="f-status"><option value="">All statuses / stages</option><option>Qualification</option><option>Round of 16</option><option>Quarter Final</option><option>Semi Final</option><option>Round of 12</option><option>Round of 6</option><option>Final</option><option>Direct final</option><option>Ranked</option><option>DNC</option><option>DNS</option><option>DNF</option><option>No Time</option></select></div>
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
      <div class="panel"><div class="filters" style="grid-template-columns:2fr 1fr 1fr 1fr 1fr"><div class="field"><label>Search athlete</label><input id="a-search" placeholder="Name…"></div><div class="field"><label>Country</label><select id="a-country"><option value="">All countries</option>${D.countries.map(c=>`<option value="${esc(c.countryIso)}">${esc(c.countryIso)} · ${esc(c.country)}</option>`).join('')}</select></div><div class="field"><label>Participation</label><select id="a-events"><option value="0">Any</option><option value="2">2+ events</option><option value="4">4+ events</option><option value="6">6+ events</option></select></div><div class="field"><label>Sort</label><select id="a-sort"><option value="name">Name</option><option value="events">Most events</option><option value="medals">Most medals</option></select></div><div></div></div><div id="athlete-count" class="muted" style="margin-bottom:12px"></div><div id="athlete-table"></div></div>`;
    const search=document.getElementById('a-search'), country=document.getElementById('a-country'), ev=document.getElementById('a-events'), sort=document.getElementById('a-sort');
    const apply=()=>{ let arr=D.athletes.slice(),q=search.value.trim().toLowerCase(); if(q)arr=arr.filter(a=>a.name.toLowerCase().includes(q)||a.aliases.some(x=>x.toLowerCase().includes(q))); if(country.value)arr=arr.filter(a=>a.countryIso===country.value); if(+ev.value)arr=arr.filter(a=>a.eventCount>=+ev.value); if(sort.value==='events')arr.sort((a,b)=>b.eventCount-a.eventCount||b.medalCount-a.medalCount||a.name.localeCompare(b.name)); else if(sort.value==='medals')arr.sort((a,b)=>b.goldCount-a.goldCount||b.silverCount-a.silverCount||b.bronzeCount-a.bronzeCount||a.name.localeCompare(b.name)); else arr.sort((a,b)=>a.name.localeCompare(b.name)); document.getElementById('athlete-count').textContent=`${arr.length.toLocaleString()} athletes`; document.getElementById('athlete-table').innerHTML=`<div class="table-wrap"><table><thead><tr><th>Athlete</th><th>Country</th><th class="num">Events</th><th class="num">🥇</th><th class="num">🥈</th><th class="num">🥉</th></tr></thead><tbody>${arr.map(a=>`<tr><td>${athleteLink(a.id,a.name)}</td><td>${countryLink(a.countryIso,a.country)}</td><td class="num"><strong>${a.eventCount}</strong></td><td class="num">${a.goldCount}</td><td class="num">${a.silverCount}</td><td class="num">${a.bronzeCount}</td></tr>`).join('')}</tbody></table></div>`;};
    search.addEventListener('input',apply);[country,ev,sort].forEach(x=>x.addEventListener('change',apply));apply();
  }

  function renderAthlete(id) {
    const a=athleteById[id]; if(!a)return renderNotFound(); setTitle(a.name);
    const indiv=a.results.map(x=>resultById[x]).filter(Boolean).sort((x,y)=>eventOrder.indexOf(x.eventId)-eventOrder.indexOf(y.eventId));
    const tms=a.teamResults.map(x=>teamById[x]).filter(Boolean).sort((x,y)=>eventOrder.indexOf(x.eventId)-eventOrder.indexOf(y.eventId));
    const am=a.medals.map(x=>medalById[x]).filter(Boolean);
    app.innerHTML=`${backLink('#athletes','Athletes')}<div class="profile-head"><div class="profile-title"><div class="profile-flag">${flagHtml(a.countryIso,a.country,'profile')}</div><div><h1>${esc(a.name)}</h1><p>${esc(a.country)} · ${esc(a.gender)}${a.aliases.length?` · also listed as ${esc(a.aliases.join(', '))}`:''}</p><div class="medal-strip">${a.eventIds.map(e=>`<a class="event-badge" href="#event/${e}">${esc(eventName(e))}</a>`).join('')}</div></div></div><div class="profile-actions"><button class="btn primary" id="create-carousel">Create carousel</button><div class="medal-strip"><div class="medal-count"><strong>${a.goldCount}</strong><span>🥇 Gold</span></div><div class="medal-count"><strong>${a.silverCount}</strong><span>🥈 Silver</span></div><div class="medal-count"><strong>${a.bronzeCount}</strong><span>🥉 Bronze</span></div><div class="medal-count"><strong>${a.eventCount}</strong><span>Events</span></div></div></div></div>
      <section class="section"><div class="section-head"><div><h2>Individual results</h2><p>${indiv.length} linked result${indiv.length===1?'':'s'}.</p></div></div>${indiv.length?resultsTableHtml(indiv):'<div class="empty">No individual result is linked to this athlete.</div>'}</section>
      <section class="section grid-2"><div class="panel"><div class="section-head"><div><h2>Relay teams</h2><p>Team memberships in the supplied results.</p></div></div>${tms.length?`<div class="list">${tms.map(t=>{const r=resultById[t.resultId];return `<div class="list-item"><div class="main"><strong>${teamLink(t.id,t.name)}</strong><small>${esc(t.event)} · ${esc(t.category)}</small></div><div>${r?.medal?badgeMedal(r.medal):`<span class="time">${esc(r?.time||'—')}</span>`}</div></div>`}).join('')}</div>`:'<div class="empty">No relay memberships linked.</div>'}</div><div class="panel"><div class="section-head"><div><h2>Medals</h2><p>Individual and team medals linked to this athlete.</p></div></div>${am.length?`<div class="list">${am.sort((x,y)=>x.place-y.place).map(m=>`<div class="list-item"><div class="main"><strong>${medalIcon(m.medal)} ${esc(m.event)}</strong><small>${esc(m.category)} · ${esc(m.name)}</small></div><span class="time">${esc(m.time)}</span></div>`).join('')}</div>`:'<div class="empty">No available medals linked.</div>'}</div></section>`;
    document.getElementById('create-carousel').addEventListener('click',()=>openAthleteCarousel(a,indiv,tms,am));
  }

  function renderTeam(id) {
    const t=teamById[id]; if(!t)return renderNotFound(); const r=resultById[t.resultId]; setTitle(t.name);
    app.innerHTML=`${backLink(`#event/${t.eventId}`,t.event)}<div class="profile-head"><div class="profile-title"><div class="profile-flag">${flagHtml(t.countryIso,t.country,'profile')}</div><div><span class="event-badge">${esc(t.event)}</span><h1>${esc(t.name)}</h1><p>${esc(t.country)} · ${esc(t.category)}</p></div></div><div class="medal-strip">${r?.medal?`<div class="medal-count"><strong>${medalIcon(r.medal)}</strong><span>${r.medal}</span></div>`:''}<div class="medal-count"><strong>${esc(r?.time||'—')}</strong><span>Best time</span></div><div class="medal-count"><strong>${r?.place||'—'}</strong><span>Place</span></div></div></div>
      <section class="section grid-2"><div class="panel"><div class="section-head"><div><h2>Team members</h2><p>${t.memberIds.length||t.members.length} listed athletes.</p></div></div>${t.memberIds.length?`<div class="list">${t.memberIds.map(aid=>{const a=athleteById[aid];return a?`<div class="list-item"><div class="main"><strong>${flagHtml(a.countryIso,a.country)} ${athleteLink(a.id,a.name)}</strong><small>${esc(a.country)}</small></div><span class="event-badge">${a.eventCount} events</span></div>`:''}).join('')}</div>`:'<div class="empty">Member names were not present in this source row.</div>'}</div><div class="panel"><div class="section-head"><div><h2>Result details</h2></div></div><div class="list"><div class="list-item"><div class="main"><strong>Status</strong></div>${badgeStatus(r?.status||'Unknown')}</div><div class="list-item"><div class="main"><strong>Best time</strong></div><span class="time">${esc(r?.time||'—')}</span></div>${r?.qualification?`<div class="list-item"><div class="main"><strong>Q1 / Q2</strong><small>Supplied attempts</small></div><span class="time">${esc(r.qualification.attempt1)} / ${esc(r.qualification.attempt2)}</span></div>`:''}</div></div></section>`;
  }

  function renderCountries() {
    setTitle('Countries');
    app.innerHTML=`<div class="section-head"><div><div class="eyebrow">Delegations</div><h1>Countries</h1><p>Open a country to see all linked athletes, event entries and medals.</p></div></div><div class="panel"><div class="filters" style="grid-template-columns:2fr 1fr 2fr"><div class="field"><label>Search country</label><input id="c-search" placeholder="Country…"></div><div class="field"><label>Sort</label><select id="c-sort"><option value="medals">Medal table</option><option value="athletes">Most athletes</option><option value="name">Name</option></select></div><div></div></div><div id="country-grid" class="country-grid"></div></div>`;
    const q=document.getElementById('c-search'),sort=document.getElementById('c-sort'); const apply=()=>{let arr=D.countries.slice(),s=q.value.trim().toLowerCase();if(s)arr=arr.filter(c=>c.country.toLowerCase().includes(s));if(sort.value==='athletes')arr.sort((a,b)=>b.athletes-a.athletes||a.country.localeCompare(b.country));else if(sort.value==='name')arr.sort((a,b)=>a.country.localeCompare(b.country));else arr.sort((a,b)=>b.gold-a.gold||b.silver-a.silver||b.bronze-a.bronze||a.country.localeCompare(b.country));document.getElementById('country-grid').innerHTML=arr.map(c=>`<a class="country-card" href="#country/${c.countryIso}"><div class="top">${flagHtml(c.countryIso,c.country,'card')}<h3>${esc(c.country)}</h3></div><div class="stats"><span><strong>${c.athletes}</strong>athletes</span><span><strong>${c.total}</strong>medals</span><span><strong>${c.gold}</strong>gold</span></div></a>`).join('')};q.addEventListener('input',apply);sort.addEventListener('change',apply);apply();
  }

  function renderCountry(iso) {
    const c=countryByIso[iso]; if(!c)return renderNotFound(); setTitle(c.country);
    const ath=D.athletes.filter(a=>a.countryIso===iso).sort((a,b)=>b.medalCount-a.medalCount||b.eventCount-a.eventCount||a.name.localeCompare(b.name));
    const rr=D.results.filter(r=>r.countryIso===iso);
    const eventRows=eventOrder.map(eid=>{const x=D.medalTables[eid]?.find(x=>x.countryIso===iso);return {eid,name:eventName(eid),entries:rr.filter(r=>r.eventId===eid).length,gold:x?.gold||0,silver:x?.silver||0,bronze:x?.bronze||0,total:x?.total||0};});
    app.innerHTML=`${backLink('#countries','Countries')}<div class="profile-head"><div class="profile-title"><div class="profile-flag">${flagHtml(c.countryIso,c.country,'profile')}</div><div><h1>${esc(c.country)}</h1><p>${c.athletes} linked athletes · ${c.resultEntries} result records</p></div></div><div class="medal-strip"><div class="medal-count"><strong>${c.gold}</strong><span>🥇 Gold</span></div><div class="medal-count"><strong>${c.silver}</strong><span>🥈 Silver</span></div><div class="medal-count"><strong>${c.bronze}</strong><span>🥉 Bronze</span></div><div class="medal-count"><strong>${c.total}</strong><span>Total</span></div></div></div>
      <section class="section"><div class="section-head"><div><h2>Event breakdown</h2><p>Available medals and result records by event.</p></div></div><div class="table-wrap"><table><thead><tr><th>Event</th><th class="num">Entries</th><th class="num">🥇</th><th class="num">🥈</th><th class="num">🥉</th><th class="num">Total</th></tr></thead><tbody>${eventRows.map(x=>`<tr><td><a href="#event/${x.eid}">${esc(x.name)}</a></td><td class="num">${x.entries}</td><td class="num">${x.gold}</td><td class="num">${x.silver}</td><td class="num">${x.bronze}</td><td class="num"><strong>${x.total}</strong></td></tr>`).join('')}</tbody></table></div></section>
      <section class="section grid-2"><div class="panel"><div class="section-head"><div><h2>Athletes</h2><p>Sorted by medals, then event count.</p></div></div><div class="list">${ath.slice(0,35).map(a=>`<div class="list-item"><div class="main"><strong>${athleteLink(a.id,a.name)}</strong><small>${a.eventCount} events</small></div><span>${a.goldCount?`🥇 ${a.goldCount} `:''}${a.silverCount?`🥈 ${a.silverCount} `:''}${a.bronzeCount?`🥉 ${a.bronzeCount}`:''}</span></div>`).join('')}</div>${ath.length>35?`<p class="muted">Showing 35 of ${ath.length} linked athletes.</p>`:''}</div><div class="panel"><div class="section-head"><div><h2>Latest view of results</h2><p>First 35 records sorted by event and place/time.</p></div></div>${resultsTableHtml(rr.slice().sort((a,b)=>eventOrder.indexOf(a.eventId)-eventOrder.indexOf(b.eventId)||(a.place??999)-(b.place??999)||(a.timeSeconds??Infinity)-(b.timeSeconds??Infinity)).slice(0,35))}</div></section>`;
  }

  function renderMedals(initial='combined') {
    setTitle('Medal Tables'); const ids=['combined',...eventOrder];
    app.innerHTML=`<div class="section-head"><div><div class="eyebrow">Podiums</div><h1>Medal Tables</h1><p>Switch between individual events, relays and the combined championship table.</p></div></div><div class="panel"><div class="field" style="max-width:360px;margin-bottom:16px"><label>Medal table</label><select id="m-event">${ids.map(id=>`<option value="${id}" ${id===initial?'selected':''}>${id==='combined'?'Combined · all events':esc(eventName(id))}</option>`).join('')}</select></div><div id="medal-note"></div><div id="medal-table"></div></div>`;
    const sel=document.getElementById('m-event');const apply=()=>{const id=sel.value;document.getElementById('medal-note').innerHTML=id==='combined'?`<div class="notice"><strong>Combined table scope</strong>${esc(D.meta.combinedMedalNote)}</div>`:'';document.getElementById('medal-table').innerHTML=medalTableHtml(D.medalTables[id]||[]);};sel.addEventListener('change',apply);apply();
  }

  function renderInsights() {
    setTitle('Insights');
    const maxEvents=Math.max(...D.mostEvents.map(x=>x.eventCount)); const maxMedals=Math.max(...D.mostMedals.map(x=>x.total));
    app.innerHTML=`<div class="section-head"><div><div class="eyebrow">Championship statistics</div><h1>Insights & Interesting Facts</h1><p>Derived from the linked results rather than merely staring at 2,000 spreadsheet rows until meaning appears.</p></div></div><div class="metric-grid">${D.insights.map(x=>metric(x.title,String(x.value),x.text)).join('')}</div>
      <section class="section grid-2"><div class="panel"><div class="section-head"><div><h2>DNC comparison</h2><p>Percentage of timed finishers classified DNC.</p></div></div>${[['Short · Men',D.dncGender.short.Male],['Short · Women',D.dncGender.short.Female],['Standard · Men',D.dncGender.standard.Male],['Standard · Women',D.dncGender.standard.Female]].map(([n,v])=>`<div class="bar-row"><strong>${n}</strong><div class="bar"><span style="width:${Math.min(100,v*2)}%"></span></div><small>${v}%</small></div>`).join('')}<div class="notice"><strong>DNC</strong>Finished the course, but failed 3 or more obstacles and therefore remained unranked.</div></div><div class="panel"><div class="section-head"><div><h2>Overall facts</h2></div></div><div class="fact-list">${D.overallFacts.map(x=>`<div class="fact">${flagText(x)}</div>`).join('')}</div></div></section>
      <section class="section grid-2"><div class="panel"><div class="section-head"><div><h2>Most event types</h2><p>Athletes appearing across the widest range of events.</p></div></div>${D.mostEvents.map(a=>`<div class="bar-row"><strong>${flagHtml(a.countryIso,a.country)} ${athleteLink(a.id,a.name)}</strong><div class="bar"><span style="width:${a.eventCount/maxEvents*100}%"></span></div><small>${a.eventCount}</small></div>`).join('')}</div><div class="panel"><div class="section-head"><div><h2>Most available medals</h2><p>Individual + team medals linked to athlete profiles.</p></div></div>${D.mostMedals.map(a=>`<div class="bar-row"><strong>${flagHtml(a.countryIso,a.country)} ${athleteLink(a.id,a.name)}</strong><div class="bar"><span style="width:${a.total/maxMedals*100}%"></span></div><small>${a.total}</small></div>`).join('')}</div></section>
      <section class="section"><div class="section-head"><div><h2>Facts by event</h2></div></div><div class="grid-3">${eventOrder.map(id=>`<div class="panel"><h3>${esc(eventName(id))}</h3><div class="fact-list">${(D.eventFacts[id]||[]).map(x=>`<div class="fact">${flagText(x)}</div>`).join('')}</div></div>`).join('')}</div></section>`;
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
