const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const isDev = !app.isPackaged;
const Store = require('electron-store');

const store = new Store();

let mainWindow;
let splashWindow;

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 500,
    height: 300,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.center();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    fullscreen: true,
    show: false, // Hidden until splash finishes
    title: 'ASAS look cashier POS',
    icon: path.join(__dirname, 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const startUrl = isDev
    ? 'http://localhost:5173'
    : `file://${path.join(__dirname, '../src_frontend/splash.html')}`;

  mainWindow.loadURL(startUrl);

  mainWindow.once('ready-to-show', () => {
    // Stage 1 transition: 10 seconds delay as requested
    setTimeout(() => {
      if (splashWindow) {
        splashWindow.close();
        splashWindow = null;
      }
      mainWindow.show();
      mainWindow.setFullScreen(true);
    }, 10000);
  });

  // DevTools in dev mode
  // if (isDev) {
  //   mainWindow.webContents.openDevTools();
  // }
}

app.whenReady().then(() => {
  createSplashWindow();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- Licensing Logic ---

ipcMain.handle('license:check', async () => {
  const isActivated = store.get('isActivated', false);
  const trialStartDate = store.get('trialStartDate');
  const activationCode = store.get('activationCode', '');

  if (!trialStartDate) {
    store.set('trialStartDate', Date.now());
  }

  const start = trialStartDate || Date.now();
  const now = Date.now();
  const diff = now - start;
  const daysUsed = Math.floor(diff / (1000 * 60 * 60 * 24));
  const daysRemaining = Math.max(0, 7 - daysUsed);

  return {
    isActivated,
    daysRemaining,
    isExpired: !isActivated && daysRemaining === 0,
    activationCode
  };
});

ipcMain.handle('license:activate', async (event, code) => {
  // Backend verification simulation (Mock Firebase Check)
  // Real implementation would fetch URL

  // Validate format ASAS-XXXX-XXXX-XXXX
  const regex = /^ASAS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
  if (!regex.test(code)) {
    return { success: false, message: 'Invalid code format' };
  }

  // Persist activation state locally
  // Verification already done in Renderer (Firebase)

  store.set('isActivated', true);
  store.set('activationCode', code);

  return { success: true };
});

// --- Hardware Integration ---

ipcMain.handle('printer:print', async (event, content) => {
  // For simple window print, renderer can handle window.print()
  // This hook allows for silent printing or selecting specific printers if needed
  // For now, we rely on the renderer calling window.print(), but we could implement
  // silent printing here using mainWindow.webContents.print({ silent: true, ... })
  return true;
});

ipcMain.handle('drawer:open', async () => {
  // Send ESC/POS pulse command to default printer
  // \x1B\x70\x00\x19\xFA = Open Drawer 1 (Pulse 25ms on, 250ms off)
  // This requires writing raw bytes to printer.
  // In Electron, we might need a dedicated Node module like `electron-pos-printer` or `node-printer`
  // However, simpler hack: Print a tiny empty page with special control codes? No, standard drivers filter them.
  // We will use a placebo log for now until we add `node-printer` or similar native module if requested.
  // Many USB printers open drawer on ANY print job.
  console.log("Opening Cash Drawer...");
  return true;
});

ipcMain.handle('app:quit', () => {
  app.quit();
});
