// Acesso à base de dados Supabase a partir do servidor (Netlify Functions).
// Usa a chave "service_role" (secreta, só existe nas variáveis de ambiente do Netlify).

const SUPABASE_PROJECT_URL = 'https://nzpbrifskoiidfnttziy.supabase.co';
// aceita o endereço e a chave mesmo que tenham ficado com texto a mais à volta
export const URL_ = () => {
  const raw = (process.env.SUPABASE_URL || '').trim();
  const m = raw.match(/https:\/\/[a-z0-9-]+\.supabase\.(co|in)/i);
  // se a variável não tiver um endereço válido, usa o do projeto da loja (é público, está também no config.js)
  return m ? m[0] : SUPABASE_PROJECT_URL;
};
export const KEY = () => {
  // SUPABASE_SECRET_KEY (nova) tem prioridade; SUPABASE_SERVICE_ROLE_KEY continua a funcionar
  const pick = (k) => { const r = (process.env[k] || '').trim(); return /sb_secret_|^eyJ/.test(r) ? r : ''; };
  const raw = pick('SUPABASE_SECRET_KEY') || pick('SUPABASE_SERVICE_ROLE_KEY') || (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
  const m = raw.match(/sb_secret_[A-Za-z0-9_-]+/) || raw.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  return m ? m[0] : raw;
};

export function assertEnv(names) {
  const miss = names.filter(n => !process.env[n] && !(n === 'SUPABASE_SERVICE_ROLE_KEY' && process.env.SUPABASE_SECRET_KEY) && n !== 'SUPABASE_URL');
  if (miss.length) throw new Error('Falta configurar no Netlify: ' + miss.join(', '));
}

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${URL_()}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY(),
      // chaves antigas (JWT) também vão no Authorization; as novas "sb_secret_…" só no apikey
      ...(KEY().startsWith('sb_') ? {} : { Authorization: `Bearer ${KEY()}` }),
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

export async function getUserFromToken(token) {
  if (!token) return null;
  const res = await fetch(`${URL_()}/auth/v1/user`, {
    headers: { apikey: KEY(), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function kvGet(key) {
  const rows = await rest(`kv?key=eq.${encodeURIComponent(key)}&select=value`);
  return rows && rows[0] ? rows[0].value : null;
}
export async function kvSet(key, value) {
  await rest('kv?on_conflict=key', {
    method: 'POST',
    body: [{ key, value }],
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

export async function insertOrder(row) {
  const rows = await rest('orders', { method: 'POST', body: [row], prefer: 'return=representation' });
  return rows[0];
}
export async function getOrder(id) {
  const rows = await rest(`orders?id=eq.${Number(id)}&select=*`);
  return rows && rows[0] ? rows[0] : null;
}
export async function getOrderBySession(sessionId) {
  const rows = await rest(`orders?stripe_session_id=eq.${encodeURIComponent(sessionId)}&select=*`);
  return rows && rows[0] ? rows[0] : null;
}
export async function updateOrder(id, patch) {
  const rows = await rest(`orders?id=eq.${Number(id)}`, { method: 'PATCH', body: patch, prefer: 'return=representation' });
  return rows && rows[0];
}

// baixa o stock dos artigos de uma encomenda (uma só vez por encomenda)
export async function applyStock(order) {
  if (order.stock_done) return;
  for (const [key, type] of [['devices', 'device'], ['accessories', 'accessory']]) {
    const list = await kvGet(key);
    if (!Array.isArray(list)) continue;
    let changed = false;
    for (const line of order.items || []) {
      if (line.type !== type) continue;
      const it = list.find(x => Number(x.id) === Number(line.id));
      if (it && typeof it.qty === 'number') { it.qty = Math.max(0, it.qty - (Number(line.qty) || 1)); changed = true; }
      else if (it && it.qty != null && it.qty !== '' && !isNaN(Number(it.qty))) { it.qty = Math.max(0, Number(it.qty) - (Number(line.qty) || 1)); changed = true; }
    }
    if (changed) await kvSet(key, list);
  }
  await updateOrder(order.id, { stock_done: true });
}

export function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// ---------------------------------------------------------------- ferramentas do painel admin
// Com Supabase configurado: só a equipa (tabela staff) pode usar. Sem Supabase (modo demonstração): aberto,
// mas só a partir do próprio site e com limite de pedidos.
const _hitsAdm = new Map();
export async function guardaAdmin(req, { porMinuto = 30 } = {}) {
  const ip = req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'x';
  const now = Date.now();
  const arr = (_hitsAdm.get(ip) || []).filter(t => now - t < 60_000);
  if (arr.length >= porMinuto) return json(429, { error: 'Demasiados pedidos. Espera um minuto.' });
  arr.push(now); _hitsAdm.set(ip, arr);
  const origin = req.headers.get('origin') || '';
  const site = (process.env.SITE_URL || process.env.URL || '').replace(/\/$/, '');
  const self = new URL(req.url).origin;
  if (origin && origin !== self && (!site || origin !== site)) return json(403, { error: 'Origem não permitida' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null; // modo demonstração
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const user = await getUserFromToken(token);
  const email = (user && user.email || '').toLowerCase();
  if (!email) return json(401, { error: 'Entra no painel admin primeiro.' });
  const rows = await rest(`staff?email=eq.${encodeURIComponent(email)}&select=email`);
  if (!rows || !rows.length) return json(403, { error: 'Só a equipa pode usar isto.' });
  return null;
}
export const supabaseLigado = () => !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY);

// ---------------------------------------------------------------- emails automáticos
const TABLES = ['orders', 'returns', 'bookings'];
export async function getRow(table, id) {
  if (!TABLES.includes(table)) throw new Error('tabela inválida');
  const rows = await rest(`${table}?id=eq.${Number(id)}&select=*`);
  return rows && rows[0] ? rows[0] : null;
}
export async function rpc(name, args) {
  return rest(`rpc/${name}`, { method: 'POST', body: args });
}
// marcações de um dia que ainda estão ativas (para os lembretes)
export async function bookingsOn(day) {
  return (await rest(`bookings?day=eq.${encodeURIComponent(day)}&status=in.(pendente,confirmada)&select=id`)) || [];
}

// só para o diagnóstico: últimas marcações (sem dados pessoais)
export async function lastBookings() {
  return (await rest('bookings?select=id,number,day,slot,status,emails,created_at&order=id.desc&limit=5')) || [];
}
