import { db } from "./firebase.js";
import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  deleteDoc,
  doc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Notify html/daily_closing.html about updates
async function notifyDailyClosing() {
  const event = new CustomEvent('subscriptionsUpdated');
  window.dispatchEvent(event);
}

// Call notifyDailyClosing after adding or updating subscriptions
async function addSubscription(data) {
  await addDoc(collection(db, 'subscriptions'), data);
  notifyDailyClosing();
}

async function updateSubscription(id, data) {
  await updateDoc(doc(db, 'subscriptions', id), data);
  notifyDailyClosing();
}

// إضافة اشتراك جديد
document.getElementById("add-subscription-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("name").value;
  const type = document.getElementById("type").value;
  const grade = document.getElementById("grade").value;
  const price = parseFloat(document.getElementById("price").value);
  const stock = parseInt(document.getElementById("stock").value) || 0;
  const onlineCardsCount = parseInt(document.getElementById("online-cards-count")?.value) || 0;
  const linkedSub = document.getElementById("linked-subscription")?.value || "";

  if (!name || !type || !grade || !price) {
    window.showNotification('يرجى ملء كل الحقول الأساسية', 'error');
    return;
  }

  const subData = {
    name,
    type,
    grade,
    price,
    stock,
    ...(onlineCardsCount > 0 ? { onlineCardsCount } : {})
  };
  // إذا كان نوع الاشتراك "ملزمة فردية" وبه اشتراك مرتبط، أضفه
  if (type === "ملازم فردية" && linkedSub) {
    subData.linkedSubscription = linkedSub;
  }
  await addDoc(collection(db, "subscriptions"), subData);

  window.showNotification('تمت الإضافة بنجاح', 'success');
  loadSubscriptions();
});

// تحميل الاشتراكات
async function loadSubscriptions() {
  const tbody = document.getElementById("subscriptions-table-body");
  tbody.innerHTML = "";
  const snapshot = await getDocs(collection(db, "subscriptions"));
  let rows = [];
  snapshot.forEach((docSnap) => {
    const sub = docSnap.data();
    const tr = document.createElement("tr");
    tr.setAttribute('data-id', docSnap.id);
    tr.innerHTML = `
      <td class="drag-handle" title="اسحب لترتيب الصف">☰</td>
      <td>${sub.name}</td>
      <td>${sub.type}</td>
      <td>${sub.grade}</td>
      <td>${sub.price} ج</td>
      <td>${sub.stock || 0}</td>
      <td style="text-align:center;">${sub.onlineCardsCount > 0 ? `<span style="background:#e3f2fd;color:#1976d2;font-weight:bold;padding:2px 10px;border-radius:8px;">🃏 ${sub.onlineCardsCount}</span>` : '<span style="color:#bbb;">—</span>'}</td>
      <td>
        <label class="toggle-switch">
          <input type="checkbox" class="toggle-publish-checkbox" data-id="${docSnap.id}" ${sub.published ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
      </td>
        <td><button onclick="editSubscription('${docSnap.id}')" style="background:#1976d2;color:#fff;border:none;border-radius:6px;padding:4px 14px;font-weight:bold;cursor:pointer;">تعديل</button></td>
        <td><button onclick="deleteSubscription('${docSnap.id}')" style="background:#e53935;color:#fff;border:none;border-radius:6px;padding:4px 14px;font-weight:bold;cursor:pointer;">حذف</button></td>
    `;
    rows.push(tr);
  });
  rows.forEach(tr => tbody.appendChild(tr));
  // إضافة حدث Toggle النشر/الإخفاء
  tbody.querySelectorAll('.toggle-publish-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', async function () {
      const id = checkbox.getAttribute('data-id');
      const tr = checkbox.closest('tr');
      checkbox.disabled = true;
      try {
        const docRef = doc(db, "subscriptions", id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const isNowPublished = checkbox.checked;
          await updateDoc(docRef, { published: isNowPublished });
          window.showNotification(`تم ${isNowPublished ? 'نشر ✓' : 'إخفاء ✗'} الاشتراك بنجاح`, 'success');
          loadSubscriptions();
        }
      } catch (e) {
        checkbox.checked = !checkbox.checked; // عكس الحالة عند الخطأ
        window.showNotification('حدث خطأ أثناء تغيير الحالة: ' + (e.message || e), 'error');
      }
      checkbox.disabled = false;
    });
  });
  // تفعيل السحب والإفلات
  if (window.Sortable) {
    // إذا كان هناك Sortable سابق، دمره أولاً
    if (tbody._sortableInstance) {
      tbody._sortableInstance.destroy();
    }
    setTimeout(() => {
      tbody._sortableInstance = new window.Sortable(tbody, {
        handle: '.drag-handle',
        animation: 150,
        direction: 'vertical',
        forceFallback: true, // إصلاح مشاكل السحب في بعض المتصفحات
        fallbackOnBody: true,
        swapThreshold: 0.65,
        scroll: true,
        scrollSensitivity: 60,
        scrollSpeed: 20,
        onStart: function (evt) {
          document.body.style.userSelect = 'none';
        },
        onEnd: function (evt) {
          document.body.style.userSelect = '';
          const ids = Array.from(tbody.querySelectorAll('tr')).map(tr => tr.getAttribute('data-id'));
          localStorage.setItem('subscriptionsOrder', JSON.stringify(ids));
          window.showNotification('تم تغيير ترتيب الصفوف (محلياً فقط)', 'info');
        }
      });
    }, 0);
  }
}

