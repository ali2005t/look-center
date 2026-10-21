import { db } from '../src_frontend/js/firebase.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const byId = id => document.getElementById(id);
const rememberUsernameKey = 'vipTeacherRememberedUsername';
const teacherSessionKey = 'vipTeacherVerifiedSession';
const rememberedUsername = localStorage.getItem(rememberUsernameKey);
if (rememberedUsername) {
  byId('teacher-username').value = rememberedUsername;
  byId('vip-remember-me').checked = true;
}

async function hashPassword(password) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

byId('teacher-login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = byId('teacher-login-button');
  const error = byId('teacher-login-error');
  const enteredName = byId('teacher-username').value.trim();
  error.hidden = true;
  button.disabled = true;
  try {
    const settingsSnapshot = await getDoc(doc(db, 'settings', 'main'));
    if (!settingsSnapshot.exists()) throw new Error('إعدادات الأستاذ غير موجودة. راجع إعدادات VIP في البرنامج.');
    const settings = settingsSnapshot.data();
    const configuredName = String(settings.vipAssignedTeacher || '').trim();
    if (!configuredName || enteredName.toLocaleLowerCase() !== configuredName.toLocaleLowerCase()) {
      throw new Error('اسم الأستاذ لا يطابق الاسم المحفوظ في إعدادات VIP.');
    }
    if (!settings.vipPasswordHash || await hashPassword(byId('teacher-password').value) !== settings.vipPasswordHash) {
      throw new Error('كلمة مرور VIP غير صحيحة.');
    }

    if (byId('vip-remember-me').checked) localStorage.setItem(rememberUsernameKey, enteredName);
    else localStorage.removeItem(rememberUsernameKey);

    sessionStorage.setItem(teacherSessionKey, JSON.stringify({
      id: `vip-name:${configuredName.toLocaleLowerCase()}`,
      name: configuredName,
      authenticatedAt: Date.now()
    }));
    window.location.replace('vip-teacher.html');
  } catch (loginError) {
    console.error('VIP teacher login failed:', loginError);
    error.textContent = loginError.code === 'unavailable' || loginError.code === 'auth/network-request-failed'
      ? 'تعذر الاتصال بالخدمة. تحقق من الإنترنت ثم حاول مرة أخرى.'
      : loginError.message || 'تعذر تسجيل الدخول. حاول مرة أخرى.';
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
});
