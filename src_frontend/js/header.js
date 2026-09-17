// ===== MOBILE MENU TOGGLE & ACTIVE PAGE INDICATOR =====
window.addEventListener('DOMContentLoaded', function () {
  // === REGISTER SERVICE WORKER ===
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('SW Registered', reg))
      .catch(err => console.log('SW Error', err));
  }

  // === PWA INSTALLATION LOGIC ===
  let deferredPrompt;
  const headerInstallBtn = document.getElementById('pwa-install-header-btn');
  const installId = 'pwa-install-btn';

  const triggerInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`User response to install prompt: ${outcome}`);
      deferredPrompt = null;
      if (headerInstallBtn) headerInstallBtn.style.display = 'none';
      const sidebarBtn = document.getElementById(installId);
      if (sidebarBtn) sidebarBtn.style.display = 'none';
    } else {
      alert('المتصفح لا يسمح بالتثبيت حالياً. تأكد من استخدام Chrome أو Edge وأن الموقع يعمل ب HTTPS.');
    }
  };

  if (headerInstallBtn) {
    headerInstallBtn.addEventListener('click', triggerInstall);
  }

  // إنشاء زر السايدبار برضه للاحتياط
  const sidebarUl = document.querySelector('.sidebar ul');
  if (sidebarUl && !document.getElementById(installId)) {
    const installLi = document.createElement('li');
    installLi.id = installId;
    installLi.innerHTML = `
      <a href="#" style="background: #e8f5e9; color: #2e7d32; border: 1px dashed #2e7d32; border-radius: 8px; margin: 10px 15px; padding: 10px; display: flex; align-items: center; gap: 10px; text-decoration: none; justify-content: center; font-weight: bold;">
        <i class="fas fa-download"></i>
        <span>تثبيت البرنامج</span>
      </a>
    `;
    sidebarUl.appendChild(installLi);
    installLi.addEventListener('click', triggerInstall);
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('PWA Prompt Captured');
  });

  window.addEventListener('appinstalled', (evt) => {
    console.log('App was installed');
    if (headerInstallBtn) headerInstallBtn.style.display = 'none';
    const installLi = document.getElementById(installId);
    if (installLi) installLi.style.display = 'none';
  });

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
  // Ctrl+P: طباعة
  if (e.ctrlKey && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    window.print();
  }
  // Ctrl+N: إضافة فاتورة جديدة (ينتقل للكاشير)
  if (e.ctrlKey && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    window.location.href = 'cashier.html';
  }
  // Ctrl+F: بحث سريع (يركز على أول input بحث موجود)
  if (e.ctrlKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    const searchInput = document.querySelector('input[type="search"], input[placeholder*="بحث"], input[placeholder*="search"]');
    if (searchInput) searchInput.focus();
  }
  // Ctrl+E: تصدير بيانات (ينقر زر التصدير إذا موجود)
  if (e.ctrlKey && e.key.toLowerCase() === 'e') {
    e.preventDefault();
    const exportBtn = document.getElementById('export-btn') || document.getElementById('export-excel-btn');
    if (exportBtn) exportBtn.click();
  }
  // Ctrl+Q: تسجيل خروج
  if (e.ctrlKey && e.key.toLowerCase() === 'q') {
    e.preventDefault();
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.click();
  }
  // Ctrl+B: إظهار/إخفاء القائمة الجانبية
  if (e.ctrlKey && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.style.display = (sidebar.style.display === 'none') ? '' : 'none';
    }
  }
});
// حماية الصفحات من دخول الكاشير لغير صفحة الكاشير
function blockCashierOnOtherPages() {
  try {
    let userType = localStorage.getItem('userType');
    if (userType) userType = userType.trim().toLowerCase();
    const allowedPages = ['cashier.html'];
    const currentPage = window.location.pathname.split('/').pop().toLowerCase();
    if ((userType === 'كاشير' || userType === 'cashier') && !allowedPages.includes(currentPage)) {
      document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;width:100vw;"><div style="background:#fff;padding:48px 32px;border-radius:18px;box-shadow:0 4px 32px #1976d244;text-align:center;max-width:400px;margin:auto;"><div style="font-size:2em;color:#1976d2;font-weight:bold;margin-bottom:18px;">لا تحاول بالتدخل فيما لايعينك</div><div style="font-size:1.3em;color:#43a047;margin-bottom:12px;">تابع عملك يا صديقي <span style='font-size:2em;'>😊</span></div></div></div>`;
      document.body.style.background = '#e3f2fd';
    }
  } catch (e) { console.error('blockCashierOnOtherPages error:', e); }
}
window.addEventListener('DOMContentLoaded', blockCashierOnOtherPages);
import { signOut, getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// تفعيل زر تسجيل الخروج في جميع الصفحات
window.addEventListener("DOMContentLoaded", function () {
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
  // تفعيل إخفاء عناصر القائمة الجانبية حسب الصلاحيات
  try {
    const perms = JSON.parse(localStorage.getItem('userPermissions') || '[]');
    if (perms.length && document.querySelector('.sidebar ul')) {
      const allLis = document.querySelectorAll('.sidebar ul li');
      allLis.forEach(li => {
        const link = li.getAttribute('data-link');
        if (link) {
          // استخراج key من اسم الصفحة
          let key = '';
          if (link.includes('dashboard')) key = 'dashboard';
          else if (link.includes('cashier')) key = 'cashier';
          else if (link.includes('invoices')) key = 'invoices';
          else if (link.includes('unsubscribed')) key = 'unsubscribed';
          else if (link.includes('subscriptions')) key = 'subscriptions';
          else if (link.includes('users')) key = 'users';
          else if (link.includes('reports')) key = 'reports';
          else if (link.includes('expenses')) key = 'expenses';
          else if (link.includes('settings')) key = 'settings';
          else if (link.includes('help')) key = 'help';
          else if (link.includes('daily_closing')) key = 'daily_closing';
          else if (link.includes('late_students')) key = 'late_students';
          // إصلاح: تحقق من وجود المفتاح الصحيح
          if (key && !perms.includes(key)) li.style.display = 'none';
          else li.style.display = '';
        }
      });
    }
  } catch (e) { }
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

// Temporary: Add 'daily_closing' to user permissions if not present
window.addEventListener('DOMContentLoaded', function () {
  const perms = JSON.parse(localStorage.getItem('userPermissions') || '[]');
  if (!perms.includes('daily_closing')) {
    perms.push('daily_closing');
    localStorage.setItem('userPermissions', JSON.stringify(perms));
    console.log('Updated permissions:', perms);
  }
});

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


