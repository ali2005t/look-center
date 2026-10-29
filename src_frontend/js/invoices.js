// js/invoices.js
import { db } from "./firebase.js";
import { collection, getDocs, onSnapshot, doc, updateDoc, deleteDoc, setDoc, runTransaction, Timestamp, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { collection as collection2, getDocs as getDocs2 } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { doc as doc2, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getInstallmentSummary, isInstallmentInvoice, showInstallmentPaymentDialog } from './installment-payments.js?v=vip-payment-mode-v1';

const tableBody = document.querySelector("#invoices-table tbody");
const modal = document.getElementById("invoice-details-modal");
const invoiceCardsContainer = document.getElementById('invoice-cards');

// متغيرات لتخزين الفواتير الكل والفواتير المصفاة
let allInvoices = [];
let filteredInvoices = [];
let loadRequestId = 0;

// متغير عالمي لاسم المستلم
let currentRecipient = '-';
let realtimeStarted = false;
let invoiceViewMode = localStorage.getItem('invoicesViewMode') === 'cards' ? 'cards' : 'table';

function escapeInvoiceHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

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

function cleanGeneratedBookletNote(value) {
  return String(value || '').split(/\r?\n/)
    .filter(line => !/^عامل اشتراك على مواد(?:\s|$)/u.test(line.trim()))
    .join('\n').trim();
}

function hasGeneratedBookletNote(value) {
  return String(value || '').split(/\r?\n/).some(line => /^عامل اشتراك على مواد(?:\s|$)/u.test(line.trim()));
}

function invoicePaymentLabel(invoice) {
  if (!isInstallmentInvoice(invoice)) return invoice.payment || invoice.paymentMethod || '-';
  return '\u062a\u0642\u0633\u064a\u0637';
}

function isPortalInstallment(invoice) {
  if (!invoice?.isPortalRegistration) return false;
  if (invoice.payment === '\u062a\u0642\u0633\u064a\u0637' || invoice.paymentMethod === '\u062a\u0642\u0633\u064a\u0637'
    || invoice.paymentStatus === 'partial') return true;
  const { paid, remaining } = invoiceFinancialSummary(invoice);
  return paid > 0 && remaining > 0;
}

function invoiceTypeLabel(invoice) {
  if (invoice.isPortalRegistration) {
    return isPortalInstallment(invoice) ? 'تقسيط'
      : invoice.paymentStatus === 'paid' ? 'تم الدفع' : 'لم يدفع';
  }
  if (isInstallmentInvoice(invoice)) return invoicePaymentLabel(invoice);
  if (invoice.isVip) {
    return invoice.vipIsFree ? '\u0645\u062c\u0627\u0646\u064a - \u0645\u0643\u062a\u0645\u0644' : '\u0645\u062f\u0641\u0648\u0639 \u0628\u0627\u0644\u0643\u0627\u0645\u0644';
  }
  return invoice.payment || invoice.paymentMethod || '-';
}

function invoiceTypeMarkup(invoice) {
  return `<strong class="invoice-payment-label">${escapeInvoiceHtml(invoiceTypeLabel(invoice))}</strong>`;
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

function portalSubscriptionAmount(registration) {
  const subscriptions = registration?.selectedSubscriptions || registration?.subscriptions || registration?.selectedItems || [];
  const selectedAmount = Array.isArray(subscriptions)
    ? subscriptions.reduce((sum, item) => sum + (Number(item?.price) || 0), 0)
    : 0;
  const amounts = [registration?.requestedAmount, registration?.subscriptionAmount, selectedAmount, registration?.installment?.total]
    .map(Number)
    .filter(amount => Number.isFinite(amount) && amount > 0);
  return amounts[0] || 0;
}

function portalCollectedAmount(registration) {
  const amounts = [registration?.installment?.paid, registration?.installment?.paidAmount,
    registration?.amountCollected, registration?.paidAmount]
    .map(Number)
    .filter(Number.isFinite);
  const collectedAmount = amounts.find(amount => amount > 0);
  if (collectedAmount !== undefined) return collectedAmount;
  if (registration?.paymentStatus === 'paid') {
    const subscriptionAmount = portalSubscriptionAmount(registration);
    if (subscriptionAmount > 0) return subscriptionAmount;
  }
  return amounts[0] ?? 0;
}

function vipOriginalInvoiceDetails(invoice) {
  const invoiceItems = Array.isArray(invoice?.items) ? invoice.items : [];
  const selectedSubscriptions = Array.isArray(invoice?.selectedSubscriptions) ? invoice.selectedSubscriptions : [];
  const sourceItems = selectedSubscriptions.length ? selectedSubscriptions : invoiceItems;
  const sourceTotal = sourceItems.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
  const itemTotal = invoiceItems.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
  const originalTotals = [invoice?.vipOriginalPrice, invoice?.requestedAmount, sourceTotal, invoice?.installment?.total]
    .map(Number).filter(amount => Number.isFinite(amount) && amount > 0);
  const total = originalTotals.length ? Math.max(...originalTotals)
    : [invoice?.vipSubscriptionPrice, invoice?.subscriptionAmount, invoice?.vipFinalPrice, itemTotal]
      .map(Number).find(amount => Number.isFinite(amount) && amount > 0) ?? 0;
  let assigned = 0;
  const items = sourceItems.map((item, index) => {
    const price = index === sourceItems.length - 1
      ? Number((total - assigned).toFixed(2))
      : sourceTotal > 0 ? Number((total * (Number(item.price) || 0) / sourceTotal).toFixed(2)) : 0;
    assigned += price;
    return { ...item, price };
  });
  return { items, total };
}

function invoiceFinancialSummary(invoice) {
  if (invoice?.isPortalRegistration) {
    const total = portalSubscriptionAmount(invoice) || Number(invoice.requestedAmount || 0);
    const paid = portalCollectedAmount(invoice);
    return { total, paid, remaining: Math.max(0, total - paid) };
  }
  if (isInstallmentInvoice(invoice)) return getInstallmentSummary(invoice);

  const itemTotal = (invoice?.items || []).reduce((sum, item) => sum + (Number(item.price) || 0), 0);
  const total = Number(invoice?.isCustomBookletSubscription
    ? (invoice.subscriptionAmount ?? itemTotal)
    : invoice?.isVip ? (invoice.vipFinalPrice ?? itemTotal) : itemTotal) || 0;
  if (invoice?.isVip) {
    let paid = Number(invoice.amountCollected ?? invoice.paidAmount ?? total);
    if (!Number.isFinite(paid) || (paid === 0 && total > 0 && invoice.paymentStatus === 'paid' && !['full', 'free'].includes(invoice.vipPaymentMode))) paid = total;
    return { total, paid, remaining: 0 };
  }
  return { total, paid: total, remaining: 0 };
}

function formatInvoiceMoney(amount) {
  return (Number(amount) || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 });
}

function invoicePaidAmountMarkup(invoice) {
  const { paid } = invoiceFinancialSummary(invoice);
  return `<strong>${formatInvoiceMoney(paid)} ج</strong>`;
}

function invoiceRemainingAmountMarkup(invoice) {
  const { remaining } = invoiceFinancialSummary(invoice);
  return `<strong>${formatInvoiceMoney(remaining)} ج</strong>`;
}

function normalizeSubscriptionReference(value) {
  if (value && typeof value === 'object') value = value.id || value.name || value.value;
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function normalizeGrade(grade) {
  let value = String(grade || '').trim().replace(/^الفرقة\s*/, '').replace(/^ال/, '').replace(/\s+/g, ' ');
  value = value.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه');
  return value;
}

function getLinkedNotesForInvoice(invoice, subscriptionDocs) {
  const parentItems = invoice.isPortalRegistration
    ? (invoice.selectedSubscriptions || [])
    : (invoice.items?.length ? invoice.items : invoice.indivNotes || []);
  const parentReferences = new Set(parentItems.flatMap(item => [item.id, item.name])
    .map(normalizeSubscriptionReference).filter(Boolean));
  const invoiceGrade = normalizeGrade(invoice.grade);
  const previousDelivery = new Map((invoice.indivNotes || []).map(note => [note.noteId || note.name, note.delivered === true]));

  return subscriptionDocs
    .filter(docSnap => {
      const note = docSnap.data();
      const noteLinkedSubs = Array.isArray(note.linkedSubscriptions) && note.linkedSubscriptions.length
        ? note.linkedSubscriptions
        : String(note.linkedSubscription || '').split(',').map(s => s.trim()).filter(Boolean);
      const noteGrade = normalizeGrade(note.grade);
      return String(note.type || '').trim() === 'ملازم فردية'
        && (!invoiceGrade || !noteGrade || noteGrade === invoiceGrade)
        && noteLinkedSubs.some(s => parentReferences.has(normalizeSubscriptionReference(s)));
    })
    .map(docSnap => {
      const note = docSnap.data();
      return {
        noteId: docSnap.id,
        name: note.name,
        price: note.price || 0,
        delivered: previousDelivery.get(docSnap.id) === true || previousDelivery.get(note.name) === true,
        sortOrder: Number(note.sortOrder) || Number.MAX_SAFE_INTEGER
      };
    })
    .sort((first, second) => first.sortOrder - second.sortOrder
      || String(first.name || '').localeCompare(String(second.name || ''), 'ar', { numeric: true, sensitivity: 'base' }));
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

  const requestId = ++loadRequestId;

  if (!realtimeStarted) {
    realtimeStarted = true;
    onSnapshot(collection(db, 'invoices'), () => loadInvoices());
    onSnapshot(collection(db, 'studentRegistrations'), () => loadInvoices());
    onSnapshot(collection(db, 'vipRegistrations'), () => loadInvoices());
    onSnapshot(collection(db, 'users'), () => loadInvoices());
  }

  tableBody.innerHTML = "<tr><td colspan='10'>جاري التحميل...</td></tr>";
  let snapshots;
  try {
    snapshots = await Promise.all([
      getDocs(collection(db, "invoices")),
      getDocs(collection(db, "studentRegistrations")),
      getDocs(collection(db, "users")),
      getDocs(collection(db, "subscriptions")),
      getDocs(collection(db, "vipRegistrations")).catch(error => {
        console.warn('Could not read VIP registration invoice numbers:', error);
        return { docs: [] };
      })
    ]);
  } catch (error) {
    console.error('Could not load invoices:', error);
    if (requestId === loadRequestId) {
      tableBody.innerHTML = "<tr><td colspan='15'>تعذر تحميل الفواتير. تحقق من الاتصال ثم أعد المحاولة.</td></tr>";
    }
    return;
  }
  if (requestId !== loadRequestId) return;
  const [snapshot, portalSnapshot, usersSnapshot, subscriptionsSnapshot, vipRegistrationsSnapshot] = snapshots;
  const subscriptionDocs = subscriptionsSnapshot.docs;
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
      sourceCollection: 'invoices',
      num: inv.num ?? num,
      isVip: inv.isVip === true,
      isCustomBookletSubscription: inv.isCustomBookletSubscription === true || hasGeneratedBookletNote(inv.notes),
      subscriptionAmount: inv.subscriptionAmount ?? (hasGeneratedBookletNote(inv.notes)
        ? (inv.items || []).reduce((sum, item) => sum + (Number(item.price) || 0), 0)
        : undefined),
      vipIsFree: inv.vipIsFree === true,
      vipFinalPrice: inv.vipFinalPrice,
      vipPaymentMode: inv.vipPaymentMode || (inv.isVip
        ? (inv.payment === '\u062a\u0642\u0633\u064a\u0637' || inv.paymentMethod === '\u062a\u0642\u0633\u064a\u0637' || Number(inv.installment?.remaining || 0) > 0 ? 'installment'
          : inv.payment === '\u0645\u062c\u0627\u0646\u064a' || inv.paymentMethod === '\u0645\u062c\u0627\u0646\u064a' ? 'free'
            : 'full')
        : ''),
      vipRegistrationId: inv.vipRegistrationId || '',
      paidAmount: Number(inv.paidAmount ?? 0),
      amountCollected: Number(inv.amountCollected ?? inv.paidAmount ?? 0),
      paymentStatus: inv.paymentStatus || '',
      student: inv.student || '-',
      phone: inv.phone || '',
      subType: type,
      items: inv.items || [],
      payment: inv.payment || '-',
      installment: inv.installment || null,
      studyType: inv.studyType || '-',
      grade: inv.grade || '-',
      date: inv.date ? (inv.date.toDate ? inv.date.toDate().toLocaleDateString('ar-EG') : inv.date) : '-',
      status: inv.status || 'تم الحفظ',
      recipient: inv.recipient || '-',
      notes: cleanGeneratedBookletNote(inv.notes) || 'لا توجد',
      linkedSubTypes: inv.linkedSubTypes || [],
      indivNotes: inv.indivNotes || [],   // للملازم: قائمة الملازم المرتبطة وحالة تسليمها
      linkedNotes: getLinkedNotesForInvoice({ ...inv, grade: inv.grade || '-' }, subscriptionDocs),
      onlineCardsDelivery: inv.onlineCardsDelivery || [] // للكروت الأونلاين
    });
    counters[type] = num + 1;
  });

  // عرض تسجيلات الطلاب القادمة من QR بجانب فواتير الطلاب المشتركين.
  portalSnapshot.docs.forEach(docSnap => {
    highestInvoiceNumber = Math.max(highestInvoiceNumber, Number(docSnap.data().invoiceNumber) || 0);
  });
  vipRegistrationsSnapshot.docs.forEach(docSnap => {
    highestInvoiceNumber = Math.max(highestInvoiceNumber, Number(docSnap.data().invoiceNumber) || 0);
  });
  const linkedVipRegistrationIds = new Set(snapshot.docs.map(docSnap => docSnap.data().vipRegistrationId).filter(Boolean));
  vipRegistrationsSnapshot.docs.forEach(docSnap => {
    const registration = docSnap.data();
    const hasLinkedInvoice = linkedVipRegistrationIds.has(docSnap.id)
      || (registration.invoiceId && snapshot.docs.some(invoiceDoc => invoiceDoc.id === String(registration.invoiceId)));
    if (hasLinkedInvoice) return;
    if (registration.invoiceId) return;
    const subscriptions = Array.isArray(registration.selectedSubscriptions) ? registration.selectedSubscriptions : [];
    const totalSourcePrice = subscriptions.reduce((sum, item) => sum + Number(item.price || 0), 0);
    const paymentSaysInstallment = registration.payment === '\u062a\u0642\u0633\u064a\u0637' || registration.paymentMethod === '\u062a\u0642\u0633\u064a\u0637';
    const vipPaymentMode = registration.vipPaymentMode || registration.teacherReportedPaymentMode
      || (paymentSaysInstallment || Number(registration.installment?.remaining || 0) > 0 ? 'installment'
        : registration.payment === '\u0645\u062c\u0627\u0646\u064a' || registration.paymentMethod === '\u0645\u062c\u0627\u0646\u064a' ? 'free'
          : registration.paymentStatus === 'paid' ? 'full' : '');
    const subscriptionAmount = Number(registration.installment?.total ?? registration.subscriptionAmount
      ?? registration.requestedAmount ?? (paymentSaysInstallment ? totalSourcePrice : registration.paidAmount) ?? 0);
    const installmentPaid = Number(registration.installment?.paid ?? registration.amountCollected ?? registration.paidAmount ?? 0);
    const isInstallment = vipPaymentMode ? vipPaymentMode === 'installment'
      : paymentSaysInstallment || Boolean(registration.installment && subscriptionAmount > Number(registration.installment.paid ?? registration.installment.paidAmount ?? 0));
    const hasOutstandingInstallment = isInstallment && subscriptionAmount - installmentPaid > 0;
    if (registration.paymentStatus !== 'paid' && !hasOutstandingInstallment) return;
    let allocated = 0;
    const items = subscriptions.map((item, index) => {
      const price = index === subscriptions.length - 1
        ? Number((subscriptionAmount - allocated).toFixed(2))
        : totalSourcePrice > 0 ? Number((subscriptionAmount * Number(item.price || 0) / totalSourcePrice).toFixed(2)) : 0;
      allocated += price;
      return { ...item, price };
    });
    allInvoices.push({
      id: docSnap.id,
      sourceCollection: 'vipRegistrations',
      isVip: true,
      isVipRegistration: true,
      vipIsFree: vipPaymentMode === 'free' || (!vipPaymentMode && subscriptionAmount === 0),
      vipPaymentMode,
      vipFinalPrice: subscriptionAmount,
      subscriptionAmount,
      requestedAmount: subscriptionAmount,
      num: registration.invoiceNumber || `VIP-${docSnap.id.slice(-6)}`,
      student: registration.studentName || '-',
      phone: registration.phone || '',
      subType: classifyPortalSubscriptions(subscriptions),
      items,
      selectedSubscriptions: subscriptions,
      installment: vipPaymentMode && vipPaymentMode !== 'installment' ? null : registration.installment || (isInstallment ? { total: subscriptionAmount, paid: installmentPaid, remaining: Math.max(0, subscriptionAmount - installmentPaid) } : null),
      payment: isInstallment ? '\u062a\u0642\u0633\u064a\u0637' : registration.paymentMethod || (installmentPaid === 0 ? '\u0645\u062c\u0627\u0646\u064a' : '\u0646\u0642\u062f\u064a'),
      paymentStatus: registration.paymentStatus || (hasOutstandingInstallment ? 'partial' : 'paid'),
      paidAmount: installmentPaid,
      amountCollected: installmentPaid,
      studyType: registration.studyType || '-',
      grade: registration.grade || '-',
      date: (registration.paidAt || registration.registeredAt)?.toDate
        ? (registration.paidAt || registration.registeredAt).toDate().toLocaleDateString('ar-EG')
        : (registration.paidAt || registration.registeredAt || '-'),
      status: 'VIP',
      recipient: registration.teacherName || '-',
      notes: cleanGeneratedBookletNote(registration.notes) || 'VIP QR',
      linkedSubTypes: [],
      indivNotes: registration.indivNotes || [],
      linkedNotes: [],
      onlineCardsDelivery: registration.onlineCardsDelivery || []
    });
  });
  let nextPortalInvoiceNumber = highestInvoiceNumber + 1;
  portalSnapshot.forEach(docSnap => {
    const registration = docSnap.data();
    const visibleSubscriptions = normalizePortalSubscriptions(registration);
    const requestedAmount = portalSubscriptionAmount(registration);
    const paidAmount = portalCollectedAmount(registration);
    const paymentStatus = requestedAmount > paidAmount && paidAmount > 0
      ? 'partial'
      : registration.paymentStatus || (paidAmount > 0 ? 'paid' : 'unpaid');
    const invoiceNumber = Number(registration.invoiceNumber) || nextPortalInvoiceNumber++;
    if (!registration.invoiceNumber) {
      updateDoc(doc(db, 'studentRegistrations', docSnap.id), { invoiceNumber }).catch(error => console.warn('Could not save portal invoice number', error));
    }
    allInvoices.push({
      id: docSnap.id,
      sourceCollection: 'studentRegistrations',
      isPortalRegistration: true,
      num: invoiceNumber,
      student: registration.studentName || '-',
      phone: registration.phone || '-',
      subType: classifyPortalSubscriptions(visibleSubscriptions),
      items: [],
      payment: registration.payment === '\u062a\u0642\u0633\u064a\u0637' || registration.paymentMethod === '\u062a\u0642\u0633\u064a\u0637'
        ? '\u062a\u0642\u0633\u064a\u0637' : registration.paymentMethod || registration.payment || 'نقدي',
      paymentMethod: registration.paymentMethod || registration.payment || 'نقدي',
      paymentStatus,
      paidAmount,
      amountCollected: paidAmount,
      requestedAmount,
      installment: registration.installment || null,
      selectedSubscriptions: visibleSubscriptions,
      subscriptionFallback: portalSubscriptionFallback(registration),
      studyType: registration.studyType || '-',
      grade: registration.grade || '-',
      date: registration.registeredAt ? (registration.registeredAt.toDate ? registration.registeredAt.toDate().toLocaleDateString('ar-EG') : registration.registeredAt) : '-',
      status: 'تسجيل طالب',
      agentId: registration.agentId || '-',
      recipient: userNames.get(registration.agentId) || registration.agentId || '-',
      notes: cleanGeneratedBookletNote(registration.notes || registration.note || registration.remark) || 'تسجيل من الموقع',
      linkedSubTypes: [],
      indivNotes: registration.indivNotes || [],
      linkedNotes: getLinkedNotesForInvoice({ ...registration, isPortalRegistration: true, selectedSubscriptions: visibleSubscriptions }, subscriptionDocs),
      onlineCardsDelivery: registration.onlineCardsDelivery || []
    });
  });
  filteredInvoices = [...allInvoices];
  fillRecipientFilter();
  renderInvoicesTable();
}


