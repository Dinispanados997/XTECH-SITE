/* =====================================================================
   XTECH STORE — EMAILS AUTOMÁTICOS
   Um só ficheiro para o site e para o servidor:
   · decide QUE email cada encomenda / devolução / marcação deve receber
     (cada email só é enviado uma vez — fica registado em "emails")
   · escreve o email (versão bonita em HTML + versão em texto simples)
   No servidor é usado pelas funções do Netlify (netlify/lib/notify-core.mjs);
   no modo demonstração o site mostra uma pré-visualização em vez de enviar.
   ===================================================================== */
(function(G){
  'use strict';
  var STORE = {
    name:'Xtech Store', phone:'923 512 686', phoneIntl:'+351923512686', email:'xtechstorept@gmail.com',
    addr:'Largo Dom Gualdim Pais 21', city:'4720 Amares — Braga', insta:'@xtech_.pt', instaUrl:'https://www.instagram.com/xtech_.pt/',
    hours:'Segunda a sexta 9h30–19h · Sábado 10h–13h',
    maps:'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Xtech Store, Largo Dom Gualdim Pais 21, 4720 Amares'),
  };
  var WD = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
  var WDS = ['dom','seg','ter','qua','qui','sex','sáb'];
  var MO = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  var MOS = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function money(n){ var v = Math.round((Number(n)||0)*100)/100; var s = v.toFixed(2).split('.'); s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.'); return s.join(',') + ' €'; }
  function dparts(ds){ var p = String(ds).slice(0,10).split('-').map(Number); var d = new Date(Date.UTC(p[0], p[1]-1, p[2], 12)); return { wd:d.getUTCDay(), d:p[2], m:p[1]-1, y:p[0] }; }
  function dayLong(ds){ var x = dparts(ds); return WD[x.wd] + ', ' + x.d + ' de ' + MO[x.m]; }          // terça-feira, 3 de novembro
  function dayShort(ds){ var x = dparts(ds); return WDS[x.wd] + ' ' + x.d + ' ' + MOS[x.m]; }           // ter 3 nov
  function cap(s){ return s.charAt(0).toUpperCase() + s.slice(1); }
  function first(name){ return String(name||'').trim().split(/\s+/)[0] || ''; }
  function phoneFmt(p){ var d = String(p||'').replace(/\D/g,''); return d.length === 9 ? d.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') : (p||''); }
  function has(rec, k){ return (rec.emails || []).some(function(e){ return e && e.k === k; }); }
  function lisbonToday(){
    var p = {}; new Intl.DateTimeFormat('en-GB', { timeZone:'Europe/Lisbon', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date()).forEach(function(x){ p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day;
  }
  function addDays(ds, n){ var p = ds.split('-').map(Number); return new Date(Date.UTC(p[0], p[1]-1, p[2]+n)).toISOString().slice(0,10); }
  // hora de Portugal → instante UTC (para o link do Google Calendar)
  function lisbonUtc(ds, hm){
    var p = ds.split('-').map(Number), t = hm.split(':').map(Number);
    var guess = Date.UTC(p[0], p[1]-1, p[2], t[0], t[1]); var q = {};
    new Intl.DateTimeFormat('en-GB', { timeZone:'Europe/Lisbon', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(new Date(guess)).forEach(function(x){ q[x.type] = x.value; });
    var asLis = Date.UTC(+q.year, +q.month-1, +q.day, +q.hour, +q.minute);
    return new Date(guess - (asLis - guess));
  }
  function gcal(b){
    var s = lisbonUtc(b.day, b.slot), e = new Date(s.getTime() + 30*60000);
    var f = function(d){ return d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''); };
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent('Xtech Store — ' + (b.service_label||'Reparação')) +
      '&dates=' + f(s) + '/' + f(e) + '&location=' + encodeURIComponent(STORE.addr + ', ' + STORE.city) +
      '&details=' + encodeURIComponent('Marcação ' + b.number + (b.device ? '\nEquipamento: ' + b.device : '') + '\nTelefone da loja: ' + STORE.phone);
  }
  var ORDER_DONE = ['paga','em_preparacao','pronta','enviada','entregue','levantada'];
  var ACTIVE = ['pendente','confirmada'];
  var PAID_WITH = { card:'Cartão', mb_way:'MB WAY', multibanco:'Multibanco', link:'Link', apple_pay:'Apple Pay', google_pay:'Google Pay' };

  /* =====================================================================
     QUE EMAILS ESTÃO EM FALTA
     Cada evento: { key, to:'cliente'|'loja', tpl, also:[chaves extra a registar] }
     ===================================================================== */
  function dueOrder(o, opts){
    opts = opts || {}; var out = [], s = o.status;
    if(has(o,'antigo')) return [];
    if(s === 'pagar_na_loja' && !has(o,'reserva')) out.push({ key:'reserva', to:'cliente', tpl:'order_reserva' });
    if(o.payment_method === 'online' && ORDER_DONE.indexOf(s) >= 0 && !has(o,'paga')) out.push({ key:'paga', to:'cliente', tpl:'order_paga' });
    if(opts.mb && s === 'por_pagar' && !has(o,'mb')) out.push({ key:'mb', to:'cliente', tpl:'order_mb' });
    if((s === 'pagar_na_loja' || (o.payment_method === 'online' && ORDER_DONE.indexOf(s) >= 0)) && !has(o,'loja_nova')) out.push({ key:'loja_nova', to:'loja', tpl:'shop_order' });
    if(s === 'pronta' && !has(o,'pronta')) out.push({ key:'pronta', to:'cliente', tpl:'order_pronta' });
    if(s === 'enviada' && !has(o,'enviada')) out.push({ key:'enviada', to:'cliente', tpl:'order_enviada' });
    if((s === 'entregue' || s === 'levantada') && !has(o,'concluida')) out.push({ key:'concluida', to:'cliente', tpl:'order_concluida' });
    // só avisa o cancelamento de encomendas que chegaram a ser confirmadas (não de pagamentos abandonados)
    if(s === 'cancelada' && !has(o,'cancelada') && (has(o,'reserva') || has(o,'paga') || has(o,'mb'))) out.push({ key:'cancelada', to:'cliente', tpl:'order_cancelada' });
    if(s === 'reembolsada' && !has(o,'reembolsada')) out.push({ key:'reembolsada', to:'cliente', tpl:'order_reembolsada' });
    return out;
  }
  function dueReturn(r){
    var out = [], s = r.status;
    if(has(r,'antigo')) return [];
    if(!has(r,'pedido')){ out.push({ key:'pedido', to:'cliente', tpl:'ret_pedido' }); out.push({ key:'loja_dev', to:'loja', tpl:'shop_return' }); }
    if(s === 'aprovada' && !has(r,'aprovada')) out.push({ key:'aprovada', to:'cliente', tpl:'ret_aprovada' });
    if(s === 'recusada' && !has(r,'recusada')) out.push({ key:'recusada', to:'cliente', tpl:'ret_recusada' });
    if(s === 'reembolsada' && !has(r,'reembolsada')) out.push({ key:'reembolsada', to:'cliente', tpl:'ret_reembolsada' });
    return out;
  }
  function dueBooking(b, opts){
    opts = opts || {}; var out = [], act = ACTIVE.indexOf(b.status) >= 0, when = 'hora:' + b.day + ' ' + b.slot;
    if(has(b,'antigo')) return [];
    if(act && !has(b,'marcada')){
      out.push({ key:'marcada', to:'cliente', tpl:'book_marcada', also:[when] });
      if(b.source !== 'loja') out.push({ key:'loja_nova', to:'loja', tpl:'shop_booking' });
    } else if(act && !has(b, when)){
      out.push({ key:when, to:'cliente', tpl:'book_mudou' });
    }
    if(b.status === 'cancelada' && has(b,'marcada') && !has(b,'cancelada')){
      out.push({ key:'cancelada', to:'cliente', tpl:'book_cancelada' });
      var last = (b.history || [])[ (b.history || []).length - 1 ];
      if(last && last.by === 'cliente' && !has(b,'loja_cancel')) out.push({ key:'loja_cancel', to:'loja', tpl:'shop_booking_cancel' });
    }
    if(opts.reminder && act && b.day === addDays(lisbonToday(), 1) && !has(b, 'lembrete:' + b.day)) out.push({ key:'lembrete:' + b.day, to:'cliente', tpl:'book_lembrete' });
    return out;
  }

  /* =====================================================================
     TEXTOS
     Cada modelo devolve { subject, pre, eyebrow, title, intro:[…], blocks:[…] }
     blocks: {rows:[[k,v]]} · {items:[…], o} · {date:b} · {button:[label, href]} · {note:'…'} · {links:[[label, href]]}
     ===================================================================== */
  function deliveryText(o){
    var d = o.delivery || {};
    return d.method === 'ship' ? 'Envio para ' + [d.address, [d.zip, d.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') : 'Levantamento na loja';
  }
  function trackUrl(t){
    var c = String(t.company||'').toLowerCase(), code = encodeURIComponent(t.code||'');
    if(!code) return '';
    if(c.indexOf('ctt') >= 0) return 'https://www.ctt.pt/feapl_2/app/open/objectSearch/objectSearch.jspx?objects=' + code;
    if(c.indexOf('dpd') >= 0) return 'https://www.dpd.com/pt/pt/receber/seguir-encomenda/?parcelNumber=' + code;
    if(c.indexOf('gls') >= 0) return 'https://gls-group.com/PT/pt/seguir-encomenda?match=' + code;
    return '';
  }
  var visit = function(){ return { rows:[['Onde', STORE.addr + ', ' + STORE.city], ['Horário', STORE.hours]] }; };

  var T = {
    order_reserva: function(o, c){ return { subject:'Reserva ' + o.number + ' confirmada — pagas ao levantar', pre:'Guardámos tudo para ti. Pagas só quando vieres buscar.',
      eyebrow:'Reserva ' + o.number, title:'Está reservado, ' + first(o.name) + '.',
      intro:['Guardámos a tua encomenda na loja. Pagas <b>' + money(o.total) + '</b> só quando a vieres levantar.', 'Avisamos-te por email assim que estiver pronta.'],
      blocks:[{ items:o.items, o:o }, visit(), { button:['Ver a minha encomenda', c.siteUrl] }] }; },
    order_paga: function(o, c){ return { subject:'Obrigado pela tua compra! Encomenda ' + o.number, pre:'Recebemos o pagamento de ' + money(o.total) + '.',
      eyebrow:'Encomenda ' + o.number, title:'Obrigado pela compra, ' + first(o.name) + '!',
      intro:['Recebemos o teu pagamento de <b>' + money(o.total) + '</b>' + (o.paid_with && PAID_WITH[o.paid_with] ? ' por ' + PAID_WITH[o.paid_with] : '') + '. Vamos preparar tudo e avisamos-te quando estiver ' + ((o.delivery||{}).method === 'ship' ? 'a caminho.' : 'pronto a levantar.')],
      blocks:[{ items:o.items, o:o }, { rows:[['Entrega', deliveryText(o)]].concat(o.nif ? [['NIF na fatura', o.nif]] : []) }, { button:['Ver a minha encomenda', c.siteUrl] },
        { note:'Os equipamentos têm 18 meses de garantia. Compras online podem ser devolvidas até 14 dias depois de as receberes.' }] }; },
    order_mb: function(o, c){ var m = c.mb || {}; return { subject:'Falta pagar a encomenda ' + o.number + ' — referência Multibanco', pre:'Entidade ' + (m.entity||'') + ' · Referência ' + (m.reference||''),
      eyebrow:'Encomenda ' + o.number, title:'Falta só o pagamento.',
      intro:['Guardámos a tua encomenda. Paga no Multibanco ou no homebanking com estes dados' + (m.expires ? ' até <b>' + esc(m.expires) + '</b>' : '') + ':'],
      blocks:[{ rows:[['Entidade', m.entity||'—'], ['Referência', m.reference||'—'], ['Valor', money(o.total)]], big:true }].concat(m.url ? [{ button:['Ver o talão de pagamento', m.url] }] : [])
        .concat([{ items:o.items, o:o }, { note:'Assim que o pagamento entrar, recebes um email de confirmação.' }]) }; },
    order_pronta: function(o, c){ return { subject:'A tua encomenda ' + o.number + ' está pronta a levantar', pre:'Podes passar na loja quando quiseres.',
      eyebrow:'Encomenda ' + o.number, title:'Está pronta, ' + first(o.name) + '!',
      intro:['A tua encomenda já está à tua espera na loja.' + (o.payment_method === 'loja' ? ' Pagas <b>' + money(o.total) + '</b> no levantamento.' : '') , 'Traz o número da encomenda ou diz-nos o teu nome.'],
      blocks:[visit(), { links:[['Como chegar', STORE.maps]] }, { items:o.items, o:o }] }; },
    order_enviada: function(o, c){ var t = o.tracking || {}, u = trackUrl(t); return { subject:'A tua encomenda ' + o.number + ' foi enviada', pre:(t.company ? t.company + ' · ' : '') + (t.code || 'Já está a caminho.'),
      eyebrow:'Encomenda ' + o.number, title:'Já vai a caminho!',
      intro:['Enviámos a tua encomenda para <b>' + esc(deliveryText(o).replace(/^Envio para /,'')) + '</b>.'],
      blocks:[{ rows:[['Transportadora', t.company || '—'], ['Código de seguimento', t.code || '—']] }].concat(u ? [{ button:['Seguir a encomenda', u] }] : []).concat([{ items:o.items, o:o }]) }; },
    order_concluida: function(o, c){ return { subject:'Obrigado, ' + first(o.name) + '! Aproveita o teu ' + ((o.items||[])[0] ? (o.items[0].name) : 'equipamento'), pre:'A tua garantia começa hoje.',
      eyebrow:'Encomenda ' + o.number, title:'Obrigado pela confiança.',
      intro:['Esperamos que gostes! Os equipamentos têm <b>18 meses de garantia</b> a contar de hoje — guarda este email, serve de comprovativo.', 'Se alguma coisa não estiver bem, responde a este email ou liga-nos.'],
      blocks:[{ items:o.items, o:o }, { links:[['Segue-nos no Instagram', STORE.instaUrl]] }] }; },
    order_cancelada: function(o, c){ return { subject:'Encomenda ' + o.number + ' cancelada', pre:'A tua encomenda foi cancelada.',
      eyebrow:'Encomenda ' + o.number, title:'Encomenda cancelada',
      intro:['A encomenda <b>' + esc(o.number) + '</b> foi cancelada.' + (has(o,'paga') ? ' Se já tinhas pago, o reembolso é feito para o mesmo método de pagamento.' : ''), 'Se não pediste este cancelamento ou tens alguma dúvida, responde a este email.'],
      blocks:[{ items:o.items, o:o }] }; },
    order_reembolsada: function(o, c){ return { subject:'Reembolso da encomenda ' + o.number, pre:'Devolvemos ' + money(o.total) + '.',
      eyebrow:'Encomenda ' + o.number, title:'Reembolso feito',
      intro:['Devolvemos <b>' + money(o.total) + '</b> para o método de pagamento que usaste. Pode demorar até 5 a 10 dias úteis a aparecer, dependendo do banco.'],
      blocks:[{ items:o.items, o:o }] }; },

    ret_pedido: function(r, c){ var n = (c.order||{}).number || ('#' + r.order_id); return { subject:'Recebemos o teu pedido de devolução (' + n + ')', pre:'Vamos analisar e respondemos em breve.',
      eyebrow:'Devolução · ' + n, title:'Recebemos o teu pedido.',
      intro:['Vamos analisar o pedido e respondemos-te em breve, normalmente no próprio dia útil.'],
      blocks:[{ rows:[['Encomenda', n], ['Artigo', r.items || '—'], ['Motivo', r.reason || '—']].concat(r.details ? [['Detalhes', r.details]] : []) }] }; },
    ret_aprovada: function(r, c){ var n = (c.order||{}).number || ('#' + r.order_id); return { subject:'Devolução aprovada — ' + n, pre:'Diz-nos como preferes devolver o artigo.',
      eyebrow:'Devolução · ' + n, title:'Devolução aprovada.',
      intro:['Podes trazer o artigo à loja ou enviá-lo para a nossa morada. Inclui todos os acessórios e a caixa, se a tiveres.', 'Quando o recebermos e confirmarmos o estado, fazemos o reembolso.'],
      blocks:(r.admin_note ? [{ note:r.admin_note, from:true }] : []).concat([visit()]) }; },
    ret_recusada: function(r, c){ var n = (c.order||{}).number || ('#' + r.order_id); return { subject:'Sobre o teu pedido de devolução — ' + n, pre:'Não foi possível aceitar a devolução.',
      eyebrow:'Devolução · ' + n, title:'Não foi possível aceitar a devolução.',
      intro:['Analisámos o teu pedido e, desta vez, não o podemos aceitar.' + (r.admin_note ? '' : ' Se quiseres saber mais, responde a este email.')],
      blocks:r.admin_note ? [{ note:r.admin_note, from:true }, { note:'Se tiveres alguma dúvida, responde a este email ou liga para o ' + STORE.phone + '.' }] : [] }; },
    ret_reembolsada: function(r, c){ var n = (c.order||{}).number || ('#' + r.order_id); return { subject:'Reembolso da devolução — ' + n, pre:'O reembolso já foi feito.',
      eyebrow:'Devolução · ' + n, title:'Reembolso feito.',
      intro:['Recebemos o artigo e já fizemos o reembolso para o método de pagamento que usaste. Pode demorar até 5 a 10 dias úteis a aparecer na tua conta.'],
      blocks:r.admin_note ? [{ note:r.admin_note, from:true }] : [] }; },

    book_marcada: function(b, c){ return { subject:'Marcação confirmada: ' + dayShort(b.day) + ' às ' + b.slot, pre:cap(dayLong(b.day)) + ' às ' + b.slot + ' · ' + (b.service_label||''),
      eyebrow:'Marcação ' + b.number, title:'Até ' + (b.day === addDays(lisbonToday(),1) ? 'amanhã' : WD[dparts(b.day).wd].replace('-feira','')) + ', ' + first(b.name) + '!',
      intro:['A tua marcação na Xtech Store está feita. O horário fica reservado para ti.'],
      blocks:[{ date:b }, { rows:[['Serviço', b.service_label || '—']].concat(b.device ? [['Equipamento', b.device]] : []).concat([['Onde', STORE.addr + ', ' + STORE.city]]) },
        { button:['Adicionar ao calendário', gcal(b)] }, { links:[['Como chegar', STORE.maps]] },
        { note:'O diagnóstico é gratuito e só pagas depois da reparação. Se não puderes vir, responde a este email ou liga para o ' + STORE.phone + '.' }] }; },
    book_mudou: function(b, c){ return { subject:'A tua marcação mudou: ' + dayShort(b.day) + ' às ' + b.slot, pre:'Novo horário: ' + dayLong(b.day) + ' às ' + b.slot,
      eyebrow:'Marcação ' + b.number, title:'Novo horário.',
      intro:['Alterámos a tua marcação. O novo horário é <b>' + esc(dayLong(b.day)) + ' às ' + esc(b.slot) + '</b>.'],
      blocks:[{ date:b }, { rows:[['Serviço', b.service_label || '—']].concat(b.device ? [['Equipamento', b.device]] : []) }, { button:['Adicionar ao calendário', gcal(b)] },
        { note:'Se este horário não der jeito, responde a este email ou liga para o ' + STORE.phone + '.' }] }; },
    book_cancelada: function(b, c){ return { subject:'Marcação cancelada — ' + dayShort(b.day) + ' às ' + b.slot, pre:'A marcação ' + b.number + ' foi cancelada.',
      eyebrow:'Marcação ' + b.number, title:'Marcação cancelada.',
      intro:['A tua marcação de <b>' + esc(dayLong(b.day)) + ' às ' + esc(b.slot) + '</b> foi cancelada.', 'Quando quiseres, marca outra vez no site — demora um minuto.'],
      blocks:[{ button:['Marcar outra vez', c.siteUrl + '#marcar'] }] }; },
    book_lembrete: function(b, c){ return { subject:'Lembrete: amanhã às ' + b.slot + ' na Xtech Store', pre:(b.service_label||'') + (b.device ? ' · ' + b.device : ''),
      eyebrow:'Marcação ' + b.number, title:'Até amanhã, ' + first(b.name) + '!',
      intro:['Só para lembrar: tens marcação amanhã, <b>' + esc(dayLong(b.day)) + ' às ' + esc(b.slot) + '</b>.', 'Se puderes, faz uma cópia de segurança do equipamento antes de vires.'],
      blocks:[{ date:b }, { links:[['Como chegar', STORE.maps]] }, { note:'Já não podes vir? Responde a este email ou liga para o ' + STORE.phone + ' para mudarmos o horário.' }] }; },

    shop_order: function(o, c){ return { subject:'Nova encomenda ' + o.number + ' — ' + money(o.total) + (o.payment_method === 'loja' ? ' (paga ao levantar)' : ' (paga)'), pre:o.name + ' · ' + deliveryText(o),
      eyebrow:'Loja online', title:'Nova encomenda ' + o.number,
      intro:[(o.payment_method === 'loja' ? 'Reserva para pagar ao levantar.' : 'Pagamento recebido' + (o.paid_with && PAID_WITH[o.paid_with] ? ' por ' + PAID_WITH[o.paid_with] : '') + '.') + ' Abre o painel para tratar dela.'],
      blocks:[{ items:o.items, o:o }, { rows:[['Cliente', o.name || '—'], ['Email', o.email || '—'], ['Telemóvel', phoneFmt(o.phone) || '—'], ['Entrega', deliveryText(o)]].concat(o.nif ? [['NIF', o.nif]] : []).concat(o.notes ? [['Notas', o.notes]] : []) }, { button:['Abrir o painel', c.siteUrl] }] }; },
    shop_return: function(r, c){ var n = (c.order||{}).number || ('#' + r.order_id); return { subject:'Pedido de devolução — ' + n, pre:(r.email||'') + ' · ' + (r.reason||''),
      eyebrow:'Loja online', title:'Novo pedido de devolução',
      intro:['Um cliente pediu para devolver um artigo. Aprova ou recusa em Encomendas → Devoluções.'],
      blocks:[{ rows:[['Encomenda', n], ['Cliente', r.email || '—'], ['Artigo', r.items || '—'], ['Motivo', r.reason || '—']].concat(r.details ? [['Detalhes', r.details]] : []) }, { button:['Abrir o painel', c.siteUrl] }] }; },
    shop_booking: function(b, c){ return { subject:'Nova marcação: ' + b.name + ' — ' + dayShort(b.day) + ' às ' + b.slot, pre:(b.service_label||'') + (b.device ? ' · ' + b.device : ''),
      eyebrow:'Marcações', title:'Nova marcação ' + b.number,
      intro:['Marcada pelo site. Confirma no painel ou manda mensagem ao cliente.'],
      blocks:[{ date:b }, { rows:[['Cliente', b.name], ['Telemóvel', phoneFmt(b.phone)], ['Email', b.email || '—'], ['Serviço', b.service_label || '—']].concat(b.device ? [['Equipamento', b.device]] : []).concat(b.issue ? [['Problema', b.issue]] : []) },
        { button:['Abrir o painel', c.siteUrl] }] }; },
    quote_cliente: function(q, c){ return { subject:'Recebemos o teu pedido de orçamento', pre:(q.device || 'O teu equipamento') + ' — respondemos em breve.',
      eyebrow:'Pedido de orçamento', title:'Recebemos o teu pedido, ' + first(q.name) + '.',
      intro:['Vamos analisar e responder-te com o orçamento, normalmente no mesmo dia útil.', 'Se preferires, podes marcar já o diagnóstico gratuito na loja.'],
      blocks:[{ rows:[['Equipamento', q.device || '—'], ['O que aconteceu', q.issue || '—']] }, { button:['Marcar diagnóstico gratuito', c.siteUrl + '#marcar'] }] }; },
    shop_quote: function(q, c){ return { subject:'Pedido de orçamento: ' + (q.device || 'equipamento') + ' — ' + (q.name || 'cliente'), pre:String(q.issue || '').slice(0, 90),
      eyebrow:'Orçamentos', title:'Novo pedido de orçamento',
      intro:['Responde ao cliente com o valor. Também aparece no painel, em Orçamentos.'],
      blocks:[{ rows:[['Cliente', q.name || '—'], ['Telemóvel', phoneFmt(q.phone) || '—'], ['Email', q.email || '—'], ['Equipamento', q.device || '—'], ['O que aconteceu', q.issue || '—']] }, { button:['Abrir o painel', c.siteUrl] }] }; },
    conta_reset: function(u, c){ return { subject:'Nova palavra-passe — Xtech Store', pre:'Carrega no botão para escolheres uma palavra-passe nova.',
      eyebrow:'A tua conta', title:'Escolhe uma palavra-passe nova.',
      intro:['Pediste para mudar a palavra-passe da conta <b>' + esc(u.email) + '</b> no site da Xtech Store.', 'O link só funciona uma vez e expira em 1 hora.'],
      blocks:[{ button:['Escolher palavra-passe', c.link] }, { note:'Se não foste tu a pedir, ignora este email — a tua palavra-passe continua igual.' }] }; },
    admin_acesso: function(u, c){ return { subject:'Acesso ao painel da Xtech Store', pre:'Escolhe a tua palavra-passe para entrar no painel.',
      eyebrow:'Painel de administração', title:'Escolhe a tua palavra-passe.',
      intro:['A conta <b>' + esc(u.email) + '</b> já é administradora do site da Xtech Store.', 'Carrega no botão, escolhe uma palavra-passe e entras logo no painel. O link só funciona uma vez e expira em 1 hora.'],
      blocks:[{ button:['Escolher palavra-passe', c.link] }, { note:'Se não foste tu a pedir isto, ignora este email — sem carregares no botão, nada muda.' }] }; },
    shop_booking_cancel: function(b, c){ return { subject:'Marcação desmarcada: ' + b.name + ' — ' + dayShort(b.day) + ' às ' + b.slot, pre:'O horário ficou livre.',
      eyebrow:'Marcações', title:'Um cliente desmarcou',
      intro:['<b>' + esc(b.name) + '</b> desmarcou ' + esc(b.service_label || 'a marcação') + ' de ' + esc(dayLong(b.day)) + ' às ' + esc(b.slot) + '. O horário voltou a ficar livre no site.'],
      blocks:[{ rows:[['Telemóvel', phoneFmt(b.phone)], ['Marcação', b.number]] }] }; },
  };

  /* =====================================================================
     DESENHO DO EMAIL (HTML compatível com Gmail, Outlook e Apple Mail)
     ===================================================================== */
  var FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  function itemsHTML(items, o){
    var rows = (items||[]).map(function(l){
      var opts = (l.options||[]).map(function(x){ return x.name; }).filter(Boolean).join(' · ');
      return '<tr><td style="padding:12px 0;border-bottom:1px solid #ececef;vertical-align:top;font:600 15px/1.35 ' + FONT + ';color:#111;">' + esc(l.name) + (l.qty > 1 ? ' <span style="color:#86868b;font-weight:500;">× ' + l.qty + '</span>' : '') +
        (opts ? '<div style="font:400 13px/1.4 ' + FONT + ';color:#86868b;margin-top:3px;">' + esc(opts) + '</div>' : '') +
        '</td><td align="right" style="padding:12px 0 12px 12px;border-bottom:1px solid #ececef;vertical-align:top;white-space:nowrap;font:600 15px/1.35 ' + FONT + ';color:#111;">' + money(l.total != null ? l.total : l.unit * (l.qty||1)) + '</td></tr>';
    }).join('');
    var tot = '';
    if(o){
      if(Number(o.shipping) > 0) tot += '<tr><td style="padding:10px 0 0;font:400 14px ' + FONT + ';color:#6e6e73;">Envio</td><td align="right" style="padding:10px 0 0;font:400 14px ' + FONT + ';color:#6e6e73;">' + money(o.shipping) + '</td></tr>';
      tot += '<tr><td style="padding:10px 0 0;font:700 16px ' + FONT + ';color:#111;">Total</td><td align="right" style="padding:10px 0 0;font:700 16px ' + FONT + ';color:#111;">' + money(o.total) + '</td></tr>' +
        '<tr><td colspan="2" style="padding:2px 0 0;font:400 12px ' + FONT + ';color:#86868b;">IVA incluído</td></tr>';
    }
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;border-top:1px solid #ececef;">' + rows + tot + '</table>';
  }
  function rowsHTML(rows, big){
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 4px;background:#f5f5f7;border-radius:14px;">' + rows.map(function(r, i){
      return '<tr><td style="padding:' + (i ? '10px' : '14px') + ' 16px ' + (i === rows.length-1 ? '14px' : '0') + ';font:400 13.5px/1.4 ' + FONT + ';color:#6e6e73;vertical-align:top;white-space:nowrap;">' + esc(r[0]) + '</td>' +
        '<td align="right" style="padding:' + (i ? '10px' : '14px') + ' 16px ' + (i === rows.length-1 ? '14px' : '0') + ';font:' + (big ? '700 18px' : '600 14px') + '/1.4 ' + FONT + ';color:#111;' + (big ? 'letter-spacing:.04em;' : '') + '">' + esc(r[1]) + '</td></tr>';
    }).join('') + '</table>';
  }
  function dateHTML(b){
    var x = dparts(b.day);
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;"><tr>' +
      '<td width="84" style="width:84px;vertical-align:middle;"><table role="presentation" cellpadding="0" cellspacing="0" width="72" style="width:72px;border-radius:14px;overflow:hidden;border:1px solid #e3e3e8;">' +
      '<tr><td align="center" style="background:#000;color:#fff;font:700 11px/1 ' + FONT + ';letter-spacing:.1em;text-transform:uppercase;padding:6px 0 5px;">' + MOS[x.m] + '</td></tr>' +
      '<tr><td align="center" style="background:#fff;color:#000;font:700 30px/1 ' + FONT + ';padding:9px 0 10px;">' + x.d + '</td></tr></table></td>' +
      '<td style="vertical-align:middle;font:700 18px/1.3 ' + FONT + ';color:#111;">' + esc(cap(dayLong(b.day))) + '<div style="font:600 26px/1.2 ' + FONT + ';color:#111;margin-top:2px;">' + esc(b.slot) + '</div></td></tr></table>';
  }
  function buttonHTML(label, href){
    return '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 4px;"><tr><td style="background:#000;border-radius:999px;">' +
      '<a href="' + esc(href) + '" target="_blank" style="display:inline-block;padding:14px 26px;font:600 15px/1 ' + FONT + ';color:#fff;text-decoration:none;border-radius:999px;">' + esc(label) + '</a></td></tr></table>';
  }
  function linksHTML(links){
    return '<p style="margin:16px 0 0;font:600 14.5px ' + FONT + ';">' + links.map(function(l){ return '<a href="' + esc(l[1]) + '" target="_blank" style="color:#000;text-decoration:underline;">' + esc(l[0]) + ' →</a>'; }).join(' &nbsp; ') + '</p>';
  }
  function noteHTML(n){
    return n.from
      ? '<div style="margin:20px 0 4px;padding:14px 16px;border-left:3px solid #000;background:#f5f5f7;border-radius:0 12px 12px 0;font:400 14.5px/1.55 ' + FONT + ';color:#111;"><div style="font:700 11px ' + FONT + ';letter-spacing:.08em;text-transform:uppercase;color:#86868b;margin-bottom:6px;">Mensagem da loja</div>' + esc(n.note).replace(/\n/g,'<br>') + '</div>'
      : '<p style="margin:22px 0 0;font:400 13.5px/1.55 ' + FONT + ';color:#6e6e73;">' + esc(n.note) + '</p>';
  }

  function render(ev, rec, ctx){
    ctx = ctx || {};
    var c = { siteUrl:String(ctx.siteUrl || '').replace(/\/$/, '') + '/', mb:ctx.mb, order:ctx.order, link:ctx.link };
    var m = T[ev.tpl](rec, c);
    var logo = ctx.logoUrl || (c.siteUrl + 'icon-192.png');
    var body = m.blocks.map(function(b){
      if(b.items) return itemsHTML(b.items, b.o);
      if(b.rows) return rowsHTML(b.rows, b.big);
      if(b.date) return dateHTML(b.date);
      if(b.button) return buttonHTML(b.button[0], b.button[1]);
      if(b.links) return linksHTML(b.links);
      if(b.note) return noteHTML(b);
      return '';
    }).join('');
    var forShop = ev.to === 'loja';
    var html = '<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>' + esc(m.subject) + '</title></head>' +
      '<body style="margin:0;padding:0;background:#ececef;-webkit-text-size-adjust:100%;">' +
      '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' + esc(m.pre || '') + '&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ececef;"><tr><td align="center" style="padding:28px 12px 36px;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">' +
      '<tr><td style="background:#000;border-radius:22px 22px 0 0;padding:18px 28px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>' +
        '<td style="vertical-align:middle;"><img src="' + esc(logo) + '" width="34" height="34" alt="Xtech Store" style="display:block;border:0;border-radius:8px;"></td>' +
        '<td style="vertical-align:middle;padding-left:10px;font:700 17px ' + FONT + ';color:#fff;letter-spacing:-.01em;">Xtech Store</td></tr></table></td></tr>' +
      '<tr><td style="background:#fff;border-radius:0 0 22px 22px;padding:34px 28px 32px;">' +
        '<div style="font:600 13px ' + FONT + ';color:#86868b;margin:0 0 8px;">' + esc(m.eyebrow || '') + '</div>' +
        '<h1 style="margin:0 0 14px;font:700 28px/1.15 ' + FONT + ';letter-spacing:-.02em;color:#000;">' + esc(m.title) + '</h1>' +
        m.intro.map(function(p){ return '<p style="margin:0 0 10px;font:400 16px/1.55 ' + FONT + ';color:#333;">' + p + '</p>'; }).join('') +
        body +
      '</td></tr>' +
      '<tr><td align="center" style="padding:22px 20px 0;font:400 12.5px/1.6 ' + FONT + ';color:#86868b;">' +
        (forShop ? 'Aviso automático do site da Xtech Store.' :
        '<b style="color:#333;">Xtech Store</b> · ' + esc(STORE.addr) + ', ' + esc(STORE.city) + '<br>' +
        '<a href="tel:' + STORE.phoneIntl + '" style="color:#86868b;">' + STORE.phone + '</a> · <a href="mailto:' + STORE.email + '" style="color:#86868b;">' + STORE.email + '</a> · <a href="' + STORE.instaUrl + '" style="color:#86868b;">Instagram ' + esc(STORE.insta) + '</a><br>' +
        'Recebes este email por causa de uma compra ou marcação feita no nosso site. Basta responder para falares connosco.') +
      '</td></tr></table></td></tr></table></body></html>';

    // versão em texto simples (para quem não vê HTML e para os filtros de spam)
    var strip = function(s){ return String(s).replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'"); };
    var t = [m.eyebrow, '', m.title, ''].concat(m.intro.map(strip));
    m.blocks.forEach(function(b){
      t.push('');
      if(b.items){ (b.items||[]).forEach(function(l){ t.push('- ' + l.name + (l.qty > 1 ? ' x' + l.qty : '') + ': ' + money(l.total != null ? l.total : l.unit)); }); if(b.o){ if(Number(b.o.shipping) > 0) t.push('Envio: ' + money(b.o.shipping)); t.push('Total: ' + money(b.o.total) + ' (IVA incluído)'); } }
      if(b.rows) b.rows.forEach(function(r){ t.push(r[0] + ': ' + r[1]); });
      if(b.date) t.push(cap(dayLong(b.date.day)) + ' às ' + b.date.slot);
      if(b.button) t.push(b.button[0] + ': ' + b.button[1]);
      if(b.links) b.links.forEach(function(l){ t.push(l[0] + ': ' + l[1]); });
      if(b.note) t.push((b.from ? 'Mensagem da loja: ' : '') + b.note);
    });
    if(!forShop) t.push('', '—', 'Xtech Store · ' + STORE.addr + ', ' + STORE.city, STORE.phone + ' · ' + STORE.email);
    return { subject:m.subject, html:html, text:t.join('\n') };
  }

  // destinatário de cada evento
  function recipient(ev, rec, shopEmail){ return ev.to === 'loja' ? shopEmail : (rec.email || ''); }

  /* ---------- modo demonstração: mostra o email em vez de o enviar ---------- */
  function showDemo(list){
    if(typeof document === 'undefined' || !list || !list.length) return;
    var host = document.getElementById('xe-demo');
    if(!host){
      host = document.createElement('div'); host.id = 'xe-demo'; document.body.appendChild(host);
      var st = document.createElement('style');
      st.textContent = '#xe-demo{position:fixed;left:max(16px,env(safe-area-inset-left,0px));bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:10040;display:flex;flex-direction:column;gap:8px;max-width:min(360px,calc(100vw - 32px))}' +
        '.xe-card{display:flex;gap:12px;align-items:center;background:#fff;color:#000;border-radius:18px;padding:12px 12px 12px 14px;box-shadow:0 18px 50px -12px rgba(0,0,0,.55);font:500 13px/1.35 ' + FONT + ';animation:xeIn .5s cubic-bezier(.16,1,.3,1)}' +
        '.xe-card .ic{flex:none;width:34px;height:34px;border-radius:50%;background:#000;color:#fff;display:flex;align-items:center;justify-content:center}' +
        '.xe-card .tx{flex:1;min-width:0}.xe-card .tx b{display:block;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.xe-card .tx span{color:#6e6e73;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        '.xe-card button{flex:none;border:0;border-radius:999px;background:#000;color:#fff;font:600 13px ' + FONT + ';padding:9px 14px;cursor:pointer}.xe-card .x{background:#f2f2f4;color:#000;padding:9px 11px}' +
        '.xe-view{position:fixed;inset:0;z-index:10060;background:rgba(0,0,0,.7);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}' +
        '.xe-view .bar{width:100%;max-width:620px;display:flex;align-items:center;gap:10px;color:#fff;font:600 14px ' + FONT + ';margin-bottom:10px}.xe-view .bar span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.xe-view .bar button{border:0;border-radius:999px;background:#fff;color:#000;font:600 14px ' + FONT + ';padding:10px 16px;cursor:pointer}' +
        '.xe-view iframe{width:100%;max-width:620px;flex:1;max-height:82vh;border:0;border-radius:18px;background:#ececef}' +
        '@keyframes xeIn{0%{transform:translateY(16px);opacity:0}}';
      document.head.appendChild(st);
    }
    list.forEach(function(m){
      var c = document.createElement('div'); c.className = 'xe-card';
      c.innerHTML = '<div class="ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/></svg></div>' +
        '<div class="tx"><b>' + esc(m.subject) + '</b><span>' + (m.shop ? 'Aviso para a loja' : 'Para ' + esc(m.to)) + ' · simulação</span></div><button type="button" class="v">Ver</button><button type="button" class="x" aria-label="Fechar">×</button>';
      c.querySelector('.v').onclick = function(){
        var v = document.createElement('div'); v.className = 'xe-view';
        v.innerHTML = '<div class="bar"><span>' + esc(m.subject) + '</span><button type="button">Fechar</button></div><iframe title="Pré-visualização do email"></iframe>';
        v.querySelector('iframe').srcdoc = m.html;
        v.onclick = function(e){ if(e.target === v || e.target.tagName === 'BUTTON') v.remove(); };
        document.body.appendChild(v);
      };
      c.querySelector('.x').onclick = function(){ c.remove(); };
      host.appendChild(c);
      setTimeout(function(){ if(c.isConnected) c.remove(); }, 20000);
    });
  }

  G.XEmails = {
    due: { order:dueOrder, return:dueReturn, booking:dueBooking },
    render:render, recipient:recipient, showDemo:showDemo, STORE:STORE, lisbonToday:lisbonToday, addDays:addDays,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
