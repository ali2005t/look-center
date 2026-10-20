// زر الطباعة في الكاشير
const printBtn = document.getElementById('print-btn');
if (printBtn) {
  printBtn.addEventListener('click', function () {
    // تهيئة printModal إذا لم يكن مهيأ
    if (!printModal) {
      printModal = document.getElementById('print-modal');
    }
    if (printModal) printModal.style.display = 'flex';

    // ربط زر تأكيد الطباعة
    const confirmPrintBtn = document.getElementById('confirm-print');
    const cancelPrintBtn = document.getElementById('cancel-print');

    if (confirmPrintBtn) {
      confirmPrintBtn.onclick = function () {
        printInvoice();
      };
    }

    if (cancelPrintBtn) {
      cancelPrintBtn.onclick = function () {
        if (printModal) printModal.style.display = 'none';
      };
    }
  });
}
import { db } from './firebase.js';
import { collection, getDocs, addDoc, Timestamp, doc, getDoc, updateDoc, query, where, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const isVipMode = new URLSearchParams(window.location.search).get('vip') === 'true';
let selectedGrade = "";
let selectedSubType = "";
let selectedItems = [];
// متغير جديد لتخزين العناصر حسب نوع الاشتراك
let itemsBySubType = {};
let vipOriginalPriceCustomized = false;
let vipFinalPriceCustomized = false;

// تعريف متغير printModal بشكل عام ليكون متاحاً في جميع أنحاء الملف
let printModal = null;

// المتغيرات اللازمة للتحكم بنموذج التقسيط
const installmentFields = document.getElementById('installment-fields');
const paymentMethod = document.getElementById('payment-method');

if (paymentMethod && installmentFields) {
  paymentMethod.addEventListener('change', function () {
    if (this.value === 'تقسيط') {
      installmentFields.style.display = '';
    } else {
      installmentFields.style.display = 'none';
      // إعادة تعيين الحقول عند الإخفاء
      installmentFields.querySelectorAll('input,select').forEach(el => {
        if (el.type === 'number' || el.type === 'date') el.value = '';
        if (el.tagName === 'SELECT') el.selectedIndex = 0;
      });
    }
  });
}

// معالج الحساب التلقائي للمتبقي في التقسيط
const installmentPaidInput = document.getElementById('installment-paid');
const installmentTotalInput = document.getElementById('installment-total');
const installmentRemainingInput = document.getElementById('installment-remaining');

if (installmentPaidInput && installmentTotalInput && installmentRemainingInput) {
  // دالة حساب المتبقي
  function calculateRemaining() {
    const total = parseInt(installmentTotalInput.value) || 0;
    const paid = parseInt(installmentPaidInput.value) || 0;
    const remaining = Math.max(0, total - paid); // التأكد من عدم الحصول على قيمة سالبة
    installmentRemainingInput.value = remaining;
    updateInvoicePreview(); // تحديث المعاينة عند تغيير المتبقي
  }

  // إضافة معالج لحقل المبلغ المدفوع
  installmentPaidInput.addEventListener('input', calculateRemaining);

  // إضافة معالج لحقل الإجمالي
  installmentTotalInput.addEventListener('input', calculateRemaining);
}

// متغير عالمي لاسم المستلم (يتم تحديثه من فايربيس)
let currentRecipient = '-';

function normalizeRecipientName(value) {
  const text = String(value || '').trim();
  if (!text || text.includes('@')) return '';
  return text.replace(/\s+/g, ' ');
}

async function loadVipAssignedTeacher() {
  try {
    const settingsSnapshot = await getDoc(doc(db, 'settings', 'main'));
    if (settingsSnapshot.exists()) {
      const teacher = String(settingsSnapshot.data().vipAssignedTeacher || '').trim();
      localStorage.setItem('vipAssignedTeacher', teacher);
      return teacher;
    }
  } catch (error) {
    console.warn('تعذر تحميل الأستاذ المسؤول عن VIP:', error);
  }
  return localStorage.getItem('vipAssignedTeacher') || '';
}

// رقم الفاتورة الحالي
let nextInvoiceNumber = 1;

// تحديث اسم المستخدم في الـ header
function updateUserNameInHeader() {
  const auth = getAuth();
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      try {
        let username = user.email;
        const snapshot = await getDocs(collection(db, "users"));
        snapshot.forEach(docSnap => {
          const u = docSnap.data();
          if (u.email === user.email) {
            username = u.username;
          }
        });

        const centerName = document.getElementById('center-name');
        if (centerName) {
          centerName.textContent = 'مرحباً ' + username;
        }

        // حفظ في localStorage
        localStorage.setItem('currentUserName', username);
      } catch (error) {
        console.error('Error fetching user name:', error);
        const centerName = document.getElementById('center-name');
        if (centerName) {
          centerName.textContent = 'مرحباً المستخدم';
        }
      }
    }
  });
}

// جلب اسم المستخدم الحالي من فايربيس (Firestore) بناءً على uid من Auth
async function fetchCurrentRecipient() {
  const cachedUsername = normalizeRecipientName(localStorage.getItem('currentUsername')) ||
    normalizeRecipientName(localStorage.getItem('currentUserName'));

  try {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user || !user.uid) {
      currentRecipient = cachedUsername || 'غير محدد';
      updateInvoicePreview();
      return currentRecipient;
    }

    const usersSnapshot = await getDocs(collection(db, 'users'));
    const profileDoc = usersSnapshot.docs.find(userDoc => {
      const profile = userDoc.data();
      return userDoc.id === user.uid ||
        String(profile.email || '').trim().toLowerCase() === String(user.email || '').trim().toLowerCase();
    });
    const data = profileDoc ? profileDoc.data() : {};
    let username = normalizeRecipientName(data.username || data.fullname || data.name);

    if (!username) {
      username = normalizeRecipientName(user.displayName);
    }
    if (!username) {
      username = cachedUsername;
    }
    if (!username) {
      username = normalizeRecipientName(user.email?.replace(/@.*$/, ''));
    }
    username = username || 'غير محدد';

    localStorage.setItem('currentUserName', username);
    localStorage.setItem('currentUsername', username);
    currentRecipient = username;
    console.log('Current recipient:', currentRecipient);
  } catch (error) {
    console.error('Error fetching recipient:', error);
    currentRecipient = cachedUsername || 'غير محدد';
  }
  updateInvoicePreview();
  return currentRecipient;
}

async function fetchCurrentUserAccess() {
  const user = getAuth().currentUser;
  if (user) {
    const usersSnapshot = await getDocs(collection(db, 'users'));
    const userRecord = usersSnapshot.docs.find(userDoc => {
      const profile = userDoc.data();
      return userDoc.id === user.uid ||
        String(profile.email || '').trim().toLowerCase() === String(user.email || '').trim().toLowerCase();
    });
    if (userRecord) {
      const profile = userRecord.data();
      const permissions = Array.isArray(profile.permissions) ? profile.permissions : [];
      localStorage.setItem('userPermissions', JSON.stringify(permissions));
      localStorage.setItem('userType', profile.type || '');
      return { permissions, type: profile.type || '' };
    }
  }

  let permissions = [];
  try {
    permissions = JSON.parse(localStorage.getItem('userPermissions') || '[]');
  } catch (error) {
    console.error('Could not read cached user permissions:', error);
  }
  return { permissions: Array.isArray(permissions) ? permissions : [], type: localStorage.getItem('userType') || '' };
}

// مراقبة حالة تسجيل الدخول وتحديث اسم المستلم تلقائياً
const auth = getAuth();
onAuthStateChanged(auth, (user) => {
  if (user && user.uid) {
    fetchCurrentRecipient();
  } else {
    currentRecipient = 'غير محدد';
    updateInvoicePreview();
  }
});

const studentLookupInput = document.getElementById('student-lookup-input');
const studentLookupResults = document.getElementById('student-lookup-results');
const studentProfileModal = document.getElementById('student-profile-modal');
const studentProfileContent = document.getElementById('student-profile-content');
let studentLookupTimer;
let studentLookupGroups = new Map();
let studentProfileDeliveryTargets = new Map();
let studentLookupRecordsCache = null;
let studentLookupSearchRequestId = 0;
let studentProfileInvoiceTargets = new Map();

function normalizeStudentPhone(value) {
  let digits = String(value || '')
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('20') && digits.length >= 12) digits = `0${digits.slice(-10)}`;
  return digits;
}

function normalizeStudentText(value) {
  return String(value || '').trim().toLocaleLowerCase('ar')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ');
}

function escapeStudentHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function studentRecordDate(record) {
  const value = record.isPortalRegistration
    ? (record.data.registeredAt || record.data.createdAt || record.data.date)
    : (record.data.date || record.data.createdAt);
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function profileDateLabel(date) {
  return date ? new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(date) : 'التاريخ غير مسجل';
}

function profileDateTimeLabel(date) {
  return date
    ? new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : 'الوقت غير مسجل';
}

function normalizeProfileReference(value) {
  if (value && typeof value === 'object') value = value.id || value.name || value.value;
  return normalizeStudentText(value);
}

function makeStudentRecord(docSnap, isPortalRegistration) {
  const data = docSnap.data();
  const items = isPortalRegistration
    ? (data.selectedSubscriptions || data.subscriptions || data.selectedItems || [])
    : (data.items || []);
  const student = isPortalRegistration ? (data.studentName || data.student || '') : (data.student || data.studentName || '');
  const phone = data.phone || data.studentPhone || '';
  const itemTypes = new Set(items.map(item => String(item.type || item.subType || '').trim()));
  const hasBookletSubscription = [...itemTypes].some(type => type.includes('ملازم'));
  const hasCourseSubscription = [...itemTypes].some(type => type.includes('كورسات'));
  const portalSubType = hasBookletSubscription && hasCourseSubscription
    ? 'ملازم وكورسات'
    : hasBookletSubscription
      ? 'ملازم'
      : hasCourseSubscription
        ? 'كورسات'
        : 'تسجيل من الموقع';
  return {
    id: docSnap.id,
    collection: isPortalRegistration ? 'studentRegistrations' : 'invoices',
    isPortalRegistration,
    data,
    student: String(student).trim(),
    phone: String(phone).trim(),
    grade: String(data.grade || '').trim(),
    subType: String(data.subType || (isPortalRegistration ? portalSubType : '')).trim(),
    items: Array.isArray(items) ? items : []
  };
}

async function loadStudentLookupRecords() {
  if (studentLookupRecordsCache) return studentLookupRecordsCache;
  const [invoicesSnapshot, registrationsSnapshot] = await Promise.all([
    getDocs(collection(db, 'invoices')),
    getDocs(collection(db, 'studentRegistrations'))
  ]);
  studentLookupRecordsCache = [
    ...invoicesSnapshot.docs.map(docSnap => makeStudentRecord(docSnap, false)),
    ...registrationsSnapshot.docs.map(docSnap => makeStudentRecord(docSnap, true))
  ].filter(record => record.student || record.phone);
  return studentLookupRecordsCache;
}

function studentGroupKey(record) {
  const phone = normalizeStudentPhone(record.phone);
  if (phone) return `phone:${phone}`;
  return `student:${normalizeStudentText(record.student)}:${normalizeStudentText(record.grade)}`;
}

function renderStudentLookupResults(queryText) {
  if (!studentLookupResults) return;
  const textQuery = normalizeStudentText(queryText);
  const phoneQuery = normalizeStudentPhone(queryText);
  if (!textQuery) {
    studentLookupResults.replaceChildren();
    return;
  }

  const groups = [...studentLookupGroups.entries()].map(([key, records]) => {
    const newest = [...records].sort((first, second) =>
      (studentRecordDate(second)?.getTime() || 0) - (studentRecordDate(first)?.getTime() || 0)
    )[0];
    return { key, records, newest };
  }).filter(group => {
    const nameMatches = normalizeStudentText(group.newest.student).includes(textQuery);
    const phoneMatches = phoneQuery.length >= 2 && normalizeStudentPhone(group.newest.phone).includes(phoneQuery);
    return nameMatches || phoneMatches;
  }).sort((first, second) => first.newest.student.localeCompare(second.newest.student, 'ar'))
    .slice(0, 8);

  studentLookupResults.replaceChildren();
  if (!groups.length) {
    const empty = document.createElement('div');
    empty.className = 'student-lookup-empty';
    empty.textContent = 'لم يتم العثور على طالب بهذا الاسم أو الرقم.';
    studentLookupResults.appendChild(empty);
    return;
  }
  groups.forEach(group => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'student-lookup-result';
    button.setAttribute('role', 'option');
    button.dataset.studentKey = group.key;
    const name = document.createElement('strong');
    name.textContent = group.newest.student || 'طالب بدون اسم';
    const details = document.createElement('small');
    const grades = [...new Set(group.records.map(record => record.grade).filter(Boolean))];
    details.textContent = `${group.newest.phone || 'بدون هاتف'} · ${grades.join('، ') || 'الفرقة غير مسجلة'} · ${group.records.length} سجل`;
    button.append(name, details);
    studentLookupResults.appendChild(button);
  });
}

