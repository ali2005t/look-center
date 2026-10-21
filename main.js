const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let mainWindow;
let zoomLevel = 0; // 0 = 100%

// إنشاء مجلد البيانات الخاص بالبرنامج
function ensureDataFolder() {
  let dataFolder;

  // في بيئة الإنتاج (التطبيق المثبت)
  if (app.isPackaged) {
    dataFolder = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'LOOK CASHIER');
  } else {
    // في بيئة التطوير
    dataFolder = path.join(__dirname, 'data');
  }

  // إنشاء المجلد إذا لم يكن موجوداً
  if (!fs.existsSync(dataFolder)) {
    fs.mkdirSync(dataFolder, { recursive: true });
    console.log('Data folder created at:', dataFolder);
  }

  return dataFolder;
}

// استدعاء الدالة عند بدء التطبيق
const appDataFolder = ensureDataFolder();

// دالة تسجيل اختصارات الـ Zoom
function registerZoomShortcuts() {
  try {
    // Ctrl++ (Zoom In)
    globalShortcut.register('ctrl+=', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        zoomLevel += 0.1;
        if (zoomLevel > 2) zoomLevel = 2; // الحد الأقصى 200%
        mainWindow.webContents.setZoomFactor(1 + zoomLevel);
      }
    });
  } catch (e) {
    console.log('Could not register Ctrl+= shortcut');
  }

  try {
    // Ctrl+- (Zoom Out)
    globalShortcut.register('ctrl+-', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        zoomLevel -= 0.1;
        if (zoomLevel < -0.5) zoomLevel = -0.5; // الحد الأدنى 50%
        mainWindow.webContents.setZoomFactor(1 + zoomLevel);
      }
    });
  } catch (e) {
    console.log('Could not register Ctrl+- shortcut');
  }

  try {
    // Ctrl+0 (Reset Zoom)
    globalShortcut.register('ctrl+0', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        zoomLevel = 0;
        mainWindow.webContents.setZoomFactor(1);
      }
    });
  } catch (e) {
    console.log('Could not register Ctrl+0 shortcut');
  }

  // IPC listeners للـ Zoom من الـ UI
  ipcMain.on('zoom-in', () => {
    zoomLevel += 0.1;
    if (zoomLevel > 2) zoomLevel = 2;
    mainWindow.webContents.setZoomFactor(1 + zoomLevel);
  });

  ipcMain.on('zoom-out', () => {
    zoomLevel -= 0.1;
    if (zoomLevel < -0.5) zoomLevel = -0.5;
    mainWindow.webContents.setZoomFactor(1 + zoomLevel);
  });

  ipcMain.on('zoom-reset', () => {
    zoomLevel = 0;
    mainWindow.webContents.setZoomFactor(1);
  });

  ipcMain.on('get-zoom-level', (event) => {
    event.reply('zoom-level', zoomLevel);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'ico', 'ico.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('src_frontend/splash.html');

  // تسجيل اختصارات لوحة المفاتيح للـ Zoom
  registerZoomShortcuts();

  ipcMain.on('navigate-to-daily-closing', () => {
    mainWindow.loadFile('src_frontend/daily_closing.html');
  });

  // Handle navigation from sidebar
  ipcMain.on('navigate', (event, page) => {
    const validPages = [
      'dashboard.html', 'cashier.html', 'daily_closing.html',
      'invoices.html', 'unsubscribed_students.html', 'late_students.html',
      'subscriptions.html', 'users.html', 'reports.html',
      'expenses.html', 'settings.html', 'help.html'
    ];

    if (validPages.includes(page)) {
      mainWindow.loadFile(path.join('src_frontend', page));
    }
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll(); // إلغاء جميع الاختصارات
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
