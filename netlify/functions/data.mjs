// POST /api/data   { op, ... }
// Tudo o que o site lê e grava na base de dados passa por aqui.
// As regras são as mesmas que o Supabase tinha (Row Level Security):
//   - visitantes: produtos, transportadoras, definições da loja, vagas da agenda, pedidos de orçamento
//   - clientes com conta: as suas encomendas, devoluções, marcações e pedidos
//   - equipa (tabela staff): tudo
// POST /api/data?op=upload  (corpo = imagem)  → guarda uma fotografia no Vercel Blob (só a equipa)
import { q, one, asJson, dbOn } from '../lib/sql.mjs';
import { getAuth } from '../lib/auth.mjs';
import { json, getUser, isStaffEmail, kvSet, insertRow, updateRow, getRow, clientIp, restoreStock } from '../lib/db.mjs';
import { track, stats, live } from '../lib/stats.mjs';

const PUBLIC_KV = ['devices', 'accessories', 'carriers', 'shopSettings', 'agendaSettings'];
const err = (status, msg) => Object.assign(new Error(msg), { status });

const hits = new Map();
function limited(key, max, ms) {
  const now = Date.now(); const arr = (hits.get(key) || []).filter((t) => now - t < ms);
  if (arr.length >= max) return true; arr.push(now); hits.set(key, arr); return false;
}

