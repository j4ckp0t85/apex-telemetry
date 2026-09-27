// Electron integration test verifying window resizing, maximizing, persistence, and reopening.
const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { resolveWindowState, trackWindowState } = require('../lib/window-state');

const root = path.join(__dirname, '..');
const profileDir = path.join(root, 'release', 'qa', 'window-state-test-profile');
app.setPath('userData', profileDir);

setTimeout(() => {
  console.error('Window persistence test timed out');
  app.exit(1);
}, 25000).unref();

function settingsFile() {
  return path.join(profileDir, 'settings.json');
}

function readSettings() {
  try {
    return JSON.parse(fsSync.readFileSync(settingsFile(), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

function writeSettings(data) {
  fsSync.mkdirSync(profileDir, { recursive: true });
  fsSync.writeFileSync(settingsFile(), JSON.stringify(data, null, 2), 'utf8');
}

app.whenReady().then(async () => {
  try {
    await fs.rm(profileDir, { recursive: true, force: true });
    await fs.mkdir(profileDir, { recursive: true });

    // Step 1: Launch with no prior settings -> defaults to 1440x960
    const displays = screen.getAllDisplays();
    let state1 = resolveWindowState(readSettings().windowState, displays);
    assert.equal(state1.width, 1440);
    assert.equal(state1.height, 960);
    assert.equal(state1.isMaximized, false);

    const win1 = new BrowserWindow({
      show: false,
      width: state1.width,
      height: state1.height,
      minWidth: 1060,
      minHeight: 720
    });

    const tracker1 = trackWindowState(win1, updated => {
      writeSettings({ ...readSettings(), windowState: updated });
    }, {
      initialState: state1,
      onSyncSave: updated => {
        writeSettings({ ...readSettings(), windowState: updated });
      }
    });

    // User manually resizes the window
    win1.setBounds({ width: 1250, height: 820, x: 60, y: 70 });
    win1.emit('resize');
    win1.emit('move');

    // Close window 1
    win1.close();
    tracker1.destroy();

    const savedAfterStep1 = readSettings().windowState;
    assert.ok(savedAfterStep1, 'windowState should be saved');
    assert.equal(savedAfterStep1.width, 1250);
    assert.equal(savedAfterStep1.height, 820);
    assert.equal(savedAfterStep1.isMaximized, false);

    // Step 2: Reopen window -> restores 1250x820, user maximizes it
    let state2 = resolveWindowState(readSettings().windowState, displays);
    assert.equal(state2.width, 1250);
    assert.equal(state2.height, 820);
    assert.equal(state2.isMaximized, false);

    const win2 = new BrowserWindow({
      show: false,
      width: state2.width,
      height: state2.height,
      minWidth: 1060,
      minHeight: 720
    });

    const tracker2 = trackWindowState(win2, updated => {
      writeSettings({ ...readSettings(), windowState: updated });
    }, {
      initialState: state2,
      onSyncSave: updated => {
        writeSettings({ ...readSettings(), windowState: updated });
      }
    });

    // User maximizes the window
    win2.maximize();
    assert.equal(win2.isMaximized(), true);

    // Close window while maximized
    win2.close();
    tracker2.destroy();

    const savedAfterStep2 = readSettings().windowState;
    assert.ok(savedAfterStep2, 'windowState should be saved');
    assert.equal(savedAfterStep2.isMaximized, true);
    // Unmaximized dimensions must be preserved
    assert.equal(savedAfterStep2.width, 1250);
    assert.equal(savedAfterStep2.height, 820);

    // Step 3: Reopen window -> auto opens in full size (maximized)
    let state3 = resolveWindowState(readSettings().windowState, displays);
    assert.equal(state3.isMaximized, true);

    const win3 = new BrowserWindow({
      show: false,
      width: state3.width,
      height: state3.height,
      minWidth: 1060,
      minHeight: 720
    });

    if (state3.isMaximized) {
      win3.maximize();
    }

    assert.equal(win3.isMaximized(), true, 'Window should auto open in full size (maximized)');

    const tracker3 = trackWindowState(win3, updated => {
      writeSettings({ ...readSettings(), windowState: updated });
    }, {
      initialState: state3,
      onSyncSave: updated => {
        writeSettings({ ...readSettings(), windowState: updated });
      }
    });

    // User unmaximizes
    win3.unmaximize();
    assert.equal(win3.isMaximized(), false);

    // Close window
    win3.close();
    tracker3.destroy();

    const savedAfterStep3 = readSettings().windowState;
    assert.equal(savedAfterStep3.isMaximized, false);
    assert.equal(savedAfterStep3.width, 1250);
    assert.equal(savedAfterStep3.height, 820);

    console.log('Window persistence integration test passed successfully!');
    app.exit(0);
  } catch (error) {
    console.error('Window persistence integration test failed:', error);
    app.exit(1);
  }
});
