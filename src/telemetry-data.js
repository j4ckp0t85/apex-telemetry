// Shared by the renderer and Node tests. GPS is optional in older recordings.
(function (root) {
  function coordinate(raw, limit) {
    if (raw == null || String(raw).trim() === '' || String(raw).trim().toLowerCase() === 'null') return null;
    const value = Number(raw);
    return Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
  }

  function parseCSV(text) {
    const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(value => value.trim());
    return lines.slice(1).map(line => {
      const cells = line.split(',');
      const row = {};
      headers.forEach((header, index) => {
        const raw = (cells[index] || '').trim();
        row[header] = header === 'Timestamp_ISO' ? raw : raw === '' ? NaN : Number(raw);
      });
      // Parse from the original cells: Number('') and Number(null) would invent 0° fixes.
      const lat = coordinate(cells[headers.indexOf('GPS_Latitude')], 90);
      const lng = coordinate(cells[headers.indexOf('GPS_Longitude')], 180);
      row.GPS_Latitude = lat !== null && lng !== null ? lat : null;
      row.GPS_Longitude = lat !== null && lng !== null ? lng : null;
      return row;
    }).filter(row => row.Timestamp_ISO && Number.isFinite(row.Timestamp_UnixMs));
  }

  function buildSession(file, index) {
    const rows = parseCSV(file.content).sort((a, b) => a.Timestamp_UnixMs - b.Timestamp_UnixMs);
    if (!rows.length) return null;
    const id = String(index);
    rows.forEach((row, sampleIndex) => Object.assign(row, {
      Sample_Id: `${id}:${sampleIndex}`, Session_Id: id, Session_Name: file.name, Sample_Index: sampleIndex
    }));
    const first = rows[0], last = rows[rows.length - 1];
    const date = first.Timestamp_ISO.slice(0, 10), time = first.Timestamp_ISO.slice(11, 16);
    return { id, name: file.name, rows, first, last, date, label: `${date} ${time} — ${file.name}` };
  }

  function prepareChartRows(sessions) {
    let offsetMinutes = 0;
    const combined = [];
    for (const session of sessions) {
      for (const row of session.rows) {
        row.Chart_Min = offsetMinutes + (row.Timestamp_UnixMs - session.first.Timestamp_UnixMs) / 60000;
        combined.push(row);
      }
      offsetMinutes += Math.max(0, (session.last.Timestamp_UnixMs - session.first.Timestamp_UnixMs) / 60000);
    }
    return combined;
  }

  // Binary search over original samples, never over downsampled chart vertices.
  function nearestSample(rows, minutes) {
    if (!rows.length) return null;
    let lo = 0, hi = rows.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (rows[mid].Chart_Min < minutes) lo = mid + 1;
      else hi = mid;
    }
    return lo > 0 && minutes - rows[lo - 1].Chart_Min <= rows[lo].Chart_Min - minutes ? rows[lo - 1] : rows[lo];
  }

  function sessionDuration(session) {
    if (!session || !session.first || !session.last) return 0;
    const elapsedFirst = Number(session.first.Elapsed_Sec);
    const elapsedLast = Number(session.last.Elapsed_Sec);
    if (Number.isFinite(elapsedFirst) && Number.isFinite(elapsedLast) && elapsedLast >= elapsedFirst) {
      return (elapsedLast - elapsedFirst) / 60;
    }
    const msFirst = Number(session.first.Timestamp_UnixMs);
    const msLast = Number(session.last.Timestamp_UnixMs);
    if (Number.isFinite(msFirst) && Number.isFinite(msLast) && msLast >= msFirst) {
      return (msLast - msFirst) / 60000;
    }
    return 0;
  }

  function durationHoursMinutes(totalMinutes) {
    const safeMinutes = Math.max(0, Math.round(Number(totalMinutes) || 0));
    const hours = Math.floor(safeMinutes / 60);
    const minutes = safeMinutes % 60;
    return { hours, minutes };
  }

  function durationHoursMinutesSeconds(totalMinutes) {
    const totalSeconds = Math.max(0, Math.round((Number(totalMinutes) || 0) * 60));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return { hours, minutes, seconds };
  }

  function sortSessionsDescending(sessions) {
    if (!Array.isArray(sessions)) return [];
    return [...sessions].sort((a, b) => {
      const timeA = a && a.first ? Number(a.first.Timestamp_UnixMs) || 0 : 0;
      const timeB = b && b.first ? Number(b.first.Timestamp_UnixMs) || 0 : 0;
      if (timeB !== timeA) return timeB - timeA;
      const endA = a && a.last ? Number(a.last.Timestamp_UnixMs) || 0 : 0;
      const endB = b && b.last ? Number(b.last.Timestamp_UnixMs) || 0 : 0;
      if (endB !== endA) return endB - endA;
      return String(b?.name || '').localeCompare(String(a?.name || ''));
    });
  }

  const api = { coordinate, parseCSV, buildSession, prepareChartRows, nearestSample, sessionDuration, durationHoursMinutes, durationHoursMinutesSeconds, sortSessionsDescending, sortSessionsReverseChronological: sortSessionsDescending };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TelemetryData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
