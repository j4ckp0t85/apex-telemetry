// Hidden-window UI integration smoke test. Uses isolated settings and a simulated phone; no user files.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
ipcMain.handle('get-example-enabled', () => false);
ipcMain.handle('localization', () => ({ locale: 'en', dictionary: require('../src/locales/en.json'), english: require('../src/locales/en.json') }));
ipcMain.handle('app-info', () => ({ version: require('../package.json').version }));
app.setPath('userData', path.join(root, 'release', 'qa', 'smoke-profile'));
setTimeout(() => { console.error('UI smoke timed out'); app.exit(1); }, 30000).unref();
let config = { supported: true, telemetryFolder: 'C:\\Telemetry test folder', autoSync: false };
ipcMain.handle('sync-config', () => config);
ipcMain.handle('get-saved-folder', () => config.telemetryFolder);
ipcMain.handle('get-theme', () => 'dark');
ipcMain.handle('save-theme', () => {});
ipcMain.handle('read-telemetry-folder', () => ({ files: [] }));
ipcMain.handle('save-folder', () => {});
ipcMain.handle('sync-devices', () => [{ id: 'test', name: 'Test Android phone' }]);
ipcMain.handle('sync-auto', (_, value) => { config.autoSync = value; });
ipcMain.handle('sync-cancel', () => {});
ipcMain.handle('sync-start', async event => {
  event.sender.send('sync-progress', { phase: 'copying', message: 'Copying 2 of 5: telemetry_session_example.csv', bytes: 400000, totalBytes: 1000000 });
  await new Promise(resolve => setTimeout(resolve, 1600));
  return { added: 5, present: 3, pending: 0, errors: [], conflicts: [], cancelled: false, retainedBytes: 0 };
});
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 1060,
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  try {
    await win.loadFile(path.join(root, 'src', 'index_en.html'));
    await new Promise(resolve => setTimeout(resolve, 450));
    assert.equal(await win.webContents.executeJavaScript("document.documentElement.dataset.theme"), 'dark');
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('#themeDark').classList.contains('active')"), true);
    await win.webContents.executeJavaScript("document.querySelector('#themeLight').click()");
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(await win.webContents.executeJavaScript("document.documentElement.dataset.theme"), 'light');
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('#themeLight').classList.contains('active')"), true);
    assert.equal(await win.webContents.executeJavaScript("getComputedStyle(document.body).color"), 'rgb(17, 24, 39)');
    await win.webContents.executeJavaScript("document.querySelector('#themeDark').click()");
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(await win.webContents.executeJavaScript("document.documentElement.dataset.theme"), 'dark');
    assert.equal(await win.webContents.executeJavaScript("getComputedStyle(document.body).color"), 'rgb(237, 243, 246)');
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('#syncPhone').value"), 'test');
    await win.webContents.executeJavaScript("document.querySelector('#syncStart').click()");
    await new Promise(resolve => setTimeout(resolve, 450));
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('#syncProgress').value"), 40);
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('#chooseBtn').disabled"), true);
    await fs.mkdir(path.join(root, 'release', 'qa'), { recursive: true });
    await fs.writeFile(path.join(root, 'release', 'qa', 'usb-sync-progress.png'), (await win.webContents.capturePage()).toPNG());
    await new Promise(resolve => setTimeout(resolve, 1600));
    assert.match(await win.webContents.executeJavaScript("document.querySelector('#syncStatus').textContent"), /5 added, 3 already present/);
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('#chooseBtn').disabled"), false);
    // Exercise the real CSV parser, filters and renderer with recharging between
    // files, ambiguous charging inside a file, and a total greater than 100 pp.
    await win.webContents.executeJavaScript(`
      telemetrySessions = [
        ['2026-09-01', [100, 20]],
        ['2026-09-02', [100, 10]],
        ['2026-09-03', [80, 40, 90, 30]],
        ['2026-09-04', [50, '']]
      ].map(([date, values], index) => buildSession({ name: 'battery-' + index + '.csv', content:
        'Timestamp_ISO,Timestamp_UnixMs,Elapsed_Sec,Battery_Pct,Distance_km\\n' +
        values.map((value, row) => date + 'T10:00:0' + row + 'Z,' +
          (Date.parse(date) + row * 1000) + ',' + row + ',' + value + ',' + row).join('\\n')
      }, index));
      configureFilters();
      document.querySelector('#filterMode').value = 'all';
      applyFilter();
      showPage('overview');
    `);
    const metricCount = await win.webContents.executeJavaScript("document.querySelectorAll('#metrics .metric').length");
    assert.equal(metricCount, 5, 'Dashboard must have exactly 5 metric cards');
    const dropdownValues = await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('#sessionSelect option')).map(el => el.value)");
    assert.deepEqual(dropdownValues, ['3', '2', '1', '0'], 'Single session dropdown options must be in reverse chronological order (most recent first)');
    const cardTops = await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('#metrics .metric')).map(el => Math.round(el.getBoundingClientRect().top))");
    assert.equal(new Set(cardTops).size, 1, 'All metric cards must be on a single row');
    const cardLabels = await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('#metrics .metric-label')).map(el => el.textContent.trim())");
    assert.equal(cardLabels[0], 'Distance');
    assert.equal(cardLabels[1], 'Ride time');
    assert.equal(cardLabels[2], 'Top speed');
    assert.equal(cardLabels[3], 'Motor peak');
    assert.equal(cardLabels[4], 'Battery used');
    const allRideTimeCard = await win.webContents.executeJavaScript("document.querySelectorAll('#metrics .metric')[1].textContent");
    assert.match(allRideTimeCard, /Ride time/);
    assert.match(allRideTimeCard, /aggregated total/);
    const batteryText = () => win.webContents.executeJavaScript("document.querySelector('#batteryChart').textContent + ' ' + document.querySelector('#batteryNote').textContent");
    assert.match(await batteryText(), /170 pp/);
    assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('#batteryDischargeChart')"), false);
    assert.match(await batteryText(), /partial estimate/);
    assert.match(await batteryText(), /2 of 4 sessions/);
    assert.match(await batteryText(), /1 excluded:.*charge increased/);
    assert.match(await batteryText(), /1 excluded:.*missing/);
    assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#batteryChart .donut').length"), 0);
    for (const theme of ['light', 'dark']) {
      await win.webContents.executeJavaScript(`document.querySelector('#theme${theme === 'light' ? 'Light' : 'Dark'}').click()`);
      await new Promise(resolve => setTimeout(resolve, 150));
      assert.equal(await win.webContents.executeJavaScript('document.documentElement.dataset.theme'), theme);
      // A hidden window can return its previous compositor frame on first capture.
      await win.webContents.capturePage();
      await new Promise(resolve => setTimeout(resolve, 250));
      await fs.writeFile(path.join(root, 'release', 'qa', 'battery-' + theme + '.png'), (await win.webContents.capturePage()).toPNG());
    }
    await win.webContents.executeJavaScript(`
      document.querySelector('#filterMode').value = 'range';
      document.querySelector('#filterMode').dispatchEvent(new Event('change'));
      document.querySelector('#dateFrom').value = '2026-09-02';
      document.querySelector('#dateTo').value = '2026-09-03';
      document.querySelector('#applyFilter').click();
    `);
    assert.match(await batteryText(), /90 pp/);
    assert.match(await batteryText(), /1 of 2 sessions/);
    const rangeRideTime = await win.webContents.executeJavaScript("document.querySelectorAll('#metrics .metric-value')[1].textContent");
    assert.match(rangeRideTime, /\d+\s*h\s*\d+\s*min\s*\d{2}\s*s/);
    const rangeCardTops = await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('#metrics .metric')).map(el => Math.round(el.getBoundingClientRect().top))");
    assert.equal(new Set(rangeCardTops).size, 1, 'Range metric cards must stay on a single row');
    await win.webContents.executeJavaScript(`
      document.querySelector('#filterMode').value = 'session';
      document.querySelector('#sessionSelect').value = '2';
      document.querySelector('#filterMode').dispatchEvent(new Event('change'));
    `);
    assert.match(await batteryText(), /— pp.*unavailable/);
    assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('#batteryDischargeChart')"), false);
    await win.webContents.executeJavaScript(`
      document.querySelector('#sessionSelect').value = '0';
      document.querySelector('#sessionSelect').dispatchEvent(new Event('change'));
    `);
    assert.match(await batteryText(), /80 pp/);
    assert.match(await batteryText(), /Last reported charge 20%/);
    const sessionRideTime = await win.webContents.executeJavaScript("document.querySelectorAll('#metrics .metric-value')[1].textContent");
    assert.match(sessionRideTime, /\d+\s*h\s*\d+\s*min\s*\d{2}\s*s/);
    const sessionCardTops = await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('#metrics .metric')).map(el => Math.round(el.getBoundingClientRect().top))");
    assert.equal(new Set(sessionCardTops).size, 1, 'Single session metric cards must stay on a single row');
    assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('#batteryDischargeChart svg')"), true);
    assert.match(await win.webContents.executeJavaScript("document.querySelector('#batteryDischargeChart').textContent"), /100%/);
    // Use uneven timestamps and a threshold-sized decline to check time spacing,
    // step geometry, percentage tooltip and chart removal on subsequent filters.
    await win.webContents.executeJavaScript(`
      telemetrySessions = [buildSession({ name: 'discharge.csv', content:
        'Timestamp_ISO,Timestamp_UnixMs,Elapsed_Sec,Battery_Pct\\n' +
        '2026-09-01T10:00:00Z,1000,0,100\\n' +
        '2026-09-01T10:01:00Z,61000,60,98\\n' +
        '2026-09-01T10:10:00Z,601000,600,95'
      }, 0)];
      configureFilters(); applyFilter();
    `);
    const points = await win.webContents.executeJavaScript("document.querySelector('#batteryDischargeChart polyline').getAttribute('points').split(' ').map(point => point.split(',').map(Number))");
    assert.equal(points.length, 5);
    assert.ok(Math.abs((points[1][0] - points[0][0]) / (points[4][0] - points[0][0]) - 0.1) < 0.001);
    await win.webContents.executeJavaScript(`
      const chart = document.querySelector('#batteryDischargeChart');
      const rect = chart.querySelector('svg').getBoundingClientRect();
      chart.dispatchEvent(new MouseEvent('mousemove', { clientX: rect.left + rect.width / 2, clientY: rect.top + 70 }));
    `);
    assert.match(await win.webContents.executeJavaScript("document.querySelector('#batteryDischargeChart .chart-tooltip').textContent"), /Reported charge: 98 %/);
    // Axis glyphs retain their CSS size and proportions on laptop/2K windows,
    // at application zoom, and after rendering while the overview is hidden.
    const checkChartAxes = async () => {
      for (let attempt = 0; attempt < 40; attempt++) {
        const charts = await win.webContents.executeJavaScript(`
          [...document.querySelectorAll('.chart-svg')].map(svg => {
            const rect = svg.getBoundingClientRect(), box = svg.viewBox.baseVal;
            const labels = [...svg.querySelectorAll('.axis')].map(label => {
              const matrix = label.getScreenCTM(), bounds = label.getBoundingClientRect();
              return { scaleX: matrix.a, scaleY: matrix.d, font: getComputedStyle(label).fontSize,
                inside: bounds.left >= rect.left - 1 && bounds.right <= rect.right + 1 };
            });
            return { matches: Math.abs(rect.width - box.width) < 0.1 && Math.abs(rect.height - box.height) < 0.1, labels };
          })
        `);
        if (charts.length === 3 && charts.every(chart => chart.matches)) {
          for (const chart of charts) for (const label of chart.labels) {
            assert.ok(Math.abs(label.scaleX - label.scaleY) < 0.001, 'axis text must scale uniformly');
            assert.ok(Math.abs(label.scaleX - 1) < 0.001, 'axis text must retain its CSS size');
            assert.equal(label.font, '11px');
            assert.ok(label.inside, 'axis labels fit the chart');
          }
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.fail('Charts did not resize to their rendered dimensions');
    };
    for (const theme of ['light', 'dark']) {
      await win.webContents.executeJavaScript(`document.querySelector('#theme${theme === 'light' ? 'Light' : 'Dark'}').click(); focusSample('0:1');`);
      for (const [width, height, zoom] of [[1920, 1080, 1], [2560, 1440, 1], [1920, 1080, 1.25], [1060, 900, 1]]) {
        win.setContentSize(width, height);
        win.webContents.setZoomFactor(zoom);
        let actualWidth;
        for (let attempt = 0; attempt < 40; attempt++) {
          actualWidth = await win.webContents.executeJavaScript('innerWidth');
          if (Math.abs(actualWidth - width / zoom) < 1) break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.ok(Math.abs(actualWidth - width / zoom) < 1, `expected ${width / zoom}px viewport, got ${actualWidth}px`);
        await checkChartAxes();
        assert.deepEqual(await win.webContents.executeJavaScript("[...document.querySelectorAll('.chart-wrap')].map(chart => chart.dataset.focusId)"), ['0:1', '0:1', '0:1']);
        if (zoom === 1 && width >= 1920) {
          await win.webContents.executeJavaScript("focusSample(null); document.querySelector('.grid').scrollIntoView({block: 'start'});");
          await win.webContents.capturePage();
          await new Promise(resolve => setTimeout(resolve, 150));
          await fs.writeFile(path.join(root, 'release', 'qa', `chart-axes-${width}-${theme}.png`), (await win.webContents.capturePage()).toPNG());
          await win.webContents.executeJavaScript("focusSample('0:1');");
        }
      }
    }
    await win.webContents.executeJavaScript("showPage('import'); applyFilter();");
    win.setSize(1440, 1060);
    await win.webContents.executeJavaScript("showPage('overview');");
    await checkChartAxes();
    assert.equal(await win.webContents.executeJavaScript('chartLayouts.size'), 3);
    await win.webContents.executeJavaScript("document.querySelector('.content').scrollTop = 0;");
    for (const theme of ['light', 'dark']) {
      await win.webContents.executeJavaScript(`document.querySelector('#theme${theme === 'light' ? 'Light' : 'Dark'}').click()`);
      await win.webContents.capturePage();
      await new Promise(resolve => setTimeout(resolve, 300));
      await fs.writeFile(path.join(root, 'release', 'qa', 'battery-discharge-' + theme + '.png'), (await win.webContents.capturePage()).toPNG());
    }
    for (const mode of ['all', 'range']) {
      await win.webContents.executeJavaScript(`document.querySelector('#filterMode').value = '${mode}'; applyFilter();`);
      assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('#batteryDischargeChart')"), false);
    }
    await win.webContents.executeJavaScript(`
      document.querySelector('#filterMode').value = 'session';
      telemetrySessions[0].rows[2].Battery_Pct = 96;
      applyFilter();
    `);
    assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('#batteryDischargeChart')"), false);
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(root, 'release', 'qa', 'ui-smoke-result.json'), JSON.stringify({ passed: true, checked: ['phone selection', 'progress', 'disabled controls', 'summary', 'empty destination', 'battery totals above 100', 'battery exclusions', 'all/date/single filters', 'battery light/dark themes', 'undistorted chart axes at 1080p/2K/125% zoom', 'chart focus after resizing', 'hidden-page chart initialization'] }));
    console.log('UI smoke passed: sync, themes, battery totals, charging, missing readings, all/date/single filters, chart axes at 1080p/2K/125% zoom and hidden-page resizing.');
    app.exit(0);
  } catch (error) { await fs.writeFile(path.join(root, 'release', 'qa', 'ui-smoke-result.json'), JSON.stringify({ passed: false, error: error.message })); console.error(error); app.exit(1); }
});
