import { auth, db } from "./firebase.js";
import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  deleteDoc,
  doc,
  updateDoc,
  runTransaction,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let subscriptionRecords = [];

function updateLinkedParentOptions(select, grade, selectedName = '', excludedId = '') {
  if (!select) return;
  const parentSubscriptions = subscriptionRecords.filter(subscription =>
    subscription.type === 'ملازم'
    && (!grade || subscription.grade === grade)
    && subscription.id !== excludedId
  );
  select.innerHTML = '<option value="">-- اختر الاشتراك الأب --</option>';
  parentSubscriptions.forEach(subscription => {
    const option = document.createElement('option');
    option.value = subscription.name;
    option.textContent = subscription.name;
    select.appendChild(option);
  });
  select.value = selectedName || '';
}

function updateAddLinkedParentField() {
  const type = document.getElementById('type');
  const grade = document.getElementById('grade');
  const group = document.getElementById('linked-subscription-group');
  const select = document.getElementById('linked-subscription');
  const orderGroup = document.getElementById('booklet-order-field');
  const orderInput = document.getElementById('booklet-order');
  const isIndividualNote = type?.value === 'ملازم فردية';
  if (group) group.style.display = isIndividualNote ? '' : 'none';
  if (orderGroup) orderGroup.hidden = !isIndividualNote;
  if (orderInput) orderInput.required = isIndividualNote;
  if (select) {
    select.required = isIndividualNote;
    updateLinkedParentOptions(select, grade?.value || '', select.value);
  }
}

// Notify html/daily_closing.html about updates
async function notifyDailyClosing() {
  const event = new CustomEvent('subscriptionsUpdated');
  window.dispatchEvent(event);
}

function appendInventoryCell(row, value, className = '') {
  const cell = document.createElement('td');
  cell.textContent = String(value);
  if (className) cell.className = className;
  row.appendChild(cell);
}

