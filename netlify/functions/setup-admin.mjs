// Abre no browser: /.netlify/functions/setup-admin
// Cria (ou confirma) a conta do email da loja, põe-na como administradora
// e envia PARA ESSE EMAIL um link para escolher a palavra-passe.
// É seguro deixar aberto: só funciona para o email da loja (GMAIL_USER / SHOP_EMAIL)
// e o link vai sempre para essa caixa de correio.
import '../../public/emails.js';
import { authAdmin, addStaff } from '../lib/db.mjs';
import { sendMail, shopEmail, mailProvider } from '../lib/mailer.mjs';
import { siteUrl } from '../lib/notify-core.mjs';

let last = 0;
const page = (title, msg, ok) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#000;color:#f5f5f7;font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:24px;box-sizing:border-box">
<div style="max-width:460px"><div style="width:56px;height:56px;border-radius:50%;background:${ok ? '#fff' : '#3a1513'};color:${ok ? '#000' : '#ff6961'};display:flex;align-items:center;justify-content:center;font-size:26px;margin-bottom:20px">${ok ? '✓' : '!'}</div>
<h1 style="font-size:28px;line-height:1.15;margin:0 0 12px">${title}</h1><p style="color:#a1a1a6;margin:0">${msg}</p></div></body>`, { status: ok ? 200 : 500, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

export default async () => {
  const email = shopEmail().toLowerCase();
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SECRET_KEY) return page('Falta a chave do Supabase', 'Põe a chave secreta do Supabase no Netlify (SUPABASE_SERVICE_ROLE_KEY).', false);
    if (!mailProvider()) return page('Falta o email', 'Configura o Gmail no Netlify (GMAIL_USER e GMAIL_APP_PASSWORD) para receberes o link.', false);
    if (Date.now() - last < 60_000) return page('Espera um minuto', 'Acabámos de enviar um link. Vê a caixa de entrada de ' + email + ' (e o Spam).', false);
    last = Date.now();

    // 1) conta: cria já confirmada; se já existir, confirma-a
    try {
      await authAdmin('admin/users', { method: 'POST', body: { email, email_confirm: true, user_metadata: { name: 'Dinis' } } });
    } catch (e) {
      if (![400, 409, 422].includes(e.status)) throw e;
      const list = await authAdmin('admin/users?per_page=1000');
      const u = (list.users || list || []).find((x) => (x.email || '').toLowerCase() === email);
      if (!u) throw e;
      if (!u.email_confirmed_at) await authAdmin('admin/users/' + u.id, { method: 'PUT', body: { email_confirm: true } });
    }
    // 2) administrador
    await addStaff(email, 'Dinis', 'Admin');
    // 3) link para escolher a palavra-passe (vai pelo Gmail da loja)
    const g = await authAdmin('admin/generate_link', { method: 'POST', body: { type: 'recovery', email } });
    const hashed = g.hashed_token || (g.properties && g.properties.hashed_token);
    if (!hashed) throw new Error('O Supabase não devolveu o link.');
    const link = `${siteUrl()}/?recuperar=${encodeURIComponent(hashed)}&admin=1`;
    const m = globalThis.XEmails.render({ tpl: 'admin_acesso', to: 'cliente' }, { email }, { siteUrl: siteUrl(), link });
    await sendMail({ to: email, subject: m.subject, html: m.html, text: m.text });
    return page('Email enviado', `Abre o Gmail <b style="color:#fff">${email}</b> e carrega em <b style="color:#fff">Escolher palavra-passe</b>. Depois de a guardares, entras logo no painel de admin.`, true);
  } catch (e) {
    console.error('setup-admin', e);
    return page('Não deu', 'Erro: ' + String(e.message).replace(/[<>]/g, '').slice(0, 300) + ' — manda um print disto.', false);
  }
};
