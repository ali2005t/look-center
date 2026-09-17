import { db } from "./firebase.js";
import { collection, getDocs, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { utils, writeFile } from 'https://cdn.sheetjs.com/xlsx-0.19.2/package/xlsx.mjs';

let allInvoices = [];
let lateInvoices = [];

function showLoadingIndicator() {
  const tableBody = document.querySelector('#late-students-table-box tbody');
  if (tableBody) {
    tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;"><div style="display:inline-block;width:30px;height:30px;border:3px solid #f3f3f3;border-top:3px solid #1976d2;border-radius:50%;animation:spin 1s linear infinite;"></div></td></tr>';
  }
}

async function loadLateStudents() {
  try {
    showLoadingIndicator();
    const snapshot = await getDocs(collection(db, "invoices"));
    allInvoices = [];
    snapshot.forEach(docSnap => {
      const inv = docSnap.data();
      inv._id = docSnap.id;
      allInvoices.push(inv);
    });
    renderLateStudentsTable();
  } catch (error) {
    console.error('Error loading late students:', error);
    const tableBody = document.querySelector('#late-students-table-box tbody');
    if (tableBody) {
      tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:red;padding:20px;">حدث خطأ أثناء تحميل البيانات</td></tr>';
    }
  }
}

function renderLateStudentsTable() {
  const lateTableBody = document.querySelector('#late-students-table-box tbody');
  if (!lateTableBody) return;
  
  lateInvoices = allInvoices.filter(inv => inv.payment === 'تقسيط' && !inv.installment?.paidAll);
  
  // ترتيب البيانات: الأعلى متبقي أولاً
  lateInvoices.sort((a, b) => {
    const aRemain = (+a.installment?.total || +a.installment?.amount || 0) - (+a.installment?.paid || +a.installment?.paidAmount || 0);
    const bRemain = (+b.installment?.total || +b.installment?.amount || 0) - (+b.installment?.paid || +b.installment?.paidAmount || 0);
    return bRemain - aRemain;
  });
  
  if (!lateInvoices.length) {
    lateTableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#b3b3b3;padding:30px;">✓ لا يوجد طلاب لديهم فواتير تقسيط معلقة</td></tr>';
    document.getElementById('late-students-summary').innerHTML = '';
    return;
  }
  
  let total = 0, paid = 0, remain = 0;
  lateTableBody.innerHTML = lateInvoices.map((inv, i) => {
    const t = +inv.installment?.total || +inv.installment?.amount || 0;
    const p = +inv.installment?.paid || +inv.installment?.paidAmount || 0;
    const r = t - p;
    total += t; paid += p; remain += r;
    
    // لون الصف بناءً على المتبقي
    const rowColor = r > t * 0.7 ? '#ffebee' : r > 0 ? '#fff9c4' : '#e8f5e9';
    
    return `
    <tr data-index="${i}" data-id="${inv._id}" style="cursor:pointer;background-color:${rowColor};transition:background-color 0.3s;">
      <td>${i+1}</td>
      <td><strong>${inv.student||'-'}</strong></td>
      <td>${inv.phone||'-'}</td>
      <td><span style="background:#e3f2fd;padding:4px 8px;border-radius:4px;">${inv.subType||'-'}</span></td>
      <td style="font-weight:bold;">${t.toFixed(2)}</td>
      <td style="color:#388e3c;font-weight:bold;">${p.toFixed(2)}</td>
      <td style="color:${r>0?'#d32f2f':'#388e3c'};font-weight:bold;">${r.toFixed(2)}</td>
      <td>
        <select onchange="window.updatePaymentStatus('${inv._id}', this.value)" style="padding:6px 8px;border-radius:4px;border:1px solid #ddd;cursor:pointer;" onclick="event.stopPropagation();">
          <option value="unpaid" ${r>0?'selected':''}>⏳ لم يدفع</option>
          <option value="paid" ${r<=0?'selected':''}>✓ مدفوع</option>
        </select>
      </td>
    </tr>`;
  }).join('');
  
  // صف المجموع
  lateTableBody.innerHTML += `<tr style="background:linear-gradient(135deg,#1976d2 0%,#1565c0 100%);color:white;font-weight:bold;font-size:15px;">
    <td colspan="4">📊 إجمالي المبالغ</td>
    <td>${total.toFixed(2)}</td>
    <td>${paid.toFixed(2)}</td>
    <td>${remain.toFixed(2)}</td>
    <td></td>
  </tr>`;
  
  // تحديث ملخص المبالغ
  const summaryEl = document.getElementById('late-students-summary');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:15px;">
        <div style="background:#e3f2fd;padding:12px;border-radius:8px;text-align:center;border-left:4px solid #1976d2;">
          <div style="font-size:12px;color:#666;">👥 عدد الطلاب</div>
          <div style="font-size:20px;font-weight:bold;color:#1976d2;">${lateInvoices.length}</div>
        </div>
        <div style="background:#fff3e0;padding:12px;border-radius:8px;text-align:center;border-left:4px solid #ff9800;">
          <div style="font-size:12px;color:#666;">💰 إجمالي المديونية</div>
          <div style="font-size:20px;font-weight:bold;color:#ff9800;">${remain.toFixed(2)} ج</div>
        </div>
      </div>
    `;
  }
  
  // تفعيل تفاصيل الفاتورة عند الضغط
  Array.from(lateTableBody.querySelectorAll('tr[data-index]')).forEach(row => {
    row.onmouseover = () => row.style.backgroundColor = '#eceff1';
    row.onmouseout = () => {
      const idx = +row.getAttribute('data-index');
      const inv = lateInvoices[idx];
      const t = +inv.installment?.total || +inv.installment?.amount || 0;
      const p = +inv.installment?.paid || +inv.installment?.paidAmount || 0;
      const r = t - p;
      row.style.backgroundColor = r > t * 0.7 ? '#ffebee' : r > 0 ? '#fff9c4' : '#e8f5e9';
    };
    row.onclick = function() {
      const idx = +this.getAttribute('data-index');
      showInvoiceModal(lateInvoices[idx]);
    };
  });
}

window.updatePaymentStatus = async function(id, val) {
  if (!id) return;
  try {
    const invoiceRef = doc(db, "invoices", id);
    if (val === 'paid') {
      const invoice = lateInvoices.find(x => x._id === id);
      const totalAmount = invoice?.installment?.total || invoice?.installment?.amount || 0;
      await updateDoc(invoiceRef, { 
        'installment.paid': totalAmount, 
        'installment.paidAll': true 
      });
      showNotification(`✓ تم تحديث حالة الدفع للطالب: ${invoice?.student}`, 'success');
    } else {
      await updateDoc(invoiceRef, { 'installment.paidAll': false });
      showNotification('✓ تم تحديث الحالة بنجاح', 'success');
    }
    loadLateStudents();
  } catch (error) {
    console.error('Error updating payment status:', error);
    showNotification('❌ حدث خطأ أثناء التحديث', 'error');
  }
};

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 15px 20px;
    background: ${type === 'success' ? '#4caf50' : type === 'error' ? '#f44336' : '#2196f3'};
    color: white;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    animation: slideIn 0.3s ease;
    font-weight: 500;
  `;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

function showInvoiceModal(inv) {
  const total = inv.installment?.total || inv.installment?.amount || 0;
  const paid = inv.installment?.paid || inv.installment?.paidAmount || 0;
  const remain = total - paid;
  const percentage = total > 0 ? Math.round((paid / total) * 100) : 0;
  
  let html = `
    <div class="modal-bg" id="modal-bg" style="animation:fadeIn 0.3s ease;"></div>
    <div class="modal-box" id="modal-box" style="animation:slideUp 0.3s ease;max-width:500px;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,0.2);">
      <div style="background:linear-gradient(135deg,#1976d2 0%,#1565c0 100%);color:white;padding:20px;border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:center;">
        <h3 style="margin:0;font-size:18px;">📋 تفاصيل الفاتورة</h3>
        <button onclick="window.closeModal()" style="background:rgba(255,255,255,0.2);border:none;color:white;font-size:20px;cursor:pointer;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;">×</button>
      </div>
      <div style="padding:25px;">
        <div style="margin-bottom:18px;">
          <label style="font-size:12px;color:#666;display:block;margin-bottom:5px;">👤 اسم الطالب</label>
          <div style="font-size:16px;font-weight:bold;color:#1976d2;">${inv.student||'-'}</div>
        </div>
        <div style="margin-bottom:18px;">
          <label style="font-size:12px;color:#666;display:block;margin-bottom:5px;">📞 رقم الهاتف</label>
          <div style="font-size:15px;">${inv.phone||'-'}</div>
        </div>
        <div style="margin-bottom:18px;">
          <label style="font-size:12px;color:#666;display:block;margin-bottom:5px;">📚 نوع الاشتراك</label>
          <span style="background:#e3f2fd;color:#1976d2;padding:6px 12px;border-radius:6px;font-weight:500;">${inv.subType||'-'}</span>
        </div>
        <div style="background:#f5f5f5;padding:15px;border-radius:8px;margin-bottom:18px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:12px;">
            <div style="text-align:center;">
              <div style="font-size:12px;color:#666;margin-bottom:5px;">💰 الإجمالي</div>
              <div style="font-size:18px;font-weight:bold;color:#1976d2;">${total.toFixed(2)} ج</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:12px;color:#666;margin-bottom:5px;">✓ المدفوع</div>
              <div style="font-size:18px;font-weight:bold;color:#388e3c;">${paid.toFixed(2)} ج</div>
            </div>
          </div>
          <div style="width:100%;background:#e0e0e0;height:6px;border-radius:3px;overflow:hidden;">
            <div style="background:linear-gradient(90deg,#388e3c 0%,#4caf50 100%);height:100%;width:${percentage}%;transition:width 0.3s ease;"></div>
          </div>
          <div style="text-align:center;font-size:12px;color:#666;margin-top:6px;">${percentage}% مدفوع</div>
        </div>
        <div style="background:#fff3e0;padding:15px;border-radius:8px;border-left:4px solid #ff9800;">
          <div style="font-size:12px;color:#666;margin-bottom:5px;">⏳ المتبقي</div>
          <div style="font-size:20px;font-weight:bold;color:#ff9800;">${remain.toFixed(2)} ج</div>
        </div>
      </div>
      <div style="border-top:1px solid #eee;padding:15px;text-align:center;">
        <button onclick="window.closeModal()" style="background:#1976d2;color:white;border:none;padding:10px 30px;border-radius:6px;cursor:pointer;font-weight:bold;transition:background 0.3s;" onmouseover="this.style.background='#1565c0'" onmouseout="this.style.background='#1976d2'">إغلاق</button>
      </div>
    </div>
  `;
  let modalDiv = document.createElement('div');
  modalDiv.innerHTML = html;
  document.body.appendChild(modalDiv);
  document.getElementById('modal-bg').onclick = window.closeModal;
}

// دالة إغلاق النافذة المنبثقة
window.closeModal = function() {
  const modals = document.querySelectorAll('.modal-bg, .modal-box');
  modals.forEach(modal => {
    modal.style.animation = modal.classList.contains('modal-bg') ? 'fadeOut 0.3s ease' : 'slideDown 0.3s ease';
  });
  setTimeout(() => {
    modals.forEach(modal => {
      const parent = modal.parentElement;
      if (parent) parent.remove();
    });
  }, 300);
};
// زر تصدير إلى Excel
window.exportLateStudentsToExcel = function() {
  try {
    const table = document.querySelector('.late-students-table');
    if (!table) {
      window.showNotification('لا توجد بيانات لتصديرها', 'error');
      return;
    }

    const workbook = utils.table_to_book(table, { sheet: 'الطلاب المتأخرين' });
    writeFile(workbook, 'الطلاب_المتأخرين.xlsx');

    window.showNotification('تم تصدير البيانات بنجاح', 'success');
  } catch (error) {
    console.error('Error exporting to Excel:', error);
    window.showNotification('حدث خطأ أثناء التصدير', 'error');
  }
};

document.addEventListener("DOMContentLoaded", loadLateStudents);

// إضافة أنماط الـ animations
const style = document.createElement('style');
style.textContent = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes fadeOut {
    from { opacity: 1; }
    to { opacity: 0; }
  }
  @keyframes slideUp {
    from { 
      opacity: 0;
      transform: translateY(20px);
    }
    to { 
      opacity: 1;
      transform: translateY(0);
    }
  }
  @keyframes slideDown {
    from { 
      opacity: 1;
      transform: translateY(0);
    }
    to { 
      opacity: 0;
      transform: translateY(20px);
    }
  }
  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateX(100px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }
  @keyframes slideOut {
    from {
      opacity: 1;
      transform: translateX(0);
    }
    to {
      opacity: 0;
      transform: translateX(100px);
    }
  }
`;
document.head.appendChild(style);

