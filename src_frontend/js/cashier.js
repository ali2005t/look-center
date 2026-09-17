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
// حماية الصفحات من دخول الكاشير لغير صفحة الكاشير
function blockCashierOnOtherPages() {
  try {
    const userType = localStorage.getItem('userType');
    // إذا كان المستخدم كاشير وليس في صفحة الكاشير
    const allowedPages = ['cashier.html'];
    const currentPage = window.location.pathname.split('/').pop();
    if (userType === 'كاشير' && !allowedPages.includes(currentPage)) {
      document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;width:100vw;"><div style="background:#fff;padding:48px 32px;border-radius:18px;box-shadow:0 4px 32px #1976d244;text-align:center;max-width:400px;margin:auto;"><div style="font-size:2em;color:#1976d2;font-weight:bold;margin-bottom:18px;">لا تحاول بالتدخل فيما لايعينك</div><div style="font-size:1.3em;color:#43a047;margin-bottom:12px;">تابع عملك يا صديقي <span style='font-size:2em;'>😊</span></div></div></div>`;
      document.body.style.background = '#e3f2fd';
    }
  } catch (e) { }
}
window.addEventListener('DOMContentLoaded', blockCashierOnOtherPages);

import { db } from './firebase.js';
import { collection, getDocs, addDoc, Timestamp, doc, getDoc, setDoc, updateDoc, increment } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

