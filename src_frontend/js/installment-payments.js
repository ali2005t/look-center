import { db } from './firebase.js';
import { Timestamp, doc, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const money = value => Number((Number(value) || 0).toFixed(2));
const firstAmount = values => {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const amount = Number(value);
    if (Number.isFinite(amount)) return amount;
  }
  return 0;
};

export function getInstallmentSummary(invoice) {
  const itemsTotal = (invoice?.items || []).reduce((sum, item) => sum + (Number(item.price) || 0), 0);
  const total = money(firstAmount([invoice?.installment?.total, invoice?.installment?.amount,
    invoice?.subscriptionAmount, invoice?.requestedAmount, invoice?.vipFinalPrice, itemsTotal]));
  const paid = money(firstAmount([invoice?.installment?.paid, invoice?.installment?.paidAmount,
    invoice?.paidAmount, invoice?.amountCollected]));
  return { total, paid, remaining: money(Math.max(0, total - paid)) };
}

export function isInstallmentInvoice(invoice) {
  const installmentMethod = '\u062a\u0642\u0633\u064a\u0637';
  if (invoice?.payment === installmentMethod || invoice?.paymentMethod === installmentMethod) return true;
  const summary = getInstallmentSummary(invoice);
  if (invoice?.isPortalRegistration && summary.remaining > 0) return true;
  if (summary.remaining > 0 && (invoice?.paymentStatus === 'partial' || summary.paid > 0)) return true;
  if (!invoice?.installment) return false;

  const installmentTotal = firstAmount([invoice.installment.total, invoice.installment.amount]);
  return installmentTotal > 0 && summary.remaining > 0;
}

export async function recordInstallmentPayment({ invoiceId, collectionName = 'invoices', amount, method, receivedBy = '-', linkedRegistrationId = '' }) {
  if (!invoiceId) throw new Error('الفاتورة غير محددة');
  if (!['نقدي', 'فودافون كاش'].includes(method)) throw new Error('اختر طريقة دفع صحيحة');
  const invoiceRef = doc(db, collectionName, invoiceId);
  const registrationRef = linkedRegistrationId && collectionName !== 'vipRegistrations'
    ? doc(db, 'vipRegistrations', linkedRegistrationId)
    : null;
  const paidAt = Timestamp.now();

  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(invoiceRef);
    if (!snapshot.exists()) throw new Error('الفاتورة غير موجودة');
    const registrationSnapshot = registrationRef ? await transaction.get(registrationRef) : null;
    const invoice = snapshot.data();
    const summary = getInstallmentSummary(invoice);
    const isInstallment = isInstallmentInvoice({
      ...invoice,
      isPortalRegistration: collectionName === 'studentRegistrations'
    });
    if (!isInstallment) throw new Error('الفاتورة ليست بنظام التقسيط');
    if (summary.remaining <= 0) throw new Error('تم سداد الفاتورة بالكامل');
    const paymentAmount = money(amount);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0 || paymentAmount > summary.remaining) {
      throw new Error('أدخل مبلغًا أكبر من صفر ولا يتجاوز المبلغ المتبقي');
    }

    const paid = money(summary.paid + paymentAmount);
    const remaining = money(Math.max(0, summary.total - paid));
    const paymentEntry = {
      amount: paymentAmount,
      method,
      paidAt,
      receivedBy: receivedBy || '-'
    };
    const installment = {
      ...(invoice.installment || {}),
      total: summary.total,
      paid,
      remaining,
      paidAll: remaining <= 0,
      paymentStatus: remaining <= 0 ? 'paid' : 'partial',
      lastPaymentMethod: method,
      payments: [...(Array.isArray(invoice.installment?.payments) ? invoice.installment.payments : []), paymentEntry]
    };

    transaction.update(invoiceRef, {
      payment: '\u062a\u0642\u0633\u064a\u0637',
      installment,
      paidAmount: paid,
      amountCollected: paid,
      paymentStatus: remaining <= 0 ? 'paid' : 'partial'
    });
    if (registrationRef && registrationSnapshot?.exists()) {
      transaction.update(registrationRef, {
        payment: '\u062a\u0642\u0633\u064a\u0637',
        installment,
        paidAmount: paid,
        amountCollected: paid,
        paymentStatus: remaining <= 0 ? 'paid' : 'partial',
        subscriptionAmount: summary.total
      });
    }
    return { total: summary.total, paid, remaining, paymentEntry };
  });
}

