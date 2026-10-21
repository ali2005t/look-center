// ===== MOBILE MENU TOGGLE & ACTIVE PAGE INDICATOR =====
window.addEventListener('DOMContentLoaded', function () {
  // === REGISTER SERVICE WORKER ===
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('SW Registered', reg))
      .catch(err => console.log('SW Error', err));
  }

  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const mobileMenu = document.querySelector('.mobile-menu');
  const menuLinks = document.querySelectorAll('.mobile-menu-list a');

  // Function to highlight active page
  function highlightActivePage() {
    const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';
    menuLinks.forEach(link => {
      link.classList.remove('active');
      const href = link.getAttribute('href');
      if (href === currentPage) {
        link.classList.add('active');
      }
    });
  }

  // Highlight active page on load
  highlightActivePage();

  if (mobileMenuBtn && mobileMenu) {
    // Close menu when a link is clicked
    menuLinks.forEach(link => {
      link.addEventListener('click', function () {
        mobileMenu.classList.remove('active');
      });
    });

    // Close menu when clicking outside
    document.addEventListener('click', function (event) {
      if (!event.target.closest('.mobile-menu-btn') &&
        !event.target.closest('.mobile-menu')) {
        mobileMenu.classList.remove('active');
      }
    });
  }
});

// اختصارات لوحة المفاتيح العامة
window.addEventListener('keydown', function (e) {
  const key = String(e.key || '').toLowerCase();

  if (e.code === 'F5' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
    const invoiceForm = document.getElementById('invoice-form');
    const addInvoiceButton = document.getElementById('add-invoice-btn');
    if (invoiceForm && addInvoiceButton) {
      e.preventDefault();
      if (!e.repeat && !addInvoiceButton.disabled) addInvoiceButton.click();
    }
    return;
  }

  const shortcutPages = {
    F1: 'cashier.html',
    F2: 'invoices.html',
    F3: 'unsubscribed_students.html',
    F4: 'vip.html',
    F6: 'dashboard.html',
    F7: 'daily_closing.html',
    F8: 'late_students.html',
    F9: 'subscriptions.html',
    F10: 'reports.html',
    F11: 'expenses.html'
  };
  if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && shortcutPages[e.code]) {
    e.preventDefault();
    if (e.repeat) return;

    let permissions = [];
    try {
      permissions = JSON.parse(localStorage.getItem('userPermissions') || '[]');
    } catch (error) {
      console.error('Could not read permissions for keyboard navigation:', error);
    }
    const destination = shortcutPages[e.code];
    const pageKey = getPageKey(destination);
    const isManager = localStorage.getItem('userType') === 'مدير';
    if (isManager || (Array.isArray(permissions) && permissions.includes(pageKey))) {
      window.location.href = destination;
    } else if (typeof window.showNotification === 'function') {
      window.showNotification('ليس لديك صلاحية لفتح هذه الصفحة', 'error');
    }
    return;
  }

  // Ctrl+P: طباعة
  if (e.ctrlKey && key === 'p') {
    e.preventDefault();
    window.print();
  }
  // Ctrl+N: إضافة فاتورة جديدة (ينتقل للكاشير)
  if (e.ctrlKey && key === 'n') {
    e.preventDefault();
    window.location.href = 'cashier.html';
  }
  // Ctrl+F: بحث سريع (يركز على أول input بحث موجود)
  if (e.ctrlKey && key === 'f') {
    e.preventDefault();
    const searchInput = document.querySelector('input[type="search"], input[placeholder*="بحث"], input[placeholder*="search"]');
    if (searchInput) searchInput.focus();
  }
  // Ctrl+E: تصدير بيانات (ينقر زر التصدير إذا موجود)
  if (e.ctrlKey && key === 'e') {
    e.preventDefault();
    const exportBtn = document.getElementById('export-btn') || document.getElementById('export-excel-btn');
    if (exportBtn) exportBtn.click();
  }
  // Ctrl+Q: تسجيل خروج
  if (e.ctrlKey && key === 'q') {
    e.preventDefault();
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.click();
  }
  // Ctrl+B: إظهار/إخفاء القائمة الجانبية
  if (e.ctrlKey && key === 'b') {
    e.preventDefault();
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.style.display = (sidebar.style.display === 'none') ? '' : 'none';
    }
  }
}, true);
import { signOut, getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./firebase.js";

const permissionPages = {
  dashboard: 'dashboard.html',
  cashier: 'cashier.html',
  vip: 'vip.html',
  daily_closing: 'daily_closing.html',
  invoices: 'invoices.html',
  unsubscribed: 'unsubscribed_students.html',
  late_students: 'late_students.html',
  subscriptions: 'subscriptions.html',
  users: 'users.html',
  reports: 'reports.html',
  expenses: 'expenses.html',
  settings: 'settings.html',
  help: 'help.html'
};

const navigationPageDetails = {
  dashboard: { label: 'لوحة التحكم', icon: 'fa-tachometer-alt', color: '#1976d2' },
  cashier: { label: 'الكاشير', icon: 'fa-cash-register', color: '#43a047' },
  vip: { label: 'VIP', icon: 'fa-crown', color: '#ffb300' },
  daily_closing: { label: 'التقفيل اليومي', icon: 'fa-calendar-check', color: '#ff9800' },
  invoices: { label: 'الطلاب المشتركين', icon: 'fa-file-invoice', color: '#fbc02d' },
  unsubscribed: { label: 'فواتير فردية', icon: 'fa-user-minus', color: '#e53935' },
  late_students: { label: 'الطلاب المتأخرين', icon: 'fa-clock', color: '#8e24aa' },
  subscriptions: { label: 'الاشتراكات والأسعار', icon: 'fa-credit-card', color: '#00897b' },
  users: { label: 'إدارة المستخدمين', icon: 'fa-users', color: '#f57c00' },
  reports: { label: 'التقارير', icon: 'fa-chart-bar', color: '#0288d1' },
  expenses: { label: 'المصروفات', icon: 'fa-money-bill-wave', color: '#c2185b' },
  settings: { label: 'الإعدادات', icon: 'fa-cog', color: '#455a64' },
  help: { label: 'دليل المساعدة', icon: 'fa-question-circle', color: '#7e57c2' }
};

const navigationShortcuts = {
  cashier: ['F1'],
  invoices: ['F2'],
  unsubscribed: ['F3'],
  vip: ['F4'],
  dashboard: ['F6'],
  daily_closing: ['F7'],
  late_students: ['F8'],
  subscriptions: ['F9'],
  reports: ['F10'],
  expenses: ['F11']
};

function getPageKey(href) {
  try {
    const page = new URL(href, window.location.href).pathname.split('/').pop().toLowerCase();
    return Object.keys(permissionPages).find(key => permissionPages[key] === page) || '';
  } catch (error) {
    console.error('Could not determine navigation permission:', error);
    return '';
  }
}

function synchronizeNavigation() {
  const currentPage = window.location.pathname.split('/').pop().toLowerCase();
  document.querySelectorAll('.sidebar ul, .mobile-menu-list').forEach(list => {
    list.querySelectorAll(':scope > li').forEach(item => {
      const link = item.querySelector('a[href]');
      const key = link ? getPageKey(link.getAttribute('href')) : '';
      if (!key) return;
      item.dataset.link = permissionPages[key];
      const isCurrentPage = permissionPages[key] === currentPage;
      item.classList.toggle('active', isCurrentPage);
      if (list.classList.contains('mobile-menu-list')) {
        link.classList.toggle('active', isCurrentPage);
      }
    });

    const applyShortcutHints = () => {
      list.querySelectorAll(':scope > li a[href]').forEach(link => {
        const pageKey = getPageKey(link.getAttribute('href'));
        const shortcuts = navigationShortcuts[pageKey] || [];
        link.querySelectorAll('.keyboard-shortcut-hint').forEach(hint => hint.remove());
        shortcuts.forEach(shortcut => {
          const hint = document.createElement('span');
          hint.className = 'keyboard-shortcut-hint';
          hint.textContent = shortcut;
          hint.setAttribute('aria-label', `اختصار لوحة المفاتيح ${shortcut}`);
          link.appendChild(hint);
        });
      });
    };
    applyShortcutHints();

    const details = navigationPageDetails.vip;
    let item = list.querySelector('a[href="vip.html"]')?.closest('li');
    if (!item) {
      item = document.createElement('li');
      const link = document.createElement('a');
      link.href = permissionPages.vip;
      const icon = document.createElement('i');
      const label = document.createElement('span');
      if (list.classList.contains('mobile-menu-list')) {
        link.append(icon, label);
      } else {
        const iconWrapper = document.createElement('span');
        iconWrapper.className = 'sidebar-icon';
        iconWrapper.appendChild(icon);
        link.append(iconWrapper, label);
      }
      item.appendChild(link);
    }
    item.dataset.link = permissionPages.vip;
    const link = item.querySelector('a');
    link.href = permissionPages.vip;
    const icon = link.querySelector('i');
    icon.className = `fas ${details.icon}`;
    icon.style.color = details.color;
    const label = link.querySelector('span:not(.sidebar-icon)');
    label.textContent = details.label;
    const isCurrentPage = currentPage === permissionPages.vip;
    item.classList.toggle('active', isCurrentPage);
    link.classList.toggle('active', isCurrentPage);
    const cashierItem = list.querySelector('a[href="cashier.html"]')?.closest('li');
    if (cashierItem) {
      if (cashierItem.nextElementSibling !== item) cashierItem.after(item);
    } else {
      if (item.parentElement !== list) list.appendChild(item);
    }
    applyShortcutHints();
  });
}

function updateNavigation(permissions, isManager) {
  document.querySelectorAll('.sidebar li, .mobile-menu-list li').forEach(item => {
    const link = item.querySelector('a[href]');
    const key = link ? getPageKey(link.getAttribute('href')) : '';
    if (key) item.style.display = isManager || permissions.includes(key) ? '' : 'none';
  });
}

function redirectToAllowedPage(permissions) {
  const destination = Object.keys(permissionPages).find(key => permissions.includes(key));
  window.location.replace(destination ? permissionPages[destination] : 'login.html');
}

async function applyPagePermissions(user) {
  const currentPage = window.location.pathname.split('/').pop().toLowerCase();
  const currentPageKey = getPageKey(currentPage);

  if (!currentPageKey) return;
  if (!user) {
    window.location.replace('login.html');
    return;
  }

  try {
    const usersSnapshot = await getDocs(collection(db, 'users'));
    const userRecord = usersSnapshot.docs.find(userDoc =>
      String(userDoc.data().email || '').trim().toLowerCase() === String(user.email || '').trim().toLowerCase()
    );
    if (!userRecord) {
      localStorage.removeItem('userPermissions');
      localStorage.removeItem('userType');
      redirectToAllowedPage([]);
      return;
    }

    const profile = userRecord.data();
    const permissions = Array.isArray(profile.permissions) ? profile.permissions : [];
    const isManager = profile.type === 'مدير';
    localStorage.setItem('userPermissions', JSON.stringify(permissions));
    localStorage.setItem('userType', profile.type || '');
    updateNavigation(permissions, isManager);

    if (!isManager && !permissions.includes(currentPageKey)) {
      redirectToAllowedPage(permissions);
    }
  } catch (error) {
    console.error('Could not verify page permissions:', error);
    const notice = document.createElement('div');
    notice.setAttribute('role', 'alert');
    notice.style.cssText = 'position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:24px;background:#0f172acc;';
    notice.innerHTML = '<section style="max-width:420px;padding:30px;border-radius:18px;background:#fff;text-align:center;box-shadow:0 18px 50px #0004;font-family:Arial,sans-serif"><h2 style="margin:0 0 12px;color:#17345c">تعذر التحقق من الصلاحيات</h2><p style="margin:0 0 20px;color:#475569;line-height:1.8">تحقق من اتصال الإنترنت ثم سجّل الدخول مرة أخرى.</p><a href="login.html" style="display:inline-block;padding:11px 20px;border-radius:9px;background:#1976d2;color:#fff;text-decoration:none;font-weight:bold">العودة لتسجيل الدخول</a></section>';
    document.body.appendChild(notice);
  }
}

onAuthStateChanged(getAuth(), applyPagePermissions);

// تفعيل زر تسجيل الخروج في جميع الصفحات
window.addEventListener("DOMContentLoaded", function () {
  synchronizeNavigation();
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function (event) {
      event.preventDefault(); // Prevent default action
      const modal = document.getElementById("logout-modal");
      if (modal) {
        modal.style.display = "flex";
      }
    });
  }
  try {
    const cachedPermissions = JSON.parse(localStorage.getItem('userPermissions') || '[]');
    const cachedType = localStorage.getItem('userType') || '';
    if (Array.isArray(cachedPermissions)) {
      updateNavigation(cachedPermissions, cachedType === 'مدير');
    }
  } catch (error) {
    console.error('Could not read cached navigation permissions:', error);
  }
});

