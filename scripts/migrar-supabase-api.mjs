// Copia os dados do Supabase para o Neon usando a chave secreta do Supabase (sem precisar
// da palavra-passe da base de dados). Alternativa a scripts/migrar-supabase.mjs.
// Precisa de: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL e BLOB_READ_WRITE_TOKEN.
//   node --env-file=.env.local scripts/migrar-supabase-api.mjs
// Notas:
//  - As palavras-passe NÃO vêm (o Supabase não as dá por esta via): os clientes antigos
//    usam "Esqueci-me da palavra-passe" uma vez. O login com a Google continua ligado à conta.
//  - Não substitui o que já existe no Neon (ex.: o stock atual); pode correr-se de novo.
import crypto from 'node:crypto';
import { q, one, pool, asJson } from '../netlify/lib/sql.mjs';

// (se a variável não tiver um endereço válido, usa o do projeto da loja — era o que o site antigo fazia)
const BASE = (process.env.SUPABASE_URL || '').match(/https:\/\/[a-z0-9-]+\.supabase\.co/i)?.[0] || 'https://nzpbrifskoiidfnttziy.supabase.co';
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
if (!BASE || !KEY) { console.error('Falta SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const H = { apikey: KEY, ...(KEY.startsWith('sb_') ? {} : { Authorization: 'Bearer ' + KEY }) };
async function get(path) {
  const r = await fetch(BASE + path, { headers: H });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  return r.json();
}
async function rest(table) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${BASE}/rest/v1/${table}?select=*&order=${table === 'kv' ? 'key' : table === 'staff' ? 'email' : 'id'}`, { headers: { ...H, Range: `${from}-${from + 999}` } });
    if (!r.ok) throw new Error(`${table} → ${r.status} ${await r.text()}`);
    const rows = await r.json(); out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

// ---------- 1) contas ----------
const users = [];
for (let page = 1; ; page++) {
  const d = await get(`/auth/v1/admin/users?page=${page}&per_page=500`);
  const list = d.users || d; users.push(...list);
  if (list.length < 500) break;
}
let nu = 0, ng = 0;
for (const u of users) {
  if (!u.email) continue;
  const meta = u.user_metadata || {};
  const email = u.email.toLowerCase();
  const r = await pool().query(`insert into public."user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt", meta)
                                values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) on conflict do nothing`,
    [u.id, String(meta.name || meta.full_name || email.split('@')[0]).slice(0, 80), email, !!u.email_confirmed_at,
     meta.avatar_url || meta.picture || null, u.created_at, u.updated_at || u.created_at, asJson(meta)]);
  nu += r.rowCount;
  for (const i of u.identities || []) {
    if (i.provider !== 'google') continue;
    const sub = (i.identity_data && (i.identity_data.sub || i.identity_data.provider_id)) || i.provider_id || i.id;
    if (await one(`select 1 from public.account where "userId" = $1 and "providerId" = 'google'`, [u.id])) continue;
    if (!(await one('select 1 from public."user" where id = $1', [u.id]))) continue;
    await q(`insert into public.account (id, "accountId", "providerId", "userId", "createdAt", "updatedAt") values ($1, $2, 'google', $3, now(), now())`, [crypto.randomUUID(), sub, u.id]);
    ng++;
  }
}
console.log(`contas: ${users.length} no Supabase → ${nu} copiadas, ${ng} ligadas à Google`);

// ---------- 2) tabelas ----------
async function copy(table) {
  const dcols = await q(`select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER'`, [table]);
  const rows = await rest(table);
  if (!rows.length) { console.log(`${table}: 0`); return; }
  const isId = !['staff', 'kv'].includes(table);
  const conflict = table === 'staff' ? 'email' : table === 'kv' ? 'key' : 'id';
  let n = 0;
  for (const row of rows) {
    const cols = dcols.filter((c) => c.column_name in row);
    const vals = cols.map((c) => (c.data_type === 'jsonb' ? asJson(row[c.column_name]) : row[c.column_name]));
    const ph = cols.map((c, i) => `$${i + 1}${c.data_type === 'jsonb' ? '::jsonb' : ''}`);
    const r = await pool().query(`insert into public.${table} (${cols.map((c) => `"${c.column_name}"`).join(',')}) ${isId ? 'overriding system value' : ''}
                                  values (${ph.join(',')}) on conflict ("${conflict}") do nothing`, vals);
    n += r.rowCount;
  }
  if (isId) await q(`select setval(pg_get_serial_sequence('public.${table}', 'id'), greatest((select coalesce(max(id), 0) from public.${table}), 1))`);
  console.log(`${table}: ${rows.length} no Supabase → ${n} copiados`);
}
for (const t of ['staff', 'kv', 'orders', 'returns', 'inbox', 'bookings']) await copy(t);

// ---------- 3) fotografias (Supabase Storage → Vercel Blob) ----------
const RX = /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/fotos\/(.+)$/;
const moved = new Map();
async function move(url) {
  if (moved.has(url)) return moved.get(url);
  const res = await fetch(url);
  if (!res.ok) { console.warn('foto não encontrada:', url); moved.set(url, url); return url; }
  const { put } = await import('@vercel/blob');
  const b = await put('fotos/' + decodeURIComponent(url.match(RX)[1]), Buffer.from(await res.arrayBuffer()),
    { access: 'public', contentType: res.headers.get('content-type') || 'image/jpeg', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 31536000 });
  moved.set(url, b.url); return b.url;
}
async function walk(v) {
  if (typeof v === 'string') return RX.test(v) ? move(v) : v;
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = await walk(v[i]); return v; }
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = await walk(v[k]); return v; }
  return v;
}
if (process.env.BLOB_READ_WRITE_TOKEN) {
  for (const { key, value } of await q(`select key, value from public.kv where value::text like '%supabase.co/storage%'`))
    await q('update public.kv set value = $2::jsonb where key = $1', [key, asJson(await walk(value))]);
  for (const o of await q(`select id, items from public.orders where items::text like '%supabase.co/storage%'`))
    await q('update public.orders set items = $2::jsonb where id = $1', [o.id, asJson(await walk(o.items))]);
  console.log(`fotografias: ${moved.size} passadas para o Vercel Blob`);
}
await pool().end();
console.log('migração concluída');
