// Real hidden Electron renderer, synthetic rides and local fixture tiles only.
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
ipcMain.handle('get-example-enabled', () => false);
ipcMain.handle('localization', () => ({ locale: 'en', dictionary: require('../src/locales/en.json'), english: require('../src/locales/en.json') }));
ipcMain.handle('app-info', () => ({ version: require('../package.json').version }));
app.setPath('userData', path.join(root, 'release', 'qa', 'gps-profile'));
setTimeout(() => { console.error('GPS UI test timed out'); app.exit(1); }, 45000).unref();
for (const [channel, result] of Object.entries({ 'sync-config': { supported: false }, 'get-saved-folder': null, 'get-theme': 'light', 'save-theme': null })) ipcMain.handle(channel, () => result);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  for (let i = 0; i < 80; i++) { if (await predicate()) return; await delay(50); }
  throw new Error('Timed out waiting for renderer state');
}
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 1250,
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', details => { if (details.level === 'error' && !details.message.includes('503')) errors.push(details.message); });
  let tileRequests = 0, failTiles = false;
  const bitmap = Buffer.alloc(256 * 256 * 4);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const offset = (y * 256 + x) * 4, shade = x % 64 === 0 || y % 64 === 0 ? 200 : 230;
    bitmap[offset] = shade; bitmap[offset + 1] = shade; bitmap[offset + 2] = shade; bitmap[offset + 3] = 255;
  }
  const tile = nativeImage.createFromBitmap(bitmap, { width: 256, height: 256 }).toPNG();
  await win.webContents.session.protocol.handle('https', request => {
    assert.equal(new URL(request.url).hostname, 'tile.openstreetmap.org');
    tileRequests++;
    return new Response(failTiles ? '' : tile, { status: failTiles ? 503 : 200, headers: { 'Content-Type': 'image/png' } });
  });
  const run = code => win.webContents.executeJavaScript(code);
  try {
    await fs.mkdir(path.join(root, 'release', 'qa'), { recursive: true });
    await win.loadFile(path.join(root, 'src', 'index_en.html'));
    await until(() => run('!!routeMap?.ready'));
    const frame = win.webContents.mainFrame.frames.find(item => item.url.endsWith('/route-frame.html'));
    assert.ok(frame);
    const frameRun = code => frame.executeJavaScript(code, true);
    await run(`
      telemetrySessions = [buildSession({ name: 'Synthetic mountain ride.csv', content:
        'Timestamp_ISO,Timestamp_UnixMs,Elapsed_Sec,Speed_kmh,Motor_Watts,Rider_Watts,Cadence_RPM,Motor_Temp_C,Controller_Temp_C,Battery_Pct,Battery_Voltage_V,Distance_km,Assist_Level,GPS_Latitude,GPS_Longitude\\n' +
        Array.from({length: 900}, (_, i) => {
          const missing = (i >= 51 && i <= 54) || (i >= 200 && i <= 245);
          return [new Date(1791360000000 + i * 1000).toISOString(), 1791360000000 + i * 1000, i,
            15 + 5 * Math.sin(i / 30), 200 + i % 80, 80 + i % 20, 70 + i % 10, 38 + i % 5, 30 + i % 3, 100 - Math.floor(i / 60), 52.5, i / 500, i % 4,
            missing ? 'null' : 46 + .004 * Math.sin(i / 160), missing ? 'null' : 11 + i * .000018 + .002 * Math.sin(i / 100)].join(',');
        }).join('\\n') }, 0)];
      configureFilters(); document.querySelector('#filterMode').value = 'session'; applyFilter();
    `);
    await until(() => frameRun('model?.total === 900 && map.getSize().y > 200'));
    assert.equal(await frameRun('typeof window.telemetryAPI'), 'undefined');
    assert.equal(await frameRun('model.estimated'), 4);
    assert.equal(await frameRun('model.segments.length'), 2);
    assert.ok(tileRequests > 0);
    // Hover a sample omitted by downsampling: every chart and the map use its ID.
    for (const chart of ['performanceChart', 'temperatureChart', 'batteryDischargeChart']) {
      await run(`{
        const chart = document.querySelector('#${chart}'), rect = chart.querySelector('svg').getBoundingClientRect();
        const width = chart.querySelector('svg').viewBox.baseVal.width;
        const event = new MouseEvent('mousemove', { clientX: rect.left + (42 + 513 / 899 * (width - 54)) / width * rect.width, clientY: rect.top + 50 });
        // MouseEvent rounds to a physical CSS pixel; inspect the closest original row.
        window.expectedHoverId = nearestSample([...selectedRows.values()], (((event.clientX - rect.left) / rect.width * width - 42) / (width - 54)) * (899 / 60)).Sample_Id;
        chart.dispatchEvent(event);
      }`);
      const expectedId = await run('window.expectedHoverId');
      await until(() => frameRun(`document.body.dataset.focusId === '${expectedId}'`));
      assert.deepEqual(await run("[...document.querySelectorAll('.chart-wrap')].map(chart => chart.dataset.focusId)"), [expectedId, expectedId, expectedId]);
    }
    await run("document.querySelector('#sampleSlider').value = 513; document.querySelector('#sampleSlider').dispatchEvent(new Event('input'))");
    await until(() => frameRun("document.body.dataset.focusId === '0:513'"));
    await frameRun("map.fire('mousemove', { latlng: L.latLng(samples.get('0:120').lat, samples.get('0:120').lng) })");
    await until(() => run("focusedSampleId === '0:120'"));
    assert.deepEqual(await run("[...document.querySelectorAll('.chart-wrap')].map(chart => chart.dataset.focusId)"), ['0:120', '0:120', '0:120']);
    assert.equal(await run("document.querySelector('#assistChart .sample-active').dataset.level"), '0');
    assert.deepEqual(await frameRun("['sampleSpeed','sampleMotor','sampleRider','sampleCadence','sampleMotorTemp','sampleControllerTemp','sampleBattery','sampleVoltage','sampleDistance','sampleAssist'].map(id=>document.getElementById(id).textContent)"), ['11.2','240','80','70','38','30','98','52.5','0.24','0']);
    await frameRun("map.fire('mouseout')");
    await until(() => frameRun("document.querySelector('#readoutStatus').textContent === 'Last inspected'"));
    assert.equal(await frameRun("document.querySelector('#sampleMotor').textContent"), '240');
    await run("document.querySelector('#assistChart [data-level=\"2\"]').dispatchEvent(new MouseEvent('mouseenter'))");
    await until(() => frameRun("document.body.dataset.focusId === '0:2'"));
    for (const [index, kind] of [[52, 'estimated'], [220, 'missing']]) {
      await run(`document.querySelector('#sampleSlider').value = ${index}; document.querySelector('#sampleSlider').dispatchEvent(new Event('input'))`);
      await until(() => frameRun(`document.body.dataset.focusKind === '${kind}'`));
      assert.equal(await frameRun('map.hasLayer(focusMarker)'), kind !== 'missing');
      assert.match(await frameRun("document.querySelector('#readoutGps').textContent"), kind === 'estimated' ? /estimated/ : /unavailable/);
    }
    // Panning, zoom and fit retain an interactive map.
    const zoom = await frameRun('map.getZoom()');
    await frameRun("document.querySelector('.leaflet-control-zoom-in').click()");
    await until(() => frameRun(`map.getZoom() === ${zoom + 1} && !map._animatingZoom`));
    const center = await frameRun('map.getCenter().lng');
    await frameRun('map.panBy([80, 0], { animate: false })');
    assert.notEqual(await frameRun('map.getCenter().lng'), center);
    await frameRun("document.querySelector('#fitRoute').click()");
    await frameRun("document.querySelector('#fullscreen').click()");
    await until(() => frameRun('!!document.fullscreenElement'));
    assert.equal(await frameRun("document.querySelector('.sample-readout').getBoundingClientRect().width > 0"), true);
    assert.equal(await frameRun("document.querySelector('#sampleMotor').textContent"), '260');
    await frameRun('document.exitFullscreen()');
    await until(() => frameRun('!document.fullscreenElement'));
    // Disabling background prevents further tile requests, preserves the local route.
    await frameRun("document.querySelector('#onlineTiles').click()");
    const requestsBefore = tileRequests;
    await frameRun('map.setZoom(map.getZoom() + 1)');
    await delay(300);
    assert.equal(tileRequests, requestsBefore);
    assert.equal(await frameRun('map.hasLayer(tiles)'), false);
    assert.ok(await frameRun('routes.getLayers().length > 0'));
    failTiles = true;
    await frameRun("document.querySelector('#onlineTiles').click()");
    await until(() => frameRun('tileErrors > 0'));
    assert.match(await frameRun("document.querySelector('#tileStatus').textContent"), /unavailable or incomplete/);
    assert.ok(await frameRun('routes.getLayers().length > 0'));
    failTiles = false;
    await frameRun("document.querySelector('#onlineTiles').click(); document.querySelector('#onlineTiles').click(); document.querySelector('#fitRoute').click()");
    await run("focusSample('0:120'); document.querySelector('.content').scrollTop = 250");
    // Readouts fit beside the map at laptop resolutions; narrow layouts place them below it.
    for (const [width, height] of [[1980, 1020], [1280, 800], [1060, 720]]) {
      win.setSize(width, height);
      await delay(200);
      const layout = await frameRun(`(() => {
        const panel = document.querySelector('.sample-readout'), rect = panel.getBoundingClientRect();
        return { scroll: panel.scrollHeight, height: panel.clientHeight, bottom: rect.bottom, viewportHeight: innerHeight,
          mapHeight: document.querySelector('#map').getBoundingClientRect().height, pageWidth: document.body.scrollWidth, viewportWidth: innerWidth };
      })()`);
      assert.ok(layout.scroll <= layout.height + 1 && layout.bottom <= layout.viewportHeight && layout.mapHeight >= 140 && layout.pageWidth <= layout.viewportWidth,
        `Readout fits at ${width}x${height}: ${JSON.stringify(layout)}`);
    }
    win.setSize(1980, 1020);
    await delay(150);
    for (const theme of ['light', 'dark']) {
      await run(`document.querySelector('#theme${theme === 'light' ? 'Light' : 'Dark'}').click()`);
      await until(() => frameRun(`document.documentElement.dataset.theme === '${theme}'`));
      await win.webContents.capturePage(); await delay(200);
      await fs.writeFile(path.join(root, 'release', 'qa', `gps-map-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    }
    // Legacy/no-GPS filtering clears the map and cannot accept stale focus events.
    await run(`telemetrySessions.push(buildSession({name:'Legacy.csv', content:'Timestamp_ISO,Timestamp_UnixMs,Battery_Pct\\n2026-10-01T00:00:00Z,1000,100\\n2026-10-01T00:00:01Z,2000,90'},1)); configureFilters(); document.querySelector('#sessionSelect').value='1'; applyFilter();`);
    await until(() => frameRun('model?.measured === 0'));
    assert.equal(await run("document.querySelector('#routeFrame').classList.contains('hidden')"), true);
    assert.match(await run("document.querySelector('#routeSummary').textContent"), /not recorded/);
    assert.equal(await run('focusedSampleId'), null);
    assert.equal(await frameRun("document.querySelector('#sampleMotor').textContent"), '—');
    await frameRun("parent.postMessage({channel:'apex-route',type:'hover',generation:generation-1,id:'0:120'}, '*')");
    await delay(100);
    assert.equal(await run('focusedSampleId'), null);
    await run("document.querySelector('#filterMode').value='all'; applyFilter()");
    await until(() => frameRun('model?.sessionCount === 0 && !map.hasLayer(tiles)'));
    assert.equal(await run("document.querySelector('#routePanel').classList.contains('hidden')"), true);
    // Aggregate modes suppress the map even if they select just one session.
    await run("document.querySelector('#dateFrom').value='2026-10-07'; document.querySelector('#dateTo').value='2026-10-07'; document.querySelector('#filterMode').value='range'; document.querySelector('#filterMode').dispatchEvent(new Event('change')); applyFilter()");
    await until(() => frameRun('model?.sessionCount === 0'));
    assert.equal(await run('selectedRows.size'), 900);
    assert.equal(await run("document.querySelector('#routePanel').classList.contains('hidden')"), true);
    await run("document.querySelector('#filterMode').value='session'; document.querySelector('#sessionSelect').value='0'; document.querySelector('#filterMode').dispatchEvent(new Event('change'))");
    await until(() => frameRun('model?.total === 900 && map.getSize().y > 200'));
    assert.equal(await run("document.querySelector('#routePanel').classList.contains('hidden')"), false);
    // Switching to date-range mode hides the map before Apply is pressed.
    await run("document.querySelector('#filterMode').value='range'; document.querySelector('#filterMode').dispatchEvent(new Event('change'))");
    await until(() => frameRun('model?.sessionCount === 0 && !map.hasLayer(tiles)'));
    assert.equal(await run("document.querySelector('#routePanel').classList.contains('hidden')"), true);
    await run("document.querySelector('#filterMode').value='session'; document.querySelector('#filterMode').dispatchEvent(new Event('change'))");
    await until(() => frameRun('model?.total === 900'));
    // The map remains correctly sized when revisiting Overview.
    await run("showPage('import'); showPage('overview')");
    await until(() => frameRun('map.getSize().y > 200'));
    // A stationary recording still has a visible GPS dot, even with many fixes.
    await run(`telemetrySessions = [buildSession({name:'Stationary.csv', content:'Timestamp_ISO,Timestamp_UnixMs,GPS_Latitude,GPS_Longitude\\n2026-10-01T00:00:00Z,1000,0,0\\n2026-10-01T00:00:01Z,2000,0,0'},2)]; configureFilters(); applyFilter();`);
    await until(() => frameRun('model?.total === 2 && model?.measured === 2'));
    assert.equal(await frameRun('routes.getLayers()[0] instanceof L.CircleMarker'), true);
    await run("focusSample('2:0')");
    await until(() => frameRun("document.querySelector('.sample-readout').dataset.sampleId === '2:0'"));
    assert.equal(await frameRun("document.querySelector('#sampleMotor').textContent"), '—');
    await run("document.querySelector('#filterMode').value='all'; applyFilter()");
    await until(() => frameRun('model?.sessionCount === 0 && !map.hasLayer(tiles)'));
    assert.equal(await run("document.querySelector('#routePanel').classList.contains('hidden')"), true);
    assert.deepEqual(errors, []);
    console.log('GPS UI passed: iframe, original-sample chart/map/assist focus, gaps, filters, themes, pan, zoom, fit, fullscreen and offline fallback. Tile requests used local fixtures only.');
    app.exit(0);
  } catch (error) {
    console.error(error);
    console.error(await run("JSON.stringify({focusedSampleId, ready:routeMap.ready, generation:routeMap.generation, chartFocus:[...document.querySelectorAll('.chart-wrap')].map(c=>[c.id,c.dataset.focusId,c.getBoundingClientRect().width]), frame:document.querySelector('#routeFrame').contentDocument.body.dataset})"));
    console.error(errors); app.exit(1);
  }
});
