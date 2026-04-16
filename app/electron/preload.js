const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getJavaStatus: () => ipcRenderer.invoke('java-status'),
  onJavaReady: (callback) => {
    ipcRenderer.on('java-ready', (_event) => callback());
    return () => ipcRenderer.removeAllListeners('java-ready');
  },
  openExternal: (url) => shell.openExternal(url),
  onNavigate: (callback) => {
    ipcRenderer.on('navigate', (_event, path) => callback(path));
    return () => ipcRenderer.removeAllListeners('navigate');
  },
});
