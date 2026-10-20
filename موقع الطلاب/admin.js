import { auth, db } from '../src_frontend/js/firebase.js';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence, browserSessionPersistence } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { collection, doc, getDocs, runTransaction, Timestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const loginPanel = document.getElementById('login-panel');
const dashboardPanel = document.getElementById('dashboard-panel');
const adminSidebar = document.getElementById('admin-sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const loginError = document.getElementById('login-error');
const agentsList = document.getElementById('agents-list');
const studentsBody = document.getElementById('students-body');
const agentFilter = document.getElementById('agent-filter');
const portalUrlForm = document.getElementById('portal-url-form');
const portalPublicUrlInput = document.getElementById('portal-public-url');
const portalUrlStatus = document.getElementById('portal-url-status');
const portalPublicUrlKey = 'studentPortalPublicUrl';
const rememberedAdminKey = 'studentPortalAdminRememberedIdentity';
let registrations = [];
let agents = [];
let payments = [];
let signedInUser = null;
let isManager = false;

const showLoginError = (message) => { loginError.textContent = message; loginError.hidden = false; };
const toDate = (value) => value?.toDate ? value.toDate() : value ? new Date(value) : null;
const formatDate = (value) => { const date = toDate(value); return date && !Number.isNaN(date.getTime()) ? date.toLocaleString('ar-EG') : '-'; };
const isToday = (value) => value?.toDate && value.toDate().toDateString() === new Date().toDateString();
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));

function uniquePayments(items) {
  const sorted = [...items].sort((left, right) => {
    const canonical = Number(right.id === right.registrationId) - Number(left.id === left.registrationId);
    if (canonical) return canonical;
    return (toDate(right.paidAt)?.getTime() || 0) - (toDate(left.paidAt)?.getTime() || 0);
  });
  const seen = new Set();
  return sorted.filter(item => {
    if (!item.registrationId) return true;
    if (seen.has(item.registrationId)) return false;
    seen.add(item.registrationId);
    return true;
  });
}

function getAutoDetectedPortalUrl() {
  try {
    const pageUrl = new URL('./index.html', window.location.href);
    pageUrl.hash = '';
    pageUrl.search = '';
    return pageUrl;
  } catch (error) {
    console.error('Failed to get auto-detected portal URL:', error);
    return null;
  }
}

function getStudentPortalBaseUrl() {
  const customUrl = localStorage.getItem(portalPublicUrlKey)?.trim();
  if (customUrl) {
    try {
      const parsed = new URL(customUrl);
      parsed.hash = '';
      parsed.search = '';
      return parsed;
    } catch (e) {
      console.warn('Invalid custom portal URL in localStorage:', e);
    }
  }

  // Automatic URL based on current page location
  const autoUrl = getAutoDetectedPortalUrl();
  if (autoUrl) return autoUrl;

  try {
    return new URL('index.html', window.location.href);
  } catch (e) {
    return new URL('index.html', 'http://localhost/');
  }
}

function updatePortalUrlStatusUI() {
  const customUrl = localStorage.getItem(portalPublicUrlKey)?.trim();
  const activeBaseUrl = getStudentPortalBaseUrl();
  const isCustom = Boolean(customUrl);

  if (portalPublicUrlInput) {
    portalPublicUrlInput.value = isCustom ? customUrl : (activeBaseUrl?.href || '');
  }

  if (!portalUrlStatus) return;

  if (isCustom) {
    portalUrlStatus.innerHTML = `
      <div style="color:#166534;font-weight:bold;">
        ✅ يتم استخدام الرابط المخصص المحفوظ. (اضغط "توليد تلقائي 🔄" للرجوع للرابط التلقائي في أي وقت)
      </div>
    `;
  } else {
    const isFile = window.location.protocol === 'file:';
    portalUrlStatus.innerHTML = `
      <div style="color:#15803d;font-weight:bold;">
        ⚡ الرابط متكوّن وشغال تلقائياً بدون أي إعداد يدوي!
      </div>
      ${isFile ? '<div style="color:#b45309;font-size:13px;margin-top:2px;">💡 ملاحظة: الصفحة مفتوحة كملف محلي (file://). يمكنك تجربة الرابط فوراً بالضغط على "🔗 فتح الرابط". لمسح الـ QR بهواتف الطلاب، افتح النظام من سيرفر أو شبكة المركز.</div>' : ''}
    `;
  }
}
updatePortalUrlStatusUI();

