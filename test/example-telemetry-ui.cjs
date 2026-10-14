// Real bundled data, IPC handlers and persisted preference; isolated profile and no network.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { registerExampleTelemetry } = require('../lib/example-telemetry');
const root = path.join(__dirname, '..');
const profile = path.join(root, 'release', 'qa', 'example-profile');
const settingsFile = path.join(profile, 'settings.json');
app.setPath('userData', profile);
setTimeout(() => { console.error('Example UI test timed out'); app.exit(1); }, 40000).unref();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let failSave = false, failRead = false, missingFolder = false;
let folderFiles = [];
async function readSettings() {
  try { return JSON.parse(await fs.readFile(settingsFile, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}
async function updateSettings(values) {
  if (failSave) throw new Error('Fixture example save failure');
  await fs.writeFile(settingsFile, JSON.stringify({ ...await readSettings(), ...values }));
}
const expectedErrors = new Set(['Fixture example save failure', 'Fixture example read failure', 'Fixture personal folder unavailable', require('../src/locales/en.json').NO_SESSIONS_MATCH_FILTER]);
const originalError = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].startsWith('Error occurred in handler for ') && expectedErrors.has(args[1]?.message)) return;
  originalError(...args);
};
registerExampleTelemetry({ handle(channel, handler) {
  ipcMain.handle(channel, (...args) => {
    if (channel === 'read-example-telemetry' && failRead) throw new Error('Fixture example read failure');
    return handler(...args);
  });
}}, { root, readSettings, updateSettings });
ipcMain.handle('localization', () => ({ locale: 'en', dictionary: require('../src/locales/en.json'), english: require('../src/locales/en.json') }));
ipcMain.handle('app-info', () => ({ version: require('../package.json').version }));
ipcMain.handle('get-saved-folder', async () => (await readSettings()).telemetryFolder || null);
ipcMain.handle('get-theme', async () => (await readSettings()).theme || 'light');
ipcMain.handle('save-theme', (_, theme) => updateSettings({ theme }));
ipcMain.handle('sync-config', async () => ({ ...await readSettings(), supported: false }));
ipcMain.handle('read-telemetry-folder', () => {
  if (missingFolder) throw new Error('Fixture personal folder unavailable');
  return { files: folderFiles };
});
ipcMain.handle('choose-folder', () => null);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 1060,
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  // Cancel map tiles; local geometry remains fully testable.
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['https://*/*'] }, (_, callback) => callback({ cancel: true }));
  const errors = [];
  win.webContents.on('console-message', details => {
    if (details.level === 'error' && ![...expectedErrors].some(message => details.message.includes(message))) errors.push(details.message);
  });
  const run = code => win.webContents.executeJavaScript(code);
  async function until(code) {
    for (let attempt = 0; attempt < 100; attempt++) { if (await run(code)) return; await delay(30); }
    throw new Error('Timed out: ' + code);
  }
  async function open() {
    await win.loadFile(path.join(root, 'src', 'index_en.html'));
    await win.webContents.insertCSS('* { transition: none !important; animation: none !important; }');
    await until("!document.querySelector('#showExample').disabled && routeMap?.ready");
  }
  try {
    await fs.mkdir(profile, { recursive: true });
    await fs.writeFile(settingsFile, JSON.stringify({ theme: 'light', autoSync: false }));
    await open();
    assert.equal(await run('exampleEnabled'), false);
    assert.equal(await run("document.querySelector('#emptyState').classList.contains('hidden')"), false);
    assert.equal(await run("document.querySelector('#syncControls').disabled"), true);
    await run("document.querySelector('#tryExample').click()");
    await until("exampleEnabled && !document.querySelector('#showExample').disabled");
    assert.equal((await readSettings()).showExampleTelemetry, true);
    assert.equal(await run("document.querySelector('#filterMode').value"), 'example');
    assert.equal(await run('telemetrySessions.length'), 0);
    assert.equal(await run('selectedRows.size'), 742);
    assert.equal(await run('routeMap.model.measured'), 741);
    assert.equal(await run("document.querySelector('#exampleNotice').classList.contains('hidden')"), false);
    assert.match(await run("document.querySelector('#exampleNotice').textContent"), /excluded from your personal session totals/);
    assert.equal(await run("document.querySelector('#syncControls').disabled"), true);
    await run("focusSample('bundled-example:10')");
    assert.equal(await run('focusedSampleId'), 'bundled-example:10');
    // The initially hidden dashboard draws through ResizeObserver after becoming visible.
    await until("document.querySelector('#performanceChart').dataset.focusId === 'bundled-example:10'");
    assert.equal(await run("document.querySelector('#performanceChart').dataset.focusId"), 'bundled-example:10');
    await run('focusSample(null)');
    for (const theme of ['light', 'dark']) {
      await run(`document.querySelector('#theme${theme === 'light' ? 'Light' : 'Dark'}').click(); document.querySelector('.content').scrollTop = 0;`);
      await until(`document.documentElement.dataset.theme === '${theme}'`);
      await win.webContents.capturePage(); await delay(100);
      await fs.writeFile(path.join(root, 'release', 'qa', `example-overview-${theme}.png`), (await win.webContents.capturePage()).toPNG());
      await run("showPage('import')");
      await win.webContents.capturePage(); await delay(100);
      await fs.writeFile(path.join(root, 'release', 'qa', `example-import-${theme}.png`), (await win.webContents.capturePage()).toPNG());
      const bounds = await run(`(() => {
        const heading = document.querySelector('#exampleTitle').getBoundingClientRect();
        const toggle = document.querySelector('#showExample').getBoundingClientRect();
        return { gap: toggle.left - heading.right, inside: toggle.right <= innerWidth };
      })()`);
      assert.ok(bounds.gap > 0 && bounds.inside, 'Example title and switch fit');
      await run("showPage('overview')");
    }
    await open();
    assert.equal(await run('exampleEnabled'), true, 'Visibility survives a full renderer reload');
    await run('setExampleEnabled(false)');
    assert.equal((await readSettings()).showExampleTelemetry, false);
    assert.equal(await run('selectedRows.size'), 0);
    assert.equal(await run("document.querySelector('#filters').classList.contains('hidden')"), true);
    assert.equal(await run('routeMap.rows.length'), 0);
    await open();
    assert.equal(await run('exampleEnabled'), false, 'Hidden preference also survives reload');
    failRead = true;
    await run('setExampleEnabled(true)');
    assert.equal(await run('exampleEnabled'), false);
    assert.equal(await run("document.querySelector('#showExample').checked"), false);
    assert.match(await run("document.querySelector('#error').textContent"), /Fixture example read failure/);
    failRead = false;
    failSave = true;
    await run('setExampleEnabled(true)');
    assert.equal(await run('exampleEnabled'), false);
    assert.equal((await readSettings()).showExampleTelemetry, false);
    failSave = false;
    folderFiles = ['2026-10-02', '2026-10-03'].map((date, index) => ({ name: 'personal-' + index + '.csv', content:
      'Timestamp_ISO,Timestamp_UnixMs,Elapsed_Sec,Speed_kmh,Battery_Pct,Distance_km\n' +
      [0, 1].map(row => [date + 'T10:00:0' + row + 'Z', Date.parse(date) + row * 1000, row, 20 + row, 80 - row * 10, row * 2].join(',')).join('\n') }));
    await updateSettings({ telemetryFolder: 'C:\\Fixture rides' });
    await run("loadFolder('C:\\\\Fixture rides')");
    await run("document.querySelector('#filterMode').value = 'range'; document.querySelector('#dateFrom').value = '2026-10-03'; applyFilter();");
    assert.equal(await run('selectedRows.size'), 2);
    await run('setExampleEnabled(true)');
    assert.equal(await run('telemetrySessions.length'), 2);
    assert.equal(await run("document.querySelectorAll('#sessionSelect option').length"), 2);
    await run('setExampleEnabled(false)');
    assert.equal(await run("document.querySelector('#filterMode').value"), 'range');
    assert.equal(await run("document.querySelector('#dateFrom').value"), '2026-10-03');
    assert.equal(await run('selectedRows.size'), 2);
    await run("document.querySelector('#filterMode').value = 'session'; document.querySelector('#sessionSelect').value = '1'; applyFilter(); setExampleEnabled(true);");
    await until("exampleEnabled && !document.querySelector('#showExample').disabled");
    await run('setExampleEnabled(false)');
    assert.equal(await run("document.querySelector('#filterMode').value"), 'session');
    assert.equal(await run("document.querySelector('#sessionSelect').value"), '1');
    await run('setExampleEnabled(true)');
    await run("document.querySelector('#filterMode').value = 'all'; applyFilter()");
    assert.equal(await run('selectedRows.size'), 4);
    assert.equal(await run("document.querySelector('#exampleNotice').classList.contains('hidden')"), true);
    assert.equal(await run("[...selectedRows.values()].some(row => row.Session_Id === 'bundled-example')"), false);
    assert.match(await run("document.querySelector('#metrics').textContent"), /Distance4 km/);
    // A range with no matching personal sessions must not keep a disabled example visible.
    await run("document.querySelector('#filterMode').value = 'range'; document.querySelector('#dateFrom').value = '2026-10-04'; applyFilter()");
    await run('setExampleEnabled(true)');
    await run('setExampleEnabled(false)');
    assert.equal(await run("document.querySelector('#filterMode').value"), 'all');
    assert.equal(await run("[...selectedRows.values()].some(row => row.Session_Id === 'bundled-example')"), false);
    await run('setExampleEnabled(true)');
    await run("document.querySelector('#filterMode').value = 'example'; applyFilter()");
    failSave = true;
    await run('setExampleEnabled(false)');
    assert.equal(await run('exampleEnabled'), true);
    assert.equal(await run("document.querySelector('#showExample').checked"), true);
    assert.equal(await run('selectedRows.size'), 742);
    failSave = false;
    folderFiles = [];
    await run("document.querySelector('#filterMode').value = 'all'; applyFilter()");
    await run("loadFolder('C:\\\\Fixture rides')");
    assert.equal(await run('selectedRows.size'), 742, 'Empty folder does not hide an active example');
    await run('setExampleEnabled(false)');
    assert.equal(await run("document.querySelector('#emptyState').classList.contains('hidden')"), false);
    await run('setExampleEnabled(true)');
    missingFolder = true;
    await open();
    assert.equal(await run('exampleEnabled'), true, 'Unavailable saved personal folder does not block the example');
    assert.equal(await run('selectedRows.size'), 742);
    await run('setExampleEnabled(false)');
    assert.equal(await run("document.querySelector('#emptyState').classList.contains('hidden')"), false);
    assert.equal((await readSettings()).theme, 'dark');
    assert.equal((await readSettings()).telemetryFolder, 'C:\\Fixture rides');
    assert.deepEqual(errors, []);
    console.log('Example UI passed: original CSV, no-folder preview, GPS/chart focus, light/dark themes, preference persistence, personal totals and filter restoration, empty/unavailable folders, read/save rollback.');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
