// Estatísticas do site — guardadas na Neon, sem cookies e sem guardar o IP.
//  events : cada coisa que acontece (página, produto, carrinho, encomenda, scroll, clique…)
//  visits : uma linha por visita (separador aberto) — quando entrou, último sinal, onde está agora,
//           de onde veio, se é a primeira vez. Serve para "quem está no site agora" e tempo de visita.
import crypto from 'node:crypto';
import { q, one } from './sql.mjs';

const KINDS = new Set(['page', 'product', 'cart', 'checkout', 'order', 'scroll', 'booking', 'quote', 'click']);
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|pingdom|uptime|curl|wget|python|node-fetch|axios|whatsapp\/|telegram|discord|vercel-screenshot|google-inspectiontool|bingpreview/i;
const TZ = 'Europe/Lisbon';
const LIVE_SECONDS = 40;   // quem deu sinal nos últimos 40 s está "no site agora" (o site manda sinal a cada 15 s)

let ready = null;
function ensure() {
  if (!ready) ready = q(`
    create table if not exists public.events (
      id bigint generated always as identity primary key, at timestamptz not null default now(),
      vid text not null, sid text, kind text not null, page text, item text, label text, ref text, device text);
    create index if not exists events_at_idx on public.events (at);
    create index if not exists events_kind_at_idx on public.events (kind, at);
    create table if not exists public.visits (
      sid text primary key, vid text not null, started timestamptz not null default now(), last_at timestamptz not null default now(),
      device text, ref text, is_new boolean not null default false, page text, item text,
      pages int not null default 0, events int not null default 0);
    create index if not exists visits_started_idx on public.visits (started);
    create index if not exists visits_last_idx on public.visits (last_at);`).catch((e) => { ready = null; throw e; });
  return ready;
}

const cut = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));
function deviceOf(ua) {
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return 'tablet';
  if (/mobi|iphone|android/i.test(ua)) return 'telemovel';
  return 'computador';
}
// "r" pode ser um endereço (document.referrer) ou um nome já pronto (instagram, utm_source…)
function refOf(r, host) {
  if (!r) return 'direto';
  let h = String(r).toLowerCase();
  if (/^https?:\/\//.test(h)) {
    try { h = new URL(h).hostname.replace(/^www\./, '').replace(/^(l|lm|m|out)\./, ''); } catch { return 'direto'; }
    if (!h || h === host || h.endsWith('.vercel.app') || h === 'localhost') return 'direto';
  }
  if (/google/.test(h)) return 'google';
  if (/instagram|^ig$/.test(h)) return 'instagram';
  if (/facebook|fb\.com|^fb$/.test(h)) return 'facebook';
  if (/tiktok/.test(h)) return 'tiktok';
  if (/bing/.test(h)) return 'bing';
  if (/olx/.test(h)) return 'olx';
  if (/whatsapp|wa\.me/.test(h)) return 'whatsapp';
  if (/vinted/.test(h)) return 'vinted';
  if (/youtube|youtu\.be/.test(h)) return 'youtube';
  if (/chatgpt|openai/.test(h)) return 'chatgpt';
  return h.replace(/[^a-z0-9._-]/g, '').slice(0, 60) || 'direto';
}

