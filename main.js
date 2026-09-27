const { app, BrowserWindow, dialog, ipcMain, shell, screen } = require('electron');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { createTransport } = require('./lib/wpd-transport');
const { sync } = require('./lib/sync-engine');
const { resolveWindowState, trackWindowState } = require('./lib/window-state');
let syncAbort = null;

function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function readSettingsSync() {
  try { return JSON.parse(fsSync.readFileSync(settingsPath(), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return {}; throw error; }
}
function writeSettingsSync(settings) {
  const filePath = settingsPath();
  fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = filePath + '.pending';
  fsSync.writeFileSync(temporary, JSON.stringify(settings, null, 2), 'utf8');
  fsSync.renameSync(temporary, filePath);
}
async function readSettings() {
  try { return JSON.parse(await fs.readFile(settingsPath(), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return {}; throw error; }
}
async function writeSettings(settings) {
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  const temporary = settingsPath() + '.pending';
  await fs.writeFile(temporary, JSON.stringify(settings, null, 2), 'utf8');
  await fs.rename(temporary, settingsPath());
}
let settingsQueue = Promise.resolve();
function updateSettings(values) {
  const next = settingsQueue.then(async () => writeSettings({ ...await readSettings(), ...values }));
  settingsQueue = next.catch(() => {});
  return next;
}

let mainWindow;
let windowTracker = null;
async function createWindow() {
  const settings = await readSettings();
  const displays = screen ? screen.getAllDisplays() : [];
  const windowState = resolveWindowState(settings.windowState, displays);

  const windowOptions = {
    width: windowState.width,
    height: windowState.height,
    minWidth: 1060,
    minHeight: 720,
    backgroundColor: '#f4f7fa',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  };

  if (typeof windowState.x === 'number' && typeof windowState.y === 'number') {
    windowOptions.x = windowState.x;
    windowOptions.y = windowState.y;
  }

  const win = mainWindow = new BrowserWindow(windowOptions);

  if (windowState.isMaximized) {
    win.maximize();
  }

  windowTracker = trackWindowState(win, (state) => {
    updateSettings({ windowState: state });
  }, {
    initialState: windowState,
    onSyncSave: (state) => {
      try {
        const current = readSettingsSync();
        writeSettingsSync({ ...current, windowState: state });
      } catch (err) {
        console.error('Failed to save window state synchronously on exit:', err);
      }
    }
  });

  win.loadFile(path.join(__dirname, 'src', 'index_en.html'));
  win.on('closed', () => {
    syncAbort?.abort();
    windowTracker?.destroy();
    windowTracker = null;
    mainWindow = null;
  });
}

ipcMain.handle('choose-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Where should telemetry CSV files be stored on this computer?', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('get-saved-folder', async () => {
  const settings = await readSettings();
  return settings.telemetryFolder || null;
});

ipcMain.handle('get-theme', async () => {
  const settings = await readSettings();
  return settings.theme === 'dark' ? 'dark' : 'light';
});

ipcMain.handle('save-theme', async (_, theme) => {
  if (theme !== 'light' && theme !== 'dark') throw new Error('Choose a valid theme.');
  await updateSettings({ theme });
  return theme;
});

ipcMain.handle('save-folder', async (_, folder) => {
  if (syncAbort) throw new Error('Wait for the current sync or cancel it before changing the destination.');
  if (typeof folder !== 'string' || !path.isAbsolute(folder) || !(await fs.stat(folder)).isDirectory()) throw new Error('Choose a valid destination folder.');
  await updateSettings({ telemetryFolder: folder });
});

ipcMain.handle('sync-config', async () => ({ ...await readSettings(), supported: process.platform === 'win32' }));
ipcMain.handle('sync-auto', async (_, enabled) => updateSettings({ autoSync: enabled === true }));
ipcMain.handle('sync-devices', async () => createTransport(app).devices());
ipcMain.handle('sync-cancel', () => { syncAbort?.abort(); });
ipcMain.handle('sync-start', async (event, deviceId) => {
  if (syncAbort) throw new Error('A sync is already running.');
  const controller = new AbortController();
  syncAbort = controller;
  try {
    const settings = await readSettings();
    if (!settings.telemetryFolder) throw new Error('Select a destination folder first.');
    const transport = createTransport(app);
    const device = (await transport.devices(controller.signal)).find(item => item.id === deviceId);
    if (!device) throw new Error('The selected phone is no longer connected.');
    await updateSettings({ syncDeviceId: device.id });
    let lastSent = 0;
    return await sync({ transport, device, folder: settings.telemetryFolder, signal: controller.signal,
      onProgress: progress => {
        const now = Date.now();
        if (progress.phase !== 'copying' || now - lastSent >= 100) {
          lastSent = now;
          if (!event.sender.isDestroyed()) event.sender.send('sync-progress', progress);
        }
      }
    });
  } finally { syncAbort = null; }
});

ipcMain.handle('open-external', async (_, url) => {
  const allowed = new Set([
    'https://ko-fi.com/j4ckp0t85',
    'https://www.paypal.com/donate/?business=ZDARGHTS7LUDA&no_recurring=1&currency_code=EUR'
  ]);
  if (!allowed.has(url)) throw new Error('External URL is not allowed.');
  await shell.openExternal(url);
});

ipcMain.handle('read-telemetry-folder', async (_, folder) => {
  try {
    const info = await fs.stat(folder);
    if (!info.isDirectory()) throw new Error('The saved telemetry path is not a folder.');
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`The telemetry folder is no longer available: ${folder}`);
    throw error;
  }
  const names = (await fs.readdir(folder, { withFileTypes: true }))
    .filter(item => item.isFile() && item.name.toLowerCase().endsWith('.csv'))
    .map(item => item.name);
  const files = [];
  for (const name of names) files.push({ name, content: await fs.readFile(path.join(folder, name), 'utf8') });
  return { folder, files };
});

app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
