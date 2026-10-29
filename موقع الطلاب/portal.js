import { db } from '../src_frontend/js/firebase.js';
import { addDoc, collection, doc, getDoc, getDocs, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const params = new URLSearchParams(window.location.search);
let agentId = params.get('agent');
const agentBanner = document.getElementById('agent-banner');
const form = document.getElementById('student-form');
const errorBox = document.getElementById('portal-error');
const successBox = document.getElementById('success-message');
const gradeSelect = document.getElementById('student-grade');
const optionsBox = document.getElementById('subscription-options');
const totalBox = document.getElementById('selected-total');
let availableSubscriptions = [];

function normalizePhone(value) {
  return String(value || '')
    .replace(/[٠-٩۰-۹]/g, digit => {
      const arabicIndic = '٠١٢٣٤٥٦٧٨٩'.indexOf(digit);
      return String(arabicIndic >= 0 ? arabicIndic : '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit));
    })
    .replace(/\D/g, '');
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

function renderSubscriptionOptions() {
  const grade = gradeSelect.value;
  const matching = availableSubscriptions.filter(item => item.grade === grade && item.published !== false && (item.type === 'ملازم' || item.type === 'كورسات'));
  optionsBox.innerHTML = matching.length ? matching.map(item => `<label class="subscription-option"><span><input type="checkbox" value="${item.id}"> ${item.name} (${item.type})</span><strong class="subscription-price">${Number(item.price || 0).toFixed(2)} ج</strong></label>`).join('') : '<p>لا توجد اشتراكات منشورة لهذه الفرقة حاليًا.</p>';
  optionsBox.querySelectorAll('input').forEach(input => input.addEventListener('change', updateTotal));
  updateTotal();
}

function updateTotal() {
  const selected = [...optionsBox.querySelectorAll('input:checked')].map(input => input.value);
  const total = availableSubscriptions.filter(item => selected.includes(item.id)).reduce((sum, item) => sum + Number(item.price || 0), 0);
  totalBox.textContent = total.toFixed(2);
}

async function loadAgent() {
  if (!agentId) {
    // If the link does not contain an agent ID, proceed with a default placeholder.
    // This allows the registration form to work for testing or when the admin link is not set.
    console.warn('Agent ID missing in URL. Using default placeholder.');
    // You may set a default agent ID here if desired, e.g., a special "guest" agent.
    // For now we use a generic value.
    agentId = 'guest';
    // Proceed with a generic guest registration (no admin validation)
    agentBanner.textContent = 'تسجيل عام (بدون مسؤول)';
    form.hidden = false;
    return;
  }

  const agentSnapshot = await withTimeout(getDoc(doc(db, 'users', agentId)), 'التحقق من المسؤول');
  if (!agentSnapshot.exists()) {
    showError('هذا الرابط غير صالح أو لم يعد متاحًا.');
    return;
  }

  const agent = agentSnapshot.data();
  if (agent.active === false || agent.studentPortalEnabled === false) {
    showError('التسجيل متوقف حاليًا لهذا المسؤول.');
    return;
  }

    agentBanner.textContent = `كود المسؤول: ${agent.studentPortalCode || 'غير محدد'}`;
  const subscriptionsSnapshot = await withTimeout(getDocs(collection(db, 'subscriptions')), 'تحميل الاشتراكات');
  availableSubscriptions = subscriptionsSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  renderSubscriptionOptions();
  form.hidden = false;
}

gradeSelect.addEventListener('change', renderSubscriptionOptions);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  errorBox.textContent = '';
  const submitButton = form.querySelector('button');
  submitButton.disabled = true;
  submitButton.textContent = 'جاري التسجيل...';

  try {
    const selectedIds = [...optionsBox.querySelectorAll('input:checked')].map(input => input.value);
    const selectedSubscriptions = availableSubscriptions.filter(item => selectedIds.includes(item.id) && (item.type === 'ملازم' || item.type === 'كورسات')).map(item => ({ id: item.id, name: item.name, type: item.type, price: Number(item.price || 0) }));
    if (!selectedSubscriptions.length) {
      showError('اختر اشتراكًا واحدًا على الأقل قبل الإرسال.');
      submitButton.disabled = false;
      submitButton.textContent = 'إرسال البيانات';
      return;
    }
    const phone = document.getElementById('student-phone').value.trim();
    const phoneKey = normalizePhone(phone);
    if (!phoneKey) {
      errorBox.textContent = 'أدخل رقم هاتف صحيحًا.';
      errorBox.hidden = false;
      submitButton.disabled = false;
      submitButton.textContent = 'إرسال البيانات';
      return;
    }
    const requestedIds = new Set(selectedSubscriptions.map(item => item.id));
    const [registrationsSnapshot, vipRegistrationsSnapshot, invoicesSnapshot] = await Promise.all([
      withTimeout(getDocs(collection(db, 'studentRegistrations')), 'التحقق من تسجيلات الرقم'),
      withTimeout(getDocs(collection(db, 'vipRegistrations')), 'التحقق من اشتراكات الرقم'),
      withTimeout(getDocs(collection(db, 'invoices')), 'التحقق من الفواتير السابقة')
    ]);
    const duplicateNames = new Set();
    [registrationsSnapshot, vipRegistrationsSnapshot, invoicesSnapshot].forEach(snapshot => {
      snapshot.docs.forEach(existingDoc => {
        const existing = existingDoc.data();
        if (normalizePhone(existing.phone || existing.studentPhone) !== phoneKey) return;
        const existingItems = [existing.items, existing.selectedSubscriptions, existing.subscriptions, existing.selectedItems]
          .find(items => Array.isArray(items) && items.length) || [];
        existingItems.forEach(item => {
          const subscriptionId = item?.id || item?.subscriptionId;
          if (!requestedIds.has(subscriptionId)) return;
          const selected = selectedSubscriptions.find(subscription => subscription.id === subscriptionId);
          if (selected) duplicateNames.add(selected.name);
        });
      });
    });
    if (duplicateNames.size) {
      errorBox.textContent = `رقم الهاتف مسجل بالفعل في: ${[...duplicateNames].join('، ')}. يمكنك تسجيل اشتراك مختلف لهذا الرقم.`;
      errorBox.hidden = false;
      submitButton.disabled = false;
      submitButton.textContent = 'إرسال البيانات';
      return;
    }
    await addDoc(collection(db, 'studentRegistrations'), {
      agentId,
      studentName: document.getElementById('student-name').value.trim(),
      phone,
      grade: document.getElementById('student-grade').value,
      studyType: document.getElementById('study-type').value,
      selectedSubscriptions,
      requestedAmount: selectedSubscriptions.reduce((sum, item) => sum + item.price, 0),
      notes: document.getElementById('student-notes').value.trim(),
      paymentStatus: 'unpaid',
      source: 'student-portal',
      registeredAt: serverTimestamp()
    });
    form.hidden = true;
    successBox.hidden = false;
    agentBanner.textContent = 'تم التسجيل بنجاح';
  } catch (error) {
    console.error(error);
    errorBox.hidden = true;
    showError('تعذر حفظ البيانات الآن. حاول مرة أخرى.');
    submitButton.disabled = false;
    submitButton.textContent = 'إرسال البيانات';
  }
});

loadAgent().catch((error) => {
  console.error(error);
  const reason = error.code === 'permission-denied'
    ? 'صلاحيات Firebase تمنع الوصول إلى بيانات التسجيل.'
    : error.message || 'تعذر الاتصال بقاعدة البيانات.';
  showError(`تعذر التحقق من رابط التسجيل: ${reason}`);
});