function renderStats() {
  const filtered = agentFilter.value ? registrations.filter(item => item.agentId === agentFilter.value) : registrations;
  document.getElementById('total-students').textContent = filtered.length;
  document.getElementById('paid-students').textContent = filtered.filter(item => item.paymentStatus === 'paid').length;
  document.getElementById('unpaid-students').textContent = filtered.filter(item => item.paymentStatus !== 'paid').length;
  document.getElementById('today-students').textContent = filtered.filter(item => isToday(item.registeredAt)).length;
  const filteredAgentIds = agentFilter.value ? new Set([agentFilter.value]) : null;
  const relevantPayments = uniquePayments(filteredAgentIds ? payments.filter(item => filteredAgentIds.has(item.agentId)) : payments);
  document.getElementById('today-payments').textContent = `${relevantPayments.filter(item => isToday(item.paidAt)).reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2)} ج`;
  document.getElementById('total-payments').textContent = `${relevantPayments.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2)} ج`;
  renderReport();
}

function getReportRows() {
  const from = document.getElementById('report-from').value;
  const to = document.getElementById('report-to').value;
  const reportAgentId = document.getElementById('report-agent-filter').value;
  const method = document.getElementById('report-method').value;
  const search = document.getElementById('report-search').value.trim().toLocaleLowerCase();
  return (reportAgentId ? registrations.filter(item => item.agentId === reportAgentId) : registrations).filter(item => {
    const registeredAt = toDate(item.registeredAt);
    const day = registeredAt && !Number.isNaN(registeredAt.getTime()) ? `${registeredAt.getFullYear()}-${String(registeredAt.getMonth()+1).padStart(2,'0')}-${String(registeredAt.getDate()).padStart(2,'0')}` : '';
    if (from && (!day || day < from)) return false;
    if (to && (!day || day > to)) return false;
    if (method && item.paymentMethod !== method) return false;
    if (search && !`${item.studentName || ''} ${item.phone || ''}`.toLocaleLowerCase().includes(search)) return false;
    return true;
  });
}

