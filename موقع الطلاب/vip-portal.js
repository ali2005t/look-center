import { db } from '../src_frontend/js/firebase.js';
import { addDoc, collection, doc, getDoc, getDocs, query, where, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const params = new URLSearchParams(window.location.search);
let teacherId = params.get('teacher');
let teacherName = '';
const gradeSelect = document.getElementById('student-grade');
const optionsBox = document.getElementById('subscription-options');
const totalBox = document.getElementById('selected-total');
let availableSubscriptions = [];
const deviceTokenKey = 'vipPortalDeviceToken';
const deviceToken = localStorage.getItem(deviceTokenKey) || crypto.randomUUID();
localStorage.setItem(deviceTokenKey, deviceToken);
const deviceKey = `vipPortalRegistered:${teacherId || 'missing'}`;

const agentBanner = document.getElementById('agent-banner');
const form = document.getElementById('student-form');
const errorBox = document.getElementById('portal-error');
const successBox = document.getElementById('success-message');
const portalMessages = {
  missingTeacher: '\u0631\u0627\u0628\u0637 \u062a\u0633\u062c\u064a\u0644 VIP \u063a\u064a\u0631 \u0645\u0631\u062a\u0628\u0637 \u0628\u0623\u0633\u062a\u0627\u0630. \u0627\u0637\u0644\u0628 \u0631\u0627\u0628\u0637\u064b\u0627 \u062c\u062f\u064a\u062f\u064b\u0627.',
  chooseOne: '\u0627\u062e\u062a\u0631 \u0627\u0634\u062a\u0631\u0627\u0643\u064b\u0627 \u0648\u0627\u062d\u062f\u064b\u0627 \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644 \u0642\u0628\u0644 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a.'
};

function normalizePhoneForDuplicate(value) {
  return String(value || '').replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/\D/g, '');
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
    const invoice = invoiceDoc.data();
    const number = Number(invoice.num);
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
      || String(invoiceDoc.data().vipRegistrationId || '') === registrationDoc.id);
    const linkedInvoiceNumber = Number(linkedInvoice?.data().num);
    if (Number.isInteger(linkedInvoiceNumber) && linkedInvoiceNumber > 0) return;
    const number = Number(registration.invoiceNumber);
    if (Number.isInteger(number) && number > 0) usedNumbers.add(number);
  });
  let nextNumber = 1;
  while (usedNumbers.has(nextNumber)) nextNumber += 1;
  return nextNumber;
}

function withTimeout(promise, label, timeoutMs = 12000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`انتهت مهلة الاتصال أثناء ${label}`)), timeoutMs))
  ]);
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  form.hidden = true;
}

async function loadTeacher() {
  if (!teacherId) {
    showError(portalMessages.missingTeacher);
    return;
  }

  try {
    if (teacherId.startsWith('vip-name:')) {
      const settingsSnapshot = await withTimeout(getDoc(doc(db, 'settings', 'main')), 'VIP settings');
      const configuredName = String(settingsSnapshot.data()?.vipAssignedTeacher || '').trim();
      if (!settingsSnapshot.exists() || configuredName.toLocaleLowerCase() !== teacherId.slice('vip-name:'.length).toLocaleLowerCase()) {
        showError('رابط VIP غير صالح أو اسم الأستاذ تغيّر في الإعدادات.');
        return;
      }
      teacherName = configuredName;
      agentBanner.textContent = `👑 اشتراك VIP — الأستاذ: ${teacherName}`;
    } else {
    const teacherSnapshot = await withTimeout(
      getDoc(doc(db, 'users', teacherId)),
      'التحقق من الأستاذ'
    );

    if (!teacherSnapshot.exists()) {
      showError('هذا الرابط غير صالح أو لم يعد متاحًا.');
      return;
    }

    const teacher = teacherSnapshot.data();
    teacherName = String(teacher.fullname || teacher.username || teacher.displayName || 'VIP').trim();

    if (teacher.active === false) {
      showError('رابط التسجيل هذا غير نشط حاليًا.');
      return;
    }

    agentBanner.textContent = `👑 اشتراك VIP — الأستاذ: ${teacher.fullname || teacher.username || 'VIP'}`;

    }

    // Load subscriptions after verifying teacher
    const subscriptionsSnapshot = await withTimeout(getDocs(collection(db, 'subscriptions')), 'تحميل الاشتراكات');
    availableSubscriptions = subscriptionsSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    renderSubscriptionOptions();
    form.hidden = false;
  } catch (error) {
    console.error(error);
    showError(`تعذر التحقق من رابط التسجيل: ${error.message || 'خطأ في الاتصال'}`);
  }
}

function renderSubscriptionOptions() {
  const grade = gradeSelect.value;
  const matching = availableSubscriptions.filter(item => item.grade === grade && item.published !== false && (item.type === 'ملازم' || item.type === 'كورسات'));
  optionsBox.innerHTML = matching.length ? matching.map(item => `<label class="subscription-option"><span><input type="checkbox" value="${item.id}"> ${item.name} (${item.type})</span><strong class="subscription-price">${Number(item.price || 0).toFixed(2)} ج</strong></label>`).join('') : '<p>لا توجد اشتراكات منشورة لهذه الفرقة حاليًا.</p>';
  optionsBox.querySelectorAll('input').forEach(input => input.addEventListener('change', updateTotal));
  updateTotal();
}