// Debugging: Log hidden sidebar items
window.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.sidebar ul li').forEach(li => {
    const link = li.getAttribute('data-link');
    if (li.style.display === 'none') {
      console.log('Hidden item:', link);
    }
  });

  // Debugging: Check user permissions
  const perms = JSON.parse(localStorage.getItem('userPermissions') || '[]');
  console.log('User permissions:', perms);
});

// تحديث اسم السنتر والشعار في الهيدر من localStorage أو Firebase
async function updateCenterHeader() {
  let name = localStorage.getItem('centerName');
  let logo = localStorage.getItem('centerLogo');
  const username = localStorage.getItem('currentUsername') ||
    localStorage.getItem('username') ||
    localStorage.getItem('currentUserEmail')?.replace(/@lookcenter\.com$/i, '');
  // جلب من Firebase إذا لم يوجد محلياً
  if (!name || !logo) {
    try {
      const { db } = await import('./firebase.js');
      const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      const snap = await getDoc(doc(db, 'settings', 'main'));
      if (snap.exists()) {
        const data = snap.data();
        if (!name && data.centerName) name = data.centerName;
        if (!logo && data.centerLogo) logo = data.centerLogo;
        if (name) localStorage.setItem('centerName', name);
        if (logo) localStorage.setItem('centerLogo', logo);
      }
    } catch (e) { }
  }
  // تحديث في الهيدر
  const nameEl = document.getElementById('center-name');
  if (nameEl) nameEl.textContent = username || name || 'اسم المستخدم';
  const imgEl = document.querySelector('.header-left img');
  if (imgEl) imgEl.src = logo || 'img/placeholder-logo.png';
  // تحديث في الداشبورد (العنصر ثلاثي الأبعاد)
  const name3d = document.getElementById('center-name-3d');
  if (name3d) name3d.textContent = name || 'اسم السنتر';
  // splash/login
  const splashName = document.querySelector('.center-name');
  if (splashName) splashName.textContent = name || 'اسم السنتر';
  const splashLogo = document.querySelector('.login-logo, .splash-container img');
  if (splashLogo) splashLogo.src = logo || 'img/placeholder-logo.png';
}
window.addEventListener('storage', updateCenterHeader);
window.addEventListener('DOMContentLoaded', updateCenterHeader);

