const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('interviewCopilotDesktop', Object.freeze({
  systemAudioLoopback: true
}));
