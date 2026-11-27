// Rydehaven desktop app (Electron). Serves the game from inside the app at app://rydehaven/ (a proper secure origin,
// so Bluetooth and saved settings work), and shows our own Bluetooth device chooser.
const { app, BrowserWindow, protocol, net, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
if (!app.requestSingleInstanceLock()) app.quit();

const ROOT = app.getAppPath();                       // contains app/ and node_modules/
let win = null, btCallback = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: '#0e1013', title: 'Rydehaven', show: false,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL('app://rydehaven/app/index.html');

  // Web Bluetooth: Electron leaves the device chooser to the app. Forward the list to the page; it answers with the pick.
  win.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    btCallback = callback;
    win.webContents.send('bt-devices', devices.map((d) => ({ id: d.deviceId, name: d.deviceName || 'Unnamed device' })));
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  // email and web links open in the computer's own mail app or browser, never inside the game window
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('app://')) { event.preventDefault(); shell.openExternal(url); } });
  win.on('closed', () => { win = null; });
}

ipcMain.on('bt-choose', (_e, id) => { if (btCallback) { const cb = btCallback; btCallback = null; cb(id || ''); } });

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
    if (!file.startsWith(ROOT)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // let the page use Bluetooth without extra prompts (the OS still asks once on first use)
  const ses = win ? win.webContents.session : require('electron').session.defaultSession;
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'bluetooth' || permission === 'serial' || ['notifications', 'fullscreen'].includes(permission));
  ses.setDevicePermissionHandler((d) => d.deviceType === 'bluetooth');
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' }, { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
      { role: 'windowMenu' },
    ]));
  }
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