const OPS = {
  // ---------- loja ----------
  async kvAll({ staff }) {
    return staff ? q('select key, value from public.kv') : q('select key, value from public.kv where key = any($1)', [PUBLIC_KV]);
  },
  async kvSet({ staff, a }) {
    if (!staff) throw err(403, 'Só a equipa pode alterar isto.');
    if (typeof a.key !== 'string' || !a.key || a.key.length > 100) throw err(400, 'chave inválida');
    await kvSet(a.key, a.value);
    return { ok: true };
  },
  async isStaff({ staff }) { return staff; },
  async staffAdd({ staff, a }) {
    if (!staff) throw err(403, 'Só a equipa pode alterar a equipa.');
    await q('insert into public.staff (email, name, role) values ($1, $2, $3) on conflict (email) do update set name = excluded.name, role = excluded.role',
      [String(a.email || '').toLowerCase(), a.name || null, a.role || 'staff']);
    return { ok: true };
  },
  async staffRemove({ staff, a }) {
    if (!staff) throw err(403, 'Só a equipa pode alterar a equipa.');
    await q('delete from public.staff where lower(email) = lower($1)', [String(a.email || '')]);
    return { ok: true };
  },

  // ---------- conta ----------
  async updateMeta({ user, a }) {
    if (!user) throw err(401, 'Inicia sessão primeiro.');
    const meta = { ...(user.meta || {}), ...(a.meta || {}) };
    const name = typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim().slice(0, 80) : user.name;
    await q('update public."user" set meta = $2::jsonb, name = $3, "updatedAt" = now() where id = $1', [user.id, asJson(meta), name]);
    return { id: user.id, email: user.email, name, meta };
  },
  async setPassword({ user, a }) {
    if (!user) throw err(401, 'Inicia sessão primeiro.');
    const p = String(a.password || '');
    if (p.length < 8 || p.length > 72) throw err(400, 'A palavra-passe tem de ter pelo menos 8 caracteres.');
    const ctx = await getAuth().$context;
    const hash = await ctx.password.hash(p);
    const acc = await one(`select id from public.account where "userId" = $1 and "providerId" = 'credential'`, [user.id]);
    if (acc) await ctx.internalAdapter.updatePassword(user.id, hash);
    else await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: hash });
    return { ok: true };
  },

  // ---------- encomendas ----------
  async ordersMine({ user }) {
    if (!user) return [];
    return q('select * from public.orders where user_id = $1 order by created_at desc', [user.id]);
  },
  async ordersGet({ user, staff, a }) {
    const o = await getRow('orders', a.id);
    if (!o || !(staff || (user && o.user_id === user.id))) return null;
    return o;
  },
  async ordersAll({ staff }) {
    if (!staff) return [];
    return q('select * from public.orders order by created_at desc limit 1000');
  },
  async ordersUpdate({ staff, a }) {
    if (!staff) throw err(403, 'Só a equipa pode alterar encomendas.');
    return updateRow('orders', a.id, a.patch);
  },
  async ordersCancelMine({ user, a }) {
    if (!user) throw err(401, 'Inicia sessão primeiro.');
    const o = await one('select * from public.cancel_my_order($1, $2)', [Number(a.id), user.id]);
    if (o && o.stock_done) { await restoreStock(o); o.stock_done = false; }
    return o;
  },

  // ---------- devoluções ----------
  async returnsCreate({ user, a }) {
    if (!user) throw err(401, 'Inicia sessão primeiro.');
    const r = a.row || {};
    const o = await getRow('orders', r.order_id);
    if (!o || o.user_id !== user.id) throw err(403, 'Encomenda não encontrada.');
    return insertRow('returns', { order_id: o.id, items: r.items, reason: r.reason, details: r.details, user_id: user.id, email: user.email });
  },
  async returnsMine({ user }) {
    if (!user) return [];
    return q('select * from public.returns where user_id = $1 order by created_at desc', [user.id]);
  },
  async returnsAll({ staff }) {
    if (!staff) return [];
    return q('select * from public.returns order by created_at desc limit 500');
  },
  async returnsUpdate({ staff, a }) {
    if (!staff) throw err(403, 'Só a equipa pode alterar devoluções.');
    return updateRow('returns', a.id, a.patch);
  },

  // ---------- caixa de entrada (pedidos de orçamento) ----------
  async inboxSubmit({ user, a, ip }) {
    if (limited('in' + ip, 10, 3600e3)) throw err(429, 'Demasiados pedidos. Tenta daqui a uma hora.');
    const payload = a.payload && typeof a.payload === 'object' ? a.payload : {};
    if (JSON.stringify(payload).length > 20000) throw err(400, 'Pedido demasiado grande.');
    const email = String(payload.email || (user && user.email) || '').toLowerCase().slice(0, 200) || null;
    await insertRow('inbox', { kind: String(a.kind || 'quote').slice(0, 40), payload, email, user_id: user ? user.id : null });
    return { ok: true };
  },
  async inboxMine({ user }) {
    if (!user) return [];
    return q('select * from public.inbox where user_id = $1 or lower(email) = $2 order by created_at desc limit 200', [user.id, user.email]);
  },
  async inboxPending({ staff }) {
    if (!staff) return [];
    return q('select * from public.inbox where imported = false order by created_at');
  },
  async inboxUpdate({ staff, a }) {
    if (!staff) throw err(403, 'Só a equipa.');
    return updateRow('inbox', a.id, a.patch);
  },

  // ---------- marcações ----------
  async bookingsBusy({ a }) {
    return q('select day, slot, n from public.booking_busy($1::date, $2::date)', [a.from, a.to]);
  },
  async bookingsCreate({ user, a, ip }) {
    if (limited('bk' + ip, 10, 3600e3)) throw err(429, 'Demasiadas marcações. Liga-nos: 923 512 686.');
    const r = await one('select public.book_service($1::jsonb, $2) as r', [asJson(a.b || {}), user ? user.id : null]);
    return r && r.r;
  },
  async bookingsMine({ user }) {
    if (!user) return [];
    return q('select * from public.bookings where user_id = $1 order by day desc, slot desc', [user.id]);
  },
  async bookingsCancelMine({ user, a }) {
    if (!user) throw err(401, 'Inicia sessão primeiro.');
    return one('select * from public.cancel_my_booking($1, $2)', [Number(a.id), user.id]);
  },
  async bookingsAll({ staff, a }) {
    if (!staff) return [];
    return q('select * from public.bookings where day >= $1::date order by day, slot limit 3000', [a.since]);
  },
  async bookingsAdd({ staff, a }) {
    if (!staff) throw err(403, 'Só a equipa.');
    return insertRow('bookings', a.b);
  },
  async bookingsUpdate({ staff, a }) {
    if (!staff) throw err(403, 'Só a equipa.');
    return updateRow('bookings', a.id, a.patch);
  },
  async bookingsRemove({ staff, a }) {
    if (!staff) throw err(403, 'Só a equipa.');
    await q('delete from public.bookings where id = $1', [Number(a.id)]);
    return { ok: true };
  },

  // ---------- estatísticas do site ----------
  async track({ staff, a, ip, req }) {
    if (staff) return { ok: true };                       // a equipa não conta como visita
    if (limited('tr' + ip, 2400, 3600e3)) return { ok: true };
    return track(req, a, ip);
  },
  async stats({ staff, a }) {
    if (!staff) throw err(403, 'Só a equipa.');
    return stats(a);
  },
  async live({ staff, a }) {
    if (!staff) throw err(403, 'Só a equipa.');
    return live(a);
  },

  // ---------- "tempo real": o site pergunta de x em x segundos o que mudou ----------
  async changes({ user, staff, a }) {
    const since = a.since ? new Date(a.since) : new Date(Date.now() - 60_000);
    const now = (await one('select now() as t')).t;
    const kv = staff
      ? await q('select key, value from public.kv where updated_at > $1', [since])
      : await q('select key, value from public.kv where updated_at > $1 and key = any($2)', [since, PUBLIC_KV]);
    const t = {};
    if (staff) {
      for (const tb of ['orders', 'returns', 'inbox']) t[tb] = !!(await one(`select 1 from public.${tb} where updated_at > $1 or created_at > $1 limit 1`, [since]));
      t.bookings = await q('select * from public.bookings where updated_at > $1 or created_at > $1 order by id', [since]);
    } else if (user) {
      t.orders = !!(await one('select 1 from public.orders where user_id = $1 and updated_at > $2 limit 1', [user.id, since]));
    }
    return { now, kv, tables: t };
  },
};

