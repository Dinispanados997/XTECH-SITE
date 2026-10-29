// POST /.netlify/functions/create-order
// Cria a encomenda na base de dados (com preços recalculados aqui no servidor)
// e, se o pagamento for online, devolve o link da página de pagamento do Stripe.
import { assertEnv, getUserFromToken, kvGet, insertOrder, getOrder, updateOrder, applyStock, json } from '../lib/db.mjs';
import { priceFor, itemName, shippingFor } from '../lib/pricing.mjs';
import { createCheckout } from '../lib/stripe.mjs';
import { notify } from '../lib/notify-core.mjs';

const clean = (s, n = 200) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, n);

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido' });
  try {
    assertEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const user = await getUserFromToken(token);
    if (!user || !user.id) return json(401, { error: 'Inicia sessão para finalizar a compra.' });

    const body = await req.json().catch(() => ({}));
    const siteUrl = process.env.SITE_URL || process.env.URL || new URL(req.url).origin;

    // ---- tentar pagar de novo uma encomenda que ficou por pagar ----
    if (body.retryOrderId) {
      const order = await getOrder(body.retryOrderId);
      if (!order || order.user_id !== user.id) return json(404, { error: 'Encomenda não encontrada.' });
      if (!['por_pagar', 'pagamento_falhou'].includes(order.status) || order.payment_method !== 'online')
        return json(400, { error: 'Esta encomenda já não está por pagar.' });
      assertEnv(['STRIPE_SECRET_KEY']);
      const session = await createCheckout(order, siteUrl);
      await updateOrder(order.id, { stripe_session_id: session.id, status: 'por_pagar' });
      return json(200, { order: { id: order.id, number: order.number }, url: session.url });
    }

    // ---- nova encomenda ----
    const lines = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
    if (!lines.length) return json(400, { error: 'O carrinho está vazio.' });

    const [devices, accessories, settings] = await Promise.all([kvGet('devices'), kvGet('accessories'), kvGet('shopSettings')]);
    const items = [];
    for (const l of lines) {
      const type = l.type === 'device' ? 'device' : 'accessory';
      const list = (type === 'device' ? devices : accessories) || [];
      const it = list.find(x => Number(x.id) === Number(l.id));
      if (!it) return json(409, { error: 'Um dos produtos do carrinho já não está disponível. Atualiza o carrinho.' });
      const qty = Math.max(1, Math.min(20, parseInt(l.qty, 10) || 1));
      const stock = it.qty === '' || it.qty == null ? null : Number(it.qty);
      if (stock != null && !isNaN(stock) && stock < qty)
        return json(409, { error: stock <= 0 ? `${itemName(it, type)} esgotou entretanto.` : `Só temos ${stock} unid. de ${itemName(it, type)}.` });
      let priced;
      try { priced = priceFor(it, type, l.opts || {}); }
      catch (e) { return json(409, { error: e.message }); }
      const photo = (it.photos && it.photos[0]) || it.photo || '';
      items.push({
        type, id: it.id, name: itemName(it, type), options: priced.chosen, qty,
        unit: priced.unit, total: Math.round(priced.unit * qty * 100) / 100,
        photo: /^https?:/.test(photo) ? photo : (/^\/?img\//.test(photo) ? siteUrl.replace(/\/$/, '') + '/' + photo.replace(/^\//, '') : ''),
      });
    }

    const d = body.delivery || {};
    const method = d.method === 'ship' && !(settings && settings.allowShipping === false) ? 'ship' : 'pickup';
    const delivery = method === 'ship'
      ? { method, address: clean(d.address), zip: clean(d.zip, 12), city: clean(d.city, 80) }
      : { method };
    if (method === 'ship' && (!delivery.address || !delivery.zip || !delivery.city))
      return json(400, { error: 'Preenche a morada de envio.' });

    const c = body.customer || {};
    const subtotal = Math.round(items.reduce((s, x) => s + x.total, 0) * 100) / 100;
    const shipping = shippingFor(settings, method, subtotal);
    const total = Math.round((subtotal + shipping) * 100) / 100;
    const payInStore = body.payment === 'loja' && method === 'pickup';
    if (!payInStore && total < 0.5) return json(400, { error: 'O valor mínimo para pagamento online é 0,50 €.' });

    const status = payInStore ? 'pagar_na_loja' : 'por_pagar';
    const order = await insertOrder({
      user_id: user.id,
      email: user.email,
      name: clean(c.name || (user.user_metadata && user.user_metadata.name), 120),
      phone: clean(c.phone, 30),
      nif: clean(c.nif, 20),
      items, subtotal, shipping, total, delivery,
      payment_method: payInStore ? 'loja' : 'online',
      status,
      notes: clean(body.notes, 500),
      history: [{ status, at: new Date().toISOString() }],
    });

    if (payInStore) {
      // reserva logo o stock para não vender o mesmo equipamento duas vezes
      await applyStock(order).catch(() => {});
      await notify('order', order.id).catch((e) => console.error('email', e.message)); // "Reserva confirmada" + aviso à loja
      return json(200, { order: { id: order.id, number: order.number, status } });
    }

    assertEnv(['STRIPE_SECRET_KEY']);
    const session = await createCheckout(order, siteUrl);
    await updateOrder(order.id, { stripe_session_id: session.id });
    return json(200, { order: { id: order.id, number: order.number, status }, url: session.url });
  } catch (e) {
    console.error(e);
    return json(500, { error: 'Não foi possível criar a encomenda. ' + (e && e.message ? e.message : '') });
  }
};
