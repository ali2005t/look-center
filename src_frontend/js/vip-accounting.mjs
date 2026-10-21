export function uniqueVipSales(sales) {
  const unique = new Map();
  for (const sale of sales || []) {
    if (!sale || sale.isVip !== true) continue;
    const key = sale.registrationId ? `registration:${sale.registrationId}` : `sale:${sale.id}`;
    if (key === 'sale:undefined') continue;
    const previous = unique.get(key);
    const preferInvoice = String(sale.id || '').startsWith('invoice:') && !String(previous?.id || '').startsWith('invoice:');
    if (!previous || preferInvoice || (sale.status === 'مكتمل' && previous.status !== 'مكتمل')) unique.set(key, sale);
  }
  return [...unique.values()];
}

export function vipBookletRequirements(items) {
  const quantities = new Map();
  for (const item of items || []) {
    if (item?.type !== 'ملازم') continue;
    if (!item.id) throw new Error('اشتراك الملازم لا يحتوي على معرّف صالح.');
    quantities.set(item.id, (quantities.get(item.id) || 0) + Math.max(1, Number(item.quantity) || 1));
  }
  return quantities;
}

export function vipCollectedAmount(invoice) {
  return Number(invoice?.amountCollected ?? invoice?.paidAmount ?? invoice?.vipFinalPrice ?? 0);
}
