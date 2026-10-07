// js/dashboard.js
import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { collection, doc, getDocs, runTransaction, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// توجيه لصفحة الكاشير
window.goToCashier = function () {
  window.location.href = "cashier.html";
};

// توجيه الصفحات من القائمة الجانبية
const sidebarItems = document.querySelectorAll(".sidebar ul li");

const pagesMap = {
  "الرئيسية": "dashboard.html",
  "الكاشير": "cashier.html",
  "الاشتراكات": "subscriptions.html",
  "الملازم": "invoices.html",
  "المصروفات": "expenses.html",
  "المستخدمين": "users.html",
  "التقارير": "reports.html",
  "الإعدادات": "settings.html",
  "دليل المساعدة": "help.html",
};

sidebarItems.forEach(item => {
  item.addEventListener("click", () => {
    const page = pagesMap[item.textContent.trim()];
    if (page) {
      window.location.href = page;
    }
  });
});

// عرض الوقت والتاريخ
function updateTime() {
  const now = new Date();
  document.getElementById("time").textContent = now.toLocaleTimeString("ar-EG");
  document.getElementById("full-date").textContent = now.toLocaleDateString("ar-EG", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });
}
setInterval(updateTime, 1000);
updateTime();

// تسجيل الخروج
document.addEventListener("DOMContentLoaded", function() {
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

  // التحقق من حالة الدخول
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "login.html";
    } else {
      // جلب اسم المستخدم من قاعدة البيانات
      let username = user.email;
      try {
        const snapshot = await getDocs(collection(db, "users"));
        snapshot.forEach(docSnap => {
          const u = docSnap.data();
          if (u.email === user.email) {
            username = u.username;
          }
        });
      } catch (e) {}
      document.getElementById("center-name").textContent = "مرحباً " + username;
    }
  });
});

// --- إحصائيات الداشبورد ---
async function loadDashboardStats() {
  const today = new Date();
  const todayStr = today.toLocaleDateString('ar-EG');
  const month = today.getMonth();
  const year = today.getFullYear();
  let todayStudentsCount = 0;
  let monthIncome = 0;
  let todayIncome = 0;
  let lastInvoice = null;
  let lastInvoiceDate = null;

  const snapshot = await getDocs(collection(db, "invoices"));
  snapshot.forEach(docSnap => {
    const inv = docSnap.data();
    // تاريخ الفاتورة
    let d = inv.date;
    if (d && typeof d === 'object' && d.toDate) d = d.toDate();
    else if (d) d = new Date(d);
    else return;
    // أرباح الشهر
    if (d.getMonth() === month && d.getFullYear() === year) {
      monthIncome += (inv.items||[]).reduce((sum,x)=>sum+(+x.price||0),0);
    }
    // أرباح اليوم
    if (d.toLocaleDateString('ar-EG') === todayStr) {
      todayIncome += (inv.items||[]).reduce((sum,x)=>sum+(+x.price||0),0);
      // عدد الطلاب اليوم (فقط الفواتير الجماعية)
      if (
        inv.student && inv.student !== '-' && inv.student.trim() !== '' &&
        (inv.subType === 'كورسات' || inv.subType === 'ملازم')
      ) {
        todayStudentsCount++;
      }
    }
    // آخر فاتورة
    if (!lastInvoiceDate || d > lastInvoiceDate) {
      lastInvoiceDate = d;
      lastInvoice = inv;
    }
  });
  // تحديث DOM
  document.getElementById('today-students').textContent = todayStudentsCount;
  document.getElementById('month-income').textContent = monthIncome + ' ج';
  document.getElementById('today-income').textContent = todayIncome + ' ج';
  if (lastInvoice) {
    // إذا كانت آخر فاتورة من نوع كورسات فقط
    if (lastInvoice.subType === 'كورسات') {
      document.getElementById('last-bill').textContent = 'كورسات';
    } else {
      document.getElementById('last-bill').textContent = '--';
    }
  } else {
    document.getElementById('last-bill').textContent = '--';
  }
}

