// GET /.netlify/functions/pecas?q=lcd iphone 13
// Pesquisa a peça em todos os fornecedores ao mesmo tempo e devolve os preços de cada loja.
// Lista de fornecedores: a que está guardada no painel (kv "fornecedores") ou a padrão.
import { json, guardaAdmin, supabaseLigado, kvGet } from '../lib/db.mjs';
import { compararPecas, FORNECEDORES_PADRAO } from '../lib/pecas-core.mjs';

const tipos = {};            // tipo de loja detetado (fica em memória enquanto a função está quente)
const cache = new Map();     // pesquisa -> resultado (10 min)

function valida(lista) {
  return (Array.isArray(lista) ? lista : []).slice(0, 12).filter(f => {
    try {
      const u = new URL(f.url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
      if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname) || u.hostname.endsWith('.local')) return false;
      return !!f.nome;
    } catch { return false; }
  }).map(f => ({ nome: String(f.nome).slice(0, 40), url: f.url, pesquisa_url: f.pesquisa_url || undefined,
                 cookie: f.cookie || undefined, ativo: f.ativo !== false }));
}

export default async (req) => {
  const bloqueio = await guardaAdmin(req);
  if (bloqueio) return bloqueio;
  const u = new URL(req.url);
  const q = (u.searchParams.get('q') || '').trim().slice(0, 80);
  if (q.length < 3) return json(400, { error: 'Escreve o que procuras (ex.: lcd iphone 13).' });
  let lista = null;
  if (supabaseLigado()) { try { lista = await kvGet('fornecedores'); } catch { lista = null; } }
  if (!lista && req.method === 'POST') { try { lista = (await req.json()).fornecedores; } catch { lista = null; } }
  lista = valida(lista && lista.length ? lista : FORNECEDORES_PADRAO);
  const chave = q.toLowerCase() + '|' + lista.map(f => f.url).join(',');
  const c = cache.get(chave);
  if (c && Date.now() - c.t < 600_000) return json(200, c.d);
  const d = await compararPecas(q, lista, { tipos, timeoutMs: 8000 });
  d.q = q;
  cache.set(chave, { t: Date.now(), d });
  return json(200, d);
};