function renderReport() {
  const rows = getReportRows();
  const paid = rows.filter(item => item.paymentStatus === 'paid');
  const pending = rows.filter(item => item.paymentStatus !== 'paid');
  const collected = paid.reduce((sum, item) => sum + Number(item.paidAmount || 0), 0);
  document.getElementById('report-total').textContent = rows.length;
  document.getElementById('report-paid').textContent = paid.length;
  document.getElementById('report-pending').textContent = pending.length;
  document.getElementById('report-collected').textContent = `${collected.toLocaleString('ar-EG')} ج`;
  const groups = new Map();
  paid.forEach(item => {
    const method = item.paymentMethod || item.payment || 'غير محدد';
    groups.set(method, (groups.get(method) || 0) + Number(item.paidAmount || 0));
  });
  const breakdown = document.getElementById('payment-breakdown');
  breakdown.innerHTML = groups.size
    ? [...groups.entries()].map(([method, amount]) => `<div><span>${escapeHtml(method)}</span><strong>${amount.toLocaleString('ar-EG')} ج</strong></div>`).join('')
    : '<p class="muted">لا توجد مدفوعات في الفترة المحددة.</p>';

  const agentTotals = new Map();
  paid.forEach(item => {
    const agentId = item.agentId || '';
    const agent = agents.find(entry => entry.id === agentId);
    const name = agent?.fullname || agent?.username || 'غير محدد';
    const current = agentTotals.get(agentId) || { name, count: 0, amount: 0 };
    current.count += 1;
    current.amount += Number(item.paidAmount || 0);
    agentTotals.set(agentId, current);
  });
  const agentBreakdown = document.getElementById('agent-breakdown');
  const agentSection = document.getElementById('agent-report-breakdown');
  if (agentSection) agentSection.hidden = !isManager;
  if (agentBreakdown) {
    agentBreakdown.innerHTML = isManager && agentTotals.size
      ? [...agentTotals.values()].sort((a, b) => b.amount - a.amount).map(item => `<div><span>${escapeHtml(item.name)} · ${item.count} عملية</span><strong>${item.amount.toLocaleString('ar-EG')} ج</strong></div>`).join('')
      : '<p class="muted">لا توجد مدفوعات في الفترة المحددة.</p>';
  }

  const formatInputDate = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString('ar-EG') : '';
  const periodLabel = [formatInputDate(document.getElementById('report-from').value), formatInputDate(document.getElementById('report-to').value)].filter(Boolean);
  const printPeriod = document.getElementById('report-print-period');
  const printAgent = document.getElementById('report-print-agent');
  const printMethod = document.getElementById('report-print-method');
  const printGenerated = document.getElementById('report-print-generated');
  const printRows = document.getElementById('report-print-rows');
  if (printPeriod) printPeriod.textContent = periodLabel.length ? periodLabel.join(' — ') : 'كل الفترات';
  if (printAgent) printAgent.textContent = agents.find(agent => agent.id === document.getElementById('report-agent-filter').value)?.fullname || agents.find(agent => agent.id === document.getElementById('report-agent-filter').value)?.username || 'كل المسؤولين';
  if (printMethod) printMethod.textContent = document.getElementById('report-method').value || 'كل الطرق';
  if (printGenerated) printGenerated.textContent = new Date().toLocaleString('ar-EG');
  if (printRows) printRows.innerHTML = rows.length ? rows.map((item, index) => {
    const agent = agents.find(entry => entry.id === item.agentId);
    const paidStatus = item.paymentStatus === 'paid';
    return `<tr><td>${index + 1}</td><td>${escapeHtml(item.studentName || '-')}</td><td>${escapeHtml(item.phone || '-')}</td><td>${escapeHtml(`${item.grade || '-'} / ${item.studyType || '-'}`)}</td><td>${escapeHtml(agent?.fullname || agent?.username || '-')}</td><td>${escapeHtml(formatDate(item.registeredAt))}</td><td>${escapeHtml(paidStatus ? (item.paymentMethod || item.payment || 'غير محدد') : '-')}</td><td>${paidStatus ? 'تم الدفع' : 'بانتظار الدفع'}</td><td>${paidStatus ? `${Number(item.paidAmount || 0).toLocaleString('ar-EG')} ج` : '0 ج'}</td></tr>`;
  }).join('') : '<tr><td colspan="9">لا توجد نتائج للفلاتر المحددة.</td></tr>';
}

function exportReportPdf() {
  const oldTitle = document.title;
  renderReport();
  document.title = 'تقرير تسجيلات الطلاب والتحصيل';
  window.print();
  window.setTimeout(() => { document.title = oldTitle; }, 1000);
}

function openSidebar() {
  adminSidebar.classList.add('is-open');
  sidebarBackdrop.hidden = false;
  sidebarToggle.setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
  adminSidebar.classList.remove('is-open');
  sidebarBackdrop.hidden = true;
  sidebarToggle.setAttribute('aria-expanded', 'false');
}

function exportReport() {
  const rows = getReportRows();
  const headers = ['الطالب','الهاتف','الفرقة','المسؤول','تاريخ التسجيل','الحالة','طريقة الدفع','المبلغ المحصل'];
  const records = rows.map(item => [item.studentName || '', item.phone || '', `${item.grade || ''} / ${item.studyType || ''}`, agents.find(agent => agent.id === item.agentId)?.fullname || agents.find(agent => agent.id === item.agentId)?.username || '', formatDate(item.registeredAt), item.paymentStatus === 'paid' ? 'تم الدفع' : 'لم يدفع', item.paymentMethod || '', item.paymentStatus === 'paid' ? Number(item.paidAmount || 0) : 0]);
  const csv = [headers, ...records].map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'student-portal-report.csv'; link.click(); URL.revokeObjectURL(url);
}