// تحسين منطق التعديل ليظهر نافذة منبثقة لتعديل الاشتراك
window.editSubscription = async (id) => {
  const snapshot = await getDocs(collection(db, "subscriptions"));
  let subDoc;
  snapshot.forEach(docSnap => {
    if (docSnap.id === id) subDoc = docSnap;
  });
  if (!subDoc) return alert("لم يتم العثور على الاشتراك!");
  const sub = subDoc.data();
  // نافذة منبثقة بسيطة
  const modal = document.createElement('div');
  modal.style = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#0002;z-index:3000;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:#fff;padding:28px 22px;border-radius:12px;min-width:340px;max-width:90vw;box-shadow:0 4px 32px #90caf988;">
      <h3 style='margin-bottom:18px;color:#1976d2;'>✏️ تعديل الاشتراك</h3>

      <label style='display:block;margin-bottom:4px;font-weight:bold;color:#1976d2;'>📝 اسم الاشتراك</label>
      <input id='edit-name' value='${sub.name}' style='width:100%;margin-bottom:12px;padding:8px;border-radius:6px;border:1px solid #cde4ff;box-sizing:border-box;'>

      <label style='display:block;margin-bottom:4px;font-weight:bold;color:#1976d2;'>📂 نوع الاشتراك</label>
      <input id='edit-type' value='${sub.type}' style='width:100%;margin-bottom:12px;padding:8px;border-radius:6px;border:1px solid #cde4ff;box-sizing:border-box;'>

      <label style='display:block;margin-bottom:4px;font-weight:bold;color:#1976d2;'>🎓 الفرقة الدراسية</label>
      <input id='edit-grade' value='${sub.grade}' style='width:100%;margin-bottom:12px;padding:8px;border-radius:6px;border:1px solid #cde4ff;box-sizing:border-box;'>

      <label style='display:block;margin-bottom:4px;font-weight:bold;color:#1976d2;'>💰 السعر (بالجنيه)</label>
      <input id='edit-price' type='number' value='${sub.price}' style='width:100%;margin-bottom:12px;padding:8px;border-radius:6px;border:1px solid #cde4ff;box-sizing:border-box;'>

      <label style='display:block;margin-bottom:4px;font-weight:bold;color:#1976d2;'>📦 المخزون المتوفر <small style="color:#888;font-weight:normal;">(عدد النسخ)</small></label>
      <input id='edit-stock' type='number' value='${sub.stock || 0}' style='width:100%;margin-bottom:12px;padding:8px;border-radius:6px;border:1px solid #cde4ff;box-sizing:border-box;'>

      <label style='display:block;margin-bottom:4px;font-weight:bold;color:#1976d2;'>🃏 عدد كروت الأونلاين المرتبطة <small style="color:#888;font-weight:normal;">(0 = لا يوجد)</small></label>
      <input id='edit-online-cards' type='number' value='${sub.onlineCardsCount || 0}' min='0' style='width:100%;margin-bottom:16px;padding:8px;border-radius:6px;border:1px solid #cde4ff;box-sizing:border-box;'>

      <div style='display:flex;gap:10px;justify-content:flex-end;'>
        <button id='save-edit-sub' style='background:#1976d2;color:#fff;padding:8px 22px;border:none;border-radius:7px;cursor:pointer;'>حفظ</button>
        <button id='cancel-edit-sub' style='background:#eee;color:#333;padding:8px 22px;border:none;border-radius:7px;cursor:pointer;'>إلغاء</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('cancel-edit-sub').onclick = () => modal.remove();
  document.getElementById('save-edit-sub').onclick = async () => {
    const newName = document.getElementById('edit-name').value;
    const newType = document.getElementById('edit-type').value;
    const newGrade = document.getElementById('edit-grade').value;
    const newPrice = parseFloat(document.getElementById('edit-price').value);
    const newStock = parseInt(document.getElementById('edit-stock').value) || 0;
    const newOnlineCards = parseInt(document.getElementById('edit-online-cards').value) || 0;
    if (!newName || !newType || !newGrade || !newPrice) {
      window.showNotification('يرجى ملء كل الحقول', 'error');
      return;
    }
    await updateDoc(doc(db, 'subscriptions', id), {
      name: newName,
      type: newType,
      grade: newGrade,
      price: newPrice,
      stock: newStock,
      onlineCardsCount: newOnlineCards
    });
    modal.remove();
    window.showNotification('تم حفظ التعديلات بنجاح', 'success');
    loadSubscriptions();
  };
};

