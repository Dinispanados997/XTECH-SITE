// POST /.netlify/functions/account
//   { action:'signup', email, password, name }  → cria a conta já confirmada (o site entra logo a seguir)
//   { action:'reset', email }                   → envia pelo Gmail da loja um link para escolher nova palavra-passe
// Assim os clientes não dependem do envio de emails do Supabase (lento, limitado e em inglês).
import '../../public/emails.js';
import { authAdmin, json, supabaseLigado } from '../lib/db.mjs';
import { sendMail, mailProvider } from '../lib/mailer.mjs';
import { siteUrl } from '../lib/notify-core.mjs';

const hits = new Map();
function limited(key, max, ms) {
  const now = Date.now(); const arr = (hits.get(key) || []).filter((t) => now - t < ms);
  if (arr.length >= max) return true; arr.push(now); hits.set(key, arr); return false;
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido' });
  if (!supabaseLigado()) return json(503, { error: 'indisponível' });
  const ip = req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'x';
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) return json(400, { error: 'Indica um email válido.' });

  try {
    if (body.action === 'signup') {
      if (limited('s' + ip, 6, 3600e3)) return json(429, { error: 'Demasiadas contas criadas. Tenta mais tarde.' });
      const name = String(body.name || '').trim().slice(0, 80);
      const password = String(body.password || '');
      if (!name) return json(400, { error: 'Indica o teu nome.' });
      if (password.length < 8 || password.length > 72) return json(400, { error: 'A palavra-passe tem de ter pelo menos 8 caracteres.' });
      try {
        await authAdmin('admin/users', { method: 'POST', body: { email, password, email_confirm: true, user_metadata: { name } } });
      } catch (e) {
        if ([400, 409, 422].includes(e.status) && /already|registered|exists/i.test(e.message)) return json(409, { error: 'Já existe uma conta com este email. Entra com a tua palavra-passe (ou usa "Esqueci-me da palavra-passe").' });
        if (e.status === 422 && /password/i.test(e.message)) return json(400, { error: 'Essa palavra-passe é demasiado fraca. Escolhe outra.' });
        throw e;
      }
      return json(200, { ok: true });
    }

    if (body.action === 'reset') {
      if (limited('r' + ip, 5, 3600e3) || limited('e' + email, 3, 3600e3)) return json(429, { error: 'Já enviámos vários links. Vê a caixa de entrada (e o Spam) ou tenta daqui a uma hora.' });
      if (!mailProvider()) return json(503, { error: 'indisponível' });
      let g;
      try { g = await authAdmin('admin/generate_link', { method: 'POST', body: { type: 'recovery', email } }); }
      catch (e) { return json(200, { ok: true }); } // email sem conta: responde igual, para não revelar quem tem conta
      const hashed = g.hashed_token || (g.properties && g.properties.hashed_token);
      if (hashed) {
        const link = `${siteUrl()}/?recuperar=${encodeURIComponent(hashed)}`;
        const m = globalThis.XEmails.render({ tpl: 'conta_reset', to: 'cliente' }, { email }, { siteUrl: siteUrl(), link });
        await sendMail({ to: email, subject: m.subject, html: m.html, text: m.text });
      }
      return json(200, { ok: true });
    }
    return json(400, { error: 'Pedido inválido' });
  } catch (e) {
    console.error('account', body.action, e.message);
    return json(500, { error: 'Não foi possível concluir. Tenta outra vez.' });
  }
};
