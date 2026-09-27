const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { sync, manifest, HEADER, hash } = require('../lib/sync-engine');

const row = '2026-09-16T10:00:00.000Z,1789552800000,1.0,20.0,12.4,300,100,70,35,31,90,52.00,5.77,15.00,56.0,0.010,2,1\n';
function fixture(overrides = {}) {
  const sessionId = crypto.randomUUID();
  const data = Buffer.from(HEADER + '\n' + row);
  const info = { version: 1, sessionId, fileName: `telemetry_session_20260916T100000000Z_${sessionId}.csv`,
    size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), sampleCount: 1, ...overrides };
  return { info, data };
}
function phone(items) {
  const device = { id: 'test-phone', name: 'Test phone' };
  let connected = true;
  const transport = {
    devices: async () => connected ? [device] : [],
    list: async () => items.flatMap(({ info }) => [{ id: info.sessionId, name: `${info.sessionId}.ready.json` }, { id: info.fileName, name: info.fileName, size: info.size }]),
    readSmall: async (_, entry) => JSON.stringify(items.find(item => item.info.sessionId === entry.id).info),
    read: async (_, entry, sink, signal) => pipeline(Readable.from([items.find(item => item.info.fileName === entry.id).data]), sink, { signal }),
    disconnect: () => { connected = false; }
  };
  return { transport, device };
}
async function destination() { return fs.mkdtemp(path.join(os.tmpdir(), 'apex-sync-test-')); }

test('copies verified sessions and is idempotent without deleting source or target files', async () => {
  const item = fixture(); const context = phone([item]); const folder = await destination();
  await fs.writeFile(path.join(folder, 'keep.txt'), 'untouched');
  const first = await sync({ ...context, folder });
  assert.equal(first.added, 1); assert.deepEqual(first.errors, []);
  const target = path.join(folder, item.info.fileName);
  const before = await fs.stat(target);
  const second = await sync({ ...context, folder });
  assert.equal(second.added, 0); assert.equal(second.present, 1);
  assert.equal((await fs.stat(target)).mtimeMs, before.mtimeMs);
  assert.equal(await fs.readFile(path.join(folder, 'keep.txt'), 'utf8'), 'untouched');
  assert.equal(await hash(target), item.info.sha256);
  assert.equal((await context.transport.list()).length, 2);
});

test('retains a conflicting existing CSV without replacing it', async () => {
  const item = fixture(); const folder = await destination();
  await fs.writeFile(path.join(folder, item.info.fileName), 'existing data');
  const result = await sync({ ...phone([item]), folder });
  assert.equal(result.added, 0); assert.equal(result.conflicts.length, 1);
  assert.equal(await fs.readFile(path.join(folder, item.info.fileName), 'utf8'), 'existing data');
});

test('interrupted USB transfer leaves no final CSV and a later retry succeeds', async () => {
  const item = fixture(); const context = phone([item]); const folder = await destination();
  context.transport.read = async (_, entry, sink) => {
    sink.write(item.data.subarray(0, 100)); context.transport.disconnect(); throw new Error('USB disconnected');
  };
  const first = await sync({ ...context, folder });
  assert.equal(first.added, 0); assert.equal(first.errors.length, 1);
  assert.equal((await fs.readdir(folder)).some(name => name.endsWith('.csv')), false);
  const staging = path.join(folder, '.apex-sync', item.info.sessionId);
  const retained = await fs.readdir(staging); assert.equal(retained.length, 1);
  const second = await sync({ ...phone([item]), folder });
  assert.equal(second.added, 1);
  assert.ok((await fs.readdir(staging)).includes(retained[0]));
});

test('rejects corrupt content and invalid rows even when the source size is plausible', async () => {
  const item = fixture(); item.data[item.data.length - 3] = 57;
  const folder = await destination();
  const result = await sync({ ...phone([item]), folder });
  assert.equal(result.added, 0); assert.equal(result.errors.length, 1);
  assert.equal((await fs.readdir(folder)).some(name => name.endsWith('.csv')), false);
});

test('a competing destination created at commit is never overwritten', async () => {
  const item = fixture(); const folder = await destination(); const context = phone([item]);
  const read = context.transport.read;
  context.transport.read = async (...args) => {
    await fs.writeFile(path.join(folder, item.info.fileName), 'created by another process');
    return read(...args);
  };
  const result = await sync({ ...context, folder });
  assert.equal(result.added, 0); assert.equal(result.conflicts.length, 1);
  assert.equal(await fs.readFile(path.join(folder, item.info.fileName), 'utf8'), 'created by another process');
});

test('reuses a complete staging file after a crash before publication', async () => {
  const item = fixture(); const folder = await destination(); const context = phone([item]);
  const stage = path.join(folder, '.apex-sync', item.info.sessionId);
  await fs.mkdir(stage, { recursive: true }); await fs.writeFile(path.join(stage, 'saved.partial'), item.data);
  context.transport.read = async () => { throw new Error('should reuse verified staging'); };
  const result = await sync({ ...context, folder });
  assert.equal(result.added, 1); assert.deepEqual(result.errors, []);
});

test('requires a ready marker and never imports active CSV files', async () => {
  const item = fixture(); const context = phone([item]);
  context.transport.list = async () => [{ id: 'active', name: item.info.fileName }];
  const result = await sync({ ...context, folder: await destination() });
  assert.equal(result.added, 0); assert.equal(result.pending, 1);
});

test('rejects a disconnected phone before copying', async () => {
  const context = phone([fixture()]); context.transport.disconnect();
  const result = await sync({ ...context, folder: await destination() });
  assert.equal(result.added, 0); assert.match(result.errors[0], /no longer connected/);
});

test('cancellation preserves successful files and reports cancellation', async () => {
  const context = phone([fixture()]); const controller = new AbortController(); controller.abort();
  const result = await sync({ ...context, folder: await destination(), signal: controller.signal });
  assert.equal(result.cancelled, true); assert.equal(result.added, 0);
});

test('manifest rejects path traversal and unsupported versions', () => {
  const { info } = fixture();
  for (const changes of [{ fileName: '../escape.csv' }, { version: 2 }, { size: -1 }, { sessionId: '../bad' }]) {
    assert.throws(() => manifest(JSON.stringify({ ...info, ...changes }), `${info.sessionId}.ready.json`));
  }
});

test('empty connection sessions remain valid, distinct files', async () => {
  const a = fixture(); const b = fixture();
  for (const item of [a, b]) {
    item.data = Buffer.from(HEADER + '\n'); item.info.size = item.data.length;
    item.info.sampleCount = 0; item.info.sha256 = crypto.createHash('sha256').update(item.data).digest('hex');
  }
  const result = await sync({ ...phone([a, b]), folder: await destination() });
  assert.equal(result.added, 2); assert.deepEqual(result.errors, []);
});
