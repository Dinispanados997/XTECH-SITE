// POST /.netlify/functions/notify   { kind: 'order'|'return'|'booking', id }
// O site chama isto depois de criar ou mudar uma encomenda, devolução ou marcação.
// É seguro deixar aberto: o servidor lê o registo na base de dados, decide sozinho
// que email está em falta, envia-o só para o email desse registo e nunca o repete.
import { assertEnv, json } from '../lib/db.mjs';
import { notify } from '../lib/notify-core.mjs';

const hits = new Map();
export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido' });
  const ip = req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'x';
  const now = Date.now(); const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  if (arr.length >= 40) return json(429, { error: 'Demasiados pedidos.' });
  arr.push(now); hits.set(ip, arr);
  try {
    assertEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
    const body = await req.json().catch(() => ({}));
    if (!['order', 'return', 'booking'].includes(body.kind)) return json(400, { error: 'Tipo inválido' });
    const r = await notify(body.kind, Number(body.id));
    return json(200, r);
  } catch (e) {
    console.error(e);
    return json(500, { error: e.message });
  }
};
