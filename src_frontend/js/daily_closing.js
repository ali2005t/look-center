// Remove local imports and use Firebase CDN
// Firebase App (the core Firebase SDK) is always required and must be listed first
import { db } from "./firebase.js";
import { collection, getDocs, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, query, where, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
const auth = getAuth();
let dailyRealtimeStarted = false;
let dailyLoadRequestId = 0;

// Debug Firestore initialization and connection issues
console.log("Firestore DB instance:", db);

// التقفيل اليومي - ملف جافاسكربت مبدئي

// تأكد من تحميل القائمة الجانبية بشكل صحيح
console.log('Daily Closing Page Loaded');

// إضافة وظائف للقائمة الجانبية والهيدر

// تسجيل الخروج
document.addEventListener('DOMContentLoaded', function() {
  const logoutBtn = document.getElementById('logout-btn');
  const modal = document.getElementById('logout-modal');

  if (logoutBtn && modal) {
    logoutBtn.addEventListener('click', function(event) {
      event.preventDefault(); // Prevent default action
      modal.style.display = 'flex';
    });

    document.getElementById('temp-logout-btn').addEventListener('click', function() {
      modal.style.display = 'none';
      window.location.href = 'login.html';
    });

    document.getElementById('end-shift-btn').addEventListener('click', function() {
      modal.style.display = 'none';
      window.dispatchEvent(new CustomEvent('endShift'));
      window.location.href = 'login.html';
    });

    modal.addEventListener('click', function(event) {
      if (event.target === modal) {
        modal.style.display = 'none';
      }
    });
  }
});

// Ensure the element exists before setting its textContent
async function loadDailyClosingStats() {
    let totalSales = 0;
    const today = new Date();
    const todayStr = today.toLocaleDateString('ar-EG');

    const snapshot = await getDocs(collection(db, "sales"));
    snapshot.forEach(docSnap => {
        const sale = docSnap.data();
        let saleDate = sale.date;
        if (saleDate && typeof saleDate === 'object' && saleDate.toDate) {
            saleDate = saleDate.toDate();
        } else if (saleDate) {
            saleDate = new Date(saleDate);
        } else {
            return;
        }

        if (saleDate.toLocaleDateString('ar-EG') === todayStr) {
            totalSales += sale.amount || 0;
        }
    });

    const totalSalesElement = document.getElementById('total-sales');
    if (totalSalesElement) {
        totalSalesElement.textContent = totalSales + ' ج';
    } else {
        console.error("Element with ID 'total-sales' not found.");
    }
}

window.addEventListener('DOMContentLoaded', loadDailyClosingStats);

// Display current time and date
function updateTime() {
    const now = new Date();
    const timeElement = document.getElementById("time");
    const dateElement = document.getElementById("full-date");

    if (timeElement) {
        timeElement.textContent = now.toLocaleTimeString("ar-EG");
    }

    if (dateElement) {
        dateElement.textContent = now.toLocaleDateString("ar-EG", {
            weekday: "long", year: "numeric", month: "long", day: "numeric"
        });
    }
}

function normalizeUserAlias(value) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function localDateInputValue(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function toDailyDate(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function installmentPayments(invoice) {
  return Array.isArray(invoice?.installment?.payments) ? invoice.installment.payments : [];
}

function installmentPaidTotal(invoice) {
  const values = [invoice?.installment?.paid, invoice?.installment?.paidAmount, invoice?.paidAmount, invoice?.amountCollected];
  const value = values.find(item => item !== undefined && item !== null && item !== '' && Number.isFinite(Number(item)));
  return Number(value) || 0;
}

function installmentInitialPaid(invoice) {
  const loggedPaymentsTotal = installmentPayments(invoice).reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  return Math.max(0, installmentPaidTotal(invoice) - loggedPaymentsTotal);
}

function portalCollectedAmount(payment, registration) {
  const explicitlyCollectedAmounts = [
    payment?.amount,
    payment?.amountCollected,
    registration?.amountCollected,
    payment?.paidAmount,
    registration?.paidAmount
  ].map(Number).filter(Number.isFinite);
  const collectedAmount = explicitlyCollectedAmounts.find(amount => amount > 0);
  if (collectedAmount !== undefined) return collectedAmount;
  if (registration?.paymentStatus === 'paid') {
    const subscriptions = registration.selectedSubscriptions || registration.subscriptions || registration.selectedItems || [];
    const selectedAmount = Array.isArray(subscriptions)
      ? subscriptions.reduce((sum, item) => sum + (Number(item?.price) || 0), 0)
      : 0;
    const dueAmounts = [registration.requestedAmount, registration.subscriptionAmount, selectedAmount, registration.installment?.total]
      .map(Number).filter(amount => Number.isFinite(amount) && amount > 0);
    if (dueAmounts.length) return dueAmounts[0];
  }
  const installmentAmount = [payment?.installment?.paid, registration?.installment?.paid]
    .map(Number).find(amount => Number.isFinite(amount) && amount > 0);
  return installmentAmount ?? explicitlyCollectedAmounts[0] ?? 0;
}

function portalPaymentOwner(record, relatedRecord, userIdentity) {
  const owner = [record?.recordedBy, record?.paidBy, relatedRecord?.paidBy, record?.agentId, relatedRecord?.agentId]
    .find(value => String(value ?? '').trim() && String(value).trim() !== '-');
  return userIdentity.resolve(owner || 'غير محدد');
}

function createUserIdentityResolver(userDocs) {
  const userNames = new Map();
  const aliases = new Map();
  userDocs.forEach(userDoc => {
    const profile = userDoc.data();
    const email = String(profile.email || '').trim();
    const displayName = profile.username || profile.fullname || profile.name || email || userDoc.id;
    userNames.set(userDoc.id, displayName);
    const possibleAliases = [userDoc.id, profile.uid, profile.username, profile.fullname, profile.name, profile.email, email.split('@')[0]];
    possibleAliases.filter(Boolean).forEach(alias => {
      const key = normalizeUserAlias(alias);
      if (key && !aliases.has(key)) aliases.set(key, displayName);
    });
  });
  return {
    userNames,
    resolve(value) {
      const rawValue = String(value ?? '').trim();
      if (!rawValue || rawValue === '-') return 'غير محدد';
      return aliases.get(normalizeUserAlias(rawValue)) || userNames.get(rawValue) || rawValue;
    }
  };
}

function escapeDailyCell(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}
setInterval(updateTime, 1000);
updateTime();

// دالة تحديث ملخص اليوم
function updateDailySummary(sessions) {
  // التحقق من وجود العناصر
  const totalInvoicesEl = document.getElementById('total-invoices');
  const totalSalesEl = document.getElementById('total-sales-amount');
  const totalUsersEl = document.getElementById('total-users');
  
  if (!totalInvoicesEl || !totalSalesEl || !totalUsersEl) {
    console.warn("Summary elements not found in DOM");
    return;
  }
  
  if (!sessions || sessions.length === 0) {
    totalInvoicesEl.textContent = '0';
    totalSalesEl.textContent = '0 ج';
    totalUsersEl.textContent = '0';
    return;
  }

  let totalInvoices = 0;
  let totalSales = 0;
  const uniqueUsers = new Set();

  sessions.forEach(session => {
    // جمع عدد الفواتير من جميع الأنواع
    totalInvoices += (session.invoices_courses || 0) + (session.invoices_notes || 0) + 
                     (session.invoices_individual_notes || 0) + (session.invoices_individual_courses || 0);
    
    // جمع المبيعات (إذا كانت موجودة)
    totalSales += (session.totalSales || 0);
    
    // عد المستخدمين الفريدين
    if (session.username) {
      uniqueUsers.add(session.username);
    }
  });

  totalInvoicesEl.textContent = totalInvoices;
  totalSalesEl.textContent = totalSales + ' ج';
  totalUsersEl.textContent = uniqueUsers.size;
}

// دالة تحديث الملخص من بيانات الفواتير
function updateDailySummaryFromInvoices(invoicesByUser, invoicesSnapshot, displayedUserCount = null) {
  // التحقق من وجود العناصر
  const totalInvoicesEl = document.getElementById('total-invoices');
  const totalSalesEl = document.getElementById('total-sales-amount');
  const totalUsersEl = document.getElementById('total-users');
  
  if (!totalInvoicesEl || !totalSalesEl || !totalUsersEl) {
    console.warn("Summary elements not found in DOM");
    return;
  }
  
  if (!invoicesByUser || Object.keys(invoicesByUser).length === 0) {
    totalInvoicesEl.textContent = '0';
    totalSalesEl.textContent = '0 ج';
    totalUsersEl.textContent = Number.isFinite(displayedUserCount) ? displayedUserCount : '0';
    return;
  }

  let totalInvoices = 0;
  let totalSales = 0;
  let totalUsers = 0;

  // جمع البيانات من invoicesByUser (التي تحتوي على البيانات المفلترة)
  Object.keys(invoicesByUser).forEach(username => {
    const userInvoices = invoicesByUser[username];
    totalInvoices += userInvoices.invoiceCount || 0;
    totalSales += userInvoices.totalAmount || 0;
  });

  totalUsers = Number.isFinite(displayedUserCount) ? displayedUserCount : Object.keys(invoicesByUser).length;

  totalInvoicesEl.textContent = totalInvoices;
  totalSalesEl.textContent = totalSales.toFixed(2) + ' ج';
  totalUsersEl.textContent = totalUsers;
}


// Fetch and display data in the table
async function loadDailyClosingData(dateFrom = null, dateTo = dateFrom) {
  const requestId = ++dailyLoadRequestId;
  const isLatestRequest = () => requestId === dailyLoadRequestId;
  const tableBody = document.querySelector("#daily-closing-table tbody");
  tableBody.innerHTML = ""; // Clear existing rows

  try {
    console.log("Fetching data from Firestore...");
    
    // تحديد التاريخ المراد التصفية عليه
    const todayValue = localDateInputValue();
    const startValue = dateFrom || dateTo || todayValue;
    const endValue = dateTo || dateFrom || startValue;
    const rangeStart = new Date(startValue + "T00:00:00");
    const rangeEnd = new Date(endValue + "T23:59:59.999");
    const todayStart = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate(), 0, 0, 0);
    const todayEnd = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate(), 23, 59, 59, 999);
    if (Number.isNaN(todayStart.getTime()) || Number.isNaN(todayEnd.getTime()) || todayStart > todayEnd) {
      throw new Error('تأكد من صحة فترة التصفية: تاريخ البداية يجب أن يسبق تاريخ النهاية.');
    }
    
    console.log("Date range:", todayStart, "to", todayEnd);
    
    // جلب الفواتير لليوم المحدد
    const [invoicesSnapshot, portalPaymentsSnapshot, portalRegistrationsSnapshot, vipRegistrationsSnapshot, usersSnapshot] = await Promise.all([
      getDocs(collection(db, "invoices")),
      getDocs(collection(db, "studentPortalPayments")),
      getDocs(collection(db, "studentRegistrations")),
      getDocs(collection(db, "vipRegistrations")),
      getDocs(collection(db, "users"))
    ]);
    if (!isLatestRequest()) return;
    const userIdentity = createUserIdentityResolver(usersSnapshot.docs);
    const portalRegistrations = new Map(portalRegistrationsSnapshot.docs.map(registrationDoc => [registrationDoc.id, registrationDoc.data()]));
    const invoicesByUser = {};

    const countPortalSubscriptionTypes = (summary, registration) => {
      const types = new Set((registration?.selectedSubscriptions || [])
        .map(item => item.type)
        .filter(type => type === 'كورسات' || type === 'ملازم'));
      types.forEach(type => { summary[type] = (summary[type] || 0) + 1; });
    };
    invoicesSnapshot.forEach(docSnap => {
      const invoice = docSnap.data();
      if (invoice.isVip === true) return;
      let invDate = invoice.date;
      if (invDate && typeof invDate.toDate === "function") {
        invDate = invDate.toDate();
      } else if (invDate) {
        invDate = new Date(invDate);
      } else {
        return;
      }
      
      // تصفية حسب التاريخ
      if (invDate >= todayStart && invDate <= todayEnd) {
        // الحصول على اسم المستخدم (المستلم)
        const username = userIdentity.resolve(invoice.recipient || "غير محدد");
        
        if (!invoicesByUser[username]) {
          invoicesByUser[username] = {
            'كورسات': 0,
            'ملازم': 0,
            'محاضرات فردية': 0,
            'ملازم فردية': 0,
            invoiceCount: 0,
            totalAmount: 0
          };
        }
        
        // عد الفواتير حسب النوع
        const countedTypes = invoice.subType ? [invoice.subType] : [];
        countedTypes.forEach(type => {
          invoicesByUser[username][type] = (invoicesByUser[username][type] || 0) + 1;
        });
        invoicesByUser[username].invoiceCount++;
        
        // في فاتورة التقسيط نحسب المقدم فقط؛ كل قسط لاحق يتحسب بتاريخ تحصيله.
        if (!invoice.isVodafone) {
          if (invoice.payment === 'تقسيط' || installmentPayments(invoice).length) {
            invoicesByUser[username].totalAmount += installmentInitialPaid(invoice);
          } else if (Array.isArray(invoice.items)) {
            invoice.items.forEach(item => {
              invoicesByUser[username].totalAmount += parseFloat(item.price) || 0;
            });
          }
        }
      }
    });

    // ضم دفعات الأقساط التي تم تحصيلها في التاريخ المحدد.
    invoicesSnapshot.forEach(docSnap => {
      const invoice = docSnap.data();
      installmentPayments(invoice).forEach(payment => {
        const paymentDate = toDailyDate(payment.paidAt || payment.date);
        if (!paymentDate || paymentDate < todayStart || paymentDate > todayEnd) return;
        if ((payment.method || payment.paymentMethod || payment.payment) === 'فودافون كاش') return;
        const username = userIdentity.resolve(payment.receivedBy || invoice.recipient || 'غير محدد');
        if (!invoicesByUser[username]) {
          invoicesByUser[username] = {
            'كورسات': 0, 'ملازم': 0, 'محاضرات فردية': 0, 'ملازم فردية': 0,
            invoiceCount: 0, totalAmount: 0
          };
        }
        invoicesByUser[username].totalAmount += Number(payment.amount) || 0;
      });
    });

    const linkedVipRegistrationIds = new Set(invoicesSnapshot.docs.map(invoiceDoc => invoiceDoc.data().vipRegistrationId).filter(Boolean));
    vipRegistrationsSnapshot.forEach(registrationDoc => {
      const registration = registrationDoc.data();
      if (linkedVipRegistrationIds.has(registrationDoc.id)
        || invoicesSnapshot.docs.some(invoiceDoc => invoiceDoc.id === registration.invoiceId)) return;
      installmentPayments(registration).forEach(payment => {
        const paymentDate = toDailyDate(payment.paidAt || payment.date);
        if (!paymentDate || paymentDate < todayStart || paymentDate > todayEnd) return;
        if ((payment.method || payment.paymentMethod || payment.payment) === 'فودافون كاش') return;
        const username = userIdentity.resolve(payment.receivedBy || registration.teacherName || registration.paidBy || 'غير محدد');
        if (!invoicesByUser[username]) {
          invoicesByUser[username] = {
            'كورسات': 0, 'ملازم': 0, 'محاضرات فردية': 0, 'ملازم فردية': 0,
            invoiceCount: 0, totalAmount: 0
          };
        }
        invoicesByUser[username].totalAmount += Number(payment.amount) || 0;
      });
    });

    const recordedPortalRegistrations = new Set();

    // ضم مدفوعات تسجيلات QR إلى التقفيل اليومي.
    const orderedPortalPaymentDocs = [...portalPaymentsSnapshot.docs].sort((left, right) => {
      const leftData = left.data();
      const rightData = right.data();
      return Number(right.id === rightData.registrationId) - Number(left.id === leftData.registrationId);
    });
    orderedPortalPaymentDocs.forEach(paymentDoc => {
      const payment = paymentDoc.data();
      if (payment.registrationId && !portalRegistrations.has(payment.registrationId)) return;
      if (payment.registrationId && recordedPortalRegistrations.has(payment.registrationId)) return;
      const registration = portalRegistrations.get(payment.registrationId) || {};
      let paymentDate = payment.paidAt;
      if (paymentDate?.toDate) paymentDate = paymentDate.toDate();
      else if (paymentDate) paymentDate = new Date(paymentDate);
      if (!paymentDate) paymentDate = registration.registeredAt;
      if (paymentDate?.toDate) paymentDate = paymentDate.toDate();
      else if (paymentDate) paymentDate = new Date(paymentDate);
      if (!paymentDate || Number.isNaN(paymentDate.getTime()) || paymentDate < todayStart || paymentDate > todayEnd) return;

      const username = portalPaymentOwner(payment, registration, userIdentity);
      if (payment.registrationId) recordedPortalRegistrations.add(payment.registrationId);
      if (!invoicesByUser[username]) {
        invoicesByUser[username] = {
          'كورسات': 0, 'ملازم': 0, 'محاضرات فردية': 0, 'ملازم فردية': 0,
          invoiceCount: 0, totalAmount: 0
        };
      }
      countPortalSubscriptionTypes(invoicesByUser[username], registration);
      invoicesByUser[username].invoiceCount++;
      if (payment.registrationId) recordedPortalRegistrations.add(payment.registrationId);
      if ((payment.paymentMethod || payment.payment) !== 'فودافون كاش') {
        invoicesByUser[username].totalAmount += portalCollectedAmount(payment, portalRegistrations.get(payment.registrationId));
      }
    });

    // دعم السجلات التي تغيرت حالتها إلى مدفوع قبل إنشاء سجل الدفع المنفصل.
    portalRegistrationsSnapshot.forEach(registrationDoc => {
      if (recordedPortalRegistrations.has(registrationDoc.id)) return;
      const registration = registrationDoc.data();
      if (registration.paymentStatus !== 'paid') return;
      let paidDate = registration.paidAt || registration.registeredAt;
      if (paidDate?.toDate) paidDate = paidDate.toDate();
      else if (paidDate) paidDate = new Date(paidDate);
      if (!paidDate || Number.isNaN(paidDate.getTime()) || paidDate < todayStart || paidDate > todayEnd) return;

      const username = portalPaymentOwner(registration, null, userIdentity);
      if (!invoicesByUser[username]) {
        invoicesByUser[username] = {
          'كورسات': 0, 'ملازم': 0, 'محاضرات فردية': 0, 'ملازم فردية': 0,
          invoiceCount: 0, totalAmount: 0
        };
      }
      countPortalSubscriptionTypes(invoicesByUser[username], registration);
      invoicesByUser[username].invoiceCount++;
      if ((registration.paymentMethod || registration.payment) !== 'فودافون كاش') {
        invoicesByUser[username].totalAmount += portalCollectedAmount(null, registration);
      }
    });
    
    console.log("Invoices by user:", invoicesByUser);
    
    // جلب جلسات المستخدمين لليوم المحدد
    const snapshot = await getDocs(collection(db, "user_sessions"));
    if (!isLatestRequest()) return;
    const sessions = snapshot.docs.map(doc => {
      const data = doc.data();
      data._id = doc.id;
      return data;
    });

    // إذا لم تكن هناك جلسة دخول، اعرض المسؤول الذي استلم دفعة بوابة الطلاب.
    portalPaymentsSnapshot.forEach(paymentDoc => {
      const payment = paymentDoc.data();
      if (payment.registrationId && !portalRegistrations.has(payment.registrationId)) return;
      let paymentDate = payment.paidAt;
      if (paymentDate?.toDate) paymentDate = paymentDate.toDate();
      else if (paymentDate) paymentDate = new Date(paymentDate);
      if (paymentDate && paymentDate >= todayStart && paymentDate <= todayEnd) {
        const registration = portalRegistrations.get(payment.registrationId) || {};
        sessions.push({ username: portalPaymentOwner(payment, registration, userIdentity), loginTime: paymentDate, logoutTime: null });
      }
    });

    console.log("Fetched user_sessions data:", sessions);

    // تصفية الجلسات للتاريخ المحدد
    const sessionsForDate = sessions.filter(session => {
      if (!session.loginTime) return false;
      const loginTime = session.loginTime.toDate ? session.loginTime.toDate() : new Date(session.loginTime);
      return loginTime >= todayStart && loginTime <= todayEnd;
    });

    const reportableUsers = usersSnapshot.docs.filter(userDoc => {
      const profile = userDoc.data();
      const permissions = Array.isArray(profile.permissions) ? profile.permissions : [];
      const isCashierOrManager = profile.type === 'كاشير' || profile.type === 'مدير';
      return profile.active !== false && (isCashierOrManager || permissions.includes('cashier') || Boolean(profile.studentPortalCode));
    });

    console.log("Sessions for date:", sessionsForDate);

    if (sessionsForDate.length === 0 && Object.keys(invoicesByUser).length === 0 && reportableUsers.length === 0) {
      const emptyRow = document.createElement("tr");
      emptyRow.innerHTML = `<td colspan="8" style="text-align: center; color: #888;">لا توجد بيانات لعرضها</td>`;
      tableBody.appendChild(emptyRow);
      updateDailySummaryFromInvoices(invoicesByUser, invoicesSnapshot);
      return;
    }

    // إنشاء خريطة فريدة للمستخدمين - كل مستخدم يظهر مرة واحدة فقط
    const uniqueUsersMap = {};

    // إظهار كل مستخدمي الكاشير ومستخدمي QR النشطين حتى لو لم يسجلوا دخولًا في الفترة.
    reportableUsers.forEach(userDoc => {
      const username = userIdentity.resolve(userDoc.id);
      if (!uniqueUsersMap[username]) {
        uniqueUsersMap[username] = { firstLoginTime: null, lastLogoutTime: null, allSessions: [] };
      }
    });
    
    // المرة الأولى: احصل على أول جلسة تسجيل دخول لكل مستخدم
    sessionsForDate.forEach(session => {
      const username = userIdentity.resolve(session.username);
      
      if (!uniqueUsersMap[username]) {
        uniqueUsersMap[username] = {
          firstLoginTime: session.loginTime,
          lastLogoutTime: session.logoutTime || null,
          allSessions: [session]
        };
      } else {
        // جمع كل الجلسات للمستخدم
        uniqueUsersMap[username].allSessions.push(session);
        
        // تحديث آخر وقت خروج إذا وجدنا واحداً
        if (session.logoutTime && !uniqueUsersMap[username].lastLogoutTime) {
          uniqueUsersMap[username].lastLogoutTime = session.logoutTime;
        }
      }
    });

    // أظهر صاحب أي فاتورة حتى لو لم تُسجل له جلسة دخول في هذا اليوم.
    Object.keys(invoicesByUser).forEach(username => {
      if (!uniqueUsersMap[username]) {
        uniqueUsersMap[username] = { firstLoginTime: null, lastLogoutTime: null, allSessions: [] };
      }
    });

    console.log("Unique users count:", Object.keys(uniqueUsersMap).length);
    console.log("User names:", Object.keys(uniqueUsersMap));

    // تحويل الخريطة إلى مصفوفة وترتيبها
    const displayUsers = Object.entries(uniqueUsersMap).map(([username, data]) => ({
      username,
      loginTime: data.firstLoginTime,
      logoutTime: data.lastLogoutTime
    })).sort((a, b) => {
      const aTime = a.loginTime ? (a.loginTime.toDate ? a.loginTime.toDate().getTime() : new Date(a.loginTime).getTime()) : 0;
      const bTime = b.loginTime ? (b.loginTime.toDate ? b.loginTime.toDate().getTime() : new Date(b.loginTime).getTime()) : 0;
      return bTime - aTime;
    });

    console.log("Display users:", displayUsers.length, displayUsers);

    // عرض كل مستخدم مرة واحدة فقط في الجدول
    displayUsers.forEach(user => {
      const loginTime = user.loginTime ? (user.loginTime.toDate ? user.loginTime.toDate() : new Date(user.loginTime)) : null;
      let logoutTimeStr = "--";
      
      if (user.logoutTime) {
        if (typeof user.logoutTime.toDate === "function") {
          const logoutTime = user.logoutTime.toDate();
          logoutTimeStr = logoutTime.toLocaleTimeString("ar-EG");
        } else if (typeof user.logoutTime === "string") {
          try {
            const logoutTime = new Date(user.logoutTime);
            logoutTimeStr = !isNaN(logoutTime.getTime()) ? logoutTime.toLocaleTimeString("ar-EG") : "--";
          } catch {
            logoutTimeStr = "--";
          }
        }
      }

      // جلب بيانات الفواتير لهذا المستخدم
      const userInvoices = invoicesByUser[user.username] || {
        'كورسات': 0,
        'ملازم': 0,
        'محاضرات فردية': 0,
        'ملازم فردية': 0,
        invoiceCount: 0,
        totalAmount: 0
      };

      const row = document.createElement("tr");
      row.innerHTML = `
        <td><a href="#" class="user-name-link" data-username="${escapeDailyCell(user.username || '--')}" data-date-from="${startValue}" data-date-to="${endValue}" style="color: #1976d2; text-decoration: none; cursor: pointer; font-weight: 500; border-bottom: 1px dashed #1976d2;">${escapeDailyCell(user.username || "--")}</a></td>
        <td>${loginTime ? loginTime.toLocaleTimeString("ar-EG") : "--"}</td>
        <td>${logoutTimeStr}</td>
        <td>${userInvoices['كورسات'] || 0}</td>
        <td>${userInvoices['ملازم'] || 0}</td>
        <td>${userInvoices['ملازم فردية'] || 0}</td>
        <td>${userInvoices['محاضرات فردية'] || 0}</td>
        <td style="font-weight: bold; background-color: #e8f5e9;">${userInvoices.totalAmount.toFixed(2)} ج</td>
      `;
      tableBody.appendChild(row);
    });
    
    console.log("Table rows added successfully");
    
    // تحديث ملخص اليوم مع البيانات الصحيحة
    updateDailySummaryFromInvoices(invoicesByUser, invoicesSnapshot, displayUsers.length);
    
    // تحديث جدول فودافون كاش
    loadVodafoneInvoices(startValue, endValue);
    
  } catch (error) {
    if (!isLatestRequest()) return;
    console.error("Error loading daily closing data:", error);
    const errorRow = document.createElement("tr");
    errorRow.innerHTML = `<td colspan="8" style="text-align: center; color: red;">حدث خطأ أثناء تحميل البيانات</td>`;
    tableBody.appendChild(errorRow);
    updateDailySummary([]);
  }
}

// Filter data by date
const filterBtn = document.getElementById("filter-btn");
if (filterBtn) {
  filterBtn.addEventListener("click", () => {
    const from = document.getElementById("filter-date-from").value;
    const to = document.getElementById("filter-date-to").value;
    if (from && to && from > to) {
      alert('تاريخ البداية يجب أن يكون قبل تاريخ النهاية أو مساويًا له.');
      return;
    }
    loadDailyClosingData(from || to || null, to || from || null);
  });
}

// تعيين التاريخ الحالي في حقل التصفية
window.addEventListener("DOMContentLoaded", () => {
  const fromInput = document.getElementById("filter-date-from");
  const toInput = document.getElementById("filter-date-to");
  if (fromInput && toInput) {
    const today = localDateInputValue();
    fromInput.value = today;
    toInput.value = today;
  }
  // تحميل بيانات اليوم الحالي تلقائياً
  loadDailyClosingData(fromInput?.value || null, toInput?.value || fromInput?.value || null);

  if (!dailyRealtimeStarted) {
    dailyRealtimeStarted = true;
    const refreshToday = () => loadDailyClosingData(document.getElementById('filter-date-from')?.value || null, document.getElementById('filter-date-to')?.value || null);
    onSnapshot(collection(db, 'studentPortalPayments'), refreshToday);
    onSnapshot(collection(db, 'studentRegistrations'), refreshToday);
    onSnapshot(collection(db, 'vipRegistrations'), refreshToday);
    onSnapshot(collection(db, 'invoices'), refreshToday);
  }
  
  // تحميل فواتير فودافون كاش بعد تحميل البيانات الرئيسية
  setTimeout(() => {
    loadVodafoneInvoices();
  }, 500);
});

// Ensure DOM elements are initialized before calling summary functions
window.addEventListener("DOMContentLoaded", () => {
  const totalInvoicesEl = document.getElementById('total-invoices');
  const totalSalesEl = document.getElementById('total-sales-amount');
  const totalUsersEl = document.getElementById('total-users');

  if (!totalInvoicesEl || !totalSalesEl || !totalUsersEl) {
    console.error("Summary elements not found in DOM during initialization.");
    return;
  }
});

// Export data to CSV with proper UTF-8 encoding
const exportBtn = document.getElementById("export-btn");
if (exportBtn) {
  exportBtn.addEventListener("click", () => {
    const rows = Array.from(document.querySelectorAll("#daily-closing-table tr"));
    
    // استخدم BOM (Byte Order Mark) للحفاظ على العربية
    const BOM = "\uFEFF";
    const csvContent = BOM + rows.map(row => {
        return Array.from(row.children).map(cell => {
          // استبدل الفواصل والعلامات في النص
          const text = cell.textContent.trim().replace(/"/g, '""');
          // أحط النص بعلامات اقتباس
          return `"${text}"`;
        }).join(",");  // استخدم الفاصلة بدل التاب
    }).join("\n");

    // أنشئ Blob بترميز صحيح
    const encoder = new TextEncoder();
    const encodedData = encoder.encode(csvContent);
    const blob = new Blob([encodedData], { type: "text/csv;charset=utf-8" });
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    
    // اسم الملف بالعربية
    const now = new Date();
    const dateStr = now.toLocaleDateString('ar-EG');
    a.download = `تقفيل_يومي_${dateStr}.csv`;
    
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

// تصدير ملخص اليوم
const exportSummaryBtn = document.getElementById("export-summary-btn");
if (exportSummaryBtn) {
  exportSummaryBtn.addEventListener("click", () => {
    const rows = [
      ["التاريخ", "إجمالي الفواتير", "إجمالي المبيعات", "عدد المستخدمين"],
      [
        new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }),
        document.getElementById('total-invoices').textContent,
        document.getElementById('total-sales-amount').textContent,
        document.getElementById('total-users').textContent
      ]
    ];

    // استخدم BOM (Byte Order Mark) للحفاظ على العربية
    const BOM = "\uFEFF";
    const csvContent = BOM + rows.map(row => {
      return row.map(cell => {
        const text = cell.trim().replace(/"/g, '""');
        return `"${text}"`;
      }).join(","); // استخدم الفاصلة بدل التاب
    }).join("\n");

    // أنشئ Blob بترميز صحيح
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ملخص_التقفيل_${new Date().toLocaleDateString('ar-EG').replace(/\//g, "-")}.csv`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    alert('✅ تم تصدير ملخص التقفيل بنجاح');
  });
}

// Refresh table data after ending the shift
const endShiftBtn = document.getElementById("end-shift-btn");
if (endShiftBtn) {
  endShiftBtn.addEventListener("click", async function() {
    try {
      const user = auth.currentUser;

      if (user) {
        const sessionRef = collection(db, "user_sessions");
        const querySnapshot = await getDocs(sessionRef);

        let sessionDoc = null;
        querySnapshot.forEach(doc => {
          const data = doc.data();
          if (data.username === user.email && !data.logoutTime) {
            sessionDoc = doc;
          }
        });

        if (sessionDoc) {
          const docRef = sessionDoc.ref;
          await docRef.update({
            logoutTime: serverTimestamp()
          });
          console.log("Logout time recorded successfully.");
        } else {
          console.warn("No active session found for the user.");
        }

        const shiftData = {
          username: user.email || "Unknown User",
          startTime: localStorage.getItem("shiftStartTime") || "Unknown",
          endTime: new Date().toISOString(),
          invoices: JSON.parse(localStorage.getItem("invoicesSummary")) || {},
          timestamp: serverTimestamp()
        };

        await addDoc(collection(db, "shifts"), shiftData);
        showNotification("تم تسجيل الشيفت بنجاح!", "success");

        // Refresh table data
        loadDailyClosingData();
      }
    } catch (error) {
      console.error("Error recording shift data:", error);
      showNotification("حدث خطأ أثناء تسجيل الشيفت!", "error");
    } finally {
      // Redirect to login page after recording
      window.location.href = "login.html";
    }
  });
}

// تسجيل الدخول مرة واحدة فقط وعدم التكرار باستخدام localStorage
async function recordLoginTimeOnce() {
  const user = auth.currentUser;
  if (!user) return;
  try {
    // تحقق من وجود sessionId في localStorage
    const sessionKey = `activeSessionId_${user.email}`;
    let sessionId = localStorage.getItem(sessionKey);
    if (sessionId) {
      // تحقق من أن الجلسة مازالت نشطة في قاعدة البيانات
      const sessionDoc = await getDocs(query(collection(db, "user_sessions"), where("username", "==", user.email), where("logoutTime", "==", null)));
      if (!sessionDoc.empty) {
        // الجلسة مازالت نشطة
        return;
      } else {
        // الجلسة انتهت، احذف sessionId من localStorage
        localStorage.removeItem(sessionKey);
      }
    }
    // لا يوجد جلسة نشطة، أنشئ واحدة جديدة
    const username = user.displayName || user.email.split('@')[0] || "Unknown User";
    const docRef = await addDoc(collection(db, "user_sessions"), {
      username: username,
      loginTime: serverTimestamp(),
      logoutTime: null,
    });
    // احفظ معرف الجلسة في localStorage
    localStorage.setItem(sessionKey, docRef.id);
  } catch (error) {
    console.error("Error recording login time:", error);
  }
}

// تسجيل وقت الخروج عند إنهاء الشيفت أو تسجيل الخروج
async function recordLogoutTimeOnce() {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const sessionKey = `activeSessionId_${user.email}`;
    const sessionId = localStorage.getItem(sessionKey);
    if (sessionId) {
      const docRef_ = doc(db, "user_sessions", sessionId);
      await updateDoc(docRef_, { logoutTime: serverTimestamp() });
      localStorage.removeItem(sessionKey);
    } else {
      // fallback: ابحث عن جلسة نشطة
      const sessionDoc = await getDocs(query(collection(db, "user_sessions"), where("username", "==", user.email), where("logoutTime", "==", null)));
      if (!sessionDoc.empty) {
        const docRef_ = doc(db, "user_sessions", sessionDoc.docs[0].id);
        await updateDoc(docRef_, { logoutTime: serverTimestamp() });
      }
    }
  } catch (error) {
    console.error("Error recording logout time:", error);
  }
}

// استدعاء تسجيل الدخول مرة واحدة فقط بعد التأكد من وجود المستخدم
window.addEventListener("DOMContentLoaded", () => {
  const unsubscribe = onAuthStateChanged(auth, (user) => {
    if (user) {
      recordLoginTimeOnce();
      unsubscribe();
    }
  });
});

// عند إنهاء الشيفت أو تسجيل الخروج يتم تسجيل وقت الخروج
window.addEventListener('endShift', recordLogoutTimeOnce);

// تسجيل وقت الخروج عند تسجيل الخروج
const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    try {
      await recordLogoutTimeOnce(); // تسجيل وقت الخروج
      console.log("Logout time recorded successfully.");
    } catch (error) {
      console.error("Error recording logout time on logout:", error);
    }
  });
}

// معالجات الأزرار الجديدة
document.addEventListener('DOMContentLoaded', () => {
  // زر حفظ التقفيل اليومي
  const saveClosingBtn = document.getElementById('save-closing-btn');
  if (saveClosingBtn) {
    saveClosingBtn.addEventListener('click', async () => {
      try {
        const today = new Date().toLocaleDateString('ar-EG');
        const totalInvoices = document.getElementById('total-invoices').textContent;
        const totalSales = document.getElementById('total-sales-amount').textContent;
        
        await addDoc(collection(db, 'daily_closing_reports'), {
          date: today,
          totalInvoices: parseInt(totalInvoices) || 0,
          totalSales: parseFloat(totalSales) || 0,
          totalUsers: document.getElementById('total-users').textContent,
          createdAt: serverTimestamp()
        });
        
        alert('تم حفظ التقفيل اليومي بنجاح');
      } catch (error) {
        console.error('Error saving closing:', error);
        alert('حدث خطأ أثناء الحفظ');
      }
    });
  }

  // زر طباعة التقرير
  const printReportBtn = document.getElementById('print-report-btn');
  if (printReportBtn) {
    printReportBtn.addEventListener('click', () => {
      const dateFrom = document.getElementById('filter-date-from')?.value || localDateInputValue();
      const dateTo = document.getElementById('filter-date-to')?.value || dateFrom;
      const title = document.title;
      const formatDate = value => new Date(value + 'T00:00:00').toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const periodText = dateFrom === dateTo ? formatDate(dateFrom) : `${formatDate(dateFrom)} – ${formatDate(dateTo)}`;
      document.getElementById('daily-print-date').textContent = periodText;
      document.getElementById('daily-print-generated').textContent = new Date().toLocaleString('ar-EG');
      document.title = 'التقفيل اليومي - ' + periodText;
      window.print();
      window.setTimeout(() => { document.title = title; }, 800);
    });
  }

  // زر إرسال التقرير (إرسال بريد إلكتروني)
  const sendReportBtn = document.getElementById('send-report-btn');
  if (sendReportBtn) {
    sendReportBtn.addEventListener('click', async () => {
      try {
        const totalInvoices = document.getElementById('total-invoices').textContent;
        const totalSales = document.getElementById('total-sales-amount').textContent;
        const totalUsers = document.getElementById('total-users').textContent;
        
        const reportText = `
تقرير التقفيل اليومي
${new Date().toLocaleDateString('ar-EG')}

إجمالي الفواتير: ${totalInvoices}
إجمالي المبيعات: ${totalSales}
عدد المستخدمين: ${totalUsers}
        `;
        
        // يمكن إضافة وظيفة إرسال بريد من خلال Firebase Functions
        console.log('Report to send:', reportText);
        alert('تم تحضير التقرير للإرسال');
      } catch (error) {
        console.error('Error preparing report:', error);
        alert('حدث خطأ في إعداد التقرير');
      }
    });
  }
});

async function updateLogoutTimeInTable() {
  const user = auth.currentUser;
  if (!user) return;

  try {
    const sessionDoc = await getDocs(query(collection(db, "user_sessions"), where("username", "==", user.email), where("logoutTime", "!=", null)));
    if (!sessionDoc.empty) {
      const session = sessionDoc.docs[0].data();
      const logoutTime = session.logoutTime.toDate ? session.logoutTime.toDate() : new Date(session.logoutTime);
      const logoutTimeStr = logoutTime.toLocaleTimeString("ar-EG");

      // تحديث الصف الخاص بالمستخدم في الجدول
      const rows = document.querySelectorAll("#daily-closing-table tr");
      rows.forEach(row => {
        const usernameCell = row.querySelector("td:first-child");
        if (usernameCell && usernameCell.textContent === user.email) {
          const logoutTimeCell = row.querySelector("td:nth-child(3)");
          if (logoutTimeCell) {
            logoutTimeCell.textContent = logoutTimeStr;
          }
        }
      });
    }
  } catch (error) {
    console.error("Error updating logout time in table:", error);
  }
}

// استدعاء الدالة لتحديث وقت الخروج في الجدول بعد تسجيله
await updateLogoutTimeInTable();

// ================================
// عرض فواتير المستخدم عند النقر عليه
// ================================
async function showUserInvoices(username, dateFrom, dateTo = dateFrom) {
  try {
    // جلب فواتير المستخدم خلال فترة التقرير المحددة
    const startDate = new Date(dateFrom + "T00:00:00");
    const endDate = new Date((dateTo || dateFrom) + "T23:59:59.999");
    const todayStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0, 0, 0);
    const todayEnd = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59, 999);
    
    const [invoicesSnapshot, portalPaymentsSnapshot, portalRegistrationsSnapshot, vipRegistrationsSnapshot, usersSnapshot] = await Promise.all([
      getDocs(collection(db, "invoices")),
      getDocs(collection(db, "studentPortalPayments")),
      getDocs(collection(db, "studentRegistrations")),
      getDocs(collection(db, "vipRegistrations")),
      getDocs(collection(db, "users"))
    ]);
    const userIdentity = createUserIdentityResolver(usersSnapshot.docs);
    const userInvoices = [];
    
    invoicesSnapshot.forEach(docSnap => {
      const invoice = docSnap.data();
      if (invoice.isVip === true) return;
      let invDate = invoice.date;
      
      if (invDate && typeof invDate.toDate === "function") {
        invDate = invDate.toDate();
      } else if (invDate) {
        invDate = new Date(invDate);
      } else {
        return;
      }
      
      // تصفية حسب التاريخ والمستخدم
      if (userIdentity.resolve(invoice.recipient) === userIdentity.resolve(username) && invDate >= todayStart && invDate <= todayEnd) {
        const isInstallmentInvoice = invoice.payment === 'تقسيط' || installmentPayments(invoice).length > 0;
        userInvoices.push({
          ...invoice,
          id: docSnap.id,
          date: invDate,
          items: isInstallmentInvoice
            ? [{ name: 'المقدم عند تسجيل التقسيط', price: installmentInitialPaid(invoice) }]
            : (invoice.items || [])
        });
      }
    });

    // عرض كل دفعة تقسيط كسجل قبض مستقل في تفاصيل التقفيل بتاريخ استلامها.
    invoicesSnapshot.forEach(docSnap => {
      const invoice = docSnap.data();
      if (userIdentity.resolve(invoice.recipient) !== userIdentity.resolve(username)) return;
      installmentPayments(invoice).forEach((payment, paymentIndex) => {
        const paymentDate = toDailyDate(payment.paidAt || payment.date);
        if (!paymentDate || paymentDate < todayStart || paymentDate > todayEnd) return;
        const method = payment.method || payment.paymentMethod || payment.payment || 'نقدي';
        userInvoices.push({
          id: `${docSnap.id}-installment-${paymentIndex}`,
          num: invoice.num || '-',
          student: invoice.student || '-',
          subType: invoice.subType || 'قسط تقسيط',
          items: [{ name: `تحصيل قسط · ${method}`, price: Number(payment.amount) || 0 }],
          payment: method,
          date: paymentDate,
          isVodafone: method === 'فودافون كاش',
          sourceLabel: 'دفعة على فاتورة ' + (invoice.num || docSnap.id)
        });
      });
    });

    const linkedVipRegistrationIds = new Set(invoicesSnapshot.docs.map(invoiceDoc => invoiceDoc.data().vipRegistrationId).filter(Boolean));
    vipRegistrationsSnapshot.forEach(registrationDoc => {
      const registration = registrationDoc.data();
      if (linkedVipRegistrationIds.has(registrationDoc.id)
        || invoicesSnapshot.docs.some(invoiceDoc => invoiceDoc.id === registration.invoiceId)) return;
      installmentPayments(registration).forEach((payment, paymentIndex) => {
        const paymentDate = toDailyDate(payment.paidAt || payment.date);
        if (!paymentDate || paymentDate < todayStart || paymentDate > todayEnd) return;
        const paymentOwner = payment.receivedBy || registration.teacherName || registration.paidBy || 'غير محدد';
        if (userIdentity.resolve(paymentOwner) !== userIdentity.resolve(username)) return;
        const method = payment.method || payment.paymentMethod || payment.payment || 'نقدي';
        userInvoices.push({
          id: `${registrationDoc.id}-installment-${paymentIndex}`,
          num: registration.invoiceNumber || `VIP-${registrationDoc.id.slice(-6)}`,
          student: registration.studentName || registration.student || '-',
          subType: (registration.selectedSubscriptions || []).map(item => item.type).filter(Boolean).join(' + ') || 'قسط تقسيط',
          items: [{ name: `تحصيل قسط · ${method}`, price: Number(payment.amount) || 0 }],
          payment: method,
          date: paymentDate,
          isVodafone: method === 'فودافون كاش',
          sourceLabel: 'دفعة على اشتراك VIP'
        });
      });
    });

    const portalRegistrations = new Map(portalRegistrationsSnapshot.docs.map(registrationDoc => [registrationDoc.id, registrationDoc.data()]));
    const recordedPortalRegistrations = new Set();

    // عرض مدفوعات بوابة الطلاب داخل تفاصيل فواتير المستخدم.
    const orderedPortalPaymentDocs = [...portalPaymentsSnapshot.docs].sort((left, right) => {
      const leftData = left.data();
      const rightData = right.data();
      return Number(right.id === rightData.registrationId) - Number(left.id === leftData.registrationId);
    });
    orderedPortalPaymentDocs.forEach(paymentDoc => {
      const payment = paymentDoc.data();
      const registration = portalRegistrations.get(payment.registrationId) || {};
      let paymentDate = payment.paidAt;
      if (paymentDate?.toDate) paymentDate = paymentDate.toDate();
      else if (paymentDate) paymentDate = new Date(paymentDate);
      if (!paymentDate) paymentDate = registration.registeredAt;
      if (paymentDate?.toDate) paymentDate = paymentDate.toDate();
      else if (paymentDate) paymentDate = new Date(paymentDate);
      if (!paymentDate || Number.isNaN(paymentDate.getTime()) || paymentDate < todayStart || paymentDate > todayEnd) return;
      if (payment.registrationId && recordedPortalRegistrations.has(payment.registrationId)) return;

      const paymentUsername = portalPaymentOwner(payment, registration, userIdentity);
      if (paymentUsername !== userIdentity.resolve(username)) return;
      const selectedSubscriptions = registration.selectedSubscriptions || [];
      if (payment.registrationId) recordedPortalRegistrations.add(payment.registrationId);
      userInvoices.push({
        id: paymentDoc.id,
        num: payment.invoiceNumber || registration.invoiceNumber || `WEB-${paymentDoc.id.slice(0, 6)}`,
        student: payment.studentName || registration.studentName || '-',
        subType: selectedSubscriptions.map(item => item.type).filter(Boolean).join(' + ') || 'بيع من الموقع',
        items: [{ name: selectedSubscriptions.map(item => item.name).filter(Boolean).join('، ') || 'بيع من الموقع', price: portalCollectedAmount(payment, registration) }],
        payment: payment.paymentMethod || payment.payment || 'نقدي',
        date: paymentDate,
        isPortalPayment: true,
        sourceLabel: 'من الموقع'
      });
    });

    // دعم المدفوعات القديمة المحفوظة داخل التسجيل فقط.
    portalRegistrationsSnapshot.forEach(registrationDoc => {
      const registration = registrationDoc.data();
      if (recordedPortalRegistrations.has(registrationDoc.id) || registration.paymentStatus !== 'paid') return;
      let paidDate = registration.paidAt || registration.registeredAt;
      if (paidDate?.toDate) paidDate = paidDate.toDate();
      else if (paidDate) paidDate = new Date(paidDate);
      if (!paidDate || Number.isNaN(paidDate.getTime()) || paidDate < todayStart || paidDate > todayEnd) return;
      const registrationUsername = portalPaymentOwner(registration, null, userIdentity);
      if (registrationUsername !== userIdentity.resolve(username)) return;
      userInvoices.push({
        id: registrationDoc.id,
        num: registration.invoiceNumber || `WEB-${registrationDoc.id.slice(0, 6)}`,
        student: registration.studentName || '-',
        subType: (registration.selectedSubscriptions || []).map(item => item.type).filter(Boolean).join(' + ') || 'بيع من الموقع',
        items: [{ name: (registration.selectedSubscriptions || []).map(item => item.name).filter(Boolean).join('، ') || 'بيع من الموقع', price: portalCollectedAmount(null, registration) }],
        payment: registration.paymentMethod || registration.payment || 'نقدي',
        date: paidDate,
        isPortalPayment: true,
        sourceLabel: 'من الموقع'
      });
    });
    
    // ترتيب الفواتير حسب التاريخ (الأحدث أولاً)
    userInvoices.sort((a, b) => b.date - a.date);
    
    // إنشاء نافذة عرض الفواتير
    const modal = document.createElement('div');
    modal.className = 'user-invoices-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.3s ease;
    `;
    
    let invoicesHtml = `
      <div style="background: #fff; border-radius: 12px; max-width: 90%; max-height: 90vh; overflow: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.2); padding: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 2px solid #1976d2; padding-bottom: 12px;">
          <h2 style="color: #1976d2; margin: 0; font-size: 1.5em;">فواتير ${username}</h2>
          <button onclick="this.closest('.user-invoices-modal').remove()" style="background: #e53935; color: #fff; border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer; font-size: 14px; font-weight: bold;">إغلاق</button>
        </div>
        
        <div style="display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap;">
          <button onclick="window.printUserInvoices('${username}', '${dateFrom}', '${dateTo || dateFrom}')" style="background: #388e3c; color: #fff; border: none; border-radius: 6px; padding: 10px 20px; cursor: pointer; font-weight: bold; display: flex; align-items: center; gap: 8px;">
            <i class="fas fa-print"></i> طباعة الفواتير
          </button>
          <button onclick="window.exportUserInvoices('${username}', '${dateFrom}')" style="background: #1976d2; color: #fff; border: none; border-radius: 6px; padding: 10px 20px; cursor: pointer; font-weight: bold; display: flex; align-items: center; gap: 8px;">
            <i class="fas fa-download"></i> تصدير CSV
          </button>
        </div>
        
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="background: #f5f5f5; border-bottom: 2px solid #ddd;">
              <th style="padding: 10px; text-align: right; color: #1976d2; font-weight: bold;">رقم الفاتورة</th>
              <th style="padding: 10px; text-align: right; color: #1976d2; font-weight: bold;">الطالب</th>
              <th style="padding: 10px; text-align: right; color: #1976d2; font-weight: bold;">النوع</th>
              <th style="padding: 10px; text-align: right; color: #1976d2; font-weight: bold;">المبلغ</th>
              <th style="padding: 10px; text-align: right; color: #1976d2; font-weight: bold;">الحالة</th>
              <th style="padding: 10px; text-align: right; color: #1976d2; font-weight: bold;">الوقت</th>
            </tr>
          </thead>
          <tbody>
    `;
    
    if (userInvoices.length === 0) {
      invoicesHtml += `
        <tr><td colspan="6" style="padding: 20px; text-align: center; color: #999;">لا توجد فواتير لهذا المستخدم في هذا التاريخ</td></tr>
      `;
    } else {
      userInvoices.forEach(inv => {
        const total = inv.items?.reduce((sum, item) => sum + (parseFloat(item.price) || 0), 0) || 0;
        const time = inv.date.toLocaleTimeString('ar-EG');
        const isVodafone = inv.isVodafone ? '📱 ' : '';
        const vodafoneStyle = inv.isVodafone ? 'background-color: #ffebee; border-left: 4px solid #d32f2f;' : '';
        
        invoicesHtml += `
          <tr style="border-bottom: 1px solid #eee; ${vodafoneStyle}">
            <td style="padding: 10px; text-align: right;">${isVodafone}${inv.num || '-'}</td>
            <td style="padding: 10px; text-align: right;">${inv.student || '-'}</td>
            <td style="padding: 10px; text-align: right;">
              <span style="background: ${inv.isVodafone ? '#ffcdd2' : '#e3f2fd'}; color: ${inv.isVodafone ? '#c62828' : '#1976d2'}; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${inv.subType || '-'}</span>
              ${inv.sourceLabel ? `<small style="display:block;margin-top:4px;color:#64748b;">${escapeDailyCell(inv.sourceLabel)}</small>` : ''}
            </td>
            <td style="padding: 10px; text-align: right; color: ${inv.isVodafone ? '#c62828' : '#388e3c'}; font-weight: bold;">${inv.isVodafone ? '(لا تُحسب)' : total.toFixed(2) + ' ج'}</td>
            <td style="padding: 10px; text-align: right;">
              <span style="background: ${inv.payment === 'مدفوع كامل' ? '#c8e6c9' : '#fff9c4'}; color: ${inv.payment === 'مدفوع كامل' ? '#2e7d32' : '#f57f17'}; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${inv.payment || '-'}</span>
            </td>
            <td style="padding: 10px; text-align: right; font-size: 12px;">${time}</td>
          </tr>
        `;
      });
    }
    
    invoicesHtml += `
          </tbody>
        </table>
      </div>
    `;
    
    modal.innerHTML = invoicesHtml;
    document.body.appendChild(modal);
    
    // إغلاق عند النقر خارج النافذة
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
    
    // حفظ البيانات عالمياً لاستخدامها في الطباعة
    window.lastUserInvoices = userInvoices;
    
  } catch (error) {
    console.error("Error showing user invoices:", error);
    alert("حدث خطأ أثناء تحميل الفواتير");
  }
}

// دالة طباعة فواتير المستخدم
window.printUserInvoices = function(username, dateFrom, dateTo = dateFrom) {
  if (!window.lastUserInvoices || window.lastUserInvoices.length === 0) {
    alert("لا توجد فواتير لطباعتها");
    return;
  }
  
  let printContent = `
    <html dir="rtl">
    <head>
      <meta charset="UTF-8">
      <title>فواتير ${username}</title>
      <style>
        body { font-family: Arial; margin: 20px; }
        h1 { text-align: center; color: #1976d2; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 10px; text-align: right; }
        th { background: #1976d2; color: #fff; }
        tr:nth-child(even) { background: #f9f9f9; }
      </style>
    </head>
    <body>
      <h1>فواتير ${username}</h1>
      <p style="text-align: center;">الفترة: ${dateFrom} - ${dateTo || dateFrom}</p>
      <table>
        <thead>
          <tr>
            <th>رقم الفاتورة</th>
            <th>الطالب</th>
            <th>النوع</th>
            <th>المبلغ</th>
            <th>الحالة</th>
            <th>الوقت</th>
          </tr>
        </thead>
        <tbody>
  `;
  
  window.lastUserInvoices.forEach(inv => {
    const total = inv.items?.reduce((sum, item) => sum + (parseFloat(item.price) || 0), 0) || 0;
    const time = inv.date.toLocaleTimeString('ar-EG');
    
    printContent += `
      <tr>
        <td>${inv.num || '-'}</td>
        <td>${inv.student || '-'}</td>
        <td>${[inv.subType || '-', inv.sourceLabel].filter(Boolean).join(' - ')}</td>
        <td>${total.toFixed(2)} ج</td>
        <td>${inv.payment || '-'}</td>
        <td>${time}</td>
      </tr>
    `;
  });
  
  printContent += `
        </tbody>
      </table>
    </body>
    </html>
  `;
  
  const printWindow = window.open('', '_blank');
  printWindow.document.write(printContent);
  printWindow.document.close();
  setTimeout(() => printWindow.print(), 500);
};

// إضافة مستمع للنقر على صفوف الجدول
document.addEventListener('DOMContentLoaded', () => {
  // ربط النقر على أسماء المستخدمين
  document.addEventListener('click', (e) => {
    if (e.target.classList && e.target.classList.contains('user-name-link')) {
      e.preventDefault();
      const username = e.target.dataset.username;
      showUserInvoices(username, e.target.dataset.dateFrom, e.target.dataset.dateTo);
    }
  });
});

// دالة تحميل فواتير فودافون كاش
async function loadVodafoneInvoices(dateFrom = null, dateTo = dateFrom) {
  try {
    const fromValue = dateFrom || document.getElementById('filter-date-from')?.value || localDateInputValue();
    const toValue = dateTo || document.getElementById('filter-date-to')?.value || fromValue;
    const fromDate = new Date(fromValue + "T00:00:00");
    const toDate = new Date(toValue + "T23:59:59.999");
    const todayStart = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate(), 0, 0, 0);
    const todayEnd = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 23, 59, 59, 999);
    if (Number.isNaN(todayStart.getTime()) || Number.isNaN(todayEnd.getTime()) || todayStart > todayEnd) return;
    
    // جلب فواتير الكاشير ومدفوعات بوابة الطلاب المسددة بفودافون كاش.
    const [invoicesSnapshot, portalPaymentsSnapshot, portalRegistrationsSnapshot, vipRegistrationsSnapshot, usersSnapshot] = await Promise.all([
      getDocs(collection(db, 'invoices')),
      getDocs(collection(db, 'studentPortalPayments')),
      getDocs(collection(db, 'studentRegistrations')),
      getDocs(collection(db, 'vipRegistrations')),
      getDocs(collection(db, 'users'))
    ]);
    const portalRegistrations = new Map(portalRegistrationsSnapshot.docs.map(item => [item.id, item.data()]));
    const userNames = new Map(usersSnapshot.docs.map(item => {
      const user = item.data();
      return [item.id, user.username || user.fullname || user.email || item.id];
    }));
    const vodafoneInvoices = [];
    
    invoicesSnapshot.forEach(doc => {
      const data = doc.data();
      
      // تصفية فواتير فودافون كاش فقط
      if (!data.isVodafone) return;
      
      let invoiceDate = data.date;
      if (invoiceDate && typeof invoiceDate === 'object' && invoiceDate.toDate) {
        invoiceDate = invoiceDate.toDate();
      } else if (invoiceDate) {
        invoiceDate = new Date(invoiceDate);
      }
      
      // فلترة حسب تاريخ اليوم
      if (invoiceDate && invoiceDate >= todayStart && invoiceDate <= todayEnd) {
        vodafoneInvoices.push({
          id: doc.id,
          ...data,
          date: invoiceDate
        });
      }
    });

    // إظهار الأقساط المحصلة بفودافون كاش كسجلات مستقلة بتاريخ القبض.
    invoicesSnapshot.forEach(doc => {
      const data = doc.data();
      installmentPayments(data).forEach((payment, paymentIndex) => {
        if ((payment.method || payment.paymentMethod || payment.payment) !== 'فودافون كاش') return;
        const paymentDate = toDailyDate(payment.paidAt || payment.date);
        if (!paymentDate || paymentDate < todayStart || paymentDate > todayEnd) return;
        vodafoneInvoices.push({
          id: `${doc.id}-installment-${paymentIndex}`,
          num: data.num || '-',
          student: data.student || '-',
          subType: data.subType || 'قسط تقسيط',
          items: [{ name: 'دفعة قسط تقسيط', price: Number(payment.amount) || 0 }],
          recipient: payment.receivedBy || data.recipient || '-',
          date: paymentDate,
          isVodafone: true,
          payment: 'فودافون كاش'
        });
      });
    });

    const linkedVipRegistrationIds = new Set(invoicesSnapshot.docs.map(invoiceDoc => invoiceDoc.data().vipRegistrationId).filter(Boolean));
    vipRegistrationsSnapshot.forEach(registrationDoc => {
      const registration = registrationDoc.data();
      if (linkedVipRegistrationIds.has(registrationDoc.id)
        || invoicesSnapshot.docs.some(invoiceDoc => invoiceDoc.id === registration.invoiceId)) return;
      installmentPayments(registration).forEach((payment, paymentIndex) => {
        if ((payment.method || payment.paymentMethod || payment.payment) !== 'فودافون كاش') return;
        const paymentDate = toDailyDate(payment.paidAt || payment.date);
        if (!paymentDate || paymentDate < todayStart || paymentDate > todayEnd) return;
        vodafoneInvoices.push({
          id: `${registrationDoc.id}-installment-${paymentIndex}`,
          num: registration.invoiceNumber || `VIP-${registrationDoc.id.slice(-6)}`,
          student: registration.studentName || registration.student || '-',
          subType: (registration.selectedSubscriptions || []).map(item => item.type).filter(Boolean).join(' + ') || 'قسط تقسيط',
          items: [{ name: 'دفعة قسط تقسيط', price: Number(payment.amount) || 0 }],
          recipient: payment.receivedBy || registration.teacherName || registration.paidBy || '-',
          date: paymentDate,
          isVodafone: true,
          payment: 'فودافون كاش'
        });
      });
    });

    const seenPortalRegistrations = new Set();
    const orderedPortalPaymentDocs = [...portalPaymentsSnapshot.docs].sort((left, right) => {
      const leftData = left.data();
      const rightData = right.data();
      return Number(right.id === rightData.registrationId) - Number(left.id === leftData.registrationId);
    });
    orderedPortalPaymentDocs.forEach(paymentDoc => {
      const payment = paymentDoc.data();
      if ((payment.paymentMethod || payment.payment) !== 'فودافون كاش') return;
      const registrationId = payment.registrationId;
      if (!registrationId || seenPortalRegistrations.has(registrationId)) return;
      const registration = portalRegistrations.get(registrationId);
      if (!registration) return;
      seenPortalRegistrations.add(registrationId);
      let paymentDate = payment.paidAt;
      if (paymentDate?.toDate) paymentDate = paymentDate.toDate();
      else if (paymentDate) paymentDate = new Date(paymentDate);
      if (!paymentDate || paymentDate < todayStart || paymentDate > todayEnd) return;
      const subscriptions = registration.selectedSubscriptions || [];
      vodafoneInvoices.push({
        id: paymentDoc.id,
        num: payment.invoiceNumber || registration.invoiceNumber || `WEB-${registrationId.slice(0, 6)}`,
        student: payment.studentName || registration.studentName || '-',
        subType: [...new Set(subscriptions.map(item => item.type).filter(Boolean))].join(' + ') || 'اشتراك من بوابة الطلاب',
         items: [{ name: 'تحصيل بوابة الطلاب', price: portalCollectedAmount(payment, registration) }],
        recipient: userNames.get(payment.agentId) || payment.agentId || '-',
        date: paymentDate,
        isVodafone: true,
        payment: payment.paymentMethod || payment.payment
      });
    });

    portalRegistrationsSnapshot.docs.forEach(registrationDoc => {
      const registration = registrationDoc.data();
      if (seenPortalRegistrations.has(registrationDoc.id)
        || registration.paymentStatus !== 'paid'
        || (registration.paymentMethod || registration.payment) !== 'فودافون كاش') return;
      let paymentDate = registration.paidAt || registration.registeredAt;
      if (paymentDate?.toDate) paymentDate = paymentDate.toDate();
      else if (paymentDate) paymentDate = new Date(paymentDate);
      if (!paymentDate || Number.isNaN(paymentDate.getTime()) || paymentDate < todayStart || paymentDate > todayEnd) return;
      seenPortalRegistrations.add(registrationDoc.id);
      const subscriptions = registration.selectedSubscriptions || [];
      vodafoneInvoices.push({
        id: registrationDoc.id,
        num: registration.invoiceNumber || `WEB-${registrationDoc.id.slice(0, 6)}`,
        student: registration.studentName || '-',
        subType: [...new Set(subscriptions.map(item => item.type).filter(Boolean))].join(' + ') || 'اشتراك من بوابة الطلاب',
         items: [{ name: 'تحصيل بوابة الطلاب', price: portalCollectedAmount(null, registration) }],
        recipient: userNames.get(registration.agentId) || registration.agentId || '-',
        date: paymentDate,
        isVodafone: true,
        payment: registration.paymentMethod || registration.payment
      });
    });
    
    // عرض القسم إذا كان هناك فواتير
    const vodafoneSection = document.getElementById('vodafone-section');
    const vodafoneBody = document.getElementById('vodafone-invoices-body');
    
    if (vodafoneInvoices.length > 0) {
      vodafoneSection.style.display = 'block';
      vodafoneBody.innerHTML = '';
      
      vodafoneInvoices.forEach((invoice, idx) => {
        const time = invoice.date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
        const subTypeName = invoice.subType || '-';
        
        const row = document.createElement('tr');
        const bgColor = idx % 2 === 0 ? '#ffebee' : '#ffcdd2';
        row.style.backgroundColor = bgColor;
        row.innerHTML = `
          <td style="padding: 16px; text-align: center; border: 2px solid #d32f2f; font-weight: bold; color: #c62828; font-size: 18px;">
            <span style="background: linear-gradient(135deg, #d32f2f 0%, #b71c1c 100%); color: white; padding: 10px 14px; border-radius: 8px; display: inline-block; box-shadow: 0 2px 6px rgba(211, 47, 47, 0.3);">
              <img src="img/Vodafone-Cash-Logo.png" alt="Vodafone" style="height: 28px; vertical-align: middle; margin-left: 8px;">
              ${invoice.num || '-'}
            </span>
          </td>
          <td style="padding: 16px; text-align: center; border: 2px solid #d32f2f;">
            <span style="background: linear-gradient(135deg, #ffcdd2 0%, #ef9a9a 100%); color: #b71c1c; padding: 10px 16px; border-radius: 8px; display: inline-block; font-weight: 600; border: 1px solid #d32f2f; font-size: 15px;">
              ${subTypeName}
            </span>
          </td>
          <td style="padding: 16px; text-align: center; border: 2px solid #d32f2f; color: #c62828; font-size: 16px; font-weight: 600;">${time}</td>
          <td style="padding: 16px; text-align: center; border: 2px solid #d32f2f; color: #b71c1c; font-weight: 600; font-size: 15px;">${invoice.recipient || '-'}</td>
          <td style="padding: 16px; text-align: center; border: 2px solid #d32f2f;">
            <span style="background: linear-gradient(135deg, #d32f2f 0%, #c62828 100%); color: white; padding: 10px 16px; border-radius: 8px; font-weight: bold; font-size: 15px; display: inline-block; box-shadow: 0 2px 6px rgba(211, 47, 47, 0.3);">
              ✓ مكتملة
            </span>
          </td>
        `;
        vodafoneBody.appendChild(row);
      });
      
      // إضافة صف الملخص مع إجمالي التكلفة
      const summaryRow = document.createElement('tr');
      summaryRow.style.backgroundColor = '#d32f2f';
      
      // حساب إجمالي التكلفة لكل المستخدمين
      let totalCostForAllUsers = 0;
      vodafoneInvoices.forEach(invoice => {
        if (invoice.items && Array.isArray(invoice.items)) {
          invoice.items.forEach(item => {
            totalCostForAllUsers += parseFloat(item.price) || 0;
          });
        }
      });
      
      summaryRow.innerHTML = `
        <td colspan="5" style="padding: 20px; text-align: center; border: 3px solid #b71c1c; font-weight: bold; color: white; font-size: 16px; background: linear-gradient(135deg, #d32f2f 0%, #c62828 100%); box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);">
          <img src="img/Vodafone-Cash-Logo.png" alt="Vodafone" style="height: 35px; vertical-align: middle; margin-left: 10px; display: inline-block;">
          <span style="font-size: 20px; font-weight: 900;">فودافون كاش</span> 
          <br>
          <span style="display: inline-block; margin-top: 8px;">إجمالي الفواتير: <span style="color: #ffeb3b; font-size: 22px; font-weight: 900;">${vodafoneInvoices.length}</span> | إجمالي التكلفة: <span style="color: #ffeb3b; font-size: 22px; font-weight: 900;">${totalCostForAllUsers.toFixed(2)}</span> ج</span>
        </td>
      `;
      vodafoneBody.appendChild(summaryRow);
      
    } else {
      vodafoneSection.style.display = 'block';
      vodafoneBody.innerHTML = `
        <tr>
          <td colspan="5" style="padding: 24px; text-align: center; color: #9b1c1c; font-weight: 700; background: #fff5f5;">
            لا توجد فواتير فودافون كاش في هذا التاريخ
          </td>
        </tr>
      `;
    }
    
    // ربط أزرار فودافون كاش
    const vodafonePrintBtn = document.getElementById('vodafone-print-btn');
    
    if (vodafonePrintBtn) {
      vodafonePrintBtn.onclick = () => printVodafoneInvoices(vodafoneInvoices, fromValue, toValue);
    }
    
  } catch (error) {
    console.error("Error loading vodafone invoices:", error);
  }
}

// دالة طباعة فواتير فودافون كاش
function printVodafoneInvoices(invoices, dateFrom = null, dateTo = dateFrom) {
  if (!invoices || invoices.length === 0) {
    alert("لا توجد فواتير فودافون كاش لطباعتها");
    return;
  }
  
  const from = dateFrom || localDateInputValue();
  const to = dateTo || from;
  const formatDate = value => new Date(value + "T00:00:00").toLocaleDateString('ar-EG');
  const periodLabel = from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
  
  // حساب إجمالي التكلفة
  let totalCost = 0;
  invoices.forEach(invoice => {
    if (invoice.items && Array.isArray(invoice.items)) {
      invoice.items.forEach(item => {
        totalCost += parseFloat(item.price) || 0;
      });
    }
  });
  
  let printContent = `
    <html dir="rtl">
    <head>
      <meta charset="UTF-8">
      <title>فواتير فودافون كاش</title>
      <style>
        body { font-family: Arial; margin: 20px; background: #fff; }
        .header { text-align: center; margin-bottom: 20px; }
        .logo { height: 60px; margin-bottom: 10px; }
        h1 { color: #d32f2f; margin: 10px 0; font-size: 24px; }
        .date { color: #666; font-size: 14px; margin-bottom: 5px; }
        .summary { color: #d32f2f; font-weight: bold; font-size: 16px; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th { background: linear-gradient(135deg, #d32f2f 0%, #c62828 100%); color: white; padding: 14px; text-align: center; border: 2px solid #b71c1c; font-weight: bold; }
        td { border: 2px solid #d32f2f; padding: 12px; text-align: center; }
        tr:nth-child(even) { background: #ffebee; }
        tr:nth-child(odd) { background: #ffcdd2; }
        .total-row { background: linear-gradient(135deg, #d32f2f 0%, #c62828 100%) !important; color: white; font-weight: bold; padding: 16px !important; font-size: 14px; }
        .highlight { color: #d32f2f; font-weight: 900; font-size: 16px; }
      </style>
    </head>
    <body>
      <div class="header">
        <img src="img/Vodafone-Cash-Logo.png" alt="Vodafone" class="logo">
        <h1>🔴 فواتير فودافون كاش</h1>
        <div class="date">الفترة: ${periodLabel}</div>
        <div class="summary">إجمالي الفواتير: <span class="highlight">${invoices.length}</span> | إجمالي التكلفة: <span class="highlight">${totalCost.toFixed(2)}</span> ج</div>
      </div>
      <table>
        <thead>
          <tr>
            <th>رقم الفاتورة</th>
            <th>نوع الفاتورة</th>
            <th>الساعة</th>
            <th>المستلم</th>
            <th>الطالب</th>
            <th>المبلغ</th>
          </tr>
        </thead>
        <tbody>
  `;
  
  invoices.forEach(invoice => {
    const time = invoice.date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    const subTypeName = invoice.subType || '-';
    const invoiceTotal = invoice.items?.reduce((sum, item) => sum + (parseFloat(item.price) || 0), 0) || 0;
    
    printContent += `
      <tr>
        <td><strong>${invoice.num || '-'}</strong></td>
        <td>${subTypeName}</td>
        <td>${time}</td>
        <td>${invoice.recipient || '-'}</td>
        <td>${invoice.student || '-'}</td>
        <td><strong>${invoiceTotal.toFixed(2)} ج</strong></td>
      </tr>
    `;
  });
  
  printContent += `
        </tbody>
      </table>
      <table style="margin-top: 20px; border: none;">
        <tr class="total-row">
          <td style="border: none; text-align: center; width: 100%; padding: 20px;">
            ✓ إجمالي فواتير فودافون كاش: <span style="font-size: 18px; font-weight: 900;">${invoices.length}</span> فاتورة | الإجمالي: <span style="font-size: 18px; font-weight: 900;">${totalCost.toFixed(2)}</span> ج
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
  
  const printWindow = window.open('', '_blank');
  printWindow.document.write(printContent);
  printWindow.document.close();
  setTimeout(() => printWindow.print(), 500);
}

// دالة تصدير فواتير المستخدم إلى CSV
window.exportUserInvoices = function(username, date) {
  if (!window.lastUserInvoices || window.lastUserInvoices.length === 0) {
    alert("لا توجد فواتير لتصديرها");
    return;
  }
  
  const BOM = "\uFEFF";
  const rows = [
    ["رقم الفاتورة", "الطالب", "النوع", "المبلغ", "حالة الدفع", "الوقت"]
  ];
  
  window.lastUserInvoices.forEach(inv => {
    const total = inv.items?.reduce((sum, item) => sum + (parseFloat(item.price) || 0), 0) || 0;
    const time = inv.date.toLocaleTimeString('ar-EG');
    const amount = inv.isVodafone ? '(لا تُحسب)' : total.toFixed(2);
    
    rows.push([
      inv.num || '-',
      inv.student || '-',
      [inv.subType || '-', inv.sourceLabel].filter(Boolean).join(' - '),
      amount,
      inv.payment || '-',
      time
    ]);
  });
  
  const csvContent = BOM + rows.map(row => {
    return row.map(cell => {
      const text = String(cell).replace(/"/g, '""');
      return `"${text}"`;
    }).join(",");
  }).join("\n");
  
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `فواتير_${username}_${date}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}


