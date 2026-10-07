// js/settings.js
import { auth, db } from "./firebase.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const settingsForm = document.getElementById('settings-form');
const saveSettingsButton = document.getElementById('save-settings-btn');
const MAX_CENTER_LOGO_LENGTH = 700000;
let centerLogoData = null;
let logoProcessingError = null;
let logoProcessingPromise = Promise.resolve();

async function hashVipPassword(password) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function waitForFirebaseUser() {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise(resolve => {
    let unsubscribe = () => {};
    const timeout = setTimeout(() => {
      unsubscribe();
      resolve(auth.currentUser);
    }, 8000);
    unsubscribe = onAuthStateChanged(auth, user => {
      clearTimeout(timeout);
      unsubscribe();
      resolve(user);
    });
  });
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('تعذر قراءة ملف الشعار'));
    reader.readAsDataURL(file);
  });
}

async function compressCenterLogo(source) {
  if (typeof source !== 'string' || !source.startsWith('data:image/')) {
    throw new Error('اختر ملف صورة للشعار حتى يمكن ضغطه');
  }
  const image = new Image();
  image.src = source;
  await image.decode();
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('ملف الشعار غير صالح');

  let scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
  for (let attempt = 0; attempt < 8; attempt++) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.82, 0.68, 0.54]) {
      const webp = canvas.toDataURL('image/webp', quality);
      if (webp.startsWith('data:image/webp') && webp.length <= MAX_CENTER_LOGO_LENGTH) return webp;
    }

    context.fillStyle = '#fff';
    context.globalCompositeOperation = 'destination-over';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const jpeg = canvas.toDataURL('image/jpeg', 0.72);
    if (jpeg.length <= MAX_CENTER_LOGO_LENGTH) return jpeg;
    scale *= 0.78;
  }
  const error = new Error('حجم الشعار كبير جداً بعد الضغط؛ اختر صورة أصغر');
  error.code = 'vip-logo-too-large';
  throw error;
}

document.getElementById('center-logo-input').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) {
    centerLogoData = null;
    logoProcessingError = null;
    document.getElementById('center-logo-status').textContent = 'يتم تصغير الشعار تلقائياً قبل حفظه.';
    return;
  }
  logoProcessingError = null;
  document.getElementById('center-logo-status').textContent = 'جارٍ تجهيز الشعار...';
  logoProcessingPromise = readImageFile(file)
    .then(compressCenterLogo)
    .then(compressedLogo => {
      centerLogoData = compressedLogo;
      document.getElementById('center-logo-status').textContent = `تم تجهيز الشعار (${Math.ceil(compressedLogo.length / 1024)} KB).`;
    })
    .catch(error => {
      centerLogoData = null;
      logoProcessingError = error;
      document.getElementById('center-logo-status').textContent = error.message;
      console.error('تعذر تجهيز الشعار:', error);
    });
});

settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (saveSettingsButton.disabled) return;
  // حفظ الإعدادات (اسم السنتر والشعار والحقول الجديدة)
  const centerName = document.getElementById('center-name-input').value;
  const centerPhone1 = document.getElementById('center-phone-1').value;
  const centerPhone2 = document.getElementById('center-phone-2').value;
  const centerPhone3 = document.getElementById('center-phone-3').value;
  const centerAddress = document.getElementById('center-address').value;
  const vipAssignedTeacher = document.getElementById('vip-assigned-teacher').value.trim();
  const vipAccessPassword = document.getElementById('vip-access-password').value;
  const vipRecoveryPhone = document.getElementById('vip-recovery-phone').value.trim();
  if (vipAccessPassword && vipAccessPassword.length < 4) {
    showNotification('كلمة مرور VIP يجب أن تكون 4 أحرف على الأقل', 'error', 3000);
    return;
  }
  saveSettingsButton.disabled = true;
  saveSettingsButton.textContent = 'جارٍ الحفظ...';
  try {
    const currentUser = await waitForFirebaseUser();
    if (!currentUser) {
      showNotification('جلسة Firebase غير مسجلة. افتح الإعدادات من داخل التطبيق بعد تسجيل الدخول ثم أعد الحفظ.', 'error', 6500);
      return;
    }
    await logoProcessingPromise;
    if (logoProcessingError) throw logoProcessingError;
    let centerLogo = centerLogoData || localStorage.getItem('centerLogo') || '';
    if (centerLogo.length > MAX_CENTER_LOGO_LENGTH) centerLogo = await compressCenterLogo(centerLogo);
    const settingsUpdate = {
      centerName,
      centerLogo,
      centerPhone1,
      centerPhone2,
      centerPhone3,
      centerAddress,
      vipAssignedTeacher,
      vipRecoveryPhone
    };
    if (vipAccessPassword) settingsUpdate.vipPasswordHash = await hashVipPassword(vipAccessPassword);
    await setDoc(doc(db, 'settings', 'main'), { ...settingsUpdate, updatedAt: new Date().toISOString() }, { merge: true });
    // حفظ في localStorage أيضًا
    localStorage.setItem('centerName', centerName);
    localStorage.setItem('centerPhone1', centerPhone1);
    localStorage.setItem('centerPhone2', centerPhone2);
    localStorage.setItem('centerPhone3', centerPhone3);
    localStorage.setItem('centerAddress', centerAddress);
    localStorage.setItem('centerLogo', centerLogo);
    localStorage.setItem('vipAssignedTeacher', vipAssignedTeacher);
    localStorage.setItem('vipRecoveryPhone', vipRecoveryPhone);
    document.getElementById('vip-access-password').value = '';
    document.getElementById('vip-password-status').textContent = vipAccessPassword
      ? 'تم حفظ كلمة مرور VIP الجديدة.'
      : 'تم حفظ إعدادات VIP. كلمة المرور الحالية لم تتغير.';
    showNotification('تم حفظ الإعدادات بنجاح', 'success', 2500);
  } catch (err) {
    console.error('تعذر حفظ الإعدادات في Firestore:', err);
    const message = err.code === 'vip-logo-too-large'
      ? err.message
      : err.code === 'permission-denied'
        ? 'Firebase رفض الحفظ بسبب الصلاحيات. تأكد أن حسابك مسموح له بتعديل الإعدادات.'
        : ['unavailable', 'deadline-exceeded', 'network-request-failed'].includes(err.code)
          ? 'تعذر الاتصال بـ Firebase. تحقق من الإنترنت ثم أعد المحاولة.'
          : 'تعذر حفظ الإعدادات في Firebase. البيانات ما زالت ظاهرة في الحقول ولم تُحفظ.';
    showNotification(message, 'error', 6500);
  } finally {
    saveSettingsButton.disabled = false;
    saveSettingsButton.textContent = 'حفظ الإعدادات';
  }
});

// عند تحميل الصفحة: ملء الحقول بالقيم المحفوظة
window.addEventListener('DOMContentLoaded', async function() {
  // تعبئة اسم السنتر وباقي الحقول
  const name = localStorage.getItem('centerName');
  if(name) document.getElementById('center-name-input').value = name;
  const phone1 = localStorage.getItem('centerPhone1');
  if(phone1) document.getElementById('center-phone-1').value = phone1;
  const phone2 = localStorage.getItem('centerPhone2');
  if(phone2) document.getElementById('center-phone-2').value = phone2;
  const phone3 = localStorage.getItem('centerPhone3');
  if(phone3) document.getElementById('center-phone-3').value = phone3;
  const address = localStorage.getItem('centerAddress');
  if(address) document.getElementById('center-address').value = address;
  try {
    const settingsSnapshot = await getDoc(doc(db, 'settings', 'main'));
    if (settingsSnapshot.exists()) {
      const settings = settingsSnapshot.data();
      const vipAssignedTeacher = settings.vipAssignedTeacher || '';
      const vipRecoveryPhone = settings.vipRecoveryPhone || '';
      document.getElementById('vip-assigned-teacher').value = vipAssignedTeacher;
      document.getElementById('vip-recovery-phone').value = vipRecoveryPhone;
      document.getElementById('vip-password-status').textContent = settings.vipPasswordHash
        ? 'كلمة المرور محفوظة. اكتب كلمة جديدة فقط إذا أردت تغييرها.'
        : 'لم يتم تعيين كلمة مرور VIP بعد.';
      localStorage.setItem('vipAssignedTeacher', vipAssignedTeacher);
      localStorage.setItem('vipRecoveryPhone', vipRecoveryPhone);
    }
  } catch (error) {
    console.error('تعذر تحميل إعدادات VIP:', error);
  }
});