gradeSelect.addEventListener('change', renderSubscriptionOptions);

function updateTotal() {
  const selected = [...optionsBox.querySelectorAll('input:checked')].map(input => input.value);
  const total = availableSubscriptions.filter(item => selected.includes(item.id)).reduce((sum, item) => sum + Number(item.price || 0), 0);
    totalBox.textContent = total.toFixed(2);
}





form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = form.querySelector('button');
  const originalSubmitText = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = 'جاري التسجيل...';

  try {


    const selectedIds = [...optionsBox.querySelectorAll('input:checked')].map(input => input.value);
    const selectedSubscriptions = availableSubscriptions
      .filter(item => selectedIds.includes(item.id))
      .map(item => ({ id: item.id, name: item.name, type: item.type, price: Number(item.price || 0) }));

    if (!selectedSubscriptions.length) {
      showError(portalMessages.chooseOne);
      submitButton.disabled = false;
      submitButton.textContent = originalSubmitText;
      return;
    }

    const [invoicesSnapshot, registrationsSnapshot, standardRegistrationsSnapshot] = await Promise.all([
      getDocs(collection(db, 'invoices')),
      getDocs(collection(db, 'vipRegistrations')),
      getDocs(collection(db, 'studentRegistrations'))
    ]);
    const invoiceNumber = nextAvailableVipInvoiceNumber(
      invoicesSnapshot.docs,
      registrationsSnapshot.docs,
      standardRegistrationsSnapshot.docs
    );

    const phone = document.getElementById('student-phone').value.trim();
    const phoneKey = normalizePhoneForDuplicate(phone);
    const requestedIds = new Set(selectedSubscriptions.map(item => item.id));
    const duplicateNames = new Set();
    [invoicesSnapshot, registrationsSnapshot, standardRegistrationsSnapshot].forEach(snapshot => snapshot.docs.forEach(existingDoc => {
      const existing = existingDoc.data();
      if (snapshot === registrationsSnapshot && isDeletedVipInvoiceRegistration(existingDoc, invoicesSnapshot.docs)) return;
      if (normalizePhoneForDuplicate(existing.phone || existing.studentPhone) !== phoneKey) return;
      const existingItems = existing.items || existing.selectedSubscriptions || existing.subscriptions || existing.selectedItems || [];
      existingItems.forEach(item => {
        if (requestedIds.has(item?.id || item?.subscriptionId)) {
          const selected = selectedSubscriptions.find(subscription => subscription.id === (item.id || item.subscriptionId));
          if (selected) duplicateNames.add(selected.name);
        }
      });
    }));
    if (duplicateNames.size) throw new Error('\u0627\u0644\u0637\u0627\u0644\u0628 \u0645\u0634\u062a\u0631\u0643 \u0628\u0627\u0644\u0641\u0639\u0644 \u0641\u064a: ' + [...duplicateNames].join('، ') + '. \u0627\u062e\u062a\u0631 \u0627\u0634\u062a\u0631\u0627\u0643\u064b\u0627 \u0623\u0648 \u0645\u0644\u0632\u0645\u0629 \u0645\u062e\u062a\u0644\u0641\u0629.');

    await addDoc(collection(db, 'vipRegistrations'), {
      teacherId: teacherId || null,
      teacherName,
      invoiceNumber,
      studentName: document.getElementById('student-name').value.trim(),
      phone,
      grade: document.getElementById('student-grade').value,
      studyType: document.getElementById('study-type').value,
      notes: document.getElementById('student-notes').value.trim(),
      selectedSubscriptions,
      requestedAmount: selectedSubscriptions.reduce((sum, item) => sum + item.price, 0),
      paymentStatus: 'pending',
      source: 'vip-portal',
      registeredAt: serverTimestamp(),
      deviceToken
    });

    localStorage.setItem(deviceKey, 'registered');
    form.hidden = true;
    successBox.textContent = `\u062a\u0645 \u0625\u0631\u0633\u0627\u0644 \u0637\u0644\u0628 VIP \u0644\u0644\u0623\u0633\u062a\u0627\u0630 ${teacherName}. \u0631\u0642\u0645 \u0627\u0644\u0637\u0644\u0628: ${invoiceNumber}. \u0633\u064a\u0624\u0643\u062f \u0627\u0644\u0623\u0633\u062a\u0627\u0630 \u062d\u0627\u0644\u0629 \u0627\u0644\u062f\u0641\u0639.`;
    successBox.hidden = false;
    agentBanner.textContent = '✅ تم تسجيل بيانات VIP بنجاح';
  } catch (error) {
    console.error(error);
    showError('تعذر حفظ البيانات الآن. حاول مرة أخرى.');
    submitButton.disabled = false;
    submitButton.textContent = 'إكمال العملية';
  }
});


loadTeacher();
