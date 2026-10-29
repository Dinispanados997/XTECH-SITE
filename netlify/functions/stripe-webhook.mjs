// POST /.netlify/functions/stripe-webhook
// O Stripe chama este endereço quando um pagamento é concluído (ou falha).
// É AQUI que a encomenda passa a "Paga" — nunca pelo browser do cliente.
import { assertEnv, getOrder, getOrderBySession, updateOrder, applyStock, json } from '../lib/db.mjs';
import { verifySignature, stripe } from '../lib/stripe.mjs';
import { notify } from '../lib/notify-core.mjs';

const stamp = (o, status, extra = {}) => ({
  status,
  history: [...(o.history || []), { status, at: new Date().toISOString(), by: 'stripe' }],
  ...extra,
});

export default async (req) => {
  try {
    assertEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_WEBHOOK_SECRET']);
    const raw = await req.text();
    if (!verifySignature(raw, req.headers.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET))
      return json(400, { error: 'Assinatura inválida' });

    const event = JSON.parse(raw);
    const s = event.data && event.data.object;
    if (!s || s.object !== 'checkout.session') return json(200, { ignored: true });

    let order = s.metadata && s.metadata.order_id ? await getOrder(s.metadata.order_id) : null;
    if (!order) order = await getOrderBySession(s.id);
    if (!order) return json(200, { ignored: 'encomenda não encontrada' });

    const method = (s.payment_method_types || [])[0] || '';
    const done = ['paga', 'em_preparacao', 'pronta', 'enviada', 'entregue', 'levantada', 'reembolsada'];

    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        if (s.payment_status === 'paid' || event.type === 'checkout.session.async_payment_succeeded') {
          if (!done.includes(order.status)) {
            order = await updateOrder(order.id, stamp(order, 'paga', { paid_with: method || order.paid_with }));
            await applyStock(order);
          }
          await notify('order', order.id).catch((e) => console.error('email', e.message)); // "Obrigado pela compra" + aviso à loja
        } else {
          // ex.: Multibanco — a referência foi gerada e falta o cliente pagar
          await updateOrder(order.id, { paid_with: method || order.paid_with });
          const mb = await multibancoDetails(s).catch(() => null);
          if (mb) await notify('order', order.id, { mb }).catch((e) => console.error('email', e.message));
        }
        break;
      case 'checkout.session.async_payment_failed':
        if (!done.includes(order.status)) await updateOrder(order.id, stamp(order, 'pagamento_falhou'));
        break;
      case 'checkout.session.expired':
        if (order.status === 'por_pagar' && order.stripe_session_id === s.id)
          await updateOrder(order.id, stamp(order, 'cancelada', { notes: [order.notes, 'Pagamento não concluído (sessão expirou).'].filter(Boolean).join('\n') }));
        break;
    }
    // avisa o cliente se a encomenda foi cancelada (só se já tinha sido confirmada)
    if (event.type === 'checkout.session.expired') await notify('order', order.id).catch(() => {});
    return json(200, { received: true });
  } catch (e) {
    console.error(e);
    return json(500, { error: e.message });
  }
};

// dados da referência Multibanco (entidade, referência, validade) para o email
async function multibancoDetails(session) {
  if (!session.payment_intent || !process.env.STRIPE_SECRET_KEY) return null;
  const pi = await stripe(`payment_intents/${session.payment_intent}`, null, 'GET');
  const d = pi && pi.next_action && pi.next_action.multibanco_display_details;
  if (!d || !d.reference) return null;
  const exp = d.expires_at ? new Date(d.expires_at * 1000).toLocaleDateString('pt-PT', { timeZone: 'Europe/Lisbon', day: 'numeric', month: 'long' }) : '';
  return { entity: d.entity, reference: String(d.reference).replace(/(\d{3})(?=\d)/g, '$1 '), expires: exp, url: d.hosted_voucher_url || '' };
}
