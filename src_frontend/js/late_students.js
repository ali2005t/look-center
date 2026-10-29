import { db } from "./firebase.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { utils, writeFile } from 'https://cdn.sheetjs.com/xlsx-0.19.2/package/xlsx.mjs';
import { getInstallmentSummary, showInstallmentPaymentDialog } from './installment-payments.js';

let allInvoices = [];
let lateInvoices = [];

function showLoadingIndicator() {
  const tableBody = document.querySelector('#late-students-table-box tbody');
  if (tableBody) {
    tableBody.innerHTML = '<tr><td colspan="9" class="installment-loading-cell"><span class="installment-loading-spinner" aria-hidden="true"></span>\u062c\u0627\u0631\u064a \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a</td></tr>';
  }
}

async function loadLateStudents() {
  try {
    showLoadingIndicator();
    const [snapshot, vipSnapshot] = await Promise.all([
      getDocs(collection(db, 'invoices')),
      getDocs(collection(db, 'vipRegistrations'))
    ]);
    allInvoices = [];
    snapshot.forEach(docSnap => {
      const inv = docSnap.data();
      inv._id = docSnap.id;
      inv._collection = 'invoices';
      allInvoices.push(inv);
    });
    const linkedVipRegistrations = new Set(snapshot.docs.map(docSnap => {
      const invoice = docSnap.data();
      return invoice.vipRegistrationId || '';
    }).filter(Boolean));
    vipSnapshot.forEach(docSnap => {
      const registration = docSnap.data();
      if (linkedVipRegistrations.has(docSnap.id) || (registration.invoiceId && snapshot.docs.some(invoiceDoc => invoiceDoc.id === registration.invoiceId))) return;
      allInvoices.push({
        ...registration,
        _id: docSnap.id,
        _collection: 'vipRegistrations',
        student: registration.studentName || registration.student || '-',
        phone: registration.phone || registration.studentPhone || '-',
        subType: registration.subType || (registration.selectedSubscriptions || []).map(item => item.type).filter(Boolean).join(' + ') || 'VIP',
        payment: registration.payment === '\u062a\u0642\u0633\u064a\u0637' || registration.paymentMethod === '\u062a\u0642\u0633\u064a\u0637'
          || Number(registration.installment?.remaining ?? 0) > 0 ? '\u062a\u0642\u0633\u064a\u0637' : (registration.payment || registration.paymentMethod || '')
      });
    });
    renderLateStudentsTable();
  } catch (error) {
    console.error('Error loading late students:', error);
    const tableBody = document.querySelector('#late-students-table-box tbody');
    if (tableBody) {
      tableBody.innerHTML = '<tr><td colspan="9" class="installment-empty-cell">\u062a\u0639\u0630\u0631 \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a. \u0623\u0639\u062f \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629 \u0628\u0639\u062f \u0642\u0644\u064a\u0644.</td></tr>';
    }
  }
}

function escapeLateHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function formatInstallmentMoney(value) {
  return (Number(value) || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderInstallmentSummary({ students, total, paid, remaining }) {
  const summaryEl = document.getElementById('late-students-summary');
  if (!summaryEl) return;
  const stats = [
    { icon: 'fa-users', tone: 'is-count', label: '\u0637\u0644\u0627\u0628 \u0639\u0644\u064a\u0647\u0645 \u0645\u0633\u062a\u062d\u0642\u0627\u062a', value: students, unit: '' },
    { icon: 'fa-file-invoice-dollar', tone: '', label: '\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0627\u0634\u062a\u0631\u0627\u0643\u0627\u062a', value: formatInstallmentMoney(total), unit: '\u062c' },
    { icon: 'fa-circle-check', tone: 'is-paid', label: '\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0645\u062f\u0641\u0648\u0639', value: formatInstallmentMoney(paid), unit: '\u062c' },
    { icon: 'fa-hourglass-half', tone: 'is-due', label: '\u0627\u0644\u0645\u062a\u0628\u0642\u064a \u0644\u0644\u062a\u062d\u0635\u064a\u0644', value: formatInstallmentMoney(remaining), unit: '\u062c' }
  ];
  summaryEl.innerHTML = stats.map(stat => `
    <article class="installment-stat-card ${stat.tone}">
      <span class="installment-stat-icon"><i class="fas ${stat.icon}" aria-hidden="true"></i></span>
      <span class="installment-stat-copy">
        <span class="installment-stat-label">${stat.label}</span>
        <strong class="installment-stat-value">${stat.value}<small class="installment-stat-unit">${stat.unit}</small></strong>
      </span>
    </article>
  `).join('');
}

function renderLateStudentsTable() {
  const lateTableBody = document.querySelector('#late-students-table-box tbody');
  if (!lateTableBody) return;

  lateInvoices = allInvoices.filter(inv => (inv.payment === '\u062a\u0642\u0633\u064a\u0637' || Boolean(inv.installment)) && getInstallmentSummary(inv).remaining > 0);
  lateInvoices.sort((a, b) => getInstallmentSummary(b).remaining - getInstallmentSummary(a).remaining);

  const totals = lateInvoices.reduce((summary, invoice) => {
    const amounts = getInstallmentSummary(invoice);
    summary.total += amounts.total;
    summary.paid += amounts.paid;
    summary.remaining += amounts.remaining;
    summary.students.add(invoice.phone || invoice.student || invoice._id);
    return summary;
  }, { total: 0, paid: 0, remaining: 0, students: new Set() });
  renderInstallmentSummary({ ...totals, students: totals.students.size });

  if (!lateInvoices.length) {
    lateTableBody.innerHTML = `<tr><td colspan="9" class="installment-empty-cell"><i class="fas fa-circle-check" aria-hidden="true"></i><span>\u0644\u0627 \u062a\u0648\u062c\u062f \u0623\u0642\u0633\u0627\u0637 \u0645\u062a\u0628\u0642\u064a\u0629</span></td></tr>`;
    return;
  }

  lateTableBody.innerHTML = lateInvoices.map((invoice, index) => {
    const { total, paid, remaining } = getInstallmentSummary(invoice);
    const level = remaining > total * 0.7 ? 'high' : remaining > total * 0.35 ? 'medium' : 'low';
    const lastMethod = invoice.installment?.payments?.at?.(-1)?.method || invoice.installment?.lastPaymentMethod || '\u0644\u0645 \u062a\u0633\u062c\u0644 \u0628\u0639\u062f';
    return `
      <tr class="installment-row--${level}" data-index="${index}" data-id="${escapeLateHtml(invoice._id)}">
        <td data-label="\u0631\u0642\u0645" class="installment-number">${index + 1}</td>
        <td data-label="\u0627\u0644\u0637\u0627\u0644\u0628" class="installment-student-name">${escapeLateHtml(invoice.student || '-')}</td>
        <td data-label="\u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062a\u0641" class="installment-phone">${escapeLateHtml(invoice.phone || '-')}</td>
        <td data-label="\u0627\u0644\u0627\u0634\u062a\u0631\u0627\u0643"><span class="installment-subscription-chip">${escapeLateHtml(invoice.subType || '-')}</span></td>
        <td data-label="\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a" class="installment-money">${formatInstallmentMoney(total)} \u062c</td>
        <td data-label="\u0627\u0644\u0645\u062f\u0641\u0648\u0639" class="installment-money installment-money--paid">${formatInstallmentMoney(paid)} \u062c</td>
        <td data-label="\u0627\u0644\u0645\u062a\u0628\u0642\u064a" class="installment-money installment-money--remaining">${formatInstallmentMoney(remaining)} \u062c</td>
        <td data-label="\u0622\u062e\u0631 \u062f\u0641\u0639\u0629"><span class="installment-method-chip">${escapeLateHtml(lastMethod)}</span></td>
        <td data-label="\u0627\u0644\u0625\u062c\u0631\u0627\u0621"><button type="button" class="record-installment-payment" data-id="${escapeLateHtml(invoice._id)}" onclick="event.stopPropagation();"><i class="fas fa-plus-circle" aria-hidden="true"></i> \u062a\u0633\u062c\u064a\u0644 \u062f\u0641\u0639\u0629</button></td>
      </tr>`;
  }).join('') + `
    <tr class="installment-total-row">
      <td colspan="4">\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0645\u0628\u0627\u0644\u063a</td>
      <td data-label="\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a">${formatInstallmentMoney(totals.total)} \u062c</td>
      <td data-label="\u0627\u0644\u0645\u062f\u0641\u0648\u0639">${formatInstallmentMoney(totals.paid)} \u062c</td>
      <td data-label="\u0627\u0644\u0645\u062a\u0628\u0642\u064a">${formatInstallmentMoney(totals.remaining)} \u062c</td>
      <td colspan="2"></td>
    </tr>`;

  lateTableBody.querySelectorAll('tr[data-index]').forEach(row => {
    row.onclick = () => showInvoiceModal(lateInvoices[Number(row.dataset.index)]);
  });
  lateTableBody.querySelectorAll('.record-installment-payment').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const invoice = lateInvoices.find(item => item._id === button.dataset.id);
      if (!invoice) return;
      showInstallmentPaymentDialog(invoice, {
        invoiceId: invoice._id,
        collectionName: invoice._collection || 'invoices',
        receivedBy: localStorage.getItem('currentUsername') || localStorage.getItem('currentUserName') || '-',
        onSuccess: async result => {
          showNotification(`\u062a\u0645 \u062a\u0633\u062c\u064a\u0644 ${result.paymentEntry.amount.toFixed(2)} \u062c \u0628\u0637\u0631\u064a\u0642\u0629 ${result.paymentEntry.method}`, 'success');
          await loadLateStudents();
        }
      });
    });
  });
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 15px 20px;
    background: ${type === 'success' ? '#4caf50' : type === 'error' ? '#f44336' : '#2196f3'};
    color: white;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    animation: slideIn 0.3s ease;
    font-weight: 500;
  `;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

function showInvoiceModal(inv) {
  const { total, paid, remaining: remain } = getInstallmentSummary(inv);
  const percentage = total > 0 ? Math.round((paid / total) * 100) : 0;
  
  let html = `
    <div class="modal-bg installment-modal-backdrop" id="modal-bg" style="animation:fadeIn 0.25s ease;"></div>
    <section class="modal-box installment-modal" id="modal-box" role="dialog" aria-modal="true" aria-labelledby="installment-modal-title" style="animation:slideUp 0.25s ease;">
      <header class="installment-modal-header">
        <div class="installment-modal-heading">
          <span class="installment-modal-icon"><i class="fa-solid fa-file-invoice-dollar" aria-hidden="true"></i></span>
          <div>
            <h3 id="installment-modal-title">تفاصيل الفاتورة</h3>
            <p>ملخص اشتراك الطالب والسداد</p>
          </div>
        </div>
        <button type="button" class="installment-modal-close" onclick="window.closeModal()" aria-label="إغلاق"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
      </header>
      <div class="installment-modal-body">
        <section class="installment-student-card" aria-label="بيانات الطالب">
          <div class="installment-profile-item installment-profile-student">
            <span class="installment-field-label"><i class="fa-solid fa-user" aria-hidden="true"></i> اسم الطالب</span>
            <strong>${inv.student || '-'}</strong>
          </div>
          <div class="installment-profile-item">
            <span class="installment-field-label"><i class="fa-solid fa-phone" aria-hidden="true"></i> رقم الهاتف</span>
            <strong class="installment-profile-phone">${inv.phone || '-'}</strong>
          </div>
          <div class="installment-profile-item">
            <span class="installment-field-label"><i class="fa-solid fa-layer-group" aria-hidden="true"></i> نوع الاشتراك</span>
            <strong class="installment-subscription-value">${inv.subType || '-'}</strong>
          </div>
        </section>

        <section class="installment-amount-card" aria-label="ملخص المبالغ">
          <div class="installment-amount-grid">
            <div class="installment-amount-item">
              <span><i class="fa-solid fa-sack-dollar" aria-hidden="true"></i> الإجمالي</span>
              <strong>${total.toFixed(2)} ج</strong>
            </div>
            <div class="installment-amount-item is-paid">
              <span><i class="fa-solid fa-circle-check" aria-hidden="true"></i> المدفوع</span>
              <strong>${paid.toFixed(2)} ج</strong>
            </div>
          </div>
          <div class="installment-progress-track" role="progressbar" aria-label="نسبة السداد" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percentage}" style="--paid-progress:${percentage}%"><span></span></div>
          <div class="installment-progress-caption"><span>نسبة السداد</span><strong>${percentage}%</strong></div>
        </section>

        <section class="installment-remaining-card" aria-label="المبلغ المتبقي">
          <div class="installment-remaining-label"><i class="fa-regular fa-hourglass-half" aria-hidden="true"></i><span>المتبقي</span></div>
          <strong>${remain.toFixed(2)} ج</strong>
        </section>

        <div class="installment-last-payment">
          <span><i class="fa-solid fa-money-bill-transfer" aria-hidden="true"></i> طريقة آخر دفعة</span>
          <strong>${inv.installment?.payments?.at?.(-1)?.method || inv.installment?.lastPaymentMethod || 'لم تسجل دفعات بعد'}</strong>
        </div>
      </div>
      <footer class="installment-modal-actions">
        <button type="button" id="invoice-modal-record-installment" class="installment-modal-pay"><i class="fa-solid fa-plus" aria-hidden="true"></i> تسجيل دفعة</button>
        <button type="button" class="installment-modal-dismiss" onclick="window.closeModal()">إغلاق</button>
      </footer>
    </section>
  `;
  let modalDiv = document.createElement('div');
  modalDiv.innerHTML = html;
  document.body.appendChild(modalDiv);
  document.getElementById('modal-bg').onclick = window.closeModal;
  document.getElementById('invoice-modal-record-installment').onclick = () => showInstallmentPaymentDialog(inv, {
    invoiceId: inv._id,
    collectionName: inv._collection || 'invoices',
    receivedBy: localStorage.getItem('currentUsername') || localStorage.getItem('currentUserName') || '-',
    onSuccess: async result => {
      window.closeModal();
      showNotification(`تم تسجيل ${result.paymentEntry.amount.toFixed(2)} ج بطريقة ${result.paymentEntry.method}`, 'success');
      await loadLateStudents();
    }
  });
}

// دالة إغلاق النافذة المنبثقة
window.closeModal = function() {
  const modals = document.querySelectorAll('.modal-bg, .modal-box');
  modals.forEach(modal => {
    modal.style.animation = modal.classList.contains('modal-bg') ? 'fadeOut 0.3s ease' : 'slideDown 0.3s ease';
  });
  setTimeout(() => {
    modals.forEach(modal => {
      const parent = modal.parentElement;
      if (parent) parent.remove();
    });
  }, 300);
};
// زر تصدير إلى Excel
window.exportLateStudentsToExcel = function() {
  try {
    const table = document.querySelector('.late-students-table');
    if (!table) {
      window.showNotification('لا توجد بيانات لتصديرها', 'error');
      return;
    }

    const workbook = utils.table_to_book(table, { sheet: 'طلاب التقسيط' });
    writeFile(workbook, 'طلاب_التقسيط.xlsx');

    window.showNotification('تم تصدير البيانات بنجاح', 'success');
  } catch (error) {
    console.error('Error exporting to Excel:', error);
    window.showNotification('حدث خطأ أثناء التصدير', 'error');
  }
};

document.addEventListener("DOMContentLoaded", loadLateStudents);

// إضافة أنماط الـ animations
const style = document.createElement('style');
style.textContent = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes fadeOut {
    from { opacity: 1; }
    to { opacity: 0; }
  }
  @keyframes slideUp {
    from { 
      opacity: 0;
      transform: translateY(20px);
    }
    to { 
      opacity: 1;
      transform: translateY(0);
    }
  }
  @keyframes slideDown {
    from { 
      opacity: 1;
      transform: translateY(0);
    }
    to { 
      opacity: 0;
      transform: translateY(20px);
    }
  }
  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateX(100px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }
  @keyframes slideOut {
    from {
      opacity: 1;
      transform: translateX(0);
    }
    to {
      opacity: 0;
      transform: translateX(100px);
    }
  }
`;
document.head.appendChild(style);