window.deleteSubscription = async (id) => {
  if (!id) return window.showNotification('لم يتم تحديد الاشتراك للحذف', 'error');
  // إشعار تأكيد قبل الحذف
  const confirmModal = document.createElement('div');
  confirmModal.style = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#0003;z-index:4000;display:flex;align-items:center;justify-content:center;';
  confirmModal.innerHTML = `
    <div style="background:#fff;padding:30px 24px;border-radius:14px;min-width:320px;max-width:90vw;box-shadow:0 4px 32px #90caf988;text-align:center;">
      <div style="font-size:1.2em;font-weight:bold;margin-bottom:18px;color:#e53935;">تأكيد حذف الاشتراك</div>
      <div style="margin-bottom:22px;">هل أنت متأكد أنك تريد حذف هذا الاشتراك نهائيًا؟</div>
      <div style="display:flex;gap:16px;justify-content:center;">
        <button id="confirm-delete-sub" style="background:#e53935;color:#fff;padding:8px 28px;border:none;border-radius:8px;font-size:1em;font-weight:bold;cursor:pointer;">حذف</button>
        <button id="cancel-delete-sub" style="background:#eee;color:#333;padding:8px 28px;border:none;border-radius:8px;font-size:1em;cursor:pointer;">إلغاء</button>
      </div>
    </div>
  `;
  document.body.appendChild(confirmModal);
  document.getElementById('cancel-delete-sub').onclick = () => confirmModal.remove();
  document.getElementById('confirm-delete-sub').onclick = async () => {
    try {
      await deleteDoc(doc(db, "subscriptions", id));
      window.showNotification('<span style="font-size:1.15em;font-weight:bold;">تم حذف الاشتراك بنجاح</span>', 'success', 2500);
      loadSubscriptions();
    } catch (e) {
      window.showNotification('<span style="font-size:1.15em;font-weight:bold;">حدث خطأ أثناء الحذف: ' + (e.message || e) + '</span>', 'error', 3500);
    }
    confirmModal.remove();
  };
};

// ===== منطق كروت الأونلاين =====

// جلب الاشتراكات لتعبئة dropdown الاشتراك المرتبط
async function populateLinkedSubDropdown(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const snap = await getDocs(collection(db, 'subscriptions'));
  const names = new Set();
  snap.forEach(d => {
    const data = d.data();
    if (data.name) names.add(data.name);
  });
  sel.innerHTML = '<option value="">-- اختر اشتراك --</option>';
  names.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });
}

// (card-type and linkedSub removed - cards apply to all subscriptions)

