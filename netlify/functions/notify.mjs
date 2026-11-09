// POST /.netlify/functions/notify   { kind: 'order'|'return'|'booking', id }
// O site chama isto depois de criar ou mudar uma encomenda, devolução ou marcação.
// É seguro deixar aberto: o servidor lê o registo na base de dados, decide sozinho
// que email está em falta, envia-o só para o email desse registo e nunca o repete.
import { assertEnv, json, lastBookings } from '../lib/db.mjs';
import { mailProvider, mailLoginTest, shopEmail } from '../lib/mailer.mjs';
import { siteUrl, notifyQuotes } from '../lib/notify-core.mjs';
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
    assertEnv(['DATABASE_URL']);
    const body = await req.json().catch(() => ({}));
    if (body.kind === 'quotes') { const q = await notifyQuotes(); console.log('notify quotes', JSON.stringify(q)); return json(200, q); }
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
  const out = {
    DATABASE_URL: v('DATABASE_URL') || v('POSTGRES_URL') ? 'definida' : 'FALTA (liga a base de dados Neon ao projeto no Vercel)',
    BETTER_AUTH_SECRET: v('BETTER_AUTH_SECRET').length >= 32 ? 'ok' : v('BETTER_AUTH_SECRET') ? 'demasiado curta (mínimo 32 caracteres)' : 'FALTA',
    login_google: v('GOOGLE_CLIENT_ID') && v('GOOGLE_CLIENT_SECRET') ? 'configurado' : 'desligado (falta GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)',
    fotos_blob: v('BLOB_READ_WRITE_TOKEN') ? 'ok' : 'FALTA (liga um Vercel Blob ao projeto)',
    GMAIL_USER: v('GMAIL_USER') || 'FALTA',
    GMAIL_APP_PASSWORD: v('GMAIL_APP_PASSWORD') ? `definida (${v('GMAIL_APP_PASSWORD').replace(/\s+/g, '').length} caracteres — devem ser 16)` : 'FALTA',
    STRIPE_SECRET_KEY: !v('STRIPE_SECRET_KEY') ? 'FALTA' : /^sk_test_/.test(v('STRIPE_SECRET_KEY')) ? 'ok — modo de TESTE (sk_test_…)' : /^sk_live_/.test(v('STRIPE_SECRET_KEY')) ? 'ok — pagamentos REAIS (sk_live_…)' : /^rk_/.test(v('STRIPE_SECRET_KEY')) ? 'ok (chave restrita rk_…)' : /^pk_/.test(v('STRIPE_SECRET_KEY')) ? 'ERRADA — puseste a publishable (pk_…); tem de ser a secret (sk_…)' : 'formato estranho',
    STRIPE_WEBHOOK_SECRET: !v('STRIPE_WEBHOOK_SECRET') ? 'FALTA' : /^whsec_/.test(v('STRIPE_WEBHOOK_SECRET')) ? 'ok (whsec_…)' : 'formato estranho (deve começar por whsec_)',
    email_por: mailProvider() || 'nenhum',
    avisos_para: shopEmail(),
    SITE_URL: siteUrl() || 'FALTA',
    IA: v('ANTHROPIC_API_KEY') ? 'ligada' : 'desligada (o site usa o assistente sem IA)',
  };
  try { await lastBookings(); out.base_de_dados = 'ok'; }
  catch (e) { out.base_de_dados = 'ERRO: ' + e.message.slice(0, 300); }
  out.gmail_login = await mailLoginTest();
  return new Response(JSON.stringify(out, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
