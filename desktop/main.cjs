const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('node:path');

let trustedOrigin = '';
let launcherWindow;
let appWindows = new Set();

function parseAppUrl(value) {
  const url = new URL(String(value || '').trim());
  const isLocalHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !isLocalHttp) throw new Error('Use your app’s HTTPS address. HTTP is allowed only for localhost testing.');
  if (url.username || url.password) throw new Error('Remove any username or password from the address.');
  return url.origin;
}

function createAppWindow(url, isCompanion = false) {
  const window = new BrowserWindow({
    width: isCompanion ? 980 : 1360,
    height: isCompanion ? 760 : 940,
    minWidth: 720,
    minHeight: 560,
    title: isCompanion ? 'Interviewer Audio · Interview Copilot' : 'Interview Copilot',
    autoHideMenuBar: true,
    backgroundColor: '#f6f7f4',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  appWindows.add(window);
  window.on('closed', () => appWindows.delete(window));

  window.webContents.setWindowOpenHandler(({ url: target }) => {
    try {
      const parsed = new URL(target);
      if (parsed.origin === trustedOrigin && (parsed.pathname === '/companion' || parsed.pathname === '/companion/')) {
        createAppWindow(target, true);
        return { action: 'deny' };
      }
      if (parsed.protocol === 'https:') shell.openExternal(target);
    } catch { /* Deny malformed or unsupported destinations. */ }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, target) => {
    try {
      if (new URL(target).origin !== trustedOrigin) event.preventDefault();
    } catch { event.preventDefault(); }
  });

  window.loadURL(url);
  return window;
}

function configureWindowsAudioCapture() {
  const appSession = session.defaultSession;
  appSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return permission === 'display-capture' && requestingOrigin === trustedOrigin;
  });
  appSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const allowed = permission === 'display-capture' && details?.requestingUrl
      && new URL(details.requestingUrl).origin === trustedOrigin;
    callback(Boolean(allowed));
  });

  appSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (process.platform !== 'win32' || request.securityOrigin !== trustedOrigin || !request.audioRequested) {
      callback(null);
      return;
    }
    try {
      const frame = request.frame;
      if (!frame || frame !== frame.top) {
        callback(null);
        return;
      }
      const frameUrl = new URL(frame.url);
      if (frameUrl.origin !== trustedOrigin || frameUrl.pathname !== '/companion') {
        callback(null);
        return;
      }
      // Electron's Windows loopback device taps the active system output mix,
      // including audio routed to wired, USB, and Bluetooth headphones. The
      // video track is limited to this companion page and is discarded there.
      callback({ video: frame, audio: 'loopback' });
    } catch {
      callback(null);
    }
  });
}

function createLauncher() {
  launcherWindow = new BrowserWindow({
    width: 560,
    height: 470,
    resizable: false,
    autoHideMenuBar: true,
    title: 'Interview Copilot Desktop',
    backgroundColor: '#f6f7f4',
    webPreferences: {
      preload: path.join(__dirname, 'launcher-preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  launcherWindow.loadFile(path.join(__dirname, 'launcher.html'));
}

ipcMain.handle('open-app', async (event, value) => {
  if (!launcherWindow || event.sender !== launcherWindow.webContents) return { ok: false, error: 'This action is available only from the desktop launcher.' };
  try {
    trustedOrigin = parseAppUrl(value);
    configureWindowsAudioCapture();
    const mainWindow = createAppWindow(trustedOrigin);
    if (launcherWindow && !launcherWindow.isDestroyed()) launcherWindow.close();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || 'Could not open that app address.' };
  }
});

app.whenReady().then(createLauncher);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (appWindows.size === 0 && (!launcherWindow || launcherWindow.isDestroyed())) createLauncher();
});
