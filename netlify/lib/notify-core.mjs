// Decide e envia os emails automáticos de uma encomenda, devolução ou marcação.
// As regras e os textos estão em public/emails.js (os mesmos que o site usa no modo demonstração).
import '../../public/emails.js';
import { getRow, rpc } from './db.mjs';
import { sendMail, shopEmail, mailProvider } from './mailer.mjs';

const X = globalThis.XEmails;
const TABLE = { order: 'orders', return: 'returns', booking: 'bookings' };
export const siteUrl = () => (process.env.SITE_URL || process.env.URL || '').replace(/\/$/, '');

export async function notify(kind, id, opts = {}) {
  const table = TABLE[kind];
  if (!table || !Number(id)) return { skipped: 'pedido inválido' };
  const rec = await getRow(table, id);
  if (!rec) return { skipped: 'não encontrado' };
  const ctx = { siteUrl: siteUrl(), mb: opts.mb };
  if (kind === 'return') ctx.order = await getRow('orders', rec.order_id);
  if (kind === 'return' && !rec.email && ctx.order) rec.email = ctx.order.email;

  const configured = !!mailProvider();
  const sent = [], skipped = [], errors = [];
  for (const ev of X.due[kind](rec, opts)) {
    // reserva o email antes de enviar: se dois pedidos chegarem ao mesmo tempo, só um envia
    if (!(await rpc('claim_email', { p_table: table, p_id: rec.id, p_key: ev.key }))) continue;
    for (const k of ev.also || []) await rpc('claim_email', { p_table: table, p_id: rec.id, p_key: k });
    const to = X.recipient(ev, rec, shopEmail());
    // sem email configurado (ou sem destinatário) fica marcado como tratado — não envia atrasado mais tarde
    if (!configured || !to) { skipped.push(ev.key); continue; }
    try {
      const m = X.render(ev, rec, ctx);
      await sendMail({ to, subject: m.subject, html: m.html, text: m.text, replyTo: ev.to === 'loja' ? (rec.email || undefined) : undefined });
      sent.push(ev.key);
    } catch (e) {
      console.error('email', kind, rec.id, ev.key, e.message);
      errors.push(ev.key + ': ' + e.message);
      for (const k of [ev.key, ...(ev.also || [])]) await rpc('unclaim_email', { p_table: table, p_id: rec.id, p_key: k }).catch(() => {});
    }
  }
  return { sent, skipped, errors };
}
