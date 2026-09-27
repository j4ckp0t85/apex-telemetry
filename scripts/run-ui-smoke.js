const { spawn } = require('node:child_process');
const path = require('node:path');

function runTest(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(require('electron'), [path.join(__dirname, '..', 'test', file)], { windowsHide: true, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`${file} exited with code ${code}`));
    });
  });
}

(async () => {
  try {
    await runTest('ui-smoke.cjs');
    await runTest('window-persistence.cjs');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
})();
