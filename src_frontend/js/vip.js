import { db } from './firebase.js';
import { uniqueVipSales } from './vip-accounting.mjs?v=2';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, query, where, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const VIP_IDLE_TIMEOUT_MS = 3 * 60 * 1000;
let currentVipTab = 'students';
let vipSessionProfile = null;
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

const vipRegistrationMessages = {
  missingTeacher: '\u0631\u0627\u0628\u0637 \u062a\u0633\u062c\u064a\u0644 VIP \u063a\u064a\u0631 \u0645\u0631\u062a\u0628\u0637 \u0628\u0623\u0633\u062a\u0627\u0630. \u0627\u0637\u0644\u0628 \u0631\u0627\u0628\u0637\u064b\u0627 \u062c\u062f\u064a\u062f\u064b\u0627.',
  loading: '\u062c\u0627\u0631\u064d \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0627\u0634\u062a\u0631\u0627\u0643\u0627\u062a...',
  selectSubscriptions: '\u0627\u062e\u062a\u0631 \u0627\u0644\u0627\u0634\u062a\u0631\u0627\u0643\u0627\u062a \u0644\u0647\u0630\u0627 \u0627\u0644\u0637\u0644\u0628:',
  noSubscriptions: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0627\u0634\u062a\u0631\u0627\u0643\u0627\u062a \u0645\u0646\u0627\u0633\u0628\u0629 \u0644\u0647\u0630\u0647 \u0627\u0644\u0641\u0631\u0642\u0629.',
  chooseOne: '\u0627\u062e\u062a\u0631 \u0627\u0634\u062a\u0631\u0627\u0643\u064b\u0627 \u0648\u0627\u062d\u062f\u064b\u0627 \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644 \u0642\u0628\u0644 \u062a\u0623\u0643\u064a\u062f \u0627\u0644\u062f\u0641\u0639.',
  selectSubscription: '\u062d\u062f\u062f \u0627\u0644\u0627\u0634\u062a\u0631\u0627\u0643'
};

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
    const teacherId = vipSessionProfile?.id || '';
    const teacherName = vipSessionProfile?.name || '';
    const isManager = vipSessionProfile?.isManager === true;
    return JSON.parse(localStorage.getItem('vipSales') || '[]')
      .filter(sale => sale?.isVip === true && !isDemoSale(sale))
      .filter(sale => isManager || sale.teacherId === teacherId || sale.vipTeacherId === teacherId
        || (!sale.teacherId && !sale.vipTeacherId && teacherName && sale.assignedTeacher === teacherName));
  } catch (error) {
    return [];
  }
}

function saveVipSales(sales) {
  let existing = [];
  try { existing = JSON.parse(localStorage.getItem('vipSales') || '[]'); } catch { existing = []; }
  const merged = new Map(existing.filter(sale => sale?.isVip === true && !isDemoSale(sale)).map(sale => [sale.id, sale]));
  sales.filter(sale => sale?.isVip === true && !isDemoSale(sale)).forEach(sale => merged.set(sale.id, sale));
  localStorage.setItem('vipSales', JSON.stringify(uniqueVipSales([...merged.values()])));
}

function isDemoSale(sale) {
  return (sale.studentName === 'أحمد محمد' && sale.subscriptionName === 'مادة القانون' && sale.originalPrice === 600 && sale.finalPrice === 450 && sale.payerName === 'أستاذ محمد') ||
    (sale.studentName === 'سارة علي' && sale.subscriptionName === 'لغة إنجليزية' && sale.originalPrice === 500 && sale.finalPrice === 500);
}

function isVipUnlocked() {
  return Boolean(vipSessionProfile?.id)
    && sessionStorage.getItem('vipUnlocked') === 'true'
    && sessionStorage.getItem('vipUnlockedUserId') === vipSessionProfile.id;
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
  sessionStorage.removeItem('vipUnlockedUserId');
  vipAccessBlock.classList.remove('hidden');
  vipMainPanel.classList.add('hidden');
  vipTeacherInput.value = '';
  vipPasswordInput.value = '';
  document.getElementById('vip-recovery-panel').classList.add('hidden');
  vipSessionProfile = null;
}

