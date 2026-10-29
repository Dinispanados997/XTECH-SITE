// Ligação ao Stripe sem bibliotecas externas (API REST + verificação de assinatura).
import crypto from 'node:crypto';

function form(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

export async function stripe(path, params, method = 'POST') {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: method === 'GET' ? undefined : form(params || {}).join('&'),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data && data.error && data.error.message) || `Stripe ${res.status}`);
  return data;
}

// Cria a página de pagamento do Stripe para uma encomenda.
// Os métodos (MB WAY, Multibanco, cartão, Apple Pay, Google Pay) são os que
// estiverem ligados no painel do Stripe → Definições → Métodos de pagamento.
export async function createCheckout(order, siteUrl) {
  const line_items = (order.items || []).map(l => ({
    quantity: l.qty || 1,
    price_data: {
      currency: 'eur',
      unit_amount: Math.round(Number(l.unit) * 100),
      product_data: {
        name: String(l.name || 'Artigo').slice(0, 250),
        ...(l.options && l.options.length ? { description: l.options.map(o => o.name).join(' · ').slice(0, 500) } : {}),
      },
    },
  }));
  if (Number(order.shipping) > 0) {
    line_items.push({
      quantity: 1,
      price_data: { currency: 'eur', unit_amount: Math.round(Number(order.shipping) * 100), product_data: { name: 'Envio' } },
    });
  }
  const base = siteUrl.replace(/\/$/, '');
  return stripe('checkout/sessions', {
    mode: 'payment',
    locale: 'pt',
    customer_email: order.email,
    client_reference_id: String(order.id),
    metadata: { order_id: String(order.id), order_number: order.number },
    payment_intent_data: { metadata: { order_id: String(order.id), order_number: order.number } },
    line_items: Object.fromEntries(line_items.map((x, i) => [i, x])),
    success_url: `${base}/?encomenda=${order.id}&pagamento=ok`,
    cancel_url: `${base}/?encomenda=${order.id}&pagamento=cancelado`,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 23,
  });
}

// Confirma que o pedido veio mesmo do Stripe (assinatura do webhook)
export function verifySignature(rawBody, header, secret, toleranceSec = 600) {
  if (!header || !secret) return false;
  const t = header.split(',').map(p => p.trim()).find(p => p.startsWith('t='));
  const sigs = header.split(',').map(p => p.trim()).filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  if (!t || !sigs.length) return false;
  const ts = Number(t.slice(2));
  if (!ts || Math.abs(Date.now() / 1000 - ts) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`, 'utf8').digest('hex');
  return sigs.some(s => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}
