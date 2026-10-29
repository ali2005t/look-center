import { db } from '../src_frontend/js/firebase.js';
import { collection, doc, getDoc, getDocs, query, where, runTransaction, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const byId = id => document.getElementById(id);
const dashboard = byId('dashboard');
const teacherSessionKey = 'vipTeacherVerifiedSession';
let teacher = null;
let registrations = [];
const storedTeacherSession = sessionStorage.getItem(teacherSessionKey);
try {
  const session = storedTeacherSession ? JSON.parse(storedTeacherSession) : null;
  const sessionAge = Date.now() - Number(session?.authenticatedAt || 0);
  if (session?.id && session?.name && Number.isFinite(sessionAge) && sessionAge >= 0 && sessionAge < 12 * 60 * 60 * 1000) {
    teacher = { id: session.id, name: session.name, isManager: false };
  } else {
    sessionStorage.removeItem(teacherSessionKey);
  }
} catch {
  sessionStorage.removeItem(teacherSessionKey);
}

async function hashPassword(password) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function safeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
}

function isDeletedVipInvoiceRegistration(registrationDoc, invoiceDocs) {
  const registration = registrationDoc.data();
  const invoiceId = String(registration.invoiceId || '');
  if (!invoiceId) return false;
  return !invoiceDocs.some(invoiceDoc => invoiceDoc.id === invoiceId
    || String(invoiceDoc.data().vipRegistrationId || '') === registrationDoc.id);
}

function nextAvailableVipInvoiceNumber(invoiceDocs, vipRegistrationDocs, regularRegistrationDocs) {
  const usedNumbers = new Set();
  invoiceDocs.forEach(invoiceDoc => {
    const number = Number(invoiceDoc.data().num);
    if (Number.isInteger(number) && number > 0) usedNumbers.add(number);
  });
  regularRegistrationDocs.forEach(registrationDoc => {
    const number = Number(registrationDoc.data().invoiceNumber);
    if (Number.isInteger(number) && number > 0) usedNumbers.add(number);
  });
  vipRegistrationDocs.forEach(registrationDoc => {
    const registration = registrationDoc.data();
    if (isDeletedVipInvoiceRegistration(registrationDoc, invoiceDocs)) return;
    const linkedInvoice = invoiceDocs.find(invoiceDoc => invoiceDoc.id === String(registration.invoiceId || '')
      || String(invoiceDoc.data().vipRegistrationId || '') === registrationDoc.id
      || invoiceDoc.id === `vip_${registrationDoc.id}`);
    const linkedInvoiceNumber = Number(linkedInvoice?.data().num);
    if (Number.isInteger(linkedInvoiceNumber) && linkedInvoiceNumber > 0) return;
    const number = Number(registration.invoiceNumber);
    if (Number.isInteger(number) && number > 0) usedNumbers.add(number);
  });
  let nextNumber = 1;
  while (usedNumbers.has(nextNumber)) nextNumber += 1;
  return nextNumber;
}