async function upload(req, staff) {
  if (!staff) return json(403, { error: 'Só a equipa pode enviar fotografias.' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return json(503, { error: 'Falta ligar o Vercel Blob ao projeto.' });
  const type = (req.headers.get('content-type') || '').split(';')[0];
  if (!/^image\/(jpeg|png|webp)$/.test(type)) return json(400, { error: 'Formato de imagem inválido.' });
  const name = String(new URL(req.url).searchParams.get('name') || '').replace(/[^a-z0-9._-]/gi, '').slice(0, 80);
  if (!name) return json(400, { error: 'Falta o nome.' });
  const body = Buffer.from(await req.arrayBuffer());
  if (body.length > 4_000_000) return json(413, { error: 'Imagem demasiado grande.' });
  const { put } = await import('@vercel/blob');
  const r = await put('fotos/p/' + name, body, { access: 'public', contentType: type, addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 31536000 });
  return json(200, { url: r.url });
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido' });
  if (!dbOn()) return json(503, { error: 'Base de dados não configurada.' });
  try {
    const op = new URL(req.url).searchParams.get('op');
    const a = op === 'upload' ? {} : await req.json().catch(() => ({}));
    // estatísticas: quem não tem sessão iniciada não precisa de ir ver a conta (resposta mais rápida)
    const hasSession = /session_token/.test(req.headers.get('cookie') || '');
    const user = a.op === 'track' && !hasSession ? null : await getUser(req);
    const staff = user ? await isStaffEmail(user.email) : false;
    if (op === 'upload') return await upload(req, staff);
    const fn = OPS[a.op];
    if (!fn) return json(400, { error: 'Pedido inválido' });
    const data = await fn({ user, staff, a, ip: clientIp(req), req });
    return json(200, { data });
  } catch (e) {
    if (e.status) return json(e.status, { error: e.message });
    // erros das funções SQL (ex.: "Esse horário já está ocupado") vão tal e qual para o site
    if (e.code === 'P0001') return json(400, { error: e.message });
    console.error('data', e);
    return json(500, { error: 'Erro na base de dados. Tenta outra vez.' });
  }
};
