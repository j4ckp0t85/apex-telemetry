const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { registerExampleTelemetry, EXAMPLE_FILE_NAME } = require('../lib/example-telemetry');
const { buildSession } = require('../src/telemetry-data');
const { buildRouteModel } = require('../src/gps-route');

function endpoints(initial = {}, failSave = false) {
  let settings = { ...initial };
  const handlers = new Map();
  registerExampleTelemetry({ handle: (name, handler) => handlers.set(name, handler) }, {
    root: path.join(__dirname, '..'),
    readSettings: async () => settings,
    updateSettings: async values => {
      if (failSave) throw new Error('Settings are unavailable');
      settings = { ...settings, ...values };
    }
  });
  return { call: (name, ...args) => handlers.get(name)({}, ...args), settings: () => settings };
}

test('example defaults to hidden and saves a boolean without replacing other preferences', async () => {
  const api = endpoints({ theme: 'dark', telemetryFolder: 'C:\\Rides', autoSync: true });
  assert.equal(await api.call('get-example-enabled'), false);
  assert.equal(await api.call('save-example-enabled', true), true);
  assert.equal(await api.call('get-example-enabled'), true);
  assert.deepEqual(api.settings(), { theme: 'dark', telemetryFolder: 'C:\\Rides', autoSync: true, showExampleTelemetry: true });
  assert.equal(await api.call('save-example-enabled', false), false);
  assert.equal(await api.call('get-example-enabled'), false);
  for (const value of ['true', 1, {}, null, undefined]) {
    await assert.rejects(api.call('save-example-enabled', value), /valid example telemetry preference/);
    assert.equal(await api.call('get-example-enabled'), false);
    assert.equal(await endpoints({ showExampleTelemetry: value }).call('get-example-enabled'), false);
  }
});

test('failed preference saves propagate without changing stored visibility', async () => {
  const api = endpoints({ showExampleTelemetry: true }, true);
  await assert.rejects(api.call('save-example-enabled', false), /Settings are unavailable/);
  assert.equal(await api.call('get-example-enabled'), true);
});

test('only the original bundled recording is read and its missing GPS fix remains unavailable', async () => {
  const file = await endpoints().call('read-example-telemetry', 'C:\\other.csv');
  assert.equal(file.name, EXAMPLE_FILE_NAME);
  assert.equal(crypto.createHash('sha256').update(file.content).digest('hex'), '7fb8cc98ace1e964810f5b2bec819bc8e4ace0b1790377a0b546396bfb559102');
  assert.equal(file.content.split(/\r?\n/)[0].split(',').length, 20);
  const session = buildSession(file, 'bundled-example');
  assert.equal(session.rows.length, 742);
  assert.equal(session.first.GPS_Latitude, null);
  assert.equal(session.first.GPS_Longitude, null);
  assert.equal(session.rows[1].GPS_Latitude, 45.8992356);
  const route = buildRouteModel([session]);
  assert.equal(route.measured, 741);
  assert.equal(route.missing, 1);
  assert.equal(route.estimated, 0);
  assert.equal(session.rows[10].Sample_Id, 'bundled-example:10');
  const files = require('../package.json').build.files;
  assert.ok(files.includes('assets/**/*'));
  assert.ok(files.includes('lib/**/*'));
});