function renderRegistrationLink() {
  const button = byId("show-vip-qr");
  if (!button || !teacher) return;
  button.onclick = () => {
    const overlay = byId("teacher-qr-overlay");
    const content = byId("teacher-qr-content");
    overlay.style.display = "flex";
    const url = new URL("../%D9%85%D9%88%D9%82%D8%B9%20%D8%A7%D9%84%D8%B7%D9%84%D8%A7%D8%A8/vip-portal.html", window.location.href);
    url.searchParams.set("teacher", teacher.id);
    const link = url.href;
    const qr = "https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=" + encodeURIComponent(link);
    content.innerHTML = "<img src=\"" + qr + "\" alt=\"QR VIP\"><p><b>QR VIP</b></p><input id=\"vip-registration-url\" readonly value=\"" + safeText(link) + "\" style=\"width:100%;direction:ltr\"><button id=\"vip-copy-registration-link\" type=\"button\">\u0646\u0633\u062e \u0631\u0627\u0628\u0637 \u0627\u0644\u062a\u0633\u062c\u064a\u0644</button>";
    byId("vip-copy-registration-link").onclick = async () => {
      try { await navigator.clipboard.writeText(link); byId("vip-copy-registration-link").textContent = "\u062a\u0645 \u0627\u0644\u0646\u0633\u062e"; }
      catch { const input = byId("vip-registration-url"); input.select(); document.execCommand("copy"); }
    };
  };
}
byId("close-teacher-qr").addEventListener("click", () => { byId("teacher-qr-overlay").style.display = "none"; });
byId("teacher-qr-overlay").addEventListener("click", event => { if (event.target.id === "teacher-qr-overlay") event.currentTarget.style.display = "none"; });
function formatMoney(value) { return Number(value || 0).toLocaleString('ar-EG') + ' \u062c'; }
function selectedMode(item, invoiceAmount, paidNow) {
  if (item.paymentStatus === 'paid') {
    const savedMode = item.teacherReportedPaymentMode || item.vipPaymentMode;
    if (['full', 'installment', 'free'].includes(savedMode)) return savedMode;
    if (item.payment === '\u062a\u0642\u0633\u064a\u0637' || item.paymentMethod === '\u062a\u0642\u0633\u064a\u0637' || item.installment?.remaining > 0) return 'installment';
    if (item.payment === '\u0645\u062c\u0627\u0646\u064a' || item.paymentMethod === '\u0645\u062c\u0627\u0646\u064a') return 'free';
    return Number(invoiceAmount) === 0 && Number(paidNow || 0) === 0 ? 'free' : 'full';
  }
  if (Number(invoiceAmount) <= 0) return 'free';
  if (['full', 'installment', 'free'].includes(item.teacherReportedPaymentMode)) return item.teacherReportedPaymentMode;
  if (paidNow > 0) return 'full';
  return 'full';
}
function applyChargeMode(row, mode) {
  const paidInput = row.querySelector('.paid-now');
  if (mode === 'free') {
    paidInput.value = '0';
  } else if (mode === 'full') paidInput.value = row.querySelector('.invoice-amount').value;
  updateRemaining(row);
}
async function loadRequests() {
  if (!teacher) return;
  const body = byId('requests');
  body.innerHTML = '<p class="card muted empty-state">\u062c\u0627\u0631\u064d \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0637\u0644\u0628\u0627\u062a...</p>';
  try {
    const snapshot = await getDocs(collection(db, 'vipRegistrations'));
    registrations = snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
      .filter(item => teacher.isManager || item.teacherId === teacher.id || String(item.teacherName || '').trim().toLocaleLowerCase() === teacher.name.toLocaleLowerCase())
      .sort((a, b) => (b.registeredAt?.seconds || 0) - (a.registeredAt?.seconds || 0));
    const pending = registrations.filter(item => item.paymentStatus !== 'paid');
    const totalPaid = registrations.reduce((sum, item) => sum + (item.paymentStatus === 'paid' ? Number(item.amountCollected ?? item.paidAmount ?? 0) : 0), 0);
    byId('count-all').textContent = registrations.length;
    byId('count-pending').textContent = pending.length;
    byId('total-paid').textContent = formatMoney(totalPaid);
    body.innerHTML = registrations.length ? registrations.map(item => {
      const items = Array.isArray(item.selectedSubscriptions) ? item.selectedSubscriptions : [];
      const isPaid = item.paymentStatus === 'paid';
      const selectedAmount = items.reduce((sum, sub) => sum + Number(sub.price || 0), 0);
      const requestedAmount = Number(item.requestedAmount) > 0 ? Number(item.requestedAmount) : selectedAmount;
      const invoiceAmount = requestedAmount;
      const hasRecordedPaid = item.teacherReportedPaidAmount !== undefined
        || item.amountCollected !== undefined
        || item.paidAmount !== undefined;
      const recordedPaid = Number(item.teacherReportedPaidAmount ?? item.amountCollected ?? item.paidAmount ?? (isPaid ? invoiceAmount : 0));
      const mode = selectedMode(item, invoiceAmount, recordedPaid);
      const paidNow = mode === 'free' ? 0 : hasRecordedPaid ? recordedPaid : (mode === 'installment' ? 0 : invoiceAmount);
      const remaining = mode === 'installment' ? Number(item.installment?.remaining ?? Math.max(0, invoiceAmount - paidNow)) : 0;
      const date = item.registeredAt?.toDate ? item.registeredAt.toDate().toLocaleString('ar-EG') : '\u2014';
      let state = '\u0628\u0627\u0646\u062a\u0638\u0627\u0631 \u0627\u0639\u062a\u0645\u0627\u062f \u0627\u0644\u0628\u0631\u0646\u0627\u0645\u062c';
      if (isPaid && mode === 'free') state = '\u0645\u062c\u0627\u0646\u064a \u00b7 \u0645\u0639\u062a\u0645\u062f';
      else if (isPaid && mode === 'installment') state = '\u062a\u0642\u0633\u064a\u0637 \u00b7 \u0645\u062a\u0628\u0642\u064a ' + formatMoney(remaining);
      else if (isPaid) state = '\u0645\u062f\u0641\u0648\u0639 \u0628\u0627\u0644\u0643\u0627\u0645\u0644';
      const subHtml = items.length ? items.map(sub => '<div class="subscription-item"><strong>' + safeText(sub.name || '\u2014') + '</strong><div class="muted">' + safeText(sub.type || '') + ' \u00b7 ' + formatMoney(sub.price) + '</div></div>').join('') : '<p class="error">\u062a\u0641\u0627\u0635\u064a\u0644 \u0627\u0644\u0627\u0634\u062a\u0631\u0627\u0643 \u063a\u064a\u0631 \u0645\u062d\u0641\u0648\u0638\u0629</p>';
      const radioName = 'mode-' + safeText(item.id);
      return '<article class="request-card" data-id="' + safeText(item.id) + '">' +
        '<div class="student-head"><div><h3>' + safeText(item.studentName || '\u2014') + '</h3><div class="student-contact">' + safeText(item.phone || '\u2014') + '</div></div><span class="grade-pill">' + safeText(item.grade || '\u2014') + ' / ' + safeText(item.studyType || '\u2014') + '</span></div>' +
        '<div class="request-meta"><span>\u0627\u0644\u0627\u0633\u062a\u0627\u0630: ' + safeText(item.teacherName || teacher.name) + '</span><span>' + safeText(date) + '</span></div>' +
        '<div class="subscription-list">' + subHtml + '</div><div class="request-meta"><span>\u0627\u0644\u0633\u0639\u0631 \u0627\u0644\u0623\u0635\u0644\u064a \u0644\u0644\u0627\u0634\u062a\u0631\u0627\u0643: ' + formatMoney(item.requestedAmount) + '</span><span class="state-pill ' + (isPaid ? 'approved' : '') + '">' + state + '</span></div>' +
        '<div class="payment-editor"><strong>\u062d\u062f\u062f \u062d\u0627\u0644\u0629 \u0627\u0644\u062f\u0641\u0639</strong><div class="payment-mode">' +
        '<label class="mode-option"><input class="charge-mode" type="radio" name="' + radioName + '" value="full" ' + (mode === 'full' ? 'checked' : '') + ' ' + (isPaid ? 'disabled' : '') + '><span>\u062f\u0641\u0639 \u0643\u0627\u0645\u0644</span></label>' +
        '<label class="mode-option"><input class="charge-mode" type="radio" name="' + radioName + '" value="installment" ' + (mode === 'installment' ? 'checked' : '') + ' ' + (isPaid ? 'disabled' : '') + '><span>\u062a\u0642\u0633\u064a\u0637</span></label>' +
        '<label class="mode-option free"><input class="charge-mode" type="radio" name="' + radioName + '" value="free" ' + (mode === 'free' ? 'checked' : '') + ' ' + (isPaid ? 'disabled' : '') + '><span>\u0645\u062c\u0627\u0646\u064a</span></label></div>' +
        '<div class="amount-grid"><label class="amount-field">\u0633\u0639\u0631 \u0627\u0644\u0627\u0634\u062a\u0631\u0627\u0643 \u0627\u0644\u0623\u0633\u0627\u0633\u064a<input class="invoice-amount" type="number" min="0" step="0.01" data-requested-amount="' + safeText(requestedAmount) + '" value="' + safeText(invoiceAmount) + '" readonly ' + (isPaid ? 'disabled' : '') + '></label>' +
        '<label class="amount-field">\u0627\u0644\u0645\u062f\u0641\u0648\u0639 \u0627\u0644\u0622\u0646<input class="paid-now" type="number" min="0" step="0.01" placeholder="\u0627\u0643\u062a\u0628 \u0645\u0628\u0644\u063a \u0627\u0644\u062f\u0641\u0639\u0629" value="' + safeText(mode === 'free' ? 0 : (mode === 'installment' && !hasRecordedPaid ? '' : paidNow)) + '" ' + (isPaid ? 'disabled' : '') + '></label>' +
        '<label class="amount-field">\u0627\u0644\u0645\u062a\u0628\u0642\u064a<output class="remaining-amount">' + formatMoney(remaining) + '</output></label></div>' +
        '<div class="request-actions">' +
        (isPaid ? '<button class="edit-approved secondary" ' + (!items.length ? 'disabled' : '') + '>\u062a\u0639\u062f\u064a\u0644 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629 \u0627\u0644\u0633\u0627\u0628\u0642\u0629</button>' : '') +
        '<button class="save-amount secondary" ' + (isPaid ? 'hidden disabled' : !items.length ? 'disabled' : '') + '>\u062d\u0641\u0638 \u0627\u0644\u0645\u0628\u0627\u0644\u063a</button>' +
        '<button class="approve-payment" ' + (isPaid ? 'hidden disabled' : !items.length ? 'disabled' : '') + '>\u0627\u0639\u062a\u0645\u0627\u062f \u0627\u0644\u062f\u0641\u0639 \u0648\u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629</button></div></div></article>';
    }).join('') : '<p class="card empty-state">\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u0645\u0631\u062a\u0628\u0637\u0629 \u0628\u062d\u0633\u0627\u0628\u0643.</p>';
    body.querySelectorAll('.charge-mode').forEach(input => input.addEventListener('change', () => applyChargeMode(input.closest('.request-card'), input.value)));
    body.querySelectorAll('.paid-now').forEach(input => input.addEventListener('input', () => {
      const row = input.closest('.request-card');
      if (row.querySelector('.charge-mode:checked')?.value === 'free' && Number(input.value) > 0) {
        row.querySelector('.charge-mode[value="full"]').checked = true;
      }
      updateRemaining(row);
    }));
    body.querySelectorAll('.save-amount').forEach(button => button.addEventListener('click', () => saveAmount(button)));
    body.querySelectorAll('.edit-approved').forEach(button => button.addEventListener('click', () => editApprovedInvoice(button)));
    body.querySelectorAll('.approve-payment').forEach(button => button.addEventListener('click', () => approvePayment(button)));
    renderReports();
  } catch (err) {
    console.error(err);
    body.innerHTML = '<p class="card error empty-state">\u062a\u0639\u0630\u0631 \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0637\u0644\u0628\u0627\u062a. ' + safeText(err.message) + '</p>';
  }
}
function updateRemaining(row) {
  const totalRaw = row.querySelector('.invoice-amount').value;
  const paidRaw = row.querySelector('.paid-now').value;
  const total = Number(totalRaw);
  const paid = Number(paidRaw);
  const output = row.querySelector('.remaining-amount');
  const mode = row.querySelector('.charge-mode:checked')?.value;
  if (mode !== 'installment') { output.textContent = formatMoney(0); output.style.color = '#18304b'; return; }
  if (totalRaw === '' || paidRaw === '' || !Number.isFinite(total) || !Number.isFinite(paid)) { output.textContent = '\u0623\u062f\u062e\u0644 \u0627\u0644\u0645\u0628\u0627\u0644\u063a'; return; }
  output.textContent = formatMoney(Math.max(0, total - paid));
  output.style.color = '#18304b';
}
function allocateInvoiceItems(subscriptions, total) {
  const sourceTotal = subscriptions.reduce((sum, sub) => sum + Number(sub.price || 0), 0);
  let assigned = 0;
  return subscriptions.map((sub, index) => {
    const price = index === subscriptions.length - 1
      ? Number((total - assigned).toFixed(2))
      : sourceTotal > 0 ? Number((total * Number(sub.price || 0) / sourceTotal).toFixed(2)) : 0;
    assigned += price;
    return { ...sub, price };
  });
}
function editApprovedInvoice(button) {
  const row = button.closest('.request-card');
  if (button.dataset.editing === 'true') {
    loadRequests();
    return;
  }
  button.dataset.editing = 'true';
  button.textContent = '\u0625\u0644\u063a\u0627\u0621 \u0627\u0644\u062a\u0639\u062f\u064a\u0644';
  row.dataset.editingApproved = 'true';
  row.querySelectorAll('.charge-mode').forEach(input => { input.disabled = false; });
  const invoiceInput = row.querySelector('.invoice-amount');
  invoiceInput.disabled = false;
  invoiceInput.readOnly = true;
  row.querySelector('.paid-now').disabled = false;
  const saveButton = row.querySelector('.save-amount');
  saveButton.hidden = false;
  saveButton.disabled = false;
  saveButton.textContent = '\u062d\u0641\u0638 \u0627\u0644\u062a\u0639\u062f\u064a\u0644';
}
async function saveAmount(button) {
  const row = button.closest('.request-card');
  const item = registrations.find(reg => reg.id === row.dataset.id);
  const mode = row.querySelector('.charge-mode:checked')?.value;
  const rawTotal = row.querySelector('.invoice-amount').value;
  const rawPaid = row.querySelector('.paid-now').value;
  const invoiceAmount = rawTotal === '' ? NaN : Number(rawTotal);
  const paidNow = mode === 'free' ? 0 : rawPaid === '' ? NaN : Number(rawPaid);
  const validAmounts = Number.isFinite(invoiceAmount) && invoiceAmount >= 0 && Number.isFinite(paidNow) && paidNow >= 0;
  const valid = validAmounts && (mode === 'free' ? paidNow === 0 : mode === 'full' || mode === 'installment');
  if (!item || !valid) { alert('\u0623\u062f\u062e\u0644 \u0645\u0628\u0644\u063a\u064b\u0627 \u0635\u0627\u0644\u062d\u064b\u0627 \u0644\u0644\u0645\u062f\u0641\u0648\u0639.'); return; }
  if (!teacher.isManager && item.teacherId !== teacher.id && String(item.teacherName || '').trim().toLocaleLowerCase() !== teacher.name.toLocaleLowerCase()) throw new Error('\u0627\u0644\u0637\u0644\u0628 \u0644\u0627 \u064a\u062a\u0628\u0639 \u0627\u0644\u0623\u0633\u062a\u0627\u0630.');
  if (item.paymentStatus === 'paid' && row.dataset.editingApproved !== 'true') return;
  button.disabled = true;
  try {
    const remaining = mode === 'installment' ? Number(Math.max(0, invoiceAmount - paidNow).toFixed(2)) : 0;
    if (item.paymentStatus === 'paid') {
      const registrationRef = doc(db, 'vipRegistrations', item.id);
      const invoiceRef = doc(db, 'invoices', item.invoiceId || 'vip_' + item.id);
      const selectedSubscriptions = Array.isArray(item.selectedSubscriptions) ? item.selectedSubscriptions : [];
      const paymentMethod = mode === 'free' ? '\u0645\u062c\u0627\u0646\u064a' : 'VIP - ' + teacher.name;
      const payment = mode === 'installment' ? '\u062a\u0642\u0633\u064a\u0637' : paymentMethod;
      const invoiceItems = allocateInvoiceItems(selectedSubscriptions, invoiceAmount);
      const installment = mode === 'installment' ? { total: invoiceAmount, paid: paidNow, remaining } : null;
      const registrationUpdates = {
        subscriptionAmount: invoiceAmount, paidAmount: paidNow, amountCollected: paidNow,
        installment, payment, paymentMethod, paidBy: teacher.name, paidAt: new Date(), paymentStatus: 'paid',
        vipPaymentMode: mode, vipFinalPrice: invoiceAmount,
        vipDiscountAmount: mode === 'installment' ? 0 : Math.max(0, invoiceAmount - paidNow),
        teacherReportedAmount: invoiceAmount, teacherReportedPaidAmount: paidNow,
        teacherReportedRemainingAmount: remaining, teacherReportedPaymentMode: mode,
        teacherReportedBy: teacher.id, teacherReportedAt: new Date()
      };
      const invoiceUpdates = {
        student: item.studentName || '-', phone: item.phone || '', grade: item.grade || '-', studyType: item.studyType || '-',
        subType: [...new Set(invoiceItems.map(sub => sub.type).filter(Boolean))].join(' / ') || 'VIP',
        items: invoiceItems, selectedSubscriptions, payment, paymentMethod,
        paymentStatus: 'paid', paidAmount: paidNow, amountCollected: paidNow, installment,
        isVip: true, vipFinalPrice: invoiceAmount, vipSubscriptionPrice: invoiceAmount,
        vipOriginalPrice: Number(item.requestedAmount || 0),
        vipDiscountAmount: mode === 'installment' ? 0 : Math.max(0, invoiceAmount - paidNow),
        vipRegistrationId: item.id, vipIsFree: mode === 'free', vipPaymentMode: mode, lastModified: new Date()
      };
      await runTransaction(db, async transaction => {
        const [registrationSnapshot, invoiceSnapshot] = await Promise.all([
          transaction.get(registrationRef), transaction.get(invoiceRef)
        ]);
        if (!registrationSnapshot.exists() || registrationSnapshot.data().paymentStatus !== 'paid') {
          throw new Error('لا يمكن تعديل طلب غير معتمد. حدّث الصفحة وحاول مرة أخرى.');
        }
        const current = registrationSnapshot.data();
        const belongsToTeacher = current.teacherId === teacher.id || String(current.teacherName || '').trim().toLocaleLowerCase() === teacher.name.toLocaleLowerCase();
        if (!teacher.isManager && !belongsToTeacher) throw new Error('هذا الطلب لا يتبع حسابك.');
        if (invoiceSnapshot.exists() && invoiceSnapshot.data().vipRegistrationId !== item.id) {
          throw new Error('الفاتورة مرتبطة بطلب VIP آخر.');
        }
        transaction.update(registrationRef, registrationUpdates);
        if (invoiceSnapshot.exists()) transaction.update(invoiceRef, invoiceUpdates);
      });
      Object.assign(item, registrationUpdates);
      await loadRequests();
      alert('\u062a\u0645 \u062a\u062d\u062f\u064a\u062b \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629 \u0627\u0644\u0633\u0627\u0628\u0642\u0629.');
      return;
    }
    await updateDoc(doc(db, 'vipRegistrations', item.id), { teacherReportedAmount: invoiceAmount, teacherReportedPaidAmount: paidNow, teacherReportedRemainingAmount: remaining, teacherReportedPaymentMode: mode, teacherReportedBy: teacher.id, teacherReportedAt: new Date() });
    Object.assign(item, { teacherReportedAmount: invoiceAmount, teacherReportedPaidAmount: paidNow, teacherReportedRemainingAmount: remaining, teacherReportedPaymentMode: mode });
    button.textContent = '\u062a\u0645 \u0627\u0644\u062d\u0641\u0638';
    renderReports();
  } catch (err) { console.error(err); button.disabled = false; alert('\u062a\u0639\u0630\u0631 \u062d\u0641\u0638 \u0627\u0644\u0645\u0628\u0627\u0644\u063a. \u062a\u062d\u0642\u0642 \u0645\u0646 \u0627\u0644\u0627\u062a\u0635\u0627\u0644 \u0648\u0627\u0644\u0635\u0644\u0627\u062d\u064a\u0627\u062a.'); }
}
async function approvePayment(button) {
  const row = button.closest('.request-card');
  const item = registrations.find(reg => reg.id === row?.dataset.id);
  if (!item) return;
  if (!teacher.isManager && item.teacherId !== teacher.id && String(item.teacherName || '').trim().toLocaleLowerCase() !== teacher.name.toLocaleLowerCase()) {
    alert('\u0647\u0630\u0627 \u0627\u0644\u0637\u0644\u0628 \u0644\u0627 \u064a\u062a\u0628\u0639 \u062d\u0633\u0627\u0628\u0643.'); return;
  }
  const mode = row.querySelector('.charge-mode:checked')?.value;
  const rawTotal = row.querySelector('.invoice-amount').value;
  const rawPaid = row.querySelector('.paid-now').value;
  const invoicePrice = rawTotal === '' ? NaN : Number(rawTotal);
  const amount = mode === 'free' ? 0 : rawPaid === '' ? NaN : Number(rawPaid);
  const validAmounts = Number.isFinite(invoicePrice) && invoicePrice >= 0 && Number.isFinite(amount) && amount >= 0;
  const valid = validAmounts && (mode === 'free' ? amount === 0 : mode === 'full' || mode === 'installment');
  if (!valid) { alert('\u0631\u0627\u062c\u0639 \u062d\u0627\u0644\u0629 \u0627\u0644\u062f\u0641\u0639 \u0648\u0627\u0644\u0645\u0628\u0627\u0644\u063a \u0642\u0628\u0644 \u0627\u0644\u0627\u0639\u062a\u0645\u0627\u062f.'); return; }
  const selectedSubscriptions = Array.isArray(item.selectedSubscriptions) ? item.selectedSubscriptions : [];
  if (!selectedSubscriptions.length || selectedSubscriptions.some(sub => !sub.id)) { alert('\u062a\u0641\u0627\u0635\u064a\u0644 \u0627\u0644\u0627\u0634\u062a\u0631\u0627\u0643\u0627\u062a \u0646\u0627\u0642\u0635\u0629\u060c \u0644\u0627 \u064a\u0645\u0643\u0646 \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629.'); return; }
  if (item.paymentStatus === 'paid') { alert('\u0627\u0644\u0637\u0644\u0628 \u0645\u0639\u062a\u0645\u062f \u0645\u0633\u0628\u0642\u064b\u0627.'); return; }
  button.disabled = true;
  button.textContent = '\u062c\u0627\u0631\u064d \u0627\u0644\u0627\u0639\u062a\u0645\u0627\u062f...';
  try {
    const invoiceId = 'vip_' + item.id;
    const invoiceRef = doc(db, 'invoices', invoiceId);
    const registrationRef = doc(db, 'vipRegistrations', item.id);
    let invoiceNumber = Number(item.invoiceNumber) || 0;
    if (!invoiceNumber) {
      const [invoiceSnapshot, regularSnapshot, vipRegistrationSnapshot] = await Promise.all([
        getDocs(collection(db, 'invoices')),
        getDocs(collection(db, 'studentRegistrations')),
        getDocs(collection(db, 'vipRegistrations'))
      ]);
      invoiceNumber = nextAvailableVipInvoiceNumber(invoiceSnapshot.docs, vipRegistrationSnapshot.docs, regularSnapshot.docs);
    }
    const requestedPrice = selectedSubscriptions.reduce((sum, sub) => sum + Number(sub.price || 0), 0);
    let assignedPrice = 0;
    const invoiceItems = selectedSubscriptions.map((sub, index) => {
      const price = index === selectedSubscriptions.length - 1 ? Number((invoicePrice - assignedPrice).toFixed(2)) : requestedPrice > 0 ? Number((invoicePrice * Number(sub.price || 0) / requestedPrice).toFixed(2)) : 0;
      assignedPrice += price;
      return { id: sub.id, subscriptionId: sub.id, name: sub.name || '', type: sub.type || '', price, quantity: 1 };
    });
    const remaining = mode === 'installment' ? Number(Math.max(0, invoicePrice - amount).toFixed(2)) : 0;
    const paymentMethod = mode === 'free' ? '\u0645\u062c\u0627\u0646\u064a' : 'VIP - ' + teacher.name;
    const invoiceData = {
      num: invoiceNumber, student: item.studentName || '-', phone: item.phone || '', grade: item.grade || '-', studyType: item.studyType || '-',
      subType: [...new Set(invoiceItems.map(sub => sub.type).filter(Boolean))].join(' / ') || 'VIP',
      items: invoiceItems, selectedSubscriptions, payment: mode === 'installment' ? '\u062a\u0642\u0633\u064a\u0637' : paymentMethod, paymentMethod,
      paymentStatus: 'paid', paidAmount: amount, amountCollected: amount,
      installment: mode === 'installment' ? { total: invoicePrice, paid: amount, remaining } : null,
      vipStockDeducted: false, isVip: true, vipIsFree: mode === 'free', vipPaymentMode: mode, vipFinalPrice: invoicePrice, vipSubscriptionPrice: invoicePrice,
      vipOriginalPrice: Number(item.requestedAmount || invoicePrice), vipDiscountAmount: mode === 'installment' ? 0 : Math.max(0, invoicePrice - amount),
      date: new Date(), createdBy: teacher.name, vipCreatedBy: teacher.name, vipConfirmedBy: teacher.name,
      vipAssignedTeacher: item.teacherName || teacher.name, vipTeacherId: item.teacherId || teacher.id, vipRegistrationId: item.id,
      recipient: item.teacherName || teacher.name, notes: item.notes || 'VIP QR'
    };
      const phone = String(item.phone || '').trim();
      if (phone) {
        const [samePhoneInvoices, samePhoneVipRequests, samePhonePortalRequests] = await Promise.all([
          getDocs(query(collection(db, 'invoices'), where('phone', '==', phone))),
          getDocs(query(collection(db, 'vipRegistrations'), where('phone', '==', phone))),
          getDocs(query(collection(db, 'studentRegistrations'), where('phone', '==', phone)))
        ]);
        const selectedIds = new Map(selectedSubscriptions.filter(sub => sub?.id).map(sub => [sub.id, sub.name || sub.id]));
        const duplicateNames = new Set();
        const checkRecords = (snapshot, collectionName) => snapshot.docs.forEach(docSnapshot => {
          if ((collectionName === 'invoices' && docSnapshot.id === invoiceId)
            || (collectionName === 'vipRegistrations' && docSnapshot.id === item.id)) return;
          if (collectionName === 'vipRegistrations' && isDeletedVipInvoiceRegistration(docSnapshot, samePhoneInvoices.docs)) return;
          const existing = docSnapshot.data();
          const existingItems = existing.items || existing.selectedSubscriptions || existing.subscriptions || existing.selectedItems || [];
          existingItems.forEach(sub => {
            const id = sub?.id || sub?.subscriptionId;
            if (id && selectedIds.has(id)) duplicateNames.add(selectedIds.get(id));
          });
        });
        checkRecords(samePhoneInvoices, 'invoices');
        checkRecords(samePhoneVipRequests, 'vipRegistrations');
        checkRecords(samePhonePortalRequests, 'studentRegistrations');
        if (duplicateNames.size) throw new Error('Already subscribed to: ' + [...duplicateNames].join(', '));
      }
    await runTransaction(db, async transaction => {
      const [registrationSnapshot, invoiceSnapshot] = await Promise.all([transaction.get(registrationRef), transaction.get(invoiceRef)]);
      if (!registrationSnapshot.exists()) throw new Error('Registration request no longer exists.');
      const current = registrationSnapshot.data();
      const belongsToTeacher = current.teacherId === teacher.id || String(current.teacherName || '').trim().toLocaleLowerCase() === teacher.name.toLocaleLowerCase();
      if (!teacher.isManager && !belongsToTeacher) throw new Error('This request belongs to another teacher.');
      const currentSubscriptions = Array.isArray(current.selectedSubscriptions) ? current.selectedSubscriptions : [];
      if (!currentSubscriptions.length || JSON.stringify(currentSubscriptions.map(sub => [sub.id, sub.name, sub.type, Number(sub.price || 0)])) !== JSON.stringify(selectedSubscriptions.map(sub => [sub.id, sub.name, sub.type, Number(sub.price || 0)]))) throw new Error('The original subscription choices changed. Refresh and retry.');
      if (invoiceSnapshot.exists()) {
        const existing = invoiceSnapshot.data();
        if (existing.vipRegistrationId !== item.id) throw new Error('Invoice id is already linked to another request.');
        if (current.paymentStatus !== 'paid') transaction.update(registrationRef, { paymentStatus: 'paid', invoiceId, invoiceNumber: existing.num, subscriptionAmount: existing.vipFinalPrice ?? invoicePrice, amountCollected: existing.amountCollected ?? existing.paidAmount ?? 0, paidAmount: existing.paidAmount ?? 0, payment: existing.payment || existing.paymentMethod, paymentMethod: existing.paymentMethod || existing.payment, installment: existing.installment || null, vipPaymentMode: existing.vipPaymentMode || '', teacherReportedPaymentMode: existing.vipPaymentMode || '', paidBy: existing.vipConfirmedBy || teacher.name, paidAt: existing.date || new Date() });
        return;
      }
      if (current.paymentStatus === 'paid') throw new Error('Request is marked paid but has no linked invoice.');
      const refs = [...new Set(currentSubscriptions.map(sub => sub.id))].map(id => doc(db, 'subscriptions', id));
      const subscriptionSnapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
      if (subscriptionSnapshots.some(snap => !snap.exists())) throw new Error('A selected subscription no longer exists.');
      transaction.set(invoiceRef, invoiceData);
      transaction.update(registrationRef, {
        paymentStatus: 'paid', subscriptionAmount: invoicePrice, paidAmount: amount, amountCollected: amount,
        installment: invoiceData.installment, payment: invoiceData.payment, paymentMethod, paidBy: teacher.name, paidAt: new Date(), invoiceId, invoiceNumber,
        teacherReportedAmount: invoicePrice, teacherReportedPaidAmount: amount, teacherReportedRemainingAmount: remaining,
        teacherReportedPaymentMode: mode, vipPaymentMode: mode, vipFinalPrice: invoicePrice,
        vipDiscountAmount: invoiceData.vipDiscountAmount, teacherReportedBy: teacher.id, teacherReportedAt: new Date()
      });
    });
    await loadRequests();
    alert('\u062a\u0645 \u0627\u0639\u062a\u0645\u0627\u062f \u0627\u0644\u0637\u0644\u0628 \u0648\u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629 \u0628\u0631\u0642\u0645 ' + invoiceNumber + '.');
  } catch (error) {
    console.error('VIP teacher payment approval failed:', error);
    alert(error.message || '\u062a\u0639\u0630\u0631 \u0627\u0639\u062a\u0645\u0627\u062f \u0627\u0644\u0637\u0644\u0628.');
    button.disabled = false;
    button.textContent = '\u0627\u0639\u062a\u0645\u0627\u062f \u0627\u0644\u062f\u0641\u0639 \u0648\u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629';
  }
}
function dateOf(value) { if (!value) return null; const date = value.toDate ? value.toDate() : new Date(value); return Number.isNaN(date.getTime()) ? null : date; }
let reportRows = [];
function renderReports() {
  const fromValue = byId('report-from')?.value || ''; const toValue = byId('report-to')?.value || '';
  const formatReportDate = value => value ? new Date(value + 'T00:00:00').toLocaleDateString('ar-EG') : '';
  const selectedPeriod = [formatReportDate(fromValue), formatReportDate(toValue)].filter(Boolean);
  byId('vip-report-print-period').textContent = selectedPeriod.length ? selectedPeriod.join(' – ') : 'كل الفترات';
  byId('vip-report-print-generated').textContent = new Date().toLocaleString('ar-EG');
  const from = fromValue ? new Date(fromValue + 'T00:00:00') : null; const to = toValue ? new Date(toValue + 'T23:59:59.999') : null;
  reportRows = registrations.filter(item => { const date = dateOf(item.registeredAt); return (!from && !to) || (date && (!from || date >= from) && (!to || date <= to)); });
  const approved = reportRows.filter(item => item.paymentStatus === 'paid');
  const isFree = item => Number(item.subscriptionAmount ?? item.teacherReportedAmount ?? item.requestedAmount ?? 0) === 0;
  const collected = approved.reduce((sum, item) => sum + Number(item.amountCollected ?? item.paidAmount ?? 0), 0);
  const invoiceTotal = approved.reduce((sum, item) => sum + Number(item.subscriptionAmount ?? item.teacherReportedAmount ?? item.requestedAmount ?? 0), 0);
  const estimatedRemaining = item => { if (item.paymentStatus === 'paid') return Number(item.installment?.remaining || 0); const mode = item.teacherReportedPaymentMode; if (mode === 'free' || mode === 'full') return 0; if (mode === 'installment') return Number(item.teacherReportedRemainingAmount ?? Math.max(0, Number(item.teacherReportedAmount || 0) - Number(item.teacherReportedPaidAmount || 0))); return Number(item.requestedAmount || 0); };
  const remaining = reportRows.reduce((sum, item) => sum + estimatedRemaining(item), 0);
  byId('report-count').textContent = reportRows.length; byId('report-approved').textContent = approved.length;
  byId('report-free').textContent = approved.filter(isFree).length; byId('report-installments').textContent = approved.filter(item => Number(item.installment?.remaining || 0) > 0).length;
  byId('report-invoice-total').textContent = formatMoney(invoiceTotal); byId('report-collected').textContent = formatMoney(collected); byId('report-remaining').textContent = formatMoney(remaining);
  const grades = new Map();
  reportRows.forEach(item => { const grade = item.grade || '\u2014'; if (!grades.has(grade)) grades.set(grade, { count: 0, collected: 0, remaining: 0 }); const row = grades.get(grade); row.count++; if (item.paymentStatus === 'paid') row.collected += Number(item.amountCollected ?? item.paidAmount ?? 0); row.remaining += estimatedRemaining(item); });
  byId('report-by-grade').innerHTML = grades.size ? [...grades].map(([grade,row]) => '<tr><td>' + safeText(grade) + '</td><td>' + row.count + '</td><td>' + formatMoney(row.collected) + '</td><td>' + formatMoney(row.remaining) + '</td></tr>').join('') : '<tr><td colspan="4">\u0644\u0627 \u062a\u0648\u062c\u062f \u0628\u064a\u0627\u0646\u0627\u062a \u0641\u064a \u0627\u0644\u0641\u062a\u0631\u0629.</td></tr>';
  byId('report-student-rows').innerHTML = reportRows.length ? reportRows.map(item => {
    const invoiceAmount = Number(item.subscriptionAmount ?? item.teacherReportedAmount ?? item.requestedAmount ?? 0);
    const paidAmount = Number(item.amountCollected ?? item.paidAmount ?? item.teacherReportedPaidAmount ?? 0);
    const subscriptionNames = (item.selectedSubscriptions || []).map(sub => sub.name || sub.id).filter(Boolean).join('، ') || '\u2014';
    const status = item.paymentStatus === 'paid' ? '\u0645\u0639\u062a\u0645\u062f' : '\u0645\u0646\u062a\u0638\u0631';
    const registeredAt = dateOf(item.registeredAt)?.toLocaleDateString('ar-EG') || '\u2014';
    return '<tr><td>' + safeText(item.studentName || '\u2014') + '</td><td dir="ltr">' + safeText(item.phone || '\u2014') + '</td><td>' + safeText(item.grade || '\u2014') + '</td><td>' + safeText(subscriptionNames) + '</td><td>' + status + '</td><td>' + formatMoney(invoiceAmount) + '</td><td>' + formatMoney(item.paymentStatus === 'paid' ? paidAmount : 0) + '</td><td>' + formatMoney(estimatedRemaining(item)) + '</td><td>' + registeredAt + '</td></tr>';
  }).join('') : '<tr><td colspan="9">\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0627\u0628 \u0641\u064a \u0627\u0644\u0641\u062a\u0631\u0629.</td></tr>';
}
function exportReport() {
  const rows = [['\u0627\u0644\u0637\u0627\u0644\u0628','\u0627\u0644\u0647\u0627\u062a\u0641','\u0627\u0644\u0641\u0631\u0642\u0629','\u0642\u064a\u0645\u0629 \u0627\u0644\u0627\u0634\u062a\u0631\u0627\u0643','\u0627\u0644\u0645\u062d\u0635\u0644','\u0627\u0644\u0645\u062a\u0628\u0642\u064a','\u0627\u0644\u062d\u0627\u0644\u0629']];
  reportRows.forEach(item => rows.push([item.studentName || '',item.phone || '',item.grade || '',Number(item.subscriptionAmount ?? item.teacherReportedAmount ?? item.requestedAmount ?? 0),Number(item.amountCollected ?? item.paidAmount ?? 0),Number(item.installment?.remaining ?? item.teacherReportedRemainingAmount ?? 0),item.paymentStatus || 'pending']));
  const csv = '\ufeff' + rows.map(row => row.map(value => '"' + String(value).replace(/"/g,'""') + '"').join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); const link = document.createElement('a'); link.href=url; link.download='vip-teacher-report.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportReportPdf() {
  const reportView = byId('reports-view');
  const wasHidden = reportView.hidden;
  const previousTitle = document.title;
  reportView.hidden = false;
  renderReports();
  document.title = 'VIP - Teacher Report';
  window.print();
  window.setTimeout(() => {
    document.title = previousTitle;
    reportView.hidden = wasHidden;
  }, 800);
}
byId('refresh').addEventListener('click', loadRequests);
document.querySelectorAll('.portal-tab').forEach(tab => tab.addEventListener('click', () => {
  document.querySelectorAll('.portal-tab').forEach(other => other.classList.toggle('active', other === tab));
  document.querySelectorAll('.portal-view').forEach(view => { view.hidden = view.id !== tab.dataset.view; });
  const titles = { 'requests-view': 'طلبات التسجيل', 'reports-view': 'التقارير', 'vip-registration-link': 'رابط وQR التسجيل' };
  byId('teacher-view-title').textContent = titles[tab.dataset.view] || 'بوابة الأستاذ';
  closeTeacherSidebar();
  if (tab.dataset.view === 'reports-view') renderReports();
}));
const teacherSidebar = byId('teacher-sidebar');
const teacherSidebarBackdrop = byId('teacher-sidebar-backdrop');
const teacherMenuToggle = byId('teacher-menu-toggle');
function closeTeacherSidebar() {
  teacherSidebar.classList.remove('is-open');
  teacherSidebarBackdrop.hidden = true;
  teacherMenuToggle.setAttribute('aria-expanded', 'false');
}
teacherMenuToggle.addEventListener('click', () => {
  const open = !teacherSidebar.classList.contains('is-open');
  teacherSidebar.classList.toggle('is-open', open);
  teacherSidebarBackdrop.hidden = !open;
  teacherMenuToggle.setAttribute('aria-expanded', String(open));
});
teacherSidebarBackdrop.addEventListener('click', closeTeacherSidebar);
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeTeacherSidebar(); });
byId('report-from').addEventListener('change', renderReports);
byId('report-to').addEventListener('change', renderReports);
byId('clear-report-filter').addEventListener('click', () => { byId('report-from').value = ''; byId('report-to').value = ''; renderReports(); });
byId('export-report').addEventListener('click', exportReport);
byId('export-report-pdf').addEventListener('click', exportReportPdf);
byId('logout').addEventListener('click', async () => {
  sessionStorage.removeItem(teacherSessionKey);
  teacher = null;
  registrations = [];
  window.location.replace('vip-teacher-login.html');
});

async function initializeTeacherDashboard() {
  if (!teacher) {
    window.location.replace('vip-teacher-login.html');
    return;
  }
  try {
    const settingsSnapshot = await getDoc(doc(db, 'settings', 'main'));
    const configuredName = String(settingsSnapshot.data()?.vipAssignedTeacher || '').trim();
    if (!settingsSnapshot.exists() || configuredName.toLocaleLowerCase() !== teacher.name.toLocaleLowerCase()) {
      sessionStorage.removeItem(teacherSessionKey);
      window.location.replace('vip-teacher-login.html');
      return;
    }
  } catch (error) {
    console.error('Could not validate the VIP teacher session:', error);
    window.location.replace('vip-teacher-login.html');
    return;
  }
  dashboard.hidden = false;
  byId('teacher-name').textContent = 'أهلًا ' + teacher.name;
  const priceHeader = document.querySelector('#dashboard .table-wrap thead th:nth-child(4)');
  if (priceHeader) priceHeader.textContent = 'قيمة الاشتراك المقترحة بالفاتورة';
  renderRegistrationLink();
  await loadRequests();
}

await initializeTeacherDashboard();
