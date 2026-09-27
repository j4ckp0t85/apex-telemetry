const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const HEADER = 'Timestamp_ISO,Timestamp_UnixMs,Elapsed_Sec,Speed_kmh,Speed_mph,Motor_Watts,Rider_Watts,Cadence_RPM,Motor_Temp_C,Controller_Temp_C,Battery_Pct,Battery_Voltage_V,Battery_Current_A,Efficiency_Wh_km,Range_Est_km,Distance_km,Assist_Level,Light_On';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const sessionInName = new RegExp(`_(${UUID})\\.csv$`, 'i');

function manifest(text, entryName) {
  const item = JSON.parse(text);
  if (item.version !== 1 || !new RegExp(`^${UUID}$`).test(item.sessionId) ||
      entryName !== `${item.sessionId}.ready.json` ||
      typeof item.fileName !== 'string' || !new RegExp(`^telemetry_session_[A-Za-z0-9_-]+_${item.sessionId}\\.csv$`).test(item.fileName) ||
      !Number.isSafeInteger(item.size) || item.size < HEADER.length + 1 || item.size > 2 * 1024 ** 3 ||
      !Number.isSafeInteger(item.sampleCount) || item.sampleCount < 0 ||
      !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Unsupported or invalid completion manifest.');
  return item;
}

class VerifyCsv extends Transform {
  constructor(item, progress = () => {}) { super(); this.item = item; this.progress = progress; this.bytes = 0; this.rows = -1; this.tail = ''; this.digest = crypto.createHash('sha256'); }
  _transform(chunk, _, done) {
    try {
      this.bytes += chunk.length;
      if (this.bytes > this.item.size) throw new Error('CSV is larger than its completion manifest.');
      this.digest.update(chunk);
      this.tail += chunk.toString('utf8');
      let end;
      while ((end = this.tail.indexOf('\n')) !== -1) {
        const line = this.tail.slice(0, end).replace(/\r$/, ''); this.tail = this.tail.slice(end + 1);
        if (line.length > 8192) throw new Error('CSV row is too long.');
        if (this.rows === -1) { if (line !== HEADER) throw new Error('CSV header is not supported.'); }
        else {
          const cells = line.split(',');
          if (cells.length !== 18 || !/^\d{4}-\d{2}-\d{2}T[^,]+$/.test(cells[0]) ||
              cells.slice(1).some(value => !value.trim() || !Number.isFinite(Number(value)))) throw new Error('Invalid CSV row.');
        }
        this.rows++;
      }
      if (this.tail.length > 8192) throw new Error('CSV row is too long.');
      this.progress(this.bytes); done(null, chunk);
    } catch (error) { done(error); }
  }
  _flush(done) {
    if (this.tail || this.bytes !== this.item.size || this.rows !== this.item.sampleCount || this.digest.digest('hex') !== this.item.sha256) {
      done(new Error('CSV integrity verification failed. The incomplete copy has been retained.'));
    } else done();
  }
}
async function hash(file, signal) {
  const digest = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), new Writable({ write(chunk, _, done) { digest.update(chunk); done(); } }), { signal });
  return digest.digest('hex');
}
async function regular(file) {
  try { const stat = await fsp.lstat(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Not a regular file: ${path.basename(file)}`); return stat; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function verify(file, item, signal) {
  await pipeline(fs.createReadStream(file), new VerifyCsv(item), new Writable({ write(_, __, done) { done(); } }), { signal });
}

/** Only reads the source. Uses hard-link creation for atomic, exclusive publication; never unlinks files. */
async function sync({ transport, device, folder, signal, onProgress = () => {} }) {
  const result = { added: 0, present: 0, conflicts: [], errors: [], pending: 0, cancelled: false, retainedBytes: 0 };
  const emit = event => onProgress({ ...result, ...event });
  try {
    emit({ phase: 'checking', message: 'Checking the phone connection…' });
    const devices = await transport.devices(signal);
    if (!devices.some(item => item.id === device.id)) throw new Error('The selected phone is no longer connected to Windows. Check the USB cable, unlock the phone, and select File transfer / Android Auto.');
    const destination = await fsp.realpath(folder);
    if (!(await fsp.stat(destination)).isDirectory()) throw new Error('Choose a destination folder first.');
    const entries = await transport.list(device, signal);
    const byName = new Map();
    for (const entry of entries) {
      if (byName.has(entry.name)) byName.set(entry.name, null); else byName.set(entry.name, entry);
    }
    const markers = entries.filter(entry => entry.name.endsWith('.ready.json'));
    const tasks = [];
    const localNames = (await fsp.readdir(destination)).filter(name => name.toLowerCase().endsWith('.csv'));
    const legacyHashes = new Set();
    for (const name of localNames.filter(name => !sessionInName.test(name))) {
      signal?.throwIfAborted();
      const file = path.join(destination, name);
      if (await regular(file)) legacyHashes.add(await hash(file, signal));
    }
    const seen = new Set();
    for (const [index, entry] of markers.entries()) {
      signal?.throwIfAborted();
      emit({ phase: 'scanning', message: `Checking session ${index + 1} of ${markers.length}…` });
      try {
        if (!byName.get(entry.name)) throw new Error('Duplicate manifest filename on the phone.');
        const item = manifest(await transport.readSmall(device, entry, signal), entry.name);
        if (seen.has(item.sessionId)) throw new Error('Duplicate session identity on the phone.');
        seen.add(item.sessionId);
        const source = byName.get(item.fileName);
        if (!source) { result.pending++; continue; }
        const matches = localNames.filter(name => name === item.fileName || name.match(sessionInName)?.[1] === item.sessionId);
        let existing = false;
        for (const name of matches) {
          const file = path.join(destination, name);
          if (await regular(file)) {
            existing = true;
            if (await hash(file, signal) !== item.sha256) throw new Error(`Conflict: ${name} already exists with different content.`);
          }
        }
        if (existing || legacyHashes.has(item.sha256)) { result.present++; continue; }
        tasks.push({ item, source });
      } catch (error) {
        signal?.throwIfAborted();
        (error.message.startsWith('Conflict:') ? result.conflicts : result.errors).push(`${entry.name}: ${error.message}`);
      }
    }
    const readyCsvs = new Set(tasks.map(task => task.item.fileName));
    // CSVs without a marker may still be publishing. Do not import an active/incomplete file.
    result.pending += entries.filter(entry => entry.name.endsWith('.csv') && !readyCsvs.has(entry.name) &&
      !markers.some(marker => marker.name === `${entry.name.match(sessionInName)?.[1]}.ready.json`)).length;
    const stagingRoot = path.join(destination, '.apex-sync');
    await fsp.mkdir(stagingRoot, { recursive: true });
    const stagingStat = await fsp.lstat(stagingRoot);
    if (stagingStat.isSymbolicLink() || !stagingStat.isDirectory()) throw new Error('The sync staging folder must be a real directory.');
    const totalBytes = tasks.reduce((sum, task) => sum + task.item.size, 0);
    let completedBytes = 0;
    for (const [index, task] of tasks.entries()) {
      signal?.throwIfAborted();
      const { item, source } = task;
      const target = path.join(destination, item.fileName);
      const sessionStaging = path.join(stagingRoot, item.sessionId);
      try {
        await fsp.mkdir(sessionStaging, { recursive: true });
        if ((await fsp.lstat(sessionStaging)).isSymbolicLink()) throw new Error('Invalid staging directory.');
        let stage;
        for (const candidate of await fsp.readdir(sessionStaging)) {
          if (!candidate.endsWith('.partial')) continue;
          const file = path.join(sessionStaging, candidate);
          const stat = await regular(file);
          if (stat?.size === item.size) {
            try { await verify(file, item, signal); stage = file; break; } catch { signal?.throwIfAborted(); }
          }
        }
        if (!stage) {
          stage = path.join(sessionStaging, `${crypto.randomUUID()}.partial`);
          const handle = await fsp.open(stage, 'wx');
          try {
            const validator = new VerifyCsv(item, bytes => emit({ phase: 'copying', fileName: item.fileName,
              fileIndex: index + 1, fileTotal: tasks.length, bytes: completedBytes + bytes, totalBytes,
              message: `Copying ${index + 1} of ${tasks.length}: ${item.fileName}` }));
            const write = pipeline(validator, new Writable({ write(chunk, _, done) {
              // FileHandle.write may perform a short write. Loop until the entire chunk is persisted.
              (async () => { let offset = 0; while (offset < chunk.length) {
                const written = await handle.write(chunk, offset, chunk.length - offset);
                if (!written.bytesWritten) throw new Error('The destination stopped accepting data.');
                offset += written.bytesWritten;
              } })().then(() => done(), done);
            } }), { signal });
            const read = transport.read(device, source, validator, signal).catch(error => { validator.destroy(error); throw error; });
            const settled = await Promise.allSettled([read, write]);
            for (const value of settled) if (value.status === 'rejected') throw value.reason;
            await handle.sync();
          } finally { await handle.close(); }
        }
        emit({ phase: 'verifying', message: `Verifying ${item.fileName}…` });
        await verify(stage, item, signal);
        signal?.throwIfAborted();
        try {
          await fsp.link(stage, target);
          result.added++;
        } catch (error) {
          if (error.code !== 'EEXIST') throw new Error(`Cannot safely add this file (${error.code}). Choose a local folder that supports hard links, such as NTFS.`);
          await regular(target);
          if (await hash(target, signal) === item.sha256) result.present++;
          else result.conflicts.push(`${item.fileName}: the destination appeared with different content during the copy.`);
        }
        completedBytes += item.size;
      } catch (error) {
        signal?.throwIfAborted();
        result.errors.push(`${item.fileName}: ${error.message}`);
        // Do not keep retrying reads on a disconnected device. Recheck before continuing.
        const connected = await transport.devices(signal).catch(() => []);
        if (!connected.some(entry => entry.id === device.id)) { result.pending += tasks.length - index - 1; break; }
      }
    }
    for (const id of await fsp.readdir(stagingRoot)) {
      if (!new RegExp(`^${UUID}$`).test(id)) continue;
      const dir = path.join(stagingRoot, id);
      if ((await fsp.lstat(dir)).isSymbolicLink()) continue;
      for (const name of await fsp.readdir(dir)) {
        const stat = await regular(path.join(dir, name));
        if (stat && stat.nlink === 1) result.retainedBytes += stat.size;
      }
    }
  } catch (error) {
    if (signal?.aborted) result.cancelled = true;
    else result.errors.push(error.message);
  }
  emit({ phase: 'done', message: result.cancelled ? 'Sync cancelled. Completed copies are preserved.' : 'Sync finished.' });
  return result;
}
module.exports = { sync, manifest, VerifyCsv, HEADER, hash };
