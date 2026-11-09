// Corre sozinho todos os dias ao fim da tarde: envia o lembrete a quem tem marcação no dia seguinte.
// (17:00 UTC = 17h no inverno, 18h no verão em Portugal)
import '../../public/emails.js';
import { bookingsOn, dbOn } from '../lib/db.mjs';
import { notify } from '../lib/notify-core.mjs';

export default async () => {
  if (!dbOn()) return new Response('sem base de dados');
  const X = globalThis.XEmails;
  const tomorrow = X.addDays(X.lisbonToday(), 1);
  const list = await bookingsOn(tomorrow);
  let n = 0;
  for (const b of list) {
    try { const r = await notify('booking', b.id, { reminder: true }); n += (r.sent || []).length; }
    catch (e) { console.error('lembrete', b.id, e.message); }
  }
  console.log(`lembretes para ${tomorrow}: ${n} enviado(s) de ${list.length} marcação(ões)`);
  return new Response('ok');
};

export const config = { schedule: '0 17 * * *' };
