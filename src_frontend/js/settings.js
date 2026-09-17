// js/settings.js
import { db } from "./firebase.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const settingsForm = document.getElementById('settings-form');
settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  // حفظ الإعدادات (اسم السنتر والشعار والحقول الجديدة)
  const centerName = document.getElementById('center-name-input').value;
  const centerPhone1 = document.getElementById('center-phone-1').value;
  const centerPhone2 = document.getElementById('center-phone-2').value;
  const centerPhone3 = document.getElementById('center-phone-3').value;
  const centerAddress = document.getElementById('center-address').value;
  try {
    await updateDoc(doc(db, 'settings', 'main'), {
      centerName,
      centerPhone1,
      centerPhone2,
      centerPhone3,
      centerAddress
    });
    // حفظ في localStorage أيضًا
    localStorage.setItem('centerName', centerName);
    localStorage.setItem('centerPhone1', centerPhone1);
    localStorage.setItem('centerPhone2', centerPhone2);
    localStorage.setItem('centerPhone3', centerPhone3);
    localStorage.setItem('centerAddress', centerAddress);
    showNotification('تم حفظ الإعدادات بنجاح', 'success', 2500);
  } catch (err) {
    showNotification('حدث خطأ أثناء حفظ الإعدادات', 'error', 3500);
  }
});

// عند تحميل الصفحة: ملء الحقول بالقيم المحفوظة
window.addEventListener('DOMContentLoaded', function() {
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
});

