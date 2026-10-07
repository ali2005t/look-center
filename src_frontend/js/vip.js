import { db } from './firebase.js';
import { collection, doc, getDoc, getDocs, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const VIP_IDLE_TIMEOUT_MS = 3 * 60 * 1000;
let currentVipTab = 'students';
let vipAssignedTeacher = localStorage.getItem('vipAssignedTeacher') || '';
let vipPasswordHash = '';
let vipRecoveryPhone = '';
let vipIdleTimer;
let lastVipActivityAt = 0;

const vipContent = document.getElementById('vip-content');
const vipAccessBlock = document.getElementById('vip-access-block');
const vipMainPanel = document.getElementById('vip-main-panel');
const vipPasswordInput = document.getElementById('vip-password-input');
const vipTeacherInput = document.getElementById('vip-teacher-input');
const vipEnterBtn = document.getElementById('vip-enter-btn');

function showVipNotification(message, type = 'info') {
  let container = document.getElementById('vip-notifications');
  if (!container) {
    container = document.createElement('div');
    container.id = 'vip-notifications';
    container.className = 'vip-notifications';
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'false');
    document.body.appendChild(container);
  }

  const notification = document.createElement('div');
  notification.className = `vip-notification vip-notification--${type}`;
  notification.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const icon = document.createElement('i');
  icon.className = `fas ${type === 'error' ? 'fa-circle-exclamation' : type === 'success' ? 'fa-circle-check' : 'fa-circle-info'}`;
  icon.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.textContent = message;
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'vip-notification-close';
  closeButton.setAttribute('aria-label', 'إغلاق الإشعار');
  const closeIcon = document.createElement('i');
  closeIcon.className = 'fas fa-xmark';
  closeIcon.setAttribute('aria-hidden', 'true');
  closeButton.appendChild(closeIcon);
  notification.append(icon, text, closeButton);
  container.appendChild(notification);

  let dismissTimer;
  const dismiss = () => {
    window.clearTimeout(dismissTimer);
    if (notification.classList.contains('is-hiding')) return;
    notification.classList.add('is-hiding');
    window.setTimeout(() => notification.remove(), 200);
  };
  const startDismissTimer = () => {
    window.clearTimeout(dismissTimer);
    dismissTimer = window.setTimeout(dismiss, 6000);
  };

  closeButton.addEventListener('click', dismiss);
  notification.addEventListener('mouseenter', () => window.clearTimeout(dismissTimer));
  notification.addEventListener('mouseleave', startDismissTimer);
  notification.addEventListener('focusin', () => window.clearTimeout(dismissTimer));
  notification.addEventListener('focusout', event => {
    if (!notification.contains(event.relatedTarget)) startDismissTimer();
  });
  startDismissTimer();
}

async function hashVipPassword(password) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeRecoveryPhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

async function loadVipAccessSettings() {
  const snapshot = await getDoc(doc(db, 'settings', 'main'));
  if (!snapshot.exists()) throw new Error('VIP settings are missing');
  const settings = snapshot.data();
  vipAssignedTeacher = String(settings.vipAssignedTeacher || '').trim();
  vipPasswordHash = String(settings.vipPasswordHash || '');
  vipRecoveryPhone = String(settings.vipRecoveryPhone || '').trim();
  localStorage.setItem('vipAssignedTeacher', vipAssignedTeacher);
  localStorage.setItem('vipRecoveryPhone', vipRecoveryPhone);
  return settings;
}

function getVipSales() {
  try {
    return JSON.parse(localStorage.getItem('vipSales') || '[]')
      .filter(sale => sale?.isVip === true && !isDemoSale(sale));
  } catch (error) {
    return [];
  }
}

function saveVipSales(sales) {
  localStorage.setItem('vipSales', JSON.stringify(sales.filter(sale => sale?.isVip === true && !isDemoSale(sale))));
}

function isDemoSale(sale) {
  return (sale.studentName === 'أحمد محمد' && sale.subscriptionName === 'مادة القانون' && sale.originalPrice === 600 && sale.finalPrice === 450 && sale.payerName === 'أستاذ محمد') ||
    (sale.studentName === 'سارة علي' && sale.subscriptionName === 'لغة إنجليزية' && sale.originalPrice === 500 && sale.finalPrice === 500);
}