function getStudentLinkedBooklets(invoiceRecord, subscriptionDocs) {
  const invoice = invoiceRecord.data;
  const parentItems = invoiceRecord.isPortalRegistration
    ? invoiceRecord.items
    : (invoiceRecord.items.length ? invoiceRecord.items : (invoice.indivNotes || []));
  const parentReferences = new Set(parentItems.flatMap(item => [item.id, item.name])
    .map(normalizeProfileReference).filter(Boolean));
  const invoiceGrade = normalizeStudentText(invoiceRecord.grade);
  const previousDelivery = new Map((invoice.indivNotes || []).map(note => [
    note.noteId || note.name,
    note.delivered === true
  ]));

  return subscriptionDocs.filter(subscriptionDoc => {
    const note = subscriptionDoc.data();
    const noteGrade = normalizeStudentText(note.grade);
    const noteLinkedSubs = Array.isArray(note.linkedSubscriptions) && note.linkedSubscriptions.length
      ? note.linkedSubscriptions
      : String(note.linkedSubscription || '').split(',').map(s => s.trim()).filter(Boolean);
    return String(note.type || '').trim() === 'ملازم فردية'
      && (!invoiceGrade || !noteGrade || noteGrade === invoiceGrade)
      && noteLinkedSubs.some(s => parentReferences.has(normalizeProfileReference(s)));
  }).map(subscriptionDoc => {
    const note = subscriptionDoc.data();
    return {
      id: subscriptionDoc.id,
      name: note.name || 'ملزمة',
      delivered: previousDelivery.get(subscriptionDoc.id) === true || previousDelivery.get(note.name) === true,
      sortOrder: Number(note.sortOrder) || Number.MAX_SAFE_INTEGER
    };
  }).sort((first, second) => first.sortOrder - second.sortOrder
    || String(first.name || '').localeCompare(String(second.name || ''), 'ar', { numeric: true, sensitivity: 'base' }));
}

async function openStudentProfile(studentKey) {
  const baseRecords = studentLookupGroups.get(studentKey);
  if (!baseRecords?.length || !studentProfileModal || !studentProfileContent) return;
  studentProfileModal.hidden = false;
  studentProfileContent.innerHTML = '<div class="student-profile-loading">جاري تحميل ملف الطالب...</div>';
  studentProfileDeliveryTargets = new Map();
  studentProfileInvoiceTargets = new Map();

  try {
    const [invoiceSnapshot, registrationSnapshot, subscriptionSnapshot, onlineCardsSnapshot, usersSnapshot] = await Promise.all([
      getDocs(collection(db, 'invoices')),
      getDocs(collection(db, 'studentRegistrations')),
      getDocs(collection(db, 'subscriptions')),
      getDocs(collection(db, 'onlineCards')),
      getDocs(collection(db, 'users'))
    ]);
    const userNamesById = new Map(usersSnapshot.docs.map(userDoc => {
      const user = userDoc.data();
      return [userDoc.id, user.username || user.fullname || user.name || user.email || userDoc.id];
    }));
    const records = [
      ...invoiceSnapshot.docs.map(docSnap => makeStudentRecord(docSnap, false)),
      ...registrationSnapshot.docs.map(docSnap => makeStudentRecord(docSnap, true))
    ].filter(record => studentGroupKey(record) === studentKey)
      .sort((first, second) => (studentRecordDate(second)?.getTime() || 0) - (studentRecordDate(first)?.getTime() || 0));
    if (!records.length) throw new Error('لم تعد هناك سجلات لهذا الطالب');

    const newest = records[0];
    studentProfileModal.dataset.studentName = newest.student || '';
    studentProfileModal.dataset.studentPhone = newest.phone || '';
    const subscriptionDatedRecords = records.filter(record => record.isPortalRegistration
      ? record.items.length > 0
      : !['ملازم فردية', 'محاضرات فردية'].includes(record.subType));
    const datedRecords = subscriptionDatedRecords.map(record => studentRecordDate(record)).filter(Boolean);
    const firstDate = datedRecords.length
      ? new Date(Math.min(...datedRecords.map(date => date.getTime())))
      : null;
    const grades = [...new Set(records.map(record => record.grade).filter(Boolean))];
    const subscriptionNames = [...new Set(records.flatMap(record => record.items
      .filter(item => item.type || item.subType || record.isPortalRegistration)
      .map(item => item.name || item.title || ''))
      .concat(records.filter(record => !record.isPortalRegistration).map(record => record.subType))
      .filter(name => name && name !== 'تسجيل من الموقع'))];
    const outstanding = records.reduce((total, record) => {
      const remaining = Number(record.data.installment?.remaining);
      return total + (Number.isFinite(remaining) && remaining > 0 ? remaining : 0);
    }, 0);
    const subscriptionDocs = subscriptionSnapshot.docs;
    const onlineCardRecords = onlineCardsSnapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    const deliveryControlsByRecord = records.map(() => []);
    const bookletDeliveryCards = [];

    const invoicesHtml = records.map((record, recordIndex) => {
      const date = studentRecordDate(record);
      const creator = [
        record.data.recipient,
        record.data.createdBy,
        record.data.createdByName,
        userNamesById.get(record.data.agentId),
        record.data.agentId
      ].map(value => String(value || '').trim()).find(value => value && value !== '-') || 'غير مسجل';
      const itemNames = record.items.map(item => item.name || item.title).filter(Boolean).join('، ');
      const isPaid = record.isPortalRegistration
        ? record.data.paymentStatus === 'paid'
        : record.data.payment !== 'تقسيط' || Number(record.data.installment?.remaining || 0) <= 0;
      const payment = record.isPortalRegistration
        ? (isPaid ? 'مدفوع' : 'غير مدفوع')
        : (record.data.payment || 'غير محدد');
      const itemsAmount = record.items.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
      const amount = record.isPortalRegistration
        ? Number(record.data.requestedAmount ?? record.data.paidAmount ?? itemsAmount) || 0
        : record.data.isVip
          ? Number(record.data.vipFinalPrice ?? itemsAmount) || 0
          : itemsAmount;
      const invoiceKey = `${record.collection}:${record.id}`;
      studentProfileInvoiceTargets.set(invoiceKey, {
        ...record.data,
        student: record.student || '-',
        phone: record.phone || '',
        subType: record.subType,
        items: record.items,
        date: record.isPortalRegistration
          ? (record.data.registeredAt || record.data.createdAt || record.data.date)
          : record.data.date,
        num: record.data.num || record.data.invoiceNumber || '-',
        payment: record.isPortalRegistration
          ? (record.data.paymentMethod || record.data.payment || 'نقدي')
          : record.data.payment,
        isVip: record.data.isVip === true,
        isIndividualInvoice: ['ملازم فردية', 'محاضرات فردية'].includes(record.subType)
      });
      return `<article class="student-profile-invoice">
        <div class="student-profile-invoice-head">
          <div class="student-profile-invoice-title">
            <span class="student-invoice-number">#${escapeStudentHtml(record.data.num || record.data.invoiceNumber || records.length - recordIndex)}</span>
            <div><strong>${escapeStudentHtml(record.subType || 'فاتورة')}</strong></div>
          </div>
        </div>
        <div class="student-profile-invoice-details">
          <div class="student-profile-invoice-meta"><i class="fas fa-calendar-clock" aria-hidden="true"></i><span>${escapeStudentHtml(profileDateTimeLabel(date))}</span></div>
          <div class="student-profile-invoice-meta"><i class="fas fa-user-check" aria-hidden="true"></i><span>سجّل الاشتراك: <strong>${escapeStudentHtml(creator)}</strong></span></div>
          <span class="student-payment-badge ${isPaid ? 'is-paid' : 'is-unpaid'}">${escapeStudentHtml(payment)}</span>
        </div>
        <p class="student-profile-invoice-items"><i class="fas fa-book-open" aria-hidden="true"></i> ${escapeStudentHtml(itemNames || record.data.subscriptionFallback || 'لا توجد تفاصيل عناصر')}</p>
        <div class="student-profile-invoice-footer">
          <strong>${amount.toFixed(2)} ج</strong>
          <button type="button" class="student-profile-print-invoice" data-print-invoice="${escapeStudentHtml(invoiceKey)}">
            <i class="fas fa-print" aria-hidden="true"></i> طباعة الفاتورة
          </button>
          <!--STUDENT_DELIVERY_${recordIndex}-->
        </div>
      </article>`;
    }).join('');

    let deliveredBookletsCount = 0;
    let onlineCardsCount = 0;
    records.forEach((record, recordIndex) => {
      const sourceRef = `${record.collection}:${record.id}`;
      const isNotesSubscription = ['ملازم', 'اشتراك ملازم', 'ملازم وكورسات'].includes(record.subType);
      if (isNotesSubscription) {
        getStudentLinkedBooklets(record, subscriptionDocs).forEach(note => {
          if (note.delivered) deliveredBookletsCount += 1;
          const targetKey = `${sourceRef}:linked:${note.id}`;
          studentProfileDeliveryTargets.set(targetKey, { record, kind: 'linked', noteId: note.id, noteName: note.name });
          bookletDeliveryCards.push(`<div class="student-booklet-delivery-card">
            <label><input type="checkbox" data-delivery-key="${escapeStudentHtml(targetKey)}" ${note.delivered ? 'checked' : ''}>
              <span>${escapeStudentHtml(note.name)}</span></label>
            <small>${note.delivered ? 'تم الاستلام' : 'لم يستلم'} · فاتورة ${escapeStudentHtml(record.data.num || record.data.invoiceNumber || '—')}</small>
          </div>`);
        });
      }
      if (record.subType === 'ملازم فردية') {
        record.items.forEach((item, itemIndex) => {
          if (item.delivered === true) deliveredBookletsCount += 1;
          const targetKey = `${sourceRef}:item:${itemIndex}`;
          studentProfileDeliveryTargets.set(targetKey, { record, kind: 'item', itemIndex, noteName: item.name || 'ملزمة' });
          bookletDeliveryCards.push(`<div class="student-booklet-delivery-card">
            <label><input type="checkbox" data-delivery-key="${escapeStudentHtml(targetKey)}" ${item.delivered === true ? 'checked' : ''}>
              <span>${escapeStudentHtml(item.name || 'ملزمة')}</span></label>
            <small>${item.delivered === true ? 'تم الاستلام' : 'لم يستلم'} · فاتورة ${escapeStudentHtml(record.data.num || record.data.invoiceNumber || '—')}</small>
          </div>`);
        });
      }
      const isSubscriptionInvoice = ['ملازم', 'اشتراك ملازم', 'ملازم وكورسات', 'كورسات', 'اشتراك كورسات']
        .includes(record.subType);
      const savedCardDeliveries = isSubscriptionInvoice && Array.isArray(record.data.onlineCardsDelivery)
        ? record.data.onlineCardsDelivery.filter(card => !card.type || card.type === 'للاشتراكات')
        : [];
      const invoiceSubscriptionIds = new Set(record.items.map(item => item.id).filter(Boolean));
      const cardDeliveries = !isSubscriptionInvoice
        ? []
        : savedCardDeliveries.length
        ? savedCardDeliveries
        : onlineCardRecords.flatMap(card => {
          if (card.type !== 'للاشتراكات') return [];
          const linkedIds = Array.isArray(card.linkedSubscriptionIds) ? card.linkedSubscriptionIds : [];
          const matchedItems = record.items.filter(item =>
            item.id && (!linkedIds.length || linkedIds.includes(item.id))
          );
          if (!matchedItems.length || (linkedIds.length && !linkedIds.some(id => invoiceSubscriptionIds.has(id)))) return [];
          const linkedSubscriptionIds = matchedItems.map(item => item.id);
          return [{
            id: card.id,
            cardId: card.id,
            name: card.name || 'كارت أونلاين',
            type: card.type,
            perSub: Math.max(1, Number(card.perSub) || 1),
            quantity: matchedItems.length * Math.max(1, Number(card.perSub) || 1),
            linkedSubscriptionIds,
            delivered: false
          }];
        });
      cardDeliveries.forEach(card => {
        const cardId = card.cardId || card.id;
        if (!cardId) return;
        const delivered = card.delivered === true || card.isDelivered === true;
        if (delivered) onlineCardsCount += Number(card.quantity) || 1;
        const targetKey = `${sourceRef}:card:${cardId}`;
        const cardInfo = {
          ...card,
          id: cardId,
          cardId,
          name: card.name || 'كارت أونلاين',
          perSub: Math.max(1, Number(card.perSub) || 1),
          quantity: Math.max(1, Number(card.quantity) || 1),
          linkedSubscriptionIds: Array.isArray(card.linkedSubscriptionIds) ? card.linkedSubscriptionIds : []
        };
        studentProfileDeliveryTargets.set(targetKey, { record, kind: 'card', cardInfo });
        deliveryControlsByRecord[recordIndex].push(`<label class="student-profile-delivery-toggle student-profile-card-toggle ${delivered ? 'is-delivered' : ''}" title="${escapeStudentHtml(cardInfo.name)} · ${delivered ? 'استلم الكارت' : 'لم يستلم الكارت'}">
          <input type="checkbox" data-delivery-key="${escapeStudentHtml(targetKey)}" ${delivered ? 'checked' : ''} aria-label="${delivered ? 'إلغاء استلام' : 'تسجيل استلام'} ${escapeStudentHtml(cardInfo.name)}">
          <i class="fas fa-id-card" aria-hidden="true"></i><span>${escapeStudentHtml(cardInfo.name)} · ${delivered ? 'استلم' : 'لم يستلم'}</span>
        </label>`);
      });
    });
    const invoicesWithDeliveryControls = invoicesHtml.replace(/<!--STUDENT_DELIVERY_(\d+)-->/g, (_placeholder, index) =>
      deliveryControlsByRecord[Number(index)].join('')
    );

    const gradeOptions = grades.map(grade =>
      `<option value="${escapeStudentHtml(grade)}" ${grade === (newest.grade || grades[0]) ? 'selected' : ''}>${escapeStudentHtml(grade)}</option>`
    ).join('');
    const initials = (newest.student || 'ط').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('');
    const normalizedPhone = normalizeStudentPhone(newest.phone);
    studentProfileContent.innerHTML = `
      <header class="student-profile-header">
        <div class="student-profile-identity">
          <span class="student-profile-avatar" aria-hidden="true">${escapeStudentHtml(initials)}</span>
          <div class="student-profile-identity-main">
            <span class="student-profile-kicker">ملف الطالب</span>
            <h2 id="student-profile-name">${escapeStudentHtml(newest.student || 'ملف الطالب')}</h2>
            <div class="student-profile-meta">
              ${newest.phone
                ? `<a href="tel:${escapeStudentHtml(normalizedPhone)}"><i class="fas fa-phone" aria-hidden="true"></i> ${escapeStudentHtml(newest.phone)}</a>`
                : '<span>الهاتف غير مسجل</span>'}
              <span><i class="fas fa-graduation-cap" aria-hidden="true"></i> ${escapeStudentHtml(grades.join('، ') || 'الفرقة غير مسجلة')}</span>
            </div>
          </div>
        </div>
        <div class="student-profile-subscriptions">
          <strong><i class="fas fa-book-open" aria-hidden="true"></i> الاشتراكات:</strong>
          ${subscriptionNames.map(name => `<span>${escapeStudentHtml(name)}</span>`).join('') || '<span>لا توجد اشتراكات مسجلة</span>'}
        </div>
      </header>
      <div class="student-profile-summary">
        <div class="student-profile-stat"><span class="student-stat-icon"><i class="fas fa-calendar-check" aria-hidden="true"></i></span><div><small>أول اشتراك مسجل</small><strong>${escapeStudentHtml(profileDateLabel(firstDate))}</strong></div></div>
        <div class="student-profile-stat"><span class="student-stat-icon"><i class="fas fa-file-invoice" aria-hidden="true"></i></span><div><small>الفواتير والسجلات</small><strong>${records.length}</strong></div></div>
        <div class="student-profile-stat"><span class="student-stat-icon"><i class="fas fa-money-bill-wave" aria-hidden="true"></i></span><div><small>المتبقي في الأقساط المسجلة</small><strong>${outstanding.toFixed(2)} ج</strong></div></div>
        <div class="student-profile-stat"><span class="student-stat-icon"><i class="fas fa-box-open" aria-hidden="true"></i></span><div><small>الملازم / كروت الأونلاين المستلمة</small><strong>${deliveredBookletsCount} ملزمة · ${onlineCardsCount} كارت</strong></div></div>
      </div>
      <div class="student-profile-actions">
        <select id="student-profile-grade" aria-label="اختر الفرقة للفاتورة الجديدة">
          <option value="">اختر الفرقة للفاتورة الجديدة</option>${gradeOptions}
        </select>
        <button type="button" id="student-profile-new-invoice"><i class="fas fa-file-invoice" aria-hidden="true"></i> فاتورة جديدة</button>
      </div>
      <section class="student-profile-section">
        <div class="student-profile-section-heading"><div><span class="student-profile-kicker">BOOKLET DELIVERY</span><h3>استلام الملازم</h3></div><span class="student-section-count">${bookletDeliveryCards.length} ملزمة</span></div>
        ${bookletDeliveryCards.length ? `<div class="student-booklet-delivery-list">${bookletDeliveryCards.join('')}</div>` : '<div class="student-profile-empty"><i class="fas fa-box-open" aria-hidden="true"></i><span>لا توجد ملازم مرتبطة باشتراكات هذا الطالب لعرض حالة استلامها.</span></div>'}
      </section>
      <section class="student-profile-section">
        <div class="student-profile-section-heading"><div><span class="student-profile-kicker">STUDENT HISTORY</span><h3>سجل الاشتراكات والفواتير</h3></div><span class="student-section-count">${records.length} سجل</span></div>
        <div class="student-profile-invoices-list">${invoicesWithDeliveryControls || '<div class="student-profile-empty">لا توجد فواتير مسجلة.</div>'}</div>
      </section>`;
  } catch (error) {
    console.error('تعذر تحميل ملف الطالب:', error);
    studentProfileContent.innerHTML = '<div class="student-profile-loading">تعذر تحميل ملف الطالب. تحقق من الاتصال والصلاحيات ثم حاول مرة أخرى.</div>';
  }
}