export async function track(req, a, ip) {
  const ua = req.headers.get('user-agent') || '';
  if (!ua || BOT.test(ua)) return { ok: true };
  const sid = cut(a.sid, 40);
  if (!sid) return { ok: true };
  await ensure();
  const salt = process.env.BETTER_AUTH_SECRET || 'xtech';
  const seed = a.vid ? 'v|' + String(a.vid).slice(0, 40) : [new Date().toLocaleDateString('en-CA', { timeZone: TZ }), ip, ua].join('|');
  const vid = crypto.createHash('sha256').update(salt + '|' + seed).digest('hex').slice(0, 16);
  const host = new URL(req.url).hostname.replace(/^www\./, '');
  const device = deviceOf(ua);

  const list = (Array.isArray(a.events) ? a.events.slice(0, 25) : []).filter((e) => e && KINDS.has(e.k));
  let ref = null, isNew = false, pages = 0, item, page = cut(a.p, 40);
  const rows = []; const vals = [];
  for (const e of list) {
    let r = null;
    if (e.k === 'page') {
      pages++; item = null;
      if (ref === null && 'r' in e) ref = refOf(e.r, host);
      if (e.l === 'novo') isNew = true;
    }
    if (e.k === 'product') item = cut(e.l, 120);
    if (e.k === 'page' && 'r' in e) r = ref;
    const row = [vid, sid, e.k, cut(e.p, 40), cut(e.i, 40), e.k === 'page' ? null : cut(e.l, 120), r, device];
    rows.push('(' + row.map((_, j) => '$' + (vals.length + j + 1)).join(',') + ')');
    vals.push(...row);
  }
  // as apps (Instagram, TikTok, Facebook) abrem o site no browser delas e não dizem de onde vem
  if (ref === 'direto') {
    if (/Instagram/i.test(ua)) ref = 'instagram';
    else if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) ref = 'facebook';
    else if (/musical_ly|TikTok|BytedanceWebview|trill/i.test(ua)) ref = 'tiktok';
    if (ref !== 'direto') for (let j = 0; j < list.length; j++) if (list[j].k === 'page' && 'r' in list[j]) vals[j * 8 + 6] = ref;
  }
  if (rows.length) await q(`insert into public.events (vid, sid, kind, page, item, label, ref, device) values ${rows.join(',')}`, vals);
  // visita: cria ou atualiza (último sinal, página onde está, produto que está a ver)
  await q(`insert into public.visits (sid, vid, device, ref, is_new, page, item, pages, events)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           on conflict (sid) do update set
             last_at = now(),
             page = coalesce(excluded.page, visits.page),
             item = case when $10 then excluded.item else visits.item end,
             pages = visits.pages + excluded.pages,
             events = visits.events + excluded.events,
             ref = coalesce(visits.ref, excluded.ref),
             is_new = visits.is_new or excluded.is_new`,
    [sid, vid, device, ref, isNew, page, item ?? null, pages, rows.length, item !== undefined]);
  if (Math.random() < 0.005) {
    q("delete from public.events where at < now() - interval '400 days'").catch(() => {});
    q("delete from public.visits where started < now() - interval '400 days'").catch(() => {});
  }
  return { ok: true };
}

// ---------------------------------------------------------------- quem está no site agora (leve, o painel pede de 5 em 5 s)
export async function live(a) {
  await ensure();
  const after = Number(a.after) || 0;
  const [now, recent, today] = await Promise.all([
    q(`select v.sid, v.page, v.item, v.device, v.ref, v.is_new, v.pages,
          extract(epoch from (now() - v.started))::int as secs,
          (select count(*)::int from public.visits x where x.vid = v.vid and x.started < v.started) as before
        from public.visits v where v.last_at > now() - interval '${LIVE_SECONDS} seconds' order by v.started`),
    q(`select id, to_char(at at time zone '${TZ}', 'HH24:MI:SS') as t, to_char(at at time zone '${TZ}', 'DD/MM') as d,
          kind, page, label, ref, device, sid
        from public.events where kind <> 'scroll' and id > $1 order by id desc limit 40`, [after]),
    one(`select count(distinct vid)::int as visitors, count(*)::int as sessions from public.visits
         where started >= (date_trunc('day', now() at time zone '${TZ}')) at time zone '${TZ}'`),
  ]);
  return { now, recent, today };
}

