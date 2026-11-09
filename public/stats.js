/* =====================================================================
   XTECH STORE — estatísticas do site (para a aba "Estatísticas" do painel)
   Anónimo: sem cookies e sem guardar o IP. Cada browser recebe um código
   aleatório (só serve para saber se a pessoa já cá tinha vindo).
   Regista: páginas, produtos vistos, carrinho, checkout, encomendas,
   marcações, orçamentos, scroll, cliques importantes e quanto tempo
   a pessoa fica (um sinal a cada 15 s enquanto o site está à frente).
   Para este aparelho deixar de contar: abrir o site com ?naocontar=1
   (os aparelhos onde a equipa entra no painel deixam de contar sozinhos).
   ===================================================================== */
(function(){
  const CFG = window.XTECH_CONFIG || {};
  if(!CFG.live) return;
  if(navigator.webdriver) return;

  const LS = {
    get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
    set(k, v){ try{ localStorage.setItem(k, v); }catch(e){} },
  };
  const SS = {
    get(k){ try{ return sessionStorage.getItem(k); }catch(e){ return null; } },
    set(k, v){ try{ sessionStorage.setItem(k, v); }catch(e){} },
  };
  const rid = ()=> Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  try{
    const u = new URL(location.href);
    if(u.searchParams.has('naocontar')){ LS.set('xt_notrack', u.searchParams.get('naocontar') === '0' ? '' : '1'); }
  }catch(e){}
  const off = ()=> LS.get('xt_notrack') === '1';

  // visitante (fica no browser) e visita (só enquanto o separador está aberto)
  let vid = LS.get('xt_vid'), isNew = false;
  if(!vid){ vid = rid(); isNew = true; LS.set('xt_vid', vid); }
  let sid = SS.get('xt_sid'); const newSession = !sid;
  if(!sid){ sid = rid(); SS.set('xt_sid', sid); }

  // de onde veio (as apps do Instagram/TikTok/Facebook não dizem — vê-se pelo browser delas)
  function source(){
    try{
      const u = new URL(location.href);
      const utm = u.searchParams.get('utm_source') || u.searchParams.get('ref') || u.searchParams.get('src');
      if(utm) return utm.toLowerCase().slice(0, 40);
      if(u.searchParams.has('fbclid')) return 'facebook';
      if(u.searchParams.has('gclid')) return 'google';
      if(u.searchParams.has('ttclid')) return 'tiktok';
    }catch(e){}
    const ua = navigator.userAgent || '';
    if(/Instagram/i.test(ua)) return 'instagram';
    if(/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) return 'facebook';
    if(/musical_ly|TikTok|BytedanceWebview|trill/i.test(ua)) return 'tiktok';
    if(/WhatsApp/i.test(ua)) return 'whatsapp';
    return document.referrer || '';
  }

  /* ---------- envio ---------- */
  const queue = []; let timer = null;
  const inAdmin = ()=>{ const a = document.getElementById('admin-view'); return !!(a && a.style.display === 'block'); };
  function send(beacon){
    clearTimeout(timer); timer = null;
    if(off()){ queue.length = 0; return; }
    const events = queue.splice(0, 25);
    const body = JSON.stringify({ op:'track', sid, vid, events, p: current });
    if(navigator.sendBeacon){ try{ if(navigator.sendBeacon('/api/data', new Blob([body], { type:'application/json' }))){ if(queue.length) timer = setTimeout(send, 300); return; } }catch(e){} }
    fetch('/api/data', { method:'POST', credentials:'same-origin', keepalive:true, headers:{ 'Content-Type':'application/json' }, body }).catch(()=>{});
    if(queue.length) timer = setTimeout(send, 300);
  }
  function ev(k, data){
    if(inAdmin() || off()) return;
    queue.push(Object.assign({ k, p: current }, data || {}));
    clearTimeout(timer); timer = setTimeout(send, 250);   // quase logo (junta o que acontece ao mesmo tempo)
  }
  addEventListener('pagehide', ()=> send(true));

  /* ---------- "ainda está no site": sinal a cada 15 s enquanto o site está visível ---------- */
  let beat = null;
  function heartbeat(){ if(document.visibilityState === 'visible' && !inAdmin() && !off()) send(); }
  function startBeat(){ clearInterval(beat); beat = setInterval(heartbeat, 15000); }
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState === 'hidden'){ clearInterval(beat); send(true); }
    else { heartbeat(); startBeat(); }
  });

  /* ---------- páginas ---------- */
  let current = 'home';
  let firstPage = newSession;
  function pageView(name, first){
    current = name; reached = 0; if(!first) quietUntil = Date.now() + 1500;
    const d = {};
    if(firstPage){ firstPage = false; const s = source(); if(s) d.r = s; if(isNew) d.l = 'novo'; }
    ev('page', d);
    if(name === 'checkout') ev('checkout');
  }

  /* ---------- produtos ---------- */
  function itemName(type, it){
    if(!it) return '';
    return type === 'device' ? [it.brand, it.model, it.storage, it.color].filter(Boolean).join(' ') : (it.name || '');
  }
  const lastSeen = {};
  function product(kind, type, id, it, name){
    const key = kind + type + id;
    if(lastSeen[key] && Date.now() - lastSeen[key] < 15000) return;   // o mesmo produto aberto duas vezes seguidas conta 1
    lastSeen[key] = Date.now();
    if(!it && typeof findCatalogItem === 'function'){ try{ it = findCatalogItem(type, id); }catch(e){} }
    ev(kind, { i: type + ':' + id, l: itemName(type, it) || name || '' });
  }

  /* ---------- scroll: até onde as pessoas descem em cada página ---------- */
  // ao mudar de página o site volta ao topo (às vezes com animação): esse scroll não conta
  let reached = 0, quietUntil = 0;
  function onScroll(){
    if(inAdmin() || Date.now() < quietUntil) return;
    const doc = document.documentElement;
    const max = doc.scrollHeight - innerHeight;
    if(max < 200) return;                           // página curta: não conta
    const atEnd = scrollY + innerHeight >= doc.scrollHeight - 120;
    const pct = atEnd ? 100 : Math.min(100, (scrollY / max) * 100);
    for(const s of [25, 50, 75, 100]){
      if(s > reached && pct >= s){ reached = s; ev('scroll', { l: String(s) }); }
    }
  }
  let sT = null; addEventListener('scroll', ()=>{ if(!sT) sT = setTimeout(()=>{ sT = null; onScroll(); }, 400); }, { passive:true });

  /* ---------- cliques importantes ---------- */
  document.addEventListener('click', (e)=>{
    const a = e.target.closest && e.target.closest('a[href]'); if(!a) return;
    const h = a.getAttribute('href') || '';
    let l = null;
    if(h.startsWith('tel:')) l = 'Ligar para a loja';
    else if(h.startsWith('mailto:')) l = 'Enviar email';
    else if(/instagram\.com/.test(h)) l = 'Instagram';
    else if(/tiktok\.com/.test(h)) l = 'TikTok';
    else if(/wa\.me|whatsapp/.test(h)) l = 'WhatsApp';
    else if(/google\.[a-z.]+\/maps|maps\.app|goo\.gl\/maps/.test(h)) l = 'Ver no mapa';
    if(l) ev('click', { l });
  }, true);

  /* ---------- ligar às funções do site ---------- */
  function hook(){
    const sp = window.showPage;
    if(sp && !sp._xs){ const f = function(name){ const r = sp.apply(this, arguments); try{ pageView(String(name || 'home')); }catch(e){} return r; }; f._xs = 1; window.showPage = f; }
    const op = window.openProductDetail;
    if(op && !op._xs){ const f = function(type, id){ const r = op.apply(this, arguments); try{ product('product', type, id); }catch(e){} return r; }; f._xs = 1; window.openProductDetail = f; }
    const ag = window.Agenda;
    if(ag && ag.open && !ag.open._xs){ const o = ag.open; ag.open = function(){ try{ ev('click', { l:'Abrir marcação de reparação' }); }catch(e){} return o.apply(this, arguments); }; ag.open._xs = 1; }
    const db = window.XDB;
    if(db){
      const wrap = (obj, fn, after)=>{ if(!obj || !obj[fn] || obj[fn]._xs) return; const o = obj[fn]; obj[fn] = async function(){ const r = await o.apply(this, arguments); try{ after(r, arguments); }catch(e){} return r; }; obj[fn]._xs = 1; };
      wrap(db.orders, 'create', (r, args)=>{ const o = r && r.order; if(args[0] && args[0].retryOrderId) return; ev('order', { l: (o && o.number ? o.number + ' · ' : '') + (o && o.total != null ? Number(o.total).toFixed(2) + ' €' : '') }); send(); });
      wrap(db.bookings, 'create', (r, args)=>{ const b = args[0] || {}; ev('booking', { l: b.service_label || b.service || '' }); send(); });
      wrap(db.inbox, 'submit', (r, args)=>{ const p = args[1] || {}; ev('quote', { l: String(p.device || '').slice(0, 80) }); send(); });
      // quem entra no painel da loja neste aparelho deixa de contar nas estatísticas
      if(db.isStaff){ db.isStaff().then(s=>{ if(s){ LS.set('xt_notrack', '1'); queue.length = 0; } }).catch(()=>{}); }
    }
  }

  window.XStats = { ev, product, page: pageView };
  function start(){
    hook();
    const open = [...document.querySelectorAll('.site-page')].find(el=> !el.classList.contains('hide'));
    const name = open ? (open.id === 'account-page' ? 'account' : open.id.replace(/^page-/, '')) : 'home';
    pageView(name, true);
    if(location.hash === '#marcar') ev('click', { l:'Abrir marcação de reparação' });
    startBeat();
  }
  if(document.readyState !== 'loading') setTimeout(start, 0); else document.addEventListener('DOMContentLoaded', ()=> setTimeout(start, 0));
})();
