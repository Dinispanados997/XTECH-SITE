/* =====================================================================
   XTECH STORE — LOJA ONLINE
   Carrinho · Checkout · Pagamentos · Área de cliente · Encomendas no admin
   Carrega DEPOIS do script principal do site.
   ===================================================================== */
/* global devices, accessories, carriers, quoteRequests, custRequests, customerSession, team,
   storeGet, storeSet, toast, renderModal, closeModal, showPage, renderNavAccount, saveDevices,
   saveAccessories, saveQuoteRequests, saveTeam, renderTeam, loadAll, renderCatalog, XDB, XPricing */
(function(){
  'use strict';
  const LIVE = XDB.live;
  const $ = (s, r)=> (r||document).querySelector(s);
  const $$ = (s, r)=> [...(r||document).querySelectorAll(s)];
  const money = n => (Number(n)||0).toLocaleString('pt-PT', {style:'currency', currency:'EUR'});
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtDate = d => { try{ return new Date(d).toLocaleDateString('pt-PT', {day:'numeric', month:'short', year:'numeric'}); }catch(e){ return ''; } };
  const fmtDT = d => { try{ return new Date(d).toLocaleString('pt-PT', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}); }catch(e){ return ''; } };
  const STORE = { phone:'923 512 686', email:'xtechstorept@gmail.com', addr:'Largo Dom Gualdim Pais 21, Amares — Braga' };
  const RETURN_DAYS = 14;
  const EMP = (window.XTECH_CONFIG && window.XTECH_CONFIG.empresa) || {};

  const STATUS = {
    por_pagar:        {l:'Aguarda pagamento', t:'warn'},
    pagamento_falhou: {l:'Pagamento falhou',  t:'bad'},
    pagar_na_loja:    {l:'Pagar ao levantar', t:'info'},
    paga:             {l:'Paga',              t:'ok'},
    em_preparacao:    {l:'Em preparação',     t:'info'},
    pronta:           {l:'Pronta a levantar', t:'ok'},
    enviada:          {l:'Enviada',           t:'info'},
    entregue:         {l:'Entregue',          t:'done'},
    levantada:        {l:'Levantada',         t:'done'},
    cancelada:        {l:'Cancelada',         t:'mute'},
    reembolsada:      {l:'Reembolsada',       t:'mute'},
  };
  const RSTATUS = {
    pedido:      {l:'Pedido recebido', t:'warn'},
    aprovada:    {l:'Aprovada',        t:'info'},
    recebida:    {l:'Artigo recebido', t:'info'},
    reembolsada: {l:'Reembolsada',     t:'ok'},
    recusada:    {l:'Recusada',        t:'bad'},
  };
  const PAID_WITH = { card:'Cartão', mb_way:'MB WAY', multibanco:'Multibanco', link:'Link', apple_pay:'Apple Pay', google_pay:'Google Pay' };
  const pill = (map, s)=> { const x = map[s] || {l:s, t:'mute'}; return `<span class="xs-pill ${x.t}">${esc(x.l)}</span>`; };
  const ICON = {
    bag:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 7h12l1 13H5L6 7Z"/><path d="M9 7V6a3 3 0 0 1 6 0v1"/></svg>',
    lock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17l9-10"/></svg>',
    back:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  };
  const logoImg = ()=> { const l = document.querySelector('header.nav .logo img'); return l ? `<img class="logo" src="${l.src}" alt="">` : ''; };
  const thumb = (src, extra='')=> `<div class="xs-thumb">${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : logoImg()}${extra}</div>`;

  // confirmação dentro da página (os pop-ups do browser nem sempre são permitidos)
  function ask(msg, ok, danger){
    return new Promise(res=>{
      const w = document.createElement('div');
      w.className = 'xs-ask';
      w.innerHTML = `<div class="xs-ask-box" role="alertdialog" aria-modal="true"><p>${esc(msg).replace(/\n/g,'<br>')}</p><div class="xs-row" style="justify-content:flex-end;flex-wrap:wrap"><button class="xs-btn ghost sm" data-v="0">Voltar</button><button class="xs-btn sm ${danger?'danger':''}" data-v="1">${esc(ok||'Confirmar')}</button></div></div>`;
      w.addEventListener('click', e=>{ const b = e.target.closest('[data-v]'); if(b || e.target === w){ w.remove(); res(!!(b && b.dataset.v === '1')); } });
      document.body.appendChild(w); setTimeout(()=>{ const b = w.querySelector('[data-v="1"]'); if(b) b.focus(); }, 30);
    });
  }

  let user = null;           // cliente com sessão iniciada
  let settings = {};         // definições da loja (portes, etc.)

  /* =====================================================================
     CATÁLOGO E CARRINHO
     ===================================================================== */
  const catalogList = type => (type === 'device' ? (typeof devices !== 'undefined' ? devices : []) : (typeof accessories !== 'undefined' ? accessories : [])) || [];
  const findItem = (type, id)=> catalogList(type).find(x=> Number(x.id) === Number(id));
  const stockOf = it => (it == null || it.qty === '' || it.qty == null || isNaN(Number(it.qty))) ? null : Number(it.qty);
  const photoOf = it => it ? ((it.photos && it.photos[0]) || it.photo || '') : '';

  const CART_KEY = 'xtech_cart_v1';
  let cart = [];
  try{ cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]') || []; }catch(e){ cart = []; }
  const saveCart = ()=> { try{ localStorage.setItem(CART_KEY, JSON.stringify(cart)); }catch(e){} updateCartBadge(); };
  const lineKey = (type, id, opts)=> `${type}:${id}:${JSON.stringify(Object.keys(opts||{}).sort().map(k=>[k, opts[k]]))}`;

  function cartView(){
    let subtotal = 0, problems = 0;
    const lines = cart.map(l=>{
      const it = findItem(l.type, l.id);
      const v = { ...l, it, name: it ? XPricing.itemName(it, l.type) : 'Produto indisponível', photo: photoOf(it), err:'', unit:0, chosen:[] };
      if(!it){ v.err = 'Este produto já não está à venda.'; problems++; return v; }
      try{ const p = XPricing.priceFor(it, l.type, l.opts); v.unit = p.unit; v.chosen = p.chosen; }
      catch(e){ v.err = e.message; problems++; return v; }
      const st = stockOf(it);
      if(st != null && st <= 0){ v.err = 'Esgotado.'; problems++; return v; }
      if(st != null && l.qty > st){ l.qty = st; v.qty = st; }
      v.max = st == null ? 10 : Math.min(10, st);
      subtotal += v.unit * v.qty;
      return v;
    });
    return { lines, subtotal: Math.round(subtotal*100)/100, problems, count: cart.reduce((s,l)=>s+l.qty, 0) };
  }

  function addToCart(type, id, opts, qty){
    const it = findItem(type, id); if(!it){ toast('Produto indisponível.'); return; }
    const st = stockOf(it); if(st != null && st <= 0){ toast('Este produto está esgotado.'); return; }
    opts = opts || {};
    const key = lineKey(type, id, opts);
    const ex = cart.find(l=> l.key === key);
    if(ex) ex.qty = Math.min((st == null ? 10 : st), ex.qty + (qty||1));
    else cart.push({ key, type, id: Number(id), opts, qty: qty||1 });
    saveCart();
    const b = $('.xs-cartbtn'); if(b){ b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
    openCart();
  }

  function updateCartBadge(){
    const b = $('.xs-cartbtn'); if(!b) return;
    const n = cart.reduce((s,l)=>s+l.qty, 0);
    let i = b.querySelector('b');
    if(n){ if(!i){ i = document.createElement('b'); b.appendChild(i); } i.textContent = n; } else if(i) i.remove();
  }

  function mountCartUI(){
    const slot = document.getElementById('nav-account-slot');
    if(slot && !$('.xs-cartbtn')){
      const btn = document.createElement('button');
      btn.className = 'xs-cartbtn'; btn.type = 'button'; btn.setAttribute('aria-label', 'Carrinho');
      btn.innerHTML = ICON.bag; btn.onclick = openCart;
      slot.parentNode.insertBefore(btn, slot);
    }
    if(!$('#xs-cart')){
      const d = document.createElement('div');
      d.id = 'xs-cart'; d.className = 'xs-drawer'; d.setAttribute('aria-hidden', 'true');
      d.innerHTML = `<div class="bg" data-close></div><aside class="panel" role="dialog" aria-label="Carrinho">
        <div class="xs-dhead"><h3>Carrinho</h3><button class="xs-x" data-close aria-label="Fechar">✕</button></div>
        <div class="xs-dbody"></div><div class="xs-dfoot"></div></aside>`;
      d.addEventListener('click', e=>{
        if(e.target.closest('[data-close]')) return closeCart();
        const q = e.target.closest('[data-q]'); if(q){ const l = cart[+q.dataset.i]; if(l){ l.qty = Math.max(1, l.qty + (+q.dataset.q)); saveCart(); renderCart(); } return; }
        const r = e.target.closest('[data-rm]'); if(r){ cart.splice(+r.dataset.rm, 1); saveCart(); renderCart(); return; }
        if(e.target.closest('[data-go="checkout"]')){ closeCart(); showPage('checkout'); return; }
        if(e.target.closest('[data-go="loja"]')){ closeCart(); if(typeof closeProductDetail === 'function') closeProductDetail(); showPage('loja'); }
      });
      document.body.appendChild(d);
    }
    updateCartBadge();
  }
  function openCart(){ renderCart(); const d = $('#xs-cart'); d.classList.add('open'); d.setAttribute('aria-hidden', 'false'); }
  function closeCart(){ const d = $('#xs-cart'); if(d){ d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); } }
  document.addEventListener('keydown', e=>{ if(e.key === 'Escape') closeCart(); });

  function renderCart(){
    const d = $('#xs-cart'); if(!d) return;
    const v = cartView();
    const body = d.querySelector('.xs-dbody'), foot = d.querySelector('.xs-dfoot');
    if(!v.lines.length){
      body.innerHTML = `<div class="xs-empty">${ICON.bag}<b>O carrinho está vazio</b>Explora a loja e encontra o teu próximo equipamento.</div>`;
      foot.innerHTML = `<button class="xs-btn block" data-go="loja">Ir para a loja</button>`;
      return;
    }
    body.innerHTML = v.lines.map((l, i)=> `
      <div class="xs-line">${thumb(l.photo)}
        <div><div class="xs-lname">${esc(l.name)}</div>
          ${l.chosen.length ? `<div class="xs-lopts">${l.chosen.map(o=>esc(o.name)).join(' · ')}</div>` : ''}
          ${l.err ? `<div class="xs-lerr">${esc(l.err)}</div>` : ''}
          <div class="xs-row">${l.err ? '' : `<div class="xs-qty"><button data-q="-1" data-i="${i}" ${l.qty<=1?'disabled':''} aria-label="Menos">−</button><span>${l.qty}</span><button data-q="1" data-i="${i}" ${l.qty>=l.max?'disabled':''} aria-label="Mais">+</button></div>`}<button class="xs-rm" data-rm="${i}">Remover</button></div>
        </div>
        <div class="xs-lprice">${l.err ? '' : money(l.unit * l.qty)}</div>
      </div>`).join('');
    const ship = settings.freeShipFrom > 0 ? (v.subtotal >= settings.freeShipFrom ? 'Envio grátis' : `Envio grátis a partir de ${money(settings.freeShipFrom)}`) : 'Levantamento grátis na loja';
    foot.innerHTML = `
      <div class="xs-tot"><span>Subtotal</span><span>${money(v.subtotal)}</span></div>
      <div class="xs-tot"><span>Entrega</span><span>${esc(ship)}</span></div>
      <div class="xs-tot big"><span>Total</span><span>${money(v.subtotal)}</span></div>
      ${v.problems ? `<div class="xs-alert">Remove os artigos indisponíveis para continuar.</div>` : ''}
      <button class="xs-btn block" data-go="checkout" ${v.problems?'disabled':''}>Finalizar compra</button>
      <div class="xs-paylogos"><span>MB WAY</span><span>Multibanco</span><span>Visa</span><span>Mastercard</span><span>Apple Pay</span><span>Google Pay</span></div>`;
  }

  /* ---------- botões do catálogo e da página de produto ---------- */
  function decorateCatalog(){
    $$('#products-grid .product-card').forEach(card=>{
      const m = (card.getAttribute('onclick')||'').match(/openProductDetail\('(\w+)',\s*(\d+)\)/); if(!m) return;
      const it = findItem(m[1], +m[2]); const btn = card.querySelector('.product-actions .btn'); if(!btn || !it) return;
      const st = stockOf(it);
      if(st != null && st <= 0){ btn.textContent = 'Esgotado'; btn.disabled = true; btn.style.opacity = '.45'; }
    });
  }
  function decorateProductPage(type, id){
    const it = findItem(type, id); const st = stockOf(it);
    $$('#product-detail-root [data-act="order"]').forEach(b=>{
      if(st != null && st <= 0){ b.textContent = 'Esgotado'; b.disabled = true; b.style.opacity = '.45'; }
      else b.textContent = 'Adicionar ao carrinho';
    });
    $$('#product-detail-root .xp-fine').forEach(p=> p.textContent = st != null && st > 0 && st <= 2 ? `Últimas ${st} unidade${st>1?'s':''}. Paga online com MB WAY, Multibanco ou cartão, ou paga ao levantar na loja.` : 'Paga online com MB WAY, Multibanco ou cartão, ou paga ao levantar na nossa loja em Amares.');
  }

  /* =====================================================================
     SESSÃO DO CLIENTE (entrar / criar conta)
     ===================================================================== */
  function syncSession(){
    user = XDB.auth.user();
    // eslint-disable-next-line no-global-assign
    customerSession = user ? { name: user.name, email: user.email, id: user.id } : null;
    try{ renderNavAccount(); }catch(e){}
  }

  const GOOGLE_BTN = (attr)=> `<button type="button" class="xs-btn block xs-google" ${attr}><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Continuar com Google</button>`;
  // guarda onde a pessoa estava, para voltar lá depois da janela da Google
  async function googleLogin(){
    try{
      const vis = document.querySelector('.site-page:not(.hide)');
      try{ sessionStorage.setItem('xtech_after_google', vis ? vis.id : ''); }catch(e){}
      await XDB.auth.signInWithGoogle();
    }catch(e){ toast(e.message); }
  }
  function afterGoogleReturn(){
    let where = ''; try{ where = sessionStorage.getItem('xtech_after_google') || ''; sessionStorage.removeItem('xtech_after_google'); }catch(e){}
    if(!where || !user) return;
    toast(`Olá, ${user.name.split(' ')[0]}!`);
    setTimeout(()=>{   // espera que o resto do site (ex.: marcações) acabe de arrancar
      if(where === 'page-checkout') showPage('checkout');
      else if(where === 'page-marcar' && window.Agenda) window.Agenda.open();
      else if(where === 'account-page') showPage('account');
    }, 350);
  }

  let afterLogin = null;
  function openAuth(mode, then){
    afterLogin = then || null;
    mode = mode || 'login';
    renderModal(`<div class="modal-box xs-modal">
      <div class="modal-head"><h3>${mode==='reset' ? 'Recuperar acesso' : 'A minha conta'}</h3><button class="modal-close" onclick="closeModal()" aria-label="Fechar">✕</button></div>
      ${!LIVE ? `<div class="xs-demo-badge">● Modo demonstração — conta guardada só neste browser</div>` : ''}
      ${mode==='reset' ? `
        <p class="xs-muted" style="margin:0 0 14px;font-size:14px">Indica o teu email e enviamos um link para criares uma palavra-passe nova.</p>
        <div class="xs-in"><label>Email</label><input id="xa-email" type="email" autocomplete="email"></div>
        <div id="xa-msg"></div>
        <button class="xs-btn block" id="xa-go">Enviar link</button>
        <p style="text-align:center;margin:14px 0 0"><button class="xs-link" onclick="Shop.openAuth('login')">Voltar a entrar</button></p>` : `
        ${GOOGLE_BTN('data-google="1"')}
        <div class="xs-or"><span>ou com email</span></div>
        <div class="xs-seg"><button class="${mode==='login'?'on':''}" onclick="Shop.openAuth('login')">Entrar</button><button class="${mode==='signup'?'on':''}" onclick="Shop.openAuth('signup')">Criar conta</button></div>
        ${mode==='signup' ? `<div class="xs-in"><label>Nome</label><input id="xa-name" autocomplete="name" placeholder="O teu nome"></div>` : ''}
        <div class="xs-in"><label>Email</label><input id="xa-email" type="email" autocomplete="email" placeholder="email@exemplo.com"></div>
        <div class="xs-in"><label>Palavra-passe</label><input id="xa-pass" type="password" autocomplete="${mode==='signup'?'new-password':'current-password'}" placeholder="${mode==='signup'?'Mínimo 8 caracteres':''}"></div>
        <div id="xa-msg"></div>
        <button class="xs-btn block" id="xa-go">${mode==='signup' ? 'Criar conta' : 'Entrar'}</button>
        ${mode==='login' ? `<p style="text-align:center;margin:14px 0 0"><button class="xs-link" onclick="Shop.openAuth('reset')">Esqueci-me da palavra-passe</button></p>` : `<p class="xs-muted" style="font-size:12.5px;text-align:center;margin:14px 0 0">Com a conta acompanhas encomendas, devoluções e reparações.</p>`}`}
    </div>`);
    const gb = $('.xs-modal [data-google]'); if(gb) gb.onclick = ()=> googleLogin();
    const go = $('#xa-go'), msg = $('#xa-msg');
    const submit = async ()=>{
      const email = ($('#xa-email').value||'').trim().toLowerCase();
      const pass = $('#xa-pass') ? $('#xa-pass').value : '';
      const name = $('#xa-name') ? $('#xa-name').value.trim() : '';
      msg.innerHTML = '';
      if(!/^\S+@\S+\.\S+$/.test(email)){ msg.innerHTML = `<div class="xs-alert">Indica um email válido.</div>`; return; }
      go.disabled = true;
      try{
        if(mode === 'reset'){
          await XDB.auth.resetPassword(email);
          msg.innerHTML = `<div class="xs-alert ok">Enviámos um email para ${esc(email)} com o link para mudares a palavra-passe.</div>`;
          return;
        }
        if(mode === 'signup'){
          if(!name){ throw new Error('Indica o teu nome.'); }
          if(pass.length < 8){ throw new Error('A palavra-passe tem de ter pelo menos 8 caracteres.'); }
          const r = await XDB.auth.signUp(email, pass, name);
          if(r.needsConfirm){
            $('.xs-modal').innerHTML = `<div class="modal-head"><h3>Confirma o teu email</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
              <p style="color:#ddd;line-height:1.55">Enviámos um email para <b>${esc(email)}</b>. Abre-o e carrega no link para ativar a conta. Depois volta aqui e entra.</p>
              <button class="xs-btn block" onclick="Shop.openAuth('login')">Já confirmei — entrar</button>`;
            return;
          }
        } else {
          if(!pass){ throw new Error('Indica a palavra-passe.'); }
          await XDB.auth.signIn(email, pass);
        }
        syncSession(); closeModal();
        toast(`Olá, ${user.name.split(' ')[0]}!`);
        const fn = afterLogin; afterLogin = null;
        if(fn) fn(); else showPage('account');
      }catch(e){ msg.innerHTML = `<div class="xs-alert">${esc(e.message || 'Não foi possível continuar.')}</div>`; }
      finally{ go.disabled = false; }
    };
    go.onclick = submit;
    $$('.xs-modal input').forEach(i=> i.addEventListener('keydown', e=>{ if(e.key === 'Enter') submit(); }));
    setTimeout(()=>{ const f = $('.xs-modal input'); if(f) f.focus(); }, 60);
  }

  function openNewPassword(after){
    renderModal(`<div class="modal-box xs-modal">
      <div class="modal-head"><h3>Nova palavra-passe</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div class="xs-in"><label>Nova palavra-passe</label><input id="xn-pass" type="password" autocomplete="new-password" placeholder="Mínimo 8 caracteres"></div>
      <div id="xn-msg"></div><button class="xs-btn block" id="xn-go">Guardar</button></div>`);
    $('#xn-go').onclick = async ()=>{
      const p = $('#xn-pass').value; if(p.length < 8){ $('#xn-msg').innerHTML = `<div class="xs-alert">Mínimo 8 caracteres.</div>`; return; }
      try{ await XDB.auth.setPassword(p); closeModal(); toast('Palavra-passe atualizada.'); if(typeof after === 'function') after(); }
      catch(e){ $('#xn-msg').innerHTML = `<div class="xs-alert">${esc(e.message)}</div>`; }
    };
  }

  async function logout(){
    await XDB.auth.signOut(); syncSession();
    if(typeof showSite === 'function') showSite(); toast('Sessão terminada.');
  }

  /* =====================================================================
     CHECKOUT
     ===================================================================== */
  const co = { method:'pickup', pay:'online', addrIdx:-1, address:'', zip:'', city:'', name:'', phone:'', nif:'', notes:'', terms:false, saveData:true, busy:false, error:'' };

  function ensurePage(id, cls){
    let p = document.getElementById(id);
    if(!p){
      p = document.createElement('div'); p.id = id; p.className = 'site-page hide ' + (cls||'');
      const footer = document.querySelector('#site-view footer.site-footer');
      footer.parentNode.insertBefore(p, footer);
    }
    return p;
  }

  function prefillCheckout(){
    if(!user) return;
    const m = user.meta || {};
    if(!co.name) co.name = m.name || user.name || '';
    if(!co.phone) co.phone = m.phone || '';
    if(!co.nif) co.nif = m.nif || '';
    const addrs = m.addresses || [];
    if(co.addrIdx === -1 && addrs.length && !co.address){ co.addrIdx = 0; Object.assign(co, { address:addrs[0].address, zip:addrs[0].zip, city:addrs[0].city }); }
  }

  function renderCheckout(){
    const page = ensurePage('page-checkout');
    const v = cartView();
    if(!v.lines.length){
      page.innerHTML = `<div class="wrap xs-page"><h1>Finalizar compra</h1><div class="xs-card" style="max-width:560px;margin-top:20px"><div class="xs-empty" style="padding:30px 0">${ICON.bag}<b>O carrinho está vazio</b>Adiciona produtos antes de finalizar.</div><button class="xs-btn block" onclick="showPage('loja')">Ir para a loja</button></div></div>`;
      return;
    }
    prefillCheckout();
    const allowShip = settings.allowShipping !== false;
    if(!allowShip) co.method = 'pickup';
    if(co.method === 'ship' && co.pay === 'loja') co.pay = 'online';
    const shipping = XPricing.shippingFor(settings, co.method, v.subtotal);
    const total = Math.round((v.subtotal + shipping)*100)/100;
    const shipFee = XPricing.shippingFor(settings, 'ship', v.subtotal);
    const addrs = (user && user.meta && user.meta.addresses) || [];

    page.innerHTML = `<div class="wrap xs-page">
      <h1>Finalizar compra</h1><p class="lead">Só faltam alguns passos.</p>
      <div class="xs-co">
        <div>
          <section class="xs-card"><h2><i>1</i>A tua conta</h2>
            ${user ? `<div class="xs-user"><div class="xs-av">${esc((user.name||'?')[0].toUpperCase())}</div><div><b>${esc(user.name)}</b><div class="xs-muted" style="font-size:13.5px">${esc(user.email)}</div></div><span class="xs-sp"></span><button class="xs-link" data-co="logout">Não sou eu</button></div>`
                   : `<p class="xs-muted" style="margin:0 0 14px;font-size:14.5px;line-height:1.5">Entra ou cria conta para acompanhares a encomenda, pedires devoluções e veres o histórico.</p>
                      ${GOOGLE_BTN('data-co="google"')}
                      <div class="xs-or"><span>ou com email</span></div>
                      <div class="xs-row"><button class="xs-btn" data-co="login">Entrar</button><button class="xs-btn ghost" data-co="signup">Criar conta</button></div>`}
          </section>

          <section class="xs-card" ${user?'':'style="opacity:.45;pointer-events:none"'}><h2><i>2</i>Entrega</h2>
            <button class="xs-opt ${co.method==='pickup'?'on':''}" data-method="pickup"><span class="r"></span><span><b>Levantar na loja</b><small>${esc(STORE.addr)}<br>Avisamos-te quando estiver pronta.</small></span><span class="pr">Grátis</span></button>
            <button class="xs-opt ${co.method==='ship'?'on':''}" data-method="ship" ${allowShip?'':'disabled'}><span class="r"></span><span><b>Envio para casa</b><small>${allowShip ? 'Portugal continental · 1 a 3 dias úteis após o envio' : 'De momento só levantamento na loja'}</small></span><span class="pr">${shipFee ? money(shipFee) : 'Grátis'}</span></button>
            ${co.method==='ship' ? `
              ${addrs.length ? `<div class="xs-in" style="margin:6px 0 12px"><label>Moradas guardadas</label><select data-f="addrIdx">${addrs.map((a,i)=>`<option value="${i}" ${co.addrIdx===i?'selected':''}>${esc(a.label||a.address)}</option>`).join('')}<option value="-2" ${co.addrIdx===-2?'selected':''}>Outra morada…</option></select></div>` : ''}
              <div class="xs-f" style="margin-top:6px">
                <div class="xs-in full"><label>Morada</label><input data-f="address" value="${esc(co.address)}" autocomplete="street-address" placeholder="Rua, número, andar"></div>
                <div class="xs-in"><label>Código postal</label><input data-f="zip" value="${esc(co.zip)}" autocomplete="postal-code" placeholder="0000-000" inputmode="numeric"></div>
                <div class="xs-in"><label>Localidade</label><input data-f="city" value="${esc(co.city)}" autocomplete="address-level2"></div>
              </div>` : ''}
          </section>

          <section class="xs-card" ${user?'':'style="opacity:.45;pointer-events:none"'}><h2><i>3</i>Os teus dados</h2>
            <div class="xs-f">
              <div class="xs-in"><label>Nome</label><input data-f="name" value="${esc(co.name)}" autocomplete="name"></div>
              <div class="xs-in"><label>Telemóvel</label><input data-f="phone" value="${esc(co.phone)}" autocomplete="tel" inputmode="tel" placeholder="9xx xxx xxx"></div>
              <div class="xs-in full"><label>NIF para a fatura (opcional)</label><input data-f="nif" value="${esc(co.nif)}" inputmode="numeric" placeholder="Sem NIF = consumidor final"></div>
            </div>
            <label class="xs-check" style="margin-top:12px"><input type="checkbox" data-f="saveData" ${co.saveData?'checked':''}>Guardar estes dados na minha conta</label>
          </section>

          <section class="xs-card" ${user?'':'style="opacity:.45;pointer-events:none"'}><h2><i>4</i>Pagamento</h2>
            <button class="xs-opt ${co.pay==='online'?'on':''}" data-pay="online"><span class="r"></span><span><b>Pagar agora online</b><small>Pagamento seguro numa página da Stripe.</small><span class="xs-chips"><span>MB WAY</span><span>Multibanco</span><span>Cartão</span><span>Apple Pay</span><span>Google Pay</span></span></span></button>
            <button class="xs-opt ${co.pay==='loja'?'on':''}" data-pay="loja" ${co.method==='pickup'?'':'disabled'}><span class="r"></span><span><b>Pagar na loja ao levantar</b><small>${co.method==='pickup' ? 'Reservamos o artigo e pagas em Amares (dinheiro, MB ou MB WAY).' : 'Disponível só com levantamento na loja.'}</small></span></button>
            <div class="xs-in" style="margin-top:6px"><label>Notas para a loja (opcional)</label><textarea data-f="notes" placeholder="Ex.: prefiro levantar ao fim da tarde">${esc(co.notes)}</textarea></div>
          </section>
        </div>

        <aside class="xs-card xs-sum">
          <h2 style="margin-bottom:6px">Resumo</h2>
          ${v.lines.map(l=>`<div class="xs-line">${thumb(l.photo, l.qty>1?`<em>${l.qty}</em>`:'')}<div><div class="xs-lname" style="font-size:14px">${esc(l.name)}</div>${l.chosen.length?`<div class="xs-lopts">${l.chosen.map(o=>esc(o.name)).join(' · ')}</div>`:''}${l.err?`<div class="xs-lerr">${esc(l.err)}</div>`:''}</div><div class="xs-lprice" style="font-size:14px">${l.err?'':money(l.unit*l.qty)}</div></div>`).join('')}
          <div style="margin-top:14px"></div>
          <div class="xs-tot"><span>Subtotal</span><span>${money(v.subtotal)}</span></div>
          <div class="xs-tot"><span>${co.method==='ship'?'Envio':'Levantamento na loja'}</span><span>${shipping ? money(shipping) : 'Grátis'}</span></div>
          <div class="xs-tot big"><span>Total</span><span>${money(total)}</span></div>
          <label class="xs-check" style="margin-bottom:14px"><input type="checkbox" data-f="terms" ${co.terms?'checked':''}><span>Li e aceito os <a href="javascript:void(0)" onclick="Shop.legal('termos')" style="color:#fff">Termos e Condições</a> e a <a href="javascript:void(0)" onclick="Shop.legal('devolucoes')" style="color:#fff">Política de Devoluções</a>.</span></label>
          ${co.error ? `<div class="xs-alert">${esc(co.error)}</div>` : ''}
          ${v.problems ? `<div class="xs-alert">Há artigos indisponíveis no carrinho. <button class="xs-link" onclick="Shop.openCart()">Rever carrinho</button></div>` : ''}
          <button class="xs-btn block" data-co="submit" ${(!user || co.busy || v.problems)?'disabled':''}>${co.busy ? 'A processar…' : !user ? 'Entra para continuar' : co.pay==='loja' ? 'Confirmar reserva' : `Pagar ${money(total)}`}</button>
          <div class="xs-secure">${ICON.lock}${co.pay==='loja' ? 'Sem pagamento agora — pagas ao levantar' : 'Pagamento seguro processado pela Stripe'}</div>
        </aside>
      </div></div>`;
  }

  function bindCheckout(){
    const page = ensurePage('page-checkout');
    if(page.dataset.bound) return; page.dataset.bound = '1';
    page.addEventListener('click', e=>{
      const m = e.target.closest('[data-method]'); if(m && !m.disabled){ co.method = m.dataset.method; co.error = ''; renderCheckout(); return; }
      const p = e.target.closest('[data-pay]'); if(p && !p.disabled){ co.pay = p.dataset.pay; co.error = ''; renderCheckout(); return; }
      const a = e.target.closest('[data-co]'); if(!a) return;
      const act = a.dataset.co;
      if(act === 'login' || act === 'signup') openAuth(act, ()=> showPage('checkout'));
      if(act === 'google') googleLogin();
      if(act === 'logout') logout().then(()=> showPage('checkout'));
      if(act === 'submit') submitOrder();
    });
    page.addEventListener('input', e=>{
      const f = e.target.dataset.f; if(!f) return;
      if(e.target.type === 'checkbox'){ co[f] = e.target.checked; if(f === 'terms') { co.error=''; } return; }
      if(f === 'addrIdx'){ const i = +e.target.value; co.addrIdx = i; const a = ((user.meta||{}).addresses||[])[i]; if(a) Object.assign(co, { address:a.address, zip:a.zip, city:a.city }); else Object.assign(co, { address:'', zip:'', city:'' }); renderCheckout(); return; }
      co[f] = e.target.value;
    });
    page.addEventListener('change', e=>{ if(e.target.type === 'checkbox'){ co[e.target.dataset.f] = e.target.checked; renderCheckout(); } else if(e.target.dataset.f === 'addrIdx'){ /* handled on input */ } });
  }

  async function submitOrder(){
    co.error = '';
    if(!user){ openAuth('login', ()=> showPage('checkout')); return; }
    if(!co.name.trim()) co.error = 'Indica o teu nome.';
    else if(!/^[+\d][\d\s]{8,}$/.test(co.phone.trim())) co.error = 'Indica um número de telemóvel válido (para te contactarmos sobre a encomenda).';
    else if(co.nif && !/^\d{9}$/.test(co.nif.replace(/\s/g,''))) co.error = 'O NIF tem de ter 9 dígitos.';
    else if(co.method === 'ship' && (!co.address.trim() || !co.zip.trim() || !co.city.trim())) co.error = 'Preenche a morada de envio completa.';
    else if(co.method === 'ship' && !/^\d{4}-?\d{3}$/.test(co.zip.trim())) co.error = 'O código postal deve ter o formato 0000-000.';
    else if(!co.terms) co.error = 'Tens de aceitar os Termos e a Política de Devoluções.';
    if(co.error){ renderCheckout(); const al = $('#page-checkout .xs-alert'); if(al) al.scrollIntoView({behavior:'smooth', block:'center'}); return; }

    co.busy = true; renderCheckout();
    try{
      if(co.saveData){
        const meta = { name: co.name.trim(), phone: co.phone.trim(), nif: co.nif.replace(/\s/g,'') };
        if(co.method === 'ship'){
          const addrs = [ ...(((user.meta||{}).addresses)||[]) ];
          const exists = addrs.some(a=> a.address === co.address.trim() && a.zip === co.zip.trim());
          if(!exists) addrs.push({ label: `${co.address.trim()}, ${co.city.trim()}`, address: co.address.trim(), zip: co.zip.trim(), city: co.city.trim() });
          meta.addresses = addrs;
        }
        try{ await XDB.auth.updateMeta(meta); syncSession(); }catch(e){ console.warn(e); }
      }
      const payload = {
        items: cart.map(l=> ({ type:l.type, id:l.id, opts:l.opts, qty:l.qty })),
        delivery: co.method === 'ship' ? { method:'ship', address:co.address.trim(), zip:co.zip.trim(), city:co.city.trim() } : { method:'pickup' },
        customer: { name: co.name.trim(), phone: co.phone.trim(), nif: co.nif.replace(/\s/g,'') },
        payment: co.pay, notes: co.notes.trim(),
      };
      const r = await XDB.orders.create(payload);
      cart = []; saveCart();
      co.busy = false; co.notes = ''; co.terms = false;
      if(r.url){ location.href = r.url; return; }
      if(r.demoPay){ openDemoPayment(r.order.id); return; }
      showThanks(r.order.id, 'ok');
    }catch(e){
      co.busy = false; co.error = e.message || 'Não foi possível concluir a encomenda.'; renderCheckout();
    }
  }

  /* ---------- página de pagamento simulada (só no modo demonstração) ---------- */
  async function openDemoPayment(orderId){
    const o = await XDB.orders.get(orderId);
    let m = 'mb_way';
    const draw = ()=> renderModal(`<div class="modal-box xs-modal">
      <div class="modal-head"><h3>Pagamento</h3><button class="modal-close" onclick="Shop._demoCancel(${orderId})">✕</button></div>
      <div class="xs-demo-badge">● Simulação — no site real esta é a página segura da Stripe</div>
      <div class="xs-tot big" style="margin-top:0"><span>${esc(o.number)}</span><span>${money(o.total)}</span></div>
      ${['mb_way','multibanco','card'].map(k=>`<button class="xs-opt ${m===k?'on':''}" onclick="Shop._demoM('${k}')"><span class="r"></span><span><b>${{mb_way:'MB WAY',multibanco:'Multibanco',card:'Cartão / Apple Pay / Google Pay'}[k]}</b></span></button>`).join('')}
      ${m==='mb_way' ? `<div class="xs-in"><label>Telemóvel MB WAY</label><input value="912 345 678"></div>` : ''}
      ${m==='multibanco' ? `<div class="xs-mbref"><span>Entidade</span><b>12345</b><span>Referência</span><b>123 456 789</b><span>Valor</span><b>${money(o.total)}</b></div><p class="xs-muted" style="font-size:13px">A encomenda fica "a aguardar pagamento" até a referência ser paga.</p>` : ''}
      ${m==='card' ? `<div class="xs-in"><label>Número do cartão</label><input value="4242 4242 4242 4242"></div>` : ''}
      <button class="xs-btn block" onclick="Shop._demoPay(${orderId})">${m==='multibanco' ? 'Gerar referência' : 'Pagar ' + money(o.total)}</button>
    </div>`);
    Shop._demoM = k=>{ m = k; draw(); };
    Shop._demoPay = async id=>{ await XDB.orders.demoPay(id, m === 'multibanco' ? 'multibanco_pendente' : m, true); closeModal(); showThanks(id, 'ok'); };
    Shop._demoCancel = id=>{ closeModal(); showThanks(id, 'cancelado'); };
    draw();
  }

  /* =====================================================================
     OBRIGADO / ESTADO DO PAGAMENTO
     ===================================================================== */
  let thanksTimer = null;
  async function showThanks(orderId, state){
    const page = ensurePage('page-obrigado');
    showPage('obrigado');
    page.innerHTML = `<div class="wrap xs-page"><div class="xs-thanks"><div class="xs-tick wait"><div class="xs-spin"></div></div><h1>Um momento…</h1></div></div>`;
    clearInterval(thanksTimer);
    let tries = 0;
    const draw = async ()=>{
      const o = await XDB.orders.get(orderId);
      if(!o){ page.innerHTML = `<div class="wrap xs-page"><div class="xs-thanks"><h1>Encomenda não encontrada</h1><p class="lead">Entra na tua conta para veres as tuas encomendas.</p><button class="xs-btn" onclick="Shop.openAccount()">A minha conta</button></div></div>`; clearInterval(thanksTimer); return; }
      const paid = !['por_pagar','pagamento_falhou','cancelada'].includes(o.status);
      const waitingMB = o.status === 'por_pagar' && o.paid_with === 'multibanco';
      const cancelled = state === 'cancelado' && o.status === 'por_pagar' && !waitingMB;
      let icon = ICON.check, title = 'Obrigado pela tua encomenda!', sub = '';
      if(o.status === 'pagar_na_loja'){ title = 'Reserva confirmada!'; sub = 'Guardámos o artigo para ti. Pagas quando vieres levantar — avisamos-te quando estiver pronto.'; }
      else if(paid){ sub = o.delivery.method === 'ship' ? 'Pagamento confirmado. Vamos preparar a encomenda e enviamos-te o código de seguimento.' : 'Pagamento confirmado. Avisamos-te quando estiver pronta a levantar na loja.'; }
      else if(waitingMB){ icon = ICON.clock; title = 'Falta pagar a referência'; sub = 'Assim que pagares a referência Multibanco (enviada para o teu email), a encomenda avança automaticamente.'; }
      else if(cancelled || o.status === 'pagamento_falhou'){ icon = '!'; title = o.status === 'pagamento_falhou' ? 'O pagamento falhou' : 'Pagamento não concluído'; sub = 'A encomenda ficou guardada. Podes tentar pagar outra vez.'; }
      else { icon = ''; title = 'A confirmar o pagamento…'; sub = 'Isto demora só uns segundos.'; }
      if((paid || o.status === 'pagar_na_loja') && o.email) sub += ` Enviámos a confirmação para <b style="color:#fff;font-weight:600">${esc(o.email)}</b>.`;
      page.innerHTML = `<div class="wrap xs-page"><div class="xs-thanks">
        <div class="xs-tick ${paid||o.status==='pagar_na_loja' ? '' : 'wait'}">${icon || '<div class="xs-spin"></div>'}</div>
        <h1>${title}</h1><p class="lead">${sub}</p>
        <div class="xs-card">
          <div class="xs-row" style="margin-bottom:12px"><b style="font-size:17px">${esc(o.number)}</b><span class="xs-sp"></span>${pill(STATUS, o.status)}</div>
          ${(o.items||[]).map(l=>`<div class="xs-line sm">${thumb(l.photo)}<div><div class="xs-lname" style="font-size:14px">${esc(l.name)}${l.qty>1?` × ${l.qty}`:''}</div><div class="xs-lopts">${(l.options||[]).map(x=>esc(x.name)).join(' · ')}</div></div><div class="xs-lprice" style="font-size:14px">${money(l.total)}</div></div>`).join('')}
          <div class="xs-tot big" style="margin-bottom:0"><span>Total</span><span>${money(o.total)}</span></div>
        </div>
        <div class="xs-row" style="justify-content:center;margin-top:24px;flex-wrap:wrap">
          ${(cancelled || o.status==='pagamento_falhou') ? `<button class="xs-btn" onclick="Shop.payAgain(${o.id})">Tentar pagar outra vez</button>` : ''}
          <button class="xs-btn ${cancelled?'ghost':''}" onclick="Shop.openAccount('orders', ${o.id})">Acompanhar encomenda</button>
          <button class="xs-btn ghost" onclick="showPage('loja')">Continuar a comprar</button>
        </div></div></div>`;
      if(paid || waitingMB || cancelled || o.status !== 'por_pagar' || ++tries > 40) clearInterval(thanksTimer);
    };
    await draw();
    thanksTimer = setInterval(draw, 3000);
  }

  async function payAgain(id){
    try{
      toast('A abrir o pagamento…');
      const r = await XDB.orders.retry(id);
      if(r.url){ location.href = r.url; return; }
      if(r.demoPay) openDemoPayment(id);
    }catch(e){ toast(e.message); }
  }

  /* =====================================================================
     A MINHA CONTA (abas)
     ===================================================================== */
  const acc = { tab:'orders', detail:null, data:{ orders:[], returns:[], repairs:[] } };

  async function loadAccountData(){
    const [orders, returns, inbox] = await Promise.all([XDB.orders.mine(), XDB.returns.mine(), XDB.inbox.mine()]);
    acc.data.orders = orders; acc.data.returns = returns;
    const legacy = (typeof custRequests !== 'undefined' ? custRequests : []).filter(r=> user && (r.email||'').toLowerCase() === user.email && !inbox.length);
    acc.data.repairs = inbox.filter(r=> r.kind === 'quote').map(r=>({ device:r.payload.device, issue:r.payload.issue, status:r.status, date:r.created_at, price:r.payload.quotedPrice }))
      .concat(legacy.map(r=>({ device:r.device, issue:r.issue, status:'Pendente', date:r.date })));
  }

  function openAccount(tab, orderId){
    if(!XDB.auth.user()){ openAuth('login', ()=> openAccount(tab, orderId)); return; }
    acc.tab = tab || 'orders'; acc.detail = orderId || null;
    showPage('account');
  }

  async function renderAccount(){
    const root = $('#account-page .wrap'); if(!root) return;
    syncSession();
    if(!user){ root.innerHTML = `<div class="xs-page" style="padding-top:110px"><h1>A minha conta</h1><p class="lead">Entra para veres as tuas encomendas, devoluções e reparações.</p><div class="xs-row"><button class="xs-btn" onclick="Shop.openAuth('login')">Entrar</button><button class="xs-btn ghost" onclick="Shop.openAuth('signup')">Criar conta</button></div></div>`; return; }
    root.innerHTML = `<div class="xs-page" style="padding-bottom:30px"><div class="xs-empty"><div class="xs-spin" style="margin:0 auto"></div></div></div>`;
    await loadAccountData();
    drawAccount();
  }

  function drawAccount(){
    const root = $('#account-page .wrap'); if(!root || !user) return;
    const d = acc.data;
    const openOrders = d.orders.filter(o=> !['entregue','levantada','cancelada','reembolsada'].includes(o.status)).length;
    const tabs = [['orders','Encomendas', openOrders], ['returns','Devoluções', d.returns.filter(r=>!['reembolsada','recusada'].includes(r.status)).length], ['repairs','Reparações', 0], ['addresses','Moradas', 0], ['profile','Dados pessoais', 0]];
    let body = '';
    if(acc.tab === 'orders') body = acc.detail ? orderDetailHTML(d.orders.find(o=>o.id===acc.detail)) : ordersHTML();
    if(acc.tab === 'returns') body = returnsHTML();
    if(acc.tab === 'repairs') body = repairsHTML();
    if(acc.tab === 'addresses') body = addressesHTML();
    if(acc.tab === 'profile') body = profileHTML();
    root.innerHTML = `<div class="xs-page" style="padding-bottom:40px">
      <div class="xs-acc-head"><div class="xs-av">${esc((user.name||'?')[0].toUpperCase())}</div><div><h1 style="font-size:clamp(30px,4.4vw,44px)">Olá, ${esc(user.name.split(' ')[0])}.</h1><p>${esc(user.email)}</p></div><span class="xs-sp"></span><button class="xs-btn ghost sm" data-acc="logout">Terminar sessão</button></div>
      <nav class="xs-tabs" role="tablist">${tabs.map(([k,l,n])=>`<button role="tab" class="${acc.tab===k?'on':''}" data-tab="${k}">${l}${n?`<em>${n}</em>`:''}</button>`).join('')}</nav>
      <div id="xs-acc-body">${body}</div>
      <p style="margin-top:34px"><button class="xs-link" onclick="showSite()">← Voltar ao site</button></p>
    </div>`;    if(acc.tab === 'repairs' && window.Agenda) window.Agenda.fillMine();
  }

  function ordersHTML(){
    const list = acc.data.orders;
    if(!list.length) return `<div class="xs-card"><div class="xs-empty" style="padding:34px 0">${ICON.bag}<b>Ainda não tens encomendas</b>Quando comprares, acompanhas tudo aqui.</div><button class="xs-btn block" onclick="showPage('loja')">Ir para a loja</button></div>`;
    return list.map(o=>`<button class="xs-ord" data-order="${o.id}">
      <div class="top"><span class="num">${esc(o.number)}</span><span class="date">${fmtDate(o.created_at)}</span><span class="xs-sp"></span>${pill(STATUS, o.status)}</div>
      <div class="imgs">${(o.items||[]).slice(0,5).map(l=>thumb(l.photo)).join('')}</div>
      <div class="bot"><span>${(o.items||[]).map(l=>esc(l.name)).join(', ')}</span><b>${money(o.total)}</b></div>
    </button>`).join('');
  }

  function stepsFor(o){
    const ship = o.delivery && o.delivery.method === 'ship';
    const steps = ship ? [['feita','Encomenda feita'],['paga','Paga'],['em_preparacao','Em preparação'],['enviada','Enviada'],['entregue','Entregue']]
                       : [['feita','Encomenda feita'],['paga', o.payment_method==='loja' ? 'Reservada' : 'Paga'],['em_preparacao','Em preparação'],['pronta','Pronta a levantar'],['levantada','Levantada']];
    const order = { por_pagar:0, pagamento_falhou:0, pagar_na_loja:1, paga:1, em_preparacao:2, pronta:3, enviada:3, entregue:4, levantada:4 };
    const cur = order[o.status] != null ? order[o.status] : -1;
    return `<div class="xs-steps">${steps.map((s,i)=>`<div class="${i<=cur?'on':''}">${s[1]}</div>`).join('')}</div>`;
  }

  function deliveredAt(o){
    const h = (o.history||[]).filter(x=> ['entregue','levantada'].includes(x.status)).pop();
    return h ? new Date(h.at) : null;
  }
  function canReturn(o){
    const d = deliveredAt(o); if(!d) return false;
    if(acc.data.returns.some(r=> r.order_id === o.id && !['recusada'].includes(r.status))) return false;
    return (Date.now() - d.getTime()) / 86400000 <= RETURN_DAYS;
  }

  function orderDetailHTML(o){
    if(!o) return `<div class="xs-card">Encomenda não encontrada.</div>`;
    const ship = o.delivery && o.delivery.method === 'ship';
    const rets = acc.data.returns.filter(r=> r.order_id === o.id);
    const unpaid = o.payment_method === 'online' && ['por_pagar','pagamento_falhou'].includes(o.status);
    const waitingMB = o.status === 'por_pagar' && o.paid_with === 'multibanco';
    return `<button class="xs-back" data-acc="back">${ICON.back} Todas as encomendas</button>
      <div class="xs-card">
        <div class="xs-row" style="flex-wrap:wrap;margin-bottom:16px"><h2 style="margin:0">${esc(o.number)}</h2><span class="xs-muted">${fmtDT(o.created_at)}</span><span class="xs-sp"></span>${pill(STATUS, o.status)}</div>
        ${['cancelada','reembolsada'].includes(o.status) ? '' : stepsFor(o)}
        ${waitingMB ? `<div class="xs-alert info">Gerámos uma referência Multibanco (vê o teu email). Assim que for paga, a encomenda avança sozinha.</div>` : ''}
        ${o.tracking && o.tracking.code ? `<div class="xs-alert ok" style="margin-top:16px">Enviada por <b>${esc(o.tracking.company||'transportadora')}</b> · código de seguimento <span class="xs-copy">${esc(o.tracking.code)}</span></div>` : ''}
        ${o.status === 'pronta' ? `<div class="xs-alert ok" style="margin-top:16px">Está pronta! Levanta na loja: ${esc(STORE.addr)}.${o.payment_method==='loja' ? ` Pagas ${money(o.total)} no momento.` : ''}</div>` : ''}
        <div class="xs-row" style="flex-wrap:wrap;margin-top:18px">
          ${unpaid ? `<button class="xs-btn" data-acc="pay" data-id="${o.id}">Pagar agora</button>` : ''}
          ${['por_pagar','pagar_na_loja','pagamento_falhou'].includes(o.status) ? `<button class="xs-btn danger" data-acc="cancel" data-id="${o.id}">Cancelar encomenda</button>` : ''}
          ${canReturn(o) ? `<button class="xs-btn line" data-acc="return" data-id="${o.id}">Pedir devolução</button>` : ''}
        </div>
      </div>
      <div class="xs-card">
        <h2>Artigos</h2>
        ${(o.items||[]).map(l=>`<div class="xs-line">${thumb(l.photo)}<div><div class="xs-lname">${esc(l.name)}</div><div class="xs-lopts">${(l.options||[]).map(x=>esc(x.name)).join(' · ')}${l.qty>1?` · ${l.qty} unid.`:''}</div></div><div class="xs-lprice">${money(l.total)}</div></div>`).join('')}
        <div style="margin-top:12px"></div>
        <div class="xs-tot"><span>Subtotal</span><span>${money(o.subtotal)}</span></div>
        <div class="xs-tot"><span>${ship?'Envio':'Levantamento'}</span><span>${Number(o.shipping) ? money(o.shipping) : 'Grátis'}</span></div>
        <div class="xs-tot big" style="margin-bottom:0"><span>Total</span><span>${money(o.total)}</span></div>
      </div>
      <div class="xs-grid2" style="margin-top:16px">
        <div class="xs-card" style="margin:0"><h2>Entrega</h2><div class="xs-kv">${ship ? `<span>Envio para</span><b>${esc(o.delivery.address)}<br>${esc(o.delivery.zip)} ${esc(o.delivery.city)}</b>` : `<span>Levantar em</span><b>Xtech Store<br>${esc(STORE.addr)}</b>`}<span>Contacto</span><b>${esc(o.name)} · ${esc(o.phone)}</b></div></div>
        <div class="xs-card" style="margin:0"><h2>Pagamento</h2><div class="xs-kv"><span>Forma</span><b>${o.payment_method==='loja' ? 'Na loja, ao levantar' : (PAID_WITH[o.paid_with] || 'Online')}</b><span>NIF</span><b>${esc(o.nif || 'Consumidor final')}</b></div></div>
      </div>
      ${rets.length ? `<div class="xs-card"><h2>Devoluções desta encomenda</h2>${rets.map(r=>`<div class="xs-row" style="padding:8px 0">${esc(r.items||'')}<span class="xs-sp"></span>${pill(RSTATUS, r.status)}</div>`).join('')}</div>` : ''}
      <p class="xs-muted" style="font-size:13.5px;margin-top:18px">Dúvidas sobre esta encomenda? Liga ${STORE.phone} ou escreve para ${STORE.email} e indica o número ${esc(o.number)}.</p>`;
  }

  function returnsHTML(){
    const d = acc.data;
    const eligible = d.orders.filter(canReturn);
    return `<div class="xs-how">
        <div><i>1</i><b>Pedes aqui</b>Até ${RETURN_DAYS} dias depois de receberes ou levantares.</div>
        <div><i>2</i><b>Nós aprovamos</b>Respondemos em 1 a 2 dias úteis.</div>
        <div><i>3</i><b>Devolves o artigo</b>Na loja em Amares ou por envio, com tudo o que trazia.</div>
        <div><i>4</i><b>Reembolso</b>No mesmo método de pagamento, até 14 dias.</div>
      </div>
      ${eligible.length ? `<div class="xs-card"><h2>Pedir uma devolução</h2>${eligible.map(o=>`<div class="xs-row" style="padding:10px 0;border-bottom:1px solid var(--line)"><div><b>${esc(o.number)}</b><div class="xs-muted" style="font-size:13.5px">${(o.items||[]).map(l=>esc(l.name)).join(', ')}</div></div><span class="xs-sp"></span><button class="xs-btn sm line" data-acc="return" data-id="${o.id}">Devolver</button></div>`).join('')}</div>` : ''}
      <div class="xs-card"><h2>Os teus pedidos de devolução</h2>
        ${d.returns.length ? d.returns.map(r=>{ const o = d.orders.find(x=>x.id===r.order_id); return `<div style="padding:12px 0;border-bottom:1px solid var(--line)"><div class="xs-row"><b>${esc(o ? o.number : '#'+r.order_id)}</b><span class="xs-muted" style="font-size:13px">${fmtDate(r.created_at)}</span><span class="xs-sp"></span>${pill(RSTATUS, r.status)}</div><div class="xs-muted" style="font-size:14px;margin-top:6px">${esc(r.items||'')} — ${esc(r.reason||'')}</div>${r.admin_note?`<div class="xs-alert info" style="margin-bottom:0">${esc(r.admin_note)}</div>`:''}</div>`; }).join('')
          : `<p class="xs-muted" style="margin:0">Não tens pedidos de devolução.${eligible.length ? '' : ' Só é possível pedir devolução de encomendas já entregues ou levantadas há menos de ' + RETURN_DAYS + ' dias.'}</p>`}
      </div>`;
  }

  function repairsHTML(){
    const list = acc.data.repairs;
    return `<div id="ag-mine"></div><div class="xs-card"><div class="xs-row" style="margin-bottom:6px"><h2 style="margin:0">Pedidos de reparação e orçamento</h2><span class="xs-sp"></span><button class="xs-btn sm" onclick="showPage('reparacoes')">Pedir orçamento</button></div>
      ${list.length ? list.map(r=>`<div style="padding:14px 0;border-bottom:1px solid var(--line)"><div class="xs-row"><b>${esc(r.device||'Equipamento')}</b><span class="xs-muted" style="font-size:13px">${fmtDate(r.date)}</span><span class="xs-sp"></span><span class="xs-pill ${/conclu|entreg|pronto/i.test(r.status)?'ok':/recus|cancel/i.test(r.status)?'bad':'warn'}">${esc(r.status||'Pendente')}</span></div><div class="xs-muted" style="font-size:14px;margin-top:6px">${esc(r.issue||'')}</div>${r.price?`<div style="margin-top:6px;font-size:14px">Orçamento: <b>${money(r.price)}</b></div>`:''}</div>`).join('')
        : `<p class="xs-muted" style="margin:10px 0 0">Ainda não pediste nenhum orçamento. Usa o assistente na página Reparações — o pedido aparece aqui.</p>`}
    </div>`;
  }

  function addressesHTML(){
    const addrs = (user.meta && user.meta.addresses) || [];
    return `<div class="xs-card"><div class="xs-row" style="margin-bottom:6px"><h2 style="margin:0">Moradas de envio</h2><span class="xs-sp"></span><button class="xs-btn sm" data-acc="addr-new">Adicionar morada</button></div>
      ${addrs.length ? addrs.map((a,i)=>`<div class="xs-addr"><div><b>${esc(a.label || a.address)}</b>${i===0?' <span class="xs-pill done" style="margin-left:6px">Principal</span>':''}<p>${esc(a.address)}<br>${esc(a.zip)} ${esc(a.city)}</p></div><span class="xs-sp"></span><button class="xs-link" data-acc="addr-edit" data-i="${i}">Editar</button>${i>0?`<button class="xs-link" data-acc="addr-main" data-i="${i}" style="margin-left:12px">Tornar principal</button>`:''}<button class="xs-link" data-acc="addr-del" data-i="${i}" style="margin-left:12px;color:#FF6961">Apagar</button></div>`).join('')
        : `<p class="xs-muted" style="margin:10px 0 0">Ainda não tens moradas guardadas. Também ficam guardadas quando fazes uma encomenda com envio.</p>`}
    </div>`;
  }

  function profileHTML(){
    const m = user.meta || {};
    return `<div class="xs-grid2">
      <div class="xs-card" style="margin:0"><h2>Dados pessoais</h2>
        <div class="xs-in" style="margin-bottom:12px"><label>Nome</label><input id="xp-name" value="${esc(m.name || user.name)}"></div>
        <div class="xs-in" style="margin-bottom:12px"><label>Email</label><input value="${esc(user.email)}" disabled></div>
        <div class="xs-in" style="margin-bottom:12px"><label>Telemóvel</label><input id="xp-phone" value="${esc(m.phone||'')}" inputmode="tel"></div>
        <div class="xs-in" style="margin-bottom:16px"><label>NIF (para faturas)</label><input id="xp-nif" value="${esc(m.nif||'')}" inputmode="numeric"></div>
        <button class="xs-btn" data-acc="profile-save">Guardar</button>
      </div>
      <div class="xs-card" style="margin:0"><h2>Segurança</h2>
        <div class="xs-in" style="margin-bottom:16px"><label>Nova palavra-passe</label><input id="xp-pass" type="password" autocomplete="new-password" placeholder="Mínimo 8 caracteres"></div>
        <button class="xs-btn ghost" data-acc="pass-save">Mudar palavra-passe</button>
        <p class="xs-muted" style="font-size:13px;margin-top:22px;line-height:1.5">Para apagar a tua conta e os teus dados, escreve para ${STORE.email}.</p>
      </div></div>`;
  }

  function addressModal(i){
    const addrs = [ ...((user.meta && user.meta.addresses) || []) ];
    const a = i != null ? addrs[i] : { label:'', address:'', zip:'', city:'' };
    renderModal(`<div class="modal-box xs-modal"><div class="modal-head"><h3>${i!=null?'Editar':'Nova'} morada</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div class="xs-in"><label>Nome da morada (ex.: Casa, Trabalho)</label><input id="xm-label" value="${esc(a.label)}"></div>
      <div class="xs-in"><label>Morada</label><input id="xm-address" value="${esc(a.address)}"></div>
      <div class="xs-f"><div class="xs-in"><label>Código postal</label><input id="xm-zip" value="${esc(a.zip)}" placeholder="0000-000"></div><div class="xs-in"><label>Localidade</label><input id="xm-city" value="${esc(a.city)}"></div></div>
      <div id="xm-msg"></div><button class="xs-btn block" id="xm-go">Guardar</button></div>`);
    $('#xm-go').onclick = async ()=>{
      const n = { label: $('#xm-label').value.trim(), address: $('#xm-address').value.trim(), zip: $('#xm-zip').value.trim(), city: $('#xm-city').value.trim() };
      if(!n.address || !/^\d{4}-?\d{3}$/.test(n.zip) || !n.city){ $('#xm-msg').innerHTML = `<div class="xs-alert">Preenche a morada, o código postal (0000-000) e a localidade.</div>`; return; }
      if(!n.label) n.label = `${n.address}, ${n.city}`;
      if(i != null) addrs[i] = n; else addrs.push(n);
      await XDB.auth.updateMeta({ addresses: addrs }); syncSession(); closeModal(); drawAccount(); toast('Morada guardada.');
    };
  }

  function returnModal(orderId){
    const o = acc.data.orders.find(x=>x.id===orderId); if(!o) return;
    renderModal(`<div class="modal-box xs-modal"><div class="modal-head"><h3>Pedir devolução</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
      <p class="xs-muted" style="margin:0 0 14px;font-size:14px">${esc(o.number)} · escolhe o que queres devolver.</p>
      ${(o.items||[]).map((l,i)=>`<label class="xs-check" style="margin-bottom:10px;color:#fff"><input type="checkbox" class="xr-it" value="${i}" ${o.items.length===1?'checked':''}>${esc(l.name)}${l.qty>1?` × ${l.qty}`:''} — ${money(l.total)}</label>`).join('')}
      <div class="xs-in" style="margin-top:8px"><label>Motivo</label><select id="xr-reason"><option>Desisti da compra (livre resolução, 14 dias)</option><option>O artigo tem um defeito</option><option>O artigo não corresponde ao anunciado</option><option>Recebi o artigo errado</option><option>Outro motivo</option></select></div>
      <div class="xs-in"><label>Detalhes (opcional)</label><textarea id="xr-details" placeholder="Conta-nos o que aconteceu"></textarea></div>
      <p class="xs-muted" style="font-size:12.5px;line-height:1.5">O artigo deve ser devolvido com todos os acessórios e na caixa original. Respondemos em 1 a 2 dias úteis.</p>
      <div id="xr-msg"></div><button class="xs-btn block" id="xr-go">Enviar pedido</button></div>`);
    $('#xr-go').onclick = async ()=>{
      const sel = $$('.xr-it').filter(x=>x.checked).map(x=> o.items[+x.value]);
      if(!sel.length){ $('#xr-msg').innerHTML = `<div class="xs-alert">Escolhe pelo menos um artigo.</div>`; return; }
      $('#xr-go').disabled = true;
      try{
        await XDB.returns.create({ order_id: o.id, items: sel.map(l=> l.name + (l.qty>1?` × ${l.qty}`:'')).join(', '), reason: $('#xr-reason').value, details: $('#xr-details').value.trim() });
        closeModal(); toast('Pedido de devolução enviado.'); await loadAccountData(); acc.tab = 'returns'; acc.detail = null; drawAccount();
      }catch(e){ $('#xr-msg').innerHTML = `<div class="xs-alert">${esc(e.message)}</div>`; $('#xr-go').disabled = false; }
    };
  }

  function bindAccount(){
    const page = document.getElementById('account-page'); if(!page || page.dataset.xs) return; page.dataset.xs = '1';
    page.addEventListener('click', async e=>{
      const t = e.target.closest('[data-tab]'); if(t && t.closest('.xs-tabs')){ acc.tab = t.dataset.tab; acc.detail = null; drawAccount(); return; }
      const ord = e.target.closest('[data-order]'); if(ord){ acc.detail = +ord.dataset.order; drawAccount(); window.scrollTo({top:0}); return; }
      const a = e.target.closest('[data-acc]'); if(!a) return;
      const act = a.dataset.acc, id = a.dataset.id ? +a.dataset.id : null;
      const addrs = [ ...((user.meta && user.meta.addresses) || []) ];
      if(act === 'logout') return logout();
      if(act === 'back'){ acc.detail = null; drawAccount(); return; }
      if(act === 'pay') return payAgain(id);
      if(act === 'cancel'){
        if(!(await ask('Cancelar esta encomenda?', 'Cancelar encomenda', true))) return;
        try{ await XDB.orders.cancelMine(id); toast('Encomenda cancelada.'); await loadAccountData(); drawAccount(); }catch(err){ toast(err.message); }
        return;
      }
      if(act === 'return') return returnModal(id);
      if(act === 'addr-new') return addressModal(null);
      if(act === 'addr-edit') return addressModal(+a.dataset.i);
      if(act === 'addr-del'){ addrs.splice(+a.dataset.i, 1); await XDB.auth.updateMeta({ addresses: addrs }); syncSession(); drawAccount(); return; }
      if(act === 'addr-main'){ const [x] = addrs.splice(+a.dataset.i, 1); addrs.unshift(x); await XDB.auth.updateMeta({ addresses: addrs }); syncSession(); drawAccount(); return; }
      if(act === 'profile-save'){
        const nif = $('#xp-nif').value.replace(/\s/g,'');
        if(nif && !/^\d{9}$/.test(nif)){ toast('O NIF tem de ter 9 dígitos.'); return; }
        await XDB.auth.updateMeta({ name: $('#xp-name').value.trim() || user.name, phone: $('#xp-phone').value.trim(), nif });
        syncSession(); drawAccount(); toast('Dados guardados.'); return;
      }
      if(act === 'pass-save'){
        const p = $('#xp-pass').value; if(p.length < 8){ toast('A palavra-passe tem de ter pelo menos 8 caracteres.'); return; }
        try{ await XDB.auth.setPassword(p); $('#xp-pass').value = ''; toast('Palavra-passe atualizada.'); }catch(err){ toast(err.message); }
      }
    });
  }

  /* =====================================================================
     PEDIDOS DE ORÇAMENTO (chat de reparações) → caixa de entrada partilhada
     ===================================================================== */
  async function submitQuote(){
    /* global quoteChatSummary */
    const s = typeof quoteChatSummary !== 'undefined' ? quoteChatSummary : null; if(!s) return;
    try{
      await XDB.inbox.submit('quote', { name:s.name||'Cliente site', phone:s.phone||'', email:(s.email||'').toLowerCase(), device:s.device||'—', issue:s.issue||'Pedido via site (chat IA)', date:new Date().toISOString().slice(0,10) });
      const slot = document.getElementById('quote-chat-confirm');
      if(slot) slot.innerHTML = `<p style="color:var(--green); font-size:13px; padding:0 18px 14px; margin:0;">Pedido enviado! Vamos entrar em contacto brevemente.${user ? ' Podes acompanhar em A minha conta → Reparações.' : ''}</p>`;
      toast('Pedido de orçamento registado.');
    }catch(e){ toast('Não foi possível enviar. Liga-nos: ' + STORE.phone); }
  }

  /* =====================================================================
     PÁGINAS LEGAIS (modelo — rever com o contabilista/jurista)
     ===================================================================== */
  function legal(section){
    const page = ensurePage('page-legal');
    page.innerHTML = `<div class="wrap xs-page xs-legal">
      <h1>Informação legal</h1><p class="lead">Termos de venda, devoluções, garantia e privacidade da Xtech Store.</p>
      <h2 id="lg-termos">Termos e Condições de venda</h2>
      <p>O site é explorado por ${esc(EMP.nomeLegal || 'Xtech Store')}${EMP.nomeLegal ? ' (Xtech Store)' : ''}, ${esc(STORE.addr)}${EMP.nif ? ', NIF ' + esc(EMP.nif) : ''}. Contactos: ${esc(STORE.phone)} · ${esc(STORE.email)}. Os preços incluem IVA à taxa legal em vigor. A encomenda considera-se aceite após a confirmação do pagamento (ou, no pagamento na loja, após a nossa confirmação da reserva). As reservas com pagamento na loja ficam guardadas 3 dias úteis após avisarmos que estão prontas.</p>
      <h2 id="lg-pagamentos">Pagamentos</h2>
      <p>Aceitamos MB WAY, referência Multibanco, cartão de crédito/débito, Apple Pay e Google Pay, processados de forma segura pela Stripe. Não guardamos dados de cartões. Também é possível pagar na loja ao levantar.</p>
      <h2 id="lg-envios">Envios e levantamento</h2>
      <p>Levantamento gratuito na loja em Amares. Envios para Portugal continental, normalmente expedidos em 1 a 2 dias úteis após o pagamento, com código de seguimento visível na tua conta.</p>
      <h2 id="lg-devolucoes">Devoluções e direito de livre resolução</h2>
      <p>Nas compras online tens ${RETURN_DAYS} dias a contar da receção para desistir da compra sem indicar motivo (Decreto-Lei n.º 24/2014). Pede a devolução em A minha conta → Devoluções. O artigo deve ser devolvido completo, com acessórios e caixa. Reembolsamos no mesmo meio de pagamento até 14 dias após recebermos o artigo. Os custos de devolução por envio são do cliente, salvo defeito ou erro nosso.</p>
      <h2 id="lg-garantia">Garantia</h2>
      <p>Nos termos do Decreto-Lei n.º 84/2021, os equipamentos usados têm 18 meses de garantia e os artigos novos (incluindo acessórios) têm 3 anos de garantia, a contar da entrega. Em caso de avaria, contacta-nos com o número da encomenda ou passa na loja; o diagnóstico é gratuito.</p>
      <h2 id="lg-privacidade">Política de Privacidade</h2>
      <p>Usamos os teus dados (nome, email, telemóvel, morada, NIF) apenas para processar encomendas, marcações, reparações, faturação e apoio ao cliente, e para te enviar emails sobre esses pedidos (confirmações, avisos e lembretes). Se entrares com a conta Google, recebemos apenas o teu nome, email e foto de perfil, que usamos só para criar e identificar a tua conta. Os dados ficam guardados em servidores na UE (Supabase) e os pagamentos são processados pela Stripe. Não vendemos dados a terceiros. Podes pedir acesso, correção ou eliminação dos teus dados através de ${STORE.email}.</p>
      <h2 id="lg-litigios">Resolução de litígios</h2>
      <p>Livro de Reclamações Eletrónico: <a href="https://www.livroreclamacoes.pt" target="_blank" rel="noopener" style="color:#fff">www.livroreclamacoes.pt</a>. Em caso de litígio de consumo, podes recorrer a uma entidade de Resolução Alternativa de Litígios, como o CIAB — Centro de Informação, Mediação e Arbitragem de Consumo (Tribunal Arbitral de Consumo), <a href="https://www.ciab.pt" target="_blank" rel="noopener" style="color:#fff">www.ciab.pt</a>. Mais informação no Portal do Consumidor: <a href="https://www.consumidor.gov.pt" target="_blank" rel="noopener" style="color:#fff">www.consumidor.gov.pt</a>.</p>
    </div>`;
    showPage('legal');
    if(section){ const el = document.getElementById('lg-' + section); if(el) setTimeout(()=> el.scrollIntoView({block:'start'}), 30); }
  }

  /* =====================================================================
     ADMIN — ENCOMENDAS ONLINE E DEVOLUÇÕES
     ===================================================================== */
  const adm = { sub:null, filter:'novas', q:'', orders:[], returns:[], known:{}, loaded:false };
  const NEEDS_ACTION = ['paga','pagar_na_loja'];
  const FILTERS = [
    ['novas','Por tratar', o=> NEEDS_ACTION.includes(o.status)],
    ['curso','Em curso', o=> ['em_preparacao','pronta','enviada'].includes(o.status)],
    ['porpagar','Por pagar', o=> ['por_pagar','pagamento_falhou'].includes(o.status)],
    ['concluidas','Concluídas', o=> ['entregue','levantada'].includes(o.status)],
    ['canceladas','Canceladas', o=> ['cancelada','reembolsada'].includes(o.status)],
    ['todas','Todas', ()=> true],
  ];
  const isAdminOpen = ()=> { const v = document.getElementById('admin-view'), a = document.getElementById('admin-shell'); return !!(v && a && getComputedStyle(v).display !== 'none' && getComputedStyle(a).display !== 'none'); };

  function mountAdmin(){
    const row = $('#tab-encomendas .subtab-row'); if(!row || $('#subtab-online')) return;
    row.insertAdjacentHTML('afterbegin', `<div class="subtab" id="subtab-online" onclick="setOrdersTab('online')">Loja online<span class="xs-count"></span></div>`);
    row.insertAdjacentHTML('beforeend', `<div class="subtab" id="subtab-returns" onclick="setOrdersTab('returns')">Devoluções<span class="xs-count"></span></div>`);
    const panel = $('#orders-list').closest('.panel');
    panel.insertAdjacentHTML('afterend', `<div id="xs-admin-shop" class="xs-hide"></div>`);
    $('#xs-admin-shop').addEventListener('click', adminClick);
    $('#xs-admin-shop').addEventListener('input', e=>{ if(e.target.id === 'xs-aq'){ adm.q = e.target.value; drawAdminList(true); } });

    const orig = window.setOrdersTab;
    window.setOrdersTab = function(t){
      const mine = t === 'online' || t === 'returns';
      adm.sub = mine ? t : null;
      $('#subtab-online').classList.toggle('active', t === 'online');
      $('#subtab-returns').classList.toggle('active', t === 'returns');
      panel.classList.toggle('xs-hide', mine);
      const nb = $('#tab-encomendas .panel-head .btn'); if(nb) nb.classList.toggle('xs-hide', mine);
      $('#xs-admin-shop').classList.toggle('xs-hide', !mine);
      if(mine){
        $('#subtab-clients').classList.remove('active'); $('#subtab-suppliers').classList.remove('active');
        $('#orders-sub').textContent = t === 'online' ? 'Encomendas feitas no site' : 'Pedidos de devolução dos clientes';
        loadAdminData().then(drawAdminList);
      } else orig(t);
    };
    const origSwitch = window.switchAdminTab;
    let firstOrders = true;
    window.switchAdminTab = function(tab){ origSwitch(tab); if(tab === 'encomendas' && (firstOrders || adm.sub)){ firstOrders = false; window.setOrdersTab(adm.sub || 'online'); } };
  }

  async function loadAdminData(){
    if(!(await XDB.isStaff())) return;
    const [orders, returns] = await Promise.all([XDB.orders.all(), XDB.returns.all()]);
    adm.orders = orders; adm.returns = returns; adm.loaded = true;
    orders.forEach(o=>{ adm.known[o.id] = o.status; });
    updateAdminBadges();
  }

  function updateAdminBadges(){
    const nOrders = adm.orders.filter(o=> NEEDS_ACTION.includes(o.status)).length;
    const nRet = adm.returns.filter(r=> r.status === 'pedido').length;
    const so = $('#subtab-online .xs-count'); if(so) so.textContent = nOrders || '';
    const sr = $('#subtab-returns .xs-count'); if(sr) sr.textContent = nRet || '';
    const item = $('.bnav-item[data-tab="encomendas"]');
    if(item){ let b = item.querySelector('.xs-bdg'); const n = nOrders + nRet; if(n){ if(!b){ b = document.createElement('span'); b.className = 'xs-bdg'; item.appendChild(b); } b.textContent = n; } else if(b) b.remove(); }
  }

  function drawAdminList(keepFocus){
    const box = $('#xs-admin-shop'); if(!box || !adm.sub) return;
    if(adm.sub === 'returns') return drawAdminReturns();
    const q = adm.q.trim().toLowerCase();
    const f = FILTERS.find(x=> x[0] === adm.filter) || FILTERS[0];
    const list = adm.orders.filter(f[2]).filter(o=> !q || [o.number, o.name, o.email, o.phone, (o.items||[]).map(l=>l.name).join(' ')].join(' ').toLowerCase().includes(q));
    const head = `<div class="xs-admin-head"><input id="xs-aq" placeholder="Procurar por nº, cliente, email ou produto" value="${esc(adm.q)}"><button class="xs-btn sm ghost" data-a="settings">Definições da loja</button><button class="xs-btn sm ghost" data-a="refresh">Atualizar</button></div>
      <div class="xs-filters">${FILTERS.map(([k,l,fn])=>`<button class="${adm.filter===k?'on':''}" data-filter="${k}">${l}<em>${adm.orders.filter(fn).length}</em></button>`).join('')}</div>`;
    const rows = list.length ? list.map(o=>`<div class="xs-arow" data-ord="${o.id}">
        ${thumb((o.items[0]||{}).photo)}
        <div><div class="t">${NEEDS_ACTION.includes(o.status)?'<span class="xs-new"></span>':''}${esc(o.number)} · ${esc(o.name||o.email)}</div>
          <div class="s">${(o.items||[]).map(l=>esc(l.name)+(l.qty>1?` ×${l.qty}`:'')).join(', ')}</div>
          <div class="s">${fmtDT(o.created_at)} · ${o.delivery.method==='ship'?'Envio':'Levantamento'} · ${o.payment_method==='loja'?'Paga na loja':(PAID_WITH[o.paid_with]||'Online')}</div></div>
        <div class="r">${pill(STATUS, o.status)}<b>${money(o.total)}</b></div></div>`).join('')
      : `<div class="empty-inline" style="padding:26px 6px">${adm.loaded ? 'Sem encomendas neste filtro.' : 'A carregar…'}</div>`;
    if(keepFocus === true && $('#xs-aq')){ box.querySelector('.panel').innerHTML = rows; return; }
    box.innerHTML = head + `<div class="panel">${rows}</div>`;
  }

  function drawAdminReturns(){
    const box = $('#xs-admin-shop');
    const rows = adm.returns.length ? adm.returns.map(r=>{ const o = adm.orders.find(x=>x.id===r.order_id) || {}; return `<div class="xs-arow" data-ret="${r.id}" style="grid-template-columns:1fr auto">
        <div><div class="t">${r.status==='pedido'?'<span class="xs-new"></span>':''}${esc(o.number||('#'+r.order_id))} · ${esc(o.name||r.email||'')}</div><div class="s">${esc(r.items||'')}</div><div class="s">${esc(r.reason||'')} · ${fmtDT(r.created_at)}</div></div>
        <div class="r">${pill(RSTATUS, r.status)}<b>${money(o.total)}</b></div></div>`; }).join('')
      : `<div class="empty-inline" style="padding:26px 6px">Sem pedidos de devolução.</div>`;
    box.innerHTML = `<div class="xs-admin-head"><span class="xs-muted" style="font-size:13.5px">O cliente pede a devolução na conta dele. Aprova, recebe o artigo e faz o reembolso no painel da Stripe (ou na loja).</span><span class="xs-sp"></span><button class="xs-btn sm ghost" data-a="refresh">Atualizar</button></div><div class="panel">${rows}</div>`;
  }

  function adminClick(e){
    const f = e.target.closest('[data-filter]'); if(f){ adm.filter = f.dataset.filter; drawAdminList(); return; }
    const o = e.target.closest('[data-ord]'); if(o){ adminOrderModal(+o.dataset.ord); return; }
    const r = e.target.closest('[data-ret]'); if(r){ adminReturnModal(+r.dataset.ret); return; }
    const a = e.target.closest('[data-a]'); if(!a) return;
    if(a.dataset.a === 'refresh') loadAdminData().then(drawAdminList);
    if(a.dataset.a === 'settings') settingsModal();
  }

  function nextStatuses(o){
    const ship = o.delivery.method === 'ship';
    const base = ship ? ['em_preparacao','enviada','entregue'] : ['em_preparacao','pronta','levantada'];
    if(['por_pagar','pagamento_falhou','pagar_na_loja'].includes(o.status)) return ['paga'].concat(base);
    return base;
  }

  async function changeStock(o, sign){
    // sign: -1 baixa stock, +1 repõe
    for(const [type, list, save] of [['device', devices, saveDevices], ['accessory', accessories, saveAccessories]]){
      let ch = false;
      (o.items||[]).forEach(l=>{ if(l.type !== type) return; const it = list.find(x=>Number(x.id)===Number(l.id)); if(it && stockOf(it) != null){ it.qty = Math.max(0, Number(it.qty) + sign*(l.qty||1)); ch = true; } });
      if(ch) await save();
    }
  }

  async function setOrderStatus(o, status, extra){
    const patch = { status, history: [...(o.history||[]), { status, at:new Date().toISOString(), by:'loja' }], ...(extra||{}) };
    if(status === 'paga' && !o.stock_done){ await changeStock(o, -1); patch.stock_done = true; }
    if(status === 'levantada' && o.payment_method === 'loja' && !o.stock_done){ await changeStock(o, -1); patch.stock_done = true; }
    const n = await XDB.orders.update(o.id, patch);
    const i = adm.orders.findIndex(x=>x.id===o.id); if(i>=0 && n) adm.orders[i] = n;
    adm.known[o.id] = status; updateAdminBadges(); drawAdminList();
    return n;
  }

  function mailtoFor(o, status){
    const msgs = {
      em_preparacao:`Olá ${o.name||''},\n\nA tua encomenda ${o.number} já está a ser preparada.`,
      pronta:`Olá ${o.name||''},\n\nA tua encomenda ${o.number} está pronta a levantar na Xtech Store (${STORE.addr}).${o.payment_method==='loja'?`\nValor a pagar no levantamento: ${money(o.total)}.`:''}`,
      enviada:`Olá ${o.name||''},\n\nA tua encomenda ${o.number} foi enviada${o.tracking&&o.tracking.code?` por ${o.tracking.company||''}. Código de seguimento: ${o.tracking.code}`:''}.`,
      cancelada:`Olá ${o.name||''},\n\nA tua encomenda ${o.number} foi cancelada.`,
    };
    const body = (msgs[status] || `Olá ${o.name||''},\n\nAtualização da tua encomenda ${o.number}: ${(STATUS[status]||{}).l||status}.`) + `\n\nPodes acompanhar tudo em A minha conta, no site.\n\nObrigado,\nXtech Store\n${STORE.phone}`;
    return `mailto:${encodeURIComponent(o.email)}?subject=${encodeURIComponent('Encomenda ' + o.number + ' — ' + ((STATUS[status]||{}).l||''))}&body=${encodeURIComponent(body)}`;
  }

  function adminOrderModal(id){
    const o = adm.orders.find(x=>x.id===id); if(!o) return;
    const ship = o.delivery.method === 'ship';
    const carrierList = (typeof carriers !== 'undefined' && carriers.length ? carriers : [{name:'CTT'}]).map(c=>c.name);
    renderModal(`<div class="modal-box xs-modal wide">
      <div class="modal-head"><h3>${esc(o.number)}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div class="xs-row" style="flex-wrap:wrap;margin-bottom:6px">${pill(STATUS, o.status)}<span class="xs-muted" style="font-size:13.5px">${fmtDT(o.created_at)}</span><span class="xs-sp"></span><b style="font-size:20px">${money(o.total)}</b></div>
      <div class="xs-grid2" style="margin-top:12px">
        <div><h4 class="xs-muted" style="margin:0 0 8px;font-size:13px">CLIENTE</h4><div class="xs-kv"><span>Nome</span><b>${esc(o.name)}</b><span>Email</span><b>${esc(o.email)}</b><span>Telemóvel</span><b>${esc(o.phone)}</b><span>NIF</span><b>${esc(o.nif||'Consumidor final')}</b></div></div>
        <div><h4 class="xs-muted" style="margin:0 0 8px;font-size:13px">ENTREGA E PAGAMENTO</h4><div class="xs-kv"><span>Entrega</span><b>${ship ? `${esc(o.delivery.address)}<br>${esc(o.delivery.zip)} ${esc(o.delivery.city)}` : 'Levantamento na loja'}</b><span>Pagamento</span><b>${o.payment_method==='loja'?'Na loja ao levantar':(PAID_WITH[o.paid_with]||'Online (Stripe)')}</b>${o.stripe_session_id?`<span>Stripe</span><b style="font-size:12px;word-break:break-all">${esc(o.stripe_session_id)}</b>`:''}</div></div>
      </div>
      <div class="xs-sec"><h4>ARTIGOS</h4>${(o.items||[]).map(l=>`<div class="xs-line xsm">${thumb(l.photo)}<div><div class="xs-lname" style="font-size:14px">${esc(l.name)}${l.qty>1?` × ${l.qty}`:''}</div><div class="xs-lopts">${(l.options||[]).map(x=>esc(x.name)).join(' · ')}</div></div><div class="xs-lprice" style="font-size:14px">${money(l.total)}</div></div>`).join('')}
        <div class="xs-tot"><span>Subtotal</span><span>${money(o.subtotal)}</span></div><div class="xs-tot"><span>${ship?'Envio':'Levantamento'}</span><span>${money(o.shipping)}</span></div></div>
      ${o.notes ? `<div class="xs-sec"><h4>NOTAS</h4><p style="margin:0;white-space:pre-wrap;font-size:14px">${esc(o.notes)}</p></div>` : ''}
      ${!['cancelada','reembolsada'].includes(o.status) ? `<div class="xs-sec"><h4>MUDAR ESTADO</h4><div class="xs-status-btns">${nextStatuses(o).map(s=>`<button class="xs-btn sm ${o.status===s?'cur':'ghost'}" data-st="${s}">${s==='paga' && o.payment_method==='loja' ? 'Marcar como paga' : STATUS[s].l}</button>`).join('')}</div>
        <label class="xs-check" style="margin-top:12px"><input type="checkbox" id="xs-mail" checked>Abrir email para avisar o cliente</label></div>` : ''}
      ${ship && !['cancelada','reembolsada'].includes(o.status) ? `<div class="xs-sec"><h4>SEGUIMENTO DO ENVIO</h4><div class="xs-f"><div class="xs-in"><label>Transportadora</label><select id="xs-tc">${carrierList.map(c=>`<option ${o.tracking&&o.tracking.company===c?'selected':''}>${esc(c)}</option>`).join('')}</select></div><div class="xs-in"><label>Código de seguimento</label><input id="xs-tn" value="${esc((o.tracking||{}).code||'')}"></div></div><button class="xs-btn sm ghost" data-x="track" style="margin-top:10px">Guardar seguimento</button></div>` : ''}
      <div class="xs-sec"><h4>HISTÓRICO</h4>${(o.history||[]).map(h=>`<div class="xs-row" style="font-size:13.5px;padding:3px 0"><span>${esc((STATUS[h.status]||{}).l||h.status)}</span><span class="xs-sp"></span><span class="xs-muted">${fmtDT(h.at)}${h.by?` · ${esc(h.by)}`:''}</span></div>`).join('')}</div>
      <div class="xs-sec xs-row" style="flex-wrap:wrap">
        <a class="xs-btn sm ghost" href="${mailtoFor(o, o.status)}">Enviar email</a>
        ${o.phone ? `<a class="xs-btn sm ghost" target="_blank" rel="noopener" href="https://wa.me/351${esc(o.phone.replace(/\D/g,'').replace(/^351/,''))}">WhatsApp</a>` : ''}
        <span class="xs-sp"></span>
        ${!['cancelada','reembolsada'].includes(o.status) ? `<button class="xs-btn sm danger" data-x="cancel">Cancelar encomenda</button>` : ''}
        ${['paga','em_preparacao','pronta','enviada','entregue','levantada','cancelada'].includes(o.status) && o.payment_method==='online' ? `<button class="xs-btn sm ghost" data-x="refund">Marcar reembolsada</button>` : ''}
      </div>
    </div>`);
    const box = $('.xs-modal');
    box.addEventListener('click', async e=>{
      const s = e.target.closest('[data-st]');
      if(s){
        const st = s.dataset.st; if(st === o.status) return;
        if(st === 'enviada' && !($('#xs-tn') && $('#xs-tn').value.trim()) && !(await ask('Marcar como enviada sem código de seguimento?', 'Marcar enviada'))) return;
        const extra = {}; if(st === 'enviada' && $('#xs-tn')) extra.tracking = { company: $('#xs-tc').value, code: $('#xs-tn').value.trim() };
        const mail = $('#xs-mail') && $('#xs-mail').checked;
        const n = await setOrderStatus(o, st, extra); toast('Estado atualizado: ' + STATUS[st].l);
        if(mail && ['em_preparacao','pronta','enviada'].includes(st)) location.href = mailtoFor(n || o, st);
        adminOrderModal(o.id); return;
      }
      const x = e.target.closest('[data-x]'); if(!x) return;
      if(x.dataset.x === 'track'){ const n = await XDB.orders.update(o.id, { tracking:{ company: $('#xs-tc').value, code: $('#xs-tn').value.trim() } }); const i = adm.orders.findIndex(y=>y.id===o.id); if(n) adm.orders[i] = n; toast('Seguimento guardado.'); adminOrderModal(o.id); }
      if(x.dataset.x === 'cancel'){
        const paid = o.stock_done;
        if(!(await ask(`Cancelar ${o.number}?${paid ? '\n\nO stock dos artigos volta a ser reposto.' : ''}${o.payment_method==='online' && !['por_pagar','pagamento_falhou'].includes(o.status) ? '\n\nAtenção: se já foi paga, faz o reembolso no painel da Stripe.' : ''}`, 'Cancelar encomenda', true))) return;
        if(paid) await changeStock(o, +1);
        await setOrderStatus(o, 'cancelada', { stock_done:false }); toast('Encomenda cancelada.'); adminOrderModal(o.id);
      }
      if(x.dataset.x === 'refund'){
        if(!(await ask('Confirmas que já fizeste o reembolso no painel da Stripe?', 'Sim, marcar reembolsada'))) return;
        await setOrderStatus(o, 'reembolsada'); toast('Marcada como reembolsada.'); adminOrderModal(o.id);
      }
    });
  }

  function adminReturnModal(id){
    const r = adm.returns.find(x=>x.id===id); if(!r) return;
    const o = adm.orders.find(x=>x.id===r.order_id) || {};
    renderModal(`<div class="modal-box xs-modal wide">
      <div class="modal-head"><h3>Devolução · ${esc(o.number||'#'+r.order_id)}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div class="xs-row" style="margin-bottom:12px">${pill(RSTATUS, r.status)}<span class="xs-muted" style="font-size:13.5px">${fmtDT(r.created_at)}</span></div>
      <div class="xs-kv"><span>Cliente</span><b>${esc(o.name||'')} · ${esc(r.email||'')} · ${esc(o.phone||'')}</b><span>Artigos</span><b>${esc(r.items)}</b><span>Motivo</span><b>${esc(r.reason)}</b>${r.details?`<span>Detalhes</span><b style="white-space:pre-wrap">${esc(r.details)}</b>`:''}<span>Pago com</span><b>${o.payment_method==='loja'?'Na loja':(PAID_WITH[o.paid_with]||'Online')} · ${money(o.total)}</b></div>
      <div class="xs-sec"><h4>RESPOSTA AO CLIENTE (aparece na conta dele)</h4><div class="xs-in"><textarea id="xs-rn" placeholder="Ex.: Aprovado. Traz o artigo à loja com a caixa e acessórios.">${esc(r.admin_note||'')}</textarea></div></div>
      <div class="xs-sec"><h4>ESTADO</h4><div class="xs-status-btns">${Object.keys(RSTATUS).map(s=>`<button class="xs-btn sm ${r.status===s?'cur':'ghost'}" data-rs="${s}">${RSTATUS[s].l}</button>`).join('')}</div>
        <p class="xs-muted" style="font-size:12.5px;margin:12px 0 0;line-height:1.5">Ao marcar "Reembolsada", faz o reembolso no painel da Stripe (Pagamentos → a encomenda → Reembolsar) ou na loja. Ao marcar "Artigo recebido" podes repor o stock.</p></div>
    </div>`);
    $('.xs-modal').addEventListener('click', async e=>{
      const b = e.target.closest('[data-rs]'); if(!b) return;
      const st = b.dataset.rs;
      const patch = { status: st, admin_note: $('#xs-rn').value.trim() };
      if(st === 'recebida' && o.id && (await ask('Repor o stock dos artigos devolvidos?', 'Repor stock'))) await changeStock(o, +1);
      const n = await XDB.returns.update(r.id, patch);
      const i = adm.returns.findIndex(x=>x.id===r.id); if(n) adm.returns[i] = n; else Object.assign(adm.returns[i], patch);
      if(st === 'reembolsada' && o.id && o.status !== 'reembolsada' && (await ask('Marcar também a encomenda como reembolsada?', 'Marcar reembolsada'))) await setOrderStatus(o, 'reembolsada');
      updateAdminBadges(); drawAdminList(); toast('Devolução atualizada.'); adminReturnModal(r.id);
    });
  }

  function settingsModal(){
    const s = settings || {};
    renderModal(`<div class="modal-box xs-modal"><div class="modal-head"><h3>Definições da loja</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
      <label class="xs-check" style="margin-bottom:14px;color:#fff"><input type="checkbox" id="xs-s-ship" ${s.allowShipping!==false?'checked':''}>Fazer envios para casa</label>
      <div class="xs-f"><div class="xs-in"><label>Custo do envio (€)</label><input id="xs-s-fee" type="number" step="0.01" min="0" value="${s.shipFee!=null?s.shipFee:4.9}"></div>
      <div class="xs-in"><label>Envio grátis a partir de (€)</label><input id="xs-s-free" type="number" step="1" min="0" value="${s.freeShipFrom||0}" placeholder="0 = nunca"></div></div>
      <p class="xs-muted" style="font-size:12.5px;line-height:1.5">O levantamento na loja é sempre grátis. As formas de pagamento online (MB WAY, Multibanco, cartão…) ligam-se no painel da Stripe → Definições → Métodos de pagamento.</p>
      <button class="xs-btn block" id="xs-s-go">Guardar</button></div>`);
    $('#xs-s-go').onclick = async ()=>{
      settings = { allowShipping: $('#xs-s-ship').checked, shipFee: Number($('#xs-s-fee').value)||0, freeShipFrom: Number($('#xs-s-free').value)||0 };
      await storeSet('shopSettings', settings); closeModal(); toast('Definições guardadas.');
    };
  }

  /* ---------- notificação de encomenda nova ---------- */
  function chime(){
    try{
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [[880,0],[1318.5,.16]].forEach(([f,t])=>{ const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0, ctx.currentTime+t); g.gain.linearRampToValueAtTime(.25, ctx.currentTime+t+.02); g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime+t+.9); o.connect(g).connect(ctx.destination); o.start(ctx.currentTime+t); o.stop(ctx.currentTime+t+1); });
    }catch(e){}
  }
  function notifyOrder(o){
    chime();
    const el = document.createElement('div'); el.className = 'xs-toast-order';
    el.innerHTML = `<span style="font-size:22px">🛍️</span><div>Nova encomenda ${esc(o.number)} — ${money(o.total)}<small>${esc(o.name||o.email)} · ${o.payment_method==='loja'?'paga ao levantar':'paga online'}</small></div>`;
    el.onclick = ()=>{ el.remove(); if(isAdminOpen()){ window.switchAdminTab('encomendas'); window.setOrdersTab('online'); adminOrderModal(o.id); } };
    document.body.appendChild(el); setTimeout(()=> el.remove(), 9000);
    try{ if('Notification' in window && Notification.permission === 'granted') new Notification('Nova encomenda ' + o.number, { body: `${o.name||o.email} · ${money(o.total)}` }); }catch(e){}
  }

  async function onOrdersChange(p){
    if(!isAdminOpen() || !(await XDB.isStaff())) return;
    const prev = { ...adm.known };
    await loadAdminData();
    adm.orders.forEach(o=>{ if(NEEDS_ACTION.includes(o.status) && !NEEDS_ACTION.includes(prev[o.id]) && !['em_preparacao','pronta','enviada','entregue','levantada'].includes(prev[o.id])) notifyOrder(o); });
    if(adm.sub) drawAdminList();
  }

  /* ---------- pedidos de orçamento do site → lista do admin ---------- */
  const quoteSynced = {};
  async function importInbox(){
    if(!isAdminOpen() || !(await XDB.isStaff()) || typeof quoteRequests === 'undefined') return;
    const pend = await XDB.inbox.pending(); if(!pend.length) return;
    let n = 0;
    for(const r of pend){
      if(r.kind !== 'quote') { await XDB.inbox.update(r.id, { imported:true }); continue; }
      if(quoteRequests.some(q=> q.inboxId === r.id)) { await XDB.inbox.update(r.id, { imported:true }); continue; }
      const p = r.payload || {};
      const id = quoteRequests.length ? Math.max(...quoteRequests.map(x=>x.id)) + 1 : 1;
      quoteRequests.push({ id, inboxId: r.id, name:p.name||'Cliente site', phone:p.phone||'', email:(p.email||r.email||'').toLowerCase(), device:p.device||'—', issue:p.issue||'Pedido via site', status:'Pendente', quotedPrice:0, emailDraft:'', date:(r.created_at||'').slice(0,10) || new Date().toISOString().slice(0,10) });
      quoteSynced[r.id] = 'Pendente'; n++;
    }
    await saveQuoteRequests();
    for(const r of pend) await XDB.inbox.update(r.id, { imported:true });
    if(n){ chime(); toast(n === 1 ? 'Novo pedido de orçamento recebido.' : `${n} novos pedidos de orçamento.`); try{ if(typeof renderQuoteRequestsList === 'function') renderQuoteRequestsList(); }catch(e){} }
  }
  function wrapQuoteSave(){
    const orig = window.saveQuoteRequests;
    window.saveQuoteRequests = async function(){
      await orig.apply(this, arguments);
      if(typeof quoteRequests === 'undefined') return;
      for(const q of quoteRequests){
        if(!q.inboxId) continue;
        const st = q.status + (q.quotedPrice ? '|' + q.quotedPrice : '');
        if(quoteSynced[q.inboxId] !== st){ quoteSynced[q.inboxId] = st; try{ await XDB.inbox.update(q.inboxId, { status: q.status, payload: { name:q.name, phone:q.phone, email:q.email, device:q.device, issue:q.issue, quotedPrice:q.quotedPrice||0 } }); }catch(e){} }
      }
    };
    if(typeof quoteRequests !== 'undefined') quoteRequests.forEach(q=>{ if(q.inboxId) quoteSynced[q.inboxId] = q.status + (q.quotedPrice ? '|' + q.quotedPrice : ''); });
  }

  /* ---------- login do admin com contas reais (modo live) ---------- */
  function wrapAdminAuth(){
    if(!LIVE) return;
    const hint = ()=> { const h = document.getElementById('login-hint'); if(h) h.textContent = 'Entra com a tua conta do site (tem de estar registada na equipa)'; };
    window.checkAdminLoginState = async function(){
      hint();
      document.getElementById('admin-login-wrap').style.display = 'flex';
      document.getElementById('admin-shell').style.display = 'none';
      document.getElementById('admin-bottom-nav').style.display = 'none';
      const u = XDB.auth.user();
      if(u){ document.getElementById('login-email').value = u.email; if(await XDB.isStaff()) return enterStaff(u); }
    };
    window.handleAdminLogin = async function(){
      const email = document.getElementById('login-email').value.trim().toLowerCase();
      const pass = document.getElementById('login-pass').value;
      if(!email || !pass){ toast('Preenche email e palavra-passe.'); return; }
      try{
        const u = XDB.auth.user();
        if(!u || u.email !== email) await XDB.auth.signIn(email, pass);
        syncSession();
        if(!(await XDB.isStaff())){ toast('Esta conta não pertence à equipa. Pede ao administrador para te adicionar.'); return; }
        enterStaff(XDB.auth.user());
      }catch(e){ toast(e.message); }
    };
    window.recoverAdminAccess = async function(){
      const email = document.getElementById('login-email').value.trim().toLowerCase();
      if(!email){ toast('Escreve o teu email no campo acima e carrega outra vez.'); return; }
      try{
        if(email === 'xtechstorept@gmail.com'){ const r = await fetch('/.netlify/functions/setup-admin'); if(r.ok){ toast('Enviámos um link para ' + email + ' (vê também o Spam).'); return; } }
        await XDB.auth.resetPassword(email); toast('Enviámos um link para ' + email + ' para criares uma palavra-passe nova.');
      }catch(e){ toast(e.message); }
    };
    const origLogout = window.adminLogout;
    window.adminLogout = async function(){ await XDB.auth.signOut(); syncSession(); origLogout(); };
    window.openTeamModal = function(){
      renderModal(`<div class="modal-box xs-modal"><div class="modal-head"><h3>Novo membro</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
        <div class="xs-in"><label>Nome</label><input id="tm-name"></div>
        <div class="xs-in"><label>Email</label><input id="tm-email" type="email"></div>
        <div class="xs-in"><label>Função</label><select id="tm-role"><option>Admin</option><option>Técnico</option><option>Vendedor</option></select></div>
        <p class="xs-muted" style="font-size:12.5px;line-height:1.5">Depois de adicionares, a pessoa cria conta no site (Entrar → Criar conta) com este mesmo email e confirma o email. A partir daí entra na Área reservada com essa conta.</p>
        <button class="xs-btn block" onclick="saveNewMember()">Adicionar</button></div>`);
    };
    window.saveNewMember = async function(){
      const name = document.getElementById('tm-name').value.trim(), email = document.getElementById('tm-email').value.trim().toLowerCase(), role = document.getElementById('tm-role').value;
      if(!name || !/^\S+@\S+\.\S+$/.test(email)){ toast('Preenche nome e email.'); return; }
      try{ await XDB.staff.add(email, name, role); }catch(e){ toast('Não foi possível adicionar: ' + e.message); return; }
      if(!team.some(m=> (m.email||'').toLowerCase() === email)) team.push({ id: team.length ? Math.max(...team.map(x=>x.id))+1 : 1, name, email, role, pass:'' });
      await saveTeam(); closeModal(); renderTeam(); toast('Membro adicionado. Agora tem de criar conta no site com este email.');
    };
    const origDel = window.deleteMember;
    window.deleteMember = function(id){
      const m = team.find(x=>x.id===id); const email = m && m.email;
      origDel(id);
      setTimeout(()=>{ if(email && !team.some(x=>x.email===email)) XDB.staff.remove(email).catch(()=>{}); }, 300);
    };
  }
  async function enterStaff(u){
    await XDB.kvReload();
    if(typeof team !== 'undefined' && !team.some(m=> (m.email||'').toLowerCase() === u.email)){
      // primeira vez: troca a conta de exemplo pela conta real de quem entrou
      if(team.length === 1 && team[0].email === 'admin@xtechstore.pt') team.length = 0;
      team.push({ id: team.length ? Math.max(...team.map(x=>x.id))+1 : 1, name: u.name, email: u.email, role:'Admin', pass:'' });
      try{ await saveTeam(); }catch(e){}
    }
    if(typeof window.enterAdmin === 'function') window.enterAdmin({ name: u.name, email: u.email });
    offerImport();
  }

  /* ---------- importar os dados antigos (deste browser) para a base de dados ---------- */
  const DATA_KEYS = ['devices','parts','repairs','ordersClients','ordersSuppliers','team','custRequests','custOrders','accessories','expenses','carriers','quoteRequests','tasks','storeCapital','shopSettings'];
  function localData(){
    const out = {};
    DATA_KEYS.forEach(k=>{ try{ const raw = localStorage.getItem('xtech_' + k); if(raw != null) out[k] = JSON.parse(raw); }catch(e){} });
    return out;
  }
  async function offerImport(){
    if(!LIVE) return;
    const remoteHas = (await XDB.kvReload(['devices']))[0];
    const loc = localData();
    if(remoteHas || !Object.keys(loc).length || localStorage.getItem('xtech_imported')) return;
    if(!(await ask('Encontrei dados da loja guardados neste browser (produtos, reparações, finanças…).\n\nQueres copiá-los para a base de dados online, para ficarem disponíveis em todos os dispositivos?', 'Copiar dados'))) return;
    await importData(loc); localStorage.setItem('xtech_imported', '1');
  }
  async function importData(obj){
    for(const k of Object.keys(obj)) if(DATA_KEYS.includes(k)) await storeSet(k, obj[k]);
    await loadAll(); try{ if(typeof refreshAdmin === 'function') await refreshAdmin(); }catch(e){}
    try{ renderCatalog(); }catch(e){}
    toast('Dados importados.');
  }
  function mountDataTools(){
    const tab = document.getElementById('tab-equipa'); if(!tab || document.getElementById('xs-data')) return;
    tab.insertAdjacentHTML('beforeend', `<div class="panel" id="xs-data" style="margin-top:16px"><div class="panel-head"><div><h3 style="margin:0">Dados da loja</h3><p class="admin-sub" style="margin:4px 0 0">${LIVE ? 'Tudo fica guardado na base de dados online.' : 'Modo demonstração: os dados estão só neste browser.'}</p></div></div>
      <div class="xs-row" style="flex-wrap:wrap;margin-top:10px"><button class="xs-btn sm ghost" id="xs-exp">Descarregar cópia de segurança</button><label class="xs-btn sm ghost" style="cursor:pointer">Restaurar cópia<input type="file" accept="application/json" id="xs-imp" hidden></label>${LIVE?'<button class="xs-btn sm ghost" id="xs-imp-local">Importar dados deste browser</button>':''}</div></div>`);
    $('#xs-exp').onclick = async ()=>{
      const out = { _xtech:true, at:new Date().toISOString() };
      for(const k of DATA_KEYS){ const v = await storeGet(k); if(v != null) out[k] = v; }
      if(LIVE){ out._orders = await XDB.orders.all(); out._returns = await XDB.returns.all(); }
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], {type:'application/json'}));
      a.download = `xtech-backup-${new Date().toISOString().slice(0,10)}.json`; a.click();
    };
    $('#xs-imp').onchange = async e=>{
      const f = e.target.files[0]; if(!f) return;
      try{ const obj = JSON.parse(await f.text()); if(!(await ask('Substituir os dados atuais pelos da cópia de segurança?', 'Substituir', true))) return; await importData(obj); }catch(err){ toast('Ficheiro inválido.'); }
    };
    const il = $('#xs-imp-local'); if(il) il.onclick = async ()=>{ const loc = localData(); if(!Object.keys(loc).length){ toast('Não há dados antigos neste browser.'); return; } if(await ask('Copiar os dados deste browser para a base de dados online? Substitui os dados atuais.', 'Copiar dados', true)) await importData(loc); };
  }

  /* =====================================================================
     LIGAR TUDO AO SITE
     ===================================================================== */
  function wire(){
    // conta
    window.openAccountModal = ()=> XDB.auth.user() ? openAccount('orders') : openAuth('login');
    window.loginCustomer = ()=> openAuth('login');
    window.logoutCustomer = logout;
    window.openEditProfile = ()=> openAccount('profile');
    window.renderAccountPage = renderAccount;
    // produtos
    window.requestProduct = ()=> showPage('loja');
    const origOpen = window.openProductDetail;
    window.openProductDetail = function(type, id){ origOpen(type, id); try{ decorateProductPage(type, id); }catch(e){} };
    // orçamentos via chat
    window.submitQuoteRequest = submitQuote;
    // páginas novas
    const origShow = window.showPage;
    window.showPage = function(name){
      const pd = document.getElementById('product-detail-root');
      if(pd && !pd.classList.contains('hide') && typeof closeProductDetail === 'function') closeProductDetail();
      if(name === 'checkout'){ ensurePage('page-checkout'); bindCheckout(); co.error = ''; }
      if(name === 'obrigado') ensurePage('page-obrigado');
      if(name === 'legal') ensurePage('page-legal');
      origShow(name);
      if(name === 'checkout') renderCheckout();
      if(name !== 'obrigado') clearInterval(thanksTimer);
    };
    // rodapé: links legais
    $$('#site-view footer a').forEach(a=>{
      const t = a.textContent.trim();
      if(/privacidade/i.test(t)) a.setAttribute('onclick', "Shop.legal('privacidade')");
      if(/termos/i.test(t)){ a.setAttribute('onclick', "Shop.legal('termos')"); a.insertAdjacentHTML('afterend', `<a href="javascript:void(0)" onclick="Shop.legal('devolucoes')">Envios e devoluções</a><a href="https://www.livroreclamacoes.pt" target="_blank" rel="noopener">Livro de Reclamações</a>`); }
    });
    // catálogo: marcar esgotados
    const pg = document.getElementById('products-grid');
    if(pg) new MutationObserver(decorateCatalog).observe(pg, { childList:true });
    decorateCatalog();
    // admin
    bindAccount();
    mountAdmin(); wrapQuoteSave(); wrapAdminAuth(); mountDataTools();
    const origRefresh = window.refreshAdmin;
    window.refreshAdmin = async function(){ if(LIVE) await XDB.kvReload(); await origRefresh(); settings = (await storeGet('shopSettings')) || settings; loadAdminData().then(()=>{ if(adm.sub) drawAdminList(); }); importInbox(); };
    const origEnter = window.enterAdmin;
    window.enterAdmin = function(m){ origEnter(m); try{ if('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); }catch(e){} };
    XDB.on('orders', onOrdersChange);
    XDB.on('returns', ()=>{ if(isAdminOpen()) loadAdminData().then(()=>{ if(adm.sub) drawAdminList(); }); });
    XDB.on('inbox', ()=> importInbox());
    if(LIVE) XDB.on('kv', async p=>{
      const k = p && p.new && p.new.key; if(!k) return;
      if(k === 'devices' && p.new.value){ devices = p.new.value; }
      if(k === 'accessories' && p.new.value){ accessories = p.new.value; }
      if(k === 'shopSettings') settings = p.new.value || {};
    });
    // clientes: encomenda atualizada → refrescar a conta se estiver aberta
    XDB.on('orders', ()=>{ const ap = document.getElementById('account-page'); if(ap && !ap.classList.contains('hide') && user) loadAccountData().then(drawAccount); });
    XDB.on('auth', ({event})=>{ syncSession(); if(event === 'PASSWORD_RECOVERY') openNewPassword(); });
  }

  async function start(){
    await XDB.ready;
    if(!LIVE && XDB.auth._load) await XDB.auth._load();
    settings = (await storeGet('shopSettings')) || {};
    syncSession();
    // a página "A minha conta" estava depois do rodapé: passa para antes dele
    const ap = document.getElementById('account-page'), ft = document.querySelector('#site-view footer.site-footer');
    if(ap && ft && (ft.compareDocumentPosition(ap) & Node.DOCUMENT_POSITION_FOLLOWING)) ft.parentNode.insertBefore(ap, ft);
    mountCartUI(); wire();
    // regresso da página de pagamento do Stripe
    const qs = new URLSearchParams(location.search);
    afterGoogleReturn();
    // endereços diretos das páginas legais: /privacidade e /termos (ver netlify.toml)
    const LEGAL_HASH = { '#privacidade':'privacidade', '#termos':'termos', '#devolucoes':'devolucoes', '#garantia':'garantia' };
    const legalFromHash = ()=>{ const k = LEGAL_HASH[location.hash]; if(!k) return; legal(k);
      // espera que a transição de página acabe e só depois desce até à secção
      let tries = 0; const t = setInterval(()=>{
        const pg = document.getElementById('page-legal'), el = document.getElementById('lg-' + k);
        const ready = pg && !pg.classList.contains('hide') && el && el.getBoundingClientRect().top + window.scrollY > 0 && !document.querySelector('.fx-wipe.on');
        if(ready || ++tries > 40){ clearInterval(t); if(el) setTimeout(()=> window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 100, behavior:'instant' }), 120); }
      }, 100); };
    setTimeout(legalFromHash, 700); window.addEventListener('hashchange', legalFromHash);   // espera o arranque do site
    // link "escolher palavra-passe" (enviado por email, ex.: acesso ao painel de admin)
    const rec = qs.get('recuperar');
    if(rec && LIVE && XDB.auth.verifyRecovery){
      history.replaceState(null, '', location.pathname + location.hash);
      try{
        await XDB.auth.verifyRecovery(rec); syncSession();
        const admin = qs.get('admin') === '1';
        openNewPassword(admin ? ()=>{ if(typeof showAdminLogin === 'function') showAdminLogin(); } : null);
      }catch(e){ toast(e.message); }
    }
    const oid = +qs.get('encomenda');
    if(oid){
      const state = qs.get('pagamento') || 'ok';
      history.replaceState(null, '', location.pathname + location.hash);
      if(XDB.auth.user()) showThanks(oid, state);
      else openAuth('login', ()=> showThanks(oid, state));
    }
  }

  window.Shop = { googleLogin, openCart, closeCart, quickAdd:(t,id)=> addToCart(t, id, {}, 1), addFromProductPage:(t,id,opts)=> addToCart(t, id, opts, 1),
    openAuth, openAccount, legal, payAgain, showThanks, _cart:()=>cart };
  start();
})();