let selectedGrade = "";
let selectedSubType = "";
let selectedItems = [];
// متغير جديد لتخزين العناصر حسب نوع الاشتراك
let itemsBySubType = {};

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
  try {
    const auth = getAuth();
    const user = auth.currentUser;
    if (user && user.uid) {
      console.log('Firebase Auth UID:', user.uid);
      const userRef = doc(db, 'users', user.uid);
      let userDoc = await getDoc(userRef);
      let username = '';
      if (!userDoc.exists()) {
        // إذا لم توجد وثيقة، أنشئها تلقائياً باسم افتراضي
        username = user.displayName && user.displayName.trim() ? user.displayName.trim() : '';
        if (!username && user.email) {
          username = user.email.replace(/@.*/, '').trim();
        }
        if (!username) username = 'غير محدد';
        if (username.includes('@')) username = 'غير محدد';
        await setDoc(userRef, { username });
        console.log('Created user doc for:', user.uid, 'with username:', username);
        userDoc = await getDoc(userRef);
      } else {
        // إذا الوثيقة موجودة لكن username غير صالح أو ناقص
        const data = userDoc.data();
        username = data.username || data.name || '';
        if (!username || !username.trim() || username.includes('@')) {
          // تحديث الوثيقة باسم افتراضي
          username = user.displayName && user.displayName.trim() ? user.displayName.trim() : '';
          if (!username && user.email) {
            username = user.email.replace(/@.*/, '').trim();
          }
          if (!username) username = 'غير محدد';
          if (username.includes('@')) username = 'غير محدد';
          await setDoc(userRef, { username }, { merge: true });
          console.log('Updated user doc for:', user.uid, 'with username:', username);
          userDoc = await getDoc(userRef);
        }
      }
      if (userDoc.exists()) {
        const data = userDoc.data();
        console.log('Firestore userDoc data:', data);
        let username = data.username || data.name;
        // لا تظهر البريد الإلكتروني أو أي نص فيه @ في خانة المستلم
        if (!username || !username.trim() || username.includes('@')) username = 'غير محدد';
        currentRecipient = username;
        console.log('Current recipient:', currentRecipient);
      } else {
        currentRecipient = 'غير محدد';
      }
    } else {
      currentRecipient = 'غير محدد';
    }
  } catch (e) {
    console.error('Error fetching recipient:', e);
    currentRecipient = 'غير محدد';
  }
  updateInvoicePreview();
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
  if (subType === "اشتراك كورسات") return "كورسات";
  if (subType === "اشتراك ملازم") return "ملازم";
  return subType; // "محاضرات فردية" أو "ملازم فردية"
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
      if (data.type === "ملازم فردية" && data.grade === grade && (data.published === undefined || data.published)) {
        items.push({ id: docSnap.id, name: data.name, price: data.price, stock: data.stock || 0 });
      }
    });
  } else if (subType === "محاضرات فردية") {
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      if (data.type === "محاضرات فردية" && data.grade === grade && (data.published === undefined || data.published)) {
        items.push({ id: docSnap.id, name: data.name, price: data.price, stock: data.stock || 0 });
      }
    });
  } else {
    // منطق الاشتراكات العادي
    const dbType = mapSubTypeToDbType(subType);
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      if (data.type === dbType && data.grade === grade && (data.published === undefined || data.published)) {
        items.push({ id: docSnap.id, name: data.name, price: data.price, stock: data.stock || 0 });
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
  const subType = selectedSubType;
  const payment = document.getElementById('payment-method')?.value || '';
  const notes = document.getElementById('notes')?.value || '';
  let items = [];
  if (window.selectedItems && Array.isArray(window.selectedItems)) {
    items = window.selectedItems;
  }

  // حساب مجموع العناصر
  const totalAmount = items.reduce((sum, x) => sum + (+x.price || 0), 0);

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
        <div class='invoice-preview-total'><b>المجموع:</b> <span>${items.reduce((sum, x) => sum + (+x.price || 0), 0)} ج</span></div>
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
        <div class='invoice-preview-total'><b>المبلغ المدفوع:</b> <span>${items.reduce((sum, x) => sum + (+x.price || 0), 0)} ج</span></div>
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

    const userType = localStorage.getItem('userType');
    const userPermissions = JSON.parse(localStorage.getItem('userPermissions') || '[]');
    const isSubscriberInvoice = subTypesSelected.some(st => st !== 'محاضرات فردية' && st !== 'ملازم فردية');

    if (isSubscriberInvoice && userType !== 'مدير' && !userPermissions.includes('create_subscriber_invoice')) {
      showNotification('❌ ليس لديك صلاحية لإنشاء فواتير الطلاب المشتركين. يرجى التواصل مع المدير.', 'error', 4000);
      return;
    }

    let student = '', phone = '';
    const grade = selectedGrade;
    const studyType = document.getElementById('study-type').value;
    const payment = document.getElementById('payment-method').value;
    const notes = document.getElementById('notes').value;
    const recipient = currentRecipient || '-';
    const installment = {
      total: document.getElementById('installment-total')?.value || '',
      paid: document.getElementById('installment-paid')?.value || '',
      remaining: document.getElementById('installment-remaining')?.value || ''
    };

    const isIndividual = subTypesSelected.some(st => st === 'محاضرات فردية' || st === 'ملازم فردية');
    if (!isIndividual) {
      student = document.getElementById('student-name').value;
      phone = document.getElementById('phone').value;
    }

    let invoiceIds = {};
    const centerName = localStorage.getItem('centerName') || 'اسم السنتر';
    const centerAddress = localStorage.getItem('centerAddress') || '';
    const centerPhone1 = localStorage.getItem('centerPhone1') || '';
    const centerPhone2 = localStorage.getItem('centerPhone2') || '';
    const centerPhone3 = localStorage.getItem('centerPhone3') || '';
    const logoSrc = localStorage.getItem('logoSrc') || '';

    try {
      // 1. إنشاء الفواتير
      for (let subType of subTypesSelected) {
        const itemsForSubType = itemsBySubType[subType] || [];
        const invoice = {
          grade: grade,
          studyType: studyType,
          subType: mapSubTypeToDbType(subType),
          items: itemsForSubType.map(({ subType, ...rest }) => rest),
          payment: payment,
          notes: notes,
          date: Timestamp.now(),
          recipient: recipient,
          installment: installment,
          num: nextInvoiceNumber + (subTypesSelected.indexOf(subType)),
          centerInfo: { name: centerName, address: centerAddress, phone1: centerPhone1, phone2: centerPhone2, phone3: centerPhone3, logo: logoSrc },
          isVodafone: payment === 'فودافون كاش'
        };

        if (subType !== 'محاضرات فردية' && subType !== 'ملازم فردية') {
          invoice.student = student;
          invoice.phone = phone;
        }

        const savedInvoiceRef = await addDoc(collection(db, 'invoices'), invoice);
        invoiceIds[mapSubTypeToDbType(subType)] = savedInvoiceRef.id;
        localStorage.setItem('invoice_saved', Date.now());
      }

      showNotification('تم حفظ الفواتير بنجاح (' + subTypesSelected.length + ' فاتورة)', 'success', 2500);

      // 2. جلب الفواتير للطباعة (بما فيها معلومات تسليم الكروت)
      const refreshInvoices = [];
      for (let dbType of Object.values(invoiceIds)) {
        const snap = await getDoc(doc(db, 'invoices', dbType));
        if (snap.exists()) refreshInvoices.push({ ...snap.data(), id: snap.id });
      }

      // 3. خصم المخزون للعناصر العادية
      const allSubsForStock = await getDocs(collection(db, 'subscriptions'));
      for (const item of allSelectedItems) {
        if (item.id) {
          try {
            const itemDoc = allSubsForStock.docs.find(d => d.id === item.id);
            const itemData = itemDoc ? itemDoc.data() : null;
            if (itemData) {
              for (const d of allSubsForStock.docs) {
                const data = d.data();
                if (data.name === itemData.name && data.type === itemData.type) {
                  await updateDoc(doc(db, 'subscriptions', d.id), { stock: increment(-1) });
                }
              }
            } else if (item.isOnlineCard) {
              // خصم لو كرت فردي تم بيعه مباشرة
              await updateDoc(doc(db, 'onlineCards', item.id), { stock: increment(-1) });
            }
          } catch (e) { console.error('Stock error:', e); }
        }
      }

      // 4. معالجة تسليم كروت الأونلاين (الـ Checkboxes)
      const deliveryCheckboxes = document.querySelectorAll('#online-card-delivery-list input[type="checkbox"]');
      let onlineCardsDeliveryInfo = [];

      for (const cb of deliveryCheckboxes) {
        const cardId = cb.dataset.cardId;
        const cardName = cb.dataset.cardName;
        const perSub = parseInt(cb.dataset.perSub) || 1;
        const cardType = cb.dataset.cardType;
        const isDelivered = cb.checked;

        onlineCardsDeliveryInfo.push({ cardId, cardName, isDelivered });

        if (isDelivered) {
          try {
            const cardRef = doc(db, 'onlineCards', cardId);
            if (cardType === 'للاشتراكات') {
              const subCount = allSelectedItems.filter(i => i.subType !== 'محاضرات فردية' && i.subType !== 'ملازم فردية' && !i.isOnlineCard).length;
              if (subCount > 0) await updateDoc(cardRef, { stock: increment(-subCount * perSub) });
            } else {
              await updateDoc(cardRef, { stock: increment(-1) });
            }
          } catch (e) { console.error('Online card stock error:', e); }
        }
      }

      // تحديث الفواتير المسجلة بمعلومات التسليم في قاعدة البيانات
      for (let dbType of Object.values(invoiceIds)) {
        await updateDoc(doc(db, 'invoices', dbType), {
          onlineCardsDelivery: onlineCardsDeliveryInfo
        });
      }

      refreshInvoices.forEach(inv => {
        inv.onlineCardsDelivery = onlineCardsDeliveryInfo;
      });

      // 5. إعادة تعيين وإنهاء
      document.getElementById('invoice-form').reset();
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
document.getElementById('sub-type').addEventListener('input', updateFormFields);

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
  updateInvoicePreview();
  // تحديث مربعات تسليم كروت الأونلاين - ندهها مباشرة
  updateOnlineCardDelivery();
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
    const isOutOfStock = item.stock <= 0 && (subType === 'ملازم فردية' || subType === 'محاضرات فردية' || subType === 'ملازم');

    tr.innerHTML = `
      <td style="${isOutOfStock ? 'color:#888;text-decoration:line-through;' : ''}">${item.name} ${item.stock !== undefined ? `<small style="color:#666;display:block;">(المتوفر: ${item.stock})</small>` : ''}</td>
      <td style="${isOutOfStock ? 'color:#888;' : ''}">${item.price} ج</td>
      <td>
        <button class="${isSelected ? 'remove' : ''}" ${isOutOfStock && !isSelected ? 'disabled style="background:#ccc;cursor:not-allowed;"' : ''}>
          ${isOutOfStock && !isSelected ? 'نفذ' : (isSelected ? 'إزالة' : 'إضافة')}
        </button>
      </td>
    `;
    const btn = tr.querySelector('button');
    btn.onclick = (e) => {
      e.stopPropagation();
      if (isOutOfStock && !isSelected) {
        showNotification(`⚠️ "${item.name}" نفذ من المخزون!`, 'warning', 2500);
        return;
      }

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

  // التحقق من بيانات الطالب إذا لم تكن محاضرات أو ملازم فردية فقط
  const isOnlyIndividual = subTypesSelected.every(st => st === 'محاضرات فردية' || st === 'ملازم فردية');
  if (!isOnlyIndividual) {
    const student = document.getElementById('student-name').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const studyType = document.getElementById('study-type').value;

    // اسم الطالب ثلاثي
    if (student.split(' ').filter(Boolean).length < 3) {
      showNotification('يرجى إدخال اسم الطالب ثلاثي على الأقل', 'error', 3500);
      return false;
    }
    // رقم الهاتف 11 رقم
    if (!/^01[0-9]{9}$/.test(phone)) {
      showNotification('يرجى إدخال رقم هاتف صحيح مكون من 11 رقم يبدأ بـ 01', 'error', 3500);
      return false;
    }
    // انتظام/انتساب
    if (!studyType || (studyType !== 'انتظام' && studyType !== 'انتساب')) {
      showNotification('يرجى اختيار انتظام أو انتساب', 'error', 3500);
      return false;
    }
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
  const subType = document.getElementById('sub-type')?.value || selectedSubType;
  let dbType = '';
  if (subType === 'اشتراك كورسات') dbType = 'كورسات';
  else if (subType === 'اشتراك ملازم') dbType = 'ملازم';
  else dbType = subType;
  const snapshot = await getDocs(collection(db, 'invoices'));
  let count = 0;
  snapshot.forEach(docSnap => {
    const inv = docSnap.data();
    // فقط الفواتير من نفس النوع
    if (inv && inv.subType === dbType) {
      count++;
    }
  });
  nextInvoiceNumber = count + 1;
  updateInvoicePreview();
}

// البحث عن اشتراك ملازم/كورسات بنفس رقم الهاتف
async function fetchLinkedSubscription(phone, currentType) {
  if (!phone || !/^01[0-9]{9}$/.test(phone)) return null;
  const snapshot = await getDocs(collection(db, 'invoices'));
  let found = null;
  snapshot.forEach(docSnap => {
    const inv = docSnap.data();
    if (inv && inv.phone === phone) {
      if (currentType === 'كورسات' && inv.subType === 'ملازم') found = 'لديه اشتراك ملازم';
      if (currentType === 'ملازم' && inv.subType === 'كورسات') found = 'لديه اشتراك كورسات';
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
function printInvoice() {
  const inv = window.lastSavedInvoice || {};
  let logoSrc = localStorage.getItem('centerLogo');
  if (!logoSrc || logoSrc === 'null' || logoSrc === 'undefined') {
    logoSrc = 'img/placeholder-logo.png';
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

  // حساب الإجمالي
  const total = (inv.items || []).reduce((sum, x) => sum + (parseFloat(x.price) || 0), 0);

  // بناء محتوى الفاتورة بتصميم محسّن
  let html = `
    <div style='text-align:center;font-family:"Cairo", "Arabic Typesetting", sans-serif;direction:rtl;'>
      <img src='${logoSrc}' alt='شعار السنتر' />
      <h1>${centerName}</h1>
      <hr>
      <div class='invoice-num'>فاتورة رقم: ${inv.num || '-'}</div>
      
      <table>
        <tr>
          <td>الاسم:</td>
          <td>${inv.student || '-'}</td>
        </tr>
        <tr>
          <td>الهاتف:</td>
          <td>${inv.phone || '-'}</td>
        </tr>
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
      <div style='margin:3mm 0;padding:2mm;background:#fff3e0;border-left:2px solid #ff9800;border-radius:3px;text-align:right;font-size:10px;color:#e65100;'>
        كود الملازم: <span style='color:#ff6f00;font-weight:bold;'>${inv.num ? inv.num + 1 : '-'}</span>
      </div>
      ` : ''}
      
      <table style='margin:3mm 0;'>
        ${(inv.items || []).map((item, idx) => `
        <tr ${idx % 2 === 0 ? "style='background:#f9f9f9;'" : ''}>
          <td>${item.name}</td>
          <td style='color:#388e3c;font-weight:bold;'>${item.price} ج</td>
        </tr>
        `).join('')}
      </table>
      
      <div class='total-box'>
        الإجمالي: ${total.toFixed(2)} ج
      </div>
      
      <table>
        ${inv.payment ? `<tr><td>الدفع:</td><td>${inv.payment}</td></tr>` : ''}
        ${inv.payment === 'تقسيط' && inv.installment ? `
        <tr style='background:#fff9c4;'><td>المدفوع:</td><td>${inv.installment.paid || 0} ج</td></tr>
        <tr style='background:#fff59d;'><td>المتبقي:</td><td>${inv.installment.remaining || 0} ج</td></tr>
        ` : ''}
        ${inv.notes ? `<tr><td>ملاحظات:</td><td>${inv.notes}</td></tr>` : ''}
      </table>
      
      <div class='footer'>
        <div style='font-weight:bold;color:#1565c0;margin-bottom:1mm;'>الفرع الرئيسي</div>
        <div>${centerAddress || '-'}</div>
        <div style='margin:0.5mm 0;font-size:10px;'>
          ${[centerPhone1, centerPhone2, centerPhone3].filter(p => p).map(p => `${p}`).join(' - ')}
        </div>
        <div style='margin-top:1.5mm;border-top:0.5px solid #ddd;padding-top:1mm;'>التاريخ: ${inv.date ? (inv.date.toDate ? inv.date.toDate().toLocaleDateString('ar-EG') : inv.date) : '-'}</div>
        <div style='margin-top:1mm;'>المستلم: ${currentRecipient && currentRecipient !== '-' ? currentRecipient : 'غير محدد'}</div>
      </div>
    </div>
  `;

  // نافذة الطباعة
  const win = window.open('', '', 'width=400,height=600');
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
          line-height: 1.3;
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
            background: white;
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
    </head>
    <body><div class="print-container">${html}</div></body>
    </html>
  `);

  win.document.close();
  setTimeout(() => {
    win.print();
  }, 300);
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

  // تحديد أي أنواع كروت محتاجين نعرضها
  let hasSubscriptions = false;
  let hasIndividualItems = false;

  Object.keys(itemsBySubType || {}).forEach(subType => {
    const items = itemsBySubType[subType];
    if (Array.isArray(items) && items.length > 0) {
      if (subType === 'محاضرات فردية' || subType === 'ملازم فردية') {
        hasIndividualItems = true;
      } else if (subType.includes('اشتراك')) {
        hasSubscriptions = true;
      } else {
        // أي صنف أخر يندرج تحت الاشتراكات في الغالب
        hasSubscriptions = true;
      }
    }
  });

  try {
    const snap = await getDocs(collection(db, 'onlineCards'));
    const relevantCards = [];
    snap.forEach(d => {
      const data = d.data();
      if (data.type === 'للاشتراكات' && hasSubscriptions) {
        relevantCards.push({ id: d.id, ...data });
      } else if (data.type === 'فردي' && hasIndividualItems) {
        relevantCards.push({ id: d.id, ...data });
      }
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

    list.innerHTML = relevantCards.map(card => `
      <label style="display:flex;align-items:center;gap:10px;margin-bottom:6px;cursor:pointer;background:#fff;padding:8px;border-radius:8px;border:1px solid #e0f0ff;">
        <input type="checkbox" data-card-id="${card.id}" data-card-name="${card.name}" data-per-sub="${card.perSub || 1}" data-card-type="${card.type}"
          ${prevChecked[card.id] ? 'checked' : ''}
          style="width:20px;height:20px;accent-color:#1976d2;">
        <span style="font-size:0.95em;">
          <b style="color:#1565c0;">${card.name}</b>
          <br>
          <small style="color:#666;">
            ${card.type === 'للاشتراكات' ? `(${card.perSub || 1} كرت/اشتراك)` : '(كود فردي)'} 
            | مخزون: <span style="color:${(card.stock || 0) < 10 ? 'red' : '#388e3c'}">${card.stock || 0}</span>
          </small>
        </span>
      </label>
    `).join('');
  } catch (e) {
    console.error('Error loading online cards for delivery:', e);
  }
}

// استدعاء updateOnlineCardDelivery عند تغيّر العناصر المختارة
// تم دمج الاستدعاء مباشرة لحل مشكلة عدم الظهور
document.addEventListener('selectedItemsChanged', updateOnlineCardDelivery);
window.updateOnlineCardDelivery = updateOnlineCardDelivery;

// ملاحظة: تأكد من استدعاء هذه الوظيفة يدوياً في الأماكن التي تغير selectedItems
// أو استخدام Event Custom كما فعلنا أعلاه
