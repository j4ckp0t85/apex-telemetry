// Conservative, deterministic off-road gap handling. No road matching or routing.
(function (root) {
  const GPS_POLICY = Object.freeze({ maxGapSeconds: 15, maxMissingSamples: 10, maxBridgeMeters: 60,
    maxContinuousSeconds: 30, maxSpeedMetersPerSecond: 30, jitterMeters: 20 });
  const radians = value => value * Math.PI / 180;
  const longitudeDelta = (from, to) => ((to - from + 540) % 360) - 180;
  const normalizeLongitude = value => ((value + 540) % 360) - 180;

  function validPosition(row) {
    return Number.isFinite(row.GPS_Latitude) && Math.abs(row.GPS_Latitude) <= 90 &&
      Number.isFinite(row.GPS_Longitude) && Math.abs(row.GPS_Longitude) <= 180;
  }

  function distanceMeters(a, b) {
    const dlat = radians(b.lat - a.lat), dlng = radians(longitudeDelta(a.lng, b.lng));
    const h = Math.sin(dlat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dlng / 2) ** 2;
    return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
  }

  function buildRouteModel(sessions, policy = GPS_POLICY) {
    const segments = [], samples = [];
    let measured = 0, estimated = 0, bridgedGaps = 0, breaks = 0, sessionsWithoutGPS = 0;
    for (const session of sessions) {
      let previous = null, segment = null, sessionMeasured = 0;
      const positions = session.rows.map(row => ({ id: row.Sample_Id, sessionId: session.id,
        sampleIndex: row.Sample_Index, timestamp: row.Timestamp_UnixMs, lat: null, lng: null, kind: 'missing' }));
      session.rows.forEach((row, index) => {
        if (!validPosition(row)) return;
        const point = positions[index];
        Object.assign(point, { lat: row.GPS_Latitude, lng: row.GPS_Longitude, kind: 'measured' });
        measured++; sessionMeasured++;
        let join = false;
        if (previous !== null) {
          const before = positions[previous], seconds = (point.timestamp - before.timestamp) / 1000;
          const missing = index - previous - 1, distance = distanceMeters(before, point);
          const plausible = seconds >= 0 && distance <= policy.jitterMeters + policy.maxSpeedMetersPerSecond * seconds;
          join = plausible && seconds <= policy.maxContinuousSeconds;
          if (missing) {
            join = join && seconds > 0 && seconds <= policy.maxGapSeconds && missing <= policy.maxMissingSamples && distance <= policy.maxBridgeMeters;
            if (join) {
              bridgedGaps++;
              for (let cursor = previous + 1; cursor < index; cursor++) {
                const between = positions[cursor];
                const ratio = (between.timestamp - before.timestamp) / (point.timestamp - before.timestamp);
                Object.assign(between, { lat: before.lat + (point.lat - before.lat) * ratio,
                  lng: normalizeLongitude(before.lng + longitudeDelta(before.lng, point.lng) * ratio), kind: 'estimated' });
                segment.push(between); estimated++;
              }
            }
          }
          if (!join) breaks++;
        }
        if (!join) { segment = []; segments.push(segment); }
        segment.push(point);
        previous = index;
      });
      if (!sessionMeasured) sessionsWithoutGPS++;
      for (const position of positions) samples.push(position);
    }
    return { segments, samples, measured, estimated, bridgedGaps, breaks, sessionsWithoutGPS,
      sessionCount: sessions.length, total: samples.length, missing: samples.length - measured - estimated };
  }

  const api = { GPS_POLICY, validPosition, distanceMeters, buildRouteModel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GpsRoute = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