function startVipSession() {
  sessionStorage.setItem('vipUnlocked', 'true');
  sessionStorage.setItem('vipUnlockedUserId', vipSessionProfile?.id || '');
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
    const isManager = vipSessionProfile?.isManager === true;
    const teacherId = vipSessionProfile?.id || '';
    const invoiceQuery = collection(db, 'invoices');
    const [snapshot, settingsSnapshot] = await Promise.all([
      getDocs(invoiceQuery),
      getDoc(doc(db, 'settings', 'main'))
    ]);
    if (settingsSnapshot.exists()) {
      const settings = settingsSnapshot.data();
      vipAssignedTeacher = String(settings.vipAssignedTeacher || '').trim();
      vipPasswordHash = String(settings.vipPasswordHash || '');
      vipRecoveryPhone = String(settings.vipRecoveryPhone || '').trim();
      localStorage.setItem('vipAssignedTeacher', vipAssignedTeacher);
    }
    const currentTeacherId = vipSessionProfile?.id || '';
    const currentTeacherName = vipSessionProfile?.name || '';
    const firestoreSales = snapshot.docs
      .map(invoiceDoc => {
        const invoice = invoiceDoc.data();
        if (invoice.isVip !== true) return null;
        if (!isManager && invoice.vipTeacherId !== currentTeacherId
          && String(invoice.vipAssignedTeacher || '').trim().toLocaleLowerCase() !== currentTeacherName.trim().toLocaleLowerCase()) return null;
        const date = invoice.date?.toDate ? invoice.date.toDate().toISOString() : invoice.date;
        const items = Array.isArray(invoice.items) ? invoice.items : [];
        const originalPrice = Number(invoice.vipOriginalPrice || items.reduce((sum, item) => sum + Number(item.price || 0), 0));
        const discount = Number(invoice.vipDiscountAmount || 0);
        const savedFinalPrice = Number(invoice.vipFinalPrice || 0);
        const finalPrice = invoice.vipFinalPrice == null || (savedFinalPrice === 0 && originalPrice > 0 && discount === 0)
          ? Math.max(0, originalPrice - discount)
          : savedFinalPrice;
        const amountCollected = Number(invoice.amountCollected ?? invoice.paidAmount ?? 0);
        const remainingAmount = Math.max(0, Number((finalPrice - amountCollected).toFixed(2)));
        const method = finalPrice === 0 ? 'مجاني'
          : amountCollected <= 0 ? 'غير محصل'
            : remainingAmount > 0 ? 'تقسيط'
              : ((invoice.paymentMethod === 'مجاني' || invoice.payment === 'مجاني')
                ? 'مدفوع بالكامل'
                : (invoice.paymentMethod || invoice.payment || 'مدفوع بالكامل'));
        return {
          id: `invoice:${invoiceDoc.id}`,
          registrationId: invoice.vipRegistrationId || '',
          invoiceNumber: invoice.num ?? '-',
          studentName: invoice.student || '',
          subscriptionName: items.map(item => item.name).filter(Boolean).join('، ') || invoice.subType || '',
          originalPrice,
          discount,
          finalPrice,
          payerName: invoice.vipPayer || 'VIP',
          createdBy: invoice.vipCreatedBy || invoice.recipient || '',
          assignedTeacher: invoice.vipAssignedTeacher || vipAssignedTeacher || '-',
          teacherId: invoice.vipTeacherId || '',
          method,
          amountCollected,
          remainingAmount,
          paymentStatus: invoice.paymentStatus || 'paid',
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
    saveVipSales(uniqueVipSales([...salesById.values()]));
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

  // صفوف الفواتير القديمة
  const invoiceRows = sales.map(student => `
    <tr>
      <td>${student.invoiceNumber || '-'}</td>
      <td>${escapeVipHtml(student.studentName || '-')}</td>
      <td>${escapeVipHtml(student.subscriptionName || '-')}</td>
      <td><span class="vip-mark">VIP</span></td>
      <td>${formatCurrency(student.finalPrice)}</td>
      <td>${escapeVipHtml(student.assignedTeacher || vipAssignedTeacher || '-')}</td>
      <td>${escapeVipHtml(student.createdBy || '-')}</td>
      <td>${new Date(student.date).toLocaleDateString('ar-EG')}</td>
    </tr>
  `).join('');

  // صفوف الطلاب المسجّلين عبر QR (كل الطلبات — منتظرة ومكتملة)
  const regRows = vipRegistrationsList
    .filter(reg => !(reg.paymentStatus === 'paid' && reg.invoiceId) && !sales.some(sale => sale.registrationId === reg.id))
    .map(reg => {
    const date = reg.registeredAt?.toDate
      ? reg.registeredAt.toDate().toLocaleDateString('ar-EG')
      : (reg.registeredAt ? new Date(reg.registeredAt).toLocaleDateString('ar-EG') : '-');
    const isPending = reg.paymentStatus !== 'paid';
    const statusCell = isPending
      ? '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:20px;font-size:12px;">⏳ منتظر دفع</span>'
      : `<span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:20px;font-size:12px;">✅ ${reg.paidAmount != null ? reg.paidAmount + ' جنيه' : 'مدفوع'}</span>`;
    return `
    <tr>
      <td>${escapeVipHtml(reg.invoiceNumber || '-')}</td>
      <td>${escapeVipHtml(reg.studentName || '-')}</td>
      <td>${escapeVipHtml(reg.selectedSubscriptions?.map(item => item.name).filter(Boolean).join(', ') || reg.notes || 'VIP QR')}</td>
      <td>${statusCell}</td>
      <td>${reg.selectedSubscriptions?.length ? formatCurrency(reg.paymentStatus === 'paid' ? reg.paidAmount : reg.requestedAmount) : vipRegistrationMessages.selectSubscription}</td>
      <td>${escapeVipHtml(reg.teacherName || vipAssignedTeacher || '-')}</td>
      <td>${escapeVipHtml(reg.paidBy || '-')}</td>
      <td>${date}</td>
    </tr>`;
  }).join('');

  const allRows = invoiceRows + regRows;

  return `
    <div class="vip-card">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
        <h3 style="margin:0;">طلابك المشتركين</h3>
        <button class="secondary-btn" id="vip-students-refresh" style="margin:0;padding:6px 14px;font-size:13px;">🔄 تحديث</button>
      </div>
      <div class="vip-table-wrap">
        <table class="vip-table">
          <thead>
            <tr>
              <th>رقم الفاتورة</th>
              <th>اسم الطالب</th>
              <th>الاشتراك / الملاحظة</th>
              <th>الحالة</th>
              <th>المبلغ</th>
              <th>تابع الأستاذ</th>
              <th>منفذ العملية</th>
              <th>التاريخ</th>
            </tr>
          </thead>
          <tbody>${allRows || '<tr><td colspan="8">لا توجد بيانات VIP حتى الآن.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

function bindStudentsRefresh() {
  const btn = document.getElementById('vip-students-refresh');
  if (btn) {
    btn.addEventListener('click', async () => {
      btn.textContent = '⏳ جاري التحديث...';
      await loadVipRegistrations();
      await refreshVipSales();
      vipContent.innerHTML = renderStudentsTab();
      bindStudentsRefresh();
      btn.textContent = '🔄 تحديث';
    });
  }
}


function renderSalesTab() {
  const sales = getVipSales();
  const invoiceRows = sales.map(sale => `
    <tr>
      <td>${escapeVipHtml(sale.studentName)}</td>
      <td>${escapeVipHtml(sale.subscriptionName)}</td>
      <td>${formatCurrency(sale.originalPrice)}</td>
      <td>${formatCurrency(sale.discount)}</td>
      <td>${formatCurrency(sale.finalPrice)}</td>
      <td>${escapeVipHtml(sale.method || '-')}</td>
      <td>${escapeVipHtml(sale.createdBy || '-')}</td>
      <td>${new Date(sale.date).toLocaleDateString('ar-EG')}</td>
    </tr>
  `).join('');

  // إضافة المدفوعات من تسجيلات QR
  const paidRegs = vipRegistrationsList.filter(r => r.paymentStatus === 'paid' && !r.invoiceId);
  const regRows = paidRegs.map(reg => {
    const date = reg.paidAt?.toDate ? reg.paidAt.toDate().toLocaleDateString('ar-EG')
      : (reg.registeredAt?.toDate ? reg.registeredAt.toDate().toLocaleDateString('ar-EG') : '-');
    return `
    <tr>
      <td>${escapeVipHtml(reg.studentName || '-')}</td>
      <td>تسجيل QR</td>
      <td>-</td>
      <td>-</td>
      <td>${formatCurrency(reg.paidAmount || 0)}</td>
      <td>${escapeVipHtml(reg.paymentMethod || '-')}</td>
      <td>${escapeVipHtml(reg.paidBy || '-')}</td>
      <td>${date}</td>
    </tr>`;
  }).join('');

  const allRows = invoiceRows + regRows;

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
          <tbody>${allRows || '<tr><td colspan="8">لا توجد مبيعات حتى الآن.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

function buildVipSummaryCards() {
  const regs = vipRegistrationsList;
  const studentKeys = new Set(regs.map(reg => {
    const phone = String(reg.phone || '').replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/\D/g, '');
    return phone ? `phone:${phone}` : `name:${String(reg.studentName || '').trim().toLocaleLowerCase()}`;
  }));
  const totalStudents = studentKeys.size;
  const paidCount = regs.filter(r => r.paymentStatus === 'paid').length;
  const pendingCount = regs.filter(r => r.paymentStatus !== 'paid').length;
  const totalPaid = regs.filter(r => r.paymentStatus === 'paid').reduce((s, r) => s + Number(r.paidAmount || 0), 0);

  // تقسيم حسب الفرقة
  const gradeMap = {};
  regs.forEach(reg => {
    const grade = reg.grade || 'غير محدد';
    if (!gradeMap[grade]) gradeMap[grade] = { total: 0, paid: 0, pending: 0, amount: 0 };
    gradeMap[grade].total++;
    if (reg.paymentStatus === 'paid') {
      gradeMap[grade].paid++;
      gradeMap[grade].amount += Number(reg.paidAmount || 0);
    } else {
      gradeMap[grade].pending++;
    }
  });

  const gradeRows = Object.entries(gradeMap).map(([grade, data]) => `
    <tr>
      <td>${escapeVipHtml(grade)}</td>
      <td>${data.total}</td>
      <td>${data.paid}</td>
      <td style="color:#b42318;font-weight:700;">${data.pending}</td>
      <td>${formatCurrency(data.amount)}</td>
    </tr>
  `).join('') || '<tr><td colspan="5">لا توجد بيانات.</td></tr>';

  return `
    <div class="vip-summary-grid" style="margin-bottom:20px;">
      <div class="summary-box blue"><h4>إجمالي الطلاب</h4><strong>${totalStudents}</strong></div>
      <div class="summary-box green"><h4>\u0627\u0634\u062a\u0631\u0627\u0643\u0627\u062a \u0645\u062f\u0641\u0648\u0639\u0629</h4><strong>${paidCount}</strong></div>
      <div class="summary-box red"><h4>\u0637\u0644\u0628\u0627\u062a \u0628\u0627\u0646\u062a\u0638\u0627\u0631 \u0627\u0644\u062f\u0641\u0639</h4><strong>${pendingCount}</strong></div>
      <div class="summary-box orange"><h4>إجمالي المدفوع</h4><strong>${formatCurrency(totalPaid)}</strong></div>
    </div>

    <div class="vip-card" style="margin-bottom:20px;">
      <h4>📊 ملخص حسب الفرقة</h4>
      <div class="vip-table-wrap">
        <table class="vip-table">
          <thead>
            <tr>
              <th>الفرقة</th>
              <th>\u0639\u062f\u062f \u0627\u0644\u0627\u0634\u062a\u0631\u0627\u0643\u0627\u062a</th>
              <th>دفعوا</th>
              <th>لم يدفعوا</th>
              <th>المبلغ المحصّل</th>
            </tr>
          </thead>
          <tbody>${gradeRows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderReportsTab() {
  return `<div class="vip-card"><h3>تقارير VIP</h3>${buildVipSummaryCards()}${renderReportFilters('reports')}<div id="vip-report-results"></div></div>`;
}

function renderDailyTab() {
  return `<div class="vip-card"><h3>قفل يومي VIP</h3>${buildVipSummaryCards()}${renderReportFilters('daily')}<div id="vip-report-results"></div></div>`;
}

function renderRegisterLinkTab() {
  const currentUserId = vipSessionProfile?.id || '';
  let portalUrl = '';
  let teacherPortalUrl = '';
  try {
    const base = new URL('../موقع الطلاب/vip-portal.html', window.location.href);
    if (currentUserId) base.searchParams.set('teacher', currentUserId);
    portalUrl = decodeURI(base.href);
    teacherPortalUrl = new URL('../موقع الطلاب/vip-teacher-login.html', window.location.href).href;
  } catch (e) {
    portalUrl = '';
  }
  const qrSrc = portalUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(portalUrl)}`
    : '';

  return `
    <div class="vip-card">
      <h3>&#128081; رابط تسجيل VIP</h3>
      ${teacherPortalUrl ? `<a href="${teacherPortalUrl}" target="_blank" rel="noopener" style="display:block;margin:12px 0;padding:10px;border-radius:8px;background:#e7f4ff;text-align:center;font-weight:bold;">فتح بوابة الأستاذ VIP</a>` : ''}
      <p style="color:#555;line-height:1.8;">
        شارك هذا الرابط أو اطلب من الطالب مسح QR لتسجيل بياناته في اشتراك VIP.
      </p>
      ${portalUrl ? `
        <div style="text-align:center;margin:20px 0;padding:16px;border:3px solid #141414;border-radius:8px;background:#fffde7;box-shadow:6px 6px 0 #141414;">
          <img src="${qrSrc}" alt="QR تسجيل VIP" style="max-width:200px;margin-bottom:12px;border:2px solid #141414;border-radius:4px;">
          <p style="font-weight:900;margin:0 0 10px;">امسح QR للتسجيل</p>
        </div>
        <div style="margin-top:14px;">
          <label style="font-weight:900;display:block;margin-bottom:8px;">رابط التسجيل</label>
          <div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;">
            <input id="vip-portal-url-input" type="text" value="${portalUrl}" readonly
              style="width:100%;padding:10px 12px;border:2px solid #141414;border-radius:6px;font-family:monospace;font-size:13px;background:#f9f9f9;direction:ltr;">
            <button type="button" id="vip-copy-link-btn"
              style="padding:10px 16px;border:2px solid #141414;border-radius:6px;background:#00d6a3;box-shadow:4px 4px 0 #141414;font-weight:900;cursor:pointer;white-space:nowrap;width:auto;margin:0;box-shadow:3px 3px 0 #141414;">
              &#128203; نسخ
            </button>
          </div>
        </div>
        <a href="${portalUrl}" target="_blank"
          style="display:block;margin-top:12px;padding:12px;border:2px solid #141414;border-radius:6px;background:#f6d860;box-shadow:4px 4px 0 #141414;text-align:center;font-weight:900;text-decoration:none;color:#141414;">
          &#128279; فتح صفحة التسجيل
        </a>
      ` : '<p style="color:#b42318;font-weight:900;">تعذر تكوين الرابط. تأكد من الاتصال بقاعدة البيانات.</p>'}
    </div>
  `;
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
  const collected = sales.reduce((sum, sale) => sum + Number(sale.amountCollected ?? (Number(sale.finalPrice || 0) === 0 ? 0 : Number(sale.finalPrice || 0))), 0);
  const remaining = sales.reduce((sum, sale) => sum + Number(sale.remainingAmount ?? Math.max(0, Number(sale.finalPrice || 0) - Number(sale.amountCollected ?? sale.finalPrice ?? 0))), 0);
  const free = sales.filter(sale => Number(sale.finalPrice || 0) === 0).length;
  const label = mode === 'daily' ? 'مبيعات اليوم' : 'إجمالي المبيعات';
  return `
    <div class="vip-summary-grid">
      <div class="summary-box blue"><h4>${label}</h4><strong>${formatCurrency(total)}</strong></div>
      <div class="summary-box orange"><h4>إجمالي الخصومات</h4><strong>${formatCurrency(discount)}</strong></div>
      <div class="summary-box green"><h4>عدد العمليات</h4><strong>${sales.length}</strong></div>
      <div class="summary-box red"><h4>عمليات مجانية</h4><strong>${free}</strong></div>
      <div class="summary-box green"><h4>\u0627\u0644\u0645\u062d\u0635\u0644 \u0641\u0639\u0644\u064b\u0627</h4><strong>${formatCurrency(collected)}</strong></div>
      <div class="summary-box orange"><h4>\u0627\u0644\u0645\u062a\u0628\u0642\u064a \u0639\u0644\u0649 \u0627\u0644\u0637\u0644\u0627\u0628</h4><strong>${formatCurrency(remaining)}</strong></div>
    </div>
  `;
}

function renderVipBreakdown(sales, field, title) {
  const groups = new Map();
  sales.forEach(sale => {
    const name = sale[field] || 'غير محدد';
    const group = groups.get(name) || { count: 0, total: 0 };
    group.count++;
    group.total += Number(sale.amountCollected ?? (Number(sale.finalPrice || 0) === 0 ? 0 : Number(sale.finalPrice || 0)));
    groups.set(name, group);
  });
  const rows = [...groups.entries()].map(([name, group]) => `
    <tr><td>${escapeVipHtml(name)}</td><td>${group.count}</td><td>${formatCurrency(group.total)}</td></tr>
  `).join('') || '<tr><td colspan="3">لا توجد عمليات ضمن الفلاتر.</td></tr>';
  return `<div class="vip-breakdown"><h4>${title}</h4><table class="vip-table"><thead><tr><th>التصنيف</th><th>العمليات</th><th>\u0627\u0644\u0645\u062d\u0635\u0644</th></tr></thead><tbody>${rows}</tbody></table></div>`;
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
      <td>${formatCurrency(sale.amountCollected ?? (Number(sale.finalPrice || 0) === 0 ? 0 : Number(sale.finalPrice || 0)))}</td>
      <td>${formatCurrency(sale.remainingAmount ?? Math.max(0, Number(sale.finalPrice || 0) - Number(sale.amountCollected ?? sale.finalPrice ?? 0)))}</td>
      <td>${escapeVipHtml(sale.method || '-')}</td>
      <td>${escapeVipHtml(sale.createdBy || '-')}</td>
      <td>${escapeVipHtml(sale.assignedTeacher || vipAssignedTeacher || '-')}</td>
      <td>${escapeVipHtml(new Date(sale.date).toLocaleString('ar-EG'))}</td>
    </tr>
  `).join('') || '<tr><td colspan="12">لا توجد عمليات ضمن الفلاتر المحددة.</td></tr>';
  return `
    <div class="vip-table-wrap">
      <table class="vip-table vip-report-table">
        <thead><tr><th>الفاتورة</th><th>الطالب</th><th>الاشتراك</th><th>الأصلي</th><th>الخصم</th><th>النهائي</th><th>&#1575;&#1604;&#1605;&#1581;&#1589;&#1604;</th><th>&#1575;&#1604;&#1605;&#1578;&#1576;&#1602;&#1610;</th><th>الدفع</th><th>المنفذ</th><th>تابع الأستاذ</th><th>التاريخ والوقت</th></tr></thead>
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
    ['المحصل فعليًا', 'amountCollected'], ['المتبقي', 'remainingAmount'],
    ['طريقة الدفع', 'method'], ['منفذ العملية', 'createdBy'], ['تابع الأستاذ', 'assignedTeacher'], ['التاريخ', 'date']
  ];
  const csv = [columns.map(([title]) => title), ...sales.map(sale => columns.map(([, key]) => key === 'amountCollected'
    ? (sale.amountCollected ?? (Number(sale.finalPrice || 0) === 0 ? 0 : Number(sale.finalPrice || 0)))
    : key === 'remainingAmount'
      ? (sale.remainingAmount ?? Math.max(0, Number(sale.finalPrice || 0) - Number(sale.amountCollected ?? sale.finalPrice ?? 0)))
      : (sale[key] ?? '')))]
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

// ===== طلبات التسجيل VIP (من موقع الطلاب) =====
let vipRegistrationsList = [];

async function loadVipRegistrations() {
  try {
    const teacherId = vipSessionProfile?.id || '';
    const isManager = vipSessionProfile?.isManager === true;
    const teacherName = String(vipSessionProfile?.name || vipAssignedTeacher || '').trim();
    const snap = await getDocs(collection(db, 'vipRegistrations'));
    // ترتيب محلي من الأحدث للأقدم
    vipRegistrationsList = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(reg => isManager || reg.teacherId === teacherId
        || String(reg.teacherName || '').trim().toLocaleLowerCase() === teacherName.toLocaleLowerCase())
      .sort((a, b) => {
        const aTime = a.registeredAt?.toDate ? a.registeredAt.toDate().getTime() : (new Date(a.registeredAt || 0).getTime());
        const bTime = b.registeredAt?.toDate ? b.registeredAt.toDate().getTime() : (new Date(b.registeredAt || 0).getTime());
        return bTime - aTime;
      });

    const invoicesSnapshot = await getDocs(collection(db, 'invoices'));
    const linkedTeacherName = teacherName;
    const invoiceDataById = new Map(invoicesSnapshot.docs.map(item => [item.id, item.data()]));
    for (const registration of vipRegistrationsList) {
      if (!registration.teacherName && linkedTeacherName) registration.teacherName = linkedTeacherName;
      const linkedInvoice = registration.invoiceId ? invoiceDataById.get(registration.invoiceId) : null;
      if (linkedInvoice?.num && !registration.invoiceNumber) {
        registration.invoiceNumber = linkedInvoice.num;
      }
    }
    const pending = vipRegistrationsList.filter(r => r.paymentStatus !== 'paid').length;
    const badge = document.getElementById('vip-pending-badge');
    if (badge) {
      if (pending > 0) { badge.textContent = pending; badge.style.display = 'inline-block'; }
      else { badge.style.display = 'none'; }
    }
  } catch (err) {
    console.error('تعذر تحميل طلبات التسجيل:', err);
    vipRegistrationsList = [];
  }
}

function renderRegistrationsTab() {
  if (!vipRegistrationsList.length) {
    loadVipRegistrations().then(() => {
      const box = document.getElementById('vip-regs-body');
      if (box) box.innerHTML = buildRegistrationsRows();
    });
  }
  return `
    <div class="vip-card">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
        <h3 style="margin:0;">📋 طلبات تسجيل VIP</h3>
        <button class="secondary-btn" id="vip-regs-refresh" style="margin:0;padding:6px 14px;font-size:13px;">🔄 تحديث</button>
      </div>
      <div class="vip-table-wrap">
        <table class="vip-table">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>الهاتف</th>
              <th>الفرقة</th>
              <th>الملاحظات</th>
              <th>وقت التسجيل</th>
              <th>الحالة</th>
              <th>إجراء</th>
            </tr>
          </thead>
          <tbody id="vip-regs-body">${buildRegistrationsRows()}</tbody>
        </table>
      </div>
    </div>

    <!-- نافذة إكمال الدفع -->
    <div id="vip-pay-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:16px;padding:32px;width:min(500px,95vw);box-shadow:0 8px 40px rgba(0,0,0,.3);direction:rtl;">
        <h3 style="margin:0 0 20px;">💳 إكمال بيانات الدفع</h3>
        <div id="vip-pay-student-info" style="background:#f5f5f5;border-radius:8px;padding:12px;margin-bottom:18px;font-size:14px;"></div>
        <div id="vip-pay-subscription-picker" style="margin-bottom:16px;"></div>
        <div class="field">
          <label>قيمة الاشتراك الظاهرة في الفاتورة (جنيه)</label>
          <input id="vip-pay-invoice-price" type="number" min="0" step="0.01" placeholder="0" style="width:100%;" />
        </div>
        <div class="field">
          <label>المبلغ المحصّل فعليًا (جنيه، اكتب صفرًا إذا كان مجانيًا)</label>
          <input id="vip-pay-amount" type="number" min="0" step="0.01" placeholder="0" style="width:100%;" />
        </div>
        <div class="field">
          <label>طريقة الدفع</label>
          <select id="vip-pay-method" style="width:100%;">
            <option value="نقدي">نقدي</option>
            <option value="فودافون كاش">فودافون كاش</option>
            <option value="انستا باي">انستا باي</option>
            <option value="تقسيط">تقسيط</option>
          </select>
        </div>
        <div class="field">
          <label>ملاحظة (اختياري)</label>
          <input id="vip-pay-note" type="text" placeholder="ملاحظة إضافية" style="width:100%;" />
        </div>
        <div style="display:flex;gap:12px;margin-top:20px;">
          <button class="primary-btn" id="vip-pay-confirm">✅ تأكيد الدفع</button>
          <button class="secondary-btn" id="vip-pay-cancel">إلغاء</button>
        </div>
      </div>
    </div>
  `;
}

function buildRegistrationsRows() {
  if (!vipRegistrationsList.length) return '<tr><td colspan="7">لا توجد طلبات تسجيل حتى الآن.</td></tr>';
  return vipRegistrationsList.map(reg => {
    const date = reg.registeredAt?.toDate ? reg.registeredAt.toDate().toLocaleString('ar-EG') : (reg.registeredAt || '-');
    const isPending = reg.paymentStatus !== 'paid';
    const statusBadge = isPending
      ? '<span style="background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:20px;font-size:12px;">? ?????</span>'
      : reg.installment?.remaining > 0
        ? `<span style="background:#fff3cd;color:#92400e;padding:3px 10px;border-radius:20px;font-size:12px;">????? ? ????? ${formatCurrency(reg.installment.paid || reg.paidAmount || 0)} ? ????? ${formatCurrency(reg.installment.remaining)}</span>`
        : '<span style="background:#d1fae5;color:#065f46;padding:3px 10px;border-radius:20px;font-size:12px;">? ?????</span>';
    const actionBtn = isPending
      ? `<button class="primary-btn vip-complete-pay-btn" data-id="${reg.id}" style="padding:5px 14px;font-size:13px;">إكمال الدفع</button>`
      : `<span style="color:#888;font-size:12px;">${reg.paidAmount != null ? reg.paidAmount + ' جنيه' : ''} | ${reg.paymentMethod || ''}</span>`;
    return `
      <tr>
        <td>#${escapeVipHtml(reg.invoiceNumber || '-')}<br>${escapeVipHtml(reg.studentName || '-')}<br><small>${escapeVipHtml(reg.selectedSubscriptions?.map(item => item.name).filter(Boolean).join('، ') || reg.notes || 'VIP QR')}</small></td>
        <td>${escapeVipHtml(reg.phone || '-')}</td>
        <td>${escapeVipHtml(reg.grade || '-')}</td>
        <td>${escapeVipHtml(reg.teacherName || vipAssignedTeacher || '-')}<br>${escapeVipHtml(reg.notes || '-')}</td>
        <td>${date}</td>
        <td>${statusBadge}</td>
        <td>${actionBtn}</td>
      </tr>`;
  }).join('');
}

let activeRegId = null;

async function openPayModal(regId) {
  activeRegId = regId;
  const reg = vipRegistrationsList.find(item => item.id === regId);
  if (!reg) return;
  document.getElementById('vip-pay-student-info').innerHTML = `<strong>${escapeVipHtml(reg.studentName)}</strong> &nbsp;|&nbsp; ${escapeVipHtml(reg.phone)} &nbsp;|&nbsp; ${escapeVipHtml(reg.grade)}`;
  document.getElementById('vip-pay-invoice-price').value = reg.teacherReportedAmount != null
    ? Number(reg.teacherReportedAmount)
    : (reg.requestedAmount != null ? Number(reg.requestedAmount) : 0);
  document.getElementById('vip-pay-amount').value = reg.teacherReportedPaidAmount != null ? Number(reg.teacherReportedPaidAmount) : (reg.amountCollected != null ? Number(reg.amountCollected) : (reg.teacherReportedAmount != null ? Number(reg.teacherReportedAmount) : (reg.requestedAmount != null ? Number(reg.requestedAmount) : 0)));
  document.getElementById('vip-pay-method').value = 'نقدي';
  document.getElementById('vip-pay-note').value = '';
  const picker = document.getElementById('vip-pay-subscription-picker');
  const confirmBtn = document.getElementById('vip-pay-confirm');
  const hasSubscriptions = Array.isArray(reg.selectedSubscriptions) && reg.selectedSubscriptions.length > 0;
  picker.textContent = hasSubscriptions
    ? reg.selectedSubscriptions.map(item => item.name).filter(Boolean).join('، ')
    : 'لا يمكن اعتماد الطلب لأن تفاصيل الاشتراكات المختارة غير محفوظة في الطلب الأصلي.';
  confirmBtn.disabled = !hasSubscriptions || reg.paymentStatus === 'paid';
  document.getElementById('vip-pay-modal').style.display = 'flex';
}

function closePayModal() {
  document.getElementById('vip-pay-modal').style.display = 'none';
  activeRegId = null;
}

async function confirmPayment() {
  if (!activeRegId) return;
  const regId = activeRegId;
  const rawAmount = document.getElementById('vip-pay-amount').value;
  const amount = rawAmount === '' ? NaN : Number(rawAmount);
  const rawInvoicePrice = document.getElementById('vip-pay-invoice-price').value;
  let invoicePrice = rawInvoicePrice === '' ? NaN : Number(rawInvoicePrice);
  if (amount === 0) invoicePrice = 0;
  const method = document.getElementById('vip-pay-method').value;
  const note = document.getElementById('vip-pay-note').value.trim();
  const confirmBtn = document.getElementById('vip-pay-confirm');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'جارٍ الحفظ...';
  try {
    const registration = vipRegistrationsList.find(item => item.id === regId);
    if (!registration) throw new Error('طلب VIP غير موجود.');
    const selectedSubscriptions = Array.isArray(registration.selectedSubscriptions) ? registration.selectedSubscriptions : [];
    if (!selectedSubscriptions.length) throw new Error('تفاصيل الاشتراكات المختارة غير محفوظة في الطلب الأصلي.');
    if (!Number.isFinite(amount) || amount < 0) throw new Error('أدخل المبلغ المحصل، واكتب صفرًا إذا كان الاشتراك مجانيًا.');

    if (!Number.isFinite(invoicePrice) || invoicePrice < 0) throw new Error('Enter the subscription price that should appear on the invoice.');
    if (amount > invoicePrice) throw new Error('\u0627\u0644\u0645\u0628\u0644\u063a \u0627\u0644\u0645\u062d\u0635\u0644 \u0644\u0627 \u064a\u062c\u0648\u0632 \u0623\u0646 \u064a\u0632\u064a\u062f \u0639\u0646 \u0642\u064a\u0645\u0629 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629.');
    const invoiceId = `vip_${regId}`;
    const invoiceRef = doc(db, 'invoices', invoiceId);
    const registrationRef = doc(db, 'vipRegistrations', regId);
    let invoiceNumber = Number(registration.invoiceNumber) || 0;
    if (!invoiceNumber) {
      const [invoiceSnapshot, normalRegistrationSnapshot] = await Promise.all([
        getDocs(collection(db, 'invoices')),
        getDocs(collection(db, 'studentRegistrations'))
      ]);
      invoiceNumber = [
        ...invoiceSnapshot.docs.map(item => Number(item.data().num) || 0),
        ...normalRegistrationSnapshot.docs.map(item => Number(item.data().invoiceNumber) || 0)
      ].reduce((highest, number) => Math.max(highest, number), 0) + 1;
    }
    const operatorName = localStorage.getItem('currentUsername') || localStorage.getItem('currentUserName') || localStorage.getItem('currentUserId') || 'مدير';
    const requestedPrice = selectedSubscriptions.reduce((sum, item) => sum + Number(item.price || 0), 0);
    let assignedPrice = 0;
    const invoiceItems = selectedSubscriptions.map((item, index) => {
      const linePrice = index === selectedSubscriptions.length - 1
        ? Number((invoicePrice - assignedPrice).toFixed(2))
        : requestedPrice > 0 ? Number((invoicePrice * Number(item.price || 0) / requestedPrice).toFixed(2)) : 0;
      assignedPrice += linePrice;
      return { id: item.id || "", subscriptionId: item.id || "", name: item.name || "VIP subscription", type: item.type || "", price: linePrice, quantity: 1 };
    });
    const subscriptionTypes = [...new Set(invoiceItems.map(item => item.type).filter(Boolean))];
    const invoiceData = {
      num: invoiceNumber, student: registration.studentName || '-', phone: registration.phone || '',
      grade: registration.grade || '-', studyType: registration.studyType || '-',
      subType: subscriptionTypes.length > 1 ? subscriptionTypes.join(' و ') : (subscriptionTypes[0] || 'اشتراك VIP'),
      items: invoiceItems, selectedSubscriptions, payment: amount < invoicePrice ? '\u062a\u0642\u0633\u064a\u0637' : (invoicePrice === 0 ? '\u0645\u062c\u0627\u0646\u064a' : method),
      paymentMethod: invoicePrice === 0 ? 'مجاني' : method, paymentStatus: 'paid', paidAmount: amount,
      amountCollected: amount, installment: amount < invoicePrice ? { total: invoicePrice, paid: amount, remaining: Number((invoicePrice - amount).toFixed(2)) } : null,
      vipStockDeducted: false,
      notes: registration.notes || 'تسجيل VIP عبر QR', recipient: registration.teacherName || '',
      createdBy: operatorName, isVip: true, vipFinalPrice: invoicePrice, vipSubscriptionPrice: invoicePrice,
      vipOriginalPrice: Number(registration.requestedAmount || 0),
      vipDiscountAmount: Math.max(0, Number(registration.requestedAmount || 0) - invoicePrice),
      vipPayer: registration.studentName || 'VIP', vipCreatedBy: operatorName, vipConfirmedBy: operatorName,
      vipAssignedTeacher: registration.teacherName || '', vipTeacherId: registration.teacherId || '', vipRegistrationId: regId
    };

      const phone = String(registration.phone || '').trim();
      if (phone) {
        const [samePhoneInvoices, samePhoneRegistrations, samePhonePortalRegistrations] = await Promise.all([
          getDocs(query(collection(db, 'invoices'), where('phone', '==', phone))),
          getDocs(query(collection(db, 'vipRegistrations'), where('phone', '==', phone))),
          getDocs(query(collection(db, 'studentRegistrations'), where('phone', '==', phone)))
        ]);
        const selectedIds = new Map(selectedSubscriptions.filter(item => item?.id).map(item => [item.id, item.name || item.id]));
        const duplicateNames = new Set();
        const checkRecords = (snapshot, collectionName) => snapshot.docs.forEach(docSnapshot => {
          if ((collectionName === 'vipRegistrations' && docSnapshot.id === regId)
            || (collectionName === 'invoices' && docSnapshot.id === invoiceId)) return;
          const existing = docSnapshot.data();
          const existingItems = existing.items || existing.selectedSubscriptions || existing.subscriptions || existing.selectedItems || [];
          existingItems.forEach(item => {
            const id = item?.id || item?.subscriptionId;
            if (id && selectedIds.has(id)) duplicateNames.add(selectedIds.get(id));
          });
        });
        checkRecords(samePhoneInvoices, 'invoices');
        checkRecords(samePhoneRegistrations, 'vipRegistrations');
        checkRecords(samePhonePortalRegistrations, 'studentRegistrations');
        if (duplicateNames.size) throw new Error('\u0627\u0644\u0637\u0627\u0644\u0628 \u0645\u0634\u062a\u0631\u0643 \u0628\u0627\u0644\u0641\u0639\u0644 \u0641\u064a: ' + [...duplicateNames].join('، ') + '. \u0627\u062e\u062a\u0631 \u0627\u0634\u062a\u0631\u0627\u0643\u064b\u0627 \u0623\u0648 \u0645\u0644\u0632\u0645\u0629 \u0645\u062e\u062a\u0644\u0641\u0629.');
      }
    await runTransaction(db, async transaction => {
      const [currentRegSnap, currentInvoiceSnap] = await Promise.all([
        transaction.get(registrationRef), transaction.get(invoiceRef)
      ]);
      if (!currentRegSnap.exists()) throw new Error('طلب VIP غير موجود.');
      const currentReg = currentRegSnap.data();
      const sameTeacher = currentReg.teacherId === vipSessionProfile?.id
        || String(currentReg.teacherName || '').trim().toLocaleLowerCase() === String(vipSessionProfile?.name || '').trim().toLocaleLowerCase();
      if (!vipSessionProfile?.isManager && !sameTeacher) {
        throw new Error('هذا الطلب غير مرتبط بحساب الأستاذ الحالي.');
      }
      const currentItems = Array.isArray(currentReg.selectedSubscriptions) ? currentReg.selectedSubscriptions : [];
      if (!currentItems.length) throw new Error('تفاصيل الاشتراكات المختارة غير محفوظة في الطلب الأصلي.');
      if (JSON.stringify(currentItems.map(item => [item.id, item.name, item.type, Number(item.price || 0)]))
        !== JSON.stringify(selectedSubscriptions.map(item => [item.id, item.name, item.type, Number(item.price || 0)]))) {
        throw new Error('تغيرت تفاصيل الطلب منذ فتح نافذة الدفع. حدّث الطلب ثم أعد المحاولة.');
      }
      if (currentInvoiceSnap.exists()) {
        const existing = currentInvoiceSnap.data();
        if (existing.vipRegistrationId !== regId) throw new Error('رقم الفاتورة مرتبط بطلب آخر.');
        if (currentReg.paymentStatus !== 'paid' || currentReg.invoiceId !== invoiceId) {
          transaction.update(registrationRef, {
            paymentStatus: 'paid', paidAmount: Number(existing.amountCollected ?? existing.paidAmount ?? 0),
            amountCollected: Number(existing.amountCollected ?? existing.paidAmount ?? 0),
            paymentMethod: existing.paymentMethod || existing.payment || 'مجاني',
            paidBy: existing.vipConfirmedBy || operatorName, paidAt: existing.date || new Date(),
            invoiceId, invoiceNumber: existing.num || invoiceNumber
          });
        }
        return;
      }
      if (currentReg.paymentStatus === 'paid') throw new Error('الطلب مسجل كمدفوع دون فاتورة مرتبطة؛ يلزم تصحيح السجل أولًا.');
      const items = currentItems;
      if (!items.length) throw new Error('تفاصيل الاشتراكات المختارة غير محفوظة في الطلب الأصلي.');
      if (items.some(item => !item.id)) throw new Error('VIP subscription is missing an id.');
      const refs = [...new Set(items.map(item => item.id))].map(id => doc(db, 'subscriptions', id));
      const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
      snapshots.forEach(snapshot => { if (!snapshot.exists()) throw new Error('A selected subscription no longer exists.'); });
      transaction.set(invoiceRef, invoiceData);
      transaction.update(registrationRef, {
        paymentStatus: 'paid', subscriptionAmount: invoicePrice, paidAmount: amount, amountCollected: amount,
        installment: invoiceData.installment, paymentMethod: invoiceData.paymentMethod, payNote: note, paidBy: operatorName,
        paidAt: new Date(), invoiceId, invoiceNumber
      });
    });

    const idx = vipRegistrationsList.findIndex(item => item.id === regId);
    if (idx !== -1) Object.assign(vipRegistrationsList[idx], {
      paymentStatus: 'paid', subscriptionAmount: invoicePrice, paidAmount: amount, amountCollected: amount,
      paymentMethod: invoicePrice === 0 ? '\u0645\u062c\u0627\u0646\u064a' : method, installment: invoiceData.installment, invoiceId, invoiceNumber, paidBy: operatorName
    });
    closePayModal();
    showVipNotification('تم تسجيل العملية بنجاح.', 'success');
    const body = document.getElementById('vip-regs-body');
    if (body) body.innerHTML = buildRegistrationsRows();
    bindRegistrationsEvents();
    const pending = vipRegistrationsList.filter(item => item.paymentStatus !== 'paid').length;
    const badge = document.getElementById('vip-pending-badge');
    if (badge) { badge.textContent = pending; badge.style.display = pending > 0 ? 'inline-block' : 'none'; }
  } catch (error) {
    console.error(error);
    showVipNotification(error.message || 'تعذر حفظ الدفع. تحقق من الاتصال.', 'error');
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'تأكيد الدفع';
  }
}
function bindRegistrationsEvents() {
  document.querySelectorAll('.vip-complete-pay-btn').forEach(btn => {
    btn.addEventListener('click', () => openPayModal(btn.dataset.id));
  });
  const refreshBtn = document.getElementById('vip-regs-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.textContent = '⏳ جاري التحديث...';
      await loadVipRegistrations();
      const body = document.getElementById('vip-regs-body');
      if (body) body.innerHTML = buildRegistrationsRows();
      bindRegistrationsEvents();
      refreshBtn.textContent = '🔄 تحديث';
    });
  }
  const cancelBtn = document.getElementById('vip-pay-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', closePayModal);
  const confirmBtn = document.getElementById('vip-pay-confirm');
  if (confirmBtn) confirmBtn.addEventListener('click', confirmPayment);
}
// ===================================================

function renderTab(tabName) {
  currentVipTab = tabName;
  const tabMap = {
    students: renderStudentsTab,
    registrations: renderRegistrationsTab,
    sales: renderSalesTab,
    reports: renderReportsTab,
    daily: renderDailyTab,
    sell: renderSalePanel,
    'register-link': renderRegisterLinkTab,
  };

  const html = tabMap[tabName] ? tabMap[tabName]() : renderStudentsTab();
  vipContent.innerHTML = html;

  document.querySelectorAll('.vip-tab-btn').forEach(button => {
    button.classList.toggle('active', button.dataset.tab === tabName);
  });

  if (tabName === 'reports' || tabName === 'daily') {
    loadVipRegistrations().then(() => {
      vipContent.innerHTML = tabName === 'reports' ? renderReportsTab() : renderDailyTab();
      bindVipReportFilters(tabName);
    });
    bindVipReportFilters(tabName);
  }

  if (tabName === 'sales') {
    loadVipRegistrations().then(() => {
      vipContent.innerHTML = renderSalesTab();
    });
  }

  if (tabName === 'students') {
    loadVipRegistrations().then(() => {
      vipContent.innerHTML = renderStudentsTab();
      bindStudentsRefresh();
    });
    bindStudentsRefresh();
  }

  if (tabName === 'registrations') {
    loadVipRegistrations().then(() => {
      const body = document.getElementById('vip-regs-body');
      if (body) body.innerHTML = buildRegistrationsRows();
      bindRegistrationsEvents();
    });
  }

  if (tabName === 'register-link') {
    const copyBtn = document.getElementById('vip-copy-link-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const urlInput = document.getElementById('vip-portal-url-input');
        try {
          await navigator.clipboard.writeText(urlInput.value);
          copyBtn.textContent = 'تم النسخ ✔️';
          copyBtn.style.background = '#22c55e';
          setTimeout(() => {
            copyBtn.innerHTML = '&#128203; نسخ';
            copyBtn.style.background = '';
          }, 2000);
        } catch (e) {
          prompt('انسخ الرابط:', urlInput.value);
        }
      });
    }
  }

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
        teacherId: vipSessionProfile?.id || '',
        assignedTeacher: vipSessionProfile?.name || vipAssignedTeacher || '',
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
  const identity = vipTeacherInput.value.trim();
  const password = vipPasswordInput.value;
  if (!identity || !password) {
    showVipNotification('\u0623\u062f\u062e\u0644 \u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645 \u0648\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631.', 'error');
    return;
  }
  try {
    const settings = await loadVipAccessSettings();
    const expectedTeacher = String(settings.vipAssignedTeacher || '').trim();
    if (!expectedTeacher || identity.toLocaleLowerCase() !== expectedTeacher.toLocaleLowerCase()) {
      throw new Error('\u0627\u0633\u0645 \u0627\u0644\u0623\u0633\u062a\u0627\u0630 \u0644\u0627 \u064a\u0637\u0627\u0628\u0642 \u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0645\u062d\u0641\u0648\u0638 \u0641\u064a \u0625\u0639\u062f\u0627\u062f\u0627\u062a VIP.');
    }
    if (!vipPasswordHash || await hashVipPassword(password) !== vipPasswordHash) {
      throw new Error('\u0643\u0644\u0645\u0629 \u0645\u0631\u0648\u0631 VIP \u063a\u064a\u0631 \u0635\u062d\u064a\u062d\u0629.');
    }
    // VIP credentials are configured in Settings, not Firebase Authentication.
    // Keep the employee's default Firebase session untouched.
    const normalizedTeacher = expectedTeacher.toLocaleLowerCase();
    vipSessionProfile = {
      id: `vip-name:${normalizedTeacher}`,
      name: expectedTeacher,
      username: expectedTeacher,
      email: '',
      type: 'VIP',
      isManager: false
    };
    vipAssignedTeacher = vipSessionProfile.name;
    startVipSession();
    vipTeacherInput.value = '';
    vipPasswordInput.value = '';
    renderTab('students');
    refreshVipSales();
  } catch (error) {
    console.error('\u062a\u0639\u0630\u0631 \u062a\u0633\u062c\u064a\u0644 \u062f\u062e\u0648\u0644 VIP:', error);
    const message = error.message || '\u062a\u0639\u0630\u0631 \u0627\u0644\u062a\u062d\u0642\u0642 \u0645\u0646 \u0628\u064a\u0627\u0646\u0627\u062a VIP.';
    showVipNotification(message, 'error');
  }
}

vipEnterBtn.addEventListener('click', unlockVipPage);
vipPasswordInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') unlockVipPage();
});
document.getElementById('vip-cancel-btn').addEventListener('click', () => {
  vipTeacherInput.value = '';
  vipPasswordInput.value = '';
});
document.getElementById('vip-forgot-password-btn').addEventListener('click', () => {
  showVipNotification('\u0627\u0633\u062a\u0631\u062f\u0627\u062f \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u064a\u062a\u0645 \u0645\u0646 \u062e\u0644\u0627\u0644 \u062d\u0633\u0627\u0628 \u0627\u0644\u0628\u0631\u0646\u0627\u0645\u062c \u0623\u0648 \u0628\u0648\u0627\u0637\u0629 \u0627\u0644\u0645\u062f\u064a\u0631.', 'info');
});
document.getElementById('vip-cancel-recovery-btn').addEventListener('click', () => {
  document.getElementById('vip-recovery-panel').classList.add('hidden');
});
document.getElementById('vip-recover-password-btn').addEventListener('click', () => {
  showVipNotification('\u063a\u064a\u0651\u0631 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0645\u0646 \u0625\u062f\u0627\u0631\u0629 \u062d\u0633\u0627\u0628\u0643 \u0641\u064a \u0627\u0644\u0628\u0631\u0646\u0627\u0645\u062c\u061b \u0644\u0627 \u064a\u0645\u0643\u0646 \u062a\u0639\u064a\u064a\u0646 \u0643\u0644\u0645\u0629 \u0645\u0631\u0648\u0631 \u0645\u0646\u0641\u0635\u0644\u0629 \u0644\u0640VIP.', 'info');
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
