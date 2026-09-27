const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { summarizeBatteryUsage, batteryDischargeRows } = require('../src/battery-usage');

const session = (...values) => ({ rows: values.map(Battery_Pct => ({ Battery_Pct })) });
const timedSession = (...values) => ({ rows: values.map((Battery_Pct, index) => ({ Battery_Pct, Timestamp_UnixMs: index * 60000 })) });

test('discharge chart requires a valid drop of at least 5 pp and positive time', () => {
  assert.equal(batteryDischargeRows(timedSession(100, 96)), null);
  assert.equal(batteryDischargeRows(timedSession(50, 50)), null);
  assert.equal(batteryDischargeRows(timedSession(100, 90, 95)), null);
  assert.equal(batteryDischargeRows(timedSession(100, NaN)), null);
  assert.equal(batteryDischargeRows(session(100, 90)), null);
  assert.equal(batteryDischargeRows({ rows: [{ Battery_Pct: 100, Timestamp_UnixMs: 1 }, { Battery_Pct: 90, Timestamp_UnixMs: 1 }] }), null);
  assert.deepEqual(batteryDischargeRows(timedSession(100, 95)).map(row => row.Battery_Pct), [100, 95]);
});

test('discharge chart preserves percentage readings, every change and actual irregular time', () => {
  const source = timedSession(100, 100, 95, 95, 83);
  source.rows[4].Timestamp_UnixMs = 600000;
  const rows = batteryDischargeRows(source);
  assert.deepEqual(rows.map(row => row.Battery_Pct), [100, 95, 83]);
  assert.deepEqual(rows.map(row => row.Chart_Min), [0, 2, 10]);
  assert.equal(source.rows[0].Chart_Min, undefined);
});

test('charging between sessions cannot cancel usage, and totals can exceed 100 pp', () => {
  const result = summarizeBatteryUsage([session(100, 70, 20), session(100, 50, 10)]);
  assert.equal(result.used, 170);
  assert.equal(result.included, 2);
});

test('within-session charging and gauge rebounds are excluded even with a net drop', () => {
  const result = summarizeBatteryUsage([session(90, 50, 80, 40), session(80, 79, 80, 79), session(50, 42)]);
  assert.equal(result.used, 8);
  assert.equal(result.increases, 2);
  assert.equal(result.included, 1);
});

test('invalid and insufficient data are unavailable, never artificial zero consumption', () => {
  const result = summarizeBatteryUsage([
    session(), session(50), session(90, NaN), session(100, undefined, 80),
    session(90, null), session(101, 80), session(50, -1), session(90, Infinity)
  ]);
  assert.equal(result.used, null);
  assert.equal(result.invalid, 8);
  assert.equal(summarizeBatteryUsage([session(42, 50)]).used, null);
  assert.equal(summarizeBatteryUsage([]).used, null);
});

test('zero charge and unchanged readings are valid; decimal precision is preserved', () => {
  assert.equal(summarizeBatteryUsage([session(50, 50)]).used, 0);
  assert.equal(summarizeBatteryUsage([session(12.5, 0)]).used, 12.5);
});

test('CSV blanks stay missing instead of becoming a false zero battery level', () => {
  const context = vm.createContext({ window: { addEventListener() {} } });
  vm.runInContext(fs.readFileSync(require.resolve('../src/app.js'), 'utf8'), context);
  const rows = context.parseCSV('Timestamp_ISO,Timestamp_UnixMs,Battery_Pct\n2026-09-27T10:00:00Z,1,90\n2026-09-27T10:00:01Z,2,');
  assert.equal(Number.isNaN(rows[1].Battery_Pct), true);
  assert.equal(summarizeBatteryUsage([{ rows }]).used, null);
});