function renderAgents() {
  agentFilter.innerHTML = '<option value="">كل المسؤولين</option>';
  const reportAgentFilter = document.getElementById('report-agent-filter');
  if (reportAgentFilter) {
    const selectedAgentId = reportAgentFilter.value;
    reportAgentFilter.innerHTML = '<option value="">كل المسؤولين</option>';
    agents.forEach(agent => {
      const option = document.createElement('option');
      option.value = agent.id;
      option.textContent = agent.fullname || agent.username || 'مسؤول';
      reportAgentFilter.appendChild(option);
    });
    reportAgentFilter.value = selectedAgentId;
  }
  agentsList.innerHTML = agents.length ? '' : '<p>لا يوجد مسؤولون مفعلون.</p>';
  let portalBaseUrl = null;
  try {
    portalBaseUrl = getStudentPortalBaseUrl();
  } catch (error) {
    console.error('Invalid student portal URL:', error);
  }

  updatePortalUrlStatusUI();

  agents.forEach(agent => {
    let link = '';
    if (portalBaseUrl) {
      try {
        const portalUrl = new URL(portalBaseUrl.href);
        portalUrl.searchParams.set('agent', agent.id);
        link = portalUrl.href;
      } catch (e) {
        link = `${portalBaseUrl.href}?agent=${encodeURIComponent(agent.id)}`;
      }
    }
    const qr = link ? `https://api.qrserver.com/v1/create-qr-code/?size=600x600&format=png&data=${encodeURIComponent(link)}` : '';
    const card = document.createElement('article');
    card.className = 'agent-card';
    card.innerHTML = `
      <h3>${escapeHtml(agent.fullname || agent.username || 'مسؤول')}</h3>
      <div>اسم المستخدم: <strong>${escapeHtml(agent.username || '-')}</strong></div>
      <div>كود التسجيل: <strong>${escapeHtml(agent.studentPortalCode || agent.username || agent.id)}</strong></div>
      <div style="margin-top:4px;">عدد الطلاب المسجلين: <strong style="color:#166534;">${registrations.filter(item => item.agentId === agent.id).length}</strong></div>
      ${link ? `
        <img class="agent-qr" src="${qr}" alt="QR ${escapeHtml(agent.studentPortalCode || agent.username || '')}" loading="lazy">
        <code title="${escapeHtml(link)}">${escapeHtml(link)}</code>
        <div class="agent-actions">
          <button class="copy-link" data-link="${escapeHtml(link)}">📋 نسخ الرابط</button>
          <button class="save-qr secondary-button" data-qr="${escapeHtml(qr)}" data-name="${escapeHtml(agent.username || 'agent')}">حفظ QR على الهاتف</button>
          <button class="share-link secondary-button" data-link="${escapeHtml(link)}">مشاركة الرابط</button>
          <a href="${escapeHtml(link)}" target="_blank" rel="noopener" class="secondary-button open-link">🔗 فتح الرابط</a>
        </div>
      ` : '<p style="color:#b42318;">تعذر تكوين رابط صالح.</p>'}
    `;
    agentsList.appendChild(card);
    const option = document.createElement('option');
    option.value = agent.id;
    option.textContent = agent.fullname || agent.username || agent.id;
    agentFilter.appendChild(option);
  });

  agentsList.querySelectorAll('.copy-link').forEach(button => button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.link);
      const originalText = button.textContent;
      button.textContent = 'تم النسخ ✔️';
      button.style.background = '#22c55e';
      button.style.color = '#fff';
      setTimeout(() => {
        button.textContent = originalText;
        button.style.background = '';
        button.style.color = '';
      }, 2000);
    } catch (e) {
      prompt('انسخ الرابط:', button.dataset.link);
    }
  }));

  agentsList.querySelectorAll('.save-qr').forEach(button => button.addEventListener('click', async () => {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'جاري تجهيز الصورة...';
    try {
      const response = await fetch(button.dataset.qr, { mode: 'cors' });
      if (!response.ok) throw new Error('تعذر تنزيل QR');
      const blob = await response.blob();
      const file = new File([blob], `student-portal-${button.dataset.name}.png`, { type: blob.type || 'image/png' });
      if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ title: 'QR بوابة الطلاب', files: [file] });
      } else {
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href = objectUrl; link.download = file.name; link.click();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        button.textContent = 'تم الحفظ ✔️';
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        window.open(button.dataset.qr, '_blank', 'noopener');
        alert('فتحنا صورة QR بالحجم الكامل. اضغط مطولًا عليها واختر حفظ الصورة على الهاتف.');
      }
    } finally {
      button.disabled = false;
      setTimeout(() => { button.textContent = original; }, 2200);
    }
  }));

  agentsList.querySelectorAll('.share-link').forEach(button => button.addEventListener('click', async () => {
    const url = button.dataset.link;
    try {
      if (navigator.share) await navigator.share({ title: 'رابط تسجيل الطلاب', text: 'سجّل بيانات الطالب من هذا الرابط', url });
      else { await navigator.clipboard.writeText(url); alert('تم نسخ رابط التسجيل للمشاركة.'); }
    } catch (error) {
      if (error.name !== 'AbortError') prompt('انسخ رابط التسجيل:', url);
    }
  }));
}