// عرض الفواتير في الجدول
function renderInvoicesTable() {
  const invoicesTable = document.getElementById('invoices-table');
  const cardsMode = invoiceViewMode === 'cards';
  if (invoicesTable) invoicesTable.hidden = cardsMode;
  if (invoiceCardsContainer) invoiceCardsContainer.hidden = !cardsMode;
  document.querySelectorAll('[data-invoice-view]').forEach(button => {
    const active = button.dataset.invoiceView === invoiceViewMode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  tableBody.innerHTML = '';
  if (filteredInvoices.length === 0) {
    tableBody.innerHTML = "<tr><td colspan='12'>لا توجد نتائج مطابقة.</td></tr>";
    if (invoiceCardsContainer) invoiceCardsContainer.innerHTML = '<div class="invoice-card-empty">لا توجد نتائج مطابقة.</div>';
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
    const isNotesSubscription = inv.subType === 'ملازم' || inv.subType === 'اشتراك ملازم' || inv.subType === 'ملازم وكورسات';
    const portalItemsText = inv.isPortalRegistration && inv.selectedSubscriptions?.length
      ? inv.selectedSubscriptions.map(item => item.name).filter(Boolean).join('، ')
      : itemsText;
    // تحسين مظهر المستلم
    let recipientCell = `<span class="recipient-cell" style="display:inline-block;padding:4px 12px;border-radius:8px;background:linear-gradient(90deg,#e3f2fd 60%,#bbdefb 100%);color:#1976d2;font-weight:bold;font-size:1em;box-shadow:0 1px 4px #90caf922;">${inv.recipient && inv.recipient !== '-' ? inv.recipient : '<span style=\'color:#b3b3b3\'>غير محدد</span>'}</span>`;
    const tr = document.createElement("tr");
    if (inv.isPortalRegistration) tr.className = 'portal-registration-row';
    let actions = `<button class='open-invoice-btn' data-id='${inv.id}' data-portal='${inv.isPortalRegistration ? 'true' : 'false'}' data-vip-registration='${inv.isVipRegistration ? 'true' : 'false'}' style='background:#1976d2;color:#fff;padding:6px 14px;border:none;border-radius:6px;cursor:pointer;font-weight:bold;'>فتح</button>`;
    if (inv.isPortalRegistration) {
      actions = `<label class="portal-payment-control"><span>حالة الدفع</span><select class="portal-payment-status" aria-label="تغيير حالة الدفع" data-id="${inv.id}" data-previous="${inv.paymentStatus}"><option value="unpaid" ${inv.paymentStatus === 'unpaid' ? 'selected' : ''}>لم يدفع</option><option value="partial" ${inv.paymentStatus === 'partial' ? 'selected' : ''} disabled>تقسيط</option><option value="paid" ${inv.paymentStatus === 'paid' ? 'selected' : ''}>تم الدفع</option></select></label>${actions}`;
    }
    if ((isInstallmentInvoice(inv) || inv.isPortalRegistration) && invoiceFinancialSummary(inv).remaining > 0) {
      actions += `<button class='record-installment-payment-btn' data-id='${inv.id}' style='background:#087f72;color:#fff;padding:6px 12px;border:none;border-radius:6px;cursor:pointer;font-weight:bold;'>تسجيل قسط</button>`;
    }
    if (canDeleteInvoice) {
      actions += `<button class='delete-invoice-btn' data-id='${inv.id}' style='background:#f44336;color:#fff;padding:6px 14px;border:none;border-radius:6px;cursor:pointer;'>حذف</button>`;
    }
    // ملخص تسليم الملازم
    let deliverySummary = '-';
    if (isNotesSubscription) {
      const total = inv.linkedNotes?.length || 0;
      const delivered = (inv.linkedNotes || []).filter(n => n.delivered).length;
      const allDone = delivered === total;
      deliverySummary = `<span style="font-weight:bold;color:${allDone && total ? '#388e3c' : '#e65100'};background:${allDone && total ? '#e8f5e9' : '#fff3e0'};padding:3px 10px;border-radius:8px;">إجمالي ${total}، مستلم ${delivered}</span>`;
    }

    // ملخص تسليم الكروت
    let cardSummary = '-';
    if (inv.onlineCardsDelivery && inv.onlineCardsDelivery.length > 0) {
      const total = inv.onlineCardsDelivery.length;
      const delivered = inv.onlineCardsDelivery.filter(c => c.delivered === true || c.isDelivered === true).length;
      const allDone = delivered === total;
      cardSummary = `<span style="font-weight:bold;color:${allDone ? '#1976d2' : '#d32f2f'};background:${allDone ? '#e3f2fd' : '#ffebee'};padding:3px 10px;border-radius:8px;">${delivered}/${total} 🃏</span>`;
    }

    tr.innerHTML = `
      <td>${inv.num}</td>
      <td>${inv.student}${inv.isVip ? ' <span class="vip-badge">VIP</span>' : ''}</td>
      <td>${phoneCell}</td>
      <td class="items-cell">${portalItemsText || inv.subscriptionFallback || '-'}</td>
      <td class="type-cell">${inv.subType}</td>
      <td>${inv.grade}</td>
      <td class="amount-cell">${invoicePaidAmountMarkup(inv)}</td>
      <td class="amount-cell remaining-cell">${invoiceRemainingAmountMarkup(inv)}</td>
      <td class="invoice-payment-cell">${invoiceTypeMarkup(inv)}</td>
      <td>${inv.studyType}</td>
      <td>${inv.date}</td>
      <td>${inv.isPortalRegistration ? (inv.notes && String(inv.notes).trim() ? `${inv.notes} — من الموقع` : 'تسجيل من الموقع') : (inv.notes || 'لا توجد')}</td>
      <td>${recipientCell}</td>
      <td style='text-align:center;'>${deliverySummary}</td>
      <td style='text-align:center;'>${cardSummary}</td>
      <td style='display:flex;gap:6px;justify-content:center;align-items:center;'>${actions}</td>
    `;
    tableBody.appendChild(tr);
  });

  if (invoiceCardsContainer) {
    invoiceCardsContainer.innerHTML = filteredInvoices.map(inv => {
      const financialSummary = invoiceFinancialSummary(inv);
      const itemsText = inv.isPortalRegistration && inv.selectedSubscriptions?.length
        ? inv.selectedSubscriptions.map(item => item.name).filter(Boolean).join('، ')
        : (inv.items || []).map(item => item.name || item.title).filter(Boolean).join('، ');
      const paymentLabel = inv.isPortalRegistration
        ? (isPortalInstallment(inv) ? 'تقسيط' : inv.paymentStatus === 'paid' ? 'تم الدفع' : 'لم يدفع')
        : invoicePaymentLabel(inv);
      const bookletSummary = inv.linkedNotes?.length
        ? `الملازم: ${inv.linkedNotes.filter(note => note.delivered).length} مستلمة من ${inv.linkedNotes.length}`
        : '';
      const id = escapeInvoiceHtml(inv.id);
      let actions = '';
      if (inv.isPortalRegistration) {
        actions += `<label class="portal-payment-control"><span>حالة الدفع</span><select class="portal-payment-status" aria-label="تغيير حالة الدفع" data-id="${id}" data-previous="${escapeInvoiceHtml(inv.paymentStatus)}"><option value="unpaid" ${inv.paymentStatus === 'unpaid' ? 'selected' : ''}>لم يدفع</option><option value="partial" ${inv.paymentStatus === 'partial' ? 'selected' : ''} disabled>تقسيط</option><option value="paid" ${inv.paymentStatus === 'paid' ? 'selected' : ''}>تم الدفع</option></select></label>`;
      }
      if ((isInstallmentInvoice(inv) || inv.isPortalRegistration) && invoiceFinancialSummary(inv).remaining > 0) {
        actions += `<button class="invoice-card-action-button record-installment-payment-btn" data-id="${id}">تسجيل قسط</button>`;
      }
      actions += `<button class="invoice-card-action-button open-invoice-btn" data-id="${id}" data-portal="${inv.isPortalRegistration ? 'true' : 'false'}" data-vip-registration="${inv.isVipRegistration ? 'true' : 'false'}">فتح</button>`;
      if (canDeleteInvoice) actions += `<button class="invoice-card-action-button delete delete-invoice-btn" data-id="${id}">حذف</button>`;

      return `<article class="invoice-card">
        <div class="invoice-card-head"><span>فاتورة #${escapeInvoiceHtml(inv.num)}</span><span>${escapeInvoiceHtml(inv.subType || 'فاتورة')}</span></div>
        <div class="invoice-card-body">
          <h3>${escapeInvoiceHtml(inv.student || '-')}</h3>
          <p class="invoice-card-items">${escapeInvoiceHtml(itemsText || inv.subscriptionFallback || 'لا توجد تفاصيل عناصر')}</p>
          <div class="invoice-card-meta">
            <div><small>الفرقة</small><strong>${escapeInvoiceHtml(inv.grade || '-')}</strong></div>
            <div><small>النظام</small><strong>${escapeInvoiceHtml(inv.studyType || '-')}</strong></div>
            <div><small>التاريخ</small><strong>${escapeInvoiceHtml(inv.date || '-')}</strong></div>
            <div><small>حالة الدفع</small><strong>${escapeInvoiceHtml(paymentLabel)}</strong></div>
            <div><small>المستلم</small><strong>${escapeInvoiceHtml(inv.recipient || '-')}</strong></div>
            <div><small>المبلغ المدفوع</small><strong class="invoice-card-amount">${formatInvoiceMoney(financialSummary.paid)} ج</strong></div>
            <div><small>المتبقي</small><strong class="invoice-card-remaining">${formatInvoiceMoney(financialSummary.remaining)} ج</strong></div>
          </div>
          ${bookletSummary ? `<p class="invoice-card-items">${escapeInvoiceHtml(bookletSummary)}</p>` : ''}
        </div>
        <div class="invoice-card-footer"><div class="invoice-card-actions">${actions}</div></div>
      </article>`;
    }).join('');
  }

  // إعادة ربط الأحداث
  document.querySelectorAll('.open-invoice-btn').forEach(btn => {
    btn.onclick = () => {
      showInvoiceModal(btn.getAttribute('data-id'), btn.dataset.portal === 'true', btn.dataset.vipRegistration === 'true');
      showNotification('تم فتح تفاصيل الفاتورة', 'info');
    };
  });
  document.querySelectorAll('.record-installment-payment-btn').forEach(btn => {
    btn.onclick = () => {
      const invoice = allInvoices.find(item => item.id === btn.dataset.id);
      if (!invoice) return;
      showInstallmentPaymentDialog(invoice, {
        invoiceId: invoice.id,
        collectionName: invoice.sourceCollection || 'invoices',
        receivedBy: currentRecipient,
        onSuccess: async result => {
          showNotification(`تم تسجيل ${result.paymentEntry.amount.toFixed(2)} ج بطريقة ${result.paymentEntry.method}`, 'success');
          await loadInvoices();
        }
      });
    };
  });
  document.querySelectorAll('.delete-invoice-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-id');
      const invoice = allInvoices.find(item => item.id === id);
      const targetCollection = invoice?.isVipRegistration ? 'vipRegistrations' : invoice?.isPortalRegistration ? 'studentRegistrations' : 'invoices';
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
      if (status !== 'paid') {
        select.value = select.dataset.previous;
        return;
      }
      const paymentMethod = await choosePaymentMethod(registration?.paymentMethod || 'نقدي');
      if (!paymentMethod) {
        select.value = select.dataset.previous;
        return;
      }
      try {
        select.disabled = true;
        const registrationRef = doc(db, 'studentRegistrations', select.dataset.id);
        const paymentRef = doc(collection(db, 'studentPortalPayments'));
        const paidAt = Timestamp.now();
        const currentUser = getAuth().currentUser;
        const recordedBy = currentUser?.uid || currentUser?.email || currentRecipient || '-';
        let amount = 0;
        await runTransaction(db, async transaction => {
          const currentSnapshot = await transaction.get(registrationRef);
          if (!currentSnapshot.exists()) throw new Error('التسجيل لم يعد موجودًا. حدّث الصفحة وحاول مرة أخرى.');
          const current = currentSnapshot.data();
          const totalAmount = portalSubscriptionAmount(current);
          const collectedAmount = portalCollectedAmount(current);
          amount = Math.max(0, totalAmount - collectedAmount);
          if (amount <= 0) throw new Error('لا يوجد مبلغ محفوظ لهذا الاشتراك');
          const totalCollected = collectedAmount + amount;
          const paymentEntry = { amount, method: paymentMethod, paidAt, receivedBy: recordedBy };
          const installment = current.installment ? {
            ...current.installment,
            total: totalAmount,
            paid: totalCollected,
            remaining: Math.max(0, totalAmount - totalCollected),
            paidAll: totalCollected >= totalAmount,
            paymentStatus: totalCollected >= totalAmount ? 'paid' : 'partial',
            lastPaymentMethod: paymentMethod,
            payments: [...(Array.isArray(current.installment.payments) ? current.installment.payments : []), paymentEntry]
          } : null;
          transaction.update(registrationRef, {
            paymentStatus: 'paid',
            paidAmount: totalCollected,
            amountCollected: totalCollected,
            recordedBy,
            paidBy: currentRecipient,
            payment: paymentMethod,
            paymentMethod,
            ...(installment ? { installment } : {}),
            paidAt
          });
          transaction.set(paymentRef, {
            registrationId: select.dataset.id,
            invoiceNumber: current.invoiceNumber || registration?.num || null,
            agentId: current.agentId || registration?.agentId || registration?.recipient || '-',
            studentName: current.studentName || registration?.student || '-',
            amount,
            payment: paymentMethod,
            paymentMethod,
            recordedBy,
            paidAt,
            source: 'invoices-page'
          });
        });
        window.showNotification('تم تحديث حالة الدفع', 'success');
        await loadInvoices();
      } catch (error) {
        console.error(error);
        select.value = select.dataset.previous;
        window.showNotification(error.message || 'تعذر تحديث حالة الدفع', 'error');
      }
    });
  });

}

