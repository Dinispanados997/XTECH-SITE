// Vinted: os anúncios mais baratos de uma pesquisa, comparados com o preço normal de mercado.
// O preço normal = mediana dos anúncios recentes do mesmo modelo/capacidade que não dizem ter defeito.
import { modelo, norm } from './pecas-core.mjs';

const BASE = 'https://www.vinted.pt';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

export class VintedBloqueado extends Error {}

export function armaz(t) {
  const s = norm(t);
  const tb = s.match(/\b(1|2) ?tb\b/); if (tb) return tb[1] + 'TB';
  for (const m of s.matchAll(/\b(\d{2,3}) ?(gb|giga)\b/g)) {
    if ([16, 32, 64, 128, 256, 512].includes(+m[1]) && !/^ ?(de )?ram\b/.test(s.slice(m.index + m[0].length, m.index + m[0].length + 7))) return m[1] + 'GB';
  }
  return null;
}

const ACESS = /\b(capa|capas|case|cover|pelicula|protetor|vidro temperado|carregador|cabo|adaptador|suporte|bolsa|bracelete|correia|skin|airpods|auriculares|magsafe|powerbank|caixa vazia|so caixa|apenas caixa)\b/;
const ACESS_OK = /(\bcom|\+|\be|oferta( de)?|inclui|mais|&|traz|vem com)\s*(\w+\s){0,2}$/;
export function acessorio(titulo) {
  const t = norm(titulo);
  if (/^(caixa|capa|capas|pelicula|case|cover|carregador|cabo)\b/.test(t)) return true;
  for (const m of t.matchAll(new RegExp(ACESS, 'g'))) if (!ACESS_OK.test(t.slice(Math.max(0, m.index - 22), m.index))) return true;
  return false;
}

const DEF = [
  ['ecrã partido', /(ecra|tela|display|vidro(?! traseiro))[^.,;]{0,25}(partid|rachad|estalad|quebrad|danificad)|(partid|rachad|estalad)[^.,;]{0,12}(ecra|tela|display)/],
  ['traseira partida', /(traseira|tampa|vidro traseiro)[^.,;]{0,25}(partid|rachad|estalad)/],
  ['bateria', /bateria[^.,;0-9]{0,20}([4-8]\d) ?%|bateria[^.,;]{0,20}(fraca|viciad|manutencao|servico)/],
  ['face id', /face ?id[^.,;]{0,20}(nao funciona|avariad|sem)/],
  ['avaria', /(nao liga|para pecas|nao carrega|apanhou agua|placa avariada|bootloop)/],
  ['iCloud/bloqueado', /(bloquead[oa] (no |na |a |ao )?(icloud|conta)|icloud bloqueado|com icloud)/],
];
export function defeitos(titulo) {
  const t = norm(titulo), out = [];
  for (const [nome, rx] of DEF) if (rx.test(t)) out.push(nome);
  if (!out.length && /\b(partid[oa]|rachad[oa]|estalad[oa])\b/.test(t)) out.push('partido');
  return out;
}
const SUSP = /(whats ?app|telegram|pay ?pal|mb ?way|transferencia|fora da vinted|9[1236]\d[\s.-]?\d{3}[\s.-]?\d{3}|replica|copia|1:1|so a caixa)/;

export function mediana(vals) {
  const v = vals.filter(x => x > 5).sort((a, b) => a - b);
  if (v.length < 4) return null;
  const med = v[Math.floor(v.length / 2)];
  const bons = v.filter(x => x >= 0.55 * med && x <= 1.8 * med);
  return bons.length >= 4 ? bons[Math.floor(bons.length / 2)] : null;
}

function cookiesDe(res) {
  const lista = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''];
  return lista.map(c => c.split(';')[0]).filter(Boolean).join('; ');
}

export async function sessao(fetchFn = fetch) {
  const r = await fetchFn(BASE + '/', { headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'pt-PT,pt;q=0.9' } });
  if (r.status === 403 || r.status === 429) throw new VintedBloqueado(`A Vinted bloqueou o pedido (HTTP ${r.status})`);
  const ck = cookiesDe(r);
  if (!/access_token_web/.test(ck)) throw new VintedBloqueado('A Vinted não deu acesso (sem cookie de sessão)');
  return ck;
}