function isVipUnlocked() {
  return sessionStorage.getItem('vipUnlocked') === 'true';
}

function resetVipIdleTimer() {
  if (!isVipUnlocked()) return;
  if (Date.now() - lastVipActivityAt < 800) return;
  lastVipActivityAt = Date.now();
  clearTimeout(vipIdleTimer);
  vipIdleTimer = setTimeout(lockVipPage, VIP_IDLE_TIMEOUT_MS);
}

function lockVipPage() {
  clearTimeout(vipIdleTimer);
  sessionStorage.removeItem('vipUnlocked');
  vipAccessBlock.classList.remove('hidden');
  vipMainPanel.classList.add('hidden');
  vipTeacherInput.value = '';
  vipPasswordInput.value = '';
  document.getElementById('vip-recovery-panel').classList.add('hidden');
}

function startVipSession() {
  sessionStorage.setItem('vipUnlocked', 'true');
  vipAccessBlock.classList.add('hidden');
  vipMainPanel.classList.remove('hidden');
  lastVipActivityAt = 0;
  resetVipIdleTimer();
}

function applyVipAccess() {
  if (isVipUnlocked()) {
    vipAccessBlock.classList.add('hidden');
    vipMainPanel.classList.remove('hidden');
    lastVipActivityAt = 0;
    resetVipIdleTimer();
    renderTab('students');
    refreshVipSales();
    return true;
  }
  return false;
}

async function refreshVipSales() {
  saveVipSales(getVipSales());
  try {
    const [snapshot, settingsSnapshot] = await Promise.all([
      getDocs(collection(db, 'invoices')),
      getDoc(doc(db, 'settings', 'main'))
    ]);
    if (settingsSnapshot.exists()) {
      const settings = settingsSnapshot.data();
      vipAssignedTeacher = String(settings.vipAssignedTeacher || '').trim();
      vipPasswordHash = String(settings.vipPasswordHash || '');
      vipRecoveryPhone = String(settings.vipRecoveryPhone || '').trim();
      localStorage.setItem('vipAssignedTeacher', vipAssignedTeacher);
    }
    const firestoreSales = snapshot.docs
      .map(invoiceDoc => {
        const invoice = invoiceDoc.data();
        if (invoice.isVip !== true) return null;
        const date = invoice.date?.toDate ? invoice.date.toDate().toISOString() : invoice.date;
        const items = Array.isArray(invoice.items) ? invoice.items : [];
        const originalPrice = Number(invoice.vipOriginalPrice || items.reduce((sum, item) => sum + Number(item.price || 0), 0));
        const discount = Number(invoice.vipDiscountAmount || 0);
        const savedFinalPrice = Number(invoice.vipFinalPrice || 0);
        const finalPrice = invoice.vipFinalPrice == null || (savedFinalPrice === 0 && originalPrice > 0 && discount === 0)
          ? Math.max(0, originalPrice - discount)
          : savedFinalPrice;
        return {
          id: `invoice:${invoiceDoc.id}`,
          invoiceNumber: invoice.num ?? '-',
          studentName: invoice.student || '',
          subscriptionName: items.map(item => item.name).filter(Boolean).join('، ') || invoice.subType || '',
          originalPrice,
          discount,
          finalPrice,
          payerName: invoice.vipPayer || 'VIP',
          createdBy: invoice.vipCreatedBy || invoice.recipient || '',
          assignedTeacher: invoice.vipAssignedTeacher || vipAssignedTeacher || '-',
          method: invoice.payment || '',
          reason: invoice.vipReason || '',
          date,
          isVip: true,
          status: 'مكتمل'
        };
      })
      .filter(Boolean);

    const localSales = getVipSales().filter(sale => !String(sale.id || '').startsWith('invoice:'));
    const salesById = new Map(localSales.map(sale => [sale.id, sale]));
    firestoreSales.forEach(sale => salesById.set(sale.id, sale));
    saveVipSales([...salesById.values()]);
  } catch (error) {
    console.error('تعذر تحميل فواتير VIP من قاعدة البيانات:', error);
  }
  renderTab(currentVipTab);
}

