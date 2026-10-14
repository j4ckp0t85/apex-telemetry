// Real Electron windows, explicit system languages, synthetic data, no phone or network.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { supported, batches, resolveLocale, create } = require('../src/i18n');
const english = require('../src/locales/en.json');
const root = path.join(__dirname, '..');
ipcMain.handle('get-example-enabled', () => false);
app.setPath('userData', path.join(root, 'release', 'qa', 'i18n-profile'));
app.on('window-all-closed', () => {});
const batchName = process.argv[2];
// Release checks use English. Regional batches remain available for manual review.
const selected = batchName ? batches[batchName] : ['en'];
if (!selected) throw new Error('Unknown localization batch: ' + batchName);
const cases = [...selected, ...(!batchName || batchName === 'europe' ? ['eo', 'ipc-failure'] : [])];
let systemLanguage = 'en-US';
let rejectLocalization = false;
const fixtureFailure = 'Fixture localization IPC failure';
let expectedFailureLogs = 0;
const originalConsoleError = console.error;
// Electron logs rejected handlers even when the renderer correctly recovers.
// Capture only this exact, expected fixture exception; all other errors stay visible.
console.error = (...args) => {
  const [message, error, ...details] = args;
  if (rejectLocalization && message === "Error occurred in handler for 'localization':" && error?.message === fixtureFailure && details.length === 0) {
    expectedFailureLogs++;
    return;
  }
  originalConsoleError(...args);
};
let finishSync;
ipcMain.handle('localization', async () => {
  // Delayed IPC verifies that initialization really waits for the dictionary.
  await new Promise(resolve => setTimeout(resolve, 40));
  if (rejectLocalization) throw new Error(fixtureFailure);
  return require('../lib/localization').systemLocalization({ getPreferredSystemLanguages: () => [systemLanguage] });
});
ipcMain.handle('app-info', () => ({ version: require('../package.json').version }));
ipcMain.handle('get-saved-folder', () => null);
ipcMain.handle('get-theme', () => 'light');
ipcMain.handle('save-theme', () => null);
ipcMain.handle('sync-config', () => ({ supported: true, telemetryFolder: 'C:\\Telemetry', autoSync: false }));
ipcMain.handle('sync-devices', () => [{ id: 'fixture', name: 'Fixture phone' }]);
ipcMain.handle('read-telemetry-folder', () => ({ files: [] }));
ipcMain.handle('sync-start', async event => {
  event.sender.send('sync-progress', { phase: 'copying', message: 'Copying 1 of 2: session.csv', bytes: 50, totalBytes: 100 });
  await new Promise(resolve => { finishSync = resolve; });
  return { added: 1, present: 2, pending: 0, errors: ['session.csv: Invalid GPS coordinate.'], conflicts: [], retainedBytes: 0, cancelled: false };
});
ipcMain.handle('choose-folder', () => null);
ipcMain.handle('sync-cancel', () => null);
ipcMain.handle('sync-auto', () => null);
setTimeout(() => { console.error('Localization UI test timed out'); app.exit(1); }, cases.length * 15000 + 15000).unref();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) { if (await predicate()) return; await delay(30); }
  throw new Error('Timed out waiting for localized UI');
}
app.whenReady().then(async () => {
  try {
    await fs.mkdir(path.join(root, 'release', 'qa'), { recursive: true });
    for (const locale of cases) {
      rejectLocalization = locale === 'ipc-failure';
      systemLanguage = locale === 'en' ? 'en-US' : locale === 'pt' ? 'pt-BR' : locale;
      const language = resolveLocale(systemLanguage);
      const expected = create(systemLanguage, require(`../src/locales/${language}.json`), english);
      const slotText = text => expected.direction === 'rtl' ? '\u2068' + text + '\u2069' : text;
      const win = new BrowserWindow({ show: false, width: 1440, height: 1060,
        webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
      // Cancel any accidental external tile requests: map tests use local geometry.
      win.webContents.session.webRequest.onBeforeRequest({ urls: ['https://*/*'] }, (_, callback) => callback({ cancel: true }));
      const errors = [];
      win.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
      const run = code => win.webContents.executeJavaScript(code);
      await win.loadFile(path.join(root, 'src', 'index_en.html'));
      // Hidden-window compositors can leave CSS transitions halfway through a capture.
      // Inspect the final theme state deterministically, without changing production motion.
      await win.webContents.insertCSS('* { transition: none !important; animation: none !important; }');
      await until(() => run(`document.documentElement.lang === '${language}' && !!routeMap?.ready && !!document.querySelector('#syncPhone')?.value`));
      assert.equal(await run('document.documentElement.dir'), expected.direction);
      if (rejectLocalization) {
        assert.equal(expectedFailureLogs, 1, 'The expected localization IPC failure occurred exactly once');
        assert.deepEqual(await run('i18n.english'), english, 'IPC failure loads the complete bundled English catalog');
      }
      assert.equal(await run("getComputedStyle(document.querySelector('#sampleSlider')).direction"), 'ltr');
      assert.equal(await run("document.querySelector('#pageTitle').textContent"), expected.t('RIDE_OVERVIEW'));
      assert.equal(await run("document.querySelector('#themeLight').getAttribute('aria-label')"), expected.t('LIGHT_THEME'));
      assert.equal(await run("document.querySelector('#syncHeading').textContent"), expected.t('SYNC_FROM_PHONE'));
      assert.equal(await run("document.querySelector('#chooseBtn').textContent.trim()"), '⇄ ' + expected.t('CHANGE_FOLDER'));
      assert.equal(await run("document.querySelector('#importInstruction b').textContent"), slotText(expected.t('IMPORT_DATA')));
      assert.deepEqual(await run("Array.from(document.querySelectorAll('.phone-sync .sync-hint b')).map(element => element.textContent)"),
        [expected.t('PHONE_FILE_TRANSFER_MODE'), 'DCIM', 'Pictures'].map(slotText));
      assert.equal(await run("document.querySelector('#donationTitle').textContent"), '// ' + expected.t('SUPPORT_PROJECT_DIALOG_TITLE'));
      for (const id of ['donateKofi', 'donatePaypal']) {
        assert.equal(await run(`document.querySelector('#${id} > b').textContent`), expected.t('DONATE_WITH_ARROW') + ' ↗');
        assert.equal(await run(`getComputedStyle(document.querySelector('#${id} > b > span')).display`), 'inline', 'Donation labels retain inline layout');
        assert.equal(await run(`getComputedStyle(document.querySelector('#${id} > b > span[aria-hidden]')).display`), 'inline', 'Donation arrows retain inline layout');
      }
      const frame = win.webContents.mainFrame.frames.find(item => item.url.endsWith('/route-frame.html'));
      assert.ok(frame);
      const frameRun = code => frame.executeJavaScript(code);
      await until(() => frameRun(`document.documentElement.lang === '${language}'`));
      await frameRun("document.querySelector('#onlineTiles').checked = false; updateTiles()");
      assert.equal(await frameRun("document.querySelector('#fitRoute').textContent"), expected.t('FIT_ROUTE'));
      assert.equal(await frameRun("document.querySelector('.leaflet-control-zoom-in').title"), expected.t('ZOOM_IN'));
      assert.equal(await frameRun('typeof window.telemetryAPI'), 'undefined');
      assert.equal(await frameRun('document.documentElement.dir'), expected.direction);
      assert.equal(await frameRun("getComputedStyle(document.querySelector('#map')).direction"), 'ltr');
      await run("showPage('import'); document.querySelector('#syncStart').click()");
      await until(() => run("document.querySelector('#syncProgress').value === 50"));
      assert.equal(await run("document.querySelector('#syncStatus').textContent"), expected.message('Copying 1 of 2: session.csv'));
      finishSync();
      await until(() => run("document.querySelector('#syncCancel').classList.contains('hidden') && document.querySelector('#syncDetails li') !== null"));
      assert.equal(await run("document.querySelector('#syncDetails li').textContent"), expected.message('session.csv: Invalid GPS coordinate.'));
      assert.equal(await run("document.querySelector('#syncStatus').textContent"), expected.t('SYNC_RESULT_SUMMARY', {
        status: expected.t('SYNC_NEEDS_ATTENTION'), added: expected.number(1, 0), present: expected.number(2, 0), pending: expected.number(0, 0)
      }));
      await run(`
        telemetrySessions = [buildSession({ name: 'Fixture.csv', content:
          'Timestamp_ISO,Timestamp_UnixMs,Elapsed_Sec,Speed_kmh,Motor_Watts,Rider_Watts,Cadence_RPM,Motor_Temp_C,Controller_Temp_C,Battery_Pct,Battery_Voltage_V,Distance_km,Assist_Level,GPS_Latitude,GPS_Longitude\\n' +
          '2026-10-01T10:00:00Z,1000,0,12.5,200,80,70,38,30,100,52.5,0,1,46,11\\n' +
          '2026-10-01T10:00:10Z,11000,10,12.5,200,80,70,38,30,90,52.5,0.1,1,46.0001,11.0001'
        }, 0)];
        configureFilters(); document.querySelector('#filterMode').value = 'session'; applyFilter(); showPage('overview'); focusSample('0:1');
      `);
      await until(() => frameRun("document.body.dataset.focusId === '0:1'"));
      assert.equal(await frameRun("document.querySelector('#sampleSpeed').textContent"), expected.number(12.5));
      assert.equal(await frameRun("document.querySelector('#readoutGps').textContent"), expected.t('RECORDED_GPS_POSITION'));
      const plain = text => text.replace(/[\u2068\u2069]/g, '');
      assert.ok(plain(await run("document.querySelector('#sourceText').textContent")).startsWith(plain(expected.t('SESSION_COUNT', { count: 1 }))), locale);
      assert.ok((await run("document.querySelector('#batteryNote').textContent")).includes(expected.t('BATTERY_PROVENANCE_NOTICE')));
      assert.ok((await run("document.querySelector('#routeNote').textContent")).includes(expected.t('GPS_STRAIGHT_CONNECTION_NOTICE')));
      assert.deepEqual(await run("Array.from(document.querySelectorAll('#batteryNote b')).map(element => element.textContent)"), [
        expected.t('BATTERY_INCLUDED_SESSIONS', { included: expected.number(1, 0), total: expected.number(1, 0) }),
        expected.t('BATTERY_CHARGE_VALUE', { charge: expected.number(90, 0) }),
        expected.t('BATTERY_RANGE_VALUE', { range: '—' })
      ].map(slotText));
      assert.ok(!/\{\w+\}/.test(await run('document.body.textContent')), `${locale}: no unresolved message slots`);
      // Layout checks use the same minimum window size as the application.
      for (const width of [1440, 1060]) {
        win.setSize(width, 1060); await delay(80);
        assert.deepEqual(await run(`Array.from(document.querySelectorAll('.sidebar .nav')).filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.textContent)`), [], `${locale} sidebar labels at ${width}px`);
        const clipped = await frameRun(`Array.from(document.querySelectorAll('.readout-values dt')).filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.textContent)`);
        assert.deepEqual(clipped, [], `${locale} readout labels at ${width}px`);
        assert.equal(await frameRun('document.body.scrollWidth <= innerWidth'), true, `${locale} map width`);
        const dimensions = await frameRun(`(() => { const element = document.querySelector('.sample-readout'); return { height: element.clientHeight, content: element.scrollHeight, reference: document.querySelector('.readout-reference').clientHeight, toolbar: document.querySelector('.map-toolbar').clientHeight, values: document.querySelector('.readout-values').clientHeight, gps: document.querySelector('.readout-gps').clientHeight }; })()`);
        if (dimensions.content > dimensions.height + 1) await fs.writeFile(path.join(root, 'release', 'qa', `i18n-${locale}-overflow.png`), (await win.webContents.capturePage()).toPNG());
        assert.ok(dimensions.content <= dimensions.height + 1, `${locale} readout fits vertically at ${width}px: ${JSON.stringify(dimensions)}`);
        assert.equal(await frameRun("document.querySelector('.readout-heading strong').scrollWidth <= document.querySelector('.readout-heading strong').clientWidth + 1"), true, `${locale} heading fits at ${width}px`);
      }
      win.setSize(1440, 1060);
      for (const theme of ['light', 'dark']) {
        await run(`document.querySelector('#theme${theme === 'light' ? 'Light' : 'Dark'}').click()`);
        await until(() => frameRun(`document.documentElement.dataset.theme === '${theme}'`));
        await win.webContents.capturePage(); await delay(250);
        if (supported.includes(locale)) await fs.writeFile(path.join(root, 'release', 'qa', `i18n-${locale}-${theme}.png`), (await win.webContents.capturePage()).toPNG());
      }
      if (['en', 'it', 'ar'].includes(locale)) {
        await run("document.querySelector('#donationOpen').click()");
        assert.equal(await run("document.querySelector('#donationModal').classList.contains('hidden')"), false);
        await win.webContents.capturePage(); await delay(250);
        await fs.writeFile(path.join(root, 'release', 'qa', `i18n-${locale}-donation-dark.png`), (await win.webContents.capturePage()).toPNG());
        await run("document.querySelector('#donationClose').click()");
      }
      assert.deepEqual(errors, [], locale);
      win.destroy();
    }
    console.error = originalConsoleError;
    console.log(`Localization UI passed: ${batchName ? batchName + ' batch, ' + selected.length + ' languages' : 'English, unsupported-language and simulated IPC-failure fallback'}, delayed initialization, sync messages, original samples, map isolation, themes and label fit.`);
    app.exit(0);
  } catch (error) { console.error = originalConsoleError; console.error(error); app.exit(1); }
});
