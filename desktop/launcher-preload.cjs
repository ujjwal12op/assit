const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('interviewCopilotDesktop', Object.freeze({
  openApp: (url) => ipcRenderer.invoke('open-app', url)
}));