function formatInventoryDate(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ar-EG', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

async function renderInventoryReport(records) {
  const summary = document.getElementById('inventory-summary-cards');
  const gradeBody = document.getElementById('inventory-grade-report');
  const movementsBody = document.getElementById('inventory-movements-report');
  if (!summary || !gradeBody || !movementsBody) return;

  const gradeStats = new Map();
  const bookletRecords = records.filter(record =>
    record.type === 'ملازم' || record.type === 'ملازم فردية'
  );
  records.forEach(record => {
    const grade = String(record.grade || 'غير محدد').trim() || 'غير محدد';
    const stats = gradeStats.get(grade) || {
      courseSubscriptions: 0,
      bookletSubscriptions: 0,
      individualBooklets: 0,
      bookletCopies: 0
    };
    if (record.type === 'كورسات') stats.courseSubscriptions += 1;
    if (record.type === 'ملازم') stats.bookletSubscriptions += 1;
    if (record.type === 'ملازم فردية') stats.individualBooklets += 1;
    if (record.type === 'ملازم' || record.type === 'ملازم فردية') {
      stats.bookletCopies += Number(record.stock) || 0;
    }
    gradeStats.set(grade, stats);
  });

  const totals = [...gradeStats.values()].reduce((result, stats) => ({
    courseSubscriptions: result.courseSubscriptions + stats.courseSubscriptions,
    bookletSubscriptions: result.bookletSubscriptions + stats.bookletSubscriptions,
    individualBooklets: result.individualBooklets + stats.individualBooklets,
    bookletCopies: result.bookletCopies + stats.bookletCopies
  }), {
    courseSubscriptions: 0,
    bookletSubscriptions: 0,
    individualBooklets: 0,
    bookletCopies: 0
  });
  const totalSubscriptions = totals.courseSubscriptions + totals.bookletSubscriptions;
  const cards = [
    { label: 'إجمالي الاشتراكات', value: totalSubscriptions, icon: 'fa-layer-group' },
    { label: 'اشتراكات الكورسات', value: totals.courseSubscriptions, icon: 'fa-book-open' },
    { label: 'اشتراكات الملازم', value: totals.bookletSubscriptions, icon: 'fa-book-bookmark' },
    { label: 'عناوين الملازم', value: bookletRecords.length, icon: 'fa-book' },
    { label: 'نسخ الملازم بالمخزون', value: totals.bookletCopies, icon: 'fa-boxes-stacked' }
  ];
  summary.replaceChildren();
  cards.forEach(card => {
    const item = document.createElement('article');
    item.className = 'inventory-summary-card';
    const icon = document.createElement('i');
    icon.className = `fas ${card.icon}`;
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = card.label;
    const value = document.createElement('strong');
    value.textContent = String(card.value);
    item.append(icon, label, value);
    summary.appendChild(item);
  });

  gradeBody.replaceChildren();
  const grades = [...gradeStats.keys()].sort((first, second) =>
    first.localeCompare(second, 'ar', { numeric: true, sensitivity: 'base' })
  );
  if (grades.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.textContent = 'لا توجد بيانات اشتراكات أو ملازم حتى الآن.';
    row.appendChild(cell);
    gradeBody.appendChild(row);
  } else {
    grades.forEach(grade => {
      const stats = gradeStats.get(grade);
      const row = document.createElement('tr');
      appendInventoryCell(row, grade);
      appendInventoryCell(row, stats.courseSubscriptions);
      appendInventoryCell(row, stats.bookletSubscriptions);
      appendInventoryCell(row, stats.individualBooklets);
      appendInventoryCell(row, stats.courseSubscriptions + stats.bookletSubscriptions);
      appendInventoryCell(row, stats.bookletCopies, stats.bookletCopies < 0 ? 'inventory-negative' : '');
      gradeBody.appendChild(row);
    });
  }

  movementsBody.replaceChildren();
  try {
    const movementSnapshot = await getDocs(collection(db, 'stockMovements'));
    const movements = movementSnapshot.docs
      .map(movementDoc => movementDoc.data())
      .filter(movement => ['booklet_stock_in', 'booklet_created', 'booklet_adjustment'].includes(movement.type))
      .sort((first, second) => {
        const firstDate = first.recordedAt?.toDate?.()?.getTime() || 0;
        const secondDate = second.recordedAt?.toDate?.()?.getTime() || 0;
        return secondDate - firstDate;
      })
      .slice(0, 50);

    if (movements.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 7;
      cell.textContent = 'لا توجد إضافات مخزون مسجلة بعد.';
      row.appendChild(cell);
      movementsBody.appendChild(row);
      return;
    }

    movements.forEach(movement => {
      const row = document.createElement('tr');
      appendInventoryCell(row, formatInventoryDate(movement.recordedAt));
      appendInventoryCell(row, movement.grade || '—');
      appendInventoryCell(row, movement.subscriptionName || '—');
      const movementLabels = {
        booklet_stock_in: 'إضافة مخزون',
        booklet_created: 'إضافة ملزمة جديدة',
        booklet_adjustment: 'تسوية مخزون'
      };
      appendInventoryCell(row, movementLabels[movement.type] || 'حركة مخزون');
      const quantity = Number(movement.quantity) || 0;
      appendInventoryCell(row, quantity > 0 ? `+${quantity}` : String(quantity));
      appendInventoryCell(row, Number(movement.stockAfter) || 0);
      appendInventoryCell(row, movement.recordedBy || '—');
      movementsBody.appendChild(row);
    });
  } catch (error) {
    console.error('تعذر تحميل سجل إضافات المخزون:', error);
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 7;
    cell.textContent = 'تعذر تحميل سجل المخزون. تحقق من الاتصال ثم حدّث التقرير.';
    row.appendChild(cell);
    movementsBody.appendChild(row);
  }
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
  const sortOrder = Number(document.getElementById("booklet-order")?.value);
  const isBooklet = type === 'ملازم' || type === 'ملازم فردية';
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
    published: false,
    ...(isBooklet ? { stock } : {}),
    ...(onlineCardsCount > 0 ? { onlineCardsCount } : {})
  };
  // إذا كان نوع الاشتراك "ملزمة فردية" وبه اشتراك مرتبط، أضفه
  if (type === "ملازم فردية" && !linkedSub) {
    window.showNotification('اختر الاشتراك الأب المرتبط بهذه الملزمة', 'error');
    return;
  }
  if (type === "ملازم فردية") {
    if (!Number.isInteger(sortOrder) || sortOrder < 1) {
      window.showNotification('أدخل ترتيبًا صحيحًا للملزمة يبدأ من 1', 'error');
      return;
    }
    subData.linkedSubscription = linkedSub;
    subData.sortOrder = sortOrder;
  }
  if (['ملازم', 'ملازم فردية'].includes(type) && stock < 0) {
    window.showNotification('مخزون الملزمة الجديدة لا يمكن أن يكون سالبًا.', 'error');
    return;
  }

  try {
    const subscriptionRef = doc(collection(db, 'subscriptions'));
    const movementRef = isBooklet ? doc(collection(db, 'stockMovements')) : null;
    const recordedAt = Timestamp.now();
    const currentUser = auth.currentUser;
    const recordedBy = String(
      localStorage.getItem('currentUsername') ||
      localStorage.getItem('currentUserName') ||
      currentUser?.email ||
      'مستخدم'
    );
    await runTransaction(db, transaction => {
      transaction.set(subscriptionRef, subData);
      if (movementRef) {
        transaction.set(movementRef, {
          type: 'booklet_created',
          subscriptionId: subscriptionRef.id,
          subscriptionName: name,
          grade,
          quantity: stock,
          stockBefore: 0,
          stockAfter: stock,
          recordedAt,
          recordedBy,
          recordedByUid: currentUser?.uid || ''
        });
      }
    });
  } catch (error) {
    console.error('تعذر تسجيل الاشتراك أو المخزون الأولي:', error);
    window.showNotification('تعذر إضافة الاشتراك. تحقق من الاتصال ثم حاول مرة أخرى.', 'error');
    return;
  }

  window.showNotification('تمت الإضافة بنجاح', 'success');
  loadSubscriptions();
});

