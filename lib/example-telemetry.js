const fs = require('node:fs/promises');
const path = require('node:path');

const EXAMPLE_FILE_NAME = 'telemetry_session_20261010T121124177Z_d6959a1b-c6ae-46d0-8eca-1b3d34dea4f1.csv';

function registerExampleTelemetry(ipcMain, { root, readSettings, updateSettings }) {
  ipcMain.handle('get-example-enabled', async () => (await readSettings()).showExampleTelemetry === true);
  ipcMain.handle('save-example-enabled', async (_, enabled) => {
    if (typeof enabled !== 'boolean') throw new Error('Choose a valid example telemetry preference.');
    await updateSettings({ showExampleTelemetry: enabled });
    return enabled;
  });
  // Only the bundled recording is exposed; the renderer cannot supply a path.
  ipcMain.handle('read-example-telemetry', async () => ({
    name: EXAMPLE_FILE_NAME,
    content: await fs.readFile(path.join(root, 'assets', 'example', EXAMPLE_FILE_NAME), 'utf8')
  }));
}

module.exports = { EXAMPLE_FILE_NAME, registerExampleTelemetry };
