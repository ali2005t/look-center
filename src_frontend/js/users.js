import { db, firebaseConfig } from "./firebase.js";
import {
  collection,
  addDoc,
  getDocs,
  updateDoc,
  doc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, createUserWithEmailAndPassword, deleteUser, signInWithEmailAndPassword, signOut as firebaseSignOut, updatePassword } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

const secondaryApp = getApps().find(existingApp => existingApp.name === 'user-creation') || initializeApp(firebaseConfig, 'user-creation');
const userCreationAuth = getAuth(secondaryApp);

// صفحات النظام المتاحة للصلاحيات
const allPages = [
  { key: 'dashboard', label: 'لوحة التحكم', file: 'dashboard.html' },
  { key: 'cashier', label: 'الكاشير', file: 'cashier.html' },
  { key: 'daily_closing', label: 'التقفيل اليومي', file: 'daily_closing.html' },
  { key: 'invoices', label: 'الطلاب المشتركين', file: 'invoices.html' },
  { key: 'unsubscribed', label: 'فواتير فردية', file: 'unsubscribed_students.html' },
  { key: 'subscriptions', label: 'الاشتراكات والأسعار', file: 'subscriptions.html' },
  { key: 'users', label: 'إدارة المستخدمين', file: 'users.html' },
  { key: 'reports', label: 'التقارير', file: 'reports.html' },
  { key: 'expenses', label: 'المصروفات', file: 'expenses.html' },
  { key: 'settings', label: 'الإعدادات', file: 'settings.html' },
  { key: 'help', label: 'دليل المساعدة', file: 'help.html' }
];

// صلاحيات العمليات الإضافية
const operationPermissions = [
  { key: 'delete_invoice', label: '🗑️ حذف الفواتير', category: 'عمليات' },
  { key: 'create_subscriber_invoice', label: '➕ إنشاء فواتير الطلاب المشتركين', category: 'عمليات' },
  { key: 'edit_invoice', label: '✏️ تعديل الفواتير', category: 'عمليات' },
  { key: 'approve_subscription', label: '✅ الموافقة على الاشتراكات', category: 'عمليات' }
];

// إضافة مستخدم جديد
const EMAIL_DOMAIN = "@lookcenter.com";

const addUserForm = document.getElementById("add-user-form");
const usernameInput = document.getElementById("username");
const generatedEmailInput = document.getElementById("generated-email");

if (usernameInput && generatedEmailInput) {
  usernameInput.addEventListener("input", () => {
    const username = usernameInput.value.trim();
    generatedEmailInput.value = username ? (username + EMAIL_DOMAIN) : '';
  });
}

addUserForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const currentUser = getAuth().currentUser;
  const currentUserDocs = currentUser ? await getDocs(collection(db, "users")) : { docs: [] };
  const currentUserRecord = currentUserDocs.docs.find(userDoc => userDoc.data().email === currentUser.email)?.data();
  if (!currentUserRecord || currentUserRecord.type !== 'مدير') {
    window.showNotification("إنشاء المستخدمين متاح للمدير فقط", 'error');
    return;
  }
  const fullname = document.getElementById("user-fullname").value;
  const username = usernameInput.value.trim();
  const email = generatedEmailInput.value;
  const password = document.getElementById("user-password").value;
  const type = document.getElementById("user-type").value;
  let permissions = [];

  // جمع صلاحيات الصفحات
  const permsInputs = document.querySelectorAll('.perm-checkbox');
  if (permsInputs.length) {
    permissions = Array.from(permsInputs).filter(x => x.checked).map(x => x.value);
  } else if (type === 'مدير') {
    permissions = allPages.map(p => p.key);
  } else if (type === 'كاشير') {
    permissions = ['cashier', 'invoices', 'unsubscribed'];
  }

  // جمع صلاحيات العمليات
  const operationInputs = document.querySelectorAll('.operation-checkbox');
  if (operationInputs.length) {
    const operationPerms = Array.from(operationInputs).filter(x => x.checked).map(x => x.value);
    permissions = [...permissions, ...operationPerms];
  } else if (type === 'مدير') {
    // المدير يحصل على كل الصلاحيات
    permissions = [...permissions, ...operationPermissions.map(p => p.key)];
  }

  if (!fullname || !username || !password || !type) return window.showNotification("يرجى ملء كل الحقول", 'error');
  try {
    // إنشاء المستخدم في Authentication
    await createUserWithEmailAndPassword(userCreationAuth, email, password);
    await firebaseSignOut(userCreationAuth);
  } catch (err) {
    if (err.code === 'auth/email-already-in-use') {
      window.showNotification('هذا البريد مستخدم بالفعل في النظام', 'error');
      return;
    } else {
      window.showNotification('حدث خطأ أثناء إنشاء المستخدم: ' + err.message, 'error');
      return;
    }
  }
  await addDoc(collection(db, "users"), {
    fullname,
    username,
    email,
    password,
    type,
    permissions,
    active: true
  });
  window.showNotification("تمت إضافة المستخدم", 'success');
  loadUsers();
});

