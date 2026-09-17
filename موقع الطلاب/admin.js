import { auth, db } from '../src_frontend/js/firebase.js';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { collection, doc, getDocs, updateDoc, addDoc, Timestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const loginPanel = document.getElementById('login-panel');
const dashboardPanel = document.getElementById('dashboard-panel');
const loginError = document.getElementById('login-error');
const agentsList = document.getElementById('agents-list');
const studentsBody = document.getElementById('students-body');
const agentFilter = document.getElementById('agent-filter');
let registrations = [];
let agents = [];
let payments = [];
let signedInUser = null;
let isManager = false;

const showLoginError = (message) => { loginError.textContent = message; loginError.hidden = false; };
const formatDate = (value) => value?.toDate ? value.toDate().toLocaleString('ar-EG') : '-';
const isToday = (value) => value?.toDate && value.toDate().toDateString() === new Date().toDateString();

function renderStats() {
  const filtered = agentFilter.value ? registrations.filter(item => item.agentId === agentFilter.value) : registrations;
  document.getElementById('total-students').textContent = filtered.length;
  document.getElementById('paid-students').textContent = filtered.filter(item => item.paymentStatus === 'paid').length;
  document.getElementById('unpaid-students').textContent = filtered.filter(item => item.paymentStatus !== 'paid').length;
  document.getElementById('today-students').textContent = filtered.filter(item => isToday(item.registeredAt)).length;
  const filteredAgentIds = agentFilter.value ? new Set([agentFilter.value]) : null;
  const relevantPayments = filteredAgentIds ? payments.filter(item => filteredAgentIds.has(item.agentId)) : payments;
  document.getElementById('today-payments').textContent = `${relevantPayments.filter(item => isToday(item.paidAt)).reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2)} ج`;
  document.getElementById('total-payments').textContent = `${relevantPayments.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2)} ج`;
}

function renderAgents() {
  agentFilter.innerHTML = '<option value="">كل المسؤولين</option>';
  agentsList.innerHTML = agents.length ? '' : '<p>لا يوجد مسؤولون مفعلون.</p>';
  agents.forEach(agent => {
    const portalUrl = new URL('index.html', window.location.href);
    portalUrl.searchParams.set('agent', agent.id);
    const link = portalUrl.href;
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(link)}`;
    const card = document.createElement('article');
    card.className = 'agent-card';
    card.innerHTML = `<h3>${agent.fullname || agent.username || 'مسؤول'}</h3><div>اسم المستخدم: ${agent.username || '-'}</div><div>عدد الطلاب: ${registrations.filter(item => item.agentId === agent.id).length}</div><img class="agent-qr" src="${qr}" alt="QR ${agent.username || ''}"><code>${link}</code><button class="copy-link" data-link="${link}">نسخ الرابط</button>`;
    agentsList.appendChild(card);
    const option = document.createElement('option'); option.value = agent.id; option.textContent = agent.fullname || agent.username || agent.id; agentFilter.appendChild(option);
  });
  agentsList.querySelectorAll('.copy-link').forEach(button => button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(button.dataset.link);
    button.textContent = 'تم النسخ';
  }));
}

function renderStudents() {
  const names = new Map(agents.map(agent => [agent.id, agent.fullname || agent.username || '-']));
  const filtered = agentFilter.value ? registrations.filter(item => item.agentId === agentFilter.value) : registrations;
  studentsBody.innerHTML = filtered.length ? '' : '<tr><td colspan="7">لا توجد تسجيلات.</td></tr>';
  filtered.forEach(item => {
    const row = document.createElement('tr');
    row.innerHTML = `<td>${item.studentName || '-'}</td><td>${item.phone || '-'}</td><td>${item.grade || '-'} / ${item.studyType || '-'}</td><td>${names.get(item.agentId) || '-'}</td><td>${formatDate(item.registeredAt)}</td><td><input class="payment-amount" type="number" min="0" step="0.01" value="${item.paidAmount || ''}" data-id="${item.id}" placeholder="0"></td><td><select class="status-select ${item.paymentStatus === 'paid' ? 'status-paid' : 'status-unpaid'}" data-id="${item.id}"><option value="unpaid" ${item.paymentStatus !== 'paid' ? 'selected' : ''}>لم يدفع</option><option value="paid" ${item.paymentStatus === 'paid' ? 'selected' : ''}>تم الدفع</option></select></td>`;
    studentsBody.appendChild(row);
  });
  studentsBody.querySelectorAll('.status-select').forEach(select => select.addEventListener('change', async () => {
    const amountInput = studentsBody.querySelector(`.payment-amount[data-id="${select.dataset.id}"]`);
    const amount = Number(amountInput?.value || 0);
    if (select.value === 'paid' && amount <= 0) { alert('أدخل مبلغ الدفع أولاً.'); select.value = 'unpaid'; return; }
    select.disabled = true;
    const registration = registrations.find(item => item.id === select.dataset.id);
    await updateDoc(doc(db, 'studentRegistrations', select.dataset.id), { paymentStatus: select.value, paidAmount: amount, paidAt: select.value === 'paid' ? Timestamp.now() : null });
    if (select.value === 'paid' && registration?.paymentStatus !== 'paid') {
      await addDoc(collection(db, 'studentPortalPayments'), { registrationId: select.dataset.id, agentId: registration.agentId, studentName: registration.studentName, amount, paidAt: Timestamp.now(), source: 'student-portal' });
    }
    await loadData();
  }));
}

async function loadData() {
  const [usersSnapshot, registrationsSnapshot, paymentsSnapshot] = await Promise.all([getDocs(collection(db, 'users')), getDocs(collection(db, 'studentRegistrations')), getDocs(collection(db, 'studentPortalPayments'))]);
  const allAgents = usersSnapshot.docs.map(item => ({ id: item.id, ...item.data() })).filter(item => item.active !== false && item.studentPortalEnabled !== false);
  agents = isManager ? allAgents : allAgents.filter(item => item.id === signedInUser.id);
  const agentIds = new Set(agents.map(item => item.id));
  registrations = registrationsSnapshot.docs.map(item => ({ id: item.id, ...item.data() })).filter(item => agentIds.has(item.agentId)).sort((a, b) => (b.registeredAt?.seconds || 0) - (a.registeredAt?.seconds || 0));
  const registrationIds = new Set(registrations.map(item => item.id));
  payments = paymentsSnapshot.docs.map(item => ({ id: item.id, ...item.data() }))
    .filter(item => agentIds.has(item.agentId) && (!item.registrationId || registrationIds.has(item.registrationId)));
  renderAgents(); renderStudents(); renderStats();
}

document.getElementById('admin-login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const identity = document.getElementById('admin-email').value.trim();
    const email = identity.includes('@') ? identity : `${identity}@lookcenter.com`;
    await signInWithEmailAndPassword(auth, email, document.getElementById('admin-password').value);
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

document.getElementById('logout-button').addEventListener('click', () => signOut(auth));
document.getElementById('refresh-button').addEventListener('click', loadData);
agentFilter.addEventListener('change', () => { renderStudents(); renderStats(); });
onAuthStateChanged(auth, async (user) => {
  if (!user) { loginPanel.hidden = false; dashboardPanel.hidden = true; document.getElementById('logout-button').hidden = true; return; }
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
  if (!isManager) {
    document.getElementById('agent-filter').closest('.panel-heading').querySelector('select').hidden = true;
  }
  document.querySelector('#dashboard-panel .eyebrow')?.remove();
  loginPanel.hidden = true; dashboardPanel.hidden = false; document.getElementById('logout-button').hidden = false;
  await loadData();
});