// ---------------------------------------------------------------- números do período
export async function stats(a) {
  await ensure();
  const days = [1, 7, 30, 90, 365].includes(Number(a.days)) ? Number(a.days) : 7;
  // "1" = hoje (desde a meia-noite), o resto = últimos N dias contando com hoje; compara com os N dias antes
  const start = `((date_trunc('day', now() at time zone '${TZ}') - interval '${days - 1} days') at time zone '${TZ}')`;
  const prevStart = `(${start} - interval '${days} days')`;
  // no período anterior só conta até à mesma hora (para "hoje" comparar com "ontem até agora")
  const prevEnd = `(now() - interval '${days} days')`;
  const W = `at >= ${start}`;
  const VW = `started >= ${start}`;
  const local = (c) => `(${c} at time zone '${TZ}')`;

  const evTot = (where) => one(`select count(*) filter (where kind = 'page')::int as pageviews, count(*) filter (where kind = 'product')::int as product_views,
      count(*) filter (where kind = 'cart')::int as carts, count(*) filter (where kind = 'order')::int as orders,
      count(*) filter (where kind = 'booking')::int as bookings, count(*) filter (where kind = 'quote')::int as quotes
    from public.events where ${where}`);
  const viTot = (where) => one(`select count(distinct vid)::int as visitors, count(*)::int as sessions,
      count(distinct vid) filter (where is_new)::int as new_visitors,
      coalesce(round(avg(least(extract(epoch from (last_at - started)), 3600)))::int, 0) as avg_secs,
      count(*) filter (where pages <= 1 and events <= 2 and last_at - started < interval '10 seconds')::int as bounces
    from public.visits where ${where}`);

  const [ev, vi, evP, viP, dailyV, dailyE, hours, pages, products, sources, devices, funnel, scroll, clicks] = await Promise.all([
    evTot(W), viTot(VW),
    evTot(`at >= ${prevStart} and at < ${prevEnd}`), viTot(`started >= ${prevStart} and started < ${prevEnd}`),
    q(`select to_char(${local('started')}::date, 'YYYY-MM-DD') as d, count(distinct vid)::int as visitors, count(*)::int as sessions
        from public.visits where ${VW} group by 1`),
    q(`select to_char(${local('at')}::date, 'YYYY-MM-DD') as d, count(*)::int as pageviews from public.events where ${W} and kind = 'page' group by 1`),
    q(`select extract(hour from ${local('started')})::int as h, count(*)::int as n from public.visits where ${VW} group by 1`),
    q(`select page, count(*)::int as views, count(distinct sid)::int as sessions from public.events
        where ${W} and kind = 'page' group by 1 order by 2 desc limit 15`),
    q(`select item, max(label) as label, count(*) filter (where kind = 'product')::int as views,
          count(distinct sid) filter (where kind = 'product')::int as people, count(*) filter (where kind = 'cart')::int as carts
        from public.events where ${W} and kind in ('product', 'cart') and item is not null
        group by 1 order by 3 desc, 5 desc limit 20`),
    q(`select coalesce(ref, 'direto') as ref, count(*)::int as n from public.visits where ${VW} group by 1 order by 2 desc limit 12`),
    q(`select device, count(*)::int as n from public.visits where ${VW} group by 1 order by 2 desc`),
    one(`select (select count(*)::int from public.visits where ${VW}) as visit,
           count(distinct sid) filter (where kind = 'product')::int as product,
           count(distinct sid) filter (where kind = 'cart')::int as cart,
           count(distinct sid) filter (where kind = 'checkout')::int as checkout,
           count(distinct sid) filter (where kind = 'order')::int as "order"
         from public.events where ${W}`),
    q(`select page, count(distinct sid) filter (where kind = 'page')::int as seen,
          count(distinct sid) filter (where kind = 'scroll' and label in ('25','50','75','100'))::int as s25,
          count(distinct sid) filter (where kind = 'scroll' and label in ('50','75','100'))::int as s50,
          count(distinct sid) filter (where kind = 'scroll' and label in ('75','100'))::int as s75,
          count(distinct sid) filter (where kind = 'scroll' and label = '100')::int as s100
        from public.events where ${W} and kind in ('page', 'scroll') and page is not null
        group by 1 order by 2 desc limit 8`),
    q(`select label, count(*)::int as n, count(distinct sid)::int as people from public.events
        where ${W} and kind = 'click' and label is not null group by 1 order by 2 desc limit 15`),
  ]);
  const pv = Object.fromEntries(dailyE.map((r) => [r.d, r.pageviews]));
  const daily = dailyV.map((r) => ({ ...r, pageviews: pv[r.d] || 0 }));
  for (const r of dailyE) if (!daily.find((x) => x.d === r.d)) daily.push({ d: r.d, visitors: 0, sessions: 0, pageviews: r.pageviews });
  return { days, totals: { ...ev, ...vi }, prev: { ...evP, ...viP }, daily, hours, pages, products, sources, devices, funnel, scroll, clicks };
}
