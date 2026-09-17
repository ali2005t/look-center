// ملف لحساب عدد الفواتير والربح الكلي لكل مستخدم من جميع الفواتير (فردية وجماعية)
import { db } from './firebase.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// دالة لجلب ملخص الفواتير لكل مستخدم
export async function getUserInvoiceSummary({month, day} = {}) {
  // جلب جميع الفواتير
  const invoicesSnap = await getDocs(collection(db, 'invoices'));
  // جدول المستخدمين: { username: { count, totalProfit } }
  const userSummary = {};
  invoicesSnap.forEach(invSnap => {
    const data = invSnap.data();
    // تجاهل الفواتير بدون مستلم
    const recipient = data.recipient || '-';
    if (!recipient || recipient === '-') return;
    // فلترة حسب الشهر/اليوم إذا طلب
    let dateObj = null;
    if (data.date && data.date.toDate) {
      dateObj = data.date.toDate();
    } else if (data.date instanceof Date) {
      dateObj = data.date;
    } else if (typeof data.date === 'string') {
      dateObj = new Date(data.date);
    }
    if (month) {
      if (!dateObj || dateObj.getMonth()+1 !== +month.split('-')[1] || dateObj.getFullYear() !== +month.split('-')[0]) return;
    }
    if (day) {
      if (!dateObj || dateObj.getDate() !== +day) return;
    }
    // حساب الربح الكلي
    const total = (data.items||[]).reduce((sum,x)=>sum+(+x.price||0),0);
    if (!userSummary[recipient]) userSummary[recipient] = { count: 0, totalProfit: 0 };
    userSummary[recipient].count++;
    userSummary[recipient].totalProfit += total;
  });
  return userSummary;
}

