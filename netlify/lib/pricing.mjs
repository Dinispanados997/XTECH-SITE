// Cálculo de preços IGUAL ao da página de produto do site.
// O servidor recalcula tudo a partir dos produtos guardados na base de dados,
// por isso o cliente nunca consegue mudar o preço no browser.

export function optionGroups(item, type) {
  const v = item.variants || {};
  const G = [];
  const add = (key, base, list) => {
    const opts = [];
    const hasZero = (list || []).some(o => o && o.name && Number(o.delta) === 0);
    if (hasZero && key === 'cond') base = '';
    if (base && !(list || []).some(o => o && o.name && o.name.toLowerCase() === String(base).toLowerCase())) {
      opts.push({ name: String(base), delta: 0 });
    }
    (list || []).forEach(o => {
      if (o && o.name && !opts.some(x => x.name.toLowerCase() === o.name.toLowerCase())) {
        opts.push({ name: o.name, delta: Number(o.delta) || 0 });
      }
    });
    if (opts.length) {
      const d = Math.max(0, opts.findIndex(o => Number(o.delta) === 0));
      G.push({ key, opts, def: d });
    }
  };
  if (type === 'device') {
    add('cond', item.cond, v.cond);
    add('battery', item.battery ? `Saúde da bateria ${item.battery}%` : '', v.battery);
    add('storage', item.storage, v.storage);
  }
  add('color', item.color, v.color);
  return G;
}

export function itemName(item, type) {
  return type === 'device' ? `${item.brand || ''} ${item.model || ''}`.trim() : (item.name || '');
}

// opts: {cond:'Excelente', color:'Preto', …} (nomes escolhidos pelo cliente)
// devolve {unit, chosen:[{key,name}]} ou lança erro se a opção já não existir
export function priceFor(item, type, opts = {}) {
  let p = Number(item.price) || 0;
  const chosen = [];
  for (const g of optionGroups(item, type)) {
    const want = opts[g.key];
    let o = g.opts[g.def];
    if (want != null && want !== '') {
      o = g.opts.find(x => x.name.toLowerCase() === String(want).toLowerCase());
      if (!o) throw new Error(`A opção "${want}" já não está disponível para ${itemName(item, type)}.`);
    }
    p += Number(o.delta) || 0;
    chosen.push({ key: g.key, name: o.name });
  }
  return { unit: Math.round(p * 100) / 100, chosen };
}

export function shippingFor(settings, method, subtotal) {
  const s = settings || {};
  if (method !== 'ship') return 0;
  const fee = s.shipFee != null ? Number(s.shipFee) : 4.9;
  const free = Number(s.freeShipFrom) || 0;
  if (free > 0 && subtotal >= free) return 0;
  return Math.round(fee * 100) / 100;
}
