// GET /.netlify/functions/vinted?q=iphone 13 128gb&max=400&ordem=recentes|baratos
// Os anúncios mais baratos da Vinted e quanto estão abaixo do preço normal de mercado.
// Se a Vinted bloquear o servidor, devolve { bloqueado:true } e o painel mostra links diretos.
import { json, guardaAdmin } from '../lib/db.mjs';
import { maisBaratos, linksVinted, VintedBloqueado } from '../lib/vinted-core.mjs';

export default async (req) => {
  const bloqueio = await guardaAdmin(req, { porMinuto: 12 });
  if (bloqueio) return bloqueio;
  const u = new URL(req.url);
  const q = (u.searchParams.get('q') || '').trim().slice(0, 80);
  const max = parseInt(u.searchParams.get('max') || '', 10) || undefined;
  const ordem = u.searchParams.get('ordem') === 'recentes' ? 'recentes' : 'baratos';
  if (q.length < 3) return json(400, { error: 'Escreve o que procuras (ex.: iphone 13 128gb).' });
  try {
    const d = await maisBaratos(q, { precoMax: max, ordem });
    return json(200, { ...d, links: linksVinted(q, { precoMin: d.valor ? d.valor * 0.2 : 15, precoMax: max }) });
  } catch (e) {
    const bloqueado = e instanceof VintedBloqueado;
    return json(200, { bloqueado, erro: String(e.message || e), itens: [], links: linksVinted(q, { precoMin: 15, precoMax: max }) });
  }
};
