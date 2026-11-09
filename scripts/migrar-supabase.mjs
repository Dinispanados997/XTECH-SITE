// Copia tudo do Supabase para o Neon: contas (com as palavras-passe e o login Google),
// equipa, stock e definições, encomendas, devoluções, pedidos, marcações e fotografias.
// Uso (depois de scripts/neon-setup.mjs):
//   node --env-file=.env.local scripts/migrar-supabase.mjs
// Precisa de: SUPABASE_DB_URL (Supabase → Connect → "Session pooler"), DATABASE_URL (Neon)
// e BLOB_READ_WRITE_TOKEN (Vercel Blob) no .env.local. Pode correr-se de novo: não duplica nada.
import crypto from 'node:crypto';
import pg from 'pg';
import { pool, q, asJson } from '../netlify/lib/sql.mjs';

const SRC = (process.env.SUPABASE_DB_URL || '').trim();
if (!SRC) { console.error('Falta SUPABASE_DB_URL no .env.local'); process.exit(1); }
const src = new pg.Pool({ connectionString: SRC, max: 2, ssl: { rejectUnauthorized: false } });
const sq = async (t, p) => (await src.query(t, p)).rows;
const dst = pool();

// ---------- 1) contas ----------
const users = await sq(`select id, email, encrypted_password, email_confirmed_at, raw_user_meta_data as meta, created_at, updated_at
                          from auth.users where email is not null`);
let nu = 0, np = 0, ng = 0;
for (const u of users) {
  const meta = u.meta || {};
  const email = String(u.email).toLowerCase();
  const name = String(meta.name || meta.full_name || email.split('@')[0]).slice(0, 80);
  const r = await dst.query(`insert into public."user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt", meta)
                             values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) on conflict do nothing returning id`,
    [u.id, name, email, !!u.email_confirmed_at, meta.avatar_url || meta.picture || null, u.created_at, u.updated_at || u.created_at, asJson(meta)]);
  if (r.rowCount) nu++;
  const has = async (prov) => (await q('select 1 from public.account where "userId" = $1 and "providerId" = $2', [u.id, prov])).length > 0;
  if (u.encrypted_password && !(await has('credential'))) {
    await q(`insert into public.account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") values ($1, $2, 'credential', $2, $3, now(), now())`,
      [crypto.randomUUID(), u.id, u.encrypted_password]);
    np++;
  }
}
const ids = await sq(`select user_id, provider_id, created_at from auth.identities where provider = 'google'`);
for (const i of ids) {
  if (!(await q('select 1 from public."user" where id = $1', [i.user_id])).length) continue;
  if ((await q(`select 1 from public.account where "userId" = $1 and "providerId" = 'google'`, [i.user_id])).length) continue;
  await q(`insert into public.account (id, "accountId", "providerId", "userId", "createdAt", "updatedAt") values ($1, $2, 'google', $3, $4, now())`,
    [crypto.randomUUID(), i.provider_id, i.user_id, i.created_at]);
  ng++;
}
console.log(`contas: ${users.length} no Supabase → ${nu} novas, ${np} com palavra-passe, ${ng} ligadas à Google`);

// ---------- 2) tabelas da loja ----------
async function copy(table) {
  const dcols = (await q(`select column_name, data_type from information_schema.columns
                          where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER'`, [table]));
  const rows = await sq(`select * from public.${table}`);
  if (!rows.length) { console.log(`${table}: 0`); return; }
  const cols = dcols.filter((c) => c.column_name in rows[0]);
  const isId = cols.some((c) => c.column_name === 'id') && table !== 'staff' && table !== 'kv';
  const conflict = table === 'staff' ? 'email' : table === 'kv' ? 'key' : 'id';
  let n = 0;
  for (const row of rows) {
    const vals = cols.map((c) => (c.data_type === 'jsonb' ? asJson(row[c.column_name]) : row[c.column_name] == null ? null : c.data_type === 'text' && typeof row[c.column_name] !== 'string' ? String(row[c.column_name]) : row[c.column_name]));
    const ph = cols.map((c, i) => `$${i + 1}${c.data_type === 'jsonb' ? '::jsonb' : ''}`);
    const r = await dst.query(`insert into public.${table} (${cols.map((c) => `"${c.column_name}"`).join(',')}) ${isId ? 'overriding system value' : ''}
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
  const m = url.match(RX); const res = await fetch(url);
  if (!res.ok) { console.warn('foto não encontrada:', url); moved.set(url, url); return url; }
  const { put } = await import('@vercel/blob');
  const b = await put('fotos/' + decodeURIComponent(m[1]), Buffer.from(await res.arrayBuffer()), { access: 'public', contentType: res.headers.get('content-type') || 'image/jpeg', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 31536000 });
  moved.set(url, b.url); return b.url;
}
async function walk(v) {
  if (typeof v === 'string') return RX.test(v) ? move(v) : v;
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = await walk(v[i]); return v; }
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = await walk(v[k]); return v; }
  return v;
}
if (process.env.BLOB_READ_WRITE_TOKEN) {
  for (const { key, value } of await q('select key, value from public.kv')) {
    const before = JSON.stringify(value);
    const after = await walk(value);
    if (JSON.stringify(after) !== before) await q('update public.kv set value = $2::jsonb where key = $1', [key, asJson(after)]);
  }
  for (const t of ['orders']) {
    for (const o of await q(`select id, items from public.${t} where items::text like '%supabase.co/storage%'`)) await q(`update public.${t} set items = $2::jsonb where id = $1`, [o.id, asJson(await walk(o.items))]);
  }
  console.log(`fotografias: ${moved.size} passadas para o Vercel Blob`);
} else console.log('fotografias: falta BLOB_READ_WRITE_TOKEN — ficam a apontar para o Supabase');

await src.end(); await dst.end();
console.log('migração concluída');