async function updateStudentBookletDelivery(checkbox) {
  const target = studentProfileDeliveryTargets.get(checkbox.dataset.deliveryKey);
  if (!target) return;
  checkbox.disabled = true;
  try {
    const invoiceRef = doc(db, target.record.collection, target.record.id);
    const deliveryResult = await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(invoiceRef);
      if (!snapshot.exists()) throw new Error('سجل الفاتورة غير موجود');
      const data = snapshot.data();
      if (target.kind === 'linked') {
        if (!target.noteId) throw new Error('Missing booklet subscription id.');
        const notes = Array.isArray(data.indivNotes) ? [...data.indivNotes] : [];
        const noteIndex = notes.findIndex(note => (note.noteId || note.name) === target.noteId || note.name === target.noteName);
        const wasDelivered = noteIndex >= 0 && notes[noteIndex].delivered === true;
        if (wasDelivered === checkbox.checked) return { changed: false, stock: null };
        const updatedNote = { noteId: target.noteId, name: target.noteName, delivered: checkbox.checked };
        if (noteIndex < 0) notes.push(updatedNote); else notes[noteIndex] = { ...notes[noteIndex], ...updatedNote };
        const deferBookletStock = data.bookletStockDeducted === false || data.vipStockDeducted === false;
        if (!deferBookletStock) {
          transaction.update(invoiceRef, { indivNotes: notes });
          return { changed: true, stock: null };
        }
        const noteRef = doc(db, 'subscriptions', target.noteId);
        const noteSnapshot = await transaction.get(noteRef);
        if (!noteSnapshot.exists()) throw new Error('Booklet inventory record not found.');
        const stock = (Number(noteSnapshot.data().stock) || 0) + (checkbox.checked ? -1 : 1);
        transaction.update(invoiceRef, { indivNotes: notes });
        transaction.update(noteRef, { stock });
        return { changed: true, stock };
      } else if (target.kind === 'card') {
        const cardRef = doc(db, 'onlineCards', target.cardInfo.cardId);
        const cardSnapshot = await transaction.get(cardRef);
        if (!cardSnapshot.exists()) throw new Error('كارت الأونلاين غير موجود في المخزون');
        const cards = Array.isArray(data.onlineCardsDelivery) ? [...data.onlineCardsDelivery] : [];
        const cardIndex = cards.findIndex(card => (card.cardId || card.id) === target.cardInfo.cardId);
        const currentCard = cardIndex >= 0 ? cards[cardIndex] : target.cardInfo;
        const wasDelivered = currentCard.delivered === true || currentCard.isDelivered === true;
        if (wasDelivered === checkbox.checked) return;
        const updatedCard = { ...currentCard, delivered: checkbox.checked };
        delete updatedCard.isDelivered;
        if (cardIndex >= 0) cards[cardIndex] = updatedCard;
        else cards.push(updatedCard);
        transaction.update(invoiceRef, { onlineCardsDelivery: cards });
        const currentStock = Number(cardSnapshot.data().stock) || 0;
        const quantity = Math.max(1, Number(updatedCard.quantity) || 1);
        transaction.update(cardRef, { stock: currentStock + (checkbox.checked ? -quantity : quantity) });
      } else {
        const items = Array.isArray(data.items) ? [...data.items] : [];
        if (!items[target.itemIndex]) throw new Error('الملزمة غير موجودة ضمن الفاتورة');
        const currentItem = items[target.itemIndex];
        if (currentItem.delivered === checkbox.checked) return { changed: false, stock: null };
        items[target.itemIndex] = { ...currentItem, delivered: checkbox.checked };
        const deferBookletStock = data.bookletStockDeducted === false || data.vipStockDeducted === false;
        if (deferBookletStock) {
          const noteId = target.noteId || currentItem.id || currentItem.subscriptionId;
          if (!noteId) throw new Error('Missing booklet inventory id.');
          const noteRef = doc(db, 'subscriptions', noteId);
          const noteSnapshot = await transaction.get(noteRef);
          if (!noteSnapshot.exists()) throw new Error('Booklet inventory record not found.');
          const stock = (Number(noteSnapshot.data().stock) || 0) + (checkbox.checked ? -1 : 1);
          transaction.update(invoiceRef, { items });
          transaction.update(noteRef, { stock });
          return { changed: true, stock };
        }
        transaction.update(invoiceRef, { items });
        return { changed: true, stock: null };
      }
    });
    studentLookupRecordsCache = null;
    if ((target.kind === 'linked' || target.kind === 'item') && deliveryResult?.changed && checkbox.checked && deliveryResult.stock < 0) {
      showNotification('\u062a\u0645 \u062a\u0633\u0644\u064a\u0645 \u0627\u0644\u0645\u0644\u0632\u0645\u0629\u060c \u0648\u0623\u0635\u0628\u062d \u0645\u062e\u0632\u0648\u0646\u0647\u0627 \u0628\u0627\u0644\u0633\u0627\u0644\u0628 (' + deliveryResult.stock + ').', 'info');
    } else {
      showNotification(
        target.kind === 'card'
          ? (checkbox.checked ? '\u062a\u0645 \u062a\u0633\u0644\u064a\u0645 \u0643\u0627\u0631\u062a \u0627\u0644\u0623\u0648\u0646\u0644\u0627\u064a\u0646 \u0648\u062e\u0635\u0645 \u0627\u0644\u0643\u0645\u064a\u0629 \u0645\u0646 \u0627\u0644\u0645\u062e\u0632\u0648\u0646' : '\u062a\u0645 \u0625\u0644\u063a\u0627\u0621 \u062a\u0633\u0644\u064a\u0645 \u0627\u0644\u0643\u0627\u0631\u062a \u0648\u0625\u0631\u062c\u0627\u0639 \u0627\u0644\u0643\u0645\u064a\u0629 \u0644\u0644\u0645\u062e\u0632\u0648\u0646')
          : (checkbox.checked ? (deliveryResult?.stock === null ? '\u062a\u0645 \u062a\u0633\u0644\u064a\u0645 \u0627\u0644\u0645\u0644\u0632\u0645\u0629' : '\u062a\u0645 \u062a\u0633\u0644\u064a\u0645 \u0627\u0644\u0645\u0644\u0632\u0645\u0629 \u0648\u062e\u0635\u0645 \u0643\u0645\u064a\u062a\u0647\u0627 \u0645\u0646 \u0627\u0644\u0645\u062e\u0632\u0648\u0646') : (deliveryResult?.stock === null ? '\u062a\u0645 \u0625\u0644\u063a\u0627\u0621 \u062a\u0633\u0644\u064a\u0645 \u0627\u0644\u0645\u0644\u0632\u0645\u0629' : '\u062a\u0645 \u0625\u0644\u063a\u0627\u0621 \u0627\u0644\u062a\u0633\u0644\u064a\u0645 \u0648\u0625\u0631\u062c\u0627\u0639 \u0643\u0645\u064a\u0629 \u0627\u0644\u0645\u0644\u0632\u0645\u0629 \u0644\u0644\u0645\u062e\u0632\u0648\u0646')),
        'success'
      );
    }
    await openStudentProfile(studentGroupKey(target.record));
  } catch (error) {
    console.error(target.kind === 'card' ? 'تعذر تحديث استلام كارت الأونلاين:' : 'تعذر تحديث استلام الملزمة:', error);
    checkbox.checked = !checkbox.checked;
    checkbox.disabled = false;
    showNotification(
      target.kind === 'card'
        ? 'تعذر تحديث حالة كارت الأونلاين أو مخزونه. حاول مرة أخرى.'
        : 'تعذر حفظ حالة استلام الملزمة. حاول مرة أخرى.',
      'error'
    );
  }
}