window.addEventListener('DOMContentLoaded', loadDashboardStats);

const bookletStockPanel = document.getElementById('booklet-stock-panel');
const bookletStockGrade = document.getElementById('booklet-stock-grade');
const bookletStockItem = document.getElementById('booklet-stock-item');
const bookletStockQuantity = document.getElementById('booklet-stock-quantity');
const bookletStockForm = document.getElementById('booklet-stock-form');
const bookletStockCurrent = document.getElementById('booklet-stock-current');
let bookletStockRecords = [];

function displayDashboardNotification(message, type) {
  if (typeof window.showNotification === 'function') {
    window.showNotification(message, type, 3500);
  } else {
    console.error(message);
  }
}

function getBookletRecords() {
  return bookletStockRecords.filter(record =>
    record.type === 'ملازم' || record.type === 'ملازم فردية'
  );
}

function loadBookletStockOptions() {
  if (!bookletStockGrade || !bookletStockItem) return;
  const grades = [...new Set(getBookletRecords().map(record => String(record.grade || '').trim()).filter(Boolean))]
    .sort((first, second) => first.localeCompare(second, 'ar', { numeric: true, sensitivity: 'base' }));

  bookletStockGrade.replaceChildren(new Option('اختر الفرقة', ''));
  grades.forEach(grade => bookletStockGrade.add(new Option(grade, grade)));
  bookletStockGrade.disabled = grades.length === 0;
  if (grades.length === 0) {
    bookletStockItem.replaceChildren(new Option('لا توجد ملازم مضافة', ''));
    bookletStockItem.disabled = true;
  }
}

function updateBookletStockItems() {
  if (!bookletStockGrade || !bookletStockItem) return;
  const grade = bookletStockGrade.value;
  const records = getBookletRecords().filter(record => record.grade === grade);
  bookletStockItem.replaceChildren(new Option(grade ? 'اختر الملزمة' : 'اختر الفرقة أولًا', ''));
  records
    .sort((first, second) => String(first.name || '').localeCompare(String(second.name || ''), 'ar', { numeric: true, sensitivity: 'base' }))
    .forEach(record => {
      const productType = record.type === 'ملازم' ? 'اشتراك ملازم' : 'ملزمة فردية';
      bookletStockItem.add(new Option(`${record.name} (${productType}) · المتوفر ${Number(record.stock) || 0}`, record.id));
    });
  bookletStockItem.disabled = !grade || records.length === 0;
  if (bookletStockCurrent) bookletStockCurrent.textContent = '';
}

function updateSelectedBookletStock() {
  const selected = getBookletRecords().find(record => record.id === bookletStockItem?.value);
  if (bookletStockCurrent) {
    bookletStockCurrent.textContent = selected
      ? `الرصيد الحالي: ${Number(selected.stock) || 0} نسخة`
      : '';
  }
}

async function loadBookletStockRecords() {
  const snapshot = await getDocs(collection(db, 'subscriptions'));
  bookletStockRecords = snapshot.docs.map(subscriptionDoc => ({
    id: subscriptionDoc.id,
    ...subscriptionDoc.data()
  }));
  loadBookletStockOptions();
}

async function getBookletStockAccess(user) {
  if (!user) return null;
  const snapshot = await getDocs(collection(db, 'users'));
  const userDoc = snapshot.docs.find(profileDoc =>
    profileDoc.id === user.uid ||
    String(profileDoc.data().email || '').trim().toLowerCase() === String(user.email || '').trim().toLowerCase()
  );
  if (!userDoc) return null;
  const profile = userDoc.data();
  const permissions = Array.isArray(profile.permissions) ? profile.permissions : [];
  return {
    profile,
    allowed: profile.type === 'مدير' || permissions.includes('add_booklet_stock')
  };
}

if (bookletStockGrade) {
  bookletStockGrade.addEventListener('change', updateBookletStockItems);
}

