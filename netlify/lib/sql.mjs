// Ligação à base de dados Neon (Postgres). O endereço vem da variável DATABASE_URL,
// que o Vercel cria sozinho quando ligas a base de dados Neon ao projeto.
import pg from 'pg';

// os valores vêm no mesmo formato que o Supabase devolvia ao site
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));   // bigint → número
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric → número
pg.types.setTypeParser(1082, (v) => v);                               // date → 'AAAA-MM-DD'

export const dbUrl = () => (process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim();
export const dbOn = () => !!dbUrl();

let _pool = null;
export function pool() {
  if (!_pool) {
    if (!dbUrl()) throw new Error('Falta configurar a base de dados (DATABASE_URL).');
    _pool = new pg.Pool({ connectionString: dbUrl(), max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 });
    _pool.on('error', (e) => console.error('pg', e.message));
  }
  return _pool;
}

export async function q(text, params = []) {
  const r = await pool().query(text, params);
  return r.rows;
}
export async function one(text, params = []) {
  const rows = await q(text, params);
  return rows[0] || null;
}

// jsonb: o pg converte listas em arrays do Postgres, por isso vão sempre como texto JSON
export const asJson = (v) => (v === undefined ? undefined : v === null ? null : JSON.stringify(v));