studentLookupInput?.addEventListener('input', () => {
  clearTimeout(studentLookupTimer);
  const queryText = studentLookupInput.value.trim();
  const requestId = ++studentLookupSearchRequestId;
  if (queryText.length < 2) {
    studentLookupResults?.replaceChildren();
    return;
  }
  studentLookupResults.innerHTML = '<div class="student-lookup-empty">جاري البحث...</div>';
  studentLookupTimer = setTimeout(async () => {
    try {
      const records = await loadStudentLookupRecords();
      if (requestId !== studentLookupSearchRequestId || studentLookupInput.value.trim() !== queryText) return;
      studentLookupGroups = new Map();
      records.forEach(record => {
        const key = studentGroupKey(record);
        const group = studentLookupGroups.get(key) || [];
        group.push(record);
        studentLookupGroups.set(key, group);
      });
      renderStudentLookupResults(queryText);
    } catch (error) {
      if (requestId !== studentLookupSearchRequestId) return;
      console.error('تعذر البحث عن الطالب:', error);
      studentLookupResults.innerHTML = '<div class="student-lookup-empty">تعذر البحث الآن. تحقق من الاتصال والصلاحيات.</div>';
    }
  }, 250);
});

studentLookupResults?.addEventListener('click', event => {
  const button = event.target.closest('.student-lookup-result');
  if (button) openStudentProfile(button.dataset.studentKey);
});

studentProfileModal?.addEventListener('click', event => {
  if (event.target === studentProfileModal) studentProfileModal.hidden = true;
});

studentProfileModal?.addEventListener('change', event => {
  const checkbox = event.target.closest('input[data-delivery-key]');
  if (checkbox) updateStudentBookletDelivery(checkbox);
});

document.getElementById('close-student-profile')?.addEventListener('click', () => {
  studentProfileModal.hidden = true;
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && studentProfileModal && !studentProfileModal.hidden) {
    studentProfileModal.hidden = true;
  }
});

studentProfileContent?.addEventListener('click', event => {
  const printButton = event.target.closest('[data-print-invoice]');
  if (printButton) {
    const invoice = studentProfileInvoiceTargets.get(printButton.dataset.printInvoice);
    if (!invoice) {
      showNotification('تعذر فتح بيانات الفاتورة للطباعة.', 'error');
      return;
    }
    window.lastSavedInvoice = invoice;
    printInvoice();
    return;
  }

  if (!event.target.closest('#student-profile-new-invoice')) return;
  const grade = document.getElementById('student-profile-grade')?.value || '';
  if (!grade) {
    showNotification('اختر الفرقة أولاً لتجهيز الفاتورة', 'warning');
    return;
  }
  const gradeButton = [...document.querySelectorAll('.grade-btn')].find(button => button.dataset.grade === grade);
  if (!gradeButton) {
    showNotification('تعذر تحديد الفرقة المختارة في نموذج الكاشير', 'error');
    return;
  }
  const studentName = studentProfileModal.dataset.studentName;
  const studentPhone = studentProfileModal.dataset.studentPhone;
  if (!studentName && !studentPhone) {
    showNotification('تعذر استعادة بيانات الطالب. أعد البحث عنه.', 'error');
    return;
  }
  itemsBySubType = {};
  selectedItems = [];
  window.selectedItems = [];
  gradeButton.click();
  document.getElementById('student-name').value = studentName || '';
  document.getElementById('phone').value = studentPhone || '';
  updateInvoicePreview();
  studentProfileModal.hidden = true;
  document.getElementById('invoice-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('student-name')?.focus({ preventScroll: true });
  showNotification('بيانات الطالب جاهزة. اختر العناصر وأكمل الفاتورة كالمعتاد.', 'info');
});

document.querySelectorAll('.grade-btn').forEach(btn => {
  if (btn) btn.addEventListener('click', () => {
    selectedGrade = btn.dataset.grade;
    document.getElementById('grade').value = selectedGrade;
    // إظهار قسم الأنواع عند اختيار فرقة
    document.getElementById('subs-section').style.display = 'flex';
    // إعادة تعيين اختيار النوع والعناصر عند تغيير الفرقة
    selectedSubType = '';
    document.getElementById('sub-type').value = '';
    selectedItems = [];
    document.getElementById('items-container').innerHTML = '';
    updateInvoicePreview();
  });
});

document.querySelectorAll('.sub-btn').forEach(btn => {
  if (btn) btn.addEventListener('click', async () => {
    selectedSubType = btn.dataset.type;
    document.getElementById('sub-type').value = selectedSubType;
    const items = await getItemsForSubType(selectedSubType, selectedGrade);
    showSelectableItems(items, selectedSubType);
  });
});

// تحويل اسم زر الاشتراك إلى اسم النوع في قاعدة البيانات
function mapSubTypeToDbType(subType) {
  if (!subType) return '';
  const normalized = String(subType).trim();
  if (normalized.startsWith('اشتراك ')) return normalized.replace(/^اشتراك\s+/, '');
  return normalized;
}

// جلب العناصر من فايربيس حسب النوع والفرقة (يدعم اختيار ملازم فردية أو محاضرات فردية من كل الاشتراكات)
async function getItemsForSubType(subType, grade) {
  if (!subType || !grade) return [];

  if (subType === "كروت فردية") {
    const snapshot = await getDocs(collection(db, "onlineCards"));
    const items = [];
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      // الكروت الفردية تظهر للكل بغض النظر عن الفرقة لسهولة الوصول، أو ممكن نفلترها لو حبيت
      if (data.type === "فردي") {
        items.push({ id: docSnap.id, name: data.name, price: data.price, stock: data.stock || 0, isOnlineCard: true });
      }
    });
    return items;
  }

  const snapshot = await getDocs(collection(db, "subscriptions"));
  const items = [];
  if (subType === "ملازم فردية") {
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      if (data.type === "ملازم فردية" && data.grade === grade && data.published === true) {
        items.push({
          id: docSnap.id,
          name: data.name,
          price: data.price,
          stock: data.stock || 0,
          linkedSubscription: data.linkedSubscription || '',
          sortOrder: Number(data.sortOrder) || null
        });
      }
    });
    const cardsSnapshot = await getDocs(collection(db, 'onlineCards'));
    cardsSnapshot.forEach(docSnap => {
      const card = docSnap.data();
      if (card.type !== 'فردي') return;
      const targetTypes = Array.isArray(card.individualSubTypes) ? card.individualSubTypes : ['محاضرات فردية', 'ملازم فردية'];
      if (targetTypes.includes(subType)) {
        items.push({
          id: docSnap.id,
          name: card.name,
          price: Number(card.price) || 0,
          stock: Number(card.stock) || 0,
          isOnlineCard: true
        });
      }
    });
    items.sort((first, second) =>
      Number(Boolean(first.isOnlineCard)) - Number(Boolean(second.isOnlineCard))
      || String(first.linkedSubscription || '').localeCompare(String(second.linkedSubscription || ''), 'ar', { numeric: true, sensitivity: 'base' })
      || (first.sortOrder || Number.MAX_SAFE_INTEGER) - (second.sortOrder || Number.MAX_SAFE_INTEGER)
      || String(first.name || '').localeCompare(String(second.name || ''), 'ar', { numeric: true, sensitivity: 'base' })
    );
  } else if (subType === "محاضرات فردية") {
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      if (data.type === "محاضرات فردية" && data.grade === grade && data.published === true) {
        items.push({ id: docSnap.id, name: data.name, price: data.price });
      }
    });
    const cardsSnapshot = await getDocs(collection(db, 'onlineCards'));
    cardsSnapshot.forEach(docSnap => {
      const card = docSnap.data();
      if (card.type !== 'فردي') return;
      const targetTypes = Array.isArray(card.individualSubTypes) ? card.individualSubTypes : ['محاضرات فردية', 'ملازم فردية'];
      if (targetTypes.includes(subType)) {
        items.push({
          id: docSnap.id,
          name: card.name,
          price: Number(card.price) || 0,
          stock: Number(card.stock) || 0,
          isOnlineCard: true
        });
      }
    });
  } else {
    const dbType = mapSubTypeToDbType(subType);
    const allowedTypes = new Set([dbType, subType]);
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const type = String(data.type || '').trim();
      if (allowedTypes.has(type) && data.grade === grade && data.published === true) {
        items.push({
          id: docSnap.id,
          name: data.name,
          price: data.price,
          ...(['ملازم', 'ملازم فردية'].includes(type) ? { stock: data.stock || 0 } : {})
        });
      }
    });
  }
  return items;
}

// تحديث معاينة الفاتورة الحية (عناصر مختارة)
function updateInvoicePreview() {
  const preview = document.getElementById('preview-box');
  if (!preview) return;
  const grade = selectedGrade;
  const studyType = document.getElementById('study-type')?.value || '';
  const vipBadge = isVipMode ? '<div style="margin:8px 0;display:inline-block;background:#ffb300;color:#1f2d3d;padding:6px 12px;border-radius:999px;font-weight:bold;">VIP</div>' : '';
  const subType = selectedSubType;
  const payment = document.getElementById('payment-method')?.value || '';
  const notes = document.getElementById('notes')?.value || '';
  let items = [];
  if (window.selectedItems && Array.isArray(window.selectedItems)) {
    items = window.selectedItems;
  }

  // حساب مجموع العناصر
  const totalAmount = items.reduce((sum, x) => sum + (+x.price || 0), 0);
  const vipSaleAmount = Number(document.getElementById('vip-final-price')?.value ?? totalAmount);
  const displayedAmount = isVipMode ? vipSaleAmount : totalAmount;

  // تحديث حقل الإجمالي في التقسيط تلقائياً
  if (payment === 'تقسيط') {
    const installmentTotalField = document.getElementById('installment-total');
    if (installmentTotalField && (!installmentTotalField.value || installmentTotalField.value === '')) {
      installmentTotalField.value = totalAmount;
    }
  }

  // استخدم اسم المستلم من فايربيس
  let recipient = currentRecipient || '-';
  // معاينة الفاتورة حسب النوع
  let html = `<div class="invoice-preview-modern">
    <h3 class='invoice-preview-title'>معاينة الفاتورة</h3>
    ${vipBadge}
    <div style='font-size:1.1em;color:#1976d2;font-weight:bold;margin-bottom:8px;display:flex;align-items:center;justify-content:center;gap:8px;'>
      رقم الفاتورة: <span id='invoice-num-preview'>${nextInvoiceNumber}</span>
      <button id='copy-invoice-num' style='background:#1976d2;color:#fff;border:none;border-radius:6px;padding:2px 10px;font-size:0.95em;cursor:pointer;'>نسخ</button>
    </div>`;

  // لا تستدعي fetchNextInvoiceNumber هنا لتجنب التكرار غير الضروري
  if (subType === 'محاضرات فردية' || subType === 'ملازم فردية') {
    html += `
      <div class='invoice-preview-grid'>
        <span>الفرقة:</span><span>${grade || '-'}</span>
        <span>نوع الاشتراك:</span><span>${subType || '-'}</span>
        <span>انتظام/انتساب:</span><span>${studyType || '-'}</span>
      </div>
      <div class='invoice-preview-items-box'>
          ${items.length ? `<ul class='invoice-preview-items-list'>${items.map(x => `<li><span class='preview-item-name' style='font-weight:500;'>${x.name}</span> <span class='preview-item-price' style='color:#388e3c;font-weight:bold;'>${x.price} ج</span></li>`).join('')}</ul>` : '<div>لا يوجد عناصر</div>'}
        <div class='invoice-preview-total'><b>${isVipMode ? 'سعر البيع VIP:' : 'المجموع:'}</b> <span>${displayedAmount} ج</span></div>
      </div>
      <div class='invoice-preview-grid'>
        <span>طريقة الدفع:</span><span>${payment || '-'}</span>
        <span>ملاحظات:</span><span>${notes || '-'}</span>
      </div>
      ${payment === 'تقسيط' ? `
      <div style='background:#fff8e1;border:2px solid #fbc02d;border-radius:6px;padding:10px;margin:10px 0;'>
        <div style='color:#f57f17;font-weight:bold;margin-bottom:8px;'>📊 بيانات التقسيط</div>
        <div style='display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:14px;'>
          <div><span style='color:#666;'>المبلغ المدفوع:</span><br><span style='color:#f57f17;font-weight:bold;font-size:16px;'>${document.getElementById('installment-paid')?.value || '0'} ج</span></div>
          <div><span style='color:#666;'>المبلغ المتبقي:</span><br><span style='color:#e65100;font-weight:bold;font-size:16px;'>${document.getElementById('installment-remaining')?.value || '0'} ج</span></div>
        </div>
      </div>
      ` : ''}
      <div class='invoice-preview-recipient'>المستلم: ${recipient}</div>
    </div>`;
  } else {
    html += `
      <div class='invoice-preview-grid'>
        <span>الفرقة:</span><span>${grade || '-'}</span>
        <span>اسم الطالب:</span><span>${document.getElementById('student-name')?.value || '-'}</span>
        <span>رقم الهاتف:</span><span>${document.getElementById('phone')?.value || '-'}</span>
        <span>نوع الاشتراك:</span><span>${subType || '-'}</span>
        <span>انتظام/انتساب:</span><span>${studyType || '-'}</span>
      </div>
      <div class='invoice-preview-items-box'>
        <b>العناصر:</b>
        <ul class='invoice-preview-items-list'>
          ${items.length ? items.map(x => `<li><span class='preview-item-name' style='font-weight:500;'>${x.name}</span> <span class='preview-item-price' style='color:#388e3c;font-weight:bold;'>${x.price} ج</span></li>`).join('') : '<li>لا يوجد عناصر</li>'}
        </ul>
        <div class='invoice-preview-total'><b>${isVipMode ? 'سعر البيع VIP:' : 'المبلغ المدفوع:'}</b> <span>${displayedAmount} ج</span></div>
      </div>
      <div class='invoice-preview-grid'>
        <span>طريقة الدفع:</span><span>${payment || '-'}</span>
        <span>ملاحظات:</span><span>${notes || '-'}</span>
      </div>
      ${payment === 'تقسيط' ? `
      <div style='background:#fff8e1;border:2px solid #fbc02d;border-radius:6px;padding:10px;margin:10px 0;'>
        <div style='color:#f57f17;font-weight:bold;margin-bottom:8px;'>📊 بيانات التقسيط</div>
        <div style='display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:14px;'>
          <div><span style='color:#666;'>المبلغ المدفوع:</span><br><span style='color:#f57f17;font-weight:bold;font-size:16px;'>${document.getElementById('installment-paid')?.value || '0'} ج</span></div>
          <div><span style='color:#666;'>المبلغ المتبقي:</span><br><span style='color:#e65100;font-weight:bold;font-size:16px;'>${document.getElementById('installment-remaining')?.value || '0'} ج</span></div>
        </div>
      </div>
      ` : ''}
      <div class='invoice-preview-recipient'>المستلم: ${recipient}</div>
    </div>`;
  }
  preview.innerHTML = html;
  // زر نسخ رقم الفاتورة
  const copyBtn = document.getElementById('copy-invoice-num');
  if (copyBtn) {
    copyBtn.onclick = () => {
      const num = document.getElementById('invoice-num-preview').textContent;
      navigator.clipboard.writeText(num);
      showNotification('تم نسخ رقم الفاتورة!', 'success', 1200);
    };
  }
  // لا تفعيل أي تعديل على اسم أو سعر العنصر في المعاينة
}

