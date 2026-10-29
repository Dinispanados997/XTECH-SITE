/* =====================================================================
   XTECH STORE — CAMADA DE DADOS
   - Modo "live": base de dados Supabase partilhada (clientes + admin veem o mesmo)
   - Modo "demo": sem configuração, tudo fica neste browser (para testar)
   Tem de carregar ANTES do script principal do site.
   ===================================================================== */
(function(){
  const CFG = window.XTECH_CONFIG || {};
  const LIVE = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
  const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';

  /* ---------------- preços (igual ao servidor: netlify/lib/pricing.mjs) ---------------- */
  const XPricing = {
    optionGroups(item, type){
      const v = item.variants || {}; const G = [];
      const add = (key, base, list)=>{
        const opts = [];
        const hasZero = (list||[]).some(o=> o && o.name && Number(o.delta) === 0);
        if(hasZero && key === 'cond') base = '';
        if(base && !(list||[]).some(o=> o && o.name && o.name.toLowerCase() === String(base).toLowerCase())) opts.push({name:String(base), delta:0});
        (list||[]).forEach(o=>{ if(o && o.name && !opts.some(x=>x.name.toLowerCase()===o.name.toLowerCase())) opts.push({name:o.name, delta:Number(o.delta)||0}); });
        if(opts.length){ const d = Math.max(0, opts.findIndex(o=> Number(o.delta) === 0)); G.push({key, opts, def:d}); }
      };
      if(type === 'device'){
        add('cond', item.cond, v.cond);
        add('battery', item.battery ? `Saúde da bateria ${item.battery}%` : '', v.battery);
        add('storage', item.storage, v.storage);
      }
      add('color', item.color, v.color);
      return G;
    },
    itemName(item, type){ return type === 'device' ? `${item.brand||''} ${item.model||''}`.trim() : (item.name||''); },
    priceFor(item, type, opts){
      opts = opts || {}; let p = Number(item.price)||0; const chosen = [];
      for(const g of XPricing.optionGroups(item, type)){
        const want = opts[g.key]; let o = g.opts[g.def];
        if(want != null && want !== ''){
          o = g.opts.find(x=> x.name.toLowerCase() === String(want).toLowerCase());
          if(!o) throw new Error(`A opção "${want}" já não está disponível para ${XPricing.itemName(item, type)}.`);
        }
        p += Number(o.delta)||0; chosen.push({key:g.key, name:o.name});
      }
      return {unit: Math.round(p*100)/100, chosen};
    },
    shippingFor(settings, method, subtotal){
      const s = settings || {}; if(method !== 'ship') return 0;
      const fee = s.shipFee != null && s.shipFee !== '' ? Number(s.shipFee) : 4.9;
      const free = Number(s.freeShipFrom)||0;
      if(free > 0 && subtotal >= free) return 0;
      return Math.round(fee*100)/100;
    }
  };
  window.XPricing = XPricing;

  /* ---------------- marcações (regras iguais às do servidor: supabase/schema.sql → book_service) ---------------- */
  const XAgenda = {
    SERVICES: [
      { k:'diagnostico', l:'Diagnóstico gratuito',   d:'Não sabes o que tem? Vemos contigo, sem compromisso.',          p:'Grátis',     t:'cerca de 15 min' },
      { k:'ecra',        l:'Ecrã partido',           d:'Substituição com peças originais ou compatíveis premium.',      p:'49€',        t:'cerca de 40 min' },
      { k:'bateria',     l:'Bateria',                d:'Recupera a autonomia do primeiro dia.',                         p:'desde 39€',  t:'cerca de 25 min' },
      { k:'camara',      l:'Câmara e sensores',      d:'Câmaras, Face ID e sensores de proximidade.',                   p:'39€',        t:'cerca de 35 min' },
      { k:'conector',    l:'Conector de carga',      d:'Quando deixa de carregar ou só carrega na posição certa.',      p:'34€',        t:'cerca de 30 min' },
      { k:'software',    l:'Software e desbloqueio', d:'Atualizações, recuperação de dados e problemas de arranque.',   p:'19€',        t:'cerca de 20 min' },
      { k:'placa',       l:'Placa lógica',           d:'Danos por líquidos e curto-circuitos, ao micro.',               p:'desde 79€',  t:'1 a 3 dias' },
      { k:'outro',       l:'Outro problema',         d:'Tampa traseira, botões, som, água… avaliamos na hora.',         p:'Orçamento',  t:'após diagnóstico' },
    ],
    // horário por dia da semana (1 = segunda … 7 = domingo); null = fechado; 3.º e 4.º valores = pausa (opcional)
    DEFAULTS: { enabled:true, slotMin:30, perSlot:1, noticeMin:60, maxDays:30, closed:[],
      hours:{ '1':['09:30','19:00'], '2':['09:30','19:00'], '3':['09:30','19:00'], '4':['09:30','19:00'], '5':['09:30','19:00'], '6':['10:00','13:00'], '7':null } },
    ACTIVE: ['pendente','confirmada'],
    service(k){ return XAgenda.SERVICES.find(s=>s.k===k) || XAgenda.SERVICES[XAgenda.SERVICES.length-1]; },
    settings(s){ s = s || {}; const d = XAgenda.DEFAULTS; return { ...d, ...s, hours:{ ...d.hours, ...(s.hours||{}) }, closed: Array.isArray(s.closed) ? s.closed : [] }; },
    toMin(hm){ const [h,m] = String(hm||'').split(':').map(Number); return (h||0)*60 + (m||0); },
    fromMin(n){ return String(Math.floor(n/60)).padStart(2,'0') + ':' + String(n%60).padStart(2,'0'); },
    isoDow(ds){ const [y,m,d] = ds.split('-').map(Number); const w = new Date(Date.UTC(y,m-1,d)).getUTCDay(); return w === 0 ? 7 : w; },
    addDays(ds, n){ const [y,m,d] = ds.split('-').map(Number); const t = new Date(Date.UTC(y,m-1,d+n)); return t.toISOString().slice(0,10); },
    // hora de Portugal, seja qual for o fuso do aparelho
    now(){
      const p = {}; new Intl.DateTimeFormat('en-GB', { timeZone:'Europe/Lisbon', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' })
        .formatToParts(new Date()).forEach(x=> p[x.type] = x.value);
      return { date:`${p.year}-${p.month}-${p.day}`, min: Number(p.hour)*60 + Number(p.minute) };
    },
    slotsFor(ds, s){
      s = XAgenda.settings(s);
      if(s.closed.includes(ds)) return [];
      const h = s.hours[String(XAgenda.isoDow(ds))]; if(!Array.isArray(h) || h.length < 2) return [];
      const step = Number(s.slotMin)||30, open = XAgenda.toMin(h[0]), close = XAgenda.toMin(h[1]);
      const p0 = h[2] ? XAgenda.toMin(h[2]) : null, p1 = h[3] ? XAgenda.toMin(h[3]) : null;
      const out = [];
      for(let t = open; t + step <= close; t += step){ if(p0 != null && p1 != null && t + step > p0 && t < p1) continue; out.push(XAgenda.fromMin(t)); }
      return out;
    },
    // horários livres de um dia; busy = { 'AAAA-MM-DD HH:MM': n }
    freeSlots(ds, s, busy){
      s = XAgenda.settings(s); const now = XAgenda.now(); const cap = Math.max(1, Number(s.perSlot)||1);
      return XAgenda.slotsFor(ds, s).map(t=>{
        const past = ds < now.date || (ds === now.date && XAgenda.toMin(t) < now.min + (Number(s.noticeMin)||0));
        const full = ((busy||{})[ds + ' ' + t] || 0) >= cap;
        return { t, ok: !past && !full, past, full };
      });
    },
    normPhone(p){ let d = String(p||'').replace(/\D/g,''); if(/^(00)?351\d{9}$/.test(d)) d = d.slice(-9); return d; },
    validate(b, s){
      s = XAgenda.settings(s); const now = XAgenda.now();
      if(!s.enabled) return 'As marcações online estão desativadas de momento. Liga-nos: 923 512 686.';
      if(!XAgenda.SERVICES.some(x=>x.k===b.service)) return 'Escolhe o serviço.';
      if(!b.day || !/^\d{4}-\d{2}-\d{2}$/.test(b.day)) return 'Escolhe o dia.';
      if(!b.slot || !/^\d{2}:\d{2}$/.test(b.slot)) return 'Escolhe a hora.';
      const nm = String(b.name||'').trim(); if(nm.length < 2 || nm.length > 80) return 'Indica o teu nome.';
      if(!/^[239]\d{8}$/.test(XAgenda.normPhone(b.phone))) return 'Indica um número de telemóvel válido (9 dígitos).';
      if(!b.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) return 'Indica o teu email, para receberes a confirmação.';
      if(String(b.device||'').length > 80 || String(b.issue||'').length > 600) return 'Texto demasiado longo.';
      if(b.day < now.date || b.day > XAgenda.addDays(now.date, Number(s.maxDays)||30)) return `Escolhe uma data dentro dos próximos ${s.maxDays} dias.`;
      if(!XAgenda.slotsFor(b.day, s).includes(b.slot)) return 'Esse horário não está disponível.';
      if(b.day === now.date && XAgenda.toMin(b.slot) < now.min + (Number(s.noticeMin)||0)) return 'Esse horário já passou. Escolhe outro.';
      return '';
    },
  };
  window.XAgenda = XAgenda;

  const listeners = {};
  function emit(table, payload){ (listeners[table]||[]).forEach(cb=>{ try{ cb(payload); }catch(e){ console.warn(e); } }); }
  const nowIso = ()=> new Date().toISOString();

  /* =====================================================================
     MODO LIVE (Supabase)
     ===================================================================== */
  let sb = null, kvCache = {}, session = null, staffFlag = null;
  const PUBLIC_ARRAYS = ['devices','accessories','parts','repairs','ordersClients','ordersSuppliers','custRequests','custOrders','expenses','quoteRequests','tasks'];

  function loadScript(src){
    return new Promise((res, rej)=>{ const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = ()=> rej(new Error('Não foi possível carregar ' + src)); document.head.appendChild(s); });
  }

  async function liveInit(){
    if(!window.supabase) await loadScript(SUPABASE_JS);
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } });
    const { data } = await sb.auth.getSession();
    session = data.session;
    sb.auth.onAuthStateChange((event, s)=>{ session = s; staffFlag = null; emit('auth', {event, user: userOut()}); });
    await liveLoadKv();
  }
  async function liveLoadKv(){
    const { data, error } = await sb.from('kv').select('key,value');
    if(error){ console.warn('kv', error); return; }
    kvCache = {}; (data||[]).forEach(r=> kvCache[r.key] = r.value);
  }
  function userOut(){
    const u = session && session.user; if(!u) return null;
    const m = u.user_metadata || {};
    return { id:u.id, email:(u.email||'').toLowerCase(), name: m.name || (u.email||'').split('@')[0], meta:m };
  }

  // fotografias novas (data:image…) vão para o Storage e no JSON fica só o link
  async function shrink(dataUrl){
    try{
      const img = new Image(); img.src = dataUrl; await img.decode();
      const max = 1600, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth*k); c.height = Math.round(img.naturalHeight*k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const png = /^data:image\/png/.test(dataUrl);
      return await new Promise(r=> c.toBlob(r, png ? 'image/png' : 'image/jpeg', .86));
    }catch(e){ return await (await fetch(dataUrl)).blob(); }
  }
  async function sha1(str){ const b = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str)); return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join(''); }
  const uploaded = new Map();
  async function uploadPhotos(node){
    if(Array.isArray(node)){ for(let i=0;i<node.length;i++){ if(typeof node[i]==='string' && node[i].startsWith('data:image/') && node[i].length > 3000) node[i] = await uploadOne(node[i]); else if(node[i] && typeof node[i]==='object') await uploadPhotos(node[i]); } }
    else if(node && typeof node === 'object'){ for(const k of Object.keys(node)){ const v = node[k]; if(typeof v==='string' && v.startsWith('data:image/') && v.length > 3000) node[k] = await uploadOne(v); else if(v && typeof v==='object') await uploadPhotos(v); } }
  }
  async function uploadOne(dataUrl){
    if(uploaded.has(dataUrl)) return uploaded.get(dataUrl);
    const h = await sha1(dataUrl); const blob = await shrink(dataUrl);
    const ext = blob.type === 'image/png' ? 'png' : 'jpg';
    const path = `p/${h}.${ext}`;
    const { error } = await sb.storage.from('fotos').upload(path, blob, { contentType: blob.type, upsert: true, cacheControl:'31536000' });
    if(error){ console.warn('upload', error); return dataUrl; }
    const url = sb.storage.from('fotos').getPublicUrl(path).data.publicUrl;
    uploaded.set(dataUrl, url); return url;
  }

  // emails automáticos: o servidor decide que email falta e envia-o (ver netlify/functions/notify.mjs)
  function notify(kind, id){ if(!id) return; fetch('/.netlify/functions/notify', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ kind, id }), keepalive:true }).catch(()=>{}); }

  const live = {
    async kvGet(key){
      await XDB.ready;
      if(key === 'customerSession'){ const u = userOut(); return u ? {name:u.name, email:u.email, id:u.id} : null; }
      if(key in kvCache) return kvCache[key];
      return PUBLIC_ARRAYS.includes(key) ? [] : null;
    },
    async kvSet(key, value){
      await XDB.ready;
      if(key === 'customerSession') return;
      if(key === 'devices' || key === 'accessories') await uploadPhotos(value);
      kvCache[key] = value;
      const { error } = await sb.from('kv').upsert({ key, value }, { onConflict:'key' });
      if(error){ console.warn('kvSet', key, error); if(typeof toast === 'function') toast('Não foi possível guardar (' + key + '). Verifica a ligação.'); throw error; }
    },
    async kvReload(keys){ await liveLoadKv(); return keys ? keys.map(k=>kvCache[k]) : kvCache; },
    auth: {
      user: ()=> userOut(),
      async signUp(email, password, name){
        const { data, error } = await sb.auth.signUp({ email, password, options:{ data:{ name }, emailRedirectTo: location.origin + location.pathname } });
        if(error) throw error;
        return { user: userOut(), needsConfirm: !data.session };
      },
      async signIn(email, password){
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if(error) throw new Error(/invalid/i.test(error.message) ? 'Email ou palavra-passe incorretos.' : /confirm/i.test(error.message) ? 'Confirma primeiro o teu email (vê a caixa de entrada).' : error.message);
        return userOut();
      },
      async signOut(){ await sb.auth.signOut(); session = null; },
      async resetPassword(email){ const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); if(error) throw error; },
      // entrar com a conta Google (volta ao site já com sessão iniciada)
      async signInWithGoogle(){
        const { error } = await sb.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: location.origin + location.pathname, queryParams:{ prompt:'select_account' } } });
        if(error) throw new Error(/not enabled|provider/i.test(error.message) ? 'O login com Google ainda não está ativo. Usa o email por agora.' : error.message);
      },
      async verifyRecovery(token_hash){ const { error } = await sb.auth.verifyOtp({ token_hash, type:'recovery' }); if(error) throw new Error(/expired|invalid/i.test(error.message) ? 'Este link já expirou ou já foi usado. Pede um novo.' : error.message); session = (await sb.auth.getSession()).data.session; return userOut(); },
      async setPassword(password){ const { error } = await sb.auth.updateUser({ password }); if(error) throw error; },
      async updateMeta(meta){ const { data, error } = await sb.auth.updateUser({ data: meta }); if(error) throw error; session = (await sb.auth.getSession()).data.session; return userOut(); },
      token: ()=> session && session.access_token,
    },
    async isStaff(){
      if(!session) return false;
      if(staffFlag !== null) return staffFlag;
      const { data } = await sb.rpc('is_staff'); staffFlag = !!data; return staffFlag;
    },
    staff: {
      async add(email, name, role){ const { error } = await sb.from('staff').upsert({ email: email.toLowerCase(), name, role }); if(error) throw error; },
      async remove(email){ await sb.from('staff').delete().eq('email', email.toLowerCase()); },
    },
    orders: {
      async create(payload){
        const res = await fetch('/.netlify/functions/create-order', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + (session && session.access_token) }, body: JSON.stringify(payload) });
        const data = await res.json().catch(()=>({ error:'Resposta inválida do servidor.' }));
        if(!res.ok) throw new Error(data.error || 'Erro ao criar a encomenda.');
        return data;
      },
      async retry(id){ return live.orders.create({ retryOrderId: id }); },
      async mine(){ const u = userOut(); if(!u) return []; const { data } = await sb.from('orders').select('*').eq('user_id', u.id).order('created_at', { ascending:false }); return data || []; },
      async get(id){ const { data } = await sb.from('orders').select('*').eq('id', id).maybeSingle(); return data; },
      async all(){ const { data, error } = await sb.from('orders').select('*').order('created_at', { ascending:false }).limit(1000); if(error) console.warn(error); return data || []; },
      async update(id, patch){ const { data, error } = await sb.from('orders').update(patch).eq('id', id).select().maybeSingle(); if(error) throw error; notify('order', id); return data; },
      async cancelMine(id){ const { data, error } = await sb.rpc('cancel_my_order', { p_id: id }); if(error) throw new Error(error.message); notify('order', id); return data; },
    },
    returns: {
      async create(r){ const u = userOut(); const { data, error } = await sb.from('returns').insert({ ...r, user_id: u.id, email: u.email }).select().maybeSingle(); if(error) throw error; if(data) notify('return', data.id); return data; },
      async mine(){ const u = userOut(); if(!u) return []; const { data } = await sb.from('returns').select('*').eq('user_id', u.id).order('created_at', { ascending:false }); return data || []; },
      async all(){ const { data } = await sb.from('returns').select('*').order('created_at', { ascending:false }).limit(500); return data || []; },
      async update(id, patch){ const { data, error } = await sb.from('returns').update(patch).eq('id', id).select().maybeSingle(); if(error) throw error; notify('return', id); return data; },
    },
    inbox: {
      async submit(kind, payload){ const u = userOut(); const { error } = await sb.from('inbox').insert({ kind, payload, email: (payload.email || (u && u.email) || '').toLowerCase() || null, user_id: u ? u.id : null }); if(error) throw error; },
      async mine(){ const u = userOut(); if(!u) return []; const { data } = await sb.from('inbox').select('*').order('created_at', { ascending:false }).limit(200); return (data || []).filter(r=> r.user_id === u.id || (r.email||'').toLowerCase() === u.email); },
      async pending(){ const { data } = await sb.from('inbox').select('*').eq('imported', false).order('created_at'); return data || []; },
      async update(id, patch){ await sb.from('inbox').update(patch).eq('id', id); },
    },
    bookings: {
      // só devolve dia/hora/quantidade — nunca dados de outros clientes
      async busy(from, to){ const { data, error } = await sb.rpc('booking_busy', { p_from: from, p_to: to }); if(error){ console.warn(error); return {}; } const m = {}; (data||[]).forEach(r=> m[r.day + ' ' + r.slot] = r.n); return m; },
      async create(b){ const { data, error } = await sb.rpc('book_service', { p: b }); if(error) throw new Error(error.message || 'Não foi possível marcar. Tenta de novo.'); if(data) notify('booking', data.id); return data; },
      async mine(){ const u = userOut(); if(!u) return []; const { data } = await sb.from('bookings').select('*').eq('user_id', u.id).order('day', { ascending:false }).order('slot', { ascending:false }); return data || []; },
      async cancelMine(id){ const { data, error } = await sb.rpc('cancel_my_booking', { p_id: id }); if(error) throw new Error(error.message); notify('booking', id); return data; },
      async all(){ const since = XAgenda.addDays(XAgenda.now().date, -90); const { data, error } = await sb.from('bookings').select('*').gte('day', since).order('day').order('slot').limit(3000); if(error) console.warn(error); return data || []; },
      async add(b){ const { data, error } = await sb.from('bookings').insert(b).select().maybeSingle(); if(error) throw error; if(data) notify('booking', data.id); return data; },
      async update(id, patch){ const { data, error } = await sb.from('bookings').update(patch).eq('id', id).select().maybeSingle(); if(error) throw error; notify('booking', id); return data; },
      async remove(id){ const { error } = await sb.from('bookings').delete().eq('id', id); if(error) throw error; },
    },
    on(table, cb){
      (listeners[table] = listeners[table] || []).push(cb);
      if(table === 'auth') return;
      sb.channel('rt-' + table + '-' + Math.random().toString(36).slice(2)).on('postgres_changes', { event:'*', schema:'public', table }, p=> cb(p)).subscribe();
    },
  };

  /* =====================================================================
     MODO DEMO (sem base de dados: guarda neste browser, pagamentos simulados)
     ===================================================================== */
  const dget = async k=> (await window.storeGet(k)) ;
  const dset = async (k, v)=> { await window.storeSet(k, v); emit(k.replace('demo_',''), {}); try{ localStorage.setItem('xtech_demo_ping', String(Date.now())); }catch(e){} };
  async function dlist(k){ return (await dget(k)) || []; }
  async function dsave(k, list){ await dset(k, list); }
  const nextId = list=> list.length ? Math.max(...list.map(x=>x.id)) + 1 : 1;
  let demoUser = null;

  // modo demonstração: em vez de enviar, regista o email e mostra uma pré-visualização
  function demoMail(kind, rec, ctx){
    if(!window.XEmails) return;
    rec.emails = rec.emails || [];
    const base = location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
    const out = [];
    window.XEmails.due[kind](rec, {}).forEach(ev=>{
      rec.emails.push({ k:ev.key, at:nowIso() }); (ev.also||[]).forEach(k=> rec.emails.push({ k, at:nowIso() }));
      const to = window.XEmails.recipient(ev, rec, 'xtechstorept@gmail.com'); if(!to) return;
      const m = window.XEmails.render(ev, rec, { siteUrl:base, ...(ctx||{}) });
      out.push({ to, subject:m.subject, html:m.html, shop: ev.to === 'loja' });
    });
    if(out.length) setTimeout(()=> window.XEmails.showDemo && window.XEmails.showDemo(out), 400);
  }

  async function demoApplyStock(o){
    if(o.stock_done) return;
    for(const [key, type] of [['devices','device'],['accessories','accessory']]){
      let list = await window.storeGet(key);
      if(!Array.isArray(list)) list = key === 'devices' ? (typeof devices !== 'undefined' ? devices : null) : (typeof accessories !== 'undefined' ? accessories : null);
      if(!Array.isArray(list)) continue; let ch = false;
      (o.items||[]).forEach(l=>{ if(l.type !== type) return; const it = list.find(x=>Number(x.id)===Number(l.id)); if(it && it.qty !== '' && it.qty != null && !isNaN(Number(it.qty))){ it.qty = Math.max(0, Number(it.qty) - (l.qty||1)); ch = true; } });
      if(ch) await window.storeSet(key, list);
    }
    o.stock_done = true;
  }

  const demo = {
    async kvGet(k){ return null; }, async kvSet(){}, async kvReload(){ return {}; },
    auth: {
      user: ()=> demoUser,
      async _load(){ demoUser = await dget('demo_session'); return demoUser; },
      async signUp(email, password, name){
        email = email.toLowerCase(); const users = await dlist('demo_users');
        if(users.some(u=>u.email===email)) throw new Error('Já existe uma conta com este email. Entra com a tua palavra-passe.');
        const u = { id:'demo-' + Date.now(), email, name, pass: password, meta:{ name } }; users.push(u); await dsave('demo_users', users);
        demoUser = { id:u.id, email, name, meta:u.meta }; await dset('demo_session', demoUser); emit('auth', { event:'SIGNED_IN', user:demoUser });
        return { user: demoUser, needsConfirm:false };
      },
      async signIn(email, password){
        email = email.toLowerCase(); const u = (await dlist('demo_users')).find(x=>x.email===email);
        if(!u || u.pass !== password) throw new Error('Email ou palavra-passe incorretos.');
        demoUser = { id:u.id, email, name:u.name, meta:u.meta||{} }; await dset('demo_session', demoUser); emit('auth', { event:'SIGNED_IN', user:demoUser }); return demoUser;
      },
      async signOut(){ demoUser = null; await dset('demo_session', null); emit('auth', { event:'SIGNED_OUT', user:null }); },
      async resetPassword(){ throw new Error('No modo demonstração não há envio de emails.'); },
      async signInWithGoogle(){ throw new Error('No modo demonstração o login com Google não funciona — no site real abre a janela da Google.'); },
      async setPassword(p){ const users = await dlist('demo_users'); const u = users.find(x=>x.id===demoUser.id); if(u){ u.pass = p; await dsave('demo_users', users); } },
      async updateMeta(meta){
        const users = await dlist('demo_users'); const u = users.find(x=>x.id===demoUser.id);
        if(u){ u.meta = { ...(u.meta||{}), ...meta }; if(meta.name) u.name = meta.name; await dsave('demo_users', users); }
        demoUser = { ...demoUser, meta:{ ...(demoUser.meta||{}), ...meta }, name: meta.name || demoUser.name }; await dset('demo_session', demoUser); return demoUser;
      },
      token: ()=> 'demo',
    },
    async isStaff(){ return true; },
    staff: { async add(){}, async remove(){} },
    orders: {
      async create(body){
        if(body.retryOrderId){ const o = (await dlist('demo_orders')).find(x=>x.id===body.retryOrderId); return { order:{ id:o.id, number:o.number }, demoPay:true }; }
        const u = demoUser; if(!u) throw new Error('Inicia sessão para finalizar a compra.');
        /* global devices, accessories */
        const devs = (await window.storeGet('devices')) || (typeof devices !== 'undefined' ? devices : []), accs = (await window.storeGet('accessories')) || (typeof accessories !== 'undefined' ? accessories : []);
        const settings = await window.storeGet('shopSettings');
        const items = (body.items||[]).map(l=>{
          const type = l.type === 'device' ? 'device' : 'accessory'; const it = (type==='device'?devs:accs).find(x=>Number(x.id)===Number(l.id));
          if(!it) throw new Error('Um dos produtos do carrinho já não está disponível.');
          const qty = Math.max(1, parseInt(l.qty,10)||1); const stock = it.qty===''||it.qty==null ? null : Number(it.qty);
          if(stock != null && !isNaN(stock) && stock < qty) throw new Error(stock<=0 ? `${XPricing.itemName(it,type)} esgotou entretanto.` : `Só temos ${stock} unid. de ${XPricing.itemName(it,type)}.`);
          const pr = XPricing.priceFor(it, type, l.opts||{}); const ph = (it.photos&&it.photos[0])||it.photo||'';
          return { type, id:it.id, name:XPricing.itemName(it,type), options:pr.chosen, qty, unit:pr.unit, total:Math.round(pr.unit*qty*100)/100, photo: ph.length < 400000 ? ph : '' };
        });
        if(!items.length) throw new Error('O carrinho está vazio.');
        const d = body.delivery||{}; const method = d.method==='ship' ? 'ship' : 'pickup';
        const subtotal = Math.round(items.reduce((s,x)=>s+x.total,0)*100)/100; const shipping = XPricing.shippingFor(settings, method, subtotal);
        const payInStore = body.payment==='loja' && method==='pickup'; const status = payInStore ? 'pagar_na_loja' : 'por_pagar';
        const list = await dlist('demo_orders'); const id = nextId(list);
        const o = { id, number:'XT-' + String(id).padStart(5,'0'), user_id:u.id, email:u.email, name:(body.customer||{}).name||u.name, phone:(body.customer||{}).phone||'', nif:(body.customer||{}).nif||'',
          items, subtotal, shipping, total:Math.round((subtotal+shipping)*100)/100, delivery: method==='ship' ? { method, address:d.address, zip:d.zip, city:d.city } : { method },
          payment_method: payInStore ? 'loja' : 'online', status, tracking:{}, notes: body.notes||'', history:[{status, at:nowIso()}], stock_done:false, created_at:nowIso(), updated_at:nowIso() };
        if(payInStore) await demoApplyStock(o);
        demoMail('order', o);
        list.push(o); await dsave('demo_orders', list); emit('orders', { eventType:'INSERT', new:o });
        return payInStore ? { order:{ id, number:o.number, status } } : { order:{ id, number:o.number, status }, demoPay:true };
      },
      async demoPay(id, method, ok){
        const list = await dlist('demo_orders'); const o = list.find(x=>x.id===id); if(!o) return;
        if(ok){ o.status = method === 'multibanco_pendente' ? 'por_pagar' : 'paga'; o.paid_with = method.replace('_pendente',''); if(o.status==='paga'){ o.history.push({status:'paga', at:nowIso(), by:'stripe'}); await demoApplyStock(o); } }
        o.updated_at = nowIso(); demoMail('order', o, method === 'multibanco_pendente' ? { mb:{ entity:'12345', reference:'123 456 789', expires:'daqui a 3 dias' } } : {});
        if(method === 'multibanco_pendente' && window.XEmails){ const ev = { key:'mb', to:'cliente', tpl:'order_mb' }; if(!(o.emails||[]).some(e=>e.k==='mb')){ o.emails.push({ k:'mb', at:nowIso() }); const m = window.XEmails.render(ev, o, { siteUrl:location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, ''), mb:{ entity:'12345', reference:'123 456 789', expires:'daqui a 3 dias' } }); setTimeout(()=> window.XEmails.showDemo([{ to:o.email, subject:m.subject, html:m.html }]), 400); } }
        await dsave('demo_orders', list); emit('orders', { eventType:'UPDATE', new:o });
      },
      async retry(id){ return demo.orders.create({ retryOrderId:id }); },
      async mine(){ if(!demoUser) return []; return (await dlist('demo_orders')).filter(o=>o.user_id===demoUser.id).sort((a,b)=>b.id-a.id); },
      async get(id){ return (await dlist('demo_orders')).find(o=>o.id===Number(id)) || null; },
      async all(){ return (await dlist('demo_orders')).sort((a,b)=>b.id-a.id); },
      async update(id, patch){ const list = await dlist('demo_orders'); const o = list.find(x=>x.id===id); Object.assign(o, patch, { updated_at:nowIso() }); demoMail('order', o); await dsave('demo_orders', list); emit('orders', { eventType:'UPDATE', new:o }); return o; },
      async cancelMine(id){ const list = await dlist('demo_orders'); const o = list.find(x=>x.id===id && demoUser && x.user_id===demoUser.id);
        if(!o || !['por_pagar','pagar_na_loja','pagamento_falhou'].includes(o.status)) throw new Error('Esta encomenda já não pode ser cancelada.');
        o.status = 'cancelada'; o.history.push({status:'cancelada', at:nowIso(), by:'cliente'}); demoMail('order', o); await dsave('demo_orders', list); emit('orders', { eventType:'UPDATE', new:o }); return o; },
    },
    returns: {
      async create(r){ const list = await dlist('demo_returns'); const x = { id:nextId(list), ...r, user_id:demoUser.id, email:demoUser.email, status:'pedido', created_at:nowIso(), updated_at:nowIso() }; demoMail('return', x, { order:(await dlist('demo_orders')).find(o=>o.id===x.order_id) }); list.push(x); await dsave('demo_returns', list); emit('returns', { eventType:'INSERT', new:x }); return x; },
      async mine(){ if(!demoUser) return []; return (await dlist('demo_returns')).filter(r=>r.user_id===demoUser.id).sort((a,b)=>b.id-a.id); },
      async all(){ return (await dlist('demo_returns')).sort((a,b)=>b.id-a.id); },
      async update(id, patch){ const list = await dlist('demo_returns'); const x = list.find(r=>r.id===id); Object.assign(x, patch, { updated_at:nowIso() }); demoMail('return', x, { order:(await dlist('demo_orders')).find(o=>o.id===x.order_id) }); await dsave('demo_returns', list); emit('returns', { eventType:'UPDATE', new:x }); return x; },
    },
    inbox: {
      async submit(kind, payload){ const list = await dlist('demo_inbox'); list.push({ id:nextId(list), kind, payload, email:(payload.email||(demoUser&&demoUser.email)||'').toLowerCase(), user_id: demoUser ? demoUser.id : null, status:'Pendente', imported:false, created_at:nowIso() }); await dsave('demo_inbox', list); emit('inbox', {}); },
      async mine(){ if(!demoUser) return []; return (await dlist('demo_inbox')).filter(r=> r.user_id===demoUser.id || r.email===demoUser.email).sort((a,b)=>b.id-a.id); },
      async pending(){ return (await dlist('demo_inbox')).filter(r=>!r.imported); },
      async update(id, patch){ const list = await dlist('demo_inbox'); const x = list.find(r=>r.id===id); if(x){ Object.assign(x, patch); await dsave('demo_inbox', list); } },
    },
    bookings: {
      async busy(from, to){ const m = {}; (await dlist('demo_bookings')).forEach(b=>{ if(XAgenda.ACTIVE.includes(b.status) && b.day >= from && b.day <= to){ const k = b.day + ' ' + b.slot; m[k] = (m[k]||0) + 1; } }); return m; },
      async create(b){
        const s = await window.storeGet('agendaSettings'); const err = XAgenda.validate(b, s); if(err) throw new Error(err);
        const list = await dlist('demo_bookings'); const phone = XAgenda.normPhone(b.phone);
        const cap = Math.max(1, Number(XAgenda.settings(s).perSlot)||1);
        if(list.filter(x=> x.day===b.day && x.slot===b.slot && XAgenda.ACTIVE.includes(x.status)).length >= cap) throw new Error('Esse horário acabou de ficar ocupado. Escolhe outro.');
        if(list.filter(x=> x.phone===phone && x.day >= XAgenda.now().date && XAgenda.ACTIVE.includes(x.status)).length >= 3) throw new Error('Já tens 3 marcações ativas com este número. Liga-nos para marcar mais.');
        const id = nextId(list); const sv = XAgenda.service(b.service);
        const x = { id, number:'AG-' + String(id).padStart(5,'0'), user_id: demoUser ? demoUser.id : null, service:sv.k, service_label:sv.l, device:String(b.device||'').trim(), issue:String(b.issue||'').trim(),
          day:b.day, slot:b.slot, name:String(b.name).trim(), phone, email:String(b.email||'').trim().toLowerCase(), status:'pendente', source:'site', admin_note:'', repair_id:null,
          history:[{ status:'pendente', at:nowIso(), by:'cliente' }], emails:[], created_at:nowIso(), updated_at:nowIso() };
        demoMail('booking', x); list.push(x); await dsave('demo_bookings', list); emit('bookings', { eventType:'INSERT', new:x });
        return { id, number:x.number, day:x.day, slot:x.slot };
      },
      async mine(){ if(!demoUser) return []; return (await dlist('demo_bookings')).filter(b=> b.user_id===demoUser.id).sort((a,b)=> (b.day+b.slot).localeCompare(a.day+a.slot)); },
      async cancelMine(id){ const list = await dlist('demo_bookings'); const x = list.find(b=> b.id===id && demoUser && b.user_id===demoUser.id);
        if(!x || !XAgenda.ACTIVE.includes(x.status) || x.day < XAgenda.now().date) throw new Error('Esta marcação já não pode ser cancelada.');
        x.status = 'cancelada'; x.history.push({ status:'cancelada', at:nowIso(), by:'cliente' }); x.updated_at = nowIso(); demoMail('booking', x); await dsave('demo_bookings', list); emit('bookings', { eventType:'UPDATE', new:x }); return x; },
      async all(){ return (await dlist('demo_bookings')).sort((a,b)=> (a.day+a.slot).localeCompare(b.day+b.slot)); },
      async add(b){ const list = await dlist('demo_bookings'); const id = nextId(list); const x = { id, number:'AG-' + String(id).padStart(5,'0'), user_id:null, admin_note:'', repair_id:null, history:[], created_at:nowIso(), updated_at:nowIso(), emails:[], ...b }; demoMail('booking', x); list.push(x); await dsave('demo_bookings', list); emit('bookings', { eventType:'INSERT', new:x }); return x; },
      async update(id, patch){ const list = await dlist('demo_bookings'); const x = list.find(b=> b.id===id); Object.assign(x, patch, { updated_at:nowIso() }); demoMail('booking', x); await dsave('demo_bookings', list); emit('bookings', { eventType:'UPDATE', new:x }); return x; },
      async remove(id){ const list = (await dlist('demo_bookings')).filter(b=> b.id!==id); await dsave('demo_bookings', list); emit('bookings', { eventType:'DELETE' }); },
    },
    on(table, cb){ (listeners[table] = listeners[table] || []).push(cb); },
  };
  // outras abas do mesmo browser (ex.: cliente numa aba, admin noutra)
  window.addEventListener('storage', e=>{ if(!LIVE && e.key === 'xtech_demo_ping'){ ['orders','returns','inbox','bookings'].forEach(t=> emit(t, { eventType:'SYNC' })); } });

  const XDB = Object.assign({ live: LIVE, mode: LIVE ? 'live' : 'demo' }, LIVE ? live : demo);
  XDB.ready = LIVE
    ? liveInit().catch(e=>{ console.error(e); alert('Não foi possível ligar à base de dados da loja. Verifica a ligação à internet.'); })
    : Promise.resolve();
  window.XDB = XDB;

  /* ---------------- IA: no site real os pedidos passam pelo servidor (chave escondida) ---------------- */
  if(LIVE){
    const _fetch = window.fetch.bind(window);
    window.fetch = function(url, opts){
      if(typeof url === 'string' && url.indexOf('https://api.anthropic.com/v1/messages') === 0) return _fetch('/.netlify/functions/ai', opts);
      return _fetch(url, opts);
    };
  }
})();
