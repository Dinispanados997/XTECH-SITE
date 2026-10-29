// POST /.netlify/functions/notify   { kind: 'order'|'return'|'booking', id }
// O site chama isto depois de criar ou mudar uma encomenda, devolução ou marcação.
// É seguro deixar aberto: o servidor lê o registo na base de dados, decide sozinho
// que email está em falta, envia-o só para o email desse registo e nunca o repete.
import { assertEnv, json, lastBookings, URL_, KEY } from '../lib/db.mjs';
import { mailProvider, mailLoginTest, shopEmail } from '../lib/mailer.mjs';
import { siteUrl } from '../lib/notify-core.mjs';
import { notify } from '../lib/notify-core.mjs';

const hits = new Map();
export default async (req) => {
  // diagnóstico: abre /.netlify/functions/notify?diagnostico=1 no browser (não mostra palavras-passe)
  if (req.method === 'GET' && new URL(req.url).searchParams.has('diagnostico')) return diagnostico();
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
    console.log('notify', body.kind, body.id, JSON.stringify(r));
    return json(200, r);
  } catch (e) {
    console.error(e);
    return json(500, { error: e.message });
  }
};

async function diagnostico() {
  const v = (k) => (process.env[k] || '').trim();
  const key = KEY(), rawKey = v('SUPABASE_SECRET_KEY') || v('SUPABASE_SERVICE_ROLE_KEY');
  const out = {
    SUPABASE_URL: URL_() || 'FALTA',
    SUPABASE_SECRET_KEY: v('SUPABASE_SECRET_KEY') ? 'definida' : 'não definida',
    chave_secreta: !key ? 'FALTA' : key.startsWith('sb_publishable') ? 'ERRADA — puseste a publishable; tem de ser a secret (sb_secret_…)' : key.startsWith('sb_secret_') ? 'ok (sb_secret_…)' : key.startsWith('eyJ') ? 'ok (chave antiga service_role)' : `não encontrei uma chave sb_secret_… (o valor tem ${rawKey.length} caracteres e começa por "${rawKey.slice(0, 3)}…")`,
    GMAIL_USER: v('GMAIL_USER') || 'FALTA',
    GMAIL_APP_PASSWORD: v('GMAIL_APP_PASSWORD') ? `definida (${v('GMAIL_APP_PASSWORD').replace(/\s+/g, '').length} caracteres — devem ser 16)` : 'FALTA',
    email_por: mailProvider() || 'nenhum',
    avisos_para: shopEmail(),
    SITE_URL: siteUrl() || 'FALTA',
  };
  try { out.supabase = 'ok'; out.ultimas_marcacoes = (await lastBookings()).map((b) => `${b.number} ${b.day} ${b.slot} ${b.status} · emails: ${(b.emails || []).map((e) => e.k).join(', ') || '—'}`); }
  catch (e) { out.supabase = 'ERRO: ' + e.message.slice(0, 300); }
  out.gmail_login = await mailLoginTest();
  return new Response(JSON.stringify(out, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