// تعريف demoBtn مرة واحدة فقط في الأعلى
const demoBtn = document.getElementById('demo-mode-btn');
if (demoBtn) {
  demoBtn.addEventListener('click', () => {
    document.body.classList.toggle('demo-mode');
    demoBtn.classList.toggle('active');
    document.getElementById('preview-box').classList.toggle('demo');
    // عند التفعيل، لا يسمح بالحفظ
    if (document.body.classList.contains('demo-mode')) {
      demoBtn.textContent = 'خروج من الوضع التجريبي';
    } else {
      demoBtn.textContent = 'الوضع التجريبي';
    }
  });
}

// تعريف invoiceForm مرة واحدة فقط في الأعلى
const invoiceForm = document.getElementById('invoice-form');
if (invoiceForm) {
  if (isVipMode) {
    const vipFields = document.getElementById('vip-discount-fields');
    if (vipFields) vipFields.style.display = 'block';
    const priceInput = document.getElementById('vip-original-price');
    const discountInput = document.getElementById('vip-discount-amount');
    const finalPriceInput = document.getElementById('vip-final-price');
    if (priceInput && discountInput && finalPriceInput) {
      const syncVipPrices = () => {
        const original = Number(priceInput.value || 0);
        const discount = Number(discountInput.value || 0);
        finalPriceInput.value = Math.max(0, original - discount);
        updateInvoicePreview();
      };
      priceInput.addEventListener('input', () => {
        vipOriginalPriceCustomized = true;
        vipFinalPriceCustomized = false;
        syncVipPrices();
      });
      discountInput.addEventListener('input', () => {
        vipFinalPriceCustomized = false;
        syncVipPrices();
      });
      finalPriceInput.addEventListener('input', () => {
        vipFinalPriceCustomized = true;
        discountInput.value = Math.max(0, Number(priceInput.value || 0) - Number(finalPriceInput.value || 0));
        updateInvoicePreview();
      });
      syncVipPriceFromItems(selectedItems);
    }
  }

  invoiceForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!validateForm()) return;
    if (document.body.classList.contains('demo-mode')) {
      showNotification('الوضع التجريبي: لن يتم حفظ الفاتورة فعليًا', 'info', 2500);
      return;
    }

    // جمع جميع العناصر من جميع أنواع الاشتراك
    let allSelectedItems = [];
    let subTypesSelected = [];
    Object.keys(itemsBySubType).forEach(subType => {
      if (itemsBySubType[subType] && Array.isArray(itemsBySubType[subType]) && itemsBySubType[subType].length > 0) {
        subTypesSelected.push(subType);
        allSelectedItems = allSelectedItems.concat(itemsBySubType[subType]);
      }
    });

    if (allSelectedItems.length === 0) {
      showNotification('يرجى اختيار عناصر قبل الحفظ', 'warning', 2500);
      return;
    }

    const requestedSubscriptionIds = allSelectedItems.map(item => item?.id).filter(Boolean);
    if (new Set(requestedSubscriptionIds).size !== requestedSubscriptionIds.length) {
      showNotification('\u0627\u0644\u0639\u0646\u0635\u0631 \u0646\u0641\u0633\u0647 \u0645\u062e\u062a\u0627\u0631 \u0623\u0643\u062b\u0631 \u0645\u0646 \u0645\u0631\u0629. \u0627\u062d\u0630\u0641 \u0627\u0644\u062a\u0643\u0631\u0627\u0631 \u0642\u0628\u0644 \u0627\u0644\u062d\u0641\u0638.', 'error', 4000);
      return;
    }

    const isSubscriberInvoice = subTypesSelected.some(st => st !== 'محاضرات فردية' && st !== 'ملازم فردية');

    if (isSubscriberInvoice) {
      let access;
      try {
        access = await fetchCurrentUserAccess();
      } catch (error) {
        console.error('Could not verify invoice creation permission:', error);
        showNotification('تعذر التحقق من الصلاحيات. تحقق من الاتصال ثم حاول مرة أخرى.', 'error', 4000);
        return;
      }
      if (access.type !== 'مدير' && !access.permissions.includes('create_subscriber_invoice')) {
        showNotification('❌ ليس لديك صلاحية لإنشاء فواتير الطلاب المشتركين. يرجى التواصل مع المدير.', 'error', 4000);
        return;
      }
    }

    let student = '', phone = '';
    const grade = selectedGrade;
    const studyType = document.getElementById('study-type').value;
    const payment = document.getElementById('payment-method').value;
    const notes = document.getElementById('notes').value;
    const vipOriginalPrice = Number(document.getElementById('vip-original-price')?.value || 0);
    const vipDiscountAmount = Number(document.getElementById('vip-discount-amount')?.value || 0);
    const vipFinalPrice = Number(document.getElementById('vip-final-price')?.value || 0);
    const vipReason = document.getElementById('vip-reason')?.value?.trim() || 'VIP';
    const vipOwner = isVipMode ? await loadVipAssignedTeacher() : '';
    await fetchCurrentRecipient();
    const recipient = currentRecipient || '-';
    const installment = {
      total: document.getElementById('installment-total')?.value || '',
      paid: document.getElementById('installment-paid')?.value || '',
      remaining: document.getElementById('installment-remaining')?.value || ''
    };

    const isIndividual = subTypesSelected.some(st => st === 'محاضرات فردية' || st === 'ملازم فردية');
    student = document.getElementById('student-name')?.value?.trim() || '';
    phone = document.getElementById('phone')?.value?.trim() || '';

    if (isIndividual) {
      // للفواتير الفردية لا نلتزم بإضافة اسم الطالب أو رقم الهاتف
      student = '';
      phone = '';
    }

    let invoiceIds = {};
    const centerName = localStorage.getItem('centerName') || 'اسم السنتر';
    const centerAddress = localStorage.getItem('centerAddress') || '';
    const centerPhone1 = localStorage.getItem('centerPhone1') || '';
    const centerPhone2 = localStorage.getItem('centerPhone2') || '';
    const centerPhone3 = localStorage.getItem('centerPhone3') || '';
    const logoSrc = localStorage.getItem('logoSrc') || '';

    try {
      const deliverySelections = [...document.querySelectorAll('#online-card-delivery-list input[type="checkbox"]')].map(checkbox => ({
        cardId: checkbox.dataset.cardId,
        cardName: checkbox.dataset.cardName,
        cardType: checkbox.dataset.cardType,
        perSub: Math.max(1, parseInt(checkbox.dataset.perSub) || 1),
        linkedSubscriptionIds: JSON.parse(checkbox.dataset.linkedSubs || '[]'),
        delivered: checkbox.checked
      }));

      const invoicesToCreate = subTypesSelected.map((subType, index) => {
        const itemsForSubType = itemsBySubType[subType] || [];
        const dbSubType = mapSubTypeToDbType(subType);
        const onlineCardsDelivery = deliverySelections.flatMap(card => {
          if (card.cardType !== 'للاشتراكات') return [];
          const matchedItems = itemsForSubType.filter(item =>
            item && !item.isOnlineCard
            && (!card.linkedSubscriptionIds.length || card.linkedSubscriptionIds.includes(item.id))
          );
          if (!matchedItems.length) return [];
          return [{
            id: card.cardId,
            cardId: card.cardId,
            name: card.cardName,
            type: card.cardType,
            perSub: card.perSub,
            quantity: matchedItems.length * card.perSub,
            delivered: card.delivered,
            linkedSubscriptionIds: matchedItems.map(item => item.id)
          }];
        });
        const selectedSharedNotes = itemsForSubType
          .filter(item => item && item.name)
          .map(item => ({
            name: item.name,
            delivered: false,
            price: item.price || 0,
            noteId: item.id || null
          }));

        const invoice = {
          grade: grade,
          studyType: studyType,
          subType: dbSubType,
          items: itemsForSubType.map(({ subType, ...rest }) => rest),
          payment: payment,
          notes: notes,
          date: Timestamp.now(),
          recipient: recipient,
          installment: installment,
          num: nextInvoiceNumber + (subTypesSelected.indexOf(subType)),
          centerInfo: { name: centerName, address: centerAddress, phone1: centerPhone1, phone2: centerPhone2, phone3: centerPhone3, logo: logoSrc },
          isVodafone: payment === 'فودافون كاش',
          indivNotes: (dbSubType === 'ملازم' || dbSubType === 'اشتراك ملازم') ? selectedSharedNotes : [],
          linkedSubTypes: subTypesSelected.filter(type => type !== subType && (type === 'اشتراك كورسات' || type === 'كورسات' || type === 'اشتراك ملازم' || type === 'ملازم')).map(type => mapSubTypeToDbType(type)),
          isVip: isVipMode,
          vipOriginalPrice: vipOriginalPrice,
          vipDiscountAmount: vipDiscountAmount,
          vipFinalPrice: vipFinalPrice,
          vipReason: vipReason,
          vipPayer: document.getElementById('vip-reason')?.value?.trim() || 'VIP',
          vipCreatedBy: localStorage.getItem('currentUsername') || localStorage.getItem('currentUserName') || currentRecipient || 'مدير',
          vipAssignedTeacher: vipOwner,
          bookletStockDeducted: false,
          onlineCardsDelivery
        };

        if (subType !== 'محاضرات فردية' && subType !== 'ملازم فردية') {
          invoice.student = student;
          invoice.phone = phone;
        } else {
          invoice.student = '';
          invoice.phone = '';
        }

        const invoiceRef = doc(collection(db, 'invoices'));
        invoiceIds[dbSubType] = invoiceRef.id;
        return { ref: invoiceRef, data: invoice };
      });

      const subscriptionCounts = new Map();
      const cardStockCounts = new Map();
      allSelectedItems.forEach(item => {
        if (!item.id) return;
        if (item.isOnlineCard) {
          cardStockCounts.set(item.id, (cardStockCounts.get(item.id) || 0) + 1);
        } else {
          subscriptionCounts.set(item.id, (subscriptionCounts.get(item.id) || 0) + 1);
        }
      });
      invoicesToCreate.forEach(({ data }) => {
        (data.onlineCardsDelivery || []).forEach(card => {
          if (card.delivered && card.cardId) {
            cardStockCounts.set(card.cardId, (cardStockCounts.get(card.cardId) || 0) + card.quantity);
          }
        });
      });
      const subscriptionRefs = [...subscriptionCounts.keys()].map(id => doc(db, 'subscriptions', id));
      const onlineCardRefs = [...cardStockCounts.keys()].map(id => doc(db, 'onlineCards', id));

      // Only booklet stock is tracked; courses remain open inventory-wise.
        if (phone) {
          const [invoiceMatches, vipMatches, portalMatches] = await Promise.all([
            getDocs(query(collection(db, 'invoices'), where('phone', '==', phone))),
            getDocs(query(collection(db, 'vipRegistrations'), where('phone', '==', phone))),
            getDocs(query(collection(db, 'studentRegistrations'), where('phone', '==', phone)))
          ]);
          const requestedById = new Map(allSelectedItems.filter(item => item?.id).map(item => [item.id, item.name || item.id]));
          const duplicateNames = new Set();
          const checkExisting = snapshot => snapshot.docs.forEach(docSnapshot => {
            const existing = docSnapshot.data();
            const existingItems = existing.items || existing.selectedSubscriptions || existing.subscriptions || existing.selectedItems || [];
            existingItems.forEach(item => {
              const id = item?.id || item?.subscriptionId;
              if (id && requestedById.has(id)) duplicateNames.add(requestedById.get(id));
            });
          });
          [invoiceMatches, vipMatches, portalMatches].forEach(checkExisting);
          if (duplicateNames.size) {
            throw new Error('الطالب مشترك بالفعل في: ' + [...duplicateNames].join('، ') + '. اختر اشتراكًا أو ملزمة مختلفة.');
          }
        }
      await runTransaction(db, async transaction => {
        const subscriptionSnapshots = [];
        for (const subscriptionRef of subscriptionRefs) {
          subscriptionSnapshots.push(await transaction.get(subscriptionRef));
        }
        const onlineCardSnapshots = [];
        for (const cardRef of onlineCardRefs) {
          onlineCardSnapshots.push(await transaction.get(cardRef));
        }

        subscriptionSnapshots.forEach(snapshot => {
          if (!snapshot.exists()) throw new Error('A selected subscription no longer exists');
        });
        onlineCardSnapshots.forEach(snapshot => {
          if (!snapshot.exists()) throw new Error('A selected online card no longer exists');
          const currentStock = Number(snapshot.data().stock) || 0;
          transaction.update(doc(db, 'onlineCards', snapshot.id), {
            stock: currentStock - (cardStockCounts.get(snapshot.id) || 0)
          });
        });

        invoicesToCreate.forEach(({ ref, data }) => transaction.set(ref, data));
      });
      localStorage.setItem('invoice_saved', Date.now());
      studentLookupRecordsCache = null;

      showNotification('تم حفظ الفواتير بنجاح (' + subTypesSelected.length + ' فاتورة)', 'success', 2500);

      // 2. جلب الفواتير للطباعة (بما فيها معلومات تسليم الكروت)
      const refreshInvoices = [];
      for (let dbType of Object.values(invoiceIds)) {
        const snap = await getDoc(doc(db, 'invoices', dbType));
        if (snap.exists()) refreshInvoices.push({ ...snap.data(), id: snap.id });
      }

      // 5. إعادة تعيين وإنهاء
      document.getElementById('invoice-form').reset();
      vipOriginalPriceCustomized = false;
      vipFinalPriceCustomized = false;
      selectedItems = []; window.selectedItems = []; itemsBySubType = {};
      document.getElementById('items-container').innerHTML = '';
      updateInvoicePreview();
      updateSelectedItemsBox();
      resetSelectedItemsBox();

      if (refreshInvoices.length > 0) {
        window.invoicesToPrint = refreshInvoices;
        showConfirmDialog(`هل تريد طباعة الفواتير الآن؟`, () => {
          refreshInvoices.forEach(inv => { window.lastSavedInvoice = inv; printInvoice(); });
        });
      }
    } catch (err) {
      showNotification('حدث خطأ أثناء الحفظ', 'error', 3500);
      console.error(err);
    }
  });
}

