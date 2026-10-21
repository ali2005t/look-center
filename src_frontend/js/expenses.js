import { db } from "./firebase.js";
import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  doc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const addExpenseForm = document.getElementById("add-expense-form");
addExpenseForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const type = document.getElementById("expense-type").value;
  const value = parseFloat(document.getElementById("expense-value").value);
  const date = document.getElementById("expense-date").value;
  const note = document.getElementById("expense-note").value;
  if (!type || !value || !date) return alert("يرجى ملء كل الحقول الأساسية");
  await addDoc(collection(db, "expenses"), {
    type,
    value,
    date,
    note
  });
  if (window.showNotification) {
    showNotification('<span style="font-size:1.15em;font-weight:bold; تم حفظ المصروف بنجاح</span>', 'success', 2500);
  } else {
    // إذا لم يكن notifications.js محملاً بعد، انتظر تحميله ثم أظهر الإشعار
    const script = document.createElement('script');
    script.src = 'js/notifications.js';
    script.onload = function() {
      if (window.showNotification) {
        showNotification('<span style="font-size:1.15em;font-weight:bold;"> تم حفظ المصروف بنجاح</span>', 'success', 2500);
      }
    };
    document.head.appendChild(script);
  }
  loadExpenses();
});

async function loadExpenses() {
  const tbody = document.querySelector("#expenses-table tbody");
  tbody.innerHTML = "";
  const snapshot = await getDocs(collection(db, "expenses"));
  let i = 1;
  let total = 0;
  const byType = {};
  snapshot.forEach((docSnap) => {
    const exp = docSnap.data();
    total += exp.value || 0;
    byType[exp.type] = (byType[exp.type] || 0) + (exp.value || 0);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i++}</td>
      <td>${exp.type}</td>
      <td>${exp.value} ج</td>
      <td>${exp.date}</td>
      <td>${exp.note || '-'}</td>
      <td><button onclick="editExpense('${docSnap.id}')">✏️</button></td>
      <td><button onclick="deleteExpense('${docSnap.id}')">🗑️</button></td>
    `;
    tbody.appendChild(tr);
  });
  // ملخص
  document.getElementById('expenses-total').textContent = `إجمالي المصروفات: ${total} ج`;
  document.getElementById('expenses-by-type').innerHTML = Object.entries(byType).map(([k,v]) => `${k}: <b>${v} ج</b>`).join(' | ');
}
window.editExpense = (id) => {
  alert('ميزة التعديل ستضاف لاحقًا');
};
window.deleteExpense = async (id) => {
  await deleteDoc(doc(db, "expenses", id));
  loadExpenses();
};
window.addEventListener("DOMContentLoaded", loadExpenses);