// تحميل كروت الأونلاين
async function loadOnlineCards() {
  const tbody = document.getElementById('online-cards-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  const snap = await getDocs(collection(db, 'onlineCards'));
  snap.forEach(docSnap => {
    const c = docSnap.data();
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.name}</td>
      <td><span style="background:${c.type === 'للاشتراكات' ? '#e3f2fd' : '#e8f5e9'};color:${c.type === 'للاشتراكات' ? '#1976d2' : '#2e7d32'};padding:2px 10px;border-radius:8px;font-size:.92em;">${c.type || 'للاشتراكات'}</span></td>
      <td style="text-align:center;font-weight:bold;color:#1976d2;">${c.perSub || 1}</td>
      <td style="text-align:center;">${c.price || 0} ج</td>
      <td style="text-align:center;font-weight:bold;">${c.stock || 0}</td>
      <td><button onclick="editOnlineCard('${docSnap.id}')" style="background:#1976d2;color:#fff;border:none;border-radius:6px;padding:4px 14px;font-weight:bold;cursor:pointer;">تعديل</button></td>
      <td><button onclick="deleteOnlineCard('${docSnap.id}')" style="background:#e53935;color:#fff;border:none;border-radius:6px;padding:4px 14px;font-weight:bold;cursor:pointer;">حذف</button></td>
    `;
    tbody.appendChild(tr);
  });
}

// إضافة كرت جديد
const addCardForm = document.getElementById('add-online-card-form');
if (addCardForm) {
  addCardForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('card-name').value.trim();
    const type = document.getElementById('card-type')?.value || 'للاشتراكات';
    const perSub = parseInt(document.getElementById('card-per-sub').value) || 1;
    const price = parseInt(document.getElementById('card-price').value) || 0;
    const stock = parseInt(document.getElementById('card-stock').value) || 0;
    if (!name) return window.showNotification('أدخل اسم الكرت', 'error');
    await addDoc(collection(db, 'onlineCards'), { name, type, perSub, price, stock });
    window.showNotification('تمت إضافة الكرت بنجاح ✔', 'success');
    addCardForm.reset();
    loadOnlineCards();
  });
}

// تعديل كرت
window.editOnlineCard = async (id) => {
  const snap = await getDocs(collection(db, 'onlineCards'));
  let cardDoc;
  snap.forEach(d => { if (d.id === id) cardDoc = d; });
  if (!cardDoc) return;
  const c = cardDoc.data();
  const modal = document.createElement('div');
  modal.style = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#0003;z-index:3000;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:#fff;padding:28px 22px;border-radius:12px;min-width:340px;max-width:90vw;box-shadow:0 4px 32px #90caf988;">
      <h3 style="margin-bottom:18px;color:#1976d2;">✏️ تعديل الكرت</h3>
      <label style="display:block;margin-bottom:4px;font-weight:bold;color:#1976d2;">📝 اسم الكرت</label>
      <input id="ec-name" value="${c.name}" style="width:100%;margin-bottom:12px;padding:8px;border-radius:6px;border:1px solid #cde4ff;box-sizing:border-box;">
      <label style="display:block;margin-bottom:4px;font-weight:bold;color:#1976d2;">📂 نوع الكرت</label>
      <select id="ec-type" style="width:100%;margin-bottom:12px;padding:8px;border-radius:6px;border:1px solid #cde4ff;box-sizing:border-box;">
        <option value="للاشتراكات" ${c.type === 'للاشتراكات' ? 'selected' : ''}>للاشتراكات</option>
        <option value="فردي" ${c.type === 'فردي' ? 'selected' : ''}>فردي</option>
      </select>
      <label style="display:block;margin-bottom:4px;font-weight:bold;color:#1976d2;">💰 السعر</label>
      <input id="ec-price" type="number" value="${c.price || 0}" style="width:100%;margin-bottom:12px;padding:8px;border-radius:6px;border:1px solid #cde4ff;box-sizing:border-box;">
      <label style="display:block;margin-bottom:4px;font-weight:bold;color:#1976d2;">📦 المخزون</label>
      <input id="ec-stock" type="number" value="${c.stock || 0}" style="width:100%;margin-bottom:12px;padding:8px;border-radius:6px;border:1px solid #cde4ff;box-sizing:border-box;">
      <label style="display:block;margin-bottom:4px;font-weight:bold;color:#1976d2;">🔢 كروت/اشتراك</label>
      <input id="ec-per" type="number" value="${c.perSub || 1}" min="1" style="width:100%;margin-bottom:16px;padding:8px;border-radius:6px;border:1px solid #cde4ff;box-sizing:border-box;">
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="ec-save" style="background:#1976d2;color:#fff;padding:8px 22px;border:none;border-radius:7px;cursor:pointer;">حفظ</button>
        <button id="ec-cancel" style="background:#eee;color:#333;padding:8px 22px;border:none;border-radius:7px;cursor:pointer;">إلغاء</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('ec-cancel').onclick = () => modal.remove();
  document.getElementById('ec-save').onclick = async () => {
    const newName = document.getElementById('ec-name').value;
    const newType = document.getElementById('ec-type').value;
    const newPrice = parseInt(document.getElementById('ec-price').value) || 0;
    const newStock = parseInt(document.getElementById('ec-stock').value) || 0;
    const newPer = parseInt(document.getElementById('ec-per').value) || 1;
    await updateDoc(doc(db, 'onlineCards', id), { name: newName, type: newType, price: newPrice, stock: newStock, perSub: newPer });
    modal.remove();
    window.showNotification('تم الحفظ بنجاح ✔', 'success');
    loadOnlineCards();
  };
};

// حذف كرت
window.deleteOnlineCard = async (id) => {
  if (!confirm('هل تريد حذف هذا الكرت؟')) return;
  await deleteDoc(doc(db, 'onlineCards', id));
  window.showNotification('تم الحذف بنجاح', 'success');
  loadOnlineCards();
};

window.addEventListener('DOMContentLoaded', () => {
  populateLinkedSubDropdown('card-linked-sub');
  loadOnlineCards();
  const order = localStorage.getItem('subscriptionsOrder');
  if (order) {
    const ids = JSON.parse(order);
    const tbody = document.getElementById('subscriptions-table-body');
    if (tbody && ids && ids.length) {
      const trs = Array.from(tbody.querySelectorAll('tr'));
      ids.forEach(id => {
        const tr = trs.find(tr => tr.getAttribute('data-id') === id);
        if (tr) tbody.appendChild(tr);
      });
    }
  }
  loadSubscriptions(); // Ensure subscriptions are loaded after potential reordering
});