// تحميل المستخدمين
async function loadUsers() {
  const tbody = document.querySelector("#users-table tbody");
  tbody.innerHTML = "";
  const snapshot = await getDocs(collection(db, "users"));
  snapshot.forEach((docSnap) => {
    const user = docSnap.data();
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="padding:14px;">${user.fullname}</td>
      <td style="padding:14px;">${user.username}</td>
      <td style="padding:14px;">${user.type}</td>
      <td style="padding:14px;">
        <span style="color:${user.active ? '#43a047' : '#f44336'};font-weight:bold;">
          ${user.active ? '✓ مفعل' : '✗ معطل'}
        </span>
      </td>
      <td style="padding:14px;display:flex;gap:12px;justify-content:center;align-items:center;">
        <label class="toggle-switch" style="margin:0;">
          <input type="checkbox" class="toggle-user-checkbox" data-id="${docSnap.id}" ${user.active ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
        <button class="edit-user" data-id="${docSnap.id}" style="background:#1976d2;color:#fff;padding:8px 16px;border:none;border-radius:8px;cursor:pointer;font-weight:bold;transition:all 0.3s;">تعديل</button>
        <button class="change-pass" data-id="${docSnap.id}" style="background:#ffb300;color:#fff;padding:8px 16px;border:none;border-radius:8px;cursor:pointer;font-weight:bold;transition:all 0.3s;">كلمة السر</button>
        <button class="delete-user" data-id="${docSnap.id}" style="background:#e53935;color:#fff;padding:8px 16px;border:none;border-radius:8px;cursor:pointer;font-weight:bold;transition:all 0.3s;">حذف</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // تفعيل/تعطيل المستخدم بـ Toggle
  document.querySelectorAll('.toggle-user-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', async () => {
      const id = checkbox.getAttribute('data-id');
      const snapshot = await getDocs(collection(db, "users"));
      let userDoc;
      snapshot.forEach(docSnap => { if (docSnap.id === id) userDoc = docSnap; });
      if (!userDoc) return;

      checkbox.disabled = true;
      try {
        await updateDoc(doc(db, "users", id), { active: checkbox.checked });
        window.showNotification(`تم ${checkbox.checked ? 'تفعيل ✓' : 'تعطيل ✗'} المستخدم بنجاح`, 'success');
        loadUsers();
      } catch (e) {
        checkbox.checked = !checkbox.checked; // عكس الحالة عند الخطأ
        window.showNotification('حدث خطأ في تغيير الحالة', 'error');
      }
      checkbox.disabled = false;
    });
  });

  // تعديل بيانات المستخدم
  document.querySelectorAll('.edit-user').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-id');
      const snapshot = await getDocs(collection(db, "users"));
      let userDoc;
      snapshot.forEach(docSnap => { if (docSnap.id === id) userDoc = docSnap; });
      if (!userDoc) return;
      const user = userDoc.data();
      const modal = document.createElement('div');
      modal.style = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#0003;z-index:3000;display:flex;align-items:center;justify-content:center;overflow-y:auto;';

      // واجهة اختيار صفحات الصلاحية بـ Toggle Switches
      let permsHtml = '<div style="margin-bottom:15px;padding-bottom:15px;border-bottom:1px solid #e0e0e0;"><h4 style="margin:0 0 10px 0;color:#1976d2;">صفحات النظام:</h4>';
      allPages.forEach(p => {
        permsHtml += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding:8px;background:#f5f9ff;border-radius:6px;">
          <span style="flex:1;">${p.label}</span>
          <label class="toggle-switch">
            <input type="checkbox" class="perm-checkbox" value="${p.key}" ${user.permissions && user.permissions.includes(p.key) ? 'checked' : ''} />
            <span class="toggle-slider"></span>
          </label>
        </div>`;
      });
      permsHtml += '</div>';

      // صلاحيات العمليات بـ Toggle Switches
      let operPermsHtml = '<div style="margin-bottom:15px;"><h4 style="margin:0 0 10px 0;color:#ff9800;">صلاحيات العمليات:</h4>';
      operationPermissions.forEach(p => {
        operPermsHtml += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding:8px;background:#fff8e1;border-radius:6px;">
          <span style="flex:1;">${p.label}</span>
          <label class="toggle-switch">
            <input type="checkbox" class="operation-checkbox" value="${p.key}" ${user.permissions && user.permissions.includes(p.key) ? 'checked' : ''} />
            <span class="toggle-slider"></span>
          </label>
        </div>`;
      });
      operPermsHtml += '</div>';

      modal.innerHTML = `
        <div style="background:#fff;padding:28px 22px;border-radius:12px;min-width:400px;max-width:600px;max-height:90vh;overflow-y:auto;box-shadow:0 4px 32px #90caf988;">
          <h3 style='margin-bottom:18px;'>تعديل بيانات المستخدم</h3>
          <input id='edit-fullname' value='${user.fullname}' placeholder="الاسم الكامل" style='width:100%;margin-bottom:10px;padding:8px;border-radius:6px;border:1px solid #cde4ff;box-sizing:border-box;'>
          <input id='edit-username' value='${user.username}' placeholder="اسم المستخدم" style='width:100%;margin-bottom:10px;padding:8px;border-radius:6px;border:1px solid #cde4ff;box-sizing:border-box;'>
          <select id='edit-type' style='width:100%;margin-bottom:15px;padding:8px;border-radius:6px;border:1px solid #cde4ff;box-sizing:border-box;'>
            <option value='مدير' ${user.type === 'مدير' ? 'selected' : ''}>مدير</option>
            <option value='كاشير' ${user.type === 'كاشير' ? 'selected' : ''}>كاشير</option>
          </select>
          ${permsHtml}
          ${operPermsHtml}
          <div style='display:flex;gap:10px;justify-content:flex-end;'>
            <button id='save-edit-user' style='background:#1976d2;color:#fff;padding:8px 22px;border:none;border-radius:7px;cursor:pointer;'>حفظ</button>
            <button id='cancel-edit-user' style='background:#eee;color:#333;padding:8px 22px;border:none;border-radius:7px;cursor:pointer;'>إلغاء</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      document.getElementById('cancel-edit-user').onclick = () => modal.remove();
      document.getElementById('save-edit-user').onclick = async () => {
        const newFullname = document.getElementById('edit-fullname').value;
        const newUsername = document.getElementById('edit-username').value;
        const newType = document.getElementById('edit-type').value;
        const pagePerms = Array.from(document.querySelectorAll('.perm-checkbox')).filter(x => x.checked).map(x => x.value);
        const operPerms = Array.from(document.querySelectorAll('.operation-checkbox')).filter(x => x.checked).map(x => x.value);
        const newPerms = [...pagePerms, ...operPerms];
        if (!newFullname || !newUsername || !newType) return window.showNotification('يرجى ملء كل الحقول', 'error');
        await updateDoc(doc(db, "users", id), {
          fullname: newFullname,
          username: newUsername,
          type: newType,
          permissions: newPerms
        });
        window.showNotification('تم حفظ التعديلات بنجاح', 'success');
        modal.remove();
        loadUsers();
      };
    };
  });
  // تغيير كلمة السر
  document.querySelectorAll('.change-pass').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-id');
      const modal = document.createElement('div');
      modal.style = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#0003;z-index:3000;display:flex;align-items:center;justify-content:center;';
      modal.innerHTML = `
        <div style="background:#fff;padding:28px 22px;border-radius:12px;min-width:320px;max-width:90vw;box-shadow:0 4px 32px #90caf988;">
          <h3 style='margin-bottom:18px;'>تغيير كلمة السر</h3>
          <p style='margin:-8px 0 14px;color:#666;font-size:13px;'>للتغيير المباشر يجب إدخال كلمة السر الحالية. لإعادة ضبطها بدون القديمة استخدم Firebase Console.</p>
          <input id='current-password' type='password' placeholder='كلمة السر الحالية' autocomplete='current-password' style='width:100%;margin-bottom:10px;padding:8px;border-radius:6px;border:1px solid #cde4ff;'>
          <input id='edit-password' type='password' placeholder='كلمة السر الجديدة' style='width:100%;margin-bottom:10px;padding:8px;border-radius:6px;border:1px solid #cde4ff;'>
          <div style='display:flex;gap:10px;justify-content:flex-end;'>
            <button id='save-edit-pass' style='background:#1976d2;color:#fff;padding:8px 22px;border:none;border-radius:7px;cursor:pointer;'>حفظ</button>
            <button id='cancel-edit-pass' style='background:#eee;color:#333;padding:8px 22px;border:none;border-radius:7px;cursor:pointer;'>إلغاء</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      document.getElementById('cancel-edit-pass').onclick = () => modal.remove();
      document.getElementById('save-edit-pass').onclick = async () => {
        const currentPass = document.getElementById('current-password').value;
        const newPass = document.getElementById('edit-password').value;
        if (!currentPass) return window.showNotification('يرجى إدخال كلمة السر الحالية', 'error');
        if (!newPass) return window.showNotification('يرجى إدخال كلمة السر الجديدة', 'error');
        if (newPass.length < 6) return window.showNotification('كلمة السر يجب أن تكون 6 أحرف على الأقل', 'error');
        try {
          const snapshot = await getDocs(collection(db, "users"));
          const userDoc = snapshot.docs.find(docSnap => docSnap.id === id);
          const user = userDoc?.data();
          if (!user?.email) throw new Error('بيانات الحساب القديمة غير مكتملة');

          const credential = await signInWithEmailAndPassword(userCreationAuth, user.email, currentPass);
          await updatePassword(credential.user, newPass);
          await firebaseSignOut(userCreationAuth);
          await updateDoc(doc(db, "users", id), { password: newPass });
          window.showNotification('تم تغيير كلمة السر بنجاح', 'success');
          modal.remove();
          loadUsers();
        } catch (error) {
          await firebaseSignOut(userCreationAuth).catch(() => {});
          const message = error.code === 'auth/invalid-credential'
            ? 'كلمة السر الحالية غير صحيحة. لإعادة ضبطها استخدم Firebase Console.'
            : 'تعذر تغيير كلمة السر. تحقق من بيانات الحساب وحاول مرة أخرى.';
          window.showNotification(message, 'error');
        }
      };
    };
  });
  // حذف مستخدم
  document.querySelectorAll('.delete-user').forEach(btn => {
    btn.onclick = async () => {
      // نافذة تأكيد مخصصة مثل الاشتراكات
      const confirmModal = document.createElement('div');
      confirmModal.style = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#0003;z-index:4000;display:flex;align-items:center;justify-content:center;';
      confirmModal.innerHTML = `
        <div style="background:#fff;padding:30px 24px;border-radius:14px;min-width:320px;max-width:90vw;box-shadow:0 4px 32px #90caf988;text-align:center;">
          <div style="font-size:1.2em;font-weight:bold;margin-bottom:18px;color:#e53935;">تأكيد حذف المستخدم</div>
          <div style="margin-bottom:22px;">هل أنت متأكد أنك تريد حذف هذا المستخدم نهائيًا؟</div>
          <div style="display:flex;gap:16px;justify-content:center;">
            <button id="confirm-delete-user" style="background:#e53935;color:#fff;padding:8px 28px;border:none;border-radius:8px;font-size:1em;font-weight:bold;cursor:pointer;">حذف</button>
            <button id="cancel-delete-user" style="background:#eee;color:#333;padding:8px 28px;border:none;border-radius:8px;font-size:1em;cursor:pointer;">إلغاء</button>
          </div>
        </div>
      `;
      document.body.appendChild(confirmModal);
      document.getElementById('cancel-delete-user').onclick = () => confirmModal.remove();
      document.getElementById('confirm-delete-user').onclick = async () => {
        const id = btn.getAttribute('data-id');
        // جلب بيانات المستخدم
        const snapshot = await getDocs(collection(db, "users"));
        let userDoc;
        snapshot.forEach(docSnap => { if (docSnap.id === id) userDoc = docSnap; });
        if (!userDoc) return;
        const user = userDoc.data();
        // حذف من Firestore
        await deleteDoc(doc(db, "users", id));
        // حذف من Firebase Authentication (بشرط معرفة كلمة المرور)
        try {
          const auth = getAuth();
          await signInWithEmailAndPassword(auth, user.email, user.password);
          if (auth.currentUser) {
            await deleteUser(auth.currentUser);
          }
        } catch (err) {
          // إذا فشل الحذف تجاهل الخطأ
        }
        confirmModal.remove();
        window.showNotification('<span style="font-size:1.15em;font-weight:bold;">تم حذف المستخدم بنجاح</span>', 'success', 2500);
        loadUsers();
      };
    };
  });
}

// دالة توليد عناصر القائمة الجانبية حسب الصلاحيات
export function renderSidebar(permissions) {
  const sidebar = document.querySelector('.sidebar ul');
  if (!sidebar) return;
  sidebar.innerHTML = '';
  allPages.forEach(page => {
    if (permissions.includes(page.key)) {
      const li = document.createElement('li');
      li.setAttribute('data-link', page.file);
      li.innerHTML = `<a href="${page.file}">${page.label}</a>`;
      sidebar.appendChild(li);
    }
  });
}

export { allPages };

window.addEventListener("DOMContentLoaded", loadUsers);

// استيراد notifications.js تلقائياً إذا لم يكن موجوداً
if (!window.showNotification) {
  const script = document.createElement('script');
  script.src = 'js/notifications.js';
  document.head.appendChild(script);
}