if (bookletStockItem) {
  bookletStockItem.addEventListener('change', updateSelectedBookletStock);
}

onAuthStateChanged(auth, async user => {
  if (!bookletStockPanel) return;
  bookletStockPanel.hidden = true;
  if (!user) return;
  try {
    const access = await getBookletStockAccess(user);
    if (!access?.allowed) return;
    bookletStockPanel.hidden = false;
    await loadBookletStockRecords();
  } catch (error) {
    console.error('تعذر التحقق من صلاحية إضافة مخزون الملازم:', error);
    displayDashboardNotification('تعذر تحميل صلاحية ومخزون الملازم. تحقق من الاتصال ثم أعد المحاولة.', 'error');
  }
});

if (bookletStockForm) {
  bookletStockForm.addEventListener('submit', async event => {
    event.preventDefault();
    const itemId = bookletStockItem?.value;
    const quantity = Number(bookletStockQuantity?.value);
    const grade = bookletStockGrade?.value;
    const selected = getBookletRecords().find(record => record.id === itemId);
    if (!selected || selected.grade !== grade || !Number.isInteger(quantity) || quantity <= 0) {
      displayDashboardNotification('اختر الفرقة والملزمة وأدخل كمية صحيحة أكبر من صفر.', 'error');
      return;
    }

    const user = auth.currentUser;
    let access;
    try {
      access = await getBookletStockAccess(user);
    } catch (error) {
      console.error('تعذر إعادة التحقق من صلاحية إضافة المخزون:', error);
      displayDashboardNotification('تعذر التحقق من الصلاحية. لم يُضف المخزون.', 'error');
      return;
    }
    if (!access?.allowed) {
      bookletStockPanel.hidden = true;
      displayDashboardNotification('ليس لديك صلاحية إضافة مخزون الملازم. تواصل مع المدير.', 'error');
      return;
    }

    const submitButton = document.getElementById('booklet-stock-submit');
    submitButton.disabled = true;
    try {
      const stockRef = doc(db, 'subscriptions', itemId);
      const movementRef = doc(collection(db, 'stockMovements'));
      let updatedStock = 0;
      const recordedAt = Timestamp.now();
      const recordedBy = String(access.profile.username || access.profile.fullname || user.email || 'مستخدم');

      await runTransaction(db, async transaction => {
        const stockSnapshot = await transaction.get(stockRef);
        if (!stockSnapshot.exists()) throw new Error('الملزمة غير موجودة');
        const stockData = stockSnapshot.data();
        if (!['ملازم', 'ملازم فردية'].includes(stockData.type) || stockData.grade !== grade) {
          throw new Error('بيانات الملزمة لا تطابق الاختيار');
        }
        const stockBefore = Number(stockData.stock) || 0;
        updatedStock = stockBefore + quantity;
        transaction.update(stockRef, { stock: updatedStock });
        transaction.set(movementRef, {
          type: 'booklet_stock_in',
          subscriptionId: itemId,
          subscriptionName: String(stockData.name || ''),
          grade,
          quantity,
          stockBefore,
          stockAfter: updatedStock,
          recordedAt,
          recordedBy,
          recordedByUid: user.uid
        });
      });

      displayDashboardNotification(`تمت إضافة ${quantity} نسخة. الرصيد الجديد: ${updatedStock}.`, 'success');
      bookletStockQuantity.value = '';
      await loadBookletStockRecords();
      if (bookletStockGrade) bookletStockGrade.value = grade;
      updateBookletStockItems();
      if (bookletStockItem) bookletStockItem.value = itemId;
      updateSelectedBookletStock();
    } catch (error) {
      console.error('تعذر تسجيل إضافة مخزون الملزمة:', error);
      displayDashboardNotification('تعذر إضافة المخزون. لم يتم حفظ الحركة، حاول مرة أخرى.', 'error');
    } finally {
      submitButton.disabled = false;
    }
  });
}
