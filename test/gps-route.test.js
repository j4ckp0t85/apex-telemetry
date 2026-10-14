const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCSV, buildSession, prepareChartRows, nearestSample } = require('../src/telemetry-data');
const { buildRouteModel, distanceMeters } = require('../src/gps-route');

function session(fixes, id = 0) {
  return buildSession({ name: `synthetic-${id}.csv`, content:
    'Timestamp_ISO,Timestamp_UnixMs,Elapsed_Sec,Battery_Pct,GPS_Latitude,GPS_Longitude\n' +
    fixes.map(([seconds, lat, lng]) => `${new Date(seconds * 1000).toISOString()},${seconds * 1000},${seconds},100,${lat ?? 'null'},${lng ?? 'null'}`).join('\n') }, id);
}

test('legacy GPS-free CSVs keep every telemetry row and mark coordinates missing', () => {
  const rows = parseCSV('\uFEFFTimestamp_ISO,Timestamp_UnixMs,Speed_kmh\r\n2026-01-01T00:00:00Z,1,12');
  assert.equal(rows[0].Speed_kmh, 12);
  assert.equal(rows[0].GPS_Latitude, null);
  assert.equal(rows[0].GPS_Longitude, null);
});

test('blank, null, partial, nonfinite and out-of-range pairs are missing; zero is valid', () => {
  for (const [lat, lng] of [['', ''], ['null', 'NULL'], ['45', ''], ['null', '13'], ['NaN', '13'], ['Infinity', '13'], ['91', '13'], ['45', '-181']]) {
    const row = session([[0, lat, lng]]).rows[0];
    assert.equal(row.GPS_Latitude, null, `${lat},${lng}`);
    assert.equal(row.GPS_Longitude, null);
  }
  assert.equal(session([[0, 0, 0]]).rows[0].GPS_Latitude, 0);
  assert.equal(buildRouteModel([session([[0, 0, 0]])]).measured, 1);
});

test('short gaps interpolate by actual time without mutating missing CSV coordinates', () => {
  const ride = session([[0, 46, 11], [1, null, null], [9, null, null], [10, 46.0004, 11]]);
  const route = buildRouteModel([ride]);
  assert.equal(route.segments.length, 1);
  assert.equal(route.estimated, 2);
  assert.equal(route.bridgedGaps, 1);
  assert.ok(Math.abs(route.samples[1].lat - 46.00004) < 1e-8);
  assert.ok(Math.abs(route.samples[2].lat - 46.00036) < 1e-8);
  assert.equal(ride.rows[1].GPS_Latitude, null);
  assert.equal(route.samples[1].kind, 'estimated');
});

test('long-duration, distant, numerous missing fixes and implausible jumps split routes', () => {
  const fixtures = [
    [[0, 46, 11], [1, null, null], [16, 46.0001, 11]],
    [[0, 46, 11], [1, null, null], [10, 46.001, 11]],
    [[0, 46, 11], ...Array.from({ length: 11 }, (_, i) => [i + 1, null, null]), [12, 46.0001, 11]],
    [[0, 46, 11], [31, 46.0001, 11]],
    [[0, 46, 11], [1, 47, 12]]
  ];
  for (const fixes of fixtures) {
    const route = buildRouteModel([session(fixes)]);
    assert.equal(route.segments.length, 2);
    assert.equal(route.estimated, 0);
    assert.equal(route.breaks, 1);
  }
});

test('leading/trailing gaps, all-null sessions and single fixes are never extrapolated', () => {
  const route = buildRouteModel([session([[0, null, null], [1, 46, 11], [2, null, null]]), session([[0, null, null]], 1)]);
  assert.equal(route.segments.length, 1);
  assert.equal(route.segments[0].length, 1);
  assert.equal(route.missing, 3);
  assert.equal(route.sessionsWithoutGPS, 1);
  assert.equal(buildRouteModel([session([[0, null, null]])]).segments.length, 0);
});

test('nearby sessions retain distinct identities and never connect to each other', () => {
  const a = session([[0, 46, 11], [1, 46.0001, 11]], 4);
  const b = session([[0, 46.0001, 11], [1, 46.0002, 11]], 9);
  const rows = prepareChartRows([a, b]);
  const route = buildRouteModel([a, b]);
  assert.equal(route.segments.length, 2);
  assert.equal(new Set(rows.map(row => row.Sample_Id)).size, 4);
  assert.equal(rows[2].Chart_Min, 1 / 60);
  assert.equal(route.segments[1][0].id, '9:0');
});

test('chart lookup uses original samples and real timestamps, including identical times', () => {
  const ride = session(Array.from({ length: 1000 }, (_, i) => [i * i, 46, 11]));
  const rows = prepareChartRows([ride]);
  assert.equal(nearestSample(rows, rows[513].Chart_Min).Sample_Id, '0:513');
  assert.equal(nearestSample(rows, -1).Sample_Id, '0:0');
  assert.equal(nearestSample(rows, Infinity).Sample_Id, '0:999');
  assert.equal(nearestSample([], 0), null);
  assert.equal(nearestSample(prepareChartRows([session([[0, 46, 11], [0, 46, 11]])]), 0).Sample_Id, '0:0');
});

test('repeated short gaps are labeled separately; ambiguous zero-time gaps remain missing', () => {
  const route = buildRouteModel([session([[0, 46, 11], [1, null, null], [2, 46.0001, 11], [3, null, null], [4, 46.0002, 11]])]);
  assert.equal(route.bridgedGaps, 2);
  assert.equal(route.segments.length, 1);
  assert.equal(buildRouteModel([session([[0, 46, 11], [0, null, null], [0, 46, 11]])]).estimated, 0);
});

test('antimeridian gaps interpolate across the short longitude arc', () => {
  const route = buildRouteModel([session([[0, 0, 179.9998], [1, null, null], [2, 0, -179.9998]])]);
  assert.equal(route.estimated, 1);
  assert.ok(Math.abs(route.samples[1].lng) > 179.99);
  assert.ok(distanceMeters(route.samples[0], route.samples[2]) < 50);
});

test('large recordings build without variadic argument overflow', () => {
  const ride = { id: 'large', rows: Array.from({ length: 150000 }, (_, i) => ({ Sample_Id: `large:${i}`, Sample_Index: i,
    Timestamp_UnixMs: i * 1000, GPS_Latitude: null, GPS_Longitude: null })) };
  assert.equal(buildRouteModel([ride]).total, 150000);
});
