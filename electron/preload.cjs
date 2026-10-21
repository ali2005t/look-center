const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    license: {
        check: () => ipcRenderer.invoke('license:check'),
        activate: (code) => ipcRenderer.invoke('license:activate', code),
    },
    hardware: {
        openDrawer: () => ipcRenderer.invoke('drawer:open'),
        print: (content) => ipcRenderer.invoke('printer:print', content),
    },
    app: {
        quit: () => ipcRenderer.invoke('app:quit'),
    }
});
