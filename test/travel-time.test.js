const test = require('node:test');
const assert = require('node:assert/strict');
const { sessionDuration, durationHoursMinutes, durationHoursMinutesSeconds, buildSession } = require('../src/telemetry-data');
const { create } = require('../src/i18n');
const english = require('../src/locales/en.json');
const italian = require('../src/locales/it.json');

test('sessionDuration calculates accurate duration from Elapsed_Sec or timestamps', () => {
  const sessionWithElapsed = {
    first: { Elapsed_Sec: 10, Timestamp_UnixMs: 10000 },
    last: { Elapsed_Sec: 4600, Timestamp_UnixMs: 4600000 }
  };
  // 4600 - 10 = 4590 seconds = 76.5 minutes
  assert.equal(sessionDuration(sessionWithElapsed), 76.5);

  const sessionWithoutElapsed = {
    first: { Elapsed_Sec: NaN, Timestamp_UnixMs: 10000 },
    last: { Elapsed_Sec: NaN, Timestamp_UnixMs: 190000 }
  };
  // (190000 - 10000) / 60000 = 3 minutes
  assert.equal(sessionDuration(sessionWithoutElapsed), 3);

  // Edge cases: null, empty, or negative elapsed
  assert.equal(sessionDuration(null), 0);
  assert.equal(sessionDuration({}), 0);
  assert.equal(sessionDuration({ first: { Elapsed_Sec: 50 }, last: { Elapsed_Sec: 10 } }), 0);
});

test('durationHoursMinutes converts minutes to hours and minutes with proper rounding', () => {
  assert.deepEqual(durationHoursMinutes(0), { hours: 0, minutes: 0 });
  assert.deepEqual(durationHoursMinutes(45), { hours: 0, minutes: 45 });
  assert.deepEqual(durationHoursMinutes(60), { hours: 1, minutes: 0 });
  assert.deepEqual(durationHoursMinutes(75), { hours: 1, minutes: 15 });
  assert.deepEqual(durationHoursMinutes(125.4), { hours: 2, minutes: 5 });
  assert.deepEqual(durationHoursMinutes(125.8), { hours: 2, minutes: 6 });
  assert.deepEqual(durationHoursMinutes(1445), { hours: 24, minutes: 5 });
  assert.deepEqual(durationHoursMinutes(-10), { hours: 0, minutes: 0 });
  assert.deepEqual(durationHoursMinutes(NaN), { hours: 0, minutes: 0 });
  assert.deepEqual(durationHoursMinutes(null), { hours: 0, minutes: 0 });
});

test('durationHoursMinutesSeconds breaks down duration with exact seconds', () => {
  assert.deepEqual(durationHoursMinutesSeconds(0), { hours: 0, minutes: 0, seconds: 0 });
  assert.deepEqual(durationHoursMinutesSeconds(45), { hours: 0, minutes: 45, seconds: 0 });
  assert.deepEqual(durationHoursMinutesSeconds(60), { hours: 1, minutes: 0, seconds: 0 });
  assert.deepEqual(durationHoursMinutesSeconds(75), { hours: 1, minutes: 15, seconds: 0 });
  // 125.4 min = 125 min 24 s = 2 h 5 min 24 s
  assert.deepEqual(durationHoursMinutesSeconds(125.4), { hours: 2, minutes: 5, seconds: 24 });
  // 125.8 min = 125 min 48 s = 2 h 5 min 48 s
  assert.deepEqual(durationHoursMinutesSeconds(125.8), { hours: 2, minutes: 5, seconds: 48 });
  // 180.16333333333333 min (10809.8 s) rounds to 10810 s = 3 h 0 min 10 s
  assert.deepEqual(durationHoursMinutesSeconds(180.16333333333333), { hours: 3, minutes: 0, seconds: 10 });
  // Single sessions:
  // Session 1: 71.135 min (4268.1 s) -> 4268 s = 1 h 11 min 8 s
  assert.deepEqual(durationHoursMinutesSeconds(71.135), { hours: 1, minutes: 11, seconds: 8 });
  // Session 2: 66.855 min (4011.3 s) -> 4011 s = 1 h 6 min 51 s
  assert.deepEqual(durationHoursMinutesSeconds(66.855), { hours: 1, minutes: 6, seconds: 51 });
  // Session 3: 22.513333 min (1350.8 s) -> 1351 s = 0 h 22 min 31 s
  assert.deepEqual(durationHoursMinutesSeconds(22.513333333333332), { hours: 0, minutes: 22, seconds: 31 });
  // Session 4: 19.66 min (1179.6 s) -> 1180 s = 0 h 19 min 40 s
  assert.deepEqual(durationHoursMinutesSeconds(19.66), { hours: 0, minutes: 19, seconds: 40 });
  // Edge cases
  assert.deepEqual(durationHoursMinutesSeconds(-10), { hours: 0, minutes: 0, seconds: 0 });
  assert.deepEqual(durationHoursMinutesSeconds(NaN), { hours: 0, minutes: 0, seconds: 0 });
  assert.deepEqual(durationHoursMinutesSeconds(null), { hours: 0, minutes: 0, seconds: 0 });
});