// Function to show notifications
function showNotification(message, type = "success") {
  const notification = document.createElement("div");
  notification.className = `notification ${type}`;
  notification.textContent = message;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);
}

// Handle Temporary Logout and End Shift
window.addEventListener("DOMContentLoaded", function () {
  const tempLogoutBtn = document.getElementById("temp-logout-btn");
  const endShiftBtn = document.getElementById("end-shift-btn");

  if (tempLogoutBtn) {
    tempLogoutBtn.addEventListener("click", function () {
      // Temporary Logout: Redirect to login page
      window.location.href = "login.html";
    });
  }

  if (endShiftBtn) {
    endShiftBtn.addEventListener("click", async function () {
      try {
        const { db } = await import("./firebase.js");
        const { collection, addDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
        const auth = getAuth();
        const user = auth.currentUser;

        if (user) {
          const shiftData = {
            username: user.email || "Unknown User",
            startTime: localStorage.getItem("shiftStartTime") || "Unknown",
            endTime: new Date().toISOString(),
            invoices: JSON.parse(localStorage.getItem("invoicesSummary")) || {},
            timestamp: serverTimestamp()
          };


          await addDoc(collection(db, "shifts"), shiftData);
          showNotification("تم تسجيل الشيفت بنجاح!", "success");
        }
      } catch (error) {
        console.error("Error recording shift data:", error);
        showNotification("حدث خطأ أثناء تسجيل الشيفت!", "error");
      } finally {
        // Redirect to login page after recording
        window.location.href = "login.html";
      }
    });
  }
});

// ================================
// BREADCRUMB NAVIGATION
// ================================
function initializeBreadcrumb() {
  const currentPage = window.location.pathname.split('/').pop().replace('.html', '');

  const pageNames = {
    'dashboard': 'لوحة التحكم',
    'cashier': 'الكاشير',
    'invoices': 'الطلاب المشتركين',
    'daily_closing': 'التقفيل اليومي',
    'subscriptions': 'الاشتراكات',
    'unsubscribed_students': 'الطلاب غير المشتركين',
    'users': 'المستخدمين',
    'reports': 'التقارير',
    'expenses': 'المصروفات',
    'settings': 'الإعدادات',
    'help': 'المساعدة',
    'late_students': 'الطلاب المتأخرين'
  };

  let breadcrumbContainer = document.getElementById('breadcrumb-container');
  if (!breadcrumbContainer) {
    const mainHeader = document.querySelector('.main-header');
    if (mainHeader) {
      const bc = document.createElement('div');
      bc.id = 'breadcrumb-container';
      bc.className = 'breadcrumb';
      mainHeader.parentElement.insertBefore(bc, mainHeader.nextSibling);
      breadcrumbContainer = document.getElementById('breadcrumb-container');
    }
  }
}


// استدعاء عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', initializeBreadcrumb);

// ================================
// MOBILE SIDEBAR TOGGLE
// ================================
function initializeMobileSidebar() {
  const isMobile = window.innerWidth <= 600;

}

// استدعاء عند تحميل الصفحة والتحقق من تغيير الحجم
document.addEventListener('DOMContentLoaded', initializeMobileSidebar);
window.addEventListener('resize', () => {
  if (window.innerWidth <= 600) {
    initializeMobileSidebar();
  }
});

// ================================
// IMPROVE TABLE DISPLAY ON MOBILE
// ================================
function improveTableDisplay() {
  const tables = document.querySelectorAll('table');

  tables.forEach(table => {
    const rows = table.querySelectorAll('tbody tr');
    const headers = table.querySelectorAll('thead th');

    if (headers.length > 0 && rows.length > 0) {
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        cells.forEach((cell, index) => {
          if (headers[index]) {
            cell.setAttribute('data-label', headers[index].textContent);
          }
        });
      });
    }
  });
}

