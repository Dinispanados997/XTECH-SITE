/* =====================================================================
   XTECH STORE — MARCAÇÕES DE REPARAÇÃO
   · Página "Marcar reparação" (serviço → equipamento → dia/hora → dados)
   · "A minha conta → Reparações": as marcações do cliente (e desmarcar)
   · Painel de admin: separador "Marcações", definições, calendário
   Carrega DEPOIS do loja.js. Regras partilhadas em loja-data.js (XAgenda).
   ===================================================================== */
/* global XDB, XAgenda, storeGet, storeSet, showPage, renderModal, closeModal, toast,
   repairs, saveRepairs, uid, generateFichaCode, switchAdminTab, openRepairDetail, Shop */
(function(){
  'use strict';
  const A = XAgenda;
  const $ = (s, r)=> (r||document).querySelector(s);
  const $$ = (s, r)=> [...(r||document).querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const STORE = { name:'Xtech Store', phone:'923 512 686', wa:'351923512686', addr:'Largo Dom Gualdim Pais 21, 4720 Amares — Braga' };
  const MAPS = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Xtech Store, Largo Dom Gualdim Pais 21, 4720 Amares');

  // estados: o que o cliente vê / o que o admin vê
  const ST = {
    pendente:   { c:'Marcada',        a:'Nova',          t:'warn', ct:'info' },
    confirmada: { c:'Confirmada',     a:'Confirmada',    t:'info', ct:'ok' },
    concluida:  { c:'Concluída',      a:'Concluída',     t:'ok',   ct:'done' },
    faltou:     { c:'Não compareceu', a:'Faltou',        t:'bad',  ct:'mute' },
    cancelada:  { c:'Cancelada',      a:'Cancelada',     t:'mute', ct:'mute' },
  };
  const pillC = s => { const x = ST[s] || { c:s, ct:'mute' }; return `<span class="xs-pill ${x.ct}">${esc(x.c)}</span>`; };
  const pillA = s => { const x = ST[s] || { a:s, t:'mute' }; return `<span class="xs-pill ${x.t}">${esc(x.a)}</span>`; };

  const DEV_TYPES = [
    ['iPhone','Ex.: iPhone 13 Pro'], ['Samsung','Ex.: Galaxy A54'], ['Xiaomi','Ex.: Redmi Note 12'], ['Outro telemóvel','Marca e modelo'],
    ['iPad / tablet','Ex.: iPad 9.ª geração'], ['Computador','Ex.: MacBook Air 2020'], ['Consola','Ex.: Nintendo Switch OLED'], ['Relógio','Ex.: Apple Watch SE'],
  ];

  /* ---------------- datas ---------------- */
  const utc = ds => { const [y,m,d] = ds.split('-').map(Number); return new Date(Date.UTC(y, m-1, d, 12)); };
  const fmt = (ds, o) => utc(ds).toLocaleDateString('pt-PT', { timeZone:'UTC', ...o });
  const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);
  const dayLong  = ds => fmt(ds, { weekday:'long', day:'numeric', month:'long' });                 // terça-feira, 3 de novembro
  const WD = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'], MO = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  const wdShort  = ds => WD[utc(ds).getUTCDay()];
  const monShort = ds => MO[utc(ds).getUTCMonth()];
  const dayMed   = ds => `${wdShort(ds)} ${Number(ds.slice(8))} ${monShort(ds)}`;                   // Ter 3 nov
  const dnum     = ds => Number(ds.slice(8));
  const relDay = ds => { const t = A.now().date; return ds === t ? 'Hoje' : ds === A.addDays(t, 1) ? 'Amanhã' : null; };
  const fmtPhone = p => { const d = String(p||'').replace(/\D/g,''); return d.length === 9 ? d.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') : (p||''); };
  const priceNum = p => { const m = String(p||'').match(/(\d+(?:[.,]\d+)?)\s*€/); return m ? Number(m[1].replace(',','.')) : 0; };

  // instante UTC de uma hora de Portugal (para o ficheiro de calendário)
  function lisbonToUtc(ds, hm){
    const [y,m,d] = ds.split('-').map(Number), [h,mi] = hm.split(':').map(Number);
    const guess = Date.UTC(y, m-1, d, h, mi);
    const p = {}; new Intl.DateTimeFormat('en-GB', { timeZone:'Europe/Lisbon', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(new Date(guess)).forEach(x=> p[x.type] = x.value);
    const asLis = Date.UTC(+p.year, +p.month-1, +p.day, +p.hour, +p.minute);
    return new Date(guess - (asLis - guess));
  }
  const icsStamp = d => d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');

  function ask(msg, ok, danger){
    return new Promise(res=>{
      const w = document.createElement('div'); w.className = 'xs-ask';
      w.innerHTML = `<div class="xs-ask-box" role="alertdialog" aria-modal="true"><p>${esc(msg)}</p><div class="xs-row" style="justify-content:flex-end;flex-wrap:wrap"><button class="xs-btn ghost sm" data-v="0">Voltar</button><button class="xs-btn sm ${danger?'danger':''}" data-v="1">${esc(ok||'Confirmar')}</button></div></div>`;
      w.addEventListener('click', e=>{ const b = e.target.closest('[data-v]'); if(b || e.target === w){ w.remove(); res(!!(b && b.dataset.v === '1')); } });
      document.body.appendChild(w);
    });
  }

  const ICON = {
    cal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/><path d="M12 13.5v3l2 1.2"/></svg>',
    check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17l9-10"/></svg>',
    pin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    wa:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2c0 1.3.9 2.5 1.1 2.7.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>',
    phone:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 1.1 4.2 2 2 0 0 1 3.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L7.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/></svg>',
    left:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    right:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
    back:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  };

  async function loadSettings(){ return A.settings(await storeGet('agendaSettings')); }

  /* =====================================================================
     PÁGINA DO CLIENTE
     ===================================================================== */
  const st = { service:null, devType:'', model:'', issue:'', day:null, slot:null, name:'', phone:'', email:'',
               settings:A.settings(), busy:{}, loaded:false, sending:false, error:'', done:null, filledFor:null };

  function ensurePage(){
    let p = document.getElementById('page-marcar');
    if(!p){
      p = document.createElement('div'); p.id = 'page-marcar'; p.className = 'site-page hide';
      const footer = document.querySelector('#site-view footer.site-footer');
      footer.parentNode.insertBefore(p, footer);
      p.addEventListener('click', onPageClick);
      p.addEventListener('input', onPageInput);
    }
    return p;
  }

  function prefill(){
    const u = XDB.auth.user(); if(!u || st.filledFor === u.id) return;
    const m = u.meta || {};
    if(!st.name) st.name = m.name || u.name || '';
    if(!st.phone) st.phone = m.phone || '';
    if(!st.email) st.email = u.email || '';
    st.filledFor = u.id;
  }

  async function open(service){
    if(service && A.SERVICES.some(s=>s.k===service)) st.service = service;
    if(st.done){ st.done = null; st.day = null; st.slot = null; st.issue = ''; }
    showPage('marcar');
    if(location.hash !== '#marcar') history.replaceState(null, '', location.pathname + location.search + '#marcar');
  }

  async function renderPage(){
    const page = ensurePage(); prefill();
    if(st.done){ page.innerHTML = thanksHTML(); return; }
    page.innerHTML = `<div class="wrap xs-page ag-page">
      <button class="xs-back" data-ag="back">${ICON.back} Reparações</button>
      <div class="ag-head"><h1>Marca a tua reparação.</h1><p class="lead">Escolhe o serviço, o dia e a hora. Não pagas nada agora — e o diagnóstico é sempre gratuito.</p></div>
      <div class="xs-co ag-co">
        <div>
          <section class="xs-card"><h2><i>1</i>O que precisas?</h2><div class="ag-svc" id="ag-svc"></div></section>
          <section class="xs-card"><h2><i>2</i>Qual é o equipamento?</h2><div id="ag-dev"></div></section>
          <section class="xs-card" id="ag-when-card"><h2><i>3</i>Quando queres vir?</h2><div id="ag-when"><div class="xs-spin" style="margin:24px auto"></div></div></section>
          <section class="xs-card" id="ag-you-card"><h2><i>4</i>Os teus dados</h2><div id="ag-you"></div></section>
        </div>
        <aside class="xs-card xs-sum ag-sum" id="ag-sum"></aside>
      </div>
    </div>`;
    drawSvc(); drawDev(); drawYou(); drawSum();
    await refreshBusy();
    drawWhen(); drawSum();
  }

  async function refreshBusy(){
    st.settings = await loadSettings();
    const t = A.now().date;
    try{ st.busy = await XDB.bookings.busy(t, A.addDays(t, st.settings.maxDays)); }catch(e){ st.busy = {}; }
    st.loaded = true;
    // se o dia escolhido deixou de ter vagas, escolhe o próximo com vagas
    const days = dayList();
    if(!st.day || !days.some(d=> d.ds === st.day && d.free)) { const f = days.find(d=> d.free); st.day = f ? f.ds : null; st.slot = null; }
    if(st.slot && !A.freeSlots(st.day, st.settings, st.busy).some(x=> x.t === st.slot && x.ok)) st.slot = null;
  }

  function dayList(){
    const s = st.settings, t = A.now().date, out = [];
    for(let i = 0; i <= s.maxDays; i++){
      const ds = A.addDays(t, i);
      const h = s.hours[String(A.isoDow(ds))];
      if(!Array.isArray(h)) continue;                       // dias da semana em que a loja não abre (domingo)
      const closed = s.closed.includes(ds);
      const free = closed ? 0 : A.freeSlots(ds, s, st.busy).filter(x=>x.ok).length;
      if(i === 0 && !closed && free === 0) continue;         // hoje já sem horários: não mostra
      out.push({ ds, closed, free });
    }
    return out;
  }

  function drawSvc(){
    const el = $('#ag-svc'); if(!el) return;
    el.innerHTML = A.SERVICES.map(s=>`<button type="button" class="ag-s ${st.service===s.k?'on':''}" data-svc="${s.k}" aria-pressed="${st.service===s.k}">
      <span class="ag-s-t">${esc(s.t)}</span><b>${esc(s.l)}</b><small>${esc(s.d)}</small><span class="ag-s-p">${esc(s.p)}</span></button>`).join('');
  }

  function drawDev(){
    const el = $('#ag-dev'); if(!el) return;
    const ph = (DEV_TYPES.find(d=>d[0]===st.devType) || [0,'Marca e modelo'])[1];
    el.innerHTML = `<div class="ag-chips">${DEV_TYPES.map(([k])=>`<button type="button" class="${st.devType===k?'on':''}" data-dev="${esc(k)}">${esc(k)}</button>`).join('')}</div>
      <div class="xs-f" style="margin-top:14px">
        <div class="xs-in full"><label for="ag-model">Modelo</label><input id="ag-model" data-f="model" autocomplete="off" maxlength="60" placeholder="${esc(ph)}" value="${esc(st.model)}"></div>
        <div class="xs-in full"><label for="ag-issue">O que se passa? <span class="ag-opt">(opcional)</span></label><textarea id="ag-issue" data-f="issue" maxlength="600" placeholder="Ex.: caiu e o ecrã ficou com riscas verdes">${esc(st.issue)}</textarea></div>
      </div>`;
  }

  function drawWhen(){
    const el = $('#ag-when'); if(!el) return;
    const s = st.settings;
    if(!s.enabled){ el.innerHTML = `<div class="xs-alert info" style="margin:0">De momento não estamos a aceitar marcações online. Liga-nos para o <a href="tel:+351923512686" style="color:#fff">${STORE.phone}</a> ou passa na loja.</div>`; return; }
    const days = dayList();
    if(!days.some(d=>d.free)){ el.innerHTML = `<div class="xs-alert info" style="margin:0">Não há horários livres nos próximos ${s.maxDays} dias. Liga-nos para o <a href="tel:+351923512686" style="color:#fff">${STORE.phone}</a>.</div>`; return; }
    const slots = st.day ? A.freeSlots(st.day, s, st.busy) : [];
    const am = slots.filter(x=> A.toMin(x.t) < 13*60), pm = slots.filter(x=> A.toMin(x.t) >= 13*60);
    const grp = (title, list)=> list.length ? `<div class="ag-slots-h">${title}</div><div class="ag-slots">${list.map(x=>`<button type="button" class="ag-t ${st.slot===x.t?'on':''}" data-slot="${x.t}" ${x.ok?'':'disabled'} ${x.full?'title="Ocupado"':''}>${x.t}</button>`).join('')}</div>` : '';
    el.innerHTML = `<div class="ag-days-wrap">
        <button type="button" class="ag-nav" data-ag="dprev" aria-label="Dias anteriores">${ICON.left}</button>
        <div class="ag-days" id="ag-days">${days.map(d=>`<button type="button" class="ag-day ${st.day===d.ds?'on':''}" data-day="${d.ds}" ${d.free?'':'disabled'}>
          <span>${esc(relDay(d.ds) || wdShort(d.ds))}</span><b>${dnum(d.ds)}</b><span>${esc(monShort(d.ds))}</span><em>${d.closed?'Fechado':d.free?(d.free===1?'1 vaga':d.free+' vagas'):'Esgotado'}</em></button>`).join('')}</div>
        <button type="button" class="ag-nav" data-ag="dnext" aria-label="Mais dias">${ICON.right}</button>
      </div>
      ${st.day ? `<p class="ag-dayname">${esc(cap1(dayLong(st.day)))}</p>${grp('Manhã', am)}${grp('Tarde', pm)}` : ''}`;
    const sel = $('#ag-days .ag-day.on');
    if(sel){ const box = $('#ag-days'); const x = sel.offsetLeft - box.offsetLeft; if(x + sel.offsetWidth > box.clientWidth) box.scrollLeft = x - box.clientWidth/2 + sel.offsetWidth/2; }
  }

  function drawYou(){
    const el = $('#ag-you'); if(!el) return;
    const u = XDB.auth.user();
    el.innerHTML = `<div class="xs-f">
        <div class="xs-in full"><label for="ag-name">Nome</label><input id="ag-name" data-f="name" autocomplete="name" maxlength="80" value="${esc(st.name)}" placeholder="O teu nome"></div>
        <div class="xs-in"><label for="ag-phone">Telemóvel</label><input id="ag-phone" data-f="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" value="${esc(st.phone)}" placeholder="9xx xxx xxx"></div>
        <div class="xs-in"><label for="ag-email">Email <span class="ag-opt">(recebes lá a confirmação)</span></label><input id="ag-email" data-f="email" type="email" autocomplete="email" maxlength="120" value="${esc(st.email)}" placeholder="nome@email.com"></div>
      </div>
      ${u ? '' : `<p class="ag-note">Tens conta? <button class="xs-link" data-ag="login">Entra</button> para veres e gerires as tuas marcações.</p>`}`;
  }

  function drawSum(){
    const el = $('#ag-sum'); if(!el) return;
    const sv = st.service ? A.service(st.service) : null;
    const dev = deviceText();
    const row = (k, v, empty)=> `<div class="ag-sum-r"><span>${k}</span>${v ? `<b>${v}</b>` : `<em>${empty||'Por escolher'}</em>`}</div>`;
    el.innerHTML = `<h2>Resumo</h2>
      <div class="ag-when ${st.day && st.slot ? '' : 'empty'}">
        <div class="ag-cal"><span>${st.day ? esc(monShort(st.day)) : '—'}</span><b>${st.day ? dnum(st.day) : '·'}</b></div>
        <div><b>${st.day ? esc(cap1(dayLong(st.day))) : 'Escolhe o dia'}</b><span>${st.slot ? 'às ' + st.slot : 'e a hora'}</span></div>
      </div>
      ${row('Serviço', sv ? esc(sv.l) : '')}
      ${row('Preço', sv ? esc(sv.p) : '', '—')}
      ${row('Duração', sv ? esc(sv.t) : '', '—')}
      ${row('Equipamento', dev ? esc(dev) : '', 'Por indicar')}
      ${row('Onde', 'Xtech Store, Amares')}
      ${st.error ? `<div class="xs-alert" role="alert">${esc(st.error)}</div>` : ''}
      <button class="xs-btn block" data-ag="send" ${st.sending?'disabled':''} style="margin-top:16px">${st.sending ? '<span class="xs-spin sm"></span> A marcar…' : 'Confirmar marcação'}</button>
      <p class="ag-fine">Não pagas nada agora. O preço final é confirmado depois do diagnóstico gratuito. Usamos estes dados só para gerir a marcação — <button class="xs-link" data-ag="privacy">Privacidade</button>.</p>`;
  }

  function deviceText(){
    const m = st.model.trim();
    if(!st.devType) return m;
    if(!m) return st.devType;
    const t = st.devType.split(' ')[0].toLowerCase();
    return m.toLowerCase().includes(t) || /^(outro|ipad|computador|consola|relógio)/i.test(st.devType) ? m : st.devType + ' ' + m;
  }

  function onPageInput(e){
    const f = e.target.dataset && e.target.dataset.f; if(!f) return;
    st[f] = e.target.value;
    e.target.closest('.xs-in') && e.target.closest('.xs-in').classList.remove('err');
    if(f === 'model') drawSum();
  }

  function scrollToEl(el){ if(!el) return; const y = el.getBoundingClientRect().top + window.scrollY - 92; window.scrollTo({ top:y, behavior:'smooth' }); }

  async function onPageClick(e){
    const b = e.target.closest('button'); if(!b) return;
    if(b.dataset.svc){ const first = !st.service, card = b.closest('.xs-card'); st.service = b.dataset.svc; st.error = ''; drawSvc(); drawSum(); if(first && window.innerWidth < 900 && card) scrollToEl(card.nextElementSibling); return; }
    if(b.dataset.dev){ st.devType = st.devType === b.dataset.dev ? '' : b.dataset.dev; drawDev(); drawSum(); const i = $('#ag-model'); if(i && st.devType) i.focus({ preventScroll:true }); return; }
    if(b.dataset.day){ st.day = b.dataset.day; st.slot = null; st.error = ''; drawWhen(); drawSum(); return; }
    if(b.dataset.slot){ st.slot = b.dataset.slot; st.error = ''; drawWhen(); drawSum(); if(window.innerWidth < 900) scrollToEl($('#ag-you-card')); return; }
    const a = b.dataset.ag; if(!a) return;
    if(a === 'back') showPage('reparacoes');
    if(a === 'dprev' || a === 'dnext'){ const box = $('#ag-days'); box.scrollBy({ left:(a==='dnext'?1:-1) * box.clientWidth * .8, behavior:'smooth' }); }
    if(a === 'login') Shop.openAuth('login', ()=>{ st.filledFor = null; prefill(); drawYou(); });
    if(a === 'privacy') Shop.legal('privacidade');
    if(a === 'send') send();
    if(a === 'ics') downloadIcs(st.done);
    if(a === 'again'){ st.done = null; st.service = null; st.day = null; st.slot = null; st.model = ''; st.devType = ''; st.issue = ''; renderPage(); window.scrollTo(0,0); }
    if(a === 'mine') Shop.openAccount('repairs');
    if(a === 'home') showPage('home');
  }

  async function send(){
    if(st.sending) return;
    const b = { service:st.service, device:deviceText(), issue:st.issue.trim(), day:st.day, slot:st.slot, name:st.name.trim(), phone:st.phone, email:st.email.trim() };
    const err = A.validate(b, st.settings);
    if(err){
      st.error = err; drawSum();
      const target = !b.service ? $('#ag-svc') : (!b.day || !b.slot) ? $('#ag-when-card') : $('#ag-you-card');
      if(target === $('#ag-you-card')){
        if(b.name.length < 2) $('#ag-name').closest('.xs-in').classList.add('err');
        else if(/telem/i.test(err)) $('#ag-phone').closest('.xs-in').classList.add('err');
        else if(/email/i.test(err)) $('#ag-email').closest('.xs-in').classList.add('err');
      }
      if(window.innerWidth < 900 || target !== $('#ag-you-card')) scrollToEl(target.closest('.xs-card') || target);
      return;
    }
    st.sending = true; st.error = ''; drawSum();
    try{
      const r = await XDB.bookings.create(b);
      const sv = A.service(b.service);
      st.done = { ...b, number:r.number, id:r.id, service_label:sv.l, price:sv.p, duration:sv.t, phone:A.normPhone(b.phone) };
      // guarda o telemóvel na conta, para a próxima vez
      const u = XDB.auth.user();
      if(u && !(u.meta && u.meta.phone)) XDB.auth.updateMeta({ phone:A.normPhone(b.phone) }).catch(()=>{});
      st.sending = false;
      renderPage(); window.scrollTo(0,0);
    }catch(e){
      st.sending = false; st.error = e.message || 'Não foi possível marcar. Tenta de novo.';
      if(/ocupado|dispon|passou/i.test(st.error)){ await refreshBusy(); drawWhen(); }
      drawSum();
    }
  }

  function thanksHTML(){
    const d = st.done; const u = XDB.auth.user();
    const waText = `Olá! Fiz a marcação ${d.number} no site: ${d.service_label}${d.device ? ' (' + d.device + ')' : ''}, ${dayLong(d.day)} às ${d.slot}. Nome: ${d.name}.`;
    return `<div class="wrap xs-page ag-page"><div class="xs-thanks ag-thanks">
      <div class="xs-tick">${ICON.check}</div>
      <h1>Está marcado.</h1>
      <p class="lead">Esperamos por ti <b>${esc(dayLong(d.day))}, às ${esc(d.slot)}</b>.<br>O horário fica reservado — se precisarmos de mudar alguma coisa, ligamos-te.${d.email ? `<br>Enviámos a confirmação para <b>${esc(d.email)}</b>.` : ''}</p>
      <div class="ag-ticket">
        <div class="ag-ticket-l"><span>${esc(wdShort(d.day))}</span><b>${dnum(d.day)}</b><span>${esc(monShort(d.day))}</span><strong>${esc(d.slot)}</strong></div>
        <div class="ag-ticket-r">
          <div class="ag-sum-r"><span>Serviço</span><b>${esc(d.service_label)}</b></div>
          ${d.device ? `<div class="ag-sum-r"><span>Equipamento</span><b>${esc(d.device)}</b></div>` : ''}
          <div class="ag-sum-r"><span>Preço</span><b>${esc(d.price)}</b></div>
          <div class="ag-sum-r"><span>N.º da marcação</span><b class="xs-copy">${esc(d.number)}</b></div>
          <div class="ag-sum-r"><span>Morada</span><b>${esc(STORE.addr)}</b></div>
        </div>
      </div>
      <div class="ag-actions">
        <button class="xs-btn" data-ag="ics">${ICON.cal} Adicionar ao calendário</button>
        <a class="xs-btn ghost" href="${MAPS}" target="_blank" rel="noopener">${ICON.pin} Como chegar</a>
        <a class="xs-btn ghost" href="https://wa.me/${STORE.wa}?text=${encodeURIComponent(waText)}" target="_blank" rel="noopener">${ICON.wa} Enviar à loja por WhatsApp</a>
      </div>
      <p class="xs-muted ag-after">Se não puderes vir, avisa-nos pelo <a href="tel:+351923512686">${STORE.phone}</a>.${u ? ' Também podes desmarcar em <button class="xs-link" data-ag="mine">A minha conta → Reparações</button>.' : ''}</p>
      <p><button class="xs-link" data-ag="again">Fazer outra marcação</button> &nbsp;·&nbsp; <button class="xs-link" data-ag="home">Voltar ao início</button></p>
    </div></div>`;
  }

  function downloadIcs(d){
    if(!d) return;
    const start = lisbonToUtc(d.day, d.slot), end = new Date(start.getTime() + 30*60000);
    const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Xtech Store//Marcacoes//PT','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',
      `UID:${d.number}-${d.day}@xtechstore.pt`, `DTSTAMP:${icsStamp(new Date())}`, `DTSTART:${icsStamp(start)}`, `DTEND:${icsStamp(end)}`,
      `SUMMARY:Xtech Store — ${d.service_label}`,
      `LOCATION:${STORE.addr.replace(/,/g,'\\,')}`,
      `DESCRIPTION:Marcação ${d.number}${d.device ? '\\nEquipamento: ' + d.device.replace(/[,;]/g,' ') : ''}\\nTelefone da loja: ${STORE.phone}`,
      'BEGIN:VALARM','TRIGGER:-PT1H','ACTION:DISPLAY','DESCRIPTION:Marcação na Xtech Store','END:VALARM','END:VEVENT','END:VCALENDAR'];
    const blob = new Blob([lines.join('\r\n')], { type:'text/calendar;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `Xtech-${d.number}.ics`;
    document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  /* ---------------- "A minha conta → Reparações" ---------------- */
  async function fillMine(){
    const slot = document.getElementById('ag-mine'); if(!slot) return;
    let list = [];
    try{ list = await XDB.bookings.mine(); }catch(e){}
    if(!document.getElementById('ag-mine')) return;
    const today = A.now().date;
    const up = list.filter(b=> A.ACTIVE.includes(b.status) && b.day >= today).sort((a,b)=> (a.day+a.slot).localeCompare(b.day+b.slot));
    const past = list.filter(b=> !up.includes(b));
    const rowH = (b, canCancel)=> `<div class="ag-my">
        <div class="ag-cal sm"><span>${esc(monShort(b.day))}</span><b>${dnum(b.day)}</b></div>
        <div class="ag-my-m"><b>${esc(b.service_label || A.service(b.service).l)}</b><span>${esc(cap1(dayLong(b.day)))} · ${esc(b.slot)}${b.device ? ' · ' + esc(b.device) : ''}</span><span class="xs-muted">${esc(b.number)}</span></div>
        <div class="ag-my-r">${pillC(b.status)}${canCancel ? `<button class="xs-link" data-agc="${b.id}" style="color:#FF6961">Desmarcar</button>` : ''}</div>
      </div>`;
    slot.innerHTML = `<div class="xs-card" style="margin-bottom:16px">
      <div class="xs-row" style="margin-bottom:6px;flex-wrap:wrap"><h2 style="margin:0">As tuas marcações</h2><span class="xs-sp"></span><button class="xs-btn sm" data-agc="new">Marcar reparação</button></div>
      ${up.length ? up.map(b=> rowH(b, true)).join('') : `<p class="xs-muted" style="margin:10px 0 0">Não tens marcações para os próximos dias.</p>`}
      ${past.length ? `<details class="ag-past"><summary>Anteriores (${past.length})</summary>${past.slice(0,20).map(b=> rowH(b, false)).join('')}</details>` : ''}
    </div>`;
    slot.onclick = async e=>{
      const b = e.target.closest('[data-agc]'); if(!b) return;
      if(b.dataset.agc === 'new'){ open(); return; }
      const id = Number(b.dataset.agc); const x = list.find(y=> y.id === id);
      if(!(await ask(`Desmarcar ${x.service_label} de ${dayLong(x.day)} às ${x.slot}?`, 'Desmarcar', true))) return;
      try{ await XDB.bookings.cancelMine(id); toast('Marcação desmarcada.'); fillMine(); }catch(err){ toast(err.message); }
    };
  }

  /* ---------------- pontos de entrada no site ---------------- */
  function decorateSite(){
    // cartões de serviços na página Reparações → "Marcar"
    $$('#page-reparacoes .repair-mini').forEach(card=>{
      if(card.dataset.agReady) return; card.dataset.agReady = '1';
      const t = (card.querySelector('h5') || {}).textContent || '';
      const sv = A.SERVICES.find(s=> s.l.toLowerCase() === t.trim().toLowerCase() || t.toLowerCase().includes(s.l.toLowerCase().split(' ')[0])) || A.service('outro');
      card.classList.add('ag-card'); card.setAttribute('role','button'); card.tabIndex = 0;
      card.insertAdjacentHTML('beforeend', `<span class="ag-card-go">Marcar <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>`);
      card.addEventListener('click', ()=> open(sv.k));
      card.addEventListener('keydown', e=>{ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); open(sv.k); } });
    });
  }

  /* =====================================================================
     PAINEL DE ADMIN
     ===================================================================== */
  const adm = { list:[], loaded:false, view:'next', settings:A.settings() };
  const isAdminOpen = ()=> { const v = document.getElementById('admin-view'), s = document.getElementById('admin-shell'); return v && s && v.style.display === 'block' && s.style.display !== 'none'; };

  function mountAdmin(){
    const ref = document.getElementById('tab-reparacoes'); if(!ref || document.getElementById('tab-agenda')) return;
    ref.insertAdjacentHTML('afterend', `<div class="admin-tab-content" id="tab-agenda">
      <div class="panel-head" style="margin-bottom:6px;gap:10px;flex-wrap:wrap">
        <div><h1 class="admin-title">Marcações</h1><p class="admin-sub" id="ag-a-sub">—</p></div>
        <div class="xs-row" style="gap:8px"><button class="btn btn-dark btn-sm" data-aga="settings">Definições</button><button class="btn btn-sm" style="background:#fff;color:#000" data-aga="new">+ Nova</button></div>
      </div>
      <div class="ag-a-days" id="ag-a-days"></div>
      <div class="panel" id="ag-a-list"><div class="empty-inline">A carregar…</div></div>
    </div>`);
    const nav = document.querySelector('.bnav-item[data-tab="reparacoes"]');
    if(nav) nav.insertAdjacentHTML('afterend', `<div class="bnav-item" data-tab="agenda" onclick="switchAdminTab('agenda')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/><path d="M12 13.5v3l2 1.2"/></svg>Marcações</div>`);
    $('#tab-agenda').addEventListener('click', adminClick);

    const origSwitch = window.switchAdminTab;
    window.switchAdminTab = function(tab){ origSwitch(tab); if(tab === 'agenda') loadAdmin().then(drawAdmin); };
    // calendário do admin: mostra as marcações
    const origCal = window.renderCalendar;
    if(typeof origCal === 'function') window.renderCalendar = function(){ origCal.apply(this, arguments); calDots(); };
    const origDay = window.openDayModal;
    if(typeof origDay === 'function') window.openDayModal = function(ds){ origDay.apply(this, arguments); dayModalBookings(ds); };
    const origDash = window.renderDashboard;
    if(typeof origDash === 'function') window.renderDashboard = function(){ origDash.apply(this, arguments); dashStrip(); };
  }

  async function loadAdmin(){
    try{ if(!(await XDB.isStaff())) return; }catch(e){ return; }
    const [list, s] = await Promise.all([XDB.bookings.all(), loadSettings()]);
    adm.list = list; adm.settings = s; adm.loaded = true; updateBadge();
  }
  const active = b => A.ACTIVE.includes(b.status);
  function updateBadge(){
    const t = A.now().date; const n = adm.list.filter(b=> b.status === 'pendente' && b.day >= t).length;
    const item = document.querySelector('.bnav-item[data-tab="agenda"]'); if(!item) return;
    let bd = item.querySelector('.xs-bdg'); if(n){ if(!bd){ bd = document.createElement('span'); bd.className = 'xs-bdg'; item.appendChild(bd); } bd.textContent = n; } else if(bd) bd.remove();
  }

  function drawAdmin(){
    const t = A.now().date, s = adm.settings;
    const todayN = adm.list.filter(b=> b.day === t && active(b)).length;
    const newN = adm.list.filter(b=> b.status === 'pendente' && b.day >= t).length;
    $('#ag-a-sub').textContent = `${todayN} hoje · ${newN} por confirmar${s.enabled ? '' : ' · marcações online desligadas'}`;
    // tiras de dias
    const chips = [['next','Próximas', adm.list.filter(b=> b.day >= t && active(b)).length]];
    for(let i = 0, n = 0; i < 21 && n < 12; i++){
      const ds = A.addDays(t, i); const h = s.hours[String(A.isoDow(ds))];
      const c = adm.list.filter(b=> b.day === ds && active(b)).length;
      if(!Array.isArray(h) && !c) continue; n++;
      chips.push([ds, relDay(ds) || dayMed(ds), c]);
    }
    chips.push(['past','Histórico', 0]);
    $('#ag-a-days').innerHTML = chips.map(([k,l,c])=>`<button class="${adm.view===k?'on':''}" data-agv="${k}">${esc(l)}${c?`<em>${c}</em>`:''}</button>`).join('');
    // lista
    let list;
    if(adm.view === 'next') list = adm.list.filter(b=> b.day >= t && active(b));
    else if(adm.view === 'past') list = adm.list.filter(b=> b.day < t || !active(b)).sort((a,b)=> (b.day+b.slot).localeCompare(a.day+a.slot));
    else list = adm.list.filter(b=> b.day === adm.view).sort((a,b)=> a.slot.localeCompare(b.slot));
    const el = $('#ag-a-list');
    if(!list.length){ el.innerHTML = `<div class="empty-inline">${adm.view === 'past' ? 'Sem marcações anteriores.' : 'Sem marcações.'}</div>`; return; }
    let html = '', last = null;
    list.forEach(b=>{
      if(adm.view !== 'next' && adm.view !== 'past'){}
      else if(b.day !== last){ last = b.day; html += `<div class="ag-a-dh">${esc(relDay(b.day) ? relDay(b.day) + ' · ' : '')}${esc(cap1(dayLong(b.day)))}</div>`; }
      html += `<div class="list-row ag-a-row ${active(b)?'':'off'}" data-agid="${b.id}">
        <div class="ag-a-time"><b>${esc(b.slot)}</b><span>${esc(dayMed(b.day))}</span></div>
        <div class="ag-a-main"><div class="lr-name">${esc(b.name)}</div><div class="lr-sub">${esc(b.service_label || A.service(b.service).l)}${b.device ? ' · ' + esc(b.device) : ''}</div><div class="lr-sub">${esc(fmtPhone(b.phone))}${b.source === 'loja' ? ' · marcada na loja' : ''}</div></div>
        <div class="lr-right">${pillA(b.status)}</div>
      </div>`;
    });
    el.innerHTML = html;
  }

  function adminClick(e){
    const v = e.target.closest('[data-agv]'); if(v){ adm.view = v.dataset.agv; drawAdmin(); return; }
    const r = e.target.closest('[data-agid]'); if(r){ openDetail(Number(r.dataset.agid)); return; }
    const a = e.target.closest('[data-aga]'); if(!a) return;
    if(a.dataset.aga === 'new') openNew();
    if(a.dataset.aga === 'settings') openSettings();
  }

  const X = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const waLink = (phone, text)=> `https://wa.me/351${A.normPhone(phone)}?text=${encodeURIComponent(text)}`;

  function openDetail(id){
    const b = adm.list.find(x=> x.id === id); if(!b) return;
    const sv = A.service(b.service);
    const first = (b.name||'').split(' ')[0];
    const msgConfirm = `Olá ${first}! Confirmamos a tua marcação na Xtech Store: ${b.service_label || sv.l}${b.device ? ' (' + b.device + ')' : ''}, ${dayLong(b.day)} às ${b.slot}. Morada: Largo Dom Gualdim Pais 21, Amares. Até já!`;
    const msgReady = `Olá ${first}! O teu ${b.device || 'equipamento'} já está pronto na Xtech Store. Podes passar a levantar (seg–sex 9h30–19h, sáb 10h–13h).`;
    const rep = b.repair_id && typeof repairs !== 'undefined' ? repairs.find(r=> r.id === b.repair_id) : null;
    renderModal(`<div class="modal-box ag-modal" data-agm="${b.id}">
      <div class="modal-head"><div><h3>${esc(b.name)}</h3><p style="color:var(--muted);font-size:13px;margin:4px 0 0">${esc(b.number)} · ${pillA(b.status)}</p></div><button class="modal-close" onclick="closeModal()">${X}</button></div>
      <div class="ag-when"><div class="ag-cal"><span>${esc(monShort(b.day))}</span><b>${dnum(b.day)}</b></div><div><b>${esc(cap1(dayLong(b.day)))}</b><span>às ${esc(b.slot)}</span></div></div>
      <div class="ag-kv">
        <div><span>Serviço</span><b>${esc(b.service_label || sv.l)} <i>${esc(sv.p)}</i></b></div>
        ${b.device ? `<div><span>Equipamento</span><b>${esc(b.device)}</b></div>` : ''}
        ${b.issue ? `<div><span>Problema</span><b style="font-weight:500">${esc(b.issue)}</b></div>` : ''}
        <div><span>Telemóvel</span><b>${esc(fmtPhone(b.phone))}</b></div>
        ${b.email ? `<div><span>Email</span><b>${esc(b.email)}</b></div>` : ''}
        <div><span>Marcado</span><b style="font-weight:500">${b.source === 'loja' ? 'Na loja' : 'Pelo site'} · ${esc(new Date(b.created_at).toLocaleString('pt-PT', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }))}</b></div>
      </div>
      <div class="ag-contact">
        <a class="xs-btn sm" href="${waLink(b.phone, msgConfirm)}" target="_blank" rel="noopener">${ICON.wa} Confirmar por WhatsApp</a>
        <a class="xs-btn ghost sm" href="tel:+351${A.normPhone(b.phone)}">${ICON.phone} Ligar</a>
        <a class="xs-btn ghost sm" href="${waLink(b.phone, msgReady)}" target="_blank" rel="noopener">${ICON.wa} Avisar que está pronto</a>
      </div>
      <p class="ag-lab">Estado</p>
      <div class="ag-stbtns">${Object.keys(ST).map(k=>`<button class="${b.status===k?'on':''}" data-agst="${k}">${ST[k].a}</button>`).join('')}</div>
      <p class="ag-lab">Mudar dia ou hora</p>
      <div class="form-grid"><div class="field" style="margin:0"><input type="date" id="ag-m-day" value="${b.day}"></div><div class="field" style="margin:0"><select id="ag-m-slot">${slotOptions(b.day, b.slot, b.id)}</select></div></div>
      <button class="btn btn-dark btn-sm" style="margin-top:10px" data-agdo="move">Guardar novo horário</button>
      <p class="ag-lab">Nota interna</p>
      <div class="field" style="margin:0"><textarea id="ag-m-note" rows="2" placeholder="Só a equipa vê">${esc(b.admin_note||'')}</textarea></div>
      <button class="btn btn-dark btn-sm" style="margin-top:10px" data-agdo="note">Guardar nota</button>
      <div class="ag-foot">
        ${rep ? `<button class="btn btn-red btn-block" data-agdo="openrep">Abrir ficha de reparação</button>` : `<button class="btn btn-red btn-block" data-agdo="repair">O cliente chegou — criar ficha de reparação</button>`}
        <button class="xs-link" style="color:#FF6961;margin-top:14px" data-agdo="del">Apagar marcação</button>
      </div>
    </div>`);
    const box = document.querySelector('.ag-modal');
    box.addEventListener('click', e=> detailClick(e, b));
    box.querySelector('#ag-m-day').addEventListener('change', e=>{ box.querySelector('#ag-m-slot').innerHTML = slotOptions(e.target.value, '', b.id); });
  }

  function slotOptions(ds, cur, ignoreId){
    if(!ds) return '';
    const all = A.slotsFor(ds, adm.settings).filter(t=> !A.settings(adm.settings).closed.includes(ds));
    const set = new Set(all); if(cur) set.add(cur);
    const cap = Math.max(1, Number(adm.settings.perSlot)||1);
    const list = [...set].sort();
    if(!list.length) return `<option value="">Loja fechada neste dia</option>`;
    return list.map(t=>{ const n = adm.list.filter(b=> b.id !== ignoreId && b.day === ds && b.slot === t && active(b)).length; return `<option value="${t}" ${t===cur?'selected':''}>${t}${n >= cap ? ' — ocupado' : ''}</option>`; }).join('');
  }

  async function saveB(b, patch, msg){
    try{ const x = await XDB.bookings.update(b.id, patch); Object.assign(b, x || patch); toast(msg || 'Guardado.'); updateBadge(); drawAdmin(); return true; }
    catch(e){ toast('Não foi possível guardar.'); return false; }
  }

  async function detailClick(e, b){
    const s = e.target.closest('[data-agst]');
    if(s){ const k = s.dataset.agst; if(k === b.status) return;
      await saveB(b, { status:k, history:[...(b.history||[]), { status:k, at:new Date().toISOString(), by:'loja' }] }, 'Estado: ' + ST[k].a);
      openDetail(b.id); return; }
    const d = e.target.closest('[data-agdo]'); if(!d) return;
    const act = d.dataset.agdo;
    if(act === 'note'){ await saveB(b, { admin_note: $('#ag-m-note').value.trim() }, 'Nota guardada.'); }
    if(act === 'move'){
      const day = $('#ag-m-day').value, slot = $('#ag-m-slot').value; if(!day || !slot){ toast('Escolhe o dia e a hora.'); return; }
      if(day === b.day && slot === b.slot) return;
      const cap = Math.max(1, Number(adm.settings.perSlot)||1);
      if(adm.list.filter(x=> x.id !== b.id && x.day === day && x.slot === slot && active(x)).length >= cap && !(await ask('Esse horário já está ocupado. Marcar mesmo assim?', 'Marcar'))) return;
      await saveB(b, { day, slot, history:[...(b.history||[]), { status:'remarcada', at:new Date().toISOString(), by:'loja', from:b.day + ' ' + b.slot }] }, 'Marcação mudada para ' + dayMed(day) + ' às ' + slot + '.');
      openDetail(b.id);
    }
    if(act === 'repair'){
      if(typeof repairs === 'undefined') return;
      const sv = A.service(b.service);
      const r = { id:uid(repairs), ficha:generateFichaCode(), customer:b.name, phone:fmtPhone(b.phone), device:b.device || '—', issue:[b.service_label || sv.l, b.issue].filter(Boolean).join(' — '),
        technician:'—', status:'Recebido', price:priceNum(sv.p), photosIn:[], photosOut:[], usedParts:[], date:A.now().date, booking:b.number };
      repairs.push(r); await saveRepairs();
      await saveB(b, { repair_id:r.id, status:'concluida', history:[...(b.history||[]), { status:'concluida', at:new Date().toISOString(), by:'loja' }] }, 'Ficha de reparação criada.');
      closeModal(); switchAdminTab('reparacoes'); if(typeof openRepairDetail === 'function') openRepairDetail(r.id);
    }
    if(act === 'openrep'){ closeModal(); switchAdminTab('reparacoes'); openRepairDetail(b.repair_id); }
    if(act === 'del'){
      if(!(await ask(`Apagar a marcação de ${b.name} (${dayMed(b.day)} às ${b.slot})? Não dá para desfazer.`, 'Apagar', true))) return;
      try{ await XDB.bookings.remove(b.id); adm.list = adm.list.filter(x=> x.id !== b.id); closeModal(); updateBadge(); drawAdmin(); toast('Marcação apagada.'); }catch(err){ toast('Não foi possível apagar.'); }
    }
  }

  function openNew(){
    const t = A.now().date;
    renderModal(`<div class="modal-box ag-modal">
      <div class="modal-head"><h3>Nova marcação</h3><button class="modal-close" onclick="closeModal()">${X}</button></div>
      <p style="color:var(--muted);font-size:13px;margin:-6px 0 16px">Para quem liga ou passa na loja. Fica logo como confirmada.</p>
      <div class="field"><label>SERVIÇO</label><select id="ag-n-svc">${A.SERVICES.map(s=>`<option value="${s.k}">${esc(s.l)} — ${esc(s.p)}</option>`).join('')}</select></div>
      <div class="form-grid"><div class="field"><label>CLIENTE</label><input id="ag-n-name" placeholder="Nome"></div><div class="field"><label>TELEMÓVEL</label><input id="ag-n-phone" type="tel" placeholder="9xxxxxxxx"></div></div>
      <div class="form-grid"><div class="field"><label>EQUIPAMENTO</label><input id="ag-n-dev" placeholder="iPhone 13"></div><div class="field"><label>EMAIL <span style="font-weight:400;text-transform:none;color:var(--muted-2)">— opcional</span></label><input id="ag-n-email" type="email" placeholder="para receber a confirmação"></div></div>
      <div class="field"><label>PROBLEMA</label><input id="ag-n-issue" placeholder="Opcional"></div>
      <div class="form-grid"><div class="field"><label>DIA</label><input id="ag-n-day" type="date" value="${t}"></div><div class="field"><label>HORA</label><select id="ag-n-slot">${slotOptions(t, '', null)}</select></div></div>
      <button class="btn btn-red btn-block" id="ag-n-go">Guardar marcação</button>
    </div>`);
    $('#ag-n-day').addEventListener('change', e=>{ $('#ag-n-slot').innerHTML = slotOptions(e.target.value, '', null); });
    $('#ag-n-go').addEventListener('click', async ()=>{
      const name = $('#ag-n-name').value.trim(), day = $('#ag-n-day').value, slot = $('#ag-n-slot').value, phone = A.normPhone($('#ag-n-phone').value);
      if(!name || !day || !slot){ toast('Preenche o cliente, o dia e a hora.'); return; }
      if(phone && !/^[239]\d{8}$/.test(phone)){ toast('O telemóvel deve ter 9 dígitos.'); return; }
      const em = $('#ag-n-email').value.trim(); if(em && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)){ toast('O email não parece válido.'); return; }
      const cap = Math.max(1, Number(adm.settings.perSlot)||1);
      if(adm.list.filter(x=> x.day === day && x.slot === slot && active(x)).length >= cap && !(await ask('Esse horário já está ocupado. Marcar mesmo assim?', 'Marcar'))) return;
      const sv = A.service($('#ag-n-svc').value);
      try{
        const x = await XDB.bookings.add({ service:sv.k, service_label:sv.l, device:$('#ag-n-dev').value.trim(), issue:$('#ag-n-issue').value.trim(), day, slot, name, phone, email:$('#ag-n-email').value.trim().toLowerCase(),
          status:'confirmada', source:'loja', history:[{ status:'confirmada', at:new Date().toISOString(), by:'loja' }] });
        if(x) adm.list.push(x);
        closeModal(); adm.view = day; await loadAdmin(); drawAdmin(); toast('Marcação guardada.');
      }catch(e){ toast('Não foi possível guardar.'); }
    });
  }

  function openSettings(){
    const s = A.settings(adm.settings);
    const names = ['','Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'];
    const opt = (list, cur)=> list.map(([v,l])=>`<option value="${v}" ${String(v)===String(cur)?'selected':''}>${l}</option>`).join('');
    let closed = [...s.closed].sort();
    const drawClosed = ()=> { $('#ag-s-closed').innerHTML = closed.length ? closed.map(d=>`<span class="ag-tag">${esc(dayMed(d))} ${d.slice(0,4)}<button data-agrm="${d}" aria-label="Remover">×</button></span>`).join('') : `<span style="color:var(--muted);font-size:13px">Nenhum.</span>`; };
    renderModal(`<div class="modal-box ag-modal wide">
      <div class="modal-head"><h3>Definições das marcações</h3><button class="modal-close" onclick="closeModal()">${X}</button></div>
      <label class="ag-switch"><input type="checkbox" id="ag-s-on" ${s.enabled?'checked':''}><span></span>Aceitar marcações pelo site</label>
      <div class="form-grid" style="margin-top:14px">
        <div class="field"><label>CLIENTES POR HORÁRIO</label><select id="ag-s-cap">${opt([[1,'1 de cada vez'],[2,'2'],[3,'3'],[4,'4']], s.perSlot)}</select></div>
        <div class="field"><label>INTERVALO ENTRE HORÁRIOS</label><select id="ag-s-step">${opt([[15,'15 min'],[20,'20 min'],[30,'30 min'],[45,'45 min'],[60,'1 hora']], s.slotMin)}</select></div>
        <div class="field"><label>ANTECEDÊNCIA MÍNIMA</label><select id="ag-s-notice">${opt([[0,'Nenhuma'],[30,'30 min'],[60,'1 hora'],[120,'2 horas'],[240,'4 horas'],[1440,'1 dia']], s.noticeMin)}</select></div>
        <div class="field"><label>MARCAR ATÉ</label><select id="ag-s-max">${opt([[7,'1 semana'],[14,'2 semanas'],[30,'1 mês'],[60,'2 meses']], s.maxDays)}</select></div>
      </div>
      <p class="ag-lab">Horário</p>
      <div class="ag-hours">${[1,2,3,4,5,6,7].map(d=>{ const h = s.hours[String(d)]; const on = Array.isArray(h);
        return `<div class="ag-hrow" data-d="${d}"><label><input type="checkbox" class="hon" ${on?'checked':''}> ${names[d]}</label>
          <input type="time" class="h0" value="${on?h[0]:'09:30'}" step="900"><span>–</span><input type="time" class="h1" value="${on?h[1]:'19:00'}" step="900">
          <em>pausa</em><input type="time" class="h2" value="${on&&h[2]?h[2]:''}" step="900"><span>–</span><input type="time" class="h3" value="${on&&h[3]?h[3]:''}" step="900"></div>`; }).join('')}</div>
      <p class="ag-lab">Dias fechados (feriados, férias)</p>
      <div class="xs-row" style="gap:8px"><div class="field" style="margin:0;flex:1"><input type="date" id="ag-s-date" min="${A.now().date}"></div><button class="btn btn-dark btn-sm" id="ag-s-add">Adicionar</button></div>
      <div id="ag-s-closed" class="ag-tags"></div>
      <button class="btn btn-red btn-block" id="ag-s-save" style="margin-top:18px">Guardar definições</button>
    </div>`);
    drawClosed();
    $('#ag-s-add').addEventListener('click', ()=>{ const v = $('#ag-s-date').value; if(v && !closed.includes(v)){ closed.push(v); closed.sort(); drawClosed(); } });
    $('#ag-s-closed').addEventListener('click', e=>{ const b = e.target.closest('[data-agrm]'); if(b){ closed = closed.filter(d=> d !== b.dataset.agrm); drawClosed(); } });
    $('#ag-s-save').addEventListener('click', async ()=>{
      const hours = {};
      for(const row of $$('.ag-hrow')){
        const d = row.dataset.d; if(!row.querySelector('.hon').checked){ hours[d] = null; continue; }
        const h0 = row.querySelector('.h0').value, h1 = row.querySelector('.h1').value, h2 = row.querySelector('.h2').value, h3 = row.querySelector('.h3').value;
        if(!h0 || !h1 || A.toMin(h1) <= A.toMin(h0)){ toast('Confere o horário de ' + names[d] + '.'); return; }
        hours[d] = (h2 && h3 && A.toMin(h3) > A.toMin(h2)) ? [h0, h1, h2, h3] : [h0, h1];
      }
      const today = A.now().date;
      const ns = { enabled:$('#ag-s-on').checked, perSlot:+$('#ag-s-cap').value, slotMin:+$('#ag-s-step').value, noticeMin:+$('#ag-s-notice').value, maxDays:+$('#ag-s-max').value, hours, closed: closed.filter(d=> d >= today) };
      try{ await storeSet('agendaSettings', ns); adm.settings = A.settings(ns); closeModal(); drawAdmin(); toast('Definições guardadas.'); }
      catch(e){ toast('Não foi possível guardar.'); }
    });
  }

  // ---- calendário e início do admin ----
  function calDots(){
    if(!adm.loaded) return;
    $$('#cal-grid .cal-day').forEach(c=>{
      const m = (c.getAttribute('onclick')||'').match(/'(\d{4}-\d{2}-\d{2})'/); if(!m) return;
      const n = adm.list.filter(b=> b.day === m[1] && active(b)).length;
      const dots = c.querySelector('.dots'); if(n && dots && !dots.querySelector('.ag')) dots.insertAdjacentHTML('afterbegin', `<span class="dot ag" title="${n} marcação(ões)"></span>`);
    });
  }
  function dayModalBookings(ds){
    if(!adm.loaded) return;
    const box = document.querySelector('#modal-root .modal-box'); if(!box) return;
    const list = adm.list.filter(b=> b.day === ds && active(b)).sort((a,b)=> a.slot.localeCompare(b.slot));
    const head = box.querySelector('.modal-head');
    head.insertAdjacentHTML('afterend', `<p style="color:var(--muted); font-size:12px; font-weight:700; text-transform:uppercase; margin:0 0 8px;">Marcações</p>
      ${list.length ? list.map(b=>`<div class="list-row" data-agday="${b.id}"><div><div class="lr-name">${esc(b.slot)} · ${esc(b.name)}</div><div class="lr-sub">${esc(b.service_label || '')}${b.device ? ' · ' + esc(b.device) : ''}</div></div><div class="lr-right">${pillA(b.status)}</div></div>`).join('') : `<div class="empty-inline" style="padding:14px 0">Sem marcações nesta data.</div>`}
      <div style="height:16px"></div>`);
    box.addEventListener('click', e=>{ const r = e.target.closest('[data-agday]'); if(r){ closeModal(); switchAdminTab('agenda'); openDetail(Number(r.dataset.agday)); } });
  }
  function dashStrip(){
    const host = document.getElementById('alert-cards'); if(!host || !adm.loaded) return;
    let el = document.getElementById('ag-dash'); if(!el){ host.insertAdjacentHTML('beforebegin', '<div id="ag-dash"></div>'); el = document.getElementById('ag-dash'); }
    const t = A.now().date, now = A.now().min;
    const today = adm.list.filter(b=> b.day === t && active(b)).sort((a,b)=> a.slot.localeCompare(b.slot));
    const next = today.find(b=> A.toMin(b.slot) + 30 >= now);
    el.innerHTML = `<button class="ag-dash" onclick="switchAdminTab('agenda')">${ICON.cal}<div><b>${today.length ? today.length + (today.length === 1 ? ' marcação hoje' : ' marcações hoje') : 'Sem marcações hoje'}</b><span>${next ? `A seguir: ${esc(next.slot)} · ${esc(next.name)} · ${esc(next.service_label || '')}` : 'Ver todas as marcações'}</span></div><i>›</i></button>`;
  }

  /* =====================================================================
     ARRANQUE
     ===================================================================== */
  async function start(){
    await XDB.ready;
    ensurePage(); decorateSite(); mountAdmin();
    const orig = window.showPage;
    window.showPage = function(name){
      orig.apply(this, arguments);
      if(name === 'marcar'){ renderPage(); document.querySelectorAll('nav.links a').forEach(a=> a.classList.toggle('nav-active', /reparaç/i.test(a.textContent))); }
      else if(location.hash === '#marcar') history.replaceState(null, '', location.pathname + location.search);
      if(name === 'reparacoes') decorateSite();
    };
    XDB.on('bookings', async p=>{
      if(adm.loaded){
        await loadAdmin();
        if($('#tab-agenda') && $('#tab-agenda').style.display === 'block') drawAdmin();
        if(p && p.eventType === 'INSERT' && p.new && isAdminOpen() && p.new.source !== 'loja') toast(`Nova marcação: ${p.new.name} — ${dayMed(p.new.day)} às ${p.new.slot}`);
      }
    });
    XDB.on('auth', ()=>{ st.filledFor = null; adm.loaded = false; });
    // ao entrar no painel, carrega logo as marcações (para o calendário e o início)
    const shell = document.getElementById('admin-shell');
    if(shell) new MutationObserver(()=>{ if(isAdminOpen() && !adm.loaded) loadAdmin().then(()=>{ calDots(); dashStrip(); }); }).observe(shell, { attributes:true, attributeFilter:['style'] });
    if(location.hash === '#marcar') open();
    window.addEventListener('hashchange', ()=>{ if(location.hash === '#marcar') open(); });
  }

  window.Agenda = { open, fillMine, _st:st, _adm:adm };
  start();
})();
