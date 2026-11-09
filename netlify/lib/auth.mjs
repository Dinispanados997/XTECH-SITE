// Contas dos clientes e da equipa (Better Auth), guardadas na base de dados Neon.
// - email + palavra-passe (bcrypt: as palavras-passe que vieram do Supabase continuam a funcionar)
// - entrar com a Google (precisa de GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET)
// - "esqueci-me da palavra-passe": o email sai pelo email da loja (mailer.mjs)
import { betterAuth } from 'better-auth';
import bcrypt from 'bcryptjs';
import '../../public/emails.js';
import { pool, one } from './sql.mjs';
import { sendMail } from './mailer.mjs';

export const siteUrl = () => {
  const s = (process.env.SITE_URL || process.env.URL || '').trim().replace(/\/$/, '');
  if (s) return s;
  const v = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return v ? 'https://' + v : '';
};

export function authOptions() {
  const site = siteUrl();
  const google = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET;
  return {
    appName: 'Xtech Store',
    baseURL: site ? site + '/api/auth' : undefined,
    basePath: '/api/auth',
    secret: process.env.BETTER_AUTH_SECRET,
    database: pool(),
    trustedOrigins: [site, process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : '', process.env.VERCEL_BRANCH_URL ? 'https://' + process.env.VERCEL_BRANCH_URL : ''].filter(Boolean),
    user: { additionalFields: { meta: { type: 'json', required: false, input: false } } },
    account: { accountLinking: { enabled: true, trustedProviders: ['google'] } },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 72,
      autoSignIn: true,
      password: {
        hash: (password) => bcrypt.hash(password, 10),
        verify: async ({ hash, password }) => !!hash && hash.startsWith('$2') && bcrypt.compare(password, hash),
      },
      resetPasswordTokenExpiresIn: 60 * 60 * 24,
      sendResetPassword: async ({ user, url, token }) => {
        const admin = /admin%3D1|admin=1/.test(url);
        const link = `${siteUrl()}/?recuperar=${encodeURIComponent(token)}&e=${encodeURIComponent(user.email)}${admin ? '&admin=1' : ''}`;
        const m = globalThis.XEmails.render({ tpl: admin ? 'admin_acesso' : 'conta_reset', to: 'cliente' }, { email: user.email }, { siteUrl: siteUrl(), link });
        await sendMail({ to: user.email, subject: m.subject, html: m.html, text: m.text });
      },
    },
    socialProviders: google ? { google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, prompt: 'select_account' } } : {},
    telemetry: { enabled: false },
  };
}

let _auth = null;
export function getAuth() {
  if (!_auth) _auth = betterAuth(authOptions());
  return _auth;
}

// utilizador com sessão iniciada (pelo cookie da sessão), ou null
export async function getUser(req) {
  try {
    const s = await getAuth().api.getSession({ headers: req.headers });
    if (!s || !s.user) return null;
    const u = s.user;
    return { id: u.id, email: String(u.email || '').toLowerCase(), name: u.name || '', meta: u.meta || {} };
  } catch (e) {
    console.error('sessão', e.message);
    return null;
  }
}

export async function isStaffEmail(email) {
  if (!email) return false;
  return !!(await one('select 1 from public.staff where lower(email) = lower($1)', [email]));
}