portalUrlForm.addEventListener('submit', event => {
  event.preventDefault();
  const value = portalPublicUrlInput.value.trim();
  try {
    if (value) {
      new URL(value);
      localStorage.setItem(portalPublicUrlKey, value);
    } else {
      localStorage.removeItem(portalPublicUrlKey);
    }
    renderAgents();
  } catch (error) {
    alert('يرجى إدخال رابط صحيح يبدأ بـ http:// أو https://');
  }
});

const resetPortalUrlBtn = document.getElementById('reset-portal-url-btn');
if (resetPortalUrlBtn) {
  resetPortalUrlBtn.addEventListener('click', () => {
    localStorage.removeItem(portalPublicUrlKey);
    renderAgents();
  });
}

function renderStudents() {
  const names = new Map(agents.map(agent => [agent.id, agent.fullname || agent.username || '-']));
  const searchTerm = document.getElementById('registration-search')?.value.trim().toLocaleLowerCase() || '';
  const normalizeDigits = value => String(value).replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776));
  const normalizedSearch = normalizeDigits(searchTerm);
  const searchDigits = normalizedSearch.replace(/\D/g, '');
  const filtered = registrations.filter(item => {
    if (agentFilter.value && item.agentId !== agentFilter.value) return false;
    if (!normalizedSearch) return true;
    const searchable = normalizeDigits(`${item.studentName || ''} ${item.phone || ''} ${item.grade || ''} ${item.studyType || ''}`).toLocaleLowerCase();
    const phoneDigits = normalizeDigits(item.phone || '').replace(/\D/g, '');
    const phoneQuery = /^[\d\s()+-]+$/.test(normalizedSearch);
    return searchable.includes(normalizedSearch) || (phoneQuery && searchDigits && phoneDigits.includes(searchDigits));
  });
  studentsBody.innerHTML = filtered.length ? '' : '<tr><td colspan="8">لا توجد تسجيلات.</td></tr>';
  filtered.forEach(item => {
    const row = document.createElement('tr');
    const legacyMethod = item.paymentMethod && !['نقدي', 'فودافون كاش', 'تقسيط'].includes(item.paymentMethod)
      ? `<option value="${escapeHtml(item.paymentMethod)}" selected>${escapeHtml(item.paymentMethod)}</option>` : '';
    row.innerHTML = `<td data-label="الطالب">${escapeHtml(item.studentName || '-')}</td><td data-label="الهاتف">${escapeHtml(item.phone || '-')}</td><td data-label="الفرقة">${escapeHtml(item.grade || '-')} / ${escapeHtml(item.studyType || '-')}</td><td data-label="المسؤول">${escapeHtml(names.get(item.agentId) || '-')}</td><td data-label="التسجيل">${escapeHtml(formatDate(item.registeredAt))}</td><td data-label="المبلغ المحصل"><input class="payment-amount" type="number" min="0" step="0.01" value="${Number(item.paidAmount ?? item.requestedAmount ?? 0) || ''}" data-id="${escapeHtml(item.id)}" placeholder="المبلغ"></td><td data-label="طريقة الدفع"><select class="payment-method-select" data-id="${escapeHtml(item.id)}"><option value="">اختر الطريقة</option><option value="نقدي" ${item.paymentMethod === 'نقدي' ? 'selected' : ''}>نقدي</option><option value="فودافون كاش" ${item.paymentMethod === 'فودافون كاش' ? 'selected' : ''}>فودافون كاش</option><option value="تقسيط" ${item.paymentMethod === 'تقسيط' ? 'selected' : ''}>تقسيط</option>${legacyMethod}</select></td><td class="payment-actions" data-label="حالة الدفع"><select class="status-select ${item.paymentStatus === 'paid' ? 'status-paid' : 'status-unpaid'}" data-id="${escapeHtml(item.id)}"><option value="unpaid" ${item.paymentStatus !== 'paid' ? 'selected' : ''} ${item.paymentStatus === 'paid' ? 'disabled' : ''}>لم يدفع</option><option value="paid" ${item.paymentStatus === 'paid' ? 'selected' : ''}>تم الدفع</option></select><button class="save-payment" data-id="${escapeHtml(item.id)}">${item.paymentStatus === 'paid' ? 'حفظ التعديل' : 'تسجيل الدفع'}</button></td>`;
    studentsBody.appendChild(row);
  });
  studentsBody.querySelectorAll('.save-payment').forEach(button => button.addEventListener('click', async () => {
    const id = button.dataset.id;
    const row = button.closest('tr');
    const status = row.querySelector('.status-select').value;
    const amount = Number(row.querySelector('.payment-amount').value || 0);
    const paymentMethod = row.querySelector('.payment-method-select').value;
    const registration = registrations.find(item => item.id === id);
    if (status !== 'paid') { alert('اختر «تم الدفع» بعد استلام المبلغ.'); return; }
    if (!paymentMethod) { alert('اختر طريقة الدفع أولاً.'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { alert('أدخل المبلغ الذي تم تحصيله.'); return; }
    button.disabled = true;
    try {
      const wasAlreadyPaid = registration?.paymentStatus === 'paid';
      const registrationRef = doc(db, 'studentRegistrations', id);
      const paymentRef = doc(db, 'studentPortalPayments', id);
      const paidAt = Timestamp.now();
      await runTransaction(db, async transaction => {
        const currentSnapshot = await transaction.get(registrationRef);
        if (!currentSnapshot.exists()) throw new Error('التسجيل غير موجود. حدّث الصفحة وحاول مرة أخرى.');
        const current = currentSnapshot.data();
        if (current.paymentStatus === 'paid' && !wasAlreadyPaid) throw new Error('تم اعتماد الدفع من مستخدم آخر بالفعل. حدّث الصفحة للمراجعة.');
        transaction.update(registrationRef, { paymentStatus: 'paid', paidAmount: amount, paymentMethod, payment: paymentMethod, paidAt });
        transaction.set(paymentRef, {
          registrationId: id,
          invoiceNumber: current.invoiceNumber || null,
          agentId: current.agentId || registration?.agentId || '-',
          studentName: current.studentName || registration?.studentName || '-',
          amount,
          paymentMethod,
          payment: paymentMethod,
          paidAt,
          source: 'student-portal-admin',
          recordedBy: signedInUser?.id || signedInUser?.email || '-'
        });
      });
      await loadData();
    } catch (error) {
      console.error('Could not save student portal payment:', error);
      alert(error.message || 'تعذر حفظ الدفع. تحقق من الاتصال وحاول مرة أخرى.');
      button.disabled = false;
    }
  }));
}

async function loadData() {
  const [usersSnapshot, registrationsSnapshot, paymentsSnapshot] = await Promise.all([getDocs(collection(db, 'users')), getDocs(collection(db, 'studentRegistrations')), getDocs(collection(db, 'studentPortalPayments'))]);
  const allAgents = usersSnapshot.docs.map(item => ({ id: item.id, ...item.data() })).filter(item => item.active !== false && item.studentPortalEnabled !== false);
  agents = isManager ? allAgents : allAgents.filter(item => item.id === signedInUser.id);
  const agentIds = new Set(agents.map(item => item.id));
  registrations = registrationsSnapshot.docs.map(item => ({ id: item.id, ...item.data() })).filter(item => agentIds.has(item.agentId)).sort((a, b) => (b.registeredAt?.seconds || 0) - (a.registeredAt?.seconds || 0));
  const registrationIds = new Set(registrations.map(item => item.id));
  payments = uniquePayments(paymentsSnapshot.docs.map(item => ({ id: item.id, ...item.data() }))
    .filter(item => agentIds.has(item.agentId) && (!item.registrationId || registrationIds.has(item.registrationId))));
  renderAgents(); renderStudents(); renderStats();
}

document.getElementById('admin-login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const identity = document.getElementById('admin-email').value.trim();
    const email = identity.includes('@') ? identity : `${identity}@lookcenter.com`;
    const rememberMe = document.getElementById('admin-remember-me').checked;
    await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
    await signInWithEmailAndPassword(auth, email, document.getElementById('admin-password').value);
    if (rememberMe) localStorage.setItem(rememberedAdminKey, identity);
    else localStorage.removeItem(rememberedAdminKey);
  } catch (error) {
    console.error('Portal login failed:', error.code, error);
    const messages = {
      'auth/user-not-found': 'اسم المستخدم غير موجود.',
      'auth/wrong-password': 'كلمة المرور غير صحيحة.',
      'auth/invalid-credential': 'اسم المستخدم أو كلمة المرور غير صحيحة.',
      'auth/invalid-login-credentials': 'اسم المستخدم أو كلمة المرور غير صحيحة.',
      'auth/invalid-email': 'اسم المستخدم أو البريد غير صحيح.',
      'auth/too-many-requests': 'تم إيقاف المحاولات مؤقتًا. انتظر قليلًا ثم حاول مرة أخرى.',
      'auth/network-request-failed': 'تعذر الاتصال بخدمة تسجيل الدخول. تحقق من الإنترنت.'
    };
    showLoginError(messages[error.code] || `تعذر تسجيل الدخول (${error.code || 'unknown-error'}).`);
  }
});