test('travel time label and duration are localized in Italian and English', () => {
  const it = create('it-IT', italian, english);
  const en = create('en-US', english, english);

  assert.equal(it.t('RIDE_TIME'), 'Tempo di percorrenza');
  assert.equal(en.t('RIDE_TIME'), 'Ride time');

  const parts1 = durationHoursMinutesSeconds(75);
  assert.equal(it.t('DURATION_HOURS_MINUTES_SECONDS', { hours: it.number(parts1.hours, 0), minutes: it.number(parts1.minutes, 0), seconds: String(parts1.seconds).padStart(2, '0') }), '1 h 15 min 00 s');
  assert.equal(en.t('DURATION_HOURS_MINUTES_SECONDS', { hours: en.number(parts1.hours, 0), minutes: en.number(parts1.minutes, 0), seconds: String(parts1.seconds).padStart(2, '0') }), '1 h 15 min 00 s');

  const parts2 = durationHoursMinutesSeconds(42.15);
  // 42.15 min = 42 min 9 s
  assert.equal(it.t('DURATION_HOURS_MINUTES_SECONDS', { hours: it.number(parts2.hours, 0), minutes: it.number(parts2.minutes, 0), seconds: String(parts2.seconds).padStart(2, '0') }), '0 h 42 min 09 s');
  assert.equal(en.t('DURATION_HOURS_MINUTES_SECONDS', { hours: en.number(parts2.hours, 0), minutes: en.number(parts2.minutes, 0), seconds: String(parts2.seconds).padStart(2, '0') }), '0 h 42 min 09 s');

  // Verify the 4 sessions cumulative calculation matches the sum of parts down to the second
  const s1 = durationHoursMinutesSeconds(71.135); // 1h 11m 08s
  const s2 = durationHoursMinutesSeconds(66.855); // 1h 6m 51s
  const s3 = durationHoursMinutesSeconds(22.513333333333332); // 0h 22m 31s
  const s4 = durationHoursMinutesSeconds(19.66); // 0h 19m 40s
  assert.equal(it.t('DURATION_HOURS_MINUTES_SECONDS', { hours: it.number(s1.hours, 0), minutes: it.number(s1.minutes, 0), seconds: String(s1.seconds).padStart(2, '0') }), '1 h 11 min 08 s');
  assert.equal(it.t('DURATION_HOURS_MINUTES_SECONDS', { hours: it.number(s2.hours, 0), minutes: it.number(s2.minutes, 0), seconds: String(s2.seconds).padStart(2, '0') }), '1 h 6 min 51 s');
  assert.equal(it.t('DURATION_HOURS_MINUTES_SECONDS', { hours: it.number(s3.hours, 0), minutes: it.number(s3.minutes, 0), seconds: String(s3.seconds).padStart(2, '0') }), '0 h 22 min 31 s');
  assert.equal(it.t('DURATION_HOURS_MINUTES_SECONDS', { hours: it.number(s4.hours, 0), minutes: it.number(s4.minutes, 0), seconds: String(s4.seconds).padStart(2, '0') }), '0 h 19 min 40 s');

  const total = durationHoursMinutesSeconds(71.135 + 66.855 + 22.513333333333332 + 19.66);
  assert.equal(it.t('DURATION_HOURS_MINUTES_SECONDS', { hours: it.number(total.hours, 0), minutes: it.number(total.minutes, 0), seconds: String(total.seconds).padStart(2, '0') }), '3 h 0 min 10 s');
});

test('aggregated duration correctly sums across multiple sessions', () => {
  const session1 = buildSession({
    name: 'session1.csv',
    content: 'Timestamp_ISO,Timestamp_UnixMs,Elapsed_Sec,Distance_km\n' +
      '2026-09-01T10:00:00Z,1000,0,0\n' +
      '2026-09-01T10:30:00Z,1801000,1800,10\n' // 30 minutes
  }, 0);
  const session2 = buildSession({
    name: 'session2.csv',
    content: 'Timestamp_ISO,Timestamp_UnixMs,Elapsed_Sec,Distance_km\n' +
      '2026-09-02T10:00:00Z,2000,0,0\n' +
      '2026-09-02T10:45:00Z,2702000,2700,15\n' // 45 minutes
  }, 1);

  assert.equal(sessionDuration(session1), 30);
  assert.equal(sessionDuration(session2), 45);

  const totalMinutes = [session1, session2].reduce((sum, s) => sum + sessionDuration(s), 0);
  assert.equal(totalMinutes, 75);

  const parts = durationHoursMinutes(totalMinutes);
  assert.deepEqual(parts, { hours: 1, minutes: 15 });
});

