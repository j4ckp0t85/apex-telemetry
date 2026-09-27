const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { pipeline } = require('node:stream/promises');
const { Writable } = require('node:stream');
const path = require('node:path');

class WpdTransport {
  constructor(helperPath) { this.helper = helperPath; }
  async command(args, signal) {
    const { stdout } = await promisify(execFile)(this.helper, args, {
      windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024, signal
    }).catch(error => { throw new Error(error.stderr?.trim() || error.message); });
    return JSON.parse(stdout.replace(/^\uFEFF/, ''));
  }
  devices(signal) { return this.command(['devices'], signal); }
  list(device, signal) { return this.command(['list', device.id], signal); }
  async read(device, entry, destination, signal) {
    signal?.throwIfAborted();
    const child = spawn(this.helper, ['read', device.id, entry.id], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; let timer; let timedOut = false;
    const abort = () => child.kill();
    const resetTimer = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; child.kill(); }, 30000); };
    signal?.addEventListener('abort', abort, { once: true });
    resetTimer();
    child.stdout.on('data', resetTimer);
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
    const exit = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve() : reject(new Error(timedOut ? 'The phone stopped responding. Check the USB connection.' : stderr || 'USB copy interrupted. Check the phone connection.')));
    });
    try {
      const results = await Promise.allSettled([exit, pipeline(child.stdout, destination, { signal }).catch(error => { child.kill(); throw error; })]);
      signal?.throwIfAborted();
      for (const result of results) if (result.status === 'rejected') throw result.reason;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); child.kill(); }
  }
  async readSmall(device, entry, signal) {
    const chunks = []; let size = 0;
    await this.read(device, entry, new Writable({ write(chunk, _, done) {
      size += chunk.length;
      if (size > 65536) return done(new Error('Completion manifest exceeds 64 KiB.'));
      chunks.push(chunk); done();
    } }), signal);
    return Buffer.concat(chunks).toString('utf8');
  }
}

function createTransport(app) {
  if (process.platform !== 'win32') throw new Error('Direct phone sync currently requires Windows. You can still select a folder of CSV files on this computer.');
  return new WpdTransport(app.isPackaged ? path.join(process.resourcesPath, 'wpd', 'WpdReader.exe') : path.join(__dirname, '..', 'native', 'bin', 'WpdReader.exe'));
}
module.exports = { WpdTransport, createTransport };
