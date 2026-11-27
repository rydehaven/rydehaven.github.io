// Bridge between the game page and the desktop shell: just the Bluetooth device chooser.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rydehavenDesktop', {
  platform: process.platform,
  onBtDevices: (cb) => { const h = (_e, list) => cb(list); ipcRenderer.on('bt-devices', h); return () => ipcRenderer.removeListener('bt-devices', h); },
  chooseBt: (id) => ipcRenderer.send('bt-choose', id),
});
