// Acesso à base de dados (Neon) a partir das funções do servidor.
// Mantém os mesmos nomes de antes (quando era Supabase), para as outras funções não mudarem.
import { q, one, asJson, dbOn, dbUrl } from './sql.mjs';
import { getUser, isStaffEmail } from './auth.mjs';

export { dbOn, getUser, isStaffEmail };

export function assertEnv(names) {
  const miss = names.filter((n) => (n === 'DATABASE_URL' ? !dbUrl() : !process.env[n]));
  if (miss.length) throw new Error('Falta configurar no Vercel: ' + miss.join(', '));
}

export function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// ---------------------------------------------------------------- loja (kv)
export async function kvGet(key) {
  const r = await one('select value from public.kv where key = $1', [key]);
  return r ? r.value : null;
}
export async function kvSet(key, value) {
  await q('insert into public.kv (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value', [key, asJson(value)]);
}

// ---------------------------------------------------------------- tabelas
// colunas que se podem escrever em cada tabela (j = jsonb)
export const COLS = {
  orders: { user_id: 0, email: 0, name: 0, phone: 0, nif: 0, items: 'j', subtotal: 0, shipping: 0, total: 0, delivery: 'j', payment_method: 0, status: 0, stripe_session_id: 0, paid_with: 0, tracking: 'j', notes: 0, history: 'j', stock_done: 0, emails: 'j' },
  returns: { order_id: 0, user_id: 0, email: 0, items: 0, reason: 0, details: 0, status: 0, admin_note: 0, emails: 'j' },
  inbox: { kind: 0, user_id: 0, email: 0, payload: 'j', status: 0, imported: 0 },
  bookings: { user_id: 0, service: 0, service_label: 0, device: 0, issue: 0, day: 0, slot: 0, name: 0, phone: 0, email: 0, status: 0, source: 0, admin_note: 0, repair_id: 0, history: 'j', emails: 'j', created_at: 0 },
};
function pick(table, obj) {
  const cols = COLS[table]; const keys = []; const vals = [];
  for (const [k, v] of Object.entries(obj || {})) {
    if (!(k in cols) || v === undefined) continue;
    keys.push(k); vals.push(cols[k] === 'j' ? asJson(v) : (v !== null && typeof v === 'object' ? JSON.stringify(v) : v));
  }
  return { keys, vals };
}
export async function insertRow(table, obj) {
  const { keys, vals } = pick(table, obj);
  if (!keys.length) throw new Error('nada para gravar');
  const cols = COLS[table];
  const ph = keys.map((k, i) => (cols[k] === 'j' ? `$${i + 1}::jsonb` : `$${i + 1}`));
  return one(`insert into public.${table} (${keys.map((k) => `"${k}"`).join(',')}) values (${ph.join(',')}) returning *`, vals);
}
export async function updateRow(table, id, patch) {
  const { keys, vals } = pick(table, patch);
  if (!keys.length) return getRow(table, id);
  const cols = COLS[table];
  const sets = keys.map((k, i) => `"${k}" = $${i + 2}${cols[k] === 'j' ? '::jsonb' : ''}`);
  return one(`update public.${table} set ${sets.join(', ')} where id = $1 returning *`, [Number(id), ...vals]);
}
export async function getRow(table, id) {
  if (!COLS[table]) throw new Error('tabela inválida');
  return one(`select * from public.${table} where id = $1`, [Number(id)]);
}

export const insertOrder = (row) => insertRow('orders', row);
export const getOrder = (id) => getRow('orders', id);
export const updateOrder = (id, patch) => updateRow('orders', id, patch);
export const getOrderBySession = (sid) => one('select * from public.orders where stripe_session_id = $1', [sid]);

// baixa o stock dos artigos de uma encomenda (uma só vez por encomenda)
export async function applyStock(order) {
  if (order.stock_done) return;
  for (const [key, type] of [['devices', 'device'], ['accessories', 'accessory']]) {
    const list = await kvGet(key);
    if (!Array.isArray(list)) continue;
    let changed = false;
    for (const line of order.items || []) {
      if (line.type !== type) continue;
      const it = list.find((x) => Number(x.id) === Number(line.id));
      if (it && it.qty != null && it.qty !== '' && !isNaN(Number(it.qty))) { it.qty = Math.max(0, Number(it.qty) - (Number(line.qty) || 1)); changed = true; }
    }
    if (changed) await kvSet(key, list);
  }
  await updateOrder(order.id, { stock_done: true });
}

// ---------------------------------------------------------------- funções SQL (claim_email, …)
const RPC = {
  claim_email: (a) => one('select public.claim_email($1, $2, $3) as r', [a.p_table, a.p_id, a.p_key]).then((x) => x && x.r),
  unclaim_email: (a) => q('select public.unclaim_email($1, $2, $3)', [a.p_table, a.p_id, a.p_key]).then(() => null),
};
export async function rpc(name, args) {
  if (!RPC[name]) throw new Error('função desconhecida: ' + name);
  return RPC[name](args || {});
}

// marcações de um dia que ainda estão ativas (para os lembretes)
export const bookingsOn = (day) => q("select id from public.bookings where day = $1 and status in ('pendente','confirmada')", [day]);
// só para o diagnóstico: últimas marcações (sem dados pessoais)
export const lastBookings = () => q('select id, number, day, slot, status, emails, created_at from public.bookings order by id desc limit 5');

export async function addStaff(email, name, role) {
  await q('insert into public.staff (email, name, role) values ($1, $2, $3) on conflict (email) do update set name = excluded.name, role = excluded.role', [email.toLowerCase(), name, role]);
}

// pedidos de orçamento ainda sem email enviado — últimos 2 dias
export const pendingQuotes = () => q("select * from public.inbox where kind = 'quote' and payload->>'_emailed' is null and created_at >= now() - interval '2 days' order by id limit 20");
// marca como avisado; só devolve true a quem chegar primeiro
export async function claimQuote(row) {
  const r = await q("update public.inbox set payload = payload || jsonb_build_object('_emailed', now()) where id = $1 and payload->>'_emailed' is null returning id", [Number(row.id)]);
  return r.length > 0;
}
export async function unclaimQuote(row) {
  await q('update public.inbox set payload = $2::jsonb where id = $1', [Number(row.id), asJson(row.payload || {})]);
}

// ---------------------------------------------------------------- ferramentas do painel admin
// Com base de dados: só a equipa pode usar. Sem base de dados (modo demonstração): aberto,
// mas só a partir do próprio site e com limite de pedidos.
const _hitsAdm = new Map();
export const clientIp = (req) => (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'x').split(',')[0].trim();
export async function guardaAdmin(req, { porMinuto = 30 } = {}) {
  const ip = clientIp(req);
  const now = Date.now();
  const arr = (_hitsAdm.get(ip) || []).filter((t) => now - t < 60_000);
  if (arr.length >= porMinuto) return json(429, { error: 'Demasiados pedidos. Espera um minuto.' });
  arr.push(now); _hitsAdm.set(ip, arr);
  const origin = req.headers.get('origin') || '';
  const site = (process.env.SITE_URL || '').replace(/\/$/, '');
  const self = new URL(req.url).origin;
  if (origin && origin !== self && (!site || origin !== site)) return json(403, { error: 'Origem não permitida' });
  if (!dbOn()) return null; // modo demonstração
  const user = await getUser(req);
  if (!user) return json(401, { error: 'Entra no painel admin primeiro.' });
  if (!(await isStaffEmail(user.email))) return json(403, { error: 'Só a equipa pode usar isto.' });
  return null;
}
export const supabaseLigado = dbOn; // nome antigo, usado em pecas.mjs
