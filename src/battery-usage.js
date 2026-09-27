// Battery percentage is a reported state of charge, not measured energy in Wh.
// Never join endpoints across CSV files or sum sample-to-sample drops: rebounds
// would count the same discharge twice. Any rise makes that session ambiguous.
function summarizeBatteryUsage(sessions) {
  let used = 0;
  let included = 0;
  let increases = 0;
  let invalid = 0;
  for (const session of sessions) {
    const values = session.rows.map(row => row.Battery_Pct);
    if (values.length < 2 || values.some(value => !Number.isFinite(value) || value < 0 || value > 100)) {
      invalid += 1;
      continue;
    }
    if (values.some((value, index) => index > 0 && value > values[index - 1])) {
      increases += 1;
      continue;
    }
    used += values[0] - values[values.length - 1];
    included += 1;
  }
  return { used: included ? used : null, included, increases, invalid, total: sessions.length };
}

const BATTERY_DISCHARGE_MIN_PP = 5;

function batteryDischargeRows(session) {
  const summary = summarizeBatteryUsage([session]);
  if (summary.used === null || summary.used < BATTERY_DISCHARGE_MIN_PP) return null;
  const rows = session.rows;
  const start = rows[0].Timestamp_UnixMs;
  const end = rows[rows.length - 1].Timestamp_UnixMs;
  if (rows.some((row, index) => !Number.isFinite(row.Timestamp_UnixMs) ||
      (index > 0 && row.Timestamp_UnixMs < rows[index - 1].Timestamp_UnixMs)) || end <= start) return null;
  // Keep every charge transition. Uniform downsampling could hide short steps.
  return rows.filter((row, index) => index === 0 || index === rows.length - 1 ||
    row.Battery_Pct !== rows[index - 1].Battery_Pct)
    .map(row => ({ ...row, Chart_Min: (row.Timestamp_UnixMs - start) / 60000 }));
}

if (typeof module !== 'undefined') module.exports = { summarizeBatteryUsage, batteryDischargeRows, BATTERY_DISCHARGE_MIN_PP };
