const test = require('node:test');
const assert = require('node:assert/strict');
const { sortSessionsDescending, buildSession } = require('../src/telemetry-data');

test('sortSessionsDescending handles null, undefined, empty, and non-array inputs gracefully', () => {
  assert.deepEqual(sortSessionsDescending(null), []);
  assert.deepEqual(sortSessionsDescending(undefined), []);
  assert.deepEqual(sortSessionsDescending([]), []);
  assert.deepEqual(sortSessionsDescending('not-an-array'), []);
  assert.deepEqual(sortSessionsDescending(123), []);
});

test('sortSessionsDescending orders sessions in reverse chronological order: from most recent to least recent', () => {
  const sessionOldest = {
    id: '0',
    name: 'ride-01.csv',
    first: { Timestamp_UnixMs: 1000000, Timestamp_ISO: '2026-09-01T10:00:00Z' },
    last: { Timestamp_UnixMs: 1001000, Timestamp_ISO: '2026-09-01T10:16:40Z' }
  };
  const sessionMiddle = {
    id: '1',
    name: 'ride-02.csv',
    first: { Timestamp_UnixMs: 2000000, Timestamp_ISO: '2026-09-02T10:00:00Z' },
    last: { Timestamp_UnixMs: 2002000, Timestamp_ISO: '2026-09-02T10:33:20Z' }
  };
  const sessionNewest = {
    id: '2',
    name: 'ride-03.csv',
    first: { Timestamp_UnixMs: 3000000, Timestamp_ISO: '2026-09-03T10:00:00Z' },
    last: { Timestamp_UnixMs: 3003000, Timestamp_ISO: '2026-09-03T10:50:00Z' }
  };

  // Chronological input
  const input = [sessionOldest, sessionMiddle, sessionNewest];
  const sorted = sortSessionsDescending(input);

  assert.deepEqual(sorted.map(s => s.id), ['2', '1', '0']);
  assert.equal(sorted[0].name, 'ride-03.csv');
  assert.equal(sorted[1].name, 'ride-02.csv');
  assert.equal(sorted[2].name, 'ride-01.csv');

  // Input must not be mutated
  assert.deepEqual(input.map(s => s.id), ['0', '1', '2']);
});

test('sortSessionsDescending correctly orders unsorted sessions from different dates', () => {
  const sessions = [
    { id: 'b', first: { Timestamp_UnixMs: 2000 } },
    { id: 'd', first: { Timestamp_UnixMs: 4000 } },
    { id: 'a', first: { Timestamp_UnixMs: 1000 } },
    { id: 'c', first: { Timestamp_UnixMs: 3000 } }
  ];

  const sorted = sortSessionsDescending(sessions);
  assert.deepEqual(sorted.map(s => s.id), ['d', 'c', 'b', 'a']);
});

test('sortSessionsDescending tie-breaks equal start times by end time, then name', () => {
  const sessionA = {
    id: 'a',
    name: 'alpha.csv',
    first: { Timestamp_UnixMs: 1000 },
    last: { Timestamp_UnixMs: 2000 }
  };
  const sessionB = {
    id: 'b',
    name: 'beta.csv',
    first: { Timestamp_UnixMs: 1000 },
    last: { Timestamp_UnixMs: 3000 } // ends later
  };
  const sessionC = {
    id: 'c',
    name: 'charlie.csv',
    first: { Timestamp_UnixMs: 1000 },
    last: { Timestamp_UnixMs: 2000 } // same start & end as sessionA, but charlie > alpha
  };

  const sorted = sortSessionsDescending([sessionA, sessionB, sessionC]);
  // sessionB ends latest (3000 > 2000).
  // Between sessionA and sessionC (both start 1000, end 2000), 'charlie' comes before 'alpha' descending.
  assert.equal(sorted[0].id, 'b');
  assert.equal(sorted[1].id, 'c');
  assert.equal(sorted[2].id, 'a');
});

test('sortSessionsDescending integrates with real buildSession objects', () => {
  const file1 = {
    name: 'ride-2026-09-01.csv',
    content: 'Timestamp_ISO,Timestamp_UnixMs,Elapsed_Sec,Battery_Pct,Distance_km\n' +
      '2026-09-01T08:00:00Z,1788249600000,0,100,0\n' +
      '2026-09-01T08:30:00Z,1788251400000,1800,90,10'
  };
  const file2 = {
    name: 'ride-2026-09-15.csv',
    content: 'Timestamp_ISO,Timestamp_UnixMs,Elapsed_Sec,Battery_Pct,Distance_km\n' +
      '2026-09-15T09:00:00Z,1789462800000,0,100,0\n' +
      '2026-09-15T09:45:00Z,1789465500000,2700,85,15'
  };
  const file3 = {
    name: 'ride-2026-10-01.csv',
    content: 'Timestamp_ISO,Timestamp_UnixMs,Elapsed_Sec,Battery_Pct,Distance_km\n' +
      '2026-10-01T07:00:00Z,1790838000000,0,100,0\n' +
      '2026-10-01T08:00:00Z,1790841600000,3600,70,22'
  };

  const session1 = buildSession(file1, '1');
  const session2 = buildSession(file2, '2');
  const session3 = buildSession(file3, '3');

  // Input array in chronological order
  const chronological = [session1, session2, session3];
  const dropdownOrder = sortSessionsDescending(chronological);

  // Should be ordered most recent (file3, October) to least recent (file1, early September)
  assert.equal(dropdownOrder[0].id, '3');
  assert.equal(dropdownOrder[1].id, '2');
  assert.equal(dropdownOrder[2].id, '1');
  assert.ok(dropdownOrder[0].label.startsWith('2026-10-01'));
  assert.ok(dropdownOrder[1].label.startsWith('2026-09-15'));
  assert.ok(dropdownOrder[2].label.startsWith('2026-09-01'));
});

