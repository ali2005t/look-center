import { db } from '../src_frontend/js/firebase.js';
import { addDoc, collection, doc, getDoc, getDocs, query, where, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const params = new URLSearchParams(window.location.search);
const agentId = params.get('agent');
const deviceTokenKey = 'studentPortalDeviceToken';
const deviceToken = localStorage.getItem(deviceTokenKey) || crypto.randomUUID();
localStorage.setItem(deviceTokenKey, deviceToken);
const deviceKey = `studentPortalRegistered:${agentId || 'missing'}`;
const agentBanner = document.getElementById('agent-banner');
const form = document.getElementById('student-form');
const errorBox = document.getElementById('portal-error');
const successBox = document.getElementById('success-message');
const gradeSelect = document.getElementById('student-grade');
const optionsBox = document.getElementById('subscription-options');
const totalBox = document.getElementById('selected-total');
let availableSubscriptions = [];

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
    showError('رابط التسجيل غير مكتمل. اطلب رابطًا جديدًا من المسؤول.');
    return;
  }

  const agentSnapshot = await getDoc(doc(db, 'users', agentId));
  if (!agentSnapshot.exists()) {
    showError('هذا الرابط غير صالح أو لم يعد متاحًا.');
    return;
  }

  const agent = agentSnapshot.data();
  if (agent.active === false || agent.studentPortalEnabled === false) {
    showError('التسجيل متوقف حاليًا لهذا المسؤول.');
    return;
  }

  agentBanner.textContent = `التسجيل عن طريق: ${agent.fullname || agent.username || 'المسؤول'}`;
  const subscriptionsSnapshot = await getDocs(collection(db, 'subscriptions'));
  availableSubscriptions = subscriptionsSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  renderSubscriptionOptions();
  const existingRegistration = await getDocs(query(collection(db, 'studentRegistrations'), where('deviceToken', '==', deviceToken)));
  if (localStorage.getItem(deviceKey) === 'registered' || !existingRegistration.empty) {
    agentBanner.textContent = 'تم التسجيل من هذا الهاتف بالفعل';
    successBox.hidden = false;
    return;
  }

  form.hidden = false;
}

gradeSelect.addEventListener('change', renderSubscriptionOptions);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
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
    await addDoc(collection(db, 'studentRegistrations'), {
      agentId,
      studentName: document.getElementById('student-name').value.trim(),
      phone: document.getElementById('student-phone').value.trim(),
      grade: document.getElementById('student-grade').value,
      studyType: document.getElementById('study-type').value,
      selectedSubscriptions,
      requestedAmount: selectedSubscriptions.reduce((sum, item) => sum + item.price, 0),
      paymentStatus: 'unpaid',
      source: 'student-portal',
      registeredAt: serverTimestamp(),
      deviceToken
    });
    localStorage.setItem(deviceKey, 'registered');
    form.hidden = true;
    successBox.hidden = false;
    agentBanner.textContent = 'تم التسجيل بنجاح';
  } catch (error) {
    console.error(error);
    showError('تعذر حفظ البيانات الآن. حاول مرة أخرى.');
    submitButton.disabled = false;
    submitButton.textContent = 'إرسال البيانات';
  }
});

loadAgent().catch((error) => {
  console.error(error);
  showError('تعذر التحقق من رابط التسجيل.');
});
