// Electron Navigation Helper
// This script provides navigation functionality for Electron apps

// Setup IPC communication with main process
const electronAPI = {
  navigate: (page) => {
    if (window.require) {
      try {
        const { ipcRenderer } = window.require('electron');
        ipcRenderer.send('navigate', page);
      } catch (err) {
        console.error('IPC navigation failed:', err);
        // Fallback to regular navigation
        window.location.href = page;
      }
    } else {
      // Not in Electron, use regular navigation
      window.location.href = page;
    }
  }
};

// Make API available globally
window.electronAPI = electronAPI;

// Auto-detect if we're in Electron and use IPC
document.addEventListener('DOMContentLoaded', function () {
  // Check if we're in Electron
  if (window.require && window.require('electron')) {
    console.log('Electron environment detected, enabling IPC navigation');
  } else if (window.__TAURI__) {
    console.log('Tauri environment detected, using regular navigation');
  } else {
    console.log('Browser environment detected, using regular navigation');
  }
});
