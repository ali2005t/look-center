import { getUserInvoiceSummary } from './user_invoice_summary.js';
// دالة لعرض ملخص المستخدمين في الجدول
async function renderUserSummaryTable() {
  // Ensure elements exist before accessing them
  const monthElement = document.getElementById('summary-month');
  const dayElement = document.getElementById('summary-day');
  const tbodyElement = document.querySelector('#user-summary-table tbody');

  if (!monthElement) {
    console.error('Element with id "summary-month" not found in DOM');
  }
  if (!dayElement) {
    console.error('Element with id "summary-day" not found in DOM');
  }
  if (!tbodyElement) {
    console.error('Element with id "user-summary-table" or its tbody not found in DOM');
  }

  if (!monthElement || !dayElement || !tbodyElement) {
    return;
  }

  const month = monthElement.value;
  const day = dayElement.value;
  const summary = await getUserInvoiceSummary({ month, day });
  const tbody = document.querySelector('#user-summary-table tbody');
  tbody.innerHTML = '';
  const users = Object.keys(summary);
  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan='3' style='text-align:center;color:#b3b3b3;'>لا توجد بيانات</td></tr>`;
    return;
  }
  users.forEach(username => {
    const row = document.createElement('tr');
    row.innerHTML = `<td>${username}</td><td>${summary[username].count}</td><td>${summary[username].totalProfit} ج</td>`;
    tbody.appendChild(row);
  });
}
// زر تحديث الملخص
const refreshSummaryBtn = document.getElementById('refresh-summary-btn');
if (refreshSummaryBtn) refreshSummaryBtn.addEventListener('click', renderUserSummaryTable);
// عرض الملخص عند تحميل الصفحة
window.addEventListener('DOMContentLoaded', function () {
  if (typeof renderUserSummaryTable === 'function') renderUserSummaryTable();
});
import { db } from './firebase.js';
import { collection, getDocs, addDoc, updateDoc, doc, deleteDoc, increment } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { doc as docFirestore, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

let allInvoices = [];
let filteredInvoices = [];

// متغير عالمي لاسم المستلم
let currentRecipient = '-';

// رقم الفاتورة الفردية الحالي
let nextIndividualInvoiceNumber = 1;

// جلب اسم المستخدم الحالي من فايربيس (Firestore) بناءً على uid من Auth
async function fetchCurrentRecipient() {
  try {
    const auth = getAuth();
    const user = auth.currentUser;
    if (user && user.uid) {
      // جلب بيانات المستخدم من Firestore (مجموعة users)
      const userDoc = await getDoc(docFirestore(db, 'users', user.uid));
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

// جلب جميع الفواتير الفردية فقط
async function fetchIndividualInvoices() {
  const invoicesSnap = await getDocs(collection(db, 'invoices'));
  allInvoices = [];
  let i = 1;
  invoicesSnap.forEach(inv => {
    const data = inv.data();
    if (data.subType === 'ملازم فردية' || data.subType === 'محاضرات فردية') {
      allInvoices.push({
        num: i++,
        type: data.subType,
        items: data.items || [],
        total: (data.items || []).reduce((sum, x) => sum + (+x.price || 0), 0),
        date: data.date && data.date.toDate ? data.date.toDate().toLocaleDateString() : (data.date || '-'),
        notes: data.notes || '',
        studyType: data.studyType || '-',
        grade: data.grade || '-',
        recipient: data.recipient || '-', // جلب اسم المستلم من الفاتورة
        onlineCardsDelivery: data.onlineCardsDelivery || [],
        docId: inv.id
      });
    }
  });
  filteredInvoices = [...allInvoices];
  fillRecipientFilter();
  renderTable();
}

// جلب رقم الفاتورة الفردية التالي
async function fetchNextIndividualInvoiceNumber() {
  const invoicesSnap = await getDocs(collection(db, 'invoices'));
  let maxNum = 0;
  invoicesSnap.forEach(inv => {
    const data = inv.data();
    if ((data.subType === 'ملازم فردية' || data.subType === 'محاضرات فردية') && data.individualInvoiceNumber && !isNaN(data.individualInvoiceNumber)) {
      maxNum = Math.max(maxNum, data.individualInvoiceNumber);
    }
  });
  nextIndividualInvoiceNumber = maxNum + 1;
}

function renderTable() {
  const tbody = document.getElementById('unsubscribed-tbody');
  const emptyDiv = document.getElementById('unsubscribed-empty');
  tbody.innerHTML = '';
  if (filteredInvoices.length === 0) {
    emptyDiv.style.display = '';
    return;
  }
  emptyDiv.style.display = 'none';
  // جلب صلاحيات المستخدم من localStorage
  let userPermissions = [];
  let userType = '';
  try {
    userPermissions = JSON.parse(localStorage.getItem('userPermissions') || '[]');
    userType = localStorage.getItem('userType') || '';
  } catch (e) { }
  // الكاشير يمكنه الحذف فقط إذا سمح المدير بصلاحية حذف الفواتير
  const canDeleteInvoice = userPermissions.includes('delete_invoice');
  filteredInvoices.forEach((inv, idx) => {
    const itemsText = inv.items.length ? inv.items.map(x => x.name).join('، ') : '-';
    let recipientCell = `<span class="recipient-cell" style="display:inline-block;padding:4px 12px;border-radius:8px;background:linear-gradient(90deg,#e3f2fd 60%,#bbdefb 100%);color:#1976d2;font-weight:bold;font-size:1em;box-shadow:0 1px 4px #90caf922;">${inv.recipient && inv.recipient !== '-' ? inv.recipient : '<span style=\'color:#b3b3b3\'>غير محدد</span>'}</span>`;
    const invoiceNum = inv.individualInvoiceNumber ? String(inv.individualInvoiceNumber).padStart(4, '0') : String(inv.num).padStart(4, '0');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${invoiceNum}</td>
      <td>${inv.type}</td>
      <td style="font-size:13px;line-height:1.7;">${itemsText}</td>
      <td>${inv.total} ج</td>
      <td>${inv.date}</td>
      <td>${inv.notes}</td>
      <td>${inv.studyType || '-'}</td>
      <td><button class="edit-btn" data-idx="${idx}" style="background:#1976d2;color:#fff;padding:6px 14px;border:none;border-radius:6px;cursor:pointer;">تعديل</button></td>
      <td>${canDeleteInvoice ? `<button class=\"delete-btn\" data-idx=\"${idx}\" style=\"background:#f44336;color:#fff;padding:6px 14px;border:none;border-radius:6px;cursor:pointer;\">حذف</button>` : ''}</td>
      <td><button class="view-btn" data-idx="${idx}" style="background:#009688;color:#fff;padding:6px 14px;border:none;border-radius:6px;cursor:pointer;">قراءة</button></td>
      <td>
        <span style="display:inline-block;padding:4px 10px;border-radius:6px;background:#e3f2fd;color:#1565c0;font-size:0.9em;font-weight:bold;border:1px solid #90caf9;">
          ${(() => {
        const arr = inv.onlineCardsDelivery || [];
        if (arr.length === 0) return '-';
        const del = arr.filter(x => x.isDelivered || x.delivered).length;
        return `${del}/${arr.length} 🃏`;
      })()}
        </span>
      </td>
      <td>${recipientCell}</td>
    `;
    tbody.appendChild(tr);
  });
  // Attach event listeners for operation buttons
  tbody.querySelectorAll('.view-btn').forEach(btn => {
    btn.onclick = () => showInvoiceModal(filteredInvoices[btn.dataset.idx]);
  });
  tbody.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      showEditModal(filteredInvoices[btn.dataset.idx]);
    });
  });
  tbody.querySelectorAll('.delete-btn').forEach(btn => {
    btn.onclick = () => confirmDeleteInvoice(filteredInvoices[btn.dataset.idx]);
  });
}

// Modal logic
function showInvoiceModal(inv) {
  const id = inv.docId;
  renderInvoiceModalContent(id);
}

// دالة منفصلة لبناء محتوى النافذة لسهولة التحديث التلقائي
async function renderInvoiceModalContent(id) {
  const modal = document.getElementById('unsubscribed-invoice-modal');

  // جلب الفاتورة من Firestore لضمان البيانات الحديثة
  const docSnap = await getDoc(doc(db, 'invoices', id));
  if (!docSnap.exists()) return;
  const inv = docSnap.data();
  inv.docId = id;

  const invoiceNum = inv.individualInvoiceNumber ? String(inv.individualInvoiceNumber).padStart(4, '0') : (inv.num ? String(inv.num).padStart(4, '0') : '-');
  const centerLogo = localStorage.getItem('centerLogo') || 'img/placeholder-logo.png';
  const centerName = localStorage.getItem('centerName') || 'اسم السنتر';
  const centerAddress = localStorage.getItem('centerAddress') || 'عنوان السنتر';

  // --- سيلف هيلينج للفواتير القديمة (لو فيها كروت فردية بس مش متسجل لها onlineCardsDelivery) ---
  if ((!inv.onlineCardsDelivery || inv.onlineCardsDelivery.length === 0) && inv.items.some(i => i.isOnlineCard)) {
    const autoCards = inv.items.filter(i => i.isOnlineCard).map(i => ({
      cardId: i.id,
      cardName: i.name,
      isDelivered: false
    }));
    inv.onlineCardsDelivery = autoCards;
    try {
      await updateDoc(doc(db, 'invoices', id), { onlineCardsDelivery: autoCards });
    } catch (e) { console.warn('Could not auto-save onlineCardsDelivery:', e); }
  }

  const onlineCardsArr = inv.onlineCardsDelivery || [];
  let cardDeliverySummary = '';
  let indivCardsBoxes = '';

  if (onlineCardsArr.length > 0) {
    const delCount = onlineCardsArr.filter(x => x.isDelivered || x.delivered).length;
    const remCount = onlineCardsArr.length - delCount;
    cardDeliverySummary = `<div style='margin:18px 0 0 0;padding-top:12px;border-top:1px dashed #90caf9;'>
      <b style='color:#1565c0;'>كروت الأونلاين المستلمة: ${delCount}</b>
      <span style='margin-right:18px;color:#d32f2f;'>المتبقي: ${remCount}</span>
    </div>`;

    indivCardsBoxes = `<div style='margin:12px 0 0 0;'>
      <b style='color:#1565c0;'>تسليم الكروت الفردية:</b>
      <div class='indiv-cards-list' style="display:grid;grid-template-columns:repeat(auto-fill, minmax(140px, 1fr));gap:10px;margin-top:10px;">
        ${onlineCardsArr.map((x, i) =>
      `<div class='indiv-card-box' style="background:#fff;padding:10px;border-radius:10px;border:2px solid ${(x.isDelivered || x.delivered) ? '#1976d2' : '#ffebee'};text-align:center;box-shadow:0 2px 5px rgba(0,0,0,0.05);">
            <div style="font-weight:bold;font-size:0.9em;margin-bottom:5px;color:#1565c0;">${x.cardName || x.name}</div>
            <input type='checkbox' class='card-delivered-checkbox' data-idx='${i}' ${(x.isDelivered || x.delivered) ? 'checked' : ''} style="width:20px;height:20px;accent-color:#1976d2;">
            <div style="font-size:0.8em;font-weight:bold;margin-top:4px;color:${(x.isDelivered || x.delivered) ? '#1976d2' : '#d32f2f'}">${(x.isDelivered || x.delivered) ? 'تـــم التسليم' : 'لـم يستلم'}</div>
          </div>`
    ).join('')}
      </div>
    </div>`;
  }

  modal.innerHTML = `
    <div class="modal-bg" style="position:fixed;top:0;right:0;left:0;bottom:0;background:rgba(0,0,0,0.18);z-index:1000;display:flex;align-items:center;justify-content:center;">
      <div class="modal-box" style="background:#fff;border-radius:18px;box-shadow:0 6px 32px #90caf988;padding:32px 18px 18px 18px;min-width:340px;max-width:480px;position:relative;max-height:90vh;overflow-y:auto;">
        <button id="close-modal-btn" style="position:absolute;left:18px;top:18px;background:transparent;border:none;font-size:22px;color:#1976d2;cursor:pointer;">&#10006;</button>
        <div style="text-align:center;margin-bottom:15px;">
          <img src="${centerLogo}" alt="شعار السنتر" style="max-width:70px;max-height:70px;display:block;margin:0 auto 8px auto;">
          <div style="font-size:1.3em;font-weight:bold;color:#1976d2;">${centerName}</div>
          <div style="font-size:0.9em;color:#666;">${centerAddress}</div>
        </div>
        <div style="background:#f8fbff;padding:15px;border-radius:12px;border:1px solid #e3f2fd;">
          <div style="margin-bottom:8px;"><b>رقم الفاتورة:</b> <span style="color:#1976d2;">#${invoiceNum}</span></div>
          <div style="margin-bottom:8px;"><b>المستلم:</b> ${inv.recipient && inv.recipient !== '-' ? inv.recipient : 'غير محدد'}</div>
          <div style="margin-bottom:8px;"><b>نوع الفاتورة:</b> ${inv.subType || inv.type}</div>
          <div style="margin-bottom:8px;"><b>التاريخ:</b> ${inv.date && inv.date.toDate ? inv.date.toDate().toLocaleDateString() : (inv.date || '-')}</div>
          <div style="margin-bottom:8px;"><b>العناصر:</b> ${inv.items.map(x => x.name).join('، ')}</div>
          <div style="font-size:1.1em;font-weight:bold;color:#2e7d32;"><b>الإجمالي:</b> ${inv.total || (inv.items || []).reduce((s, x) => s + (+x.price || 0), 0)} ج</div>
        </div>
        
        ${cardDeliverySummary}
        ${indivCardsBoxes}
        
        ${inv.notes ? `<div style="margin-top:15px;padding:10px;background:#fffde7;border-radius:8px;font-size:0.9em;"><b>ملاحظات:</b> ${inv.notes}</div>` : ''}
      </div>
    </div>
  `;
  modal.style.display = 'block';
  document.getElementById('close-modal-btn').onclick = () => { modal.style.display = 'none'; };

  // تفعيل أزرار تسليم الكروت
  modal.querySelectorAll('.card-delivered-checkbox').forEach(cb => {
    cb.addEventListener('change', async function () {
      const idx = +cb.getAttribute('data-idx');
      const isDelivered = cb.checked;
      const cardInfo = onlineCardsArr[idx];

      try {
        // 1. تحديث الفاتورة
        onlineCardsArr[idx].isDelivered = isDelivered;
        onlineCardsArr[idx].delivered = isDelivered; // للمواقفين للنسختين
        await updateDoc(doc(db, 'invoices', id), { onlineCardsDelivery: onlineCardsArr });

        // 2. تحديث المخزون (فردي دائماً كمية 1)
        const stockChange = isDelivered ? -1 : 1;
        await updateDoc(doc(db, 'onlineCards', cardInfo.cardId || cardInfo.id), {
          stock: increment(stockChange)
        });

        fetchIndividualInvoices(); // تحديث الجدول الأساسي
        renderInvoiceModalContent(id); // تحديث النافذة المفتوحة
      } catch (e) {
        console.error('Error toggling card delivery:', e);
        alert('حدث خطأ أثناء تحديث حالة الكرت');
      }
    });
  });
}

async function showEditModal(inv) {
  const modal = document.getElementById('unsubscribed-invoice-modal');
  modal.innerHTML = `
    <div class="modal-bg" style="position:fixed;top:0;right:0;left:0;bottom:0;background:rgba(0,0,0,0.18);z-index:1000;display:flex;align-items:center;justify-content:center;">
      <div class="modal-box" style="background:#fff;border-radius:16px;box-shadow:0 6px 32px #90caf988;padding:32px 18px 18px 18px;min-width:320px;max-width:420px;position:relative;">
        <button id="close-modal-btn" style="position:absolute;left:18px;top:18px;background:transparent;border:none;font-size:22px;color:#1976d2;cursor:pointer;">&#10006;</button>
        <h2 style="color:#1976d2;text-align:center;font-weight:bold;margin-bottom:18px;">تعديل الفاتورة</h2>
        <div style="margin-bottom:12px;"><b>ملاحظات:</b><br><textarea id="edit-notes" style="width:100%;border-radius:8px;border:1px solid #b3c6e0;padding:8px;">${inv.notes}</textarea></div>
        <div style="margin-bottom:12px;"><b>التاريخ:</b><br><input id="edit-date" type="date" value="${inv.date && inv.date !== '-' ? (new Date(inv.date.split('/').reverse().join('-')).toISOString().slice(0, 10)) : ''}" style="width:100%;border-radius:8px;border:1px solid #b3c6e0;padding:8px;"></div>
        <button id="save-edit-btn" style="background:#1976d2;color:#fff;padding:8px 24px;border:none;border-radius:8px;cursor:pointer;">حفظ</button>
      </div>
    </div>
  `;
  modal.style.display = 'block';
  document.getElementById('close-modal-btn').onclick = () => { modal.style.display = 'none'; };
  document.getElementById('save-edit-btn').onclick = async () => {
    const notes = document.getElementById('edit-notes').value;
    const dateVal = document.getElementById('edit-date').value;
    if (inv.docId) {
      const docRef = doc(db, 'invoices', inv.docId);
      await updateDoc(docRef, { notes, date: dateVal ? new Date(dateVal) : inv.date });
      modal.style.display = 'none';
      fetchIndividualInvoices();
    } else {
      alert('تعذر العثور على الفاتورة الأصلية');
    }
  };
}

async function deleteIndividualInvoice(inv) {
  if (!inv || !inv.docId) {
    console.error('Individual invoice delete attempted without a valid document id:', inv);
    if (typeof window.showNotification === 'function') {
      window.showNotification('تعذر العثور على الفاتورة الأصلية', 'error');
    } else {
      alert('تعذر العثور على الفاتورة الأصلية');
    }
    return;
  }

  try {
    await deleteDoc(doc(db, 'invoices', inv.docId));
    if (typeof window.showNotification === 'function') {
      window.showNotification('تم حذف الفاتورة الفردية بنجاح', 'success');
    }
    await fetchIndividualInvoices();
  } catch (error) {
    console.error('Failed to delete individual invoice:', error);
    if (typeof window.showNotification === 'function') {
      window.showNotification('حدث خطأ أثناء حذف الفاتورة الفردية', 'error');
    } else {
      alert('حدث خطأ أثناء حذف الفاتورة الفردية');
    }
  }
}

function confirmDeleteInvoice(inv) {
  const modal = document.getElementById('unsubscribed-invoice-modal');
  modal.innerHTML = `
    <div class="modal-bg" style="position:fixed;top:0;right:0;left:0;bottom:0;background:rgba(0,0,0,0.18);z-index:1000;display:flex;align-items:center;justify-content:center;">
      <div class="modal-box" style="background:#fff;border-radius:16px;box-shadow:0 6px 32px #90caf988;padding:32px 18px 18px 18px;min-width:320px;max-width:420px;position:relative;">
        <button id="close-modal-btn" style="position:absolute;left:18px;top:18px;background:transparent;border:none;font-size:22px;color:#1976d2;cursor:pointer;">&#10006;</button>
        <h2 style="color:#f44336;text-align:center;font-weight:bold;margin-bottom:18px;">تأكيد الحذف</h2>
        <div style="margin-bottom:18px;">هل أنت متأكد أنك تريد حذف هذه الفاتورة نهائيًا؟</div>
        <button id="delete-confirm-btn" style="background:#f44336;color:#fff;padding:8px 24px;border:none;border-radius:8px;cursor:pointer;">حذف</button>
      </div>
    </div>
  `;
  modal.style.display = 'block';
  document.getElementById('close-modal-btn').onclick = () => { modal.style.display = 'none'; };
  document.getElementById('delete-confirm-btn').onclick = async () => {
    modal.style.display = 'none';
    await deleteIndividualInvoice(inv);
  };
}

// Notify html/daily_closing.html about updates
async function notifyDailyClosing() {
  const event = new CustomEvent('unsubscribedInvoicesUpdated');
  window.dispatchEvent(event);
}

// Call notifyDailyClosing after adding or updating invoices
async function addInvoice(data) {
  await addDoc(collection(db, 'invoices'), data);
  notifyDailyClosing();
}

async function updateInvoice(id, data) {
  await updateDoc(doc(db, 'invoices', id), data);
  notifyDailyClosing();
}

// البحث
function filterInvoices() {
  const typeEl = document.getElementById('filter-type');
  const gradeEl = document.getElementById('filter-grade');
  const monthEl = document.getElementById('filter-month');
  const itemEl = document.getElementById('search-item');
  const recipientEl = document.getElementById('filter-recipient');
  const typeVal = typeEl ? typeEl.value : '';
  const gradeVal = gradeEl ? gradeEl.value : '';
  const monthVal = monthEl ? monthEl.value : '';
  const itemVal = itemEl ? itemEl.value.trim() : '';
  const recipientVal = recipientEl ? recipientEl.value.trim() : '';
  filteredInvoices = allInvoices.filter(inv => {
    const matchType = !typeVal || inv.type === typeVal;
    const matchGrade = !gradeVal || (inv.grade === gradeVal);
    // monthVal: yyyy-MM
    let matchMonth = true;
    if (monthVal && inv.date && inv.date !== '-') {
      const d = new Date(inv.date);
      const m = d.getMonth() + 1, y = d.getFullYear();
      const [yy, mm] = monthVal.split('-');
      matchMonth = (+yy === y && +mm === m);
    }
    const itemMatch = !itemVal || (inv.items && inv.items.some(x => x.name.includes(itemVal)));
    const filterRecipient = recipientVal ? recipientVal : null;
    if (filterRecipient && inv.recipient !== filterRecipient) return false;
    return matchType && matchGrade && matchMonth && itemMatch;
  });
  renderTable();
}

const searchItemInput = document.getElementById('search-item');
if (searchItemInput) searchItemInput.addEventListener('input', filterInvoices);
const exportBtn = document.getElementById('export-btn');
if (exportBtn) exportBtn.addEventListener('click', () => {
  let csv = 'رقم الفاتورة,نوع الفاتورة,العناصر,السعر الإجمالي,التاريخ,ملاحظات\n';
  filteredInvoices.forEach(inv => {
    const invoiceNum = inv.individualInvoiceNumber ? String(inv.individualInvoiceNumber).padStart(4, '0') : String(inv.num).padStart(4, '0');
    csv += `${invoiceNum},${inv.type},"${inv.items.map(x => x.name).join('، ')}",${inv.total},${inv.date},${inv.notes}\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'فواتير_فردية.csv';
  a.click();
  URL.revokeObjectURL(url);
});

// حفظ فاتورة فردية جديدة
async function saveIndividualInvoice(invoice) {
  await fetchCurrentRecipient(); // تأكد من جلب اسم المستلم
  await fetchNextIndividualInvoiceNumber(); // جلب رقم الفاتورة التالي
  await addDoc(collection(db, 'invoices'), {
    subType: invoice.type,
    items: invoice.items,
    notes: invoice.notes || '',
    date: invoice.date ? invoice.date : new Date(),
    grade: invoice.grade || '-',
    studyType: invoice.studyType || '-',
    recipient: currentRecipient || '-',
    individualInvoiceNumber: nextIndividualInvoiceNumber
  });
  await fetchIndividualInvoices();
}

// تحديث تلقائي للفواتير الفردية عند الحفظ من الكاشير
window.addEventListener('storage', (e) => {
  if (e.key === 'invoice_saved') {
    fetchIndividualInvoices();
  }
});

// بدء التنفيذ
fetchIndividualInvoices();

// مثال للاستخدام:
// saveIndividualInvoice({type: 'ملازم فردية', items: [...], notes: '...', date: new Date()});
['filter-type', 'filter-grade', 'filter-month', 'search-item', 'filter-recipient'].forEach(id => {
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

