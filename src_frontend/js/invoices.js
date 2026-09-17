// js/invoices.js
import { db } from "./firebase.js";
import { collection, getDocs, onSnapshot, doc, updateDoc, deleteDoc, addDoc, increment, Timestamp, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { collection as collection2, getDocs as getDocs2 } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { doc as doc2, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const tableBody = document.querySelector("#invoices-table tbody");
const modal = document.getElementById("invoice-details-modal");

// متغيرات لتخزين الفواتير الكل والفواتير المصفاة
let allInvoices = [];
let filteredInvoices = [];

// متغير عالمي لاسم المستلم
let currentRecipient = '-';
let realtimeStarted = false;

function normalizePortalSubscriptions(registration) {
  const raw = registration.selectedSubscriptions || registration.subscriptions || registration.selectedItems || [];
  if (!Array.isArray(raw)) return [];
  return raw.map(item => ({
    id: item.id || '',
    name: item.name || item.title || 'اشتراك',
    type: item.type || item.subType || '',
    price: Number(item.price || 0)
  })).filter(item => item.type === 'ملازم' || item.type === 'كورسات' || item.type === 'اشتراك ملازم' || item.type === 'اشتراك كورسات');
}

function classifyPortalSubscriptions(subscriptions) {
  const types = new Set(subscriptions.map(item => item.type));
  const hasNotes = types.has('ملازم') || types.has('اشتراك ملازم');
  const hasCourses = types.has('كورسات') || types.has('اشتراك كورسات');
  if (hasNotes && hasCourses) return 'ملازم وكورسات';
  if (hasNotes) return 'ملازم';
  if (hasCourses) return 'كورسات';
  return 'تسجيل طالب';
}

function portalSubscriptionFallback(registration) {
  return registration.selectedSubscriptions?.length || registration.subscriptions?.length || registration.selectedItems?.length
    ? ''
    : 'بيانات الاشتراك غير محفوظة';
}

// جلب اسم المستخدم الحالي من فايربيس (Firestore) بناءً على uid من Auth
async function fetchCurrentRecipient() {
  try {
    const auth = getAuth();
    const user = auth.currentUser;
    if (user && user.uid) {
      // جلب بيانات المستخدم من Firestore (مجموعة users)
      const userDoc = await getDoc(doc2(db, 'users', user.uid));
      if (userDoc.exists()) {
        currentRecipient = userDoc.data().username || userDoc.data().name || user.email || '-';
      } else {
        currentRecipient = user.email || '-';
      }
    } else {
      currentRecipient = '-';
    }
  } catch (e) {
    currentRecipient = '-';
  }
}

// مراقبة حالة تسجيل الدخول وتحديث اسم المستلم تلقائياً
const auth = getAuth();
onAuthStateChanged(auth, (user) => {
  fetchCurrentRecipient();
});

// تحميل الفواتير
async function loadInvoices() {
  // Ensure tableBody exists before using it
  if (!tableBody) {
    console.error('Table body element not found');
    return;
  }

  if (!realtimeStarted) {
    realtimeStarted = true;
    onSnapshot(collection(db, 'invoices'), () => loadInvoices());
    onSnapshot(collection(db, 'studentRegistrations'), () => loadInvoices());
    onSnapshot(collection(db, 'users'), () => loadInvoices());
  }

  tableBody.innerHTML = "<tr><td colspan='10'>جاري التحميل...</td></tr>";
  const [snapshot, portalSnapshot, usersSnapshot] = await Promise.all([
    getDocs(collection(db, "invoices")),
    getDocs(collection(db, "studentRegistrations")),
    getDocs(collection(db, "users"))
  ]);
  const userNames = new Map();
  usersSnapshot.forEach(userDoc => {
    const user = userDoc.data();
    userNames.set(userDoc.id, user.username || user.fullname || user.email || userDoc.id);
  });
  tableBody.innerHTML = "";
  let counters = {
    'كورسات': 1,
    'ملازم': 1,
    'محاضرات فردية': 1,
    'ملازم فردية': 1
  };
  let highestInvoiceNumber = 0;
  allInvoices = [];
  snapshot.forEach(docSnap => {
    const inv = docSnap.data();
    // استبعاد الفواتير الفردية من صفحة الفواتير الرئيسية
    if (inv.subType === 'ملازم فردية' || inv.subType === 'محاضرات فردية') return;
    let type = inv.subType || '-';
    let num = counters[type] || 1;
    const storedNumber = Number(inv.num);
    if (Number.isFinite(storedNumber)) highestInvoiceNumber = Math.max(highestInvoiceNumber, storedNumber);
    allInvoices.push({
      id: docSnap.id,
      num: num,
      student: inv.student || '-',
      phone: inv.phone || '',
      subType: type,
      items: inv.items || [],
      payment: inv.payment || '-',
      studyType: inv.studyType || '-',
      grade: inv.grade || '-',
      date: inv.date ? (inv.date.toDate ? inv.date.toDate().toLocaleDateString('ar-EG') : inv.date) : '-',
      status: inv.status || 'تم الحفظ',
      recipient: inv.recipient || '-',
      notes: inv.notes || '-',
      linkedSubTypes: inv.linkedSubTypes || [],
      indivNotes: inv.indivNotes || [],   // للملازم: قائمة الملازم المرتبطة وحالة تسليمها
      onlineCardsDelivery: inv.onlineCardsDelivery || [] // للكروت الأونلاين
    });
    counters[type] = num + 1;
  });

  // عرض تسجيلات الطلاب القادمة من QR بجانب فواتير الطلاب المشتركين.
  let nextPortalInvoiceNumber = highestInvoiceNumber + 1;
  portalSnapshot.forEach(docSnap => {
    const registration = docSnap.data();
    const visibleSubscriptions = normalizePortalSubscriptions(registration);
    const invoiceNumber = Number(registration.invoiceNumber) || nextPortalInvoiceNumber++;
    if (!registration.invoiceNumber) {
      updateDoc(doc(db, 'studentRegistrations', docSnap.id), { invoiceNumber }).catch(error => console.warn('Could not save portal invoice number', error));
    }
    allInvoices.push({
      id: docSnap.id,
      isPortalRegistration: true,
      num: invoiceNumber,
      student: registration.studentName || '-',
      phone: registration.phone || '-',
      subType: classifyPortalSubscriptions(visibleSubscriptions),
      items: [],
      payment: registration.paymentStatus === 'paid' ? 'تم الدفع' : 'لم يدفع',
      paymentStatus: registration.paymentStatus || 'unpaid',
      paidAmount: Number(registration.paidAmount || 0),
      requestedAmount: Number(registration.requestedAmount || 0),
      selectedSubscriptions: visibleSubscriptions,
      subscriptionFallback: portalSubscriptionFallback(registration),
      studyType: registration.studyType || '-',
      grade: registration.grade || '-',
      date: registration.registeredAt ? (registration.registeredAt.toDate ? registration.registeredAt.toDate().toLocaleDateString('ar-EG') : registration.registeredAt) : '-',
      status: 'تسجيل طالب',
      agentId: registration.agentId || '-',
      recipient: userNames.get(registration.agentId) || registration.agentId || '-',
      notes: 'تسجيل من بوابة الطلاب',
      linkedSubTypes: [],
      indivNotes: [],
      onlineCardsDelivery: []
    });
  });
  filteredInvoices = [...allInvoices];
  fillRecipientFilter();
  renderInvoicesTable();
}

// عرض الفواتير في الجدول
function renderInvoicesTable() {
  tableBody.innerHTML = '';
  if (filteredInvoices.length === 0) {
    tableBody.innerHTML = "<tr><td colspan='12'>لا توجد نتائج مطابقة.</td></tr>";
    return;
  }
  // جلب صلاحيات المستخدم من localStorage
  let userPermissions = [];
  let userType = '';
  try {
    userPermissions = JSON.parse(localStorage.getItem('userPermissions') || '[]');
    userType = localStorage.getItem('userType') || '';
  } catch (e) { }
  // الكاشير لا يستطيع الحذف إلا إذا سمح المدير بصلاحية حذف الفواتير
  const canDeleteInvoice = userPermissions.includes('delete_invoice');
  filteredInvoices.forEach(inv => {
    const isGroup = inv.student && inv.student !== '-' && inv.subType !== 'محاضرات فردية' && inv.subType !== 'ملازم فردية';
    const phoneCell = isGroup ? (inv.phone || '-') : '-';
    const itemsText = (inv.items && inv.items.length) ? inv.items.map(x => x.name).join('، ') : '-';
    const portalItemsText = inv.isPortalRegistration && inv.selectedSubscriptions?.length
      ? inv.selectedSubscriptions.map(item => `${item.name} (${item.type.replace('اشتراك ', '')})`).join('، ')
      : itemsText;
    // تحسين مظهر المستلم
    let recipientCell = `<span class="recipient-cell" style="display:inline-block;padding:4px 12px;border-radius:8px;background:linear-gradient(90deg,#e3f2fd 60%,#bbdefb 100%);color:#1976d2;font-weight:bold;font-size:1em;box-shadow:0 1px 4px #90caf922;">${inv.recipient && inv.recipient !== '-' ? inv.recipient : '<span style=\'color:#b3b3b3\'>غير محدد</span>'}</span>`;
    const tr = document.createElement("tr");
    if (inv.isPortalRegistration) tr.className = 'portal-registration-row';
    let actions = inv.isPortalRegistration
      ? `<label class="portal-payment-control"><span>تغيير الدفع</span><select class="portal-payment-status" aria-label="تغيير حالة الدفع" data-id="${inv.id}" data-previous="${inv.paymentStatus}"><option value="unpaid" ${inv.paymentStatus !== 'paid' ? 'selected' : ''}>لم يدفع</option><option value="paid" ${inv.paymentStatus === 'paid' ? 'selected' : ''}>تم الدفع</option></select></label>`
      : `<button class='open-invoice-btn' data-id='${inv.id}' style='background:#1976d2;color:#fff;padding:6px 14px;border:none;border-radius:6px;cursor:pointer;'>قراءة</button>`;
    if (canDeleteInvoice) {
      actions += `<button class='delete-invoice-btn' data-id='${inv.id}' style='background:#f44336;color:#fff;padding:6px 14px;border:none;border-radius:6px;cursor:pointer;'>حذف</button>`;
    }
    // ملخص تسليم الملازم
    let deliverySummary = '-';
    if ((inv.subType === 'ملازم' || inv.subType === 'اشتراك ملازم') && inv.indivNotes && inv.indivNotes.length > 0) {
      const total = inv.indivNotes.length;
      const delivered = inv.indivNotes.filter(n => n.delivered).length;
      const allDone = delivered === total;
      deliverySummary = `<span style="font-weight:bold;color:${allDone ? '#388e3c' : '#e65100'};background:${allDone ? '#e8f5e9' : '#fff3e0'};padding:3px 10px;border-radius:8px;">${delivered}/${total} ✔</span>`;
    }

    // ملخص تسليم الكروت
    let cardSummary = '-';
    if (inv.onlineCardsDelivery && inv.onlineCardsDelivery.length > 0) {
      const total = inv.onlineCardsDelivery.length;
      const delivered = inv.onlineCardsDelivery.filter(c => c.delivered).length;
      const allDone = delivered === total;
      cardSummary = `<span style="font-weight:bold;color:${allDone ? '#1976d2' : '#d32f2f'};background:${allDone ? '#e3f2fd' : '#ffebee'};padding:3px 10px;border-radius:8px;">${delivered}/${total} 🃏</span>`;
    }

    tr.innerHTML = `
      <td>${inv.num}</td>
      <td>${inv.student}</td>
      <td>${phoneCell}</td>
      <td class="items-cell">${portalItemsText || inv.subscriptionFallback || '-'}</td>
      <td class="type-cell">${inv.subType}</td>
      <td>${inv.grade}</td>
      <td class="amount-cell">${inv.isPortalRegistration ? `${inv.paymentStatus === 'paid' ? inv.paidAmount : inv.requestedAmount} ج` : `${(inv.items || []).reduce((sum, x) => sum + (x.price || 0), 0)} ج`}</td>
      <td>${inv.isPortalRegistration ? `<strong class="portal-status ${inv.paymentStatus === 'paid' ? 'paid' : 'unpaid'}">${inv.payment}</strong>` : inv.payment}</td>
      <td>${inv.studyType}</td>
      <td>${inv.date}</td>
      <td>${inv.notes || '-'}</td>
      <td>${recipientCell}</td>
      <td style='text-align:center;'>${deliverySummary}</td>
      <td style='text-align:center;'>${cardSummary}</td>
      <td style='display:flex;gap:6px;justify-content:center;align-items:center;'>${actions}</td>
    `;
    tableBody.appendChild(tr);
  });
  // إعادة ربط الأحداث
  document.querySelectorAll('.open-invoice-btn').forEach(btn => {
    btn.onclick = () => {
      showInvoiceModal(btn.getAttribute('data-id'));
      showNotification('تم فتح تفاصيل الفاتورة', 'info');
    };
  });
  document.querySelectorAll('.delete-invoice-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-id');
      const invoice = allInvoices.find(item => item.id === id);
      const targetCollection = invoice && invoice.isPortalRegistration ? 'studentRegistrations' : 'invoices';
      // نافذة تأكيد عصرية بنفس هوية الإشعارات
      const old = document.getElementById('custom-confirm');
      if (old) old.remove();
      const overlay = document.createElement('div');
      overlay.id = 'custom-confirm';
      overlay.style.position = 'fixed';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100vw';
      overlay.style.height = '100vh';
      overlay.style.background = 'rgba(0,0,0,0.25)';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.zIndex = '10000';
      overlay.innerHTML = `
        <div style="background:#fff;padding:32px 28px 22px 28px;border-radius:16px;box-shadow:0 4px 32px #1976d244,0 1px 8px #90caf922;min-width:280px;max-width:90vw;text-align:center;">
          <div style="font-size:20px;font-weight:bold;color:#1976d2;margin-bottom:18px;">هل أنت متأكد من حذف الفاتورة نهائيًا؟</div>
          <div style="display:flex;gap:18px;justify-content:center;">
            <button id="confirm-delete" style="background:#e53935;color:#fff;padding:10px 32px;border:none;border-radius:8px;font-size:17px;font-weight:bold;cursor:pointer;">حذف</button>
            <button id="cancel-delete" style="background:#1976d2;color:#fff;padding:10px 28px;border:none;border-radius:8px;font-size:17px;font-weight:bold;cursor:pointer;">إلغاء</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      document.getElementById('confirm-delete').onclick = async () => {
        overlay.remove();
        try {
          await deleteDoc(doc(db, targetCollection, id));
          if (targetCollection === 'studentRegistrations') {
            const paymentSnapshot = await getDocs(query(collection(db, 'studentPortalPayments'), where('registrationId', '==', id)));
            await Promise.all(paymentSnapshot.docs.map(paymentDoc => deleteDoc(doc(db, 'studentPortalPayments', paymentDoc.id))));
          }
          window.showNotification('تم حذف الفاتورة بنجاح', 'success');
          loadInvoices();
        } catch (e) {
          window.showNotification('حدث خطأ أثناء حذف الفاتورة: ' + (e.message || e), 'error');
        }
      };
      document.getElementById('cancel-delete').onclick = () => {
        overlay.remove();
      };
    };
  });

  document.querySelectorAll('.portal-payment-status').forEach(select => {
    select.addEventListener('change', async () => {
      const status = select.value;
      const registration = allInvoices.find(item => item.id === select.dataset.id && item.isPortalRegistration);
      const amount = status === 'paid'
        ? Number(registration?.requestedAmount || registration?.paidAmount || 0)
        : 0;
      if (status === 'paid' && amount <= 0) {
        select.value = select.dataset.previous;
        window.showNotification('لا يوجد مبلغ محفوظ لهذا الاشتراك', 'error');
        return;
      }
      try {
        select.disabled = true;
        await updateDoc(doc(db, 'studentRegistrations', select.dataset.id), {
          paymentStatus: status,
          paidAmount: status === 'paid' ? amount : 0,
          paidAt: status === 'paid' ? Timestamp.now() : null
        });
        if (status === 'paid') {
          await addDoc(collection(db, 'studentPortalPayments'), {
            registrationId: select.dataset.id,
            agentId: registration?.agentId || registration?.recipient || '-',
            studentName: registration?.student || '-',
            amount,
            paidAt: Timestamp.now(),
            source: 'invoices-page'
          });
        }
        window.showNotification('تم تحديث حالة الدفع', 'success');
        await loadInvoices();
      } catch (error) {
        console.error(error);
        select.value = select.dataset.previous;
        window.showNotification('تعذر تحديث حالة الدفع', 'error');
      }
    });
  });
}

// إضافة أحداث التصفية على عناصر التحكم
['filter-invoice-num', 'filter-type', 'filter-grade', 'filter-study-type', 'search-student', 'search-phone', 'filter-recipient'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', filterInvoices);
});

// تعبئة قائمة المستلمين تلقائياً من الفواتير
function fillRecipientFilter() {
  const select = document.getElementById('filter-recipient');
  if (!select) return;
  const recipients = Array.from(new Set(allInvoices.map(inv => inv.recipient).filter(x => x && x !== '-')));
  select.innerHTML = '<option value="">كل المستلمين</option>' + recipients.map(r => `<option value="${r}">${r}</option>`).join('');
}

// تصفية الفواتير بناءً على القيم المختارة في الفلاتر
function filterInvoices() {
  const invoiceNum = document.getElementById('filter-invoice-num').value.trim();
  const subType = document.getElementById('filter-type').value;
  const grade = document.getElementById('filter-grade').value;
  const studyType = document.getElementById('filter-study-type').value;
  const student = document.getElementById('search-student').value.trim();
  const phone = document.getElementById('search-phone').value.trim();
  const recipient = document.getElementById('filter-recipient').value.trim(); // إضافة فلتر المستلم
  let linkedPhones = [];
  let linkedStudents = [];
  // إذا تم البحث برقم هاتف أو اسم طالب، اجمع كل القيم المرتبطة
  if (phone) {
    linkedPhones = allInvoices.filter(inv => inv.phone && inv.phone.includes(phone)).map(inv => inv.phone);
  }
  if (student) {
    linkedStudents = allInvoices.filter(inv => inv.student && inv.student.includes(student)).map(inv => inv.student);
  }
  filteredInvoices = allInvoices.filter(inv => {
    const matchNum = !invoiceNum || (inv.num + '' === invoiceNum);
    const matchSubType = !subType || inv.subType === subType;
    const matchGrade = !grade || inv.grade === grade;
    const matchStudyType = !studyType || inv.studyType === studyType;
    // إذا تم البحث برقم هاتف، اعرض كل الفواتير التي رقمها من ضمن المرتبطين
    const matchPhone = !phone || (linkedPhones.length ? linkedPhones.includes(inv.phone) : (inv.phone && inv.phone.includes(phone)));
    // إذا تم البحث باسم طالب، اعرض كل الفواتير التي اسمها من ضمن المرتبطين
    const matchStudent = !student || (linkedStudents.length ? linkedStudents.includes(inv.student) : (inv.student && inv.student.includes(student)));
    const matchRecipient = !recipient || (inv.recipient && inv.recipient.includes(recipient)); // شرط فلترة المستلم
    return matchNum && matchSubType && matchGrade && matchStudyType && matchStudent && matchPhone && matchRecipient;
  });
  renderInvoicesTable();
}

// عرض نافذة تفاصيل الفاتورة
async function showInvoiceModal(id) {
  // جلب الفاتورة مباشرة من قاعدة البيانات لضمان تحديث البيانات
  const invDoc = await getDoc(doc(db, "invoices", id));
  if (!invDoc.exists()) return alert("لم يتم العثور على الفاتورة!");
  const inv = invDoc.data();
  // إصلاح تعريف isNotesSubscription
  const isNotesSubscription = inv.subType && (inv.subType === 'اشتراك ملازم' || inv.subType === 'ملازم');

  // جلب جميع الملازم المرتبطة بنفس الفرقة من الاشتراكات والأسعار
  let allNotesList = [];
  if ((inv.subType === 'اشتراك ملازم' || inv.subType === 'ملازم') && inv.grade) {
    if (Array.isArray(inv.indivNotes) && inv.indivNotes.length > 0) {
      // indivNotes موجودة: استخدمها مباشرة
      allNotesList = inv.indivNotes.map(n => ({ name: n.name, price: n.price, delivered: n.delivered || false }));
    } else {
      // indivNotes مش موجودة (فاتورة قديمة): اجلب الملازم الفردية الحالية من subscriptions
      const subsSnap = await getDocs(collection(db, "subscriptions"));
      subsSnap.forEach(docSnap => {
        const data = docSnap.data();
        if (data.type === 'ملازم فردية' && data.grade === inv.grade && (data.published === undefined || data.published)) {
          allNotesList.push({ name: data.name, price: data.price, delivered: false });
        }
      });
      // احفظ القائمة في الفاتورة علشان المرة الجاية تتحمل منها
      if (allNotesList.length > 0) {
        try {
          await updateDoc(doc(db, 'invoices', id), { indivNotes: allNotesList });
        } catch (e) { console.warn('Could not save indivNotes:', e); }
      }
    }
  }
  // مربعات استلام الملازم في اشتراك ملازم
  let notesDeliveryBoxes = '';
  // استخدم allNotesList مباشرة للعداد والعرض
  let notesArr = allNotesList.length > 0 ? allNotesList : [];
  if ((inv.subType === 'اشتراك ملازم' || inv.subType === 'ملازم') && notesArr.length > 0) {
    const deliveredCount = notesArr.filter(x => x.delivered).length;
    const remainingCount = notesArr.length - deliveredCount;
    notesDeliveryBoxes = `<div style='margin:18px 0 0 0;'>
      <b style='color:#1976d2;'>عدد الملازم المستلمة: ${deliveredCount}</b>
      <span style='margin-right:18px;color:#e53935;'>الملازم المتبقية: ${remainingCount}</span>
    </div>`;
  }
  // --- مربعات استلام الملازم الفردية حسب الفرقة ---
  let indivNotesBoxes = '';
  if ((inv.subType === 'اشتراك ملازم' || inv.subType === 'ملازم') && allNotesList.length > 0) {
    indivNotesBoxes = `<div style='margin:18px 0 0 0;'>
      <b style='color:#1976d2;'>جميع الملازم المرتبطة بالفرقة:</b>
      <div class='indiv-notes-list' style="display:grid;grid-template-columns:repeat(auto-fill, minmax(140px, 1fr));gap:10px;margin-top:10px;">
        ${allNotesList.map((x, i) =>
      `<div class='indiv-note-box' style="background:#fff;padding:10px;border-radius:10px;border:1px solid #e0e0e0;text-align:center;">
            <div style="font-weight:bold;font-size:0.9em;margin-bottom:5px;">${x.name}</div>
            <input type='checkbox' class='indiv-note-delivered-checkbox' data-idx='${i}' ${x.delivered ? 'checked' : ''} style="width:18px;height:18px;">
            <div style="font-size:0.8em;color:${x.delivered ? '#2e7d32' : '#d32f2f'}">${x.delivered ? 'تم' : 'لم'} يستلم</div>
          </div>`
    ).join('')}
      </div>
    </div>`;
  }

  // --- مربعات استلام كروت الأونلاين ---
  let cardDeliverySummary = '';
  let indivCardsBoxes = '';

  // لو الفاتورة قديمة ومعندهاش onlineCardsDelivery، نحاول نجيب الكروت المناسبة (للاشتراكات)
  if ((!inv.onlineCardsDelivery || inv.onlineCardsDelivery.length === 0) &&
    (inv.subType && (inv.subType.includes('اشتراك') || inv.subType === 'كورسات' || inv.subType === 'ملازم'))) {
    const cardsSnap = await getDocs(collection(db, "onlineCards"));
    const autoCards = [];
    cardsSnap.forEach(docSnap => {
      const data = docSnap.data();
      if (data.type === 'للاشتراكات') {
        autoCards.push({ id: docSnap.id, name: data.name, type: data.type, perSub: data.perSub || 1, delivered: false });
      }
    });
    if (autoCards.length > 0) {
      inv.onlineCardsDelivery = autoCards;
      // حفظها في الفاتورة مستقبلاً
      try {
        await updateDoc(doc(db, 'invoices', id), { onlineCardsDelivery: autoCards });
      } catch (e) { console.warn('Could not auto-save onlineCardsDelivery:', e); }
    }
  }

  const onlineCardsArr = inv.onlineCardsDelivery || [];
  if (onlineCardsArr.length > 0) {
    const delCount = onlineCardsArr.filter(x => x.delivered).length;
    const remCount = onlineCardsArr.length - delCount;
    cardDeliverySummary = `<div style='margin:18px 0 0 0;padding-top:12px;border-top:1px dashed #90caf9;'>
      <b style='color:#1565c0;'>عدد كروت الأونلاين المستلمة: ${delCount}</b>
      <span style='margin-right:18px;color:#d32f2f;'>المتبقي: ${remCount}</span>
    </div>`;

    indivCardsBoxes = `<div style='margin:12px 0 0 0;'>
      <b style='color:#1565c0;'>كروت الأونلاين المرتبطة بالفاتورة:</b>
      <div class='indiv-cards-list' style="display:grid;grid-template-columns:repeat(auto-fill, minmax(140px, 1fr));gap:10px;margin-top:10px;">
        ${onlineCardsArr.map((x, i) =>
      `<div class='indiv-card-box' style="background:#fff;padding:10px;border-radius:10px;border:2px solid ${x.delivered ? '#1976d2' : '#ffebee'};text-align:center;box-shadow:0 2px 5px rgba(0,0,0,0.05);">
            <div style="font-weight:bold;font-size:0.9em;margin-bottom:5px;color:#1565c0;">${x.name}</div>
            <input type='checkbox' class='card-delivered-checkbox' data-idx='${i}' ${x.delivered ? 'checked' : ''} style="width:20px;height:20px;accent-color:#1976d2;">
            <div style="font-size:0.8em;font-weight:bold;margin-top:4px;color:${x.delivered ? '#1976d2' : '#d32f2f'}">${x.delivered ? 'تـــم التسليم' : 'لـم يستلم'}</div>
          </div>`
    ).join('')}
      </div>
    </div>`;
  }
  // بناء النافذة بتصميم عصري وجذاب
  // إضافة اسم السنتر والعنوان في أعلى الفاتورة عند الطباعة
  // جلب بيانات السنتر من localStorage
  const centerName = localStorage.getItem('centerName') || 'اسم السنتر';
  const centerAddress = localStorage.getItem('centerAddress') || '';
  const centerPhone1 = localStorage.getItem('centerPhone1') || '';
  const centerPhone2 = localStorage.getItem('centerPhone2') || '';
  const centerPhone3 = localStorage.getItem('centerPhone3') || '';
  let logoUrl = localStorage.getItem('centerLogo');
  if (!logoUrl || logoUrl === 'null' || logoUrl === 'undefined') {
    logoUrl = 'img/placeholder-logo.png';
  }
  // تشكيل أرقام السنتر مع فاصل -
  const phones = [centerPhone1, centerPhone2, centerPhone3].filter(p => p && p.trim());
  const phonesDisplay = phones.length > 0 ? `<i class='fa fa-phone' style='margin-left:6px;color:#388e3c;'></i>${phones.join(' - ')}` : '';
  let phoneHtml = phonesDisplay ? `<div style='font-size:1.05rem;color:#1976d2;display:flex;align-items:center;justify-content:center;'>${phonesDisplay}</div>` : '';
  modal.innerHTML = `
    <div style="background:linear-gradient(120deg,#e3f2fd 60%,#fff 100%);border-radius:18px;box-shadow:0 6px 32px #90caf988,0 2px 8px #e3e3e3cc;padding:32px 18px 18px 18px;max-width:520px;min-width:340px;position:relative;max-height:90vh;overflow-y:auto;">
      <button id='close-invoice-modal' style='position:absolute;left:18px;top:18px;background:transparent;border:none;font-size:22px;color:#1976d2;cursor:pointer;z-index:10;' title='إغلاق'>&#10006;</button>
      <h2 style='margin-bottom:18px;color:#1976d2;text-align:center;font-weight:bold;font-size:1.3em;'>تفاصيل الفاتورة</h2>
      <div id="printable-invoice" style="text-align:center;padding:0 8px;">
        <div style='margin-bottom:18px;padding-bottom:12px;border-bottom:2px solid #1976d2;'>
          <img src="${logoUrl}" alt="شعار السنتر" style="display:block;margin:0 auto 10px auto;max-width:120px;max-height:120px;border-radius:8px;" />
          <div style='font-size:1.4rem;font-weight:bold;color:#1565c0;text-align:center;margin-bottom:6px;'>${centerName}</div>
          <div style='font-size:1.15rem;font-weight:bold;color:#1976d2;margin:10px 0;text-align:center;padding:8px;background:#e3f2fd;border-radius:6px;'>رقم الفاتورة: ${(typeof inv.num !== 'undefined' && inv.num !== null) ? inv.num : '-'}</div>
        </div>
        
        <table style='width:100%;border-collapse:collapse;margin:12px 0;font-size:14px;line-height:1.8;'>
          <tr style='background:#f5f5f5;'>
            <td style='padding:10px;text-align:right;font-weight:bold;color:#1976d2;border-bottom:1px solid #e0e0e0;width:40%;'>اسم الطالب:</td>
            <td style='padding:10px;text-align:left;border-bottom:1px solid #e0e0e0;'>${inv.student || '-'}</td>
          </tr>
          <tr style='background:#fff;'>
            <td style='padding:10px;text-align:right;font-weight:bold;color:#1976d2;border-bottom:1px solid #e0e0e0;'>رقم الهاتف:</td>
            <td style='padding:10px;text-align:left;border-bottom:1px solid #e0e0e0;color:#388e3c;font-weight:bold;'>${inv.phone || '-'}</td>
          </tr>
          <tr>
            <td style='padding:10px;text-align:right;font-weight:bold;color:#1976d2;border-bottom:1px solid #e0e0e0;'>الفرقة:</td>
            <td style='padding:10px;text-align:left;border-bottom:1px solid #e0e0e0;'>${inv.grade || '-'}</td>
          </tr>
          <tr style='background:#f5f5f5;'>
            <td style='padding:10px;text-align:right;font-weight:bold;color:#1976d2;border-bottom:1px solid #e0e0e0;'>نوع الاشتراك:</td>
            <td style='padding:10px;text-align:left;border-bottom:1px solid #e0e0e0;'>${inv.subType || '-'}</td>
          </tr>
          <tr>
            <td style='padding:10px;text-align:right;font-weight:bold;color:#1976d2;border-bottom:1px solid #e0e0e0;'>الانتظام:</td>
            <td style='padding:10px;text-align:left;border-bottom:1px solid #e0e0e0;'>${inv.studyType || '-'}</td>
          </tr>
        </table>
        
        ${inv.subType === 'كورسات' && inv.linkedSubTypes && inv.linkedSubTypes.includes('ملازم') ? `<div style='margin:12px 0;padding:12px;background:#fff3e0;border-left:4px solid #ff9800;border-radius:4px;text-align:right;font-size:14px;font-weight:bold;color:#e65100;'>ⓘ كود اشتراك الملازم: <span style='color:#ff6f00;font-size:16px;'>${(typeof inv.num !== 'undefined' && inv.num !== null) ? inv.num + 1 : '-'}</span></div>` : ''}
        
        <div style='margin-top:12px;margin-bottom:12px;padding:10px;background:#e8f5e9;border:2px solid #388e3c;border-radius:6px;'>
          <div style='font-size:13px;color:#2e7d32;margin-bottom:4px;'><b>طريقة الدفع:</b> ${inv.payment || '-'}</div>
        </div>
        
        <div style='margin-bottom:12px;'>
          <div style='font-weight:bold;color:#1976d2;margin-bottom:8px;text-align:right;padding-bottom:6px;border-bottom:2px solid #1565c0;'>📋 العناصر</div>
          <table style='width:100%;border-collapse:collapse;font-size:14px;'>
            ${(inv.items || []).map((x, idx) => `
            <tr style='${idx % 2 === 0 ? "background:#f9f9f9;" : ""}'>
              <td style='padding:10px;text-align:right;border-bottom:1px solid #e0e0e0;'>${x.name}</td>
              <td style='padding:10px;text-align:left;border-bottom:1px solid #e0e0e0;color:#388e3c;font-weight:bold;'>${x.price} ج</td>
            </tr>
            `).join('')}
          </table>
        </div>
        ${notesDeliveryBoxes}
        ${indivNotesBoxes}
        ${cardDeliverySummary}
        ${indivCardsBoxes}
        
        <div style='margin:12px 0;padding:12px;background:#e8f5e9;border:2px solid #388e3c;border-radius:6px;text-align:center;'>
          <div style='font-size:12px;color:#2e7d32;margin-bottom:4px;'>الإجمالي</div>
          <div style='font-size:18px;font-weight:bold;color:#1b5e20;'>${(inv.items || []).reduce((sum, x) => sum + (x.price || 0), 0)} ج</div>
        </div>
        
        ${inv.payment === 'تقسيط' && inv.installment ? `
        <div style='margin:12px 0;padding:12px;background:#fff8e1;border:2px solid #fbc02d;border-radius:6px;'>
          <div style='color:#f57f17;font-weight:bold;margin-bottom:10px;text-align:center;'>📊 بيانات التقسيط</div>
          <table style='width:100%;border-collapse:collapse;font-size:14px;'>
            <tr style='background:#fff9c4;'>
              <td style='padding:10px;text-align:right;font-weight:bold;color:#f57f17;border-bottom:1px solid #fbc02d;'>المبلغ المدفوع:</td>
              <td style='padding:10px;text-align:left;color:#f57f17;font-weight:bold;border-bottom:1px solid #fbc02d;'>${inv.installment.paid || 0} ج</td>
            </tr>
            <tr style='background:#fff59d;'>
              <td style='padding:10px;text-align:right;font-weight:bold;color:#e65100;'>المبلغ المتبقي:</td>
              <td style='padding:10px;text-align:left;color:#e65100;font-weight:bold;'>${inv.installment.remaining || 0} ج</td>
            </tr>
          </table>
        </div>
        ` : ''}
        
        <table style='width:100%;border-collapse:collapse;margin:12px 0;font-size:13px;line-height:1.8;'>
          <tr style='background:#f5f5f5;'>
            <td style='padding:10px;text-align:right;font-weight:bold;color:#1976d2;border-bottom:1px solid #e0e0e0;'>التاريخ:</td>
            <td style='padding:10px;text-align:left;border-bottom:1px solid #e0e0e0;'>${inv.date ? (inv.date.toDate ? inv.date.toDate().toLocaleDateString('ar-EG') : inv.date) : '-'}</td>
          </tr>
          <tr>
            <td style='padding:10px;text-align:right;font-weight:bold;color:#1976d2;border-bottom:1px solid #e0e0e0;'>ملاحظات:</td>
            <td style='padding:10px;text-align:left;border-bottom:1px solid #e0e0e0;'>${inv.notes || 'لا توجد'}</td>
          </tr>
        </table>
        
        <div style='margin-top:18px;padding-top:12px;border-top:2px solid #e0e0e0;'>
          <div style='font-weight:bold;color:#1565c0;margin-bottom:8px;text-align:center;'>الفرع الرئيسي</div>
          <div style='font-size:13px;color:#555;margin-bottom:6px;text-align:center;'>${centerAddress ? centerAddress : '-'}</div>
          ${phoneHtml ? `<div style='text-align:center;margin:6px 0;font-size:12px;'>${phoneHtml}</div>` : ''}
          <div style='font-size:1.08rem;color:#1976d2;margin:10px 0;text-align:center;padding:10px;background:#e3f2fd;border-radius:6px;'><b>المستلم:</b> ${inv.recipient && inv.recipient !== '-' ? inv.recipient : '<span style="color:#b3b3b3">غير محدد</span>'}</div>
        </div>
      </div>
      <div style='display:flex;gap:10px;justify-content:center;margin-bottom:8px;margin-top:18px;flex-wrap:wrap;'>
        <button id='print-invoice-btn' style='background:#388e3c;color:#fff;padding:10px 24px;border:none;border-radius:8px;cursor:pointer;font-size:15px;font-weight:bold;box-shadow:0 2px 8px #388e3c22;transition:all 0.3s;display:flex;align-items:center;gap:8px;'><i class='fa fa-print'></i> طباعة</button>
        <button id='download-invoice-btn' style='background:#2196f3;color:#fff;padding:10px 24px;border:none;border-radius:8px;cursor:pointer;font-size:15px;font-weight:bold;box-shadow:0 2px 8px #2196f322;transition:all 0.3s;display:flex;align-items:center;gap:8px;'><i class='fa fa-download'></i> حفظ صورة</button>
        ${inv.payment === 'تقسيط' ? `<button id='confirm-payment-btn' style='background:#ff9800;color:#fff;padding:10px 24px;border:none;border-radius:8px;cursor:pointer;font-size:15px;font-weight:bold;box-shadow:0 2px 8px #ff980022;transition:all 0.3s;display:flex;align-items:center;gap:8px;'><i class='fa fa-check'></i> تأكيد الدفع</button>` : ''}
        <button id='edit-invoice-btn' style='background:#ff9800;color:#fff;padding:10px 24px;border:none;border-radius:8px;cursor:pointer;font-size:15px;font-weight:bold;box-shadow:0 2px 8px #ff980022;transition:all 0.3s;display:flex;align-items:center;gap:8px;'><i class='fa fa-edit'></i> تعديل</button>
        <button id='save-invoice-edit' style='background:#1976d2;color:#fff;padding:10px 28px;border:none;border-radius:8px;cursor:pointer;font-size:15px;font-weight:bold;box-shadow:0 2px 8px #1976d222;transition:all 0.3s;display:flex;align-items:center;gap:8px;'><i class='fa fa-save'></i> حفظ</button>
      </div>
    </div>
  `;
  modal.classList.add('active');
  modal.style.display = 'block';

  // إضافة العناصر المخفية للتعديل
  const hiddenEditFields = document.createElement('div');
  hiddenEditFields.style.display = 'none';
  hiddenEditFields.innerHTML = `
    <input id='edit-student' type='text' value='${inv.student || '-'}' style='display:none;' />
    <input id='edit-grade' type='text' value='${inv.grade || '-'}' style='display:none;' />
    <input id='edit-subType' type='text' value='${inv.subType || '-'}' style='display:none;' />
    <input id='edit-studyType' type='text' value='${inv.studyType || '-'}' style='display:none;' />
    <input id='edit-payment' type='text' value='${inv.payment || '-'}' style='display:none;' />
    <input id='edit-notes' type='text' value='${inv.notes || ''}' style='display:none;' />
  `;
  modal.appendChild(hiddenEditFields);

  // زر الطباعة
  document.getElementById('print-invoice-btn').onclick = () => {
    const printContents = document.getElementById('printable-invoice').innerHTML;
    const win = window.open('', '', 'width=400,height=600');
    win.document.write(`
      <html dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>فاتورة</title>
      <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap" rel="stylesheet">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { 
          margin: 0; 
          padding: 0; 
          height: auto;
          display: flex;
          justify-content: center;
          align-items: center;
        }
        body {
          font-family: "Cairo", "Arabic Typesetting", sans-serif;
          font-size: 11px;
          color: #333;
          background: #f5f5f5;
          width: 100%;
          padding: 5mm;
          display: flex;
          justify-content: center;
          align-items: flex-start;
        }
        .print-container { 
          width: 80mm; 
          margin: 0 auto;
          background: white;
          padding: 3mm;
          box-shadow: 0 0 10px rgba(0,0,0,0.1);
        }
        img { max-width: 45px; height: auto; display: block; margin: 1mm auto; }
        h1 { font-size: 12px; margin: 1mm 0; color: #1565c0; }
        hr { border: none; border-top: 0.5px solid #999; margin: 2mm 0; }
        table { width: 100%; border-collapse: collapse; margin: 2mm 0; font-size: 10px; }
        td { padding: 1.5mm; border-bottom: 0.5px solid #ddd; }
        td:first-child { text-align: right; font-weight: bold; width: 40%; }
        .invoice-num { font-size: 11px; font-weight: bold; color: #1565c0; text-align: center; padding: 1.5mm; border: 1px solid #1565c0; margin: 2mm 0; }
        .total-box { background: #e8f5e9; border: 1px solid #388e3c; padding: 2mm; margin: 2mm 0; text-align: center; font-weight: bold; font-size: 11px; }
        .installment-box { background: #fff8e1; border: 1px solid #fbc02d; padding: 2mm; margin: 2mm 0; font-size: 10px; }
        .footer { margin-top: 2mm; padding-top: 2mm; border-top: 0.5px solid #999; text-align: center; font-size: 9px; line-height: 1.4; }
        .footer div { margin: 0.5mm 0; }
        @media print {
          html, body { 
            margin: 0; 
            padding: 0; 
            width: 100%;
            height: 100%;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            background: white;
          }
          body { 
            padding: 5mm;
            display: flex;
            justify-content: center;
          }
          .print-container { 
            width: 80mm; 
            margin: 0 auto;
            page-break-after: auto;
            box-shadow: none;
          }
          * { box-shadow: none !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      </style>
      </head><body><div class="print-container">${printContents}</div></body></html>
    `);
    win.document.close();
    setTimeout(() => {
      win.print();
      win.close();
    }, 300);
  };

  // --- تفعيل تحديث حالة الاستلام ---
  if (isNotesSubscription) {
    modal.querySelectorAll('.item-delivered-checkbox').forEach(cb => {
      cb.addEventListener('change', async function () {
        const idx = +cb.getAttribute('data-idx');
        itemsWithDelivery[idx].delivered = cb.checked;
        // تحديث في قاعدة البيانات
        await updateDoc(doc(db, 'invoices', id), { items: itemsWithDelivery });
        showNotification(cb.checked ? 'تم تسجيل استلام الملزمة' : 'تم إلغاء الاستلام', 'success');
        // جلب الفاتورة من قاعدة البيانات من جديد لإظهار التغيير فورًا
        setTimeout(() => showInvoiceModal(id), 200);
      });
    });
  }
  // تفعيل تحديث حالة استلام كروت الأونلاين
  if (onlineCardsArr.length > 0) {
    modal.querySelectorAll('.card-delivered-checkbox').forEach(cb => {
      cb.addEventListener('change', async function () {
        const idx = +cb.getAttribute('data-idx');
        const cardInfo = onlineCardsArr[idx];
        const isDelivered = cb.checked;

        // حساب الكمية المراد خصمها أو إضافتها للمخزون
        let amount = 0;
        if (cardInfo.type === 'للاشتراكات') {
          // حساب عدد الاشتراكات في الفاتورة
          const subCount = (inv.items || []).filter(item =>
            !item.isOnlineCard && (item.subType === 'كورسات' || item.subType === 'ملازم' || (inv.subType && inv.subType.includes('اشتراك')))
          ).length;
          amount = (subCount || 1) * (cardInfo.perSub || 1);
        } else {
          amount = 1;
        }

        try {
          // 1. تحديث حالة الفاتورة
          onlineCardsArr[idx].delivered = isDelivered;
          await updateDoc(doc(db, 'invoices', id), { onlineCardsDelivery: onlineCardsArr });

          // 2. تحديث المخزون (لو استلم نخصم، لو ألغى نرجع)
          const stockChange = isDelivered ? -amount : amount;
          await updateDoc(doc(db, 'onlineCards', cardInfo.id), {
            stock: increment(stockChange)
          });

          showNotification(isDelivered ? 'تم تسليم الكرت وخصم المخزون' : 'تم إلغاء التسليم وإرجاع المخزون', 'success');
          setTimeout(() => showInvoiceModal(id), 200);
        } catch (err) {
          console.error('Error updating card delivery:', err);
          showNotification('حدث خطأ أثناء تحديث حالة الكرت', 'error');
        }
      });
    });
  }

  // تفعيل تحديث حالة الاستلام لملازم indivNotes (الملازم المرتبطة بالفرقة)
  if ((inv.subType === 'اشتراك ملازم' || inv.subType === 'ملازم') && allNotesList.length > 0) {
    modal.querySelectorAll('.indiv-note-delivered-checkbox').forEach(cb => {
      cb.disabled = false;
      cb.addEventListener('change', async function () {
        const idx = +cb.getAttribute('data-idx');
        allNotesList[idx].delivered = cb.checked;
        // احفظ الحالة الجديدة في الفاتورة (indivNotes)
        await updateDoc(doc(db, 'invoices', id), { indivNotes: allNotesList });
        showNotification(cb.checked ? 'تم تسجيل استلام الملزمة' : 'تم إلغاء الاستلام', 'success');
        // جلب الفاتورة من قاعدة البيانات من جديد لإظهار التغيير فورًا
        setTimeout(() => showInvoiceModal(id), 200);
      });
    });
  }

  // إغلاق
  document.getElementById('close-invoice-modal').onclick = () => {
    modal.classList.remove('active');
    modal.style.display = 'none';
  };
  // حفظ التعديلات
  document.getElementById('save-invoice-edit').onclick = async () => {
    try {
      const editContainer = document.getElementById('edit-fields-container');
      if (!editContainer) {
        showNotification('❌ لم يتم تفعيل وضع التعديل', 'error');
        return;
      }

      // جلب القيم الجديدة من الحقول
      const newStudent = document.getElementById('edit-student').value.trim() || inv.student;
      const newPhone = document.getElementById('edit-phone').value.trim() || inv.phone;
      const newGrade = document.getElementById('edit-grade').value.trim() || inv.grade;
      const newSubType = document.getElementById('edit-subType').value.trim() || inv.subType;
      const newStudyType = document.getElementById('edit-studyType').value.trim() || inv.studyType;
      const newPayment = document.getElementById('edit-payment').value.trim() || inv.payment;
      const newNotes = document.getElementById('edit-notes').value.trim() || inv.notes;

      // التحقق من وجود تغييرات فعلية
      const hasChanges = newStudent !== inv.student ||
        newPhone !== inv.phone ||
        newGrade !== inv.grade ||
        newSubType !== inv.subType ||
        newStudyType !== inv.studyType ||
        newPayment !== inv.payment ||
        newNotes !== inv.notes;

      if (!hasChanges) {
        showNotification('⚠️ لم تتم إدخال أي تعديلات', 'info');
        return;
      }

      // إظهار إشعار التحميل
      showNotification('⏳ جاري حفظ التعديلات...', 'info');

      // تحديث البيانات في قاعدة البيانات
      await updateDoc(doc(db, 'invoices', id), {
        student: newStudent,
        phone: newPhone,
        grade: newGrade,
        subType: newSubType,
        studyType: newStudyType,
        payment: newPayment,
        notes: newNotes,
        lastModified: new Date()
      });

      // إغلاق وضع التعديل بسلاسة
      const editBtn = document.getElementById('edit-invoice-btn');
      const saveBtn = document.getElementById('save-invoice-edit');
      editContainer.style.animation = 'slideUp 0.3s ease-out';

      setTimeout(() => {
        if (editContainer && editContainer.parentElement) editContainer.remove();
        editBtn.innerHTML = '<i class="fa fa-edit"></i> تعديل';
        editBtn.style.background = '#ff9800';
        saveBtn.style.display = 'none';
      }, 300);

      showNotification('✅ تم حفظ التعديلات بنجاح!', 'success');

      // إعادة تحميل البيانات بعد ثانية
      setTimeout(() => {
        modal.classList.remove('active');
        modal.style.display = 'none';
        loadInvoices();
      }, 1000);

    } catch (error) {
      console.error('خطأ في حفظ التعديلات:', error);
      showNotification('❌ حدث خطأ أثناء حفظ التعديلات: ' + error.message, 'error');
    }
  };

  // زر التعديل - إظهار/إخفاء الحقول القابلة للتعديل
  document.getElementById('edit-invoice-btn').onclick = () => {
    const editBtn = document.getElementById('edit-invoice-btn');
    const saveBtn = document.getElementById('save-invoice-edit');
    const existingContainer = document.getElementById('edit-fields-container');

    if (!existingContainer) {
      // تفعيل وضع التعديل
      const editContainer = document.createElement('div');
      editContainer.id = 'edit-fields-container';
      editContainer.style.cssText = 'background:linear-gradient(135deg, #f5f9ff 0%, #e3f2fd 100%);padding:20px;border-radius:12px;margin-top:15px;border:2px solid #1976d2;';

      const fields = [
        { id: 'edit-student', label: '👤 اسم الطالب', value: inv.student || '-', icon: 'fa-user' },
        { id: 'edit-phone', label: '📱 رقم الهاتف', value: inv.phone || '-', icon: 'fa-phone' },
        { id: 'edit-grade', label: '📚 الفرقة', value: inv.grade || '-', icon: 'fa-graduation-cap' },
        { id: 'edit-subType', label: '🎓 نوع الاشتراك', value: inv.subType || '-', icon: 'fa-book' },
        { id: 'edit-studyType', label: '✏️ الانتظام', value: inv.studyType || '-', icon: 'fa-pencil' },
        { id: 'edit-payment', label: '💳 طريقة الدفع', value: inv.payment || '-', icon: 'fa-credit-card' },
        { id: 'edit-notes', label: '📝 ملاحظات', value: inv.notes || '-', icon: 'fa-sticky-note' }
      ];

      fields.forEach(field => {
        const fieldDiv = document.createElement('div');
        fieldDiv.style.cssText = 'margin-bottom:15px;';

        const label = document.createElement('label');
        label.style.cssText = 'display:block;margin-bottom:8px;color:#1565c0;font-weight:bold;font-size:14px;padding-left:5px;';
        label.innerHTML = `<i class="fa ${field.icon}" style="margin-left:8px;"></i> ${field.label}`;

        const input = document.createElement('input');
        input.type = 'text';
        input.id = field.id;
        input.value = field.value;
        input.style.cssText = 'width:100%;padding:12px;border:2px solid #cde4ff;border-radius:8px;box-sizing:border-box;font-family:Arial;font-size:15px;transition:all 0.3s;';
        input.onfocus = function () { this.style.borderColor = '#1976d2'; this.style.boxShadow = '0 0 6px #1976d244'; };
        input.onblur = function () { this.style.borderColor = '#cde4ff'; this.style.boxShadow = 'none'; };

        fieldDiv.appendChild(label);
        fieldDiv.appendChild(input);
        editContainer.appendChild(fieldDiv);
      });

      (modal.querySelector('[style*="border-radius:18px"]') || modal.firstElementChild).appendChild(editContainer);

      editBtn.innerHTML = '<i class="fa fa-times"></i> إلغاء التعديل';
      editBtn.style.background = '#f44336';
      editBtn.style.transition = 'all 0.3s';
      saveBtn.style.display = 'flex';
      saveBtn.style.animation = 'slideDown 0.3s ease-out';

    } else {
      // إلغاء وضع التعديل
      existingContainer.style.animation = 'slideUp 0.3s ease-out';
      setTimeout(() => {
        if (existingContainer) existingContainer.remove();
      }, 300);

      editBtn.innerHTML = '<i class="fa fa-edit"></i> تعديل';
      editBtn.style.background = '#ff9800';
      saveBtn.style.display = 'none';
    }
  };

  // زر حفظ الفاتورة كصورة
  document.getElementById('download-invoice-btn').onclick = async () => {
    try {
      const element = document.getElementById('printable-invoice');
      if (!element) return showNotification('لم يتم العثور على عنصر الفاتورة', 'error');

      showNotification('جاري تحويل الفاتورة إلى صورة...', 'info');

      // استخدام html2canvas لتحويل العنصر إلى صورة
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';

      script.onload = async () => {
        const canvas = await html2canvas(element, {
          backgroundColor: '#ffffff',
          scale: 2,
          logging: false,
          allowTaint: true,
          useCORS: true
        });

        // تحويل الـ canvas إلى صورة وتحميلها
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = `فاتورة_${inv.num || 'بدون_رقم'}_${new Date().getTime()}.png`;
        link.click();

        showNotification('✓ تم حفظ الفاتورة كصورة بنجاح', 'success');
      };

      script.onerror = () => {
        showNotification('حدث خطأ في تحميل مكتبة التحويل', 'error');
      };

      document.head.appendChild(script);
    } catch (error) {
      console.error('Error downloading invoice:', error);
      showNotification('حدث خطأ أثناء حفظ الصورة', 'error');
    }
  };

  const confirmPaymentBtn = document.getElementById('confirm-payment-btn');
  if (confirmPaymentBtn) {
    confirmPaymentBtn.onclick = async () => {
      // إنشاء نافذة تأكيد لإدخال المبلغ المتبقي
      const dialog = document.createElement('div');
      dialog.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        padding: 24px;
        border-radius: 12px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.3);
        z-index: 99999;
        min-width: 300px;
        direction: rtl;
        text-align: right;
        font-family: Arial, sans-serif;
      `;

      const totalAmount = (inv.items || []).reduce((sum, x) => sum + (x.price || 0), 0);
      const paidAmount = inv.installment?.paid || 0;
      const remainingAmount = totalAmount - paidAmount;

      dialog.innerHTML = `
        <h3 style='color:#1976d2;margin-top:0;'>تأكيد استكمال الدفع</h3>
        <div style='margin:15px 0;line-height:1.8;'>
          <div><b>الإجمالي:</b> <span style='color:#388e3c;font-weight:bold;'>${totalAmount} ج</span></div>
          <div><b>المدفوع:</b> <span style='color:#f57f17;font-weight:bold;'>${paidAmount} ج</span></div>
          <div><b>المتبقي:</b> <span style='color:#e65100;font-weight:bold;'>${remainingAmount} ج</span></div>
        </div>
        <div style='margin:15px 0;'>
          <label style='display:block;margin-bottom:8px;'><b>المبلغ المدفوع الآن:</b></label>
          <input type='number' id='confirm-paid-amount' min='0' max='${remainingAmount}' value='${remainingAmount}' style='width:100%;padding:8px;border:2px solid #1976d2;border-radius:6px;font-size:14px;'>
        </div>
        <div style='display:flex;gap:10px;justify-content:center;'>
          <button id='confirm-yes' style='background:#43a047;color:#fff;padding:8px 20px;border:none;border-radius:6px;cursor:pointer;font-weight:bold;'>تأكيد</button>
          <button id='confirm-no' style='background:#e53935;color:#fff;padding:8px 20px;border:none;border-radius:6px;cursor:pointer;font-weight:bold;'>إلغاء</button>
        </div>
      `;

      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        z-index: 99998;
      `;

      document.body.appendChild(overlay);
      document.body.appendChild(dialog);

      document.getElementById('confirm-no').onclick = () => {
        overlay.remove();
        dialog.remove();
      };

      document.getElementById('confirm-yes').onclick = async () => {
        const newPaidAmount = parseInt(document.getElementById('confirm-paid-amount').value) || remainingAmount;
        const newRemainingAmount = totalAmount - (paidAmount + newPaidAmount);

        // تحديث الفاتورة
        await updateDoc(doc(db, 'invoices', id), {
          payment: newRemainingAmount <= 0 ? 'مدفوع كامل' : 'تقسيط',
          installment: {
            total: totalAmount,
            paid: paidAmount + newPaidAmount,
            remaining: Math.max(0, newRemainingAmount)
          }
        });

        overlay.remove();
        dialog.remove();
        showNotification('تم تحديث حالة الدفع بنجاح', 'success');
        setTimeout(() => showInvoiceModal(id), 300);
      };
    };
  }
}

// إشعار بسيط أعلى الصفحة
function showNotification(msg, type = 'info') {
  let notif = document.getElementById('global-notif');
  if (!notif) {
    notif = document.createElement('div');
    notif.id = 'global-notif';
    notif.style.position = 'fixed';
    notif.style.top = '30px';
    notif.style.left = '50%';
    notif.style.transform = 'translateX(-50%)';
    notif.style.zIndex = '9999';
    notif.style.minWidth = '180px';
    notif.style.padding = '14px 32px';
    notif.style.borderRadius = '10px';
    notif.style.fontSize = '17px';
    notif.style.fontWeight = 'bold';
    notif.style.boxShadow = '0 2px 16px #90caf988';
    notif.style.textAlign = 'center';
    document.body.appendChild(notif);
  }
  notif.textContent = msg;
  notif.style.background = type === 'success' ? '#43a047' : (type === 'error' ? '#e53935' : '#1976d2');
  notif.style.color = '#fff';
  notif.style.opacity = '1';
  notif.style.pointerEvents = 'auto';
  setTimeout(() => {
    notif.style.transition = 'opacity 0.7s';
    notif.style.opacity = '0';
    setTimeout(() => { if (notif) notif.remove(); }, 800);
  }, 1800);
}

// --- تصدير الفواتير إلى Excel ---
document.getElementById('export-excel-btn').onclick = function () {
  try {
    if (!filteredInvoices.length) {
      showNotification('لا توجد بيانات لتصديرها', 'error');
      return;
    }
    // تجهيز البيانات
    const data = filteredInvoices.map(inv => ({
      'رقم الفاتورة': inv.num,
      'اسم الطالب': inv.student,
      'رقم الهاتف': inv.phone,
      'العناصر': (inv.items || []).map(x => x.name + " (" + x.price + " ج)").join('، '),
      'نوع الاشتراك': inv.subType,
      'الفرقة': inv.grade,
      'المبلغ المدفوع': (inv.items || []).reduce((sum, x) => sum + (x.price || 0), 0),
      'نوع الفاتورة': inv.payment,
      'انتظام/انتساب': inv.studyType,
      'التاريخ': inv.date,
      'الملاحظات': inv.notes || '-'
    }));
    // إنشاء ملف Excel
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'الفواتير');
    XLSX.writeFile(wb, 'invoices.xlsx');
    showNotification('تم تصدير الفواتير إلى Excel بنجاح', 'success');
  } catch (e) {
    showNotification('حدث خطأ أثناء التصدير: ' + e.message, 'error');
  }
};

window.addEventListener("DOMContentLoaded", loadInvoices);
// تفعيل اختصارات لوحة المفاتيح
window.addEventListener('keydown', function (e) {
  // Ctrl+F للتركيز على البحث عن اسم الطالب
  if (e.ctrlKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    const searchInput = document.getElementById('search-student');
    if (searchInput) searchInput.focus();
  }
  // Ctrl+E لتصدير الفواتير إلى Excel
  if (e.ctrlKey && e.key.toLowerCase() === 'e') {
    e.preventDefault();
    const exportBtn = document.getElementById('export-excel-btn');
    if (exportBtn) exportBtn.click();
  }
  // Ctrl+P للبحث برقم الفاتورة
  if (e.ctrlKey && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    const numInput = document.getElementById('filter-invoice-num');
    if (numInput) numInput.focus();
  }
});

// تحسين إشعار حذف الفاتورة
window.deleteInvoice = async (id, isPortalRegistration = false) => {
  if (!id) return window.showNotification('لم يتم تحديد الفاتورة للحذف', 'error');
  const targetCollection = isPortalRegistration ? 'studentRegistrations' : 'invoices';
  // إشعار تأكيد قبل الحذف
  const confirmModal = document.createElement('div');
  confirmModal.style = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#0003;z-index:4000;display:flex;align-items:center;justify-content:center;';
  confirmModal.innerHTML = `
    <div style="background:#fff;padding:30px 24px;border-radius:14px;min-width:320px;max-width:90vw;box-shadow:0 4px 32px #90caf988;text-align:center;">
      <div style="font-size:1.2em;font-weight:bold;margin-bottom:18px;color:#e53935;">تأكيد حذف الفاتورة</div>
      <div style="margin-bottom:22px;">هل أنت متأكد أنك تريد حذف هذه الفاتورة نهائيًا؟</div>
      <div style="display:flex;gap:16px;justify-content:center;">
        <button id="confirm-delete-invoice" style="background:#e53935;color:#fff;padding:8px 28px;border:none;border-radius:8px;font-size:1em;font-weight:bold;cursor:pointer;">حذف</button>
        <button id="cancel-delete-invoice" style="background:#eee;color:#333;padding:8px 28px;border:none;border-radius:8px;font-size:1em;cursor:pointer;">إلغاء</button>
      </div>
    </div>
  `;
  document.body.appendChild(confirmModal);
  document.getElementById('cancel-delete-invoice').onclick = () => confirmModal.remove();
  document.getElementById('confirm-delete-invoice').onclick = async () => {
    try {
      await deleteDoc(doc(db, targetCollection, id));
      window.showNotification('<span style="font-size:1.15em;font-weight:bold;">تم حذف الفاتورة بنجاح</span>', 'success', 2500);
      loadInvoices();
    } catch (e) {
      window.showNotification('<span style="font-size:1.15em;font-weight:bold;">حدث خطأ أثناء الحذف: ' + (e.message || e) + '</span>', 'error', 3500);
    }
    confirmModal.remove();
  };
};

