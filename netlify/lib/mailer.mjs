// Envio de emails a partir do servidor, sem bibliotecas externas.
//
// Escolhe sozinho conforme as variáveis de ambiente do Netlify:
//   1) RESEND_API_KEY + EMAIL_FROM          → Resend (precisa de domínio próprio verificado)
//   2) GMAIL_USER + GMAIL_APP_PASSWORD       → o teu Gmail (palavra-passe de aplicação)
//   3) SMTP_HOST + SMTP_USER + SMTP_PASS     → outro servidor de email (porta 465, SSL)
// Sem nada configurado, os emails não são enviados (o site continua a funcionar).
import tls from 'node:tls';
import crypto from 'node:crypto';

const env = (k) => (process.env[k] || '').trim();

export function mailProvider() {
  if (env('RESEND_API_KEY') && env('EMAIL_FROM')) return 'resend';
  if (env('GMAIL_USER') && env('GMAIL_APP_PASSWORD')) return 'gmail';
  if (env('SMTP_HOST') && env('SMTP_USER') && env('SMTP_PASS')) return 'smtp';
  return '';
}
export const shopEmail = () => env('SHOP_EMAIL') || env('GMAIL_USER') || 'xtechstorept@gmail.com';
const fromName = () => env('EMAIL_FROM_NAME') || 'Xtech Store';

export async function sendMail({ to, subject, html, text, replyTo }) {
  const p = mailProvider();
  if (!p) return { skipped: 'email não configurado' };
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { skipped: 'sem email válido' };
  replyTo = replyTo || shopEmail();
  if (p === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env('EMAIL_FROM'), to: [to], subject, html, text, reply_to: replyTo }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('Resend: ' + (data.message || res.status));
    return { id: data.id, provider: p };
  }
  const cfg = p === 'gmail'
    ? { host: 'smtp.gmail.com', port: 465, user: env('GMAIL_USER'), pass: env('GMAIL_APP_PASSWORD').replace(/\s+/g, '') }
    : { host: env('SMTP_HOST'), port: Number(env('SMTP_PORT')) || 465, user: env('SMTP_USER'), pass: env('SMTP_PASS') };
  const from = env('EMAIL_FROM_ADDRESS') || cfg.user;
  const raw = buildMime({ fromName: fromName(), from, to, replyTo, subject, html, text });
  await smtpSend({ ...cfg, from, to, raw });
  return { provider: p };
}

/* ------------------------------------------------------------------ mensagem MIME */
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const wrap76 = (s) => s.replace(/.{1,76}/g, (m) => m + '\r\n');
// assunto/nome com acentos: "encoded-words" curtos (máx. 75 caracteres cada)
function encWords(str) {
  if (/^[\x20-\x7e]*$/.test(str)) return str;
  const parts = []; let cur = '';
  for (const ch of str) { if (Buffer.byteLength(cur + ch) > 42) { parts.push(cur); cur = ''; } cur += ch; }
  if (cur) parts.push(cur);
  return parts.map((p) => `=?UTF-8?B?${b64(p)}?=`).join('\r\n ');
}
export function buildMime({ fromName, from, to, replyTo, subject, html, text }) {
  const boundary = 'xt' + crypto.randomBytes(12).toString('hex');
  const domain = (from.split('@')[1] || 'xtechstore.pt');
  const headers = [
    `From: ${encWords(fromName)} <${from}>`,
    `To: <${to}>`,
    replyTo ? `Reply-To: <${replyTo}>` : '',
    `Subject: ${encWords(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean);
  return headers.join('\r\n') + '\r\n\r\n' +
    `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(text || ''))}` +
    `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(html || ''))}` +
    `--${boundary}--\r\n`;
}

/* ------------------------------------------------------------------ cliente SMTP (SSL, porta 465) */
function smtpSend({ host, port, user, pass, from, to, raw }) {
  return new Promise((resolve, reject) => {
    let buf = '', waiting = null, done = false;
    const sock = tls.connect({ host, port, servername: host });
    const fail = (e) => { if (done) return; done = true; try { sock.destroy(); } catch (_) {} reject(e instanceof Error ? e : new Error(String(e))); };
    sock.setEncoding('utf8');
    sock.setTimeout(20000, () => fail(new Error('SMTP: sem resposta do servidor')));
    sock.on('error', fail);
    sock.on('data', (d) => { buf += d; check(); });
    function check() {
      if (!waiting) return;
      const lines = buf.split('\r\n'); // resposta completa quando uma linha tem "123 " (espaço, não hífen)
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) {
          const reply = lines.slice(0, i + 1).join('\n'); buf = lines.slice(i + 1).join('\r\n');
          const w = waiting; waiting = null; w(reply); return;
        }
      }
    }
    const read = () => new Promise((res) => { waiting = res; check(); });
    async function step(cmd, expect, hide) {
      if (cmd != null) sock.write(cmd + '\r\n');
      const r = await read();
      if (!String(r).startsWith(String(expect))) throw new Error(`SMTP ${hide ? '(autenticação)' : cmd ? cmd.split(' ')[0] : 'ligação'}: ${r}`);
      return r;
    }
    (async () => {
      await step(null, 220);
      await step('EHLO xtechstore', 250);
      await step('AUTH LOGIN', 334);
      await step(b64(user), 334, true);
      await step(b64(pass), 235, true);
      await step(`MAIL FROM:<${from}>`, 250);
      await step(`RCPT TO:<${to}>`, 25);
      await step('DATA', 354);
      const body = raw.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
      sock.write(body.endsWith('\r\n') ? body : body + '\r\n');
      await step('.', 250);
      sock.write('QUIT\r\n');
      done = true; sock.end(); resolve(true);
    })().catch((e) => fail(/535|534|auth/i.test(e.message) ? new Error('O Gmail recusou o login. Confirma GMAIL_USER e a palavra-passe de aplicação. (' + e.message + ')') : e));
  });
}