// إظهار/إخفاء حقول الطالب والهاتف حسب نوع الاشتراك
function updateFormFields() {
  const subType = document.getElementById('sub-type')?.value || selectedSubType;
  const studentGroup = document.getElementById('student-group');
  const phoneGroup = document.getElementById('phone-group');
  const studentInput = document.getElementById('student-name');
  const phoneInput = document.getElementById('phone');
  const mainFields = document.getElementById('main-fields');
  const paymentField = document.getElementById('payment-method')?.closest('.form-group,div');
  const notesField = document.getElementById('notes')?.closest('.form-group,div');
  const studyTypeField = document.getElementById('study-type')?.closest('.form-group,div');
  if (subType === 'محاضرات فردية' || subType === 'ملازم فردية') {
    if (studentGroup) studentGroup.style.display = 'none';
    if (phoneGroup) phoneGroup.style.display = 'none';
    if (studentInput) studentInput.removeAttribute('required');
    if (phoneInput) phoneInput.removeAttribute('required');
    if (mainFields) mainFields.style.display = '';
    if (paymentField) paymentField.style.display = '';
    if (notesField) notesField.style.display = '';
    if (studyTypeField) studyTypeField.style.display = '';
  } else {
    if (studentGroup) studentGroup.style.display = '';
    if (phoneGroup) phoneGroup.style.display = '';
    if (studentInput) studentInput.setAttribute('required', 'required');
    if (phoneInput) phoneInput.setAttribute('required', 'required');
    if (mainFields) mainFields.style.display = '';
    if (paymentField) paymentField.style.display = '';
    if (notesField) notesField.style.display = '';
    if (studyTypeField) studyTypeField.style.display = '';
  }
}
const subTypeField = document.getElementById('sub-type');
if (subTypeField) {
  subTypeField.addEventListener('input', updateFormFields);
}

// تحديث العناصر المختارة في نموذج الفاتورة
function updateSelectedItemsBox() {
  const list = document.getElementById('selected-items-list');
  if (!list) return;

  // جمع جميع العناصر من جميع أنواع الاشتراك
  let allSelectedItems = [];
  Object.keys(itemsBySubType).forEach(subType => {
    if (itemsBySubType[subType] && Array.isArray(itemsBySubType[subType])) {
      allSelectedItems = allSelectedItems.concat(itemsBySubType[subType]);
    }
  });

  if (allSelectedItems.length === 0) {
    list.textContent = 'لا يوجد عناصر مختارة.';
  } else {
    list.innerHTML = allSelectedItems.map(i => `<div>${i.name} (${i.price}ج) - <small style="color:blue;">${i.subType}</small></div>`).join('');
  }
  // تحديث العناصر المختارة في نموذج المحاكاة
  window.selectedItems = allSelectedItems;
  syncVipPriceFromItems(allSelectedItems);
  updateInvoicePreview();
  // تحديث مربعات تسليم كروت الأونلاين - ندهها مباشرة
  updateOnlineCardDelivery();
}

function syncVipPriceFromItems(items) {
  if (!isVipMode) return;
  const priceInput = document.getElementById('vip-original-price');
  const discountInput = document.getElementById('vip-discount-amount');
  const finalPriceInput = document.getElementById('vip-final-price');
  if (!priceInput || !discountInput || !finalPriceInput) return;
  const original = items.reduce((sum, item) => sum + Number(item.price || 0), 0);
  if (!vipOriginalPriceCustomized) priceInput.value = original;
  const effectiveOriginal = Number(priceInput.value || 0);
  if (vipFinalPriceCustomized) {
    discountInput.value = Math.max(0, effectiveOriginal - Number(finalPriceInput.value || 0));
    return;
  }
  const discount = Number(discountInput.value || 0);
  finalPriceInput.value = Math.max(0, effectiveOriginal - discount);
}