function formatCurrency(value) {
  return `${Number(value || 0).toLocaleString('en-US')} جنيه`;
}

function renderStudentsTab() {
  const sales = getVipSales();
  const rows = sales.map(student => `
    <tr>
      <td>${student.invoiceNumber || '-'}</td>
      <td>${student.studentName || '-'}</td>
      <td>${student.subscriptionName}</td>
      <td><span class="vip-mark">VIP</span></td>
      <td>${formatCurrency(student.finalPrice)}</td>
      <td>${student.assignedTeacher || vipAssignedTeacher || '-'}</td>
      <td>${student.createdBy}</td>
      <td>${new Date(student.date).toLocaleDateString('ar-EG')}</td>
    </tr>
  `).join('') || '<tr><td colspan="6">لا توجد بيانات VIP حتى الآن.</td></tr>';

  return `
    <div class="vip-card">
      <h3>طلابك المشتركين</h3>
      <div class="vip-table-wrap">
        <table class="vip-table">
          <thead>
            <tr>
              <th>رقم الفاتورة</th>
              <th>اسم الطالب</th>
              <th>الاشتراك</th>
              <th>النوع</th>
              <th>السعر النهائي</th>
              <th>تابع الأستاذ</th>
              <th>منفذ العملية</th>
              <th>التاريخ</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="8">لا توجد بيانات VIP حتى الآن.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderSalesTab() {
  const sales = getVipSales();
  const rows = sales.map(sale => `
    <tr>
      <td>${sale.studentName}</td>
      <td>${sale.subscriptionName}</td>
      <td>${formatCurrency(sale.originalPrice)}</td>
      <td>${formatCurrency(sale.discount)}</td>
      <td>${formatCurrency(sale.finalPrice)}</td>
      <td>${sale.method}</td>
      <td>${sale.createdBy}</td>
      <td>${new Date(sale.date).toLocaleDateString('ar-EG')}</td>
    </tr>
  `).join('') || '<tr><td colspan="8">لا توجد مبيعات حتى الآن.</td></tr>';

  return `
    <div class="vip-card">
      <h3>المبيعات</h3>
      <div class="vip-table-wrap">
        <table class="vip-table">
          <thead>
            <tr>
              <th>الطالب</th>
              <th>الاشتراك</th>
              <th>السعر الأصلي</th>
              <th>الخصم</th>
              <th>السعر النهائي</th>
              <th>طريقة الدفع</th>
              <th>منفذ العملية</th>
              <th>التاريخ</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderReportsTab() {
  return `<div class="vip-card"><h3>تقارير VIP</h3>${renderReportFilters('reports')}<div id="vip-report-results"></div></div>`;
}

function renderDailyTab() {
  return `<div class="vip-card"><h3>قفل يومي VIP</h3>${renderReportFilters('daily')}<div id="vip-report-results"></div></div>`;
}

const vipReportFilters = { from: '', to: '', operator: '', teacher: '', method: '', query: '' };
const vipDailyFilters = { date: localDateKey(new Date()), operator: '', teacher: '', method: '', query: '' };

function localDateKey(value) {
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function escapeVipHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function getFilterOptions(field, selectedValue) {
  const options = [...new Set(getVipSales().map(sale => sale[field]).filter(Boolean))]
    .sort((left, right) => String(left).localeCompare(String(right), 'ar'));
  return `<option value="">الكل</option>${options.map(option => `<option value="${escapeVipHtml(option)}" ${option === selectedValue ? 'selected' : ''}>${escapeVipHtml(option)}</option>`).join('')}`;
}

function renderReportFilters(mode) {
  const daily = mode === 'daily';
  const filters = daily ? vipDailyFilters : vipReportFilters;
  return `
    <div class="vip-filter-bar">
      ${daily
        ? `<label>اليوم <input type="date" id="vip-filter-date" value="${filters.date}"></label>`
        : `<label>من <input type="date" id="vip-filter-from" value="${filters.from}"></label><label>إلى <input type="date" id="vip-filter-to" value="${filters.to}"></label>`}
      <label>منفذ العملية <select id="vip-filter-operator">${getFilterOptions('createdBy', filters.operator)}</select></label>
      <label>تابع الأستاذ <select id="vip-filter-teacher">${getFilterOptions('assignedTeacher', filters.teacher)}</select></label>
      <label>طريقة الدفع <select id="vip-filter-method">${getFilterOptions('method', filters.method)}</select></label>
      <label class="vip-filter-search">بحث <input type="search" id="vip-filter-query" value="${escapeVipHtml(filters.query)}" placeholder="رقم الفاتورة أو الطالب أو الاشتراك"></label>
      <button type="button" class="secondary-btn" id="vip-reset-filters">مسح الفلاتر</button>
      <button type="button" class="primary-btn" id="vip-export-report">تصدير CSV</button>
    </div>
  `;
}

function getFilteredVipSales(mode) {
  const filters = mode === 'daily' ? vipDailyFilters : vipReportFilters;
  const query = filters.query.trim().toLocaleLowerCase();
  return getVipSales().filter(sale => {
    const saleDate = localDateKey(sale.date);
    if (mode === 'daily' && saleDate !== filters.date) return false;
    if (mode === 'reports' && filters.from && saleDate < filters.from) return false;
    if (mode === 'reports' && filters.to && saleDate > filters.to) return false;
    if (filters.operator && sale.createdBy !== filters.operator) return false;
    if (filters.teacher && (sale.assignedTeacher || vipAssignedTeacher || '-') !== filters.teacher) return false;
    if (filters.method && sale.method !== filters.method) return false;
    if (query) {
      const searchable = [sale.invoiceNumber, sale.studentName, sale.subscriptionName]
        .join(' ').toLocaleLowerCase();
      if (!searchable.includes(query)) return false;
    }
    return true;
  });
}

function renderVipSummary(sales, mode) {
  const total = sales.reduce((sum, sale) => sum + Number(sale.finalPrice || 0), 0);
  const discount = sales.reduce((sum, sale) => sum + Number(sale.discount || 0), 0);
  const free = sales.filter(sale => Number(sale.finalPrice || 0) === 0).length;
  const label = mode === 'daily' ? 'مبيعات اليوم' : 'إجمالي المبيعات';
  return `
    <div class="vip-summary-grid">
      <div class="summary-box blue"><h4>${label}</h4><strong>${formatCurrency(total)}</strong></div>
      <div class="summary-box orange"><h4>إجمالي الخصومات</h4><strong>${formatCurrency(discount)}</strong></div>
      <div class="summary-box green"><h4>عدد العمليات</h4><strong>${sales.length}</strong></div>
      <div class="summary-box red"><h4>عمليات مجانية</h4><strong>${free}</strong></div>
    </div>
  `;
}

function renderVipBreakdown(sales, field, title) {
  const groups = new Map();
  sales.forEach(sale => {
    const name = sale[field] || 'غير محدد';
    const group = groups.get(name) || { count: 0, total: 0 };
    group.count++;
    group.total += Number(sale.finalPrice || 0);
    groups.set(name, group);
  });
  const rows = [...groups.entries()].map(([name, group]) => `
    <tr><td>${escapeVipHtml(name)}</td><td>${group.count}</td><td>${formatCurrency(group.total)}</td></tr>
  `).join('') || '<tr><td colspan="3">لا توجد عمليات ضمن الفلاتر.</td></tr>';
  return `<div class="vip-breakdown"><h4>${title}</h4><table class="vip-table"><thead><tr><th>التصنيف</th><th>العمليات</th><th>الإجمالي</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderVipReportTable(sales) {
  const rows = sales.map(sale => `
    <tr>
      <td>${escapeVipHtml(sale.invoiceNumber || '-')}</td>
      <td>${escapeVipHtml(sale.studentName || '-')}</td>
      <td>${escapeVipHtml(sale.subscriptionName || '-')}</td>
      <td>${formatCurrency(sale.originalPrice)}</td>
      <td>${formatCurrency(sale.discount)}</td>
      <td>${formatCurrency(sale.finalPrice)}</td>
      <td>${escapeVipHtml(sale.method || '-')}</td>
      <td>${escapeVipHtml(sale.createdBy || '-')}</td>
      <td>${escapeVipHtml(sale.assignedTeacher || vipAssignedTeacher || '-')}</td>
      <td>${escapeVipHtml(new Date(sale.date).toLocaleString('ar-EG'))}</td>
    </tr>
  `).join('') || '<tr><td colspan="10">لا توجد عمليات ضمن الفلاتر المحددة.</td></tr>';
  return `
    <div class="vip-table-wrap">
      <table class="vip-table vip-report-table">
        <thead><tr><th>الفاتورة</th><th>الطالب</th><th>الاشتراك</th><th>الأصلي</th><th>الخصم</th><th>النهائي</th><th>الدفع</th><th>المنفذ</th><th>تابع الأستاذ</th><th>التاريخ والوقت</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function updateVipReportResults(mode) {
  const sales = getFilteredVipSales(mode);
  const results = document.getElementById('vip-report-results');
  if (!results) return;
  results.innerHTML = `${renderVipSummary(sales, mode)}
    <div class="vip-breakdown-grid">
      ${renderVipBreakdown(sales, 'method', 'حسب طريقة الدفع')}
      ${renderVipBreakdown(sales, 'createdBy', 'حسب منفذ العملية')}
    </div>
    ${renderVipReportTable(sales)}`;
}

function exportVipReport(mode) {
  const sales = getFilteredVipSales(mode);
  const columns = [
    ['رقم الفاتورة', 'invoiceNumber'], ['الطالب', 'studentName'], ['الاشتراك', 'subscriptionName'],
    ['السعر الأصلي', 'originalPrice'], ['الخصم', 'discount'], ['السعر النهائي', 'finalPrice'],
    ['طريقة الدفع', 'method'], ['منفذ العملية', 'createdBy'], ['تابع الأستاذ', 'assignedTeacher'], ['التاريخ', 'date']
  ];
  const csv = [columns.map(([title]) => title), ...sales.map(sale => columns.map(([, key]) => sale[key] ?? ''))]
    .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  const file = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = `vip-${mode}-${mode === 'daily' ? vipDailyFilters.date : 'report'}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function bindVipReportFilters(mode) {
  const filters = mode === 'daily' ? vipDailyFilters : vipReportFilters;
  const controls = mode === 'daily'
    ? { date: 'vip-filter-date', operator: 'vip-filter-operator', teacher: 'vip-filter-teacher', method: 'vip-filter-method', query: 'vip-filter-query' }
    : { from: 'vip-filter-from', to: 'vip-filter-to', operator: 'vip-filter-operator', teacher: 'vip-filter-teacher', method: 'vip-filter-method', query: 'vip-filter-query' };
  Object.entries(controls).forEach(([key, id]) => {
    const control = document.getElementById(id);
    const update = () => {
      filters[key] = control.value;
      updateVipReportResults(mode);
    };
    control.addEventListener(key === 'query' ? 'input' : 'change', update);
  });
  document.getElementById('vip-reset-filters').addEventListener('click', () => {
    Object.keys(filters).forEach(key => { filters[key] = key === 'date' ? localDateKey(new Date()) : ''; });
    renderTab(mode);
  });
  document.getElementById('vip-export-report').addEventListener('click', () => exportVipReport(mode));
  updateVipReportResults(mode);
}

function renderSalePanel() {
  const currentUser = localStorage.getItem('currentUsername') || 'مدير';

  return `
    <div class="vip-card">
      <h3>البيع من صفحة VIP</h3>
      <form id="vip-sale-form" class="vip-form">
        <div class="field">
          <label>اسم الطالب</label>
          <input id="vip-student-name" type="text" placeholder="اسم الطالب" required />
        </div>
        <div class="field">
          <label>اسم الاشتراك</label>
          <input id="vip-subscription-name" type="text" placeholder="اسم الاشتراك" required />
        </div>
        <div class="field">
          <label>السعر الأصلي</label>
          <input id="vip-original-price" type="number" min="0" value="600" required />
        </div>
        <div class="field">
          <label>الخصم</label>
          <input id="vip-discount" type="number" min="0" value="0" />
        </div>
        <div class="field">
          <label>السعر النهائي</label>
          <input id="vip-final-price" type="number" min="0" value="600" required />
        </div>
        <div class="field">
          <label>طريقة الدفع</label>
          <select id="vip-payment-method">
            <option value="نقدي">نقدي</option>
            <option value="فودافون كاش">فودافون كاش</option>
            <option value="تقسيط">تقسيط</option>
          </select>
        </div>
        <div class="field">
          <label>اسم من دفع VIP</label>
          <input id="vip-payer-name" type="text" placeholder="اسم من دفع VIP" value="${currentUser}" />
        </div>
        <div class="field">
          <label>سبب VIP</label>
          <input id="vip-reason" type="text" placeholder="خصم خاص / مجاني / قسط / سبب آخر" value="خصم خاص" />
        </div>
        <div class="field full-span">
          <label>ملاحظات</label>
          <textarea id="vip-notes" rows="3" placeholder="ملاحظات إضافية"></textarea>
        </div>
        <div class="field full-span inline-row">
          <button type="submit" class="primary-btn">تأكيد البيع VIP</button>
          <button type="button" class="secondary-btn" id="vip-reset-sale">إعادة تعيين</button>
        </div>
      </form>
    </div>
  `;
}

function renderTab(tabName) {
  currentVipTab = tabName;
  const tabMap = {
    students: renderStudentsTab,
    sales: renderSalesTab,
    reports: renderReportsTab,
    daily: renderDailyTab,
    sell: renderSalePanel,
  };

  const html = tabMap[tabName] ? tabMap[tabName]() : renderStudentsTab();
  vipContent.innerHTML = html;

  document.querySelectorAll('.vip-tab-btn').forEach(button => {
    button.classList.toggle('active', button.dataset.tab === tabName);
  });

  if (tabName === 'reports' || tabName === 'daily') bindVipReportFilters(tabName);

  if (tabName === 'sell') {
    const form = document.getElementById('vip-sale-form');
    const priceInput = document.getElementById('vip-original-price');
    const discountInput = document.getElementById('vip-discount');
    const finalInput = document.getElementById('vip-final-price');

    const syncFinalPrice = () => {
      const original = Number(priceInput.value || 0);
      const discount = Number(discountInput.value || 0);
      finalInput.value = Math.max(0, original - discount);
    };

    priceInput.addEventListener('input', syncFinalPrice);
    discountInput.addEventListener('input', syncFinalPrice);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const sales = getVipSales();
      const sale = {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        studentName: document.getElementById('vip-student-name').value.trim(),
        subscriptionName: document.getElementById('vip-subscription-name').value.trim(),
        originalPrice: Number(document.getElementById('vip-original-price').value || 0),
        discount: Number(document.getElementById('vip-discount').value || 0),
        finalPrice: Number(document.getElementById('vip-final-price').value || 0),
        payerName: document.getElementById('vip-payer-name').value.trim(),
        method: document.getElementById('vip-payment-method').value,
        reason: document.getElementById('vip-reason').value.trim(),
        notes: document.getElementById('vip-notes').value.trim(),
        createdBy: localStorage.getItem('currentUsername') || 'مدير',
        date: new Date().toISOString(),
        isVip: true,
        status: 'مكتمل'
      };

      if (!sale.studentName || !sale.subscriptionName) {
        showVipNotification('يرجى إدخال اسم الطالب والاشتراك', 'error');
        return;
      }

      sales.unshift(sale);
      saveVipSales(sales);
      showVipNotification('تم تسجيل البيع بنجاح في صفحة VIP', 'success');
      renderTab('sales');
    });

    document.getElementById('vip-reset-sale').addEventListener('click', () => {
      form.reset();
      priceInput.value = 600;
      discountInput.value = 0;
      finalInput.value = 600;
    });
  }
}

async function unlockVipPage() {
  const enteredTeacher = vipTeacherInput.value.trim();
  const enteredPassword = vipPasswordInput.value;
  if (!enteredTeacher || !enteredPassword) {
    showVipNotification('أدخل اسم الأستاذ وكلمة المرور', 'error');
    return;
  }
  try {
    const settings = await loadVipAccessSettings();
    const configuredTeacher = String(settings.vipAssignedTeacher || '').trim();
    if (!configuredTeacher || !settings.vipPasswordHash) {
      showVipNotification('اضبط اسم الأستاذ وكلمة المرور من إعدادات VIP أولاً', 'error');
      return;
    }
    const teacherMatches = enteredTeacher.toLocaleLowerCase() === configuredTeacher.toLocaleLowerCase();
    const passwordMatches = await hashVipPassword(enteredPassword) === settings.vipPasswordHash;
    if (!teacherMatches || !passwordMatches) {
      showVipNotification('اسم الأستاذ أو كلمة المرور غير صحيحة', 'error');
      return;
    }
    startVipSession();
    vipTeacherInput.value = '';
    vipPasswordInput.value = '';
    renderTab('students');
    refreshVipSales();
  } catch (error) {
    console.error('تعذر التحقق من دخول VIP:', error);
    showVipNotification('تعذر التحقق من إعدادات VIP. تحقق من الاتصال بقاعدة البيانات.', 'error');
  }
}

vipEnterBtn.addEventListener('click', unlockVipPage);

vipPasswordInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') unlockVipPage();
});

document.getElementById('vip-cancel-btn').addEventListener('click', () => {
  vipTeacherInput.value = '';
  vipPasswordInput.value = '';
});

document.getElementById('vip-forgot-password-btn').addEventListener('click', () => {
  document.getElementById('vip-recovery-panel').classList.remove('hidden');
});

document.getElementById('vip-cancel-recovery-btn').addEventListener('click', () => {
  document.getElementById('vip-recovery-panel').classList.add('hidden');
});

document.getElementById('vip-recover-password-btn').addEventListener('click', async () => {
  const teacher = document.getElementById('vip-recovery-teacher').value.trim();
  const phone = document.getElementById('vip-recovery-phone').value.trim();
  const newPassword = document.getElementById('vip-recovery-new-password').value;
  const confirmPassword = document.getElementById('vip-recovery-confirm-password').value;
  if (newPassword.length < 4 || newPassword !== confirmPassword) {
    showVipNotification('تأكد من تطابق كلمة المرور الجديدة وأنها 4 أحرف على الأقل', 'error');
    return;
  }
  try {
    const settings = await loadVipAccessSettings();
    const teacherMatches = teacher.toLocaleLowerCase() === String(settings.vipAssignedTeacher || '').trim().toLocaleLowerCase();
    const phoneMatches = normalizeRecoveryPhone(phone) === normalizeRecoveryPhone(settings.vipRecoveryPhone);
    if (!settings.vipRecoveryPhone || !teacherMatches || !phoneMatches) {
      showVipNotification('اسم الأستاذ أو رقم الاسترداد غير مطابق للإعدادات', 'error');
      return;
    }
    vipPasswordHash = await hashVipPassword(newPassword);
    await setDoc(doc(db, 'settings', 'main'), { vipPasswordHash }, { merge: true });
    document.getElementById('vip-recovery-panel').classList.add('hidden');
    document.getElementById('vip-recovery-teacher').value = '';
    document.getElementById('vip-recovery-phone').value = '';
    document.getElementById('vip-recovery-new-password').value = '';
    document.getElementById('vip-recovery-confirm-password').value = '';
    showVipNotification('تم تحديث كلمة المرور. استخدم كلمة المرور الجديدة للدخول.', 'success');
  } catch (error) {
    console.error('تعذر استرداد كلمة مرور VIP:', error);
    showVipNotification('تعذر استرداد كلمة المرور. تحقق من الاتصال بقاعدة البيانات.', 'error');
  }
});

document.querySelectorAll('.vip-tab-btn').forEach((button) => {
  if (button.id === 'vip-open-cashier-btn') {
    button.addEventListener('click', () => {
      window.location.href = 'cashier.html?vip=true';
    });
    return;
  }
  button.addEventListener('click', () => renderTab(button.dataset.tab));
});

if (applyVipAccess()) {
} else {
  localStorage.removeItem('vipUnlocked');
  sessionStorage.removeItem('vipUnlocked');
  vipAccessBlock.classList.remove('hidden');
  vipMainPanel.classList.add('hidden');
}

['pointerdown', 'pointermove', 'keydown', 'input', 'touchstart', 'scroll'].forEach(eventName => {
  document.addEventListener(eventName, resetVipIdleTimer, { passive: true });
});

window.addEventListener('pagehide', lockVipPage);
