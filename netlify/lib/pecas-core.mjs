// Comparador de peças: pesquisa a mesma peça em vários fornecedores e junta os preços.
// Reconhece sozinho o tipo de loja: WooCommerce, Shopify, PrestaShop ou página HTML normal.
// Tudo aqui é independente do Netlify para poder ser testado.

export const FORNECEDORES_PADRAO = [
  { nome: 'Microwire', url: 'https://www.microwire.pt' },
  { nome: 'Alrossio', url: 'https://alrossio.pt' },
  { nome: 'Celuinfo', url: 'https://www.celuinfo.com/pt' },
];

// ---------------------------------------------------------------- texto
export const norm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

const unesc = (s) => String(s || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&euro;/g, '€');
const limpa = (s) => unesc(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- modelo
export function modelo(texto) {
  const t = norm(texto);
  let m = t.match(/\biphone ?(1[1-7]|x[sr]|x|se|[678])(?!\d)(?:(e)\b| ?(pro ?max|pro|plus|max|mini|air)\b)?/);
  if (m) {
    const n = ['x', 'xs', 'xr', 'se'].includes(m[1]) ? m[1].toUpperCase() : m[1];
    let suf = m[2] ? 'e' : (m[3] || '').replace(/ /g, '');
    suf = { promax: 'Pro Max', pro: 'Pro', plus: 'Plus', max: n === 'XS' ? 'Max' : 'Pro Max', mini: 'mini', air: 'Air', e: 'e' }[suf] || '';
    return suf === 'e' ? `iPhone ${n}e` : `iPhone ${n}${suf ? ' ' + suf : ''}`;
  }
  m = t.match(/\b(?:samsung|galaxy) ?(?:galaxy ?)?(s|a|note|z ?flip|z ?fold) ?(\d{1,2})(?!\d)(?: ?(ultra|plus|fe)\b|(\+))?/);
  if (m) {
    const serie = { s: 'S', a: 'A', note: 'Note ', zflip: 'Z Flip', zfold: 'Z Fold' }[m[1].replace(/ /g, '')];
    const suf = { ultra: ' Ultra', plus: '+', fe: ' FE' }[m[3] || (m[4] ? 'plus' : '')] || '';
    return `Galaxy ${serie}${m[2]}${suf}`;
  }
  m = t.match(/\bredmi ?note ?(\d{1,2})(?: ?(pro ?\+|pro plus|pro|s)\b)?/);
  if (m) return `Redmi Note ${m[1]}${m[2] ? ' ' + m[2].replace(/ /g, '') : ''}`;
  m = t.match(/\bpixel ?(\d{1,2})(?!\d)(?: ?(pro ?xl|pro|xl|a)\b)?/);
  if (m) return `Pixel ${m[1]}${m[2] ? ' ' + m[2] : ''}`;
  return null;
}

// ---------------------------------------------------------------- relevância
const PECAS = {
  ecra: /(ecra|display|lcd|oled|touch|incell|tela|screen|visor)/,
  bateria: /(bateria|battery)/,
  traseira: /(traseira|tampa|back ?(glass|cover)|vidro traseiro|chassis|housing|carcaca)/,
  camara: /(camara|camera|lente)/,
  conector: /(conector|carga|dock|charging|flex de carga|porta de carregamento)/,
  altifalante: /(altifalante|coluna|speaker|buzzer|auricular)/,
  botao: /(botao|power|volume)/,
};
const PEDIDO = {
  ecra: /\b(ecra|ecras|display|lcd|oled|tela|screen|visor)\b/,
  bateria: /\b(bateria|baterias|battery)\b/,
  traseira: /\b(traseira|tampa|back|vidro traseiro|chassis|housing)\b/,
  camara: /\b(camara|camera|lente)\b/,
  conector: /\b(conector|carga|dock|charging)\b/,
  altifalante: /\b(altifalante|coluna|speaker|auricular)\b/,
  botao: /\b(botao|power|volume)\b/,
};
const LIXO = /\b(capa|capas|pelicula|vidro temperado|protetor|case|suporte|ferramenta|cola|adesivo)\b/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function relevante(pedido, nome) {
  const p = norm(pedido), n = norm(nome);
  if (LIXO.test(n) && !LIXO.test(p)) return false;
  const mp = modelo(p);
  if (mp) {
    const mn = modelo(n);
    if (mn !== mp) {
      // nomes partilhados tipo "iPhone 12 / 12 Pro"
      const alvo = norm(mp), [marca, ...resto] = alvo.split(' '), curto = resto.join(' ');
      const suf = '(?! ?(pro|max|plus|mini|ultra|fe|\\+))';
      const ok = new RegExp(`\\b${esc(alvo)}\\b${suf}`).test(n) ||
        (n.includes(marca) && curto && new RegExp(`(?<![\\w.])${esc(curto)}\\b${suf}`).test(n));
      if (!ok) return false;
    }
  }
  for (const [peca, rx] of Object.entries(PEDIDO)) {
    if (rx.test(p) && !PECAS[peca].test(n)) return false;
  }
  if (!mp) {
    for (const w of (p.match(/[a-z0-9]+/g) || []).filter(w => w.length > 2)) if (!n.includes(w)) return false;
  }
  return true;
}

// ---------------------------------------------------------------- preços
export function preco(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  let s = String(v).replace(/[^\d,.]/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------- leitura de páginas HTML
const RE_PRECO = [
  /data-price-amount="([\d.]+)"/,
  /itemprop="price"[^>]*content="([\d.,]+)"/,
  /content="([\d.,]+)"[^>]*itemprop="price"/,
  /(\d{1,4}(?:[.\s]\d{3})*,\d{2})\s*(?:&nbsp;|\s)*(?:<[^>]+>\s*)*(?:€|&euro;|EUR)/,
  /(?:€|&euro;)\s*(?:<[^>]+>\s*)*(\d{1,4}(?:[.,]\d{2}))/,
];

export function extrairHtml(pag, base) {
  const abs = (u) => { try { return new URL(u, base).href; } catch { return null; } };
  const out = [];
  for (const m of pag.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    let d; try { d = JSON.parse(m[1]); } catch { continue; }
    const itens = Array.isArray(d) ? d : (d.itemListElement || d['@graph'] || [d]);
    for (const it of Array.isArray(itens) ? itens : []) {
      const p = it && (it.item || it);
      if (p && p['@type'] === 'Product' && p.name) {
        let of = p.offers || {}; if (Array.isArray(of)) of = of[0] || {};
        out.push({ nome: limpa(p.name), preco: preco(of.price ?? of.lowPrice), url: abs(p.url || ''),
          foto: typeof p.image === 'string' ? p.image : (Array.isArray(p.image) ? p.image[0] : null),
          stock: of.availability ? /InStock/.test(of.availability) : null });
      }
    }
  }
  if (out.length) return out;
  const vistos = new Set();
  for (const m of pag.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1], texto = limpa(m[2]);
    if (texto.length < 12 || texto.length > 160 || vistos.has(href) || /^(javascript|mailto|tel)/.test(href)) continue;
    if (!modelo(texto) && !/(ecra|bateria|display|lcd|camara|conector)/.test(norm(texto))) continue;
    const janela = pag.slice(m.index + m[0].length, m.index + m[0].length + 2500);
    let pr = null;
    for (const rx of RE_PRECO) { const pm = janela.match(rx); if (pm) { pr = preco(pm[1]); break; } }
    if (pr === null) continue;
    vistos.add(href);
    const zona = pag.slice(Math.max(0, m.index - 1500), m.index + m[0].length + 500);
    const img = zona.match(/<img[^>]+(?:data-src|src)="([^"]+)"/);
    out.push({ nome: texto, preco: pr, url: abs(href), foto: img ? abs(img[1]) : null,
      stock: /(esgotad|sem stock|indispon)/.test(norm(janela.slice(0, 800))) ? false : null });
  }
  return out;
}

// ---------------------------------------------------------------- adaptadores por tipo de loja
const H = { 'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.6',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36' };
const HJ = { ...H, Accept: 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest' };
const HH = { ...H, Accept: 'text/html,application/xhtml+xml' };

async function obter(fetchFn, f, url, json) {
  const headers = { ...(json ? HJ : HH), ...(f.cookie ? { Cookie: f.cookie } : {}) };
  const r = await fetchFn(url, { headers, redirect: 'follow' });
  if (!r.ok) return null;
  if (json) { try { return await r.json(); } catch { return null; } }
  return r.text();
}

const ADAPT = {
  async woo(fx, f, q) {
    const b = f.url.replace(/\/$/, '');
    for (const c of ['/wp-json/wc/store/v1/products', '/wp-json/wc/store/products']) {
      const d = await obter(fx, f, `${b}${c}?search=${encodeURIComponent(q)}&per_page=40`, true);
      if (Array.isArray(d)) return d.map(p => {
        const pr = p.prices || {}, mu = +(pr.currency_minor_unit ?? 2);
        return { nome: unesc(p.name), preco: /^\d+$/.test(String(pr.price)) ? +pr.price / 10 ** mu : preco(pr.price),
          url: p.permalink, foto: (p.images || [])[0]?.src || null, stock: p.is_in_stock ?? null };
      });
    }
    return null;
  },
  async shopify(fx, f, q) {
    const b = f.url.replace(/\/$/, '');
    const d = await obter(fx, f, `${b}/search/suggest.json?q=${encodeURIComponent(q)}&resources[type]=product&resources[limit]=10`, true);
    const ps = d?.resources?.results?.products;
    if (!Array.isArray(ps)) return null;
    return ps.map(p => ({ nome: p.title, preco: preco(p.price), url: new URL(p.url || '', b + '/').href, foto: p.image || null, stock: p.available ?? null }));
  },
  async presta(fx, f, q) {
    const b = f.url.replace(/\/$/, ''), e = encodeURIComponent(q);
    for (const c of [`/index.php?controller=search&s=${e}`, `/pesquisa?s=${e}`, `/search?controller=search&s=${e}`]) {
      const d = await obter(fx, f, `${b}${c}&ajax=1&from-xhr=1&resultsPerPage=36&order=product.price.asc`, true);
      if (d && Array.isArray(d.products)) return d.products.map(p => {
        const cov = p.cover || {};
        return { nome: unesc(p.name), preco: preco(p.price_amount) ?? preco(p.price), url: p.url || p.link,
          foto: (cov.medium || cov.small || {}).url || null, stock: 'quantity' in p ? (p.quantity || 0) > 0 : null };
      });
    }
    return null;
  },
  async html(fx, f, q) {
    const b = f.url.replace(/\/$/, ''), e = encodeURIComponent(q);
    const modelos = f.pesquisa_url ? [f.pesquisa_url] : ['{b}/?s={q}&post_type=product', '{b}/search?q={q}',
      '{b}/catalogsearch/result/?q={q}', '{b}/index.php?route=product/search&search={q}', '{b}/pesquisa?s={q}', '{b}/search?s={q}'];
    for (const mdl of modelos) {
      const url = mdl.replace('{b}', b).replace('{q}', e);
      const pag = await obter(fx, f, url, false);
      if (!pag) continue;
      const out = extrairHtml(pag, url);
      if (out.length) { f._link = url; return out; }
    }
    return null;
  },
};

export function linkPesquisa(f, tipo, q) {
  const b = f.url.replace(/\/$/, ''), e = encodeURIComponent(q);
  if (f.pesquisa_url) return f.pesquisa_url.replace('{q}', e);
  if (f._link) return f._link;
  return { woo: `${b}/?s=${e}&post_type=product`, shopify: `${b}/search?q=${e}`,
    presta: `${b}/index.php?controller=search&s=${e}` }[tipo] || `${b}/?s=${e}`;
}

async function pesquisarLoja(fx, f, q, tipos) {
  const ordem = f.pesquisa_url ? ['html'] : (f.tipo && f.tipo !== 'auto' ? [f.tipo] : (tipos[f.nome] ? [tipos[f.nome]] : ['woo', 'shopify', 'presta', 'html']));
  for (const t of ordem) {
    let r = null;
    try { r = await ADAPT[t](fx, f, q); } catch { r = null; }
    if (r) { tipos[f.nome] = t; return { tipo: t, itens: r }; }
  }
  return { tipo: null, itens: null };
}

/**
 * Pesquisa em todas as lojas ao mesmo tempo.
 * -> { lojas: [{nome, url, tipo, estado, link, itens:[...] }], todos: [...ordenados por preço] }
 */
export async function compararPecas(q, fornecedores, { fetchFn = fetch, tipos = {}, limitePorLoja = 12, timeoutMs = 8000 } = {}) {
  const lojas = await Promise.all(fornecedores.filter(f => f && f.url && f.ativo !== false).map(async (f0) => {
    const f = { ...f0 };
    const r = await Promise.race([pesquisarLoja(fetchFn, f, q, tipos),
      new Promise(res => setTimeout(() => res({ tipo: null, itens: null, timeout: true }), timeoutMs))]);
    const bons = (r.itens || []).filter(x => x.nome && x.url && relevante(q, x.nome))
      .sort((a, b) => (a.preco ?? 1e9) - (b.preco ?? 1e9));
    const unicos = []; const vistos = new Set();
    for (const x of bons) { if (!vistos.has(x.url)) { vistos.add(x.url); unicos.push({ ...x, loja: f.nome }); } }
    return {
      nome: f.nome, url: f.url, tipo: r.tipo, link: linkPesquisa(f, r.tipo, q),
      estado: r.timeout ? 'sem resposta' : (r.itens === null ? 'não consegui ler' : (unicos.length ? 'ok' : 'nada encontrado')),
      itens: unicos.slice(0, limitePorLoja),
    };
  }));
  const todos = lojas.flatMap(l => l.itens).filter(x => x.preco != null).sort((a, b) => a.preco - b.preco);
  return { lojas, todos };
}