const rememberedAdminIdentity = localStorage.getItem(rememberedAdminKey);
if (rememberedAdminIdentity) {
  document.getElementById('admin-email').value = rememberedAdminIdentity;
  document.getElementById('admin-remember-me').checked = true;
}

document.getElementById('sidebar-logout').addEventListener('click', () => signOut(auth));
document.querySelectorAll('.sidebar-link[href]').forEach(link => link.addEventListener('click', closeSidebar));
sidebarToggle.addEventListener('click', () => adminSidebar.classList.contains('is-open') ? closeSidebar() : openSidebar());
sidebarBackdrop.addEventListener('click', closeSidebar);
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeSidebar(); });
document.getElementById('refresh-button').addEventListener('click', loadData);
agentFilter.addEventListener('change', () => { renderStudents(); renderStats(); });
document.getElementById('registration-search')?.addEventListener('input', renderStudents);
['report-from', 'report-to', 'report-method', 'report-search'].forEach(id => {
  document.getElementById(id).addEventListener('input', renderReport);
  document.getElementById(id).addEventListener('change', renderReport);
});
document.getElementById('export-report').addEventListener('click', exportReport);
document.getElementById('export-report-pdf')?.addEventListener('click', exportReportPdf);
document.getElementById('report-agent-filter').addEventListener('change', renderReport);
document.getElementById('clear-report-filters').addEventListener('click', () => {
  ['report-from', 'report-to', 'report-agent-filter', 'report-method', 'report-search'].forEach(id => { document.getElementById(id).value = ''; });
  renderReport();
});
onAuthStateChanged(auth, async (user) => {
  if (!user) { loginPanel.hidden = false; dashboardPanel.hidden = true; return; }
  const userRecord = (await getDocs(collection(db, 'users'))).docs
    .map(item => item.data())
    .find(item => item.email?.toLowerCase() === user.email?.toLowerCase());
  if (!userRecord) {
    await signOut(auth);
    showLoginError('تم تسجيل الدخول في Firebase، لكن لا يوجد سجل لهذا البريد داخل users.');
    return;
  }
  if (userRecord.active === false) {
    await signOut(auth);
    showLoginError('هذا المستخدم معطل. فعّله من صفحة إدارة المستخدمين أولًا.');
    return;
  }
  const userRecordSnapshot = (await getDocs(collection(db, 'users'))).docs.find(item => item.data().email === user.email);
  signedInUser = { id: userRecordSnapshot.id, ...userRecord };
  isManager = userRecord.type === 'مدير';
  document.getElementById('portal-title').textContent = isManager ? 'إدارة بوابة الطلاب' : `لوحة ${userRecord.fullname || userRecord.username || 'المستخدم'}`;
  const pageTitles = { overview: 'الرئيسية', registrations: 'تسجيلات الطلاب', reports: 'التقارير' };
  document.getElementById('current-view-title').textContent = pageTitles[document.body.dataset.page] || 'الرئيسية';
  if (!isManager) {
    document.getElementById('agent-filter-label').hidden = true;
    document.getElementById('report-agent-filter-label').hidden = true;
  }
  document.querySelector('#dashboard-panel .eyebrow')?.remove();
  loginPanel.hidden = true; dashboardPanel.hidden = false;
  await loadData();
});