function choosePaymentMethod(currentMethod = 'نقدي') {
  return new Promise(resolve => {
    const old = document.getElementById('payment-method-picker');
    if (old) old.remove();
    const overlay = document.createElement('div');
    overlay.id = 'payment-method-picker';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:10000;';
    overlay.innerHTML = `<div style="background:#fff;width:min(360px,90vw);padding:24px;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.25);text-align:center;direction:rtl;"><h3 style="margin:0 0 18px;color:#1976d2;">طريقة الدفع التي استلمها البرنامج</h3><div style="display:grid;gap:10px;"><button data-method="نقدي" style="padding:11px;border:0;border-radius:7px;background:#2e7d32;color:#fff;font-weight:bold;cursor:pointer;">نقدي</button><button data-method="فودافون كاش" style="padding:11px;border:0;border-radius:7px;background:#c62828;color:#fff;font-weight:bold;cursor:pointer;">فودافون كاش</button><button data-method="تقسيط" style="padding:11px;border:0;border-radius:7px;background:#ef6c00;color:#fff;font-weight:bold;cursor:pointer;">تقسيط</button><button data-method="cancel" style="padding:8px;border:1px solid #aaa;border-radius:7px;background:#fff;color:#555;cursor:pointer;">إلغاء</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-method]').forEach(button => {
      button.onclick = () => {
        const method = button.dataset.method;
        overlay.remove();
        resolve(method === 'cancel' ? null : method || currentMethod);
      };
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
async function showInvoiceModal(id, isPortalRegistration = false, isVipRegistration = false) {
  // جلب الفاتورة مباشرة من قاعدة البيانات لضمان تحديث البيانات
  const sourceCollection = isVipRegistration ? 'vipRegistrations' : isPortalRegistration ? 'studentRegistrations' : 'invoices';
  const invDoc = await getDoc(doc(db, sourceCollection, id));
  if (!invDoc.exists()) return alert("لم يتم العثور على الفاتورة!");
  const inv = invDoc.data();
  if (inv.isVip && !inv.vipPaymentMode) {
    inv.vipPaymentMode = inv.payment === '\u062a\u0642\u0633\u064a\u0637' || inv.paymentMethod === '\u062a\u0642\u0633\u064a\u0637' || Number(inv.installment?.remaining || 0) > 0
      ? 'installment'
      : inv.payment === '\u0645\u062c\u0627\u0646\u064a' || inv.paymentMethod === '\u0645\u062c\u0627\u0646\u064a'
        ? 'free'
        : 'full';
  }
  if (inv.isVip && inv.vipPaymentMode === 'free') inv.vipIsFree = true;
  if (hasGeneratedBookletNote(inv.notes)) {
    inv.isCustomBookletSubscription = true;
    inv.subscriptionAmount = inv.subscriptionAmount ?? (inv.items || []).reduce((sum, item) => sum + (Number(item.price) || 0), 0);
  }
  if (isPortalRegistration) {
    const subscriptions = normalizePortalSubscriptions(inv);
    inv.selectedSubscriptions = subscriptions;
    inv.student = inv.studentName || '-';
    inv.phone = inv.phone || '-';
    inv.subType = classifyPortalSubscriptions(subscriptions);
    inv.items = subscriptions.map(item => ({ name: item.name, price: item.price }));
    inv.payment = isInstallmentInvoice(inv) ? '\u062a\u0642\u0633\u064a\u0637' : inv.paymentMethod || inv.payment || 'نقدي';
    inv.requestedAmount = portalSubscriptionAmount(inv) || inv.items.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
    inv.paidAmount = portalCollectedAmount(inv);
    inv.amountCollected = inv.paidAmount;
    if (!inv.installment && isInstallmentInvoice(inv)) {
      const summary = getInstallmentSummary({ ...inv, requestedAmount: inv.requestedAmount, paidAmount: inv.paidAmount });
      inv.installment = { total: summary.total, paid: summary.paid, remaining: summary.remaining };
    }
    inv.num = inv.invoiceNumber || '-';
    inv.grade = inv.grade || '-';
    inv.studyType = inv.studyType || '-';
    inv.date = inv.registeredAt || '-';
    inv.notes = cleanGeneratedBookletNote(inv.notes || inv.note || inv.remark);
    if (inv.agentId) {
      try {
        const agentDoc = await getDoc(doc(db, 'users', inv.agentId));
        if (agentDoc.exists()) {
          const agent = agentDoc.data();
          inv.recipient = agent.username || agent.fullname || agent.name || agent.email || inv.agentId;
        }
      } catch (error) {
        console.warn('Could not load portal registration recipient:', error);
      }
    }
    inv.recipient = inv.recipient || inv.agentId || currentRecipient || '-';
  }
  // إصلاح تعريف isNotesSubscription
  if (isVipRegistration) {
    const subscriptions = Array.isArray(inv.selectedSubscriptions) ? inv.selectedSubscriptions : [];
    inv.student = inv.studentName || "-";
    inv.subType = classifyPortalSubscriptions(subscriptions);
    const originalDetails = vipOriginalInvoiceDetails(inv);
    const displayTotal = originalDetails.total;
    inv.items = originalDetails.items;
    inv.vipPaymentMode = inv.vipPaymentMode || inv.teacherReportedPaymentMode
      || (inv.payment === '\u062a\u0642\u0633\u064a\u0637' || inv.paymentMethod === '\u062a\u0642\u0633\u064a\u0637' ? 'installment'
        : inv.payment === '\u0645\u062c\u0627\u0646\u064a' || inv.paymentMethod === '\u0645\u062c\u0627\u0646\u064a' ? 'free'
          : inv.paymentStatus === 'paid' ? 'full' : '');
    const isInstallmentPayment = isInstallmentInvoice(inv);
    inv.payment = isInstallmentPayment ? '\u062a\u0642\u0633\u064a\u0637' : (inv.paymentMethod || (Number(inv.amountCollected ?? inv.paidAmount ?? 0) === 0 ? 'VIP free' : 'VIP paid'));
    inv.subscriptionAmount = displayTotal;
    inv.num = inv.invoiceNumber || "-";
    inv.date = inv.paidAt || inv.registeredAt || "-";
    inv.recipient = inv.teacherName || "-";
    inv.isVip = true;
    inv.vipIsFree = inv.vipPaymentMode === 'free' || (displayTotal === 0 && inv.paymentStatus !== 'paid');
  }
  const isNotesSubscription = inv.subType && (inv.subType === 'اشتراك ملازم' || inv.subType === 'ملازم' || inv.subType === 'ملازم وكورسات');

  // Load only individual notes linked to the selected subscription.
  let allNotesList = [];
  if (isNotesSubscription && inv.grade) {
    const subsSnap = await getDocs(collection(db, "subscriptions"));
    allNotesList = getLinkedNotesForInvoice(inv, subsSnap.docs);
    if (!allNotesList.length && Array.isArray(inv.indivNotes)) {
      allNotesList = inv.indivNotes;
    }
    if (allNotesList.length > 0) {
      try {
        await updateDoc(doc(db, sourceCollection, id), { indivNotes: allNotesList });
      } catch (e) { console.warn('Could not save indivNotes:', e); }
    }
  }
  const vipOriginalDetails = inv.isVip ? vipOriginalInvoiceDetails(inv) : null;
  const invoiceDisplayItems = vipOriginalDetails?.items || inv.items || [];
  const invoiceItemsTotal = invoiceDisplayItems.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
  const invoiceTotal = inv.isVip
    ? vipOriginalDetails.total
    : inv.isCustomBookletSubscription ? Number(inv.subscriptionAmount ?? invoiceItemsTotal) : invoiceItemsTotal;
  // مربعات استلام الملازم في اشتراك ملازم
  let notesDeliveryBoxes = '';
  // استخدم allNotesList مباشرة للعداد والعرض
  let notesArr = allNotesList.length > 0 ? allNotesList : [];
  if (isNotesSubscription && notesArr.length > 0) {
    const deliveredCount = notesArr.filter(x => x.delivered).length;
    const remainingCount = notesArr.length - deliveredCount;
    notesDeliveryBoxes = `<div style='margin:6px 0 0;display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12px;line-height:1.2;'>
          <b style='color:#1565c0;'>إجمالي الملازم المرتبطة: ${notesArr.length}</b>
      <b style='color:#1976d2;'>عدد الملازم المستلمة: ${deliveredCount}</b>
      <span style='color:#e53935;'>الملازم المتبقية: ${remainingCount}</span>
    </div>`;
  } else if (isNotesSubscription) {
    notesDeliveryBoxes = `<div style='margin:6px 0 0;color:#c62828;font-size:12px;font-weight:bold;'>لم يستلم ملازم بعد</div>`;
  }
  // --- مربعات استلام الملازم الفردية حسب الفرقة ---
  let indivNotesBoxes = '';
  if (isNotesSubscription && allNotesList.length > 0) {
    indivNotesBoxes = `<div style='margin:6px 0 0;'>
      <b style='color:#1976d2;'>حالة تسليم الملازم:</b>
      <div class='indiv-notes-list' style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:100%;box-sizing:border-box;gap:6px;margin-top:5px;">
        ${allNotesList.map((x, i) =>
      `<label class='indiv-note-box' style="background:#fff;padding:7px 5px;border-radius:8px;border:1px solid #e0e0e0;text-align:center;line-height:1.2;cursor:pointer;user-select:none;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:4px;min-width:0;width:100%;box-sizing:border-box;overflow:hidden;">
        <span style="font-weight:bold;font-size:0.82em;grid-column:1/-1;overflow-wrap:anywhere;">${x.name}</span>
        <input type='checkbox' class='indiv-note-delivered-checkbox' data-idx='${i}' aria-label='تم استلام ${x.name}' ${x.delivered ? 'checked' : ''} style="width:20px;height:20px;justify-self:center;cursor:pointer;accent-color:#2e7d32;">
        <span class='indiv-note-delivered-status' style="font-size:0.75em;color:${x.delivered ? '#2e7d32' : '#d32f2f'};overflow-wrap:anywhere;">${x.delivered ? 'تم الاستلام' : 'لم يستلم'}</span>
          </label>`
    ).join('')}
      </div>
    </div>`;
  }

  // --- مربعات استلام كروت الأونلاين ---
  let cardDeliverySummary = '';
  let indivCardsBoxes = '';

  // لو الفاتورة قديمة ومعندهاش onlineCardsDelivery، نحاول نجيب الكروت المناسبة (للاشتراكات)
  const hasOnlineCardsSubscriptionType = inv.subType && (
    inv.subType.includes('اشتراك') ||
    inv.subType.includes('كورسات') ||
    inv.subType.includes('ملازم')
  );

  if (!Array.isArray(inv.onlineCardsDelivery) && hasOnlineCardsSubscriptionType) {
    const cardsSnap = await getDocs(collection(db, "onlineCards"));
    const autoCards = [];
    const invoiceItems = isPortalRegistration
      ? ([inv.selectedSubscriptions, inv.subscriptions, inv.selectedItems].find(items => Array.isArray(items) && items.length) || [])
      : (inv.items || []);
    const invoiceSubscriptionIds = new Set(invoiceItems.map(item => item.id).filter(Boolean));
    cardsSnap.forEach(docSnap => {
      const data = docSnap.data();
      if (data.type !== 'للاشتراكات') return;
      const linkedIds = Array.isArray(data.linkedSubscriptionIds) ? data.linkedSubscriptionIds : [];
      if (linkedIds.length && !linkedIds.some(linkedId => invoiceSubscriptionIds.has(linkedId))) return;
      const matchingCount = linkedIds.length
        ? invoiceItems.filter(item => linkedIds.includes(item.id)).length
        : invoiceItems.length;
      if (!matchingCount) return;
      autoCards.push({
        id: docSnap.id,
        cardId: docSnap.id,
        name: data.name,
        type: data.type,
        perSub: data.perSub || 1,
        quantity: matchingCount * (data.perSub || 1),
        delivered: false,
        linkedSubscriptionIds: invoiceItems
          .filter(item => !linkedIds.length || linkedIds.includes(item.id))
          .map(item => item.id)
          .filter(Boolean)
      });
    });
    if (autoCards.length > 0) {
      inv.onlineCardsDelivery = autoCards;
      // حفظها في الفاتورة مستقبلاً
      try {
        await updateDoc(doc(db, sourceCollection, id), { onlineCardsDelivery: autoCards });
      } catch (e) { console.warn('Could not auto-save onlineCardsDelivery:', e); }
    }
  }

  const onlineCardsArr = (inv.onlineCardsDelivery || []).map(card => ({
    ...card,
    cardId: card.cardId || card.id,
    delivered: card.delivered === true || card.isDelivered === true
  }));
  if (onlineCardsArr.length > 0) {
    indivCardsBoxes = `<div style='margin:12px 0 0 0;'>
      <b style='color:#1565c0;'>كروت الأونلاين:</b>
      <div class='indiv-cards-list' style="display:grid;grid-template-columns:repeat(auto-fill, minmax(140px, 1fr));gap:10px;margin-top:10px;">
        ${onlineCardsArr.map((x, i) =>
      `<div class='indiv-card-box' style="background:#fff;padding:10px;border-radius:10px;border:2px solid ${x.delivered ? '#1976d2' : '#ffebee'};text-align:center;box-shadow:0 2px 5px rgba(0,0,0,0.05);">
            <div style="font-weight:bold;font-size:0.9em;margin-bottom:5px;color:#1565c0;">${x.name}</div>
            <input type='checkbox' class='card-delivered-checkbox' data-idx='${i}' ${x.delivered ? 'checked' : ''} style="width:20px;height:20px;accent-color:#1976d2;">
            <div style="font-size:0.8em;font-weight:bold;margin-top:4px;color:${x.delivered ? '#1976d2' : '#d32f2f'}">${x.delivered ? 'استلم كارت أونلاين' : 'لم يستلم الكارت الأونلاين'}</div>
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
  if (!/^(data:|https?:|file:)/i.test(logoUrl)) {
    logoUrl = new URL(logoUrl, window.location.href).href;
  }
  // تشكيل أرقام السنتر مع فاصل -
  const phones = [centerPhone1, centerPhone2, centerPhone3].filter(p => p && p.trim());
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
  let phoneHtml = centerWhatsAppQr ? `
    <a href='${centerWhatsAppUrl}' target='_blank' rel='noopener' style='position:relative;display:inline-flex;align-items:center;justify-content:center;text-decoration:none;cursor:pointer;'>
      <img src='${centerWhatsAppQr}' alt='WhatsApp QR' style='display:block;width:22px;height:22px;border:2px solid #000;border-radius:6px;background:#fff;padding:1px;box-shadow:none;' />
      <span style='position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center;width:8px;height:8px;border-radius:50%;background:#fff;border:1px solid #000;box-shadow:0 1px 3px rgba(0,0,0,.15);'>
        <svg viewBox='0 0 24 24' width='6' height='6' style='fill:#25d366;'><path d='M19.05 4.95A9.89 9.89 0 0 0 12.02 2a9.9 9.9 0 0 0-8.81 14.96L2 22l5.2-1.35A9.9 9.9 0 0 0 12.02 22a9.9 9.9 0 0 0 6.96-2.99A9.9 9.9 0 0 0 19.05 4.95ZM12.02 20.2a8.2 8.2 0 0 1-4.18-1.13l-.3-.18-3.08.8.82-3L5.1 16.8a8.2 8.2 0 1 1 13.46-6.8 8.17 8.17 0 0 1-6.54 10.2Zm4.54-6.2c-.25-.12-1.46-.72-1.69-.8-.23-.08-.4-.12-.57.12-.17.25-.65.8-.8 1-.15.17-.3.2-.55.07-.25-.12-1.05-.38-2-1.23-.74-.66-1.23-1.48-1.38-1.73-.15-.25-.02-.38.11-.5.11-.11.25-.3.38-.45.12-.15.17-.25.25-.42.08-.17.04-.32-.02-.45-.07-.12-.57-1.38-.79-1.89-.2-.48-.42-.42-.57-.42h-.49c-.17 0-.45.07-.68.32-.23.25-.88.86-.88 2.1 0 1.23.9 2.44.1 2.56.18.3.39.46.66.7.27.18.94.54 1.76 1.3.78.7 1.33 1.08 1.81 1.4.26.17.47.15.64.09.2-.06.65-.27.93-.52.28-.25.36-.46.46-.76.08-.3.08-.56-.03-.68-.1-.12-.23-.2-.45-.32Z'/></svg>
      </span>
    </a>
  ` : '';
  modal.innerHTML = `
    <div style="background:linear-gradient(120deg,#e3f2fd 60%,#fff 100%);border-radius:18px;box-shadow:0 6px 32px #90caf988,0 2px 8px #e3e3e3cc;padding:32px 18px 18px 18px;max-width:520px;min-width:340px;position:relative;max-height:90vh;overflow-y:auto;">
      <button id='close-invoice-modal' style='position:absolute;left:18px;top:18px;background:transparent;border:none;font-size:22px;color:#1976d2;cursor:pointer;z-index:10;' title='إغلاق'>&#10006;</button>
      <h2 style='margin-bottom:18px;color:#1976d2;text-align:center;font-weight:bold;font-size:1.3em;'>تفاصيل الفاتورة</h2>
      <div id="printable-invoice" style="text-align:center;padding:0 8px;">
        <div style='margin-bottom:10px;padding-bottom:8px;border-bottom:2px solid #1976d2;'>
          <img src="${logoUrl}" alt="شعار السنتر" style="display:block;margin:0 auto 8px auto;max-width:120px;max-height:120px;border-radius:8px;" />
          ${inv.isVip ? `<div class="vip-print-badge">VIP</div>` : ''}
          <div style='font-size:1.3rem;font-weight:bold;color:#1976d2;margin:8px 0 0;text-align:center;padding:7px 8px;background:#e3f2fd;border-radius:6px;'>رقم الفاتورة: ${(typeof inv.num !== 'undefined' && inv.num !== null) ? inv.num : '-'}</div>
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
          <div style='font-size:13px;color:#2e7d32;margin-bottom:4px;font-weight:bold;'>طريقة الدفع: <span id='invoice-payment-method-label'>${isInstallmentInvoice(inv) ? (inv.installment?.lastPaymentMethod || 'يتم اختيارها عند تسجيل الدفعة') : (inv.payment || 'نقدي')}</span></div>
          ${isInstallmentInvoice(inv) ? `<small>اختر طريقة الدفع لكل قسط عند تسجيله.</small>` : `<button id='invoice-payment-method-trigger' type='button' style='padding:7px 14px;border:0;border-radius:6px;background:#388e3c;color:#fff;font-weight:bold;cursor:pointer;'>تغيير طريقة الدفع</button>`}
        </div>
        ${inv.isVip ? `<div style='margin:0 0 12px;padding:8px;background:#eef7f0;border-radius:6px;color:#246b36;font-weight:bold;'>حالة الدفع: ${invoiceTypeLabel(inv)}</div>` : ''}
        
        <div style='margin-bottom:12px;'>
          <div style='font-weight:bold;color:#1976d2;margin-bottom:8px;text-align:right;padding-bottom:6px;border-bottom:2px solid #1565c0;'>📋 العناصر</div>
          <table style='width:100%;border-collapse:collapse;font-size:14px;'>
            ${invoiceDisplayItems.map((x, idx) => `
            <tr style='${idx % 2 === 0 ? "background:#f9f9f9;" : ""}'>
              <td style='padding:10px;text-align:right;border-bottom:1px solid #e0e0e0;'>${x.name}</td>
              ${inv.isCustomBookletSubscription ? '' : `<td style='padding:10px;text-align:left;border-bottom:1px solid #e0e0e0;color:#388e3c;font-weight:bold;'>${x.price} ج</td>`}
            </tr>
            `).join('')}
          </table>
        </div>
        ${notesDeliveryBoxes}
        ${indivNotesBoxes}
        ${indivCardsBoxes}
        
        <div style='margin:12px 0;padding:12px;background:#e8f5e9;border:2px solid #388e3c;border-radius:6px;text-align:center;'>
          <div style='font-size:12px;color:#2e7d32;margin-bottom:4px;'>الإجمالي</div>
          <div style='font-size:18px;font-weight:bold;color:#1b5e20;'>${invoiceTotal} ج</div>
        </div>
        ${inv.isVip && invoiceFinancialSummary(inv).paid > invoiceTotal ? `<div style='margin:0 0 12px;padding:10px;background:#eef7f0;border-radius:6px;color:#246b36;font-weight:bold;'>المبلغ المستلم: ${formatInvoiceMoney(invoiceFinancialSummary(inv).paid)} ج</div>` : ''}
        
        ${isInstallmentInvoice(inv) && inv.installment ? `
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
          ${!isPortalRegistration ? `<tr>
            <td style='padding:10px;text-align:right;font-weight:bold;color:#1976d2;border-bottom:1px solid #e0e0e0;'>ملاحظات:</td>
            <td style='padding:10px;text-align:left;border-bottom:1px solid #e0e0e0;'>${inv.notes || 'لا توجد'}</td>
          </tr>` : ''}
        </table>
        
        <div style='margin-top:10px;padding-top:8px;border-top:1px solid #d0d0d0;'>
          <div style='font-weight:bold;color:#1565c0;margin-bottom:4px;text-align:center;'>الفرع الرئيسي</div>
          <div class='center-address' style='font-size:12px;color:#555;margin-bottom:4px;text-align:center;overflow-wrap:anywhere;white-space:normal;'>${centerAddress ? centerAddress : '-'}</div>
          ${phoneHtml ? `<div style='text-align:center;margin:3px 0;font-size:11px;'>${phoneHtml}</div>` : ''}
        </div>
      </div>
      <div style='display:flex;gap:10px;justify-content:center;margin-bottom:8px;margin-top:18px;flex-wrap:wrap;'>
        <button id='print-invoice-btn' style='background:#388e3c;color:#fff;padding:10px 24px;border:none;border-radius:8px;cursor:pointer;font-size:15px;font-weight:bold;box-shadow:0 2px 8px #388e3c22;transition:all 0.3s;display:flex;align-items:center;gap:8px;'><i class='fa fa-print'></i> طباعة</button>
        <button id='download-invoice-btn' style='background:#2196f3;color:#fff;padding:10px 24px;border:none;border-radius:8px;cursor:pointer;font-size:15px;font-weight:bold;box-shadow:0 2px 8px #2196f322;transition:all 0.3s;display:flex;align-items:center;gap:8px;'><i class='fa fa-download'></i> حفظ صورة</button>
        ${isInstallmentInvoice(inv) && getInstallmentSummary(inv).remaining > 0 ? `<button id='confirm-payment-btn' style='background:#087f72;color:#fff;padding:10px 24px;border:none;border-radius:8px;cursor:pointer;font-size:15px;font-weight:bold;box-shadow:0 2px 8px #087f7222;transition:all 0.3s;display:flex;align-items:center;gap:8px;'><i class='fa fa-money-bill-wave'></i> تسجيل قسط</button>` : ''}
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

  const paymentMethodTrigger = document.getElementById('invoice-payment-method-trigger');
  if (paymentMethodTrigger) paymentMethodTrigger.onclick = async () => {
    const payment = await choosePaymentMethod(inv.payment || 'نقدي');
    if (!payment) return;
    try {
      const targetCollection = sourceCollection;
      const paymentData = isPortalRegistration
        ? { paymentMethod: payment, payment: payment }
        : { payment };
      await updateDoc(doc(db, targetCollection, id), paymentData);
      inv.payment = payment;
      document.getElementById('invoice-payment-method-label').textContent = payment;
      showNotification('تم حفظ طريقة الدفع', 'success');
    } catch (error) {
      showNotification('تعذر حفظ طريقة الدفع', 'error');
    }
  };

  // زر الطباعة
  document.getElementById('print-invoice-btn').onclick = async () => {
    const win = window.open('', '', 'width=400,height=600');
    if (!win) {
      showNotification('اسمح بفتح نافذة الطباعة من إعدادات المتصفح', 'error');
      return;
    }
    const printableInvoice = document.getElementById('printable-invoice').cloneNode(true);
    const logo = printableInvoice.querySelector('img');
    if (logo?.src) logo.src = await makePrintableImage(logo.src);
    const printableNotes = printableInvoice.querySelector('.indiv-notes-list');
    if (printableNotes) {
      const receivedNotes = [...printableNotes.querySelectorAll('.indiv-note-box')]
        .filter(note => note.querySelector('.indiv-note-delivered-checkbox')?.checked);
      printableNotes.querySelectorAll('.indiv-note-box').forEach(note => {
        if (!note.querySelector('.indiv-note-delivered-checkbox')?.checked) {
          note.remove();
          return;
        }
        note.querySelector('.indiv-note-delivered-checkbox')?.remove();
        const status = note.querySelector('.indiv-note-delivered-status');
        if (status) status.textContent = 'استلمها الطالب';
      });
      if (receivedNotes.length === 0) {
        const emptyStatus = document.createElement('div');
        emptyStatus.textContent = 'لم يستلم ملازم بعد';
        emptyStatus.style.cssText = 'margin:4px 0;font-weight:bold;text-align:right;';
        printableNotes.appendChild(emptyStatus);
      }
    }
    printableInvoice.querySelectorAll('.card-delivered-checkbox').forEach(checkbox => checkbox.remove());
    const printContents = printableInvoice.innerHTML;

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
    win.document.write(`
      <html dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>فاتورة</title>
      <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap" rel="stylesheet">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        @page { size: 80mm auto; margin: 0; }
        html, body { margin: 0; padding: 0; height: auto; display: flex; justify-content: center; align-items: center; }
        body { font-family: Tahoma, Arial, sans-serif; font-size: 10px; font-weight: 900; color: #000; background: #fff; width: 80mm; padding: 0; display: flex; justify-content: center; align-items: flex-start; }
        .print-container { width: 76mm; margin: 0 auto; background: white; padding: 1.5mm 1.5mm 1mm; box-shadow: none; }
        img { max-width: 80px; max-height: 80px; height: auto; display: block; margin: 0.8mm auto; opacity: 1; }
        h1 { font-size: 0; margin: 0; display: none; }
        hr { border: none; border-top: 1px solid #111; margin: 0.6mm 0; }
        table { width: 100%; border-collapse: collapse; margin: 0.8mm 0; font-size: 11px; line-height: 1.18; }
        td { padding: 0.8mm 0.9mm; border-bottom: 1px solid #222; line-height: 1.18; }
        td:first-child { text-align: right; font-weight: 900; width: 40%; }
        .invoice-num { font-size: 12.2px; font-weight: 900; color: #000; text-align: center; padding: 1.2mm; border: 1px solid #111; margin: 1mm 0; }
        .vip-print-badge { display: inline-block; margin: 1mm auto; padding: 1mm 4mm; border: 1px solid #f2c300; border-radius: 4px; background: repeating-linear-gradient(135deg, #fff4a3 0 2mm, #ffe16b 2mm 4mm); color: #d50000; font-size: 12px; font-weight: 900; }
        .total-box { background: #e8f5e9; border: 1px solid #1b5e20; padding: 1.5mm; margin: 1mm 0; text-align: center; font-weight: 900; font-size: 11.6px; color: #000; }
        .installment-box { background: #fff8e1; border: 1px solid #8d6e00; padding: 1.5mm; margin: 1mm 0; font-size: 10.8px; }
        .footer { margin-top: 0.9mm; padding-top: 0.8mm; border-top: 1px solid #222; text-align: center; font-size: 10.2px; line-height: 1.25; }
        .footer div { margin: 0.25mm 0; }
        @media print {
          html, body { margin: 0; padding: 0; width: 80mm; height: auto; display: block; align-items: flex-start; background: white; }
          body { min-height: 0; background: white; }
          .print-container { width: 72mm; margin: 0 auto; page-break-after: auto; box-shadow: none; background: white; padding: 1mm 1mm 0.6mm; line-height: 1.08 !important; }
          * { box-shadow: none !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print-container, .print-container * { font-family: Tahoma, Arial, sans-serif !important; color: #000 !important; font-weight: 900 !important; letter-spacing: 0 !important; }
          .print-container .vip-print-badge { color: #d50000 !important; background: repeating-linear-gradient(135deg, #fff4a3 0 2mm, #ffe16b 2mm 4mm) !important; border: 1px solid #f2c300 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .print-container img { display: block !important; max-width: 58px !important; max-height: 58px !important; width: 58px !important; height: 58px !important; object-fit: contain; opacity: 1 !important; background: #fff !important; border: 0 !important; box-shadow: none !important; filter: brightness(1.05) contrast(2.2) saturate(1.4) !important; image-rendering: auto; }
          .print-container table { margin: 0.8mm 0 !important; font-size: 11px !important; line-height: 1.2 !important; }
          .print-container td { padding: 0.8mm 0.9mm !important; line-height: 1.2 !important; }
          .print-container > div { margin-top: 0.5mm !important; margin-bottom: 0.5mm !important; padding-top: 0.5mm !important; padding-bottom: 0.5mm !important; }
          .print-container button { display: none !important; }
          .print-container input[type="checkbox"] { display: inline-block !important; appearance: none; -webkit-appearance: none; width: 3.5mm !important; height: 3.5mm !important; min-width: 3.5mm; margin: 0 1mm 0 0; vertical-align: middle; border: 0.4mm solid #000 !important; border-radius: 0 !important; background: #fff !important; position: relative; }
          .print-container input[type="checkbox"]:checked { background: #000 !important; }
          .print-container input[type="checkbox"]:checked::after { content: "✓"; position: absolute; inset: -0.7mm 0 0 0; color: #fff !important; font-size: 3mm; line-height: 3.8mm; text-align: center; font-weight: 900; }
          .print-container .indiv-notes-list, .print-container .indiv-cards-list { display: block !important; margin-top: 0.5mm !important; }
          .print-container .indiv-note-box, .print-container .indiv-card-box { padding: 0.6mm !important; margin: 0.4mm 0 !important; box-shadow: none !important; }
        }
      </style>
      </head><body><div class="print-container">${printContents}</div></body></html>
    `);
    win.document.close();
    const printWhenReady = async () => {
      if (win.document.fonts?.ready) await win.document.fonts.ready;
      await Promise.all(Array.from(win.document.images).map(image => image.complete
        ? Promise.resolve()
        : new Promise(resolve => { image.onload = resolve; image.onerror = resolve; })));
      win.print();
      win.close();
    };
    printWhenReady();
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
        setTimeout(() => showInvoiceModal(id, isPortalRegistration), 200);
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
        const cardId = cardInfo.cardId || cardInfo.id;
        const invoiceRef = doc(db, sourceCollection, id);
        const cardRef = cardId ? doc(db, 'onlineCards', cardId) : null;
        const deliveryInvoiceItems = isPortalRegistration
          ? ([inv.selectedSubscriptions, inv.subscriptions, inv.selectedItems].find(items => Array.isArray(items) && items.length) || [])
          : (inv.items || []);
        const matchedCount = deliveryInvoiceItems
          .filter(item => !cardInfo.linkedSubscriptionIds?.length || cardInfo.linkedSubscriptionIds.includes(item.id))
          .length;
        const amount = Math.max(1, Number(cardInfo.quantity) || matchedCount * (Number(cardInfo.perSub) || 1));
        cb.disabled = true;
        try {
          await runTransaction(db, async transaction => {
            const invoiceSnapshot = await transaction.get(invoiceRef);
            if (!invoiceSnapshot.exists()) throw new Error('الفاتورة غير موجودة');
            const invoiceData = invoiceSnapshot.data();
            const cards = Array.isArray(invoiceData.onlineCardsDelivery) ? [...invoiceData.onlineCardsDelivery] : [];
            const currentIndex = cards.findIndex(card => (card.cardId || card.id) === cardId);
            if (currentIndex < 0) throw new Error('الكارت غير موجود ضمن بيانات الفاتورة');
            const currentDelivered = cards[currentIndex].delivered === true || cards[currentIndex].isDelivered === true;
            if (currentDelivered === isDelivered) return;
            if (!cardRef) throw new Error('معرّف الكارت غير موجود');
            const cardSnapshot = await transaction.get(cardRef);
            if (!cardSnapshot.exists()) throw new Error('الكارت غير موجود في المخزون');

            cards[currentIndex] = { ...cards[currentIndex], delivered: isDelivered };
            delete cards[currentIndex].isDelivered;
            transaction.update(invoiceRef, { onlineCardsDelivery: cards });
            const currentStock = Number(cardSnapshot.data().stock) || 0;
            transaction.update(cardRef, { stock: currentStock + (isDelivered ? -amount : amount) });
          });

          showNotification(isDelivered ? 'تم تسليم الكرت وخصم المخزون' : 'تم إلغاء التسليم وإرجاع المخزون', 'success');
          setTimeout(() => showInvoiceModal(id, isPortalRegistration), 200);
        } catch (err) {
          console.error('Error updating card delivery:', err);
          cb.checked = !isDelivered;
          showNotification('حدث خطأ أثناء تحديث حالة الكرت', 'error');
        } finally {
          cb.disabled = false;
        }
      });
    });
  }

  // تفعيل تحديث حالة الاستلام لملازم indivNotes (الملازم المرتبطة بالفرقة)
  if (isNotesSubscription && allNotesList.length > 0) {
    modal.querySelectorAll('.indiv-note-delivered-checkbox').forEach(cb => {
      cb.disabled = false;
      cb.addEventListener('change', async function () {
        const idx = +cb.getAttribute('data-idx');
        const note = allNotesList[idx];
        if (!note) return;
        const delivered = cb.checked;
        cb.disabled = true;
        try {
          const invoiceRef = doc(db, sourceCollection, id);
          const noteRef = note.noteId ? doc(db, 'subscriptions', note.noteId) : null;
          if (!noteRef) throw new Error('Missing booklet inventory id.');
          const result = await runTransaction(db, async transaction => {
            const invoiceSnapshot = await transaction.get(invoiceRef);
            if (!invoiceSnapshot.exists()) throw new Error('Invoice not found.');
            const invoiceData = invoiceSnapshot.data();
            const adjustStockAtDelivery = invoiceData.bookletStockDeducted === false || invoiceData.vipStockDeducted === false;
            const noteSnapshot = adjustStockAtDelivery ? await transaction.get(noteRef) : null;
            if (adjustStockAtDelivery && !noteSnapshot.exists()) throw new Error('Booklet inventory record not found.');
            const notes = Array.isArray(invoiceData.indivNotes) ? [...invoiceData.indivNotes] : [];
            const noteIndex = notes.findIndex(saved => (saved.noteId || saved.name) === note.noteId || saved.name === note.name);
            const wasDelivered = noteIndex >= 0 && notes[noteIndex].delivered === true;
            if (wasDelivered === delivered) return { changed: false, stock: noteSnapshot ? Number(noteSnapshot.data().stock) || 0 : null };
            const updatedNote = { noteId: note.noteId, name: note.name, delivered };
            if (noteIndex < 0) notes.push(updatedNote); else notes[noteIndex] = { ...notes[noteIndex], ...updatedNote };
            const stock = noteSnapshot ? (Number(noteSnapshot.data().stock) || 0) + (delivered ? -1 : 1) : null;
            transaction.update(invoiceRef, { indivNotes: notes });
            if (adjustStockAtDelivery) transaction.update(noteRef, { stock });
            return { changed: true, stock };
          });
          note.delivered = delivered;
          if (!result.changed) return;
          if (delivered && result.stock < 0) showNotification('\u062a\u0645 \u062a\u0633\u0644\u064a\u0645 \u0627\u0644\u0645\u0644\u0632\u0645\u0629\u060c \u0648\u0623\u0635\u0628\u062d \u0627\u0644\u0645\u062e\u0632\u0648\u0646 \u0628\u0627\u0644\u0633\u0627\u0644\u0628 (' + result.stock + ').', 'info');
          else showNotification(delivered ? (result.stock === null ? '\u062a\u0645 \u062a\u0633\u0644\u064a\u0645 \u0627\u0644\u0645\u0644\u0632\u0645\u0629' : '\u062a\u0645 \u062a\u0633\u0644\u064a\u0645 \u0627\u0644\u0645\u0644\u0632\u0645\u0629 \u0648\u062e\u0635\u0645 \u0643\u0645\u064a\u062a\u0647\u0627 \u0645\u0646 \u0627\u0644\u0645\u062e\u0632\u0648\u0646') : (result.stock === null ? '\u062a\u0645 \u0625\u0644\u063a\u0627\u0621 \u062a\u0633\u0644\u064a\u0645 \u0627\u0644\u0645\u0644\u0632\u0645\u0629' : '\u062a\u0645 \u0625\u0644\u063a\u0627\u0621 \u0627\u0644\u062a\u0633\u0644\u064a\u0645 \u0648\u0625\u0631\u062c\u0627\u0639 \u0643\u0645\u064a\u0629 \u0627\u0644\u0645\u0644\u0632\u0645\u0629 \u0644\u0644\u0645\u062e\u0632\u0648\u0646'), 'success');
          setTimeout(() => showInvoiceModal(id, isPortalRegistration, isVipRegistration), 200);
        } catch (error) {
          cb.checked = !delivered;
          cb.closest('.indiv-note-box')?.querySelector('.indiv-note-delivered-status')?.replaceChildren(document.createTextNode(!delivered ? '\u062a\u0645 \u0627\u0644\u0627\u0633\u062a\u0644\u0627\u0645' : '\u0644\u0645 \u064a\u0633\u062a\u0644\u0645'));
          showNotification('\u062a\u0639\u0630\u0631 \u062a\u062d\u062f\u064a\u062b \u062d\u0627\u0644\u0629 \u0627\u0633\u062a\u0644\u0627\u0645 \u0627\u0644\u0645\u0644\u0632\u0645\u0629. \u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.', 'error');
          console.error('Could not update booklet delivery and stock:', error);
        } finally {
          cb.disabled = false;
        }
      });
    });
  }

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
      const newNotes = document.getElementById('edit-notes').value.trim() || '';

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
        { id: 'edit-notes', label: '📝 ملاحظات', value: inv.notes || '', icon: 'fa-sticky-note' }
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
    confirmPaymentBtn.onclick = () => showInstallmentPaymentDialog(inv, {
      invoiceId: id,
      collectionName: sourceCollection,
      linkedRegistrationId: inv.vipRegistrationId || '',
      receivedBy: currentRecipient,
      onSuccess: async result => {
        showNotification(`تم تسجيل ${result.paymentEntry.amount.toFixed(2)} ج بطريقة ${result.paymentEntry.method}`, 'success');
        await loadInvoices();
        setTimeout(() => showInvoiceModal(id, isPortalRegistration, isVipRegistration), 250);
      }
    });
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
const exportExcelBtn = document.getElementById('export-excel-btn');
if (exportExcelBtn) {
  exportExcelBtn.onclick = function () {
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
        'العناصر': (inv.items || []).map(x => inv.isCustomBookletSubscription ? x.name : x.name + " (" + x.price + " ج)").join('، '),
        'نوع الاشتراك': inv.subType,
        'الفرقة': inv.grade,
        'المبلغ المدفوع': invoiceFinancialSummary(inv).paid,
        'المتبقي': invoiceFinancialSummary(inv).remaining,
        'نوع الفاتورة': invoicePaymentLabel(inv),
        'انتظام/انتساب': inv.studyType,
        'التاريخ': inv.date,
        'الملاحظات': cleanGeneratedBookletNote(inv.notes) || '-'
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
}

document.querySelectorAll('[data-invoice-view]').forEach(button => {
  button.addEventListener('click', () => {
    invoiceViewMode = button.dataset.invoiceView === 'cards' ? 'cards' : 'table';
    localStorage.setItem('invoicesViewMode', invoiceViewMode);
    renderInvoicesTable();
  });
});

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
