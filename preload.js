const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('telemetryAPI', {
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  getSavedFolder: () => ipcRenderer.invoke('get-saved-folder'),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  saveTheme: theme => ipcRenderer.invoke('save-theme', theme),
  getExampleEnabled: () => ipcRenderer.invoke('get-example-enabled'),
  saveExampleEnabled: enabled => ipcRenderer.invoke('save-example-enabled', enabled),
  readExample: () => ipcRenderer.invoke('read-example-telemetry'),
  saveFolder: folder => ipcRenderer.invoke('save-folder', folder),
  openExternal: url => ipcRenderer.invoke('open-external', url),
  appInfo: () => ipcRenderer.invoke('app-info'),
  localization: () => ipcRenderer.invoke('localization'),
  readFolder: folder => ipcRenderer.invoke('read-telemetry-folder', folder),
  syncConfig: () => ipcRenderer.invoke('sync-config'),
  setAutoSync: enabled => ipcRenderer.invoke('sync-auto', enabled),
  listPhones: () => ipcRenderer.invoke('sync-devices'),
  syncPhone: deviceId => ipcRenderer.invoke('sync-start', deviceId),
  cancelSync: () => ipcRenderer.invoke('sync-cancel'),
  onSyncProgress: callback => {
    const listener = (_, progress) => callback(progress);
    ipcRenderer.on('sync-progress', listener);
    return () => ipcRenderer.removeListener('sync-progress', listener);
  }
});
