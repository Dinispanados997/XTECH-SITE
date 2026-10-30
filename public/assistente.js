/* =====================================================================
   XTECH STORE — ASSISTENTE SEM IA
   Se a IA não estiver ligada (falta ANTHROPIC_API_KEY no Netlify),
   o chat responde com a informação real do site (preços, stock, horário,
   marcações) e o pedido de orçamento passa a ser um formulário simples.
   Quando a IA estiver ligada, este ficheiro não muda nada.
   Carrega DEPOIS do loja.js e do agenda.js.
   ===================================================================== */
/* global XDB, XAgenda, devices, accessories, showPage, openProductDetail, toggleChat, quoteChatSummary, toast, Agenda */
(function(){
  'use strict';
  const S = { phone:'923 512 686', wa:'351923512686', email:'xtechstorept@gmail.com', addr:'Largo Dom Gualdim Pais 21, 4720 Amares — Braga',
    hours:'segunda a sexta das 9h30 às 19h, sábado das 10h às 13h (domingo fechado)',
    maps:'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Xtech Store, Largo Dom Gualdim Pais 21, 4720 Amares') };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const money = n => (Math.round((Number(n)||0)*100)/100).toLocaleString('pt-PT', { minimumFractionDigits:0, maximumFractionDigits:2 }) + ' €';
  const waLink = text => `https://wa.me/${S.wa}?text=${encodeURIComponent(text || 'Olá! Tenho uma pergunta:')}`;

  // A IA está ligada? (no site real pergunta ao servidor; no modo demonstração não há IA)
  async function aiReady(){
    if(!(window.XDB && XDB.live)) return false;
    try{ const r = await fetch('/.netlify/functions/ai', { method:'GET' }); const d = await r.json(); return !!d.ai; }catch(e){ return false; }
  }

  /* ---------------- respostas ---------------- */
  const SV = ()=> (window.XAgenda ? XAgenda.SERVICES : []);
  const sv = k => SV().find(s=> s.k === k);
  const avail = ()=> (typeof devices !== 'undefined' && Array.isArray(devices) ? devices : []).filter(d=> d.qty === '' || d.qty == null || Number(d.qty) > 0);
  const dname = d => `${d.brand||''} ${d.model||''}`.trim();
  const CHIPS_MAIN = [['precos','Preços de reparação'], ['marcar','Marcar reparação'], ['stock','Equipamentos à venda'], ['horario','Horário e morada'], ['whatsapp','Falar no WhatsApp']];

  function svcLine(k){ const s = sv(k); return s ? `<b>${esc(s.l)}</b>: ${esc(s.p)} <span class="as-muted">(${esc(s.t)})</span>` : ''; }
  function priceList(){
    return 'Estes são os preços mínimos (IVA incluído). O valor exato depende do modelo e é confirmado no <b>diagnóstico gratuito</b>:<br>' +
      ['ecra','bateria','camara','conector','software','placa'].map(k=> '• ' + svcLine(k)).join('<br>');
  }
  function deviceCards(list){
    return '<div class="as-devs">' + list.slice(0, 5).map(d=>`<button type="button" class="as-dev" data-dev="${d.id}"><span>${esc(dname(d))}${d.storage ? ' · ' + esc(d.storage) : ''}</span><b>${money(d.price)}</b></button>`).join('') + '</div>';
  }

  function answer(raw){
    const t = norm(raw);
    const has = (...w)=> w.some(x=> t.includes(x));
    const word = (...w)=> w.some(x=> new RegExp('(^|[^a-z0-9])' + x + '($|[^a-z0-9])').test(t));
    const all = avail();

    // equipamento específico em stock ("tens o iphone 15 pro?")
    // fora dos telemóveis basta o nome principal ("switch", "imac", "envy", "watch")
    const hits = all.map(d=>({ d, n:norm(dname(d)), m:norm(d.model) }))
      .filter(x=> t.includes(x.m) || t.includes(x.n) || (x.d.cat !== 'Telemóveis' && x.m.split(' ')[0].length >= 4 && word(x.m.split(' ')[0])))
      .sort((a,b)=> b.m.length - a.m.length);
    const wantsRepair = has('ecra','bateria','partid','trocar','troca','reparar','reparac','arranjar','carrega','camara','placa','agua','molhou','avaria','nao liga','software','desbloque','traseira','tampa');
    // pergunta por um modelo concreto que não está em stock ("tens o iphone 15 pro?", "têm ps5?")
    const asked = (t.match(/\b(iphone|galaxy|redmi|pixel|ipad|macbook|apple watch)\s*(\d{1,2}|[a-z]\d{1,3}|air|pro|mini|se)?(\s+(pro max|pro|plus|mini|ultra|fe|lite|max|air))?\b/) || [])[0]
      || (t.match(/\b(playstation\s*\d?|ps[345]|xbox( series [sx])?|steam deck|nintendo switch 2|switch 2)\b/) || [])[0];
    if(asked && !wantsRepair && !hits.some(h=> h.n.includes(norm(asked)) || norm(asked).includes(h.m))){
      const brand = asked.split(' ')[0];
      const near = all.filter(d=> norm(dname(d)).includes(brand === 'galaxy' ? 'samsung' : brand)).slice(0, 4);
      const nice = asked.replace(/\b\w/g, c=> c.toUpperCase()).replace(/^Iphone/, 'iPhone').replace(/^Ipad/, 'iPad').replace(/^Macbook/, 'MacBook').replace(/^Ps(\d)/, 'PS$1').replace(/^Playstation/, 'PlayStation');
      return { html:`Neste momento não temos <b>${esc(nice)}</b> em stock, mas chegam equipamentos todas as semanas.` + (near.length ? ' Temos estes parecidos:' + deviceCards(near) : ' Diz-nos o que procuras e avisamos-te quando chegar.'),
        chips:[['whatsapp','Avisar-me quando chegar'], ['stock','Ver o que há']], wa:raw };
    }
    if(hits.length && !wantsRepair){
      const best = hits.filter(h=> h.m.length === hits[0].m.length).map(h=>h.d);
      return { html:`Sim! Temos ${best.length > 1 ? 'estes' : 'este'} disponível${best.length > 1 ? 'is' : ''}:` + deviceCards(best) + 'Toca para ver fotos e detalhes. Também podes reservar e pagar na loja.', chips:[['stock','Ver tudo à venda'], ['whatsapp','Perguntar no WhatsApp']] };
    }

    // reparações de computadores, consolas, tablets e relógios: a tabela é de telemóveis
    if(wantsRepair && has('switch','consola','playstation','ps5','ps4','xbox','portat','computador','macbook','imac','ipad','tablet','watch','relogio','pc ')) return { html:'Também reparamos esse tipo de equipamento. O preço depende do modelo e da avaria, por isso fazemos o <b>diagnóstico gratuito</b> e dizemos-te o valor antes de reparar.', chips:[['marcar','Marcar diagnóstico'], ['orcamento','Pedir orçamento'], ['whatsapp','WhatsApp']] };
    // reparações
    if(has('ecra','display','vidro da frente','partiu o vidro','touch')) return { html: svcLine('ecra') + '. O valor exato depende do modelo — confirmamos no diagnóstico gratuito, antes de reparar.', chips:[['marcar','Marcar reparação'], ['precos','Outros preços']] };
    if(has('bateria','autonomia','descarrega','dura pouco')) return { html: svcLine('bateria') + '. O valor exato depende do modelo.', chips:[['marcar','Marcar reparação'], ['precos','Outros preços']] };
    if(has('camara','face id','sensor','foto desfocad')) return { html: svcLine('camara') +'. O valor exato depende do modelo.', chips:[['marcar','Marcar reparação'], ['precos','Outros preços']] };
    if(has('carrega','conector','ficha','porta de carga','cabo nao')) return { html: svcLine('conector') +'. O valor exato depende do modelo.', chips:[['marcar','Marcar reparação'], ['precos','Outros preços']] };
    if(has('software','desbloque','atualiza','recuperar dados','nao arranca','apple id','icloud','reset')) return { html: svcLine('software') +'. O valor exato depende do modelo.', chips:[['marcar','Marcar reparação'], ['whatsapp','Falar no WhatsApp']] };
    if(has('placa','agua','molhou','molhad','liquido','curto','nao liga')) return { html: svcLine('placa') + '. Traz o equipamento para fazermos o diagnóstico gratuito.', chips:[['marcar','Marcar diagnóstico'], ['whatsapp','Falar no WhatsApp']] };
    if(has('traseira','vidro de tras','vidro traseiro','microfone','coluna','vibra') || word('tampa','botao','som')) return { html:'Isso depende do modelo, por isso damos o preço no <b>diagnóstico gratuito</b>. Podes marcar já ou pedir orçamento.', chips:[['marcar','Marcar reparação'], ['orcamento','Pedir orçamento'], ['whatsapp','WhatsApp']] };
    if(has('preco','quanto custa','quanto e','orcamento','valor','tabela','reparac','reparar','arranjar','avaria')) return { html: priceList(), chips:[['marcar','Marcar reparação'], ['orcamento','Pedir orçamento']] };

    // marcações
    if(has('marcar','marcacao','agendar','agenda','hora livre','vaga','disponibilidade','posso ir','posso passar')) return { html:'Podes marcar online: escolhes o serviço, o dia e a hora, e recebes a confirmação por email. Demora 1 minuto e não pagas nada no momento.', chips:[['marcar','Marcar agora']] };

    // loja / horário / contactos
    if(has('horario','abre','abrem','fecha','fecham','aberto','aberta','sabado','domingo','feriado','que horas')) return { html:`Estamos abertos de <b>${esc(S.hours)}</b>.`, chips:[['morada','Como chegar'], ['marcar','Marcar reparação']] };
    if(has('morada','onde','localiza','fica','chegar','endereco','mapa','amares')) return { html:`Estamos no <b>${esc(S.addr)}</b>. <a href="${S.maps}" target="_blank" rel="noopener">Abrir no Google Maps →</a>`, chips:[['horario','Horário'], ['marcar','Marcar reparação']] };
    if(has('telefone','contacto','ligar','numero','whatsapp','falar com','email','pessoa')) return { html:`Fala connosco pelo <b>${S.phone}</b> (chamada ou WhatsApp) ou pelo email ${S.email}.`, chips:[['whatsapp','Abrir WhatsApp']] };

    // compras
    if(has('garantia')) return { html:'Os equipamentos usados têm <b>18 meses de garantia</b>. As reparações também têm garantia.', chips:[['stock','Ver equipamentos']] };
    if(has('envio','envia','entrega','portes','correio','ctt','levantar','recolha')) return { html:'Enviamos para Portugal continental (normalmente 1 a 3 dias úteis) ou podes levantar na loja em Amares, sem custos.', chips:[['stock','Ver equipamentos']] };
    if(has('pagamento','pagar','mb way','mbway','multibanco','cartao','prestac','apple pay','google pay')) return { html:'No site aceitamos <b>MB WAY, Multibanco, cartão, Apple Pay e Google Pay</b>. Também podes reservar e pagar quando levantares na loja.', chips:[['stock','Ver equipamentos']] };
    if(has('retoma','troca o meu','trocar o meu','vender o meu','compram','compras usados','avaliar o meu')) return { html:'Fazemos <b>retoma</b>: traz o teu equipamento, avaliamos na hora e descontas o valor no próximo. Para uma ideia de valor, manda fotos e o modelo pelo WhatsApp.', chips:[['whatsapp','Enviar pelo WhatsApp']] };
    if(has('iphone','samsung','xiaomi','telemove','telefone','portat','computador','macbook','imac','consola','switch','playstation','relogio','watch','comprar','venda','vendem','stock','disponive') || word('tem','tens','tenho')){
      const cat = has('portat','computador','macbook','imac','pc ') ? 'Computadores' : has('consola','switch','playstation') ? 'Consolas' : has('relogio','watch') ? 'Relógios' : has('iphone','samsung','xiaomi','telemove','telefone') ? 'Telemóveis' : '';
      let list = all.filter(d=> !cat || d.cat === cat);
      if(has('iphone')) list = list.filter(d=> norm(dname(d)).includes('iphone'));
      if(has('samsung')) list = list.filter(d=> norm(dname(d)).includes('samsung'));
      if(!list.length) return { html:'Neste momento não temos isso em stock, mas chegam equipamentos novos todas as semanas. Diz-nos o que procuras no WhatsApp e avisamos-te.', chips:[['whatsapp','Avisar-me no WhatsApp'], ['stock','Ver o que há']] };
      return { html:`Temos ${list.length} ${list.length === 1 ? 'disponível' : 'disponíveis'}${list.length > 5 ? ' (os primeiros 5)' : ''}:` + deviceCards(list), chips:[['loja','Ver todos na loja']] };
    }
    if(word('ola','bom dia','boa tarde','boa noite','boas','hey','oi')) return { html:'Olá! Em que posso ajudar?', chips:CHIPS_MAIN };
    if(has('obrigad','valeu') || word('ok','fixe','top')) return { html:'De nada! Se precisares de mais alguma coisa, é só dizer.', chips:[['marcar','Marcar reparação'], ['whatsapp','WhatsApp']] };

    return { html:`Não tenho a certeza de como responder a isso. Fala connosco no WhatsApp ou pelo <b>${S.phone}</b> e respondemos rápido.`, chips:[['whatsapp','Perguntar no WhatsApp'], ['precos','Preços de reparação'], ['stock','Equipamentos à venda']], wa:raw };
  }

  function chipAnswer(k, lastText){
    if(k === 'precos') return { html: priceList(), chips:[['marcar','Marcar reparação'], ['orcamento','Pedir orçamento']] };
    if(k === 'horario') return answer('horario');
    if(k === 'morada') return answer('morada');
    if(k === 'stock') return answer('equipamentos venda stock');
    return null;
  }

  /* ---------------- chat flutuante ---------------- */
  let lastUserText = '';
  function bubble(role, html){
    const box = document.getElementById('chat-messages'); if(!box) return null;
    const div = document.createElement('div'); div.className = 'chat-msg ' + (role === 'user' ? 'user' : 'bot');
    if(role === 'user') div.textContent = html; else div.innerHTML = html;
    box.appendChild(div); box.scrollTop = box.scrollHeight; return div;
  }
  function chips(list){
    const box = document.getElementById('chat-messages'); if(!box || !list || !list.length) return;
    box.querySelectorAll('.as-chips').forEach(c=> c.remove());
    const d = document.createElement('div'); d.className = 'as-chips';
    d.innerHTML = list.map(([k,l])=>`<button type="button" data-k="${k}">${esc(l)}</button>`).join('');
    box.appendChild(d); box.scrollTop = box.scrollHeight;
  }
  function reply(a){
    const typing = bubble('bot', '<span class="as-dots"><i></i><i></i><i></i></span>');
    setTimeout(()=>{ if(typing) typing.remove(); bubble('bot', a.html); chips(a.chips); }, 450);
  }
  function act(k, label){
    if(k === 'marcar'){ bubble('user', label); toggleChatClose(); if(window.Agenda) Agenda.open(); return; }
    if(k === 'orcamento'){ bubble('user', label); toggleChatClose(); showPage('reparacoes'); setTimeout(()=>{ const f = document.getElementById('as-quote'); if(f) f.scrollIntoView({ behavior:'smooth', block:'center' }); }, 900); return; }
    if(k === 'whatsapp'){ window.open(waLink(lastUserText ? 'Olá! ' + lastUserText : ''), '_blank', 'noopener'); return; }
    if(k === 'loja'){ toggleChatClose(); showPage('loja'); return; }
    bubble('user', label); reply(chipAnswer(k) || answer(label));
  }
  function toggleChatClose(){ const p = document.getElementById('chat-panel'); if(p && p.classList.contains('open') && typeof toggleChat === 'function') toggleChat(); }

  function localSend(){
    const input = document.getElementById('chat-input'); const text = (input.value || '').trim(); if(!text) return;
    input.value = ''; lastUserText = text; bubble('user', text); reply(answer(text));
  }

  function mountChat(){
    window.sendChatMessage = localSend;
    const sub = document.querySelector('#chat-panel .chat-panel-head div div div:last-child');
    if(sub) sub.textContent = 'Respostas na hora · ou fala connosco no WhatsApp';
    const box = document.getElementById('chat-messages');
    if(box){
      box.addEventListener('click', e=>{
        const c = e.target.closest('.as-chips button'); if(c){ act(c.dataset.k, c.textContent); return; }
        const d = e.target.closest('.as-dev'); if(d){ toggleChatClose(); if(typeof openProductDetail === 'function') openProductDetail('device', Number(d.dataset.dev)); }
      });
      // depois da saudação inicial, mostra os atalhos
      new MutationObserver(()=>{ if(box.children.length === 1 && !box.querySelector('.as-chips')) chips(CHIPS_MAIN); }).observe(box, { childList:true });
    }
  }

  /* ---------------- pedido de orçamento (página Reparações) ---------------- */
  function mountQuote(){
    const msgs = document.getElementById('quote-chat-messages'); if(!msgs) return;
    const card = msgs.closest('.contact-form'); if(!card) return;
    const intro = card.parentElement.querySelector('p');
    if(intro) intro.textContent = 'Diz-nos o equipamento e o que aconteceu. Respondemos com o orçamento por email ou telefone, normalmente no mesmo dia. O diagnóstico na loja é sempre gratuito.';
    card.style.height = 'auto'; card.style.padding = '24px'; card.id = 'as-quote';
    const u = XDB.auth.user && XDB.auth.user(); const m = (u && u.meta) || {};
    card.innerHTML = `<form class="as-form" novalidate>
        <div class="as-row"><label>Nome<input name="name" autocomplete="name" maxlength="80" value="${esc(m.name || (u && u.name) || '')}" required></label>
        <label>Telemóvel<input name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" value="${esc(m.phone || '')}"></label></div>
        <label>Email<input name="email" type="email" autocomplete="email" maxlength="120" value="${esc((u && u.email) || '')}"></label>
        <label>Equipamento<input name="device" maxlength="80" placeholder="Ex.: iPhone 13 Pro" required></label>
        <label>O que aconteceu?<textarea name="issue" maxlength="800" rows="4" placeholder="Ex.: caiu e o ecrã ficou com riscas" required></textarea></label>
        <div class="as-err" role="alert"></div>
        <button class="btn btn-red btn-block" type="submit">Pedir orçamento</button>
        <p class="as-alt">Preferes vir já? <button type="button" class="as-link" data-k="marcar">Marcar reparação</button> · <a href="${waLink('Olá! Queria um orçamento para ')}" target="_blank" rel="noopener">WhatsApp</a></p>
      </form><div id="quote-chat-confirm"></div>`;
    const form = card.querySelector('form');
    card.querySelector('[data-k="marcar"]').onclick = ()=> window.Agenda && Agenda.open();
    form.addEventListener('submit', async e=>{
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form).entries()); Object.keys(f).forEach(k=> f[k] = String(f[k]).trim());
      const err = form.querySelector('.as-err'); err.textContent = '';
      const phone = f.phone.replace(/\D/g,'').replace(/^(00)?351(?=\d{9}$)/, '');
      if(f.name.length < 2) return void (err.textContent = 'Indica o teu nome.');
      if(!f.email && !phone) return void (err.textContent = 'Indica o teu telemóvel ou email, para te respondermos.');
      if(f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return void (err.textContent = 'O email não parece válido.');
      if(phone && !/^[239]\d{8}$/.test(phone)) return void (err.textContent = 'O telemóvel deve ter 9 dígitos.');
      if(f.device.length < 2) return void (err.textContent = 'Indica o equipamento (marca e modelo).');
      if(f.issue.length < 3) return void (err.textContent = 'Conta-nos o que aconteceu.');
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'A enviar…';
      // eslint-disable-next-line no-global-assign
      quoteChatSummary = { name:f.name, phone, email:f.email.toLowerCase(), device:f.device, issue:f.issue };
      await window.submitQuoteRequest();
      const ok = /enviado/i.test((document.getElementById('quote-chat-confirm') || {}).textContent || '');
      if(ok){
        card.innerHTML = `<div class="as-done"><div class="as-tick">✓</div><h3>Pedido enviado!</h3><p>Vamos analisar e responder-te${f.email ? ' por email (' + esc(f.email) + ')' : ''}${phone ? (f.email ? ' ou' : '') + ' pelo telemóvel' : ''}, normalmente no mesmo dia.</p>
          <button class="btn btn-red btn-block" type="button" data-k="marcar">Marcar já o diagnóstico gratuito</button></div>`;
        card.querySelector('[data-k="marcar"]').onclick = ()=> window.Agenda && Agenda.open();
      } else { btn.disabled = false; btn.textContent = 'Pedir orçamento'; err.textContent = 'Não foi possível enviar. Tenta de novo ou liga-nos: ' + S.phone + '.'; }
    });
    window.sendQuoteChatMessage = ()=>{};
    window.initQuoteChat = ()=>{};
  }

  function css(){
    const st = document.createElement('style');
    st.textContent = `
      .as-chips{display:flex;flex-wrap:wrap;gap:6px;align-self:flex-start;max-width:100%}
      .as-chips button{border:1px solid var(--line,rgba(255,255,255,.12));background:transparent;color:#fff;border-radius:999px;padding:8px 12px;font:600 12.5px var(--font,inherit);cursor:pointer}
      .as-chips button:hover{background:rgba(255,255,255,.08)}
      .chat-msg.bot a{color:#fff;text-decoration:underline}
      .as-muted{color:var(--muted,#8e8e93)}
      .as-devs{display:flex;flex-direction:column;gap:6px;margin:8px 0}
      .as-dev{display:flex;justify-content:space-between;gap:10px;align-items:center;text-align:left;background:rgba(255,255,255,.07);border:0;border-radius:12px;padding:10px 12px;color:#fff;font:500 13px var(--font,inherit);cursor:pointer}
      .as-dev:hover{background:rgba(255,255,255,.12)} .as-dev b{white-space:nowrap}
      .as-dots{display:inline-flex;gap:4px} .as-dots i{width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.4;animation:asDot 1s infinite} .as-dots i:nth-child(2){animation-delay:.15s} .as-dots i:nth-child(3){animation-delay:.3s}
      @keyframes asDot{50%{opacity:1}}
      .as-form{display:flex;flex-direction:column;gap:12px}
      .as-form label{display:flex;flex-direction:column;gap:6px;font:600 12.5px var(--font,inherit);color:var(--muted,#8e8e93);flex:1;min-width:0}
      .as-form input,.as-form textarea{background:#000;border:1px solid var(--border,#2a2a2a);border-radius:12px;color:#fff;font:500 15px var(--font,inherit);padding:12px 14px;outline:none;width:100%;box-sizing:border-box;resize:vertical}
      .as-form input:focus,.as-form textarea:focus{border-color:#fff}
      .as-row{display:flex;gap:12px} @media (max-width:560px){.as-row{flex-direction:column}}
      .as-err{color:#FF6961;font-size:13.5px;min-height:0} .as-err:empty{display:none}
      .as-alt{margin:2px 0 0;font-size:13.5px;color:var(--muted,#8e8e93);text-align:center} .as-alt a,.as-link{color:#fff;background:none;border:0;padding:0;font:inherit;text-decoration:underline;cursor:pointer}
      .as-done{text-align:center;padding:12px 4px} .as-done h3{margin:12px 0 8px;font-size:22px} .as-done p{color:var(--muted,#8e8e93);line-height:1.55;margin:0 0 18px}
      .as-tick{width:56px;height:56px;border-radius:50%;background:#fff;color:#000;display:flex;align-items:center;justify-content:center;font-size:26px;margin:0 auto}`;
    document.head.appendChild(st);
  }

  async function start(){
    if(window.XDB && XDB.ready) await XDB.ready;
    if(await aiReady()) return;          // IA ligada: fica tudo como estava
    css(); mountChat(); mountQuote();
    window.XTECH_AI = false;
  }
  start();
})();