// تحميل الاشتراكات
async function loadSubscriptions() {
  const tbody = document.getElementById("subscriptions-table-body");
  tbody.innerHTML = "";
  const snapshot = await getDocs(collection(db, "subscriptions"));
  subscriptionRecords = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
  await renderInventoryReport(subscriptionRecords);
  subscriptionRecords.sort((first, second) =>
    String(first.name || '').localeCompare(String(second.name || ''), 'ar', { numeric: true, sensitivity: 'base' })
  );
  if (document.getElementById('type')?.value === 'ملازم فردية') {
    updateAddLinkedParentField();
  }
  const typeFilter = document.getElementById('subscription-type-filter')?.value || '';
  let visibleSubscriptions = typeFilter
    ? subscriptionRecords.filter(subscription => subscription.type === typeFilter)
    : subscriptionRecords;
  const normalizeName = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  const parentNotes = subscriptionRecords.filter(subscription => subscription.type === 'ملازم');
  const linkedNotesForParent = parent => subscriptionRecords.filter(subscription =>
    subscription.type === 'ملازم فردية'
    && normalizeName(subscription.linkedSubscription) === normalizeName(parent.name)
    && subscription.grade === parent.grade
  ).sort((first, second) =>
    (Number(first.sortOrder) || Number.MAX_SAFE_INTEGER) - (Number(second.sortOrder) || Number.MAX_SAFE_INTEGER)
    || String(first.name || '').localeCompare(String(second.name || ''), 'ar', { numeric: true, sensitivity: 'base' })
  );
  const individualNoteGroups = new Map();
  const lectureGroups = new Map();
  if (!typeFilter) {
    subscriptionRecords.filter(subscription => subscription.type === 'ملازم فردية').forEach(note => {
      const group = individualNoteGroups.get(note.grade) || [];
      group.push(note);
      individualNoteGroups.set(note.grade, group);
    });
    individualNoteGroups.forEach(notes => notes.sort((first, second) =>
    String(first.linkedSubscription || '').localeCompare(String(second.linkedSubscription || ''), 'ar', { numeric: true, sensitivity: 'base' })
    || (Number(first.sortOrder) || Number.MAX_SAFE_INTEGER) - (Number(second.sortOrder) || Number.MAX_SAFE_INTEGER)
    || String(first.name || '').localeCompare(String(second.name || ''), 'ar', { numeric: true, sensitivity: 'base' })
    ));
    subscriptionRecords.filter(subscription => subscription.type === 'محاضرات فردية').forEach(lecture => {
      const group = lectureGroups.get(lecture.grade) || [];
      group.push(lecture);
      lectureGroups.set(lecture.grade, group);
    });
    visibleSubscriptions = visibleSubscriptions.filter(subscription =>
      subscription.type !== 'ملازم فردية'
      && subscription.type !== 'محاضرات فردية'
    );
  }
  let rows = [];
  visibleSubscriptions.forEach((sub) => {
    const tr = document.createElement("tr");
    tr.setAttribute('data-id', sub.id);
    const linkedNotes = sub.type === 'ملازم' ? linkedNotesForParent(sub) : [];
    const contentsCell = linkedNotes.length
        ? `<details class="subscription-contents"><summary>ملازم تابعة (${linkedNotes.length})</summary><ul>${linkedNotes.map(note => `<li><strong>${Number(note.sortOrder) || '—'}.</strong> ${note.name} <small>${note.price} ج · متبقي ${note.stock || 0}</small></li>`).join('')}</ul></details>`
      : '-';
    tr.innerHTML = `
      <td class="drag-handle" title="اسحب لترتيب الصف">☰</td>
      <td>${sub.name}</td>
      <td>${sub.type}</td>
      <td>${sub.linkedSubscription || '-'}</td>
      <td>${sub.grade}</td>
      <td>${sub.price} ج</td>
      <td>${['ملازم', 'ملازم فردية'].includes(sub.type) ? (sub.stock || 0) : '—'}</td>
      <td style="text-align:center;">${sub.onlineCardsCount > 0 ? `<span style="background:#e3f2fd;color:#1976d2;font-weight:bold;padding:2px 10px;border-radius:8px;">🃏 ${sub.onlineCardsCount}</span>` : '<span style="color:#bbb;">—</span>'}</td>
      <td>
        <label class="toggle-switch">
          <input type="checkbox" class="toggle-publish-checkbox" data-id="${sub.id}" ${sub.published === true ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td>${contentsCell}</td>
        <td><button onclick="editSubscription('${sub.id}')" style="background:#1976d2;color:#fff;border:none;border-radius:6px;padding:4px 14px;font-weight:bold;cursor:pointer;">تعديل</button></td>
        <td><button onclick="deleteSubscription('${sub.id}')" style="background:#e53935;color:#fff;border:none;border-radius:6px;padding:4px 14px;font-weight:bold;cursor:pointer;">حذف</button></td>
    `;
    rows.push(tr);
  });
  if (!typeFilter) {
    const grades = [...new Set([...individualNoteGroups.keys(), ...lectureGroups.keys()])]
      .sort((first, second) => String(first).localeCompare(String(second), 'ar', { numeric: true, sensitivity: 'base' }));
    grades.forEach(grade => {
      const notes = individualNoteGroups.get(grade) || [];
      const lectures = lectureGroups.get(grade) || [];
      const groupRow = document.createElement('tr');
      groupRow.className = 'lecture-group-row';
      groupRow.innerHTML = `<td colspan="12"><div class="grade-content-groups">
        ${notes.length ? `<details class="subscription-contents"><summary>ملازم فردية · ${grade} (${notes.length})</summary><ul>${notes.map(note => `<li><strong>${Number(note.sortOrder) || '—'}.</strong> ${note.name} <small>${note.linkedSubscription ? `تابعة لـ ${note.linkedSubscription} · ` : ''}${note.price} ج · متبقي ${note.stock || 0}</small></li>`).join('')}</ul></details>` : ''}
        ${lectures.length ? `<details class="subscription-contents"><summary>محاضرات فردية · ${grade} (${lectures.length})</summary><ul>${lectures.map(lecture => `<li>${lecture.name} <small>${lecture.price} ج</small></li>`).join('')}</ul></details>` : ''}
      </div></td>`;
      rows.push(groupRow);
    });
  }
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
  loadOnlineCards();
}

