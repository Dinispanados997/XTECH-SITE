// Abre no browser: /.netlify/functions/setup-admin
// Cria (se ainda não existir) a conta do email da loja, põe-na como administradora
// e envia PARA ESSE EMAIL um link para escolher a palavra-passe.
// É seguro deixar aberto: só funciona para o email da loja (GMAIL_USER / SHOP_EMAIL)
// e o link vai sempre para essa caixa de correio.
import crypto from 'node:crypto';
import { addStaff, dbOn } from '../lib/db.mjs';
import { one } from '../lib/sql.mjs';
import { getAuth, siteUrl } from '../lib/auth.mjs';
import { shopEmail, mailProvider } from '../lib/mailer.mjs';

let last = 0;
const page = (title, msg, ok) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#000;color:#f5f5f7;font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:24px;box-sizing:border-box">
<div style="max-width:460px"><div style="width:56px;height:56px;border-radius:50%;background:${ok ? '#fff' : '#3a1513'};color:${ok ? '#000' : '#ff6961'};display:flex;align-items:center;justify-content:center;font-size:26px;margin-bottom:20px">${ok ? '✓' : '!'}</div>
<h1 style="font-size:28px;line-height:1.15;margin:0 0 12px">${title}</h1><p style="color:#a1a1a6;margin:0">${msg}</p></div></body>`, { status: ok ? 200 : 500, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

export default async () => {
  const email = shopEmail().toLowerCase();
  try {
    if (!dbOn()) return page('Falta a base de dados', 'Liga a base de dados Neon ao projeto no Vercel (Storage → Neon).', false);
    if (!process.env.BETTER_AUTH_SECRET) return page('Falta configurar as contas', 'Põe a variável BETTER_AUTH_SECRET no Vercel.', false);
    if (!mailProvider()) return page('Falta o email', 'Configura o Gmail no Vercel (GMAIL_USER e GMAIL_APP_PASSWORD) para receberes o link.', false);
    if (Date.now() - last < 60_000) return page('Espera um minuto', 'Acabámos de enviar um link. Vê a caixa de entrada de ' + email + ' (e o Spam).', false);
    last = Date.now();
    const auth = getAuth();

    // 1) conta: cria-a se ainda não existir (com uma palavra-passe aleatória que vais trocar já a seguir)
    const exists = await one('select id from public."user" where lower(email) = $1', [email]);
    if (!exists) await auth.api.signUpEmail({ body: { email, name: 'Dinis', password: crypto.randomBytes(24).toString('base64url').slice(0, 32) } });
    // 2) administrador
    await addStaff(email, 'Dinis', 'Admin');
    // 3) link para escolher a palavra-passe (vai pelo email da loja)
    await auth.api.requestPasswordReset({ body: { email, redirectTo: siteUrl() + '/?admin=1' } });
    return page('Email enviado', `Abre o Gmail <b style="color:#fff">${email}</b> e carrega em <b style="color:#fff">Escolher palavra-passe</b>. Depois de a guardares, entras logo no painel de admin.`, true);
  } catch (e) {
    console.error('setup-admin', e);
    return page('Não deu', 'Erro: ' + String(e.message).replace(/[<>]/g, '').slice(0, 300) + ' — manda um print disto.', false);
  }
};
