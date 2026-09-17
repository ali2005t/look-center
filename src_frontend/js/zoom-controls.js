// نظام التحكم في الـ Zoom - متوافق مع Electron والمتصفح
let ipcRenderer = null;

// محاولة تحميل ipcRenderer من Electron (إن كان متاحًا)
// أو التحقق من وجود Tauri
const isTauri = !!window.__TAURI__;
try {
  ipcRenderer = require('electron').ipcRenderer;
} catch (e) {
  // لا توجد Electron - سيعمل في المتصفح العادي فقط
  ipcRenderer = null;
}

class ZoomControls {
  constructor() {
    // تحميل مستوى الزوم المحفوظ من localStorage
    const savedZoom = localStorage.getItem('zoomLevel');
    this.zoomLevel = savedZoom ? parseFloat(savedZoom) : 0;
    this.isElectron = ipcRenderer !== null;
    this.isTauri = isTauri;
    this.init();
  }

  init() {
    // تطبيق مستوى الزوم المحفوظ مباشرة
    this.applyZoom();

    // إنشاء عناصر التحكم في الـ Zoom
    this.createZoomUI();

    // إذا كان Electron متاحًا
    if (this.isElectron && ipcRenderer) {
      // استقبال مستوى الـ Zoom من الـ Main Process
      ipcRenderer.on('zoom-level', (event, level) => {
        this.zoomLevel = level;
        localStorage.setItem('zoomLevel', this.zoomLevel);
        this.updateZoomDisplay();
      });
    }

    // اختصارات لوحة المفاتيح
    this.setupKeyboardShortcuts();
  }

  createZoomUI() {
    // التحقق من وجود عنصر التحكم بالفعل
    if (document.getElementById('zoom-controls')) {
      return;
    }

    const zoomContainer = document.createElement('div');
    zoomContainer.id = 'zoom-controls';
    zoomContainer.className = 'zoom-controls';
    zoomContainer.innerHTML = `
      <button id="zoom-out-btn" title="تصغير (Ctrl+-)">
        <i class="fas fa-search-minus"></i>
      </button>
      <span id="zoom-level-display">100%</span>
      <button id="zoom-in-btn" title="تكبير (Ctrl++)">
        <i class="fas fa-search-plus"></i>
      </button>
      <button id="zoom-reset-btn" title="إعادة تعيين (Ctrl+0)">
        <i class="fas fa-redo"></i>
      </button>
    `;

    // إضافة الأنماط
    this.addZoomStyles();

    // إضافة العناصر إلى الصفحة
    if (document.body) {
      document.body.appendChild(zoomContainer);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        document.body.appendChild(zoomContainer);
      });
    }

    // ربط الأحداث
    this.bindZoomButtons();
  }

  bindZoomButtons() {
    const zoomInBtn = document.getElementById('zoom-in-btn');
    const zoomOutBtn = document.getElementById('zoom-out-btn');
    const zoomResetBtn = document.getElementById('zoom-reset-btn');

    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', () => {
        this.performZoomIn();
      });
    }

    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', () => {
        this.performZoomOut();
      });
    }

    if (zoomResetBtn) {
      zoomResetBtn.addEventListener('click', () => {
        this.performZoomReset();
      });
    }
  }

  performZoomIn() {
    this.zoomLevel += 0.1;
    if (this.zoomLevel > 2) this.zoomLevel = 2;

    // حفظ مستوى الزوم
    localStorage.setItem('zoomLevel', this.zoomLevel);

    if (this.isElectron && ipcRenderer) {
      ipcRenderer.send('zoom-in');
    } else if (this.isTauri) {
      window.__TAURI__.invoke('zoom_in');
    } else {
      // في المتصفح العادي - استخدم CSS zoom
      this.applyZoom();
    }
    this.updateZoomDisplay();
  }

  performZoomOut() {
    this.zoomLevel -= 0.1;
    if (this.zoomLevel < -0.5) this.zoomLevel = -0.5;

    // حفظ مستوى الزوم
    localStorage.setItem('zoomLevel', this.zoomLevel);

    if (this.isElectron && ipcRenderer) {
      ipcRenderer.send('zoom-out');
    } else if (this.isTauri) {
      window.__TAURI__.invoke('zoom_out');
    } else {
      // في المتصفح العادي - استخدم CSS zoom
      this.applyZoom();
    }
    this.updateZoomDisplay();
  }

  performZoomReset() {
    this.zoomLevel = 0;

    // حفظ مستوى الزوم
    localStorage.setItem('zoomLevel', this.zoomLevel);

    if (this.isElectron && ipcRenderer) {
      ipcRenderer.send('zoom-reset');
    } else if (window.__TAURI__) {
      window.__TAURI__.invoke('zoom_reset');
    } else {
      // في المتصفح العادي - أعد تعيين الـ zoom
      this.applyZoom();
    }
    this.updateZoomDisplay();
  }

  applyZoom() {
    // تطبيق مستوى الزوم على الصفحة
    const zoomPercentage = (1 + this.zoomLevel) * 100;
    document.documentElement.style.zoom = zoomPercentage + '%';
  }

  updateZoomDisplay() {
    const display = document.getElementById('zoom-level-display');
    if (display) {
      const percentage = Math.round((1 + this.zoomLevel) * 100);
      display.textContent = percentage + '%';
    }
  }

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl++ أو Cmd++ (تكبير)
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        this.performZoomIn();
      }

      // Ctrl+- أو Cmd+- (تصغير)
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        this.performZoomOut();
      }

      // Ctrl+0 أو Cmd+0 (إعادة تعيين)
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        this.performZoomReset();
      }
    });
  }

  addZoomStyles() {
    if (document.getElementById('zoom-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'zoom-styles';
    style.textContent = `
      .zoom-controls {
        position: fixed;
        bottom: 20px;
        left: 20px;
        background: linear-gradient(135deg, #1976d2 0%, #43a047 100%);
        border-radius: 50px;
        padding: 10px 15px;
        display: flex;
        gap: 10px;
        align-items: center;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 9999;
        font-family: Cairo, Arial, sans-serif;
      }

      .zoom-controls button {
        background: rgba(255, 255, 255, 0.2);
        border: none;
        color: #fff;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.3s ease;
        font-size: 16px;
      }

      .zoom-controls button:hover {
        background: rgba(255, 255, 255, 0.4);
        transform: scale(1.1);
      }

      .zoom-controls button:active {
        transform: scale(0.95);
      }

      #zoom-level-display {
        color: #fff;
        font-weight: bold;
        min-width: 50px;
        text-align: center;
        font-size: 14px;
      }

      /* للشاشات الصغيرة */
      @media (max-width: 768px) {
        .zoom-controls {
          bottom: 10px;
          left: 10px;
          padding: 8px 12px;
          gap: 8px;
        }

        .zoom-controls button {
          width: 32px;
          height: 32px;
          font-size: 14px;
        }
      }
    `;

    document.head.appendChild(style);
  }
}

// تفعيل التحكم بالـ Zoom تلقائياً عند تحميل الصفحة
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.zoomControls = new ZoomControls();
  });
} else {
  window.zoomControls = new ZoomControls();
}