// تحسين منطق التعديل ليظهر نافذة منبثقة لتعديل الاشتراك
window.editSubscription = async (id) => {
  const snapshot = await getDocs(collection(db, "subscriptions"));
  subscriptionRecords = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
  let subDoc;
  snapshot.forEach(docSnap => {
    if (docSnap.id === id) subDoc = docSnap;
  });
  if (!subDoc) return alert("لم يتم العثور على الاشتراك!");
  const sub = subDoc.data();
  const linkedParentOptions = subscriptionRecords
    .filter(subscription => subscription.type === 'ملازم' && subscription.grade === sub.grade && subscription.id !== id)
    .map(subscription => `<option value="${subscription.name}" ${sub.linkedSubscription === subscription.name ? 'selected' : ''}>${subscription.name}</option>`)
    .join('');
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

      ${sub.type === 'ملازم فردية' ? `<label style='display:block;margin-bottom:4px;font-weight:bold;color:#1976d2;'>الاشتراك الأب المرتبطة به</label>
      <select id='edit-linked-subscription' style='width:100%;margin-bottom:12px;padding:8px;border-radius:6px;border:1px solid #cde4ff;box-sizing:border-box;'>
        <option value="">-- اختر الاشتراك الأب --</option>
        ${linkedParentOptions}
      </select>
      <label for='edit-sort-order' style='display:block;margin-bottom:4px;font-weight:bold;color:#1976d2;'>ترتيب الملزمة داخل الاشتراك</label>
      <input id='edit-sort-order' type='number' min='1' step='1' value='${Number.isInteger(Number(sub.sortOrder)) && Number(sub.sortOrder) > 0 ? Number(sub.sortOrder) : ''}' placeholder='مثال: 1' style='width:100%;margin-bottom:12px;padding:8px;border-radius:6px;border:1px solid #cde4ff;box-sizing:border-box;'>` : ''}

      <label style='display:block;margin-bottom:4px;font-weight:bold;color:#1976d2;'>💰 السعر (بالجنيه)</label>
      <input id='edit-price' type='number' value='${sub.price}' style='width:100%;margin-bottom:12px;padding:8px;border-radius:6px;border:1px solid #cde4ff;box-sizing:border-box;'>

      ${['ملازم', 'ملازم فردية'].includes(sub.type) ? `<div id="edit-booklet-stock-group">
        <label style='display:block;margin-bottom:4px;font-weight:bold;color:#1976d2;'>📦 مخزون الملزمة <small style="color:#888;font-weight:normal;">(يمكن تصفيره)</small></label>
        <input id='edit-stock' type='number' min='0' step='1' value='${sub.stock || 0}' style='width:100%;margin-bottom:8px;padding:8px;border-radius:6px;border:1px solid #cde4ff;box-sizing:border-box;'>
        <button id="zero-booklet-stock" type="button" style="margin-bottom:12px;background:#fff3e0;color:#a84b00;border:1px solid #f2c078;border-radius:7px;padding:7px 12px;font-weight:bold;cursor:pointer;">تصفير مخزون الملزمة</button>
      </div>` : ''}

      <label style='display:block;margin-bottom:4px;font-weight:bold;color:#1976d2;'>🃏 عدد كروت الأونلاين المرتبطة <small style="color:#888;font-weight:normal;">(0 = لا يوجد)</small></label>
      <input id='edit-online-cards' type='number' value='${sub.onlineCardsCount || 0}' min='0' style='width:100%;margin-bottom:16px;padding:8px;border-radius:6px;border:1px solid #cde4ff;box-sizing:border-box;'>

      <div style='display:flex;gap:10px;justify-content:flex-end;'>
        <button id='save-edit-sub' style='background:#1976d2;color:#fff;padding:8px 22px;border:none;border-radius:7px;cursor:pointer;'>حفظ</button>
        <button id='cancel-edit-sub' style='background:#eee;color:#333;padding:8px 22px;border:none;border-radius:7px;cursor:pointer;'>إلغاء</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const editGradeField = document.getElementById('edit-grade');
  const editParentSelect = document.getElementById('edit-linked-subscription');
  editGradeField?.addEventListener('change', () => {
    updateLinkedParentOptions(editParentSelect, editGradeField.value, '', id);
  });
  document.getElementById('cancel-edit-sub').onclick = () => modal.remove();
  document.getElementById('zero-booklet-stock')?.addEventListener('click', () => {
    if (!window.confirm('هل تريد تصفير مخزون هذه الملزمة؟ سيتم تسجيل الحركة في سجل المخزون.')) return;
    const stockInput = document.getElementById('edit-stock');
    stockInput.value = '0';
    document.getElementById('save-edit-sub').click();
  });
  document.getElementById('save-edit-sub').onclick = async () => {
    const newName = document.getElementById('edit-name').value;
    const newType = document.getElementById('edit-type').value;
    const newGrade = document.getElementById('edit-grade').value;
    const newPrice = parseFloat(document.getElementById('edit-price').value);
    const newStock = parseInt(document.getElementById('edit-stock')?.value ?? sub.stock ?? 0) || 0;
    const newOnlineCards = parseInt(document.getElementById('edit-online-cards').value) || 0;
    const newLinkedSubscription = document.getElementById('edit-linked-subscription')?.value || '';
    const newSortOrder = Number(document.getElementById('edit-sort-order')?.value);
    if (!newName || !newType || !newGrade || !newPrice) {
      window.showNotification('يرجى ملء كل الحقول', 'error');
      return;
    }
    if (newType === 'ملازم فردية' && !newLinkedSubscription) {
      window.showNotification('اختر الاشتراك الأب المرتبط بالملزمة', 'error');
      return;
    }
    if (newType === 'ملازم فردية' && (!Number.isInteger(newSortOrder) || newSortOrder < 1)) {
      window.showNotification('أدخل ترتيبًا صحيحًا للملزمة يبدأ من 1', 'error');
      return;
    }
    try {
      const subscriptionRef = doc(db, 'subscriptions', id);
      const movementRef = doc(collection(db, 'stockMovements'));
      const currentUser = auth.currentUser;
      const recordedBy = String(
        localStorage.getItem('currentUsername') ||
        localStorage.getItem('currentUserName') ||
        currentUser?.email ||
        'مستخدم'
      );
      const recordedAt = Timestamp.now();
      await runTransaction(db, async transaction => {
        const currentSnapshot = await transaction.get(subscriptionRef);
        if (!currentSnapshot.exists()) throw new Error('الاشتراك غير موجود');
        const currentStock = Number(currentSnapshot.data().stock) || 0;
        const updatedSubscription = {
          name: newName,
          type: newType,
          grade: newGrade,
          price: newPrice,
          onlineCardsCount: newOnlineCards,
          linkedSubscription: newType === 'ملازم فردية' ? newLinkedSubscription : '',
          sortOrder: newType === 'ملازم فردية' ? newSortOrder : null
        };
        if (['ملازم', 'ملازم فردية'].includes(newType)) updatedSubscription.stock = newStock;
        transaction.update(subscriptionRef, updatedSubscription);

        if (['ملازم', 'ملازم فردية'].includes(newType) && currentStock !== newStock) {
          transaction.set(movementRef, {
            type: 'booklet_adjustment',
            subscriptionId: id,
            subscriptionName: newName,
            grade: newGrade,
            quantity: newStock - currentStock,
            stockBefore: currentStock,
            stockAfter: newStock,
            recordedAt,
            recordedBy,
            recordedByUid: currentUser?.uid || ''
          });
        }
      });
    } catch (error) {
      console.error('تعذر حفظ تعديل الاشتراك والمخزون:', error);
      window.showNotification('تعذر حفظ التعديلات. تحقق من الاتصال ثم حاول مرة أخرى.', 'error');
      return;
    }
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

async function renderCardLinkedSubscriptions(container, selectedIds = []) {
  if (!container) return;
  const snapshot = await getDocs(collection(db, 'subscriptions'));
  const eligible = snapshot.docs
    .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
    .filter(subscription => ['كورسات', 'ملازم', 'اشتراك كورسات', 'اشتراك ملازم'].includes(subscription.type))
    .sort((first, second) => String(first.grade || '').localeCompare(String(second.grade || ''), 'ar', { numeric: true })
      || String(first.name || '').localeCompare(String(second.name || ''), 'ar', { numeric: true }));
  container.replaceChildren();
  if (!eligible.length) {
    const empty = document.createElement('p');
    empty.className = 'card-subscriptions-empty';
    empty.textContent = 'أضف اشتراك كورسات أو ملازم أولاً لربط الكارت به.';
    container.appendChild(empty);
    return;
  }
  eligible.forEach(subscription => {
    const label = document.createElement('label');
    label.className = 'card-subscription-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = subscription.id;
    checkbox.checked = selectedIds.includes(subscription.id);
    checkbox.dataset.subscriptionName = subscription.name || '';
    const text = document.createElement('span');
    text.textContent = `${subscription.name || 'اشتراك'} · ${subscription.grade || 'بدون فرقة'} · ${subscription.type}`;
    label.append(checkbox, text);
    container.appendChild(label);
  });
}

function selectedCardSubscriptionIds(container) {
  return [...(container?.querySelectorAll('input[type="checkbox"]:checked') || [])].map(input => input.value);
}

function selectedIndividualCardTypes(scope) {
  return [...scope.querySelectorAll('input[name="card-individual-type"]:checked')].map(input => input.value);
}

function updateCardTypeFields(typeSelect, scope) {
  const isSubscriptionCard = typeSelect?.value === 'للاشتراكات';
  const linkedGroup = scope.querySelector('.card-linked-subscriptions-group');
  const individualGroup = scope.querySelector('#card-individual-types-group, .card-individual-types-group');
  const perSubField = scope.querySelector('#card-per-sub-field, .card-per-sub-field');
  const priceField = scope.querySelector('#card-price-field, .card-price-field');
  if (linkedGroup && linkedGroup.id !== 'card-individual-types-group') linkedGroup.hidden = !isSubscriptionCard;
  if (individualGroup) individualGroup.hidden = isSubscriptionCard;
  if (perSubField) perSubField.hidden = !isSubscriptionCard;
  if (priceField) priceField.hidden = isSubscriptionCard;
  const priceInput = priceField?.querySelector('input');
  if (priceInput) priceInput.disabled = isSubscriptionCard;
}

// تحميل كروت الأونلاين
async function loadOnlineCards() {
  const tbody = document.getElementById('online-cards-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  const snap = await getDocs(collection(db, 'onlineCards'));
  const linkedSubscriptionNames = new Map(subscriptionRecords.map(subscription => [subscription.id, `${subscription.name || ''} (${subscription.grade || ''})`]));
  let totalStock = 0;
  snap.forEach(docSnap => {
    const c = docSnap.data();
    const stock = Number(c.stock) || 0;
    totalStock += stock;
    const linkedIds = Array.isArray(c.linkedSubscriptionIds) ? c.linkedSubscriptionIds : [];
    const linkedNames = linkedIds.map(id => linkedSubscriptionNames.get(id)).filter(Boolean);
    const individualSubTypes = Array.isArray(c.individualSubTypes) ? c.individualSubTypes : [];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.name}</td>
      <td><span style="background:${c.type === 'للاشتراكات' ? '#e3f2fd' : '#e8f5e9'};color:${c.type === 'للاشتراكات' ? '#1976d2' : '#2e7d32'};padding:2px 10px;border-radius:8px;font-size:.92em;">${c.type || 'للاشتراكات'}</span></td>
      <td>${c.type === 'للاشتراكات'
        ? (linkedNames.length ? linkedNames.join('، ') : linkedIds.length ? 'الاشتراك المرتبط غير موجود' : 'كل الاشتراكات (كارت قديم)')
        : (individualSubTypes.length ? individualSubTypes.join('، ') : 'المحاضرات والملازم الفردية (كارت قديم)')}</td>
      <td style="text-align:center;font-weight:bold;color:#1976d2;">${c.perSub || 1}</td>
      <td style="text-align:center;">${c.price || 0} ج</td>
      <td style="text-align:center;font-weight:bold;"><span class="online-card-stock-value ${stock <= 0 ? 'is-empty' : ''}">${stock}</span></td>
      <td><button onclick="editOnlineCard('${docSnap.id}')" style="background:#1976d2;color:#fff;border:none;border-radius:6px;padding:4px 14px;font-weight:bold;cursor:pointer;">تعديل</button></td>
      <td><button onclick="deleteOnlineCard('${docSnap.id}')" style="background:#e53935;color:#fff;border:none;border-radius:6px;padding:4px 14px;font-weight:bold;cursor:pointer;">حذف</button></td>
    `;
    tbody.appendChild(tr);
  });
  const summary = document.getElementById('online-card-stock-summary');
  if (summary) summary.textContent = `إجمالي الكروت المتوفرة: ${totalStock.toLocaleString('ar-EG')} · عدد الأنواع: ${snap.size.toLocaleString('ar-EG')}`;
}

// إضافة كرت جديد
const addCardForm = document.getElementById('add-online-card-form');
if (addCardForm) {
  const addCardType = document.getElementById('card-type');
  const linkedContainer = document.getElementById('card-linked-subscriptions');
  addCardType?.addEventListener('change', () => updateCardTypeFields(addCardType, addCardForm));
  if (addCardType) updateCardTypeFields(addCardType, addCardForm);
  renderCardLinkedSubscriptions(linkedContainer);
  addCardForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('card-name').value.trim();
    const type = document.getElementById('card-type')?.value || 'للاشتراكات';
    const perSub = Math.max(1, parseInt(document.getElementById('card-per-sub').value) || 1);
    const price = Number(document.getElementById('card-price').value) || 0;
    const stock = Math.max(0, parseInt(document.getElementById('card-stock').value) || 0);
    const linkedSubscriptionIds = selectedCardSubscriptionIds(linkedContainer);
    const individualSubTypes = selectedIndividualCardTypes(addCardForm);
    if (!name) return window.showNotification('أدخل اسم الكرت', 'error');
    if (type === 'للاشتراكات' && !linkedSubscriptionIds.length) {
      return window.showNotification('اختر اشتراكًا واحدًا على الأقل لربط الكارت به', 'error');
    }
    if (type === 'فردي' && !individualSubTypes.length) {
      return window.showNotification('اختر المحاضرات الفردية أو الملازم الفردية التي يظهر معها الكارت', 'error');
    }
    if (type === 'فردي' && price <= 0) {
      return window.showNotification('أدخل سعرًا أكبر من صفر للكارت الفردي', 'error');
    }
    try {
      await addDoc(collection(db, 'onlineCards'), {
        name, type, perSub, price, stock,
        linkedSubscriptionIds: type === 'للاشتراكات' ? linkedSubscriptionIds : [],
        individualSubTypes: type === 'فردي' ? individualSubTypes : []
      });
      window.showNotification('تمت إضافة الكارت بنجاح ✔', 'success');
      addCardForm.reset();
      updateCardTypeFields(addCardType, addCardForm);
      await renderCardLinkedSubscriptions(linkedContainer);
      await loadOnlineCards();
    } catch (error) {
      console.error('تعذر إضافة كارت الأونلاين:', error);
      window.showNotification('تعذر إضافة الكارت. تحقق من الاتصال ثم حاول مرة أخرى.', 'error');
    }
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
    <div style="background:#fff;padding:28px 22px;border-radius:12px;min-width:340px;max-width:90vw;max-height:90vh;overflow:auto;box-shadow:0 4px 32px #90caf988;">
      <h3 style="margin-bottom:18px;color:#1976d2;">✏️ تعديل الكرت</h3>
      <label style="display:block;margin-bottom:4px;font-weight:bold;color:#1976d2;">📝 اسم الكرت</label>
      <input id="ec-name" value="${c.name}" style="width:100%;margin-bottom:12px;padding:8px;border-radius:6px;border:1px solid #cde4ff;box-sizing:border-box;">
      <label style="display:block;margin-bottom:4px;font-weight:bold;color:#1976d2;">📂 نوع الكرت</label>
      <select id="ec-type" style="width:100%;margin-bottom:12px;padding:8px;border-radius:6px;border:1px solid #cde4ff;box-sizing:border-box;">
        <option value="للاشتراكات" ${c.type === 'للاشتراكات' ? 'selected' : ''}>للاشتراكات</option>
        <option value="فردي" ${c.type === 'فردي' ? 'selected' : ''}>فردي</option>
      </select>
      <fieldset class="card-linked-subscriptions-group" style="margin:0 0 12px;padding:10px;border:1px solid #d8e6f4;border-radius:8px;">
        <legend>الاشتراكات المرتبطة <small>يمكن اختيار أكثر من اشتراك</small></legend>
        <div id="ec-linked-subscriptions" class="card-linked-subscriptions"></div>
      </fieldset>
      <fieldset class="card-individual-types-group" style="margin:0 0 12px;padding:10px;border:1px solid #d8e6f4;border-radius:8px;">
        <legend>يظهر الكارت مع</legend>
        <div class="card-individual-types">
          <label class="card-subscription-option"><input type="checkbox" name="card-individual-type" value="محاضرات فردية" /> محاضرات فردية</label>
          <label class="card-subscription-option"><input type="checkbox" name="card-individual-type" value="ملازم فردية" /> ملازم فردية</label>
        </div>
      </fieldset>
      <div class="card-price-field">
        <label style="display:block;margin-bottom:4px;font-weight:bold;color:#1976d2;">💰 سعر الكارت الفردي (يظهر في الفاتورة)</label>
        <input id="ec-price" type="number" min="0.01" step="0.01" value="${c.price || 0}" style="width:100%;margin-bottom:12px;padding:8px;border-radius:6px;border:1px solid #cde4ff;box-sizing:border-box;">
      </div>
      <label style="display:block;margin-bottom:4px;font-weight:bold;color:#1976d2;">📦 المخزون</label>
      <input id="ec-stock" type="number" value="${c.stock || 0}" style="width:100%;margin-bottom:12px;padding:8px;border-radius:6px;border:1px solid #cde4ff;box-sizing:border-box;">
      <div class="card-per-sub-field">
        <label style="display:block;margin-bottom:4px;font-weight:bold;color:#1976d2;">🔢 كروت/اشتراك</label>
        <input id="ec-per" type="number" value="${c.perSub || 1}" min="1" style="width:100%;margin-bottom:16px;padding:8px;border-radius:6px;border:1px solid #cde4ff;box-sizing:border-box;">
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="ec-save" style="background:#1976d2;color:#fff;padding:8px 22px;border:none;border-radius:7px;cursor:pointer;">حفظ</button>
        <button id="ec-cancel" style="background:#eee;color:#333;padding:8px 22px;border:none;border-radius:7px;cursor:pointer;">إلغاء</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const editType = document.getElementById('ec-type');
  const linkedContainer = document.getElementById('ec-linked-subscriptions');
  await renderCardLinkedSubscriptions(linkedContainer, Array.isArray(c.linkedSubscriptionIds) ? c.linkedSubscriptionIds : []);
  const savedIndividualSubTypes = Array.isArray(c.individualSubTypes)
    ? c.individualSubTypes
    : ['محاضرات فردية', 'ملازم فردية'];
  modal.querySelectorAll('input[name="card-individual-type"]').forEach(input => {
    input.checked = savedIndividualSubTypes.includes(input.value);
  });
  editType.addEventListener('change', () => updateCardTypeFields(editType, modal));
  updateCardTypeFields(editType, modal);
  document.getElementById('ec-cancel').onclick = () => modal.remove();
  document.getElementById('ec-save').onclick = async () => {
    const newName = document.getElementById('ec-name').value.trim();
    const newType = editType.value;
    const newPrice = Number(document.getElementById('ec-price').value) || 0;
    const newStock = Math.max(0, parseInt(document.getElementById('ec-stock').value) || 0);
    const newPer = Math.max(1, parseInt(document.getElementById('ec-per').value) || 1);
    const linkedSubscriptionIds = selectedCardSubscriptionIds(linkedContainer);
    const individualSubTypes = selectedIndividualCardTypes(modal);
    if (!newName) return window.showNotification('أدخل اسم الكرت', 'error');
    if (newType === 'للاشتراكات' && !linkedSubscriptionIds.length) {
      return window.showNotification('اختر اشتراكًا واحدًا على الأقل لربط الكارت به', 'error');
    }
    if (newType === 'فردي' && !individualSubTypes.length) {
      return window.showNotification('اختر المحاضرات الفردية أو الملازم الفردية التي يظهر معها الكارت', 'error');
    }
    if (newType === 'فردي' && newPrice <= 0) {
      return window.showNotification('أدخل سعرًا أكبر من صفر للكارت الفردي', 'error');
    }
    try {
      await updateDoc(doc(db, 'onlineCards', id), {
        name: newName,
        type: newType,
        price: newPrice,
        stock: newStock,
        perSub: newPer,
        linkedSubscriptionIds: newType === 'للاشتراكات' ? linkedSubscriptionIds : [],
        individualSubTypes: newType === 'فردي' ? individualSubTypes : []
      });
      modal.remove();
      window.showNotification('تم الحفظ بنجاح ✔', 'success');
      await loadOnlineCards();
    } catch (error) {
      console.error('تعذر حفظ بيانات كارت الأونلاين:', error);
      window.showNotification('تعذر حفظ بيانات الكارت. حاول مرة أخرى.', 'error');
    }
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
  const addType = document.getElementById('type');
  const addGrade = document.getElementById('grade');
  const typeFilter = document.getElementById('subscription-type-filter');
  const refreshInventoryReport = document.getElementById('refresh-inventory-report');
  addType?.addEventListener('change', updateAddLinkedParentField);
  addGrade?.addEventListener('change', updateAddLinkedParentField);
  typeFilter?.addEventListener('change', loadSubscriptions);
  refreshInventoryReport?.addEventListener('click', loadSubscriptions);
  const addStockField = document.getElementById('booklet-stock-field');
  const updateBookletStockField = () => {
    const isBooklet = ['ملازم', 'ملازم فردية'].includes(addType?.value || '');
    if (addStockField) addStockField.hidden = !isBooklet;
  };
  addType?.addEventListener('change', updateBookletStockField);
  updateBookletStockField();
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