// تحديث المعاينة عند اختيار العناصر
function showSelectableItems(items, subType = selectedSubType) {
  const container = document.getElementById('items-container');
  let table = document.getElementById('items-table');
  // إذا لم يوجد الجدول، أنشئه ديناميكياً
  if (!table) {
    table = document.createElement('table');
    table.id = 'items-table';
    table.style.width = '100%';
    table.innerHTML = `
      <thead>
        <tr>
          <th>اسم العنصر</th>
          <th>السعر</th>
          <th>إجراء</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    container.appendChild(table);
  }
  const tbody = table.querySelector('tbody');
  tbody.innerHTML = '';
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:#888;">لا توجد عناصر متاحة لهذا النوع والفرقة.</td></tr>';
    table.style.display = '';
    container.innerHTML = '';
    container.appendChild(table);
    updateInvoicePreview();
    updateSelectedItemsBox();
    return;
  }
  table.style.display = '';
  container.innerHTML = '';
  container.appendChild(table);
  items.forEach(item => {
    const tr = document.createElement('tr');
    // تحقق من العنصر في itemsBySubType للنوع الحالي
    const itemsForThisType = itemsBySubType[subType] || [];
    const isSelected = itemsForThisType.find(i => i.name === item.name);
    const isOutOfStock = item.stock !== undefined && item.stock <= 0
      && (subType === 'ملازم فردية' || subType === 'ملازم');

    tr.innerHTML = `
      <td style="${isOutOfStock ? 'color:#777;' : ''}">${item.name} ${item.stock !== undefined ? `<small style="color:${item.stock < 0 ? '#c62828' : '#666'};display:block;">(${item.stock < 0 ? 'عجز' : 'المتوفر'}: ${item.stock})</small>` : ''}</td>
      <td style="${isOutOfStock ? 'color:#888;' : ''}">${item.price} ج</td>
      <td>
        <button class="${isSelected ? 'remove' : ''}">${isSelected ? 'إزالة' : 'إضافة'}</button>
      </td>
    `;
    const btn = tr.querySelector('button');
    btn.onclick = (e) => {
      e.stopPropagation();
      // إذا لم تكن الخريطة موجودة للنوع، أنشئها
      if (!itemsBySubType[subType]) {
        itemsBySubType[subType] = [];
      }
      const idx = itemsBySubType[subType].findIndex(i => i.name === item.name);
      if (idx === -1) {
        itemsBySubType[subType].push({ ...item, subType });
        btn.textContent = 'إزالة';
        btn.classList.add('remove');
      } else {
        itemsBySubType[subType].splice(idx, 1);
        btn.textContent = 'إضافة';
        btn.classList.remove('remove');
      }
      updateSelectedItemsBox();
      showSelectableItems(items, subType);
    };
    tbody.appendChild(tr);
  });
  updateSelectedItemsBox();
}

// عند اختيار نوع الاشتراك
[...document.querySelectorAll('.sub-btn')].forEach(btn => {
  btn.addEventListener('click', async () => {
    selectedSubType = btn.dataset.type;
    document.getElementById('sub-type').value = selectedSubType;
    updateFormFields();
    await fetchNextInvoiceNumber(); // تحديث رقم الفاتورة حسب النوع
    const items = await getItemsForSubType(selectedSubType, selectedGrade);
    showSelectableItems(items);
    updateInvoicePreview(); // تأكيد تحديث المعاينة
  });
});

// عند اختيار الفرقة
[...document.querySelectorAll('.grade-btn')].forEach(btn => {
  btn.addEventListener('click', async () => {
    selectedGrade = btn.dataset.grade;
    document.getElementById('grade').value = selectedGrade;
    await fetchNextInvoiceNumber(); // تحديث رقم الفاتورة حسب الفرقة
    updateInvoicePreview();
    // إعادة تعيين العناصر المختارة عند تغيير الفرقة
    itemsBySubType = {};
    window.selectedItems = [];
    updateSelectedItemsBox();
    // إعادة تحميل العناصر المتاحة للنوع الحالي (إن وجد)
    if (selectedSubType) {
      getItemsForSubType(selectedSubType, selectedGrade).then(showSelectableItems);
    }
  });
});

// التأكد من صحة البيانات قبل الحفظ
function validateForm() {
  if (!selectedGrade) {
    showNotification('يرجى اختيار فرقة', 'error', 3500);
    return false;
  }

  // التحقق من وجود عناصر مختارة من أي نوع اشتراك
  let totalSelectedItems = 0;
  let subTypesSelected = [];
  Object.keys(itemsBySubType).forEach(subType => {
    if (itemsBySubType[subType] && Array.isArray(itemsBySubType[subType]) && itemsBySubType[subType].length > 0) {
      totalSelectedItems += itemsBySubType[subType].length;
      subTypesSelected.push(subType);
    }
  });

  if (totalSelectedItems === 0) {
    showNotification('يرجى اختيار عنصر واحد على الأقل', 'error', 3500);
    return false;
  }

  const isOnlyIndividual = subTypesSelected.every(st => st === 'محاضرات فردية' || st === 'ملازم فردية');
  const student = document.getElementById('student-name')?.value.trim() || '';
  const phone = document.getElementById('phone')?.value.trim() || '';
  const studyType = document.getElementById('study-type').value;

  if (!isOnlyIndividual) {
    if (student.split(' ').filter(Boolean).length < 3) {
      showNotification('يرجى إدخال اسم الطالب ثلاثي على الأقل', 'error', 3500);
      return false;
    }

    if (!/^01[0-9]{9}$/.test(phone)) {
      showNotification('يرجى إدخال رقم هاتف صحيح مكون من 11 رقم يبدأ بـ 01', 'error', 3500);
      return false;
    }
  }

  if (!studyType || (studyType !== 'انتظام' && studyType !== 'انتساب')) {
    showNotification('يرجى اختيار انتظام أو انتساب', 'error', 3500);
    return false;
  }

  return true;
}

function showNotification(msg, type = 'info', duration = 2000) {
  let notif = document.getElementById('global-notif');
  if (!notif) {
    notif = document.createElement('div');
    notif.id = 'global-notif';
    notif.style.position = 'fixed';
    notif.style.top = '18px';
    notif.style.left = '50%';
    notif.style.transform = 'translateX(-50%)';
    notif.style.zIndex = '9999';
    notif.style.minWidth = '200px';
    notif.style.maxWidth = '90vw';
    notif.style.padding = '16px 36px';
    notif.style.borderRadius = '12px';
    notif.style.fontSize = '18px';
    notif.style.fontWeight = 'bold';
    notif.style.boxShadow = '0 2px 16px #90caf988';
    notif.style.textAlign = 'center';
    notif.style.transition = 'opacity 0.7s';
    document.body.appendChild(notif);
  }
  notif.textContent = msg;
  notif.style.background = type === 'success' ? '#43a047' : (type === 'error' ? '#e53935' : '#1976d2');
  notif.style.color = '#fff';
  notif.style.opacity = '1';
  notif.style.pointerEvents = 'auto';
  setTimeout(() => {
    notif.style.opacity = '0';
    setTimeout(() => { if (notif) notif.remove(); }, 800);
  }, duration);
}

// نافذة تأكيد مخصصة بدلاً من confirm
function showConfirmDialog(message, onConfirm, onCancel) {
  // إزالة أي نافذة تأكيد سابقة
  const old = document.getElementById('custom-confirm');
  if (old) old.remove();
  // إنشاء نافذة تأكيد جديدة
  const confirmDialog = document.createElement('div');
  confirmDialog.id = 'custom-confirm';
  confirmDialog.style.position = 'fixed';
  confirmDialog.style.top = '50%';
  confirmDialog.style.left = '50%';
  confirmDialog.style.transform = 'translate(-50%, -50%)';
  confirmDialog.style.zIndex = '10000';
  confirmDialog.style.background = '#fff';
  confirmDialog.style.padding = '24px';
  confirmDialog.style.borderRadius = '12px';
  confirmDialog.style.boxShadow = '0 4px 32px rgba(0, 0, 0, 0.2)';
  confirmDialog.style.textAlign = 'center';
  confirmDialog.style.width = '90vw';
  confirmDialog.style.maxWidth = '400px';
  confirmDialog.innerHTML = `
    <div style="font-size: 18px; font-weight: bold; margin-bottom: 16px;">${message}</div>
    <button id="confirm-yes" style="background: #43a047; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 16px; cursor: pointer; margin-right: 8px;">نعم</button>
    <button id="confirm-no" style="background: #e53935; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 16px; cursor: pointer;">لا</button>
  `;
  document.body.appendChild(confirmDialog);

  // إضافة أحداث النقر على الأزرار
  document.getElementById('confirm-yes').addEventListener('click', () => {
    if (onConfirm) onConfirm();
    confirmDialog.remove();
  });
  document.getElementById('confirm-no').addEventListener('click', () => {
    if (onCancel) onCancel();
    confirmDialog.remove();
  });
}

// جلب رقم الفاتورة التالي حسب النوع والفرقة
async function fetchNextInvoiceNumber() {
  const [invoicesSnapshot, portalRegistrationsSnapshot, vipRegistrationsSnapshot] = await Promise.all([
    getDocs(collection(db, 'invoices')),
    getDocs(collection(db, 'studentRegistrations')),
    getDocs(collection(db, 'vipRegistrations')).catch(error => {
      console.warn('Could not read VIP registration invoice numbers:', error);
      return { docs: [] };
    })
  ]);
  const usedNumbers = [
    ...invoicesSnapshot.docs.map(item => Number(item.data().num) || 0),
    ...portalRegistrationsSnapshot.docs.map(item => Number(item.data().invoiceNumber) || 0),
    ...vipRegistrationsSnapshot.docs.map(item => Number(item.data().invoiceNumber) || 0)
  ];
  nextInvoiceNumber = usedNumbers.reduce((highest, number) => Math.max(highest, number), 0) + 1;
  updateInvoicePreview();
}

// البحث عن اشتراك ملازم/كورسات بنفس رقم الهاتف
async function fetchLinkedSubscription(phone, currentType) {
  if (!phone || !/^01[0-9]{9}$/.test(phone)) return null;
  const snapshot = await getDocs(collection(db, 'invoices'));
  let found = null;
  const currentDbType = mapSubTypeToDbType(currentType);
  snapshot.forEach(docSnap => {
    const inv = docSnap.data();
    const invType = String(inv?.subType || '').trim();
    if (inv && inv.phone === phone) {
      if (currentDbType === 'كورسات' && (invType === 'ملازم' || invType === 'اشتراك ملازم')) found = 'لديه اشتراك ملازم';
      if (currentDbType === 'ملازم' && (invType === 'كورسات' || invType === 'اشتراك كورسات')) found = 'لديه اشتراك كورسات';
    }
  });
  return found;
}

// تحديث المعاينة عند تحميل الصفحة
updateInvoicePreview();
// عند تحميل الصفحة، إخفاء قسم الأنواع
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('subs-section').style.display = 'none';
  updateUserNameInHeader(); // تحديث اسم المستخدم في الهيدر
  fetchCurrentRecipient(); // جلب اسم المستلم من فايربيس
  fetchNextInvoiceNumber(); // جلب رقم الفاتورة التالي
  updateInvoicePreview();
  // مراقبة تغيير اسم المستخدم في localStorage وتحديث المعاينة فوراً
  window.addEventListener('storage', function (e) {
    if (e.key === 'username') updateInvoicePreview();
  });
});

// عند إعادة تعيين النموذج أو تغيير الفرقة، حدث خانة العناصر المختارة
function resetSelectedItemsBox() {
  const list = document.getElementById('selected-items-list');
  if (list) list.textContent = 'لا يوجد عناصر مختارة.';
}

// ربط التحديث الفوري للمعاينة مع كل تغيير في الحقول
['student-name', 'phone', 'grade', 'study-type', 'sub-type', 'payment-method', 'notes'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('input', () => {
      // تحديث المعاينة مباشرة عند أي تغيير
      updateInvoicePreview();
    });
  }
});

// دالة الطباعة (تُستدعى فقط عند الضغط على زر الطباعة)
async function printInvoice() {
  const inv = window.lastSavedInvoice || {};
  let logoSrc = localStorage.getItem('centerLogo');
  if (!logoSrc || logoSrc === 'null' || logoSrc === 'undefined') {
    logoSrc = 'img/placeholder-logo.png';
  }
  if (!/^(data:|https?:|file:)/i.test(logoSrc)) {
    logoSrc = new URL(logoSrc, window.location.href).href;
  }
  const centerName = localStorage.getItem('centerName') || 'اسم السنتر';
  const centerAddress = localStorage.getItem('centerAddress') || '';
  const centerPhone1 = localStorage.getItem('centerPhone1') || '';
  const centerPhone2 = localStorage.getItem('centerPhone2') || '';
  const centerPhone3 = localStorage.getItem('centerPhone3') || '';

  // بناء قائمة الهواتف
  let phones = [];
  if (centerPhone1) phones.push(centerPhone1);
  if (centerPhone2) phones.push(centerPhone2);
  if (centerPhone3) phones.push(centerPhone3);
  const phonesText = phones.length > 0 ? phones.join(' - ') : '';
  const primaryCenterPhone = phones[0] || '';
  function normalizeWhatsAppNumber(rawPhone) {
    if (!rawPhone) return '';
    let digits = String(rawPhone).replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('+')) digits = digits.slice(1);
    if (digits.startsWith('20') && digits.length >= 12) return digits;
    if (digits.startsWith('0') && digits.length === 11) return `20${digits.slice(1)}`;
    if (digits.length === 10 && !digits.startsWith('0')) return `20${digits}`;
    return digits;
  }
  const normalizedCenterPhone = normalizeWhatsAppNumber(primaryCenterPhone);
  const centerWhatsAppUrl = normalizedCenterPhone ? `https://wa.me/${normalizedCenterPhone}` : '';
  const centerWhatsAppQr = centerWhatsAppUrl ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(centerWhatsAppUrl)}` : '';

  // حساب الإجمالي
  const itemsTotal = (inv.items || []).reduce((sum, x) => sum + (parseFloat(x.price) || 0), 0);
  const total = inv.isVip ? Number(inv.vipFinalPrice ?? itemsTotal) : itemsTotal;

  const isIndividualInvoice = ['محاضرات فردية', 'ملازم فردية'].includes(String(inv.subType || '').trim());
  const isNotesSubscription = ['ملازم', 'اشتراك ملازم', 'ملازم وكورسات'].includes(String(inv.subType || '').trim());
  const bookletDeliveryItems = isNotesSubscription
    ? (Array.isArray(inv.indivNotes) && inv.indivNotes.length ? inv.indivNotes : (inv.items || []))
    : [];
  const deliveredBooklets = bookletDeliveryItems.filter(item => item.delivered === true);
  const bookletDeliveryHtml = isNotesSubscription ? `
      <section class='booklet-delivery-print'>
        <strong>الملازم المستلمة</strong>
        ${deliveredBooklets.length ? `<table>
          ${deliveredBooklets.map((item, idx) => `
          <tr ${idx % 2 === 0 ? "style='background:#f9f9f9;'" : ''}>
            <td>${escapeStudentHtml(item.name || item.title || 'ملزمة')}</td>
            <td class='booklet-delivery-status'>استلمها الطالب</td>
          </tr>
          `).join('')}
        </table>` : `<div>لم يستلم ملازم بعد</div>`}
      </section>
      ` : '';

  // بناء محتوى الفاتورة بتصميم محسّن
  let html = `
    <div style='text-align:center;font-family:"Cairo", "Arabic Typesetting", sans-serif;direction:rtl;'>
      <img src='${logoSrc}' alt='شعار السنتر' />
      ${inv.isVip ? `<div class='vip-print-badge'>VIP</div>` : ''}
      <div class='invoice-num'>فاتورة رقم: ${inv.num || '-'}</div>
      <table>
        ${!isIndividualInvoice ? `
        <tr>
          <td>اسم الطالب:</td>
          <td>${inv.student || '-'}</td>
        </tr>
        <tr>
          <td>الهاتف:</td>
          <td>${(inv.phone || '').trim() || '-'}</td>
        </tr>
        ` : ''}
        <tr>
          <td>الفرقة:</td>
          <td>${inv.grade || '-'}</td>
        </tr>
        <tr>
          <td>النوع:</td>
          <td>${inv.subType || '-'}</td>
        </tr>
        ${inv.studyType && inv.studyType !== 'انتظام / انتساب' ? `<tr><td>النظام:</td><td>${inv.studyType}</td></tr>` : ''}
      </table>
      
      ${inv.subType === 'كورسات' && inv.linkedSubTypes && inv.linkedSubTypes.includes('ملازم') ? `
      <div style='margin:1mm 0;padding:1mm 1.5mm;background:#fff3e0;border-left:2px solid #ff9800;border-radius:3px;text-align:right;font-size:9.5px;color:#e65100;line-height:1.2;'>
        كود الملازم: <span style='color:#ff6f00;font-weight:bold;'>${inv.num ? inv.num + 1 : '-'}</span>
      </div>
      ` : ''}
      
      <table style='margin:1mm 0;'>
        ${(inv.items || []).map((item, idx) => `
        <tr ${idx % 2 === 0 ? "style='background:#f9f9f9;'" : ''}>
          <td>${item.name}</td>
          <td style='color:#388e3c;font-weight:bold;'>${item.price} ج</td>
        </tr>
        `).join('')}
      </table>
      ${bookletDeliveryHtml}
      ${(inv.onlineCardsDelivery || []).length ? `
      <div class='online-card-delivery-print'>
        ${(inv.onlineCardsDelivery || []).map(card => `
          <div><b>${escapeStudentHtml(card.name || 'كارت أونلاين')}</b>: ${card.delivered === true || card.isDelivered === true ? 'استلم كارت أونلاين' : 'لم يستلم الكارت الأونلاين'}</div>
        `).join('')}
      </div>
      ` : ''}
      
      <div class='total-box' style='margin:1mm 0;padding:1.3mm;'>
        الإجمالي: ${total.toFixed(2)} ج
      </div>
      
      <table style='margin:1mm 0;'>
        ${inv.payment ? `<tr><td>الدفع:</td><td>${inv.payment}</td></tr>` : ''}
        ${inv.payment === 'تقسيط' && inv.installment ? `
        <tr style='background:#fff9c4;'><td>المدفوع:</td><td>${inv.installment.paid || 0} ج</td></tr>
        <tr style='background:#fff59d;'><td>المتبقي:</td><td>${inv.installment.remaining || 0} ج</td></tr>
        ` : ''}
        ${inv.notes ? `<tr><td>ملاحظات:</td><td>${inv.notes}</td></tr>` : ''}
      </table>
      
      <div class='footer'>
        <div style='font-weight:bold;color:#1565c0;margin-bottom:1mm;'>الفرع الرئيسي</div>
        <div class='center-address'>${centerAddress || '-'}</div>
        <div style='margin:1mm 0 0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#000;'>
          ${centerWhatsAppQr ? `<a href='${centerWhatsAppUrl}' target='_blank' rel='noopener' style='position:relative;display:inline-flex;align-items:center;justify-content:center;text-decoration:none;cursor:pointer;'><img src='${centerWhatsAppQr}' alt='WhatsApp QR' style='display:block;width:18px;height:18px;border:2px solid #000;border-radius:6px;background:#fff;padding:1px;box-shadow:none;' /><span style='position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center;width:7px;height:7px;border-radius:50%;background:#fff;border:1px solid #000;box-shadow:0 1px 3px rgba(0,0,0,.15);'><svg viewBox='0 0 24 24' width='5' height='5' style='fill:#25d366;'><path d='M19.05 4.95A9.89 9.89 0 0 0 12.02 2a9.9 9.9 0 0 0-8.81 14.96L2 22l5.2-1.35A9.9 9.9 0 0 0 12.02 22a9.9 9.9 0 0 0 6.96-2.99A9.9 9.9 0 0 0 19.05 4.95ZM12.02 20.2a8.2 8.2 0 0 1-4.18-1.13l-.3-.18-3.08.8.82-3L5.1 16.8a8.2 8.2 0 1 1 13.46-6.8 8.17 8.17 0 0 1-6.54 10.2Zm4.54-6.2c-.25-.12-1.46-.72-1.69-.8-.23-.08-.4-.12-.57.12-.17.25-.65.8-.8 1-.15.17-.3.2-.55.07-.25-.12-1.05-.38-2-1.23-.74-.66-1.23-1.48-1.38-1.73-.15-.25-.02-.38.11-.5.11-.11.25-.3.38-.45.12-.15.17-.25.25-.42.08-.17.04-.32-.02-.45-.07-.12-.57-1.38-.79-1.89-.2-.48-.42-.42-.57-.42h-.49c-.17 0-.45.07-.68.32-.23.25-.88.86-.88 2.1 0 1.23.9 2.44.1 2.56.18.3.39.46.66.7.27.18.94.54 1.76 1.3.78.7 1.33 1.08 1.81 1.4.26.17.47.15.64.09.2-.06.65-.27.93-.52.28-.25.36-.46.46-.76.08-.3.08-.56-.03-.68-.1-.12-.23-.2-.45-.32Z'/></svg></span></a>` : '<span>-</span>'}
        </div>
        <div style='margin-top:1mm;border-top:0.5px solid #ddd;padding-top:1mm;'>التاريخ: ${inv.date ? (inv.date.toDate ? inv.date.toDate().toLocaleDateString('ar-EG') : inv.date) : '-'}</div>
      </div>
    </div>
  `;

  // نافذة الطباعة
  const win = window.open('', '', 'width=400,height=600');
  if (!win) return;
  logoSrc = await makePrintableImage(logoSrc);
  html = html.replace(/src='[^']*'/, `src='${logoSrc}'`);
  win.document.write(`
    <!DOCTYPE html>
    <html dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>فاتورة</title>
      <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap" rel="stylesheet">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        @page { size: 80mm auto; margin: 0; }
        html, body { 
          margin: 0; 
          padding: 0; 
          height: auto;
          display: flex;
          justify-content: center;
          align-items: center;
        }
        body {
          font-family: Tahoma, Arial, sans-serif;
          font-size: 11px;
          font-weight: 900;
          color: #000;
          background: #fff;
          width: 80mm;
          padding: 0;
          display: flex;
          justify-content: center;
          align-items: flex-start;
          line-height: 1.3;
        }
        .print-container {
          width: 76mm;
          margin: 0 auto;
          background: white;
          padding: 1.5mm 1.5mm 0.8mm;
          box-shadow: none;
        }
        img { max-width: 82px; max-height: 82px; height: auto; display: block; margin: 0.8mm auto; opacity: 1; }
        h1 { font-size: 0; margin: 0; color: #000; font-weight: 900; display: none; }
        hr { border: none; border-top: 1px solid #111; margin: 0.6mm 0; }
        table { width: 100%; border-collapse: collapse; margin: 0.6mm 0; font-size: 9.8px; line-height: 1.15; }
        td { padding: 0.5mm 0.7mm; border-bottom: 1px solid #222; line-height: 1.15; }
        td:first-child { text-align: right; font-weight: 900; width: 40%; }
        .invoice-num { font-size: 12.8px; font-weight: 900; color: #000; text-align: center; padding: 0.9mm; border: 1px solid #111; margin: 0.7mm 0; }
        .vip-print-badge { display: inline-block; margin: 0.8mm auto; padding: 1mm 4mm; border: 1px solid #f2c300; border-radius: 4px; background: repeating-linear-gradient(135deg, #fff4a3 0 2mm, #ffe16b 2mm 4mm); color: #d50000; font-size: 12px; font-weight: 900; }
        .total-box { background: #e8f5e9; border: 1px solid #1b5e20; padding: 2mm; margin: 2mm 0; text-align: center; font-weight: 900; font-size: 12px; color: #000; }
        .installment-box { background: #fff8e1; border: 1px solid #8d6e00; padding: 2mm; margin: 2mm 0; font-size: 11px; }
        .footer { margin-top: 1mm; padding-top: 1mm; border-top: 1px solid #222; text-align: center; font-size: 9.2px; line-height: 1.2; }
        .footer div { margin: 0.3mm 0; }
        .center-address { max-width: 100%; overflow-wrap: anywhere; white-space: normal; }
        .online-card-delivery-print { margin: 1mm 0; padding: 1mm; border: 0.5px solid #7897ad; border-radius: 2mm; text-align: right; font-size: 9px; line-height: 1.2; }
        .booklet-delivery-print { margin: 1mm 0; padding: 1mm; border: 0.5px solid #7897ad; border-radius: 2mm; text-align: right; font-size: 9px; line-height: 1.2; }
        .booklet-delivery-print > strong { display: block; margin-bottom: 0.5mm; }
        .booklet-delivery-print table { margin: 0; }
        .booklet-delivery-print td { padding: 0.5mm 0.7mm; }
        .booklet-delivery-status { text-align: left; white-space: nowrap; }
        @media print {
          html, body { 
            margin: 0; 
            padding: 0; 
            width: 80mm;
            height: auto;
            display: block;
            align-items: flex-start;
            background: white;
          }
          body { 
            min-height: 0;
            background: white;
          }
          .print-container { 
            width: 80mm; 
            margin: 0 auto;
            page-break-after: auto;
            box-shadow: none;
            background: white;
          }
          * { box-shadow: none !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print-container,
          .print-container * {
            font-family: Tahoma, Arial, sans-serif !important;
            color: #000 !important;
            font-weight: 900 !important;
            letter-spacing: 0 !important;
          }
          .print-container .vip-print-badge { color: #d50000 !important; background: repeating-linear-gradient(135deg, #fff4a3 0 2mm, #ffe16b 2mm 4mm) !important; border: 1px solid #f2c300 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print-container {
            width: 72mm;
            padding: 1mm 1mm 0.6mm;
            overflow: visible;
            line-height: 1.08 !important;
          }
          .print-container img { display: block !important; max-width: 84px !important; max-height: 84px !important; width: auto !important; height: auto !important; object-fit: contain; opacity: 1 !important; background: #fff !important; border: 0 !important; box-shadow: none !important; filter: brightness(1.05) contrast(2.2) saturate(1.4) !important; image-rendering: auto; }
          .print-container table { margin: 0.5mm 0 !important; font-size: 9.1px !important; line-height: 1.08 !important; }
          .print-container td { padding: 0.5mm 0.7mm !important; line-height: 1.08 !important; }
          .print-container > div { margin-top: 0.6mm !important; margin-bottom: 0.6mm !important; padding-top: 0.6mm !important; padding-bottom: 0.6mm !important; }
        }
      </style>
    </head>
    <body><div class="print-container">${html}</div></body>
    </html>
  `);

  win.document.close();
  const printWhenReady = async () => {
    if (win.document.fonts?.ready) await win.document.fonts.ready;
    await Promise.all(Array.from(win.document.images).map(image => image.complete
      ? Promise.resolve()
      : new Promise(resolve => { image.onload = resolve; image.onerror = resolve; })));
    win.print();
  };
  printWhenReady();
}

async function makePrintableImage(source) {
  if (!source || source.startsWith('data:')) return source;
  try {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Image request failed: ${response.status}`);
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.warn('Could not embed invoice logo:', error);
    return source;
  }
}

// ===== مربع تسليم كروت الأونلاين في الكاشير =====
async function updateOnlineCardDelivery() {
  const box = document.getElementById('online-card-delivery-box');
  const list = document.getElementById('online-card-delivery-list');
  if (!box || !list) return;

  // جمع جميع العناصر المختارة حالياً
  let allSelectedItems = [];
  Object.values(itemsBySubType || {}).forEach(arr => {
    if (Array.isArray(arr)) allSelectedItems = allSelectedItems.concat(arr);
  });

  if (allSelectedItems.length === 0) {
    box.style.display = 'none';
    list.innerHTML = '';
    return;
  }

  const subscriptionItems = allSelectedItems.filter(item =>
    item && !item.isOnlineCard
    && !['محاضرات فردية', 'ملازم فردية'].includes(item.subType)
    && item.id
  );
  if (!subscriptionItems.length) {
    box.style.display = 'none';
    list.innerHTML = '';
    return;
  }

  try {
    const snap = await getDocs(collection(db, 'onlineCards'));
    const relevantCards = [];
    snap.forEach(d => {
      const data = d.data();
      if (data.type !== 'للاشتراكات') return;
      const linkedIds = Array.isArray(data.linkedSubscriptionIds) ? data.linkedSubscriptionIds : [];
      const matches = linkedIds.length === 0 || subscriptionItems.some(item => linkedIds.includes(item.id));
      if (matches) relevantCards.push({ id: d.id, ...data, linkedSubscriptionIds: linkedIds });
    });

    if (relevantCards.length === 0) {
      box.style.display = 'none';
      list.innerHTML = '';
      return;
    }

    box.style.display = '';
    // الحفاظ على حالة الـ checkboxes
    const prevChecked = {};
    list.querySelectorAll('input[type=checkbox]').forEach(cb => {
      prevChecked[cb.dataset.cardId] = cb.checked;
    });

    list.replaceChildren();
    relevantCards.forEach(card => {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:6px;cursor:pointer;background:#fff;padding:8px;border-radius:8px;border:1px solid #e0f0ff;';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.cardId = card.id;
      checkbox.dataset.cardName = card.name || '';
      checkbox.dataset.perSub = String(card.perSub || 1);
      checkbox.dataset.cardType = card.type;
      checkbox.dataset.linkedSubs = JSON.stringify(card.linkedSubscriptionIds);
      checkbox.checked = Boolean(prevChecked[card.id]);
      checkbox.style.cssText = 'width:20px;height:20px;accent-color:#1976d2;';
      const description = document.createElement('span');
      description.style.fontSize = '0.95em';
      const title = document.createElement('b');
      title.style.color = '#1565c0';
      title.textContent = card.name || 'كارت أونلاين';
      const details = document.createElement('small');
      details.style.color = '#666';
      details.textContent = `(${card.perSub || 1} كرت/اشتراك) | مخزون: ${Number(card.stock) || 0}`;
      const deliveryStatus = document.createElement('small');
      deliveryStatus.style.cssText = `display:block;font-weight:bold;color:${checkbox.checked ? '#2e7d32' : '#d32f2f'};`;
      deliveryStatus.textContent = checkbox.checked ? 'استلم الكارت' : 'لم يستلم الكارت';
      checkbox.addEventListener('change', () => {
        deliveryStatus.textContent = checkbox.checked ? 'استلم الكارت' : 'لم يستلم الكارت';
        deliveryStatus.style.color = checkbox.checked ? '#2e7d32' : '#d32f2f';
      });
      description.append(title, document.createElement('br'), details, deliveryStatus);
      label.append(checkbox, description);
      list.appendChild(label);
    });
  } catch (e) {
    console.error('Error loading online cards for delivery:', e);
    box.style.display = 'none';
    showNotification('تعذر تحميل كروت التسليم. حاول تحديث الاختيارات.', 'error');
  }
}

// استدعاء updateOnlineCardDelivery عند تغيّر العناصر المختارة
// تم دمج الاستدعاء مباشرة لحل مشكلة عدم الظهور
document.addEventListener('selectedItemsChanged', updateOnlineCardDelivery);
window.updateOnlineCardDelivery = updateOnlineCardDelivery;

// ملاحظة: تأكد من استدعاء هذه الوظيفة يدوياً في الأماكن التي تغير selectedItems
// أو استخدام Event Custom كما فعلنا أعلاه
