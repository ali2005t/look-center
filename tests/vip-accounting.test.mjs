import test from 'node:test';
import assert from 'node:assert/strict';
import { uniqueVipSales, vipBookletRequirements, vipCollectedAmount } from '../src_frontend/js/vip-accounting.mjs';

test('one VIP registration contributes one sale even if it is present in two sources', () => {
  const unique = uniqueVipSales([
    { id: 'local-1', registrationId: 'reg-1', isVip: true, status: 'معلق', finalPrice: 500 },
    { id: 'invoice:1', registrationId: 'reg-1', isVip: true, status: 'مكتمل', finalPrice: 450 },
    { id: 'invoice:2', registrationId: 'reg-2', isVip: true, status: 'مكتمل', finalPrice: 0 }
  ]);
  assert.equal(unique.length, 2);
  assert.equal(unique.find(sale => sale.registrationId === 'reg-1').finalPrice, 450);
});

test('only booklet subscriptions consume stock and repeated items are combined', () => {
  const requirements = vipBookletRequirements([
    { id: 'book-1', type: 'ملازم' },
    { id: 'course-1', type: 'كورسات' },
    { id: 'book-1', type: 'ملازم', quantity: 2 }
  ]);
  assert.deepEqual([...requirements], [['book-1', 3]]);
  assert.throws(() => vipBookletRequirements([{ type: 'ملازم' }]), /معرّف صالح/);
});

test('a free VIP order has zero actual collection, not a fallback to list price', () => {
  assert.equal(vipCollectedAmount({ amountCollected: 0, paidAmount: 250, vipFinalPrice: 250 }), 0);
  assert.equal(vipCollectedAmount({ paidAmount: 120 }), 120);
});