export async function catalogo(q, { ordem = 'newest_first', precoMin, precoMax, cookie, fetchFn = fetch } = {}) {
  const p = new URLSearchParams({ search_text: q, order: ordem, per_page: '96', page: '1', currency: 'EUR' });
  if (precoMin) p.set('price_from', String(Math.floor(precoMin)));
  if (precoMax) p.set('price_to', String(precoMax));
  const r = await fetchFn(`${BASE}/api/v2/catalog/items?${p}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'pt-PT,pt;q=0.9', Cookie: cookie, Referer: BASE + '/catalog' } });
  if (!r.ok) throw new VintedBloqueado(`A Vinted respondeu HTTP ${r.status}`);
  const d = await r.json();
  return (d.items || []).map(it => {
    const foto = it.photo || {};
    const pr = typeof it.price === 'object' ? it.price?.amount : it.price;
    return { id: it.id, titulo: it.title || '', preco: parseFloat(pr) || 0, url: it.url || `${BASE}/items/${it.id}`,
      foto: foto.url || null, ts: foto.high_resolution?.timestamp || null, estado: it.status || null,
      vendedor: it.user?.login || null };
  });
}

/** Junta tudo: preço de mercado + os mais baratos. */
export async function maisBaratos(q, { precoMax, fetchFn = fetch, quantos = 40, ordem = 'baratos' } = {}) {
  const alvo = modelo(q), armAlvo = armaz(q);
  const cookie = await sessao(fetchFn);
  const recentes = await catalogo(q, { cookie, fetchFn, precoMax: ordem === 'recentes' ? precoMax : undefined });
  // preço normal por modelo+capacidade (só anúncios sem defeito no título)
  const grupos = {};
  for (const a of recentes) {
    if (acessorio(a.titulo) || defeitos(a.titulo).length || SUSP.test(norm(a.titulo))) continue;
    const m = modelo(a.titulo); if (!m) continue;
    const k1 = `${m}|${armaz(a.titulo) || ''}`, k2 = `${m}|`;
    (grupos[k1] ||= []).push(a.preco); if (k1 !== k2) (grupos[k2] ||= []).push(a.preco);
  }
  const valorDe = (m, ar) => (ar && mediana(grupos[`${m}|${ar}`] || [])) || mediana(grupos[`${m}|`] || []);
  const valorAlvo = alvo ? valorDe(alvo, armAlvo) : null;
  const baratos = ordem === 'recentes' ? [] :
    await catalogo(q, { ordem: 'price_low_to_high', precoMin: valorAlvo ? valorAlvo * 0.2 : 15, precoMax, cookie, fetchFn });
  const vistos = new Set(), itens = [];
  for (const a of [...baratos, ...recentes]) {
    if (vistos.has(a.id)) continue; vistos.add(a.id);
    if (acessorio(a.titulo) || (precoMax && a.preco > precoMax)) continue;
    const m = modelo(a.titulo); if (!m || (alvo && m !== alvo)) continue;
    const ar = armaz(a.titulo); if (armAlvo && ar && ar !== armAlvo) continue;
    const valor = valorDe(m, ar);
    itens.push({ ...a, modelo: m, armaz: ar, valor, desconto: valor ? 1 - a.preco / valor : null,
      defeitos: defeitos(a.titulo), suspeito: SUSP.test(norm(a.titulo)) });
  }
  if (ordem === 'recentes') itens.sort((a, b) => (b.ts || 0) - (a.ts || 0) || b.id - a.id);
  else itens.sort((a, b) => a.preco - b.preco);
  return { ordem, modelo: alvo, armaz: armAlvo, valor: valorAlvo, total: itens.length, itens: itens.slice(0, quantos) };
}

/** Links diretos para o site da Vinted (funcionam sempre, mesmo que o servidor seja bloqueado). */
export function linksVinted(q, { precoMin, precoMax } = {}) {
  const mk = (ordem) => {
    const p = new URLSearchParams({ search_text: q, order: ordem, currency: 'EUR' });
    if (precoMin) p.set('price_from', String(Math.floor(precoMin)));
    if (precoMax) p.set('price_to', String(precoMax));
    return `${BASE}/catalog?${p}`;
  };
  return { baratos: mk('price_low_to_high'), recentes: mk('newest_first') };
}