document.addEventListener('DOMContentLoaded', improveTableDisplay);

// ================================
// MOBILE MENU TOGGLE FUNCTIONALITY
// ================================
function initializeMenuToggle() {
  const isMobile = window.innerWidth <= 900;
  const menuToggleBtn = document.getElementById('menu-toggle-btn');
  const sidebar = document.querySelector('.sidebar');

  if (!menuToggleBtn || !sidebar) return;

  // إظهار/إخفاء الزر حسب حجم الشاشة
  if (isMobile) {
    menuToggleBtn.style.display = 'flex';
    menuToggleBtn.style.alignItems = 'center';
    menuToggleBtn.style.justifyContent = 'center';
  } else {
    menuToggleBtn.style.display = 'none';
  }

  // إنشاء overlay إذا لم يكن موجود
  let overlay = document.getElementById('sidebar-overlay-mobile');
  if (!overlay && isMobile) {
    overlay = document.createElement('div');
    overlay.id = 'sidebar-overlay-mobile';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.4);
      z-index: 80;
      display: none;
      animation: fadeIn 0.2s ease-in;
    `;
    document.body.appendChild(overlay);
  }

  // وظائف Toggle
  if (menuToggleBtn) {
    menuToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSidebar(sidebar, overlay);
    });
  }

  // إغلاق عند النقر على overlay
  if (overlay) {
    overlay.addEventListener('click', () => {
      closeSidebar(sidebar, overlay);
    });
  }

  // معالج النقر على الروابط
  if (sidebar) {
    const sidebarLinks = sidebar.querySelectorAll('a');
    sidebarLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        // منع السلوك الافتراضي
        e.preventDefault();
        e.stopPropagation();

        // حفظ الرابط للانتقال إليه
        const href = link.getAttribute('href');

        if (isMobile) {
          closeSidebar(sidebar, overlay);
        }

        // التأكد من الانتقال للصفحة الجديدة
        if (href && href.trim()) {
          setTimeout(() => {
            window.location.href = href;
          }, 100);
        }
      });
    });
  }
}

function toggleSidebar(sidebar, overlay) {
  const isOpen = sidebar.style.left === '0px' || sidebar.classList.contains('open');
  if (isOpen) {
    closeSidebar(sidebar, overlay);
  } else {
    openSidebar(sidebar, overlay);
  }
}

function openSidebar(sidebar, overlay) {
  sidebar.style.left = '0px';
  sidebar.style.display = 'flex';
  sidebar.classList.add('open');
  if (overlay) overlay.style.display = 'block';
}

function closeSidebar(sidebar, overlay) {
  sidebar.style.left = '-100%';
  sidebar.classList.remove('open');
  if (overlay) overlay.style.display = 'none';
}

document.addEventListener('DOMContentLoaded', initializeMenuToggle);
window.addEventListener('resize', () => {
  initializeMenuToggle();
});

// إضافة CSS animation
if (!document.getElementById('sidebar-animation-styles')) {
  const style = document.createElement('style');
  style.id = 'sidebar-animation-styles';
  style.textContent = `
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes slideIn {
      from { transform: translateX(100%); }
      to { transform: translateX(0); }
    }
    .sidebar {
      transition: left 0.3s ease, display 0.3s ease;
    }
  `;
  document.head.appendChild(style);
}
