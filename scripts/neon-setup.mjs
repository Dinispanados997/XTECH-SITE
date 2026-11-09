// Cria (ou atualiza) as tabelas da loja na base de dados Neon.
// Uso:  vercel env pull .env.local   e depois   node --env-file=.env.local scripts/neon-setup.mjs
// Pode correr-se várias vezes sem estragar nada.
import fs from 'node:fs';
import { getMigrations } from 'better-auth/db/migration';
import { authOptions } from '../netlify/lib/auth.mjs';
import { pool, q } from '../netlify/lib/sql.mjs';

// 1) tabelas das contas (Better Auth: user, session, account, verification)
const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(authOptions());
console.log('contas:', toBeCreated.map((t) => 'criar ' + t.table).concat(toBeAdded.map((t) => 'atualizar ' + t.table)).join(', ') || 'já estão em dia');
await runMigrations();

// 2) tabelas e funções da loja
await pool().query(fs.readFileSync(new URL('../neon/schema.sql', import.meta.url), 'utf8'));
const t = await q("select table_name from information_schema.tables where table_schema = 'public' order by 1");
console.log('tabelas:', t.map((r) => r.table_name).join(', '));
await pool().end();