export function showInstallmentPaymentDialog(invoice, {
  invoiceId = invoice?.id || invoice?._id,
  collectionName = invoice?.sourceCollection || 'invoices',
  linkedRegistrationId = invoice?.vipRegistrationId || '',
  receivedBy = '-',
  onSuccess = () => {}
} = {}) {
  const summary = getInstallmentSummary(invoice);
  if (!summary.remaining) return;

  document.getElementById('installment-payment-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'installment-payment-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(12,31,48,.56);display:flex;align-items:center;justify-content:center;padding:16px;direction:rtl;';
  overlay.innerHTML = `
    <section style="width:min(430px,100%);background:#fff;border-radius:16px;padding:22px;box-shadow:0 16px 48px #102a4333;font-family:inherit;">
      <h3 style="margin:0 0 14px;color:#16577c;">تسجيل دفعة تقسيط</h3>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;text-align:center;">
        <div style="padding:9px 5px;border-radius:9px;background:#f1f7fa;"><small>الإجمالي</small><strong style="display:block">${summary.total.toFixed(2)} ج</strong></div>
        <div style="padding:9px 5px;border-radius:9px;background:#edf8ef;"><small>المدفوع</small><strong style="display:block;color:#287b3e">${summary.paid.toFixed(2)} ج</strong></div>
        <div style="padding:9px 5px;border-radius:9px;background:#fff5e6;"><small>المتبقي</small><strong style="display:block;color:#c36a00">${summary.remaining.toFixed(2)} ج</strong></div>
      </div>
      <label style="display:grid;gap:6px;margin-bottom:12px;font-weight:700;">طريقة الدفع
        <select id="installment-payment-method" style="padding:10px;border:1px solid #cbd8df;border-radius:8px;font:inherit;">
          <option value="نقدي">نقدي</option><option value="فودافون كاش">فودافون كاش</option>
        </select>
      </label>
      <label style="display:grid;gap:6px;margin-bottom:16px;font-weight:700;">المبلغ المدفوع الآن
        <input id="installment-payment-amount" type="number" min="0.01" max="${summary.remaining}" step="0.01" placeholder="اكتب قيمة الدفعة" style="padding:10px;border:1px solid #cbd8df;border-radius:8px;font:inherit;">
      </label>
      <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-start;">
        <button type="button" data-installment-action="partial" style="border:0;border-radius:8px;padding:10px 14px;background:#087f72;color:#fff;font:inherit;font-weight:800;cursor:pointer;">تسجيل المبلغ</button>
        <button type="button" data-installment-action="full" style="border:0;border-radius:8px;padding:10px 14px;background:#1976d2;color:#fff;font:inherit;font-weight:800;cursor:pointer;">سداد كامل المتبقي</button>
        <button type="button" data-installment-action="cancel" style="border:1px solid #cbd8df;border-radius:8px;padding:10px 14px;background:#fff;color:#526b7b;font:inherit;cursor:pointer;">إلغاء</button>
      </div>
      <p id="installment-payment-error" role="alert" style="display:none;color:#b3261e;margin:12px 0 0;"></p>
    </section>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', event => {
    if (event.target === overlay || event.target.closest('[data-installment-action="cancel"]')) overlay.remove();
  });
  overlay.querySelectorAll('[data-installment-action="partial"], [data-installment-action="full"]').forEach(button => {
    button.addEventListener('click', async () => {
      const error = overlay.querySelector('#installment-payment-error');
      const input = overlay.querySelector('#installment-payment-amount');
      const fullPayment = button.dataset.installmentAction === 'full';
      const amount = fullPayment ? summary.remaining : (input.value === '' ? NaN : Number(input.value));
      const method = overlay.querySelector('#installment-payment-method').value;
      if (!Number.isFinite(amount) || amount <= 0 || amount > summary.remaining) {
        error.textContent = `اكتب مبلغًا أكبر من صفر ولا يزيد عن ${summary.remaining.toFixed(2)} ج.`;
        error.style.display = 'block';
        input.focus();
        return;
      }
      overlay.querySelectorAll('button').forEach(item => { item.disabled = true; });
      try {
        const result = await recordInstallmentPayment({ invoiceId, collectionName, amount, method, receivedBy, linkedRegistrationId });
        overlay.remove();
        await onSuccess(result);
      } catch (saveError) {
        error.textContent = saveError.message || 'تعذر حفظ الدفعة. حاول مرة أخرى.';
        error.style.display = 'block';
        overlay.querySelectorAll('button').forEach(item => { item.disabled = false; });
      }
    });
  });
}
