/* global L */
let i18n = ApexI18n.create('en');
const map = L.map('map', { minZoom: 1, maxZoom: 19, zoomControl: true, worldCopyJump: false, preferCanvas: true }).setView([0, 0], 2);
L.control.scale({ imperial: false }).addTo(map);
const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, minZoom: 1, noWrap: true, updateWhenIdle: true,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'
});
const routes = L.layerGroup().addTo(map);
const focusMarker = L.circleMarker([0, 0], { radius: 7, color: '#ffffff', weight: 3, fillColor: '#086bea', fillOpacity: 1, interactive: false });
let generation = 0, model = null, samples = new Map(), projected = [], focused = null, pendingPointer = null, pointerFrame = 0;
let tileErrors = 0;
let inspectedId = null;
const status = document.querySelector('#tileStatus');
const online = document.querySelector('#onlineTiles');
const send = message => parent.postMessage({ channel: 'apex-route', generation, ...message }, '*');

function updateTiles() {
  if (online.checked && model?.measured) {
    if (!map.hasLayer(tiles)) tiles.addTo(map);
    status.textContent = tileErrors ? i18n.t("MAP_BACKGROUND_UNAVAILABLE_NOTICE") : i18n.t("MAP_ONLINE_PRIVACY_NOTICE");
  } else {
    tiles.remove();
    status.textContent = i18n.t("MAP_BACKGROUND_OFF_NOTICE");
  }
}
tiles.on('tileerror', () => { tileErrors++; updateTiles(); });
tiles.on('loading', () => { tileErrors = 0; });
tiles.on('load', updateTiles);
online.addEventListener('change', updateTiles);

// Unwrap longitudes so an antimeridian crossing stays a short local segment.
function displaySegments() {
  const anchor = model?.samples.find(point => point.kind !== 'missing')?.lng || 0;
  return (model?.segments || []).map(segment => {
    let previous = anchor;
    return segment.map(point => {
      const lng = point.lng + 360 * Math.round((previous - point.lng) / 360);
      previous = lng;
      return { ...point, displayLng: lng };
    });
  });
}

function fitRoute() {
  const points = displaySegments().flat().map(point => [point.lat, point.displayLng]);
  if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 17, animate: false });
}

function projectRoute() {
  projected = displaySegments().map(segment => segment.map(point => ({ ...point,
    pixel: map.project([point.lat, point.displayLng]) })));
}

function drawRoute() {
  routes.clearLayers();
  for (const segment of displaySegments()) {
    if (segment.every(point => point.lat === segment[0].lat && point.displayLng === segment[0].displayLng)) {
      L.circleMarker([segment[0].lat, segment[0].displayLng], { radius: 4, color: '#1976e9', fillOpacity: 1, interactive: false }).addTo(routes);
      continue;
    }
    let run = [segment[0]], estimated = segment[0].kind === 'estimated' || segment[1].kind === 'estimated';
    const draw = () => L.polyline(run.map(point => [point.lat, point.displayLng]), {
      color: '#1976e9', weight: 4, opacity: .95, dashArray: estimated ? '6 7' : null, interactive: false
    }).addTo(routes);
    for (let index = 1; index < segment.length; index++) {
      const edgeEstimated = segment[index - 1].kind === 'estimated' || segment[index].kind === 'estimated';
      if (edgeEstimated !== estimated) { draw(); run = [segment[index - 1]]; estimated = edgeEstimated; }
      run.push(segment[index]);
    }
    draw();
  }
  fitRoute(); projectRoute(); updateTiles();
}

const readoutFields = [
  ['sampleSpeed', 'Speed_kmh', 1], ['sampleMotor', 'Motor_Watts', 0], ['sampleRider', 'Rider_Watts', 0],
  ['sampleCadence', 'Cadence_RPM', 0], ['sampleMotorTemp', 'Motor_Temp_C', 1],
  ['sampleControllerTemp', 'Controller_Temp_C', 1], ['sampleBattery', 'Battery_Pct', 1],
  ['sampleVoltage', 'Battery_Voltage_V', 2], ['sampleDistance', 'Distance_km', 3], ['sampleAssist', 'Assist_Level', 0]
];

function fitReadoutHeading() {
  const heading = document.querySelector('.readout-heading strong');
  // Keep the same heading height across languages without truncating the text.
  for (let size = 14; size >= 9; size -= .5) {
    heading.style.fontSize = size + 'px';
    if (heading.scrollWidth <= heading.clientWidth) break;
  }
  for (const label of document.querySelectorAll('.readout-values dt')) {
    for (let size = 10; size >= 9; size -= .5) {
      label.style.fontSize = size + 'px';
      if (label.scrollWidth <= label.clientWidth) break;
    }
  }
}

function updateReadout(message = {}) {
  const active = Boolean(message.sample && samples.has(message.id));
  const readout = document.querySelector('.sample-readout');
  readout.dataset.active = String(active);
  if (active) {
    inspectedId = message.id;
    readout.dataset.sampleId = inspectedId;
    document.querySelector('#readoutStatus').textContent = i18n.t("LIVE_SAMPLE");
    document.querySelector('#readoutReference').textContent =
      i18n.t("SAMPLE_TIME_REFERENCE", { time: i18n.date(message.sample.timestamp, { dateStyle: 'medium', timeStyle: 'medium' }), index: i18n.number(message.sample.index + 1, 0) });
    for (const [id, key, digits] of readoutFields) {
      const value = message.sample.values[key];
      document.getElementById(id).textContent = i18n.number(value, digits);
    }
    const kind = samples.get(message.id).kind;
    document.querySelector('#readoutGps').textContent = kind === 'estimated' ? i18n.t("GPS_POSITION_ESTIMATED_NOTICE") :
      kind === 'missing' ? i18n.t("GPS_POSITION_UNAVAILABLE_NOTICE") : i18n.t("RECORDED_GPS_POSITION");
  } else if (inspectedId) {
    document.querySelector('#readoutStatus').textContent = i18n.t("LAST_INSPECTED");
  } else {
    readout.dataset.sampleId = '';
    document.querySelector('#readoutStatus').textContent = i18n.t("HOVER_ROUTE");
    document.querySelector('#readoutReference').textContent = i18n.t("CHOOSE_SAMPLE_INSTRUCTION");
    document.querySelector('#readoutGps').textContent = i18n.t("RECORDED_TELEMETRY_VALUES");
    for (const [id] of readoutFields) document.getElementById(id).textContent = '—';
  }
  fitReadoutHeading();
}

function showFocus(message) {
  focused = samples.get(message.id) || null;
  updateReadout(message);
  document.querySelector('#mapFocus').textContent = message.label || i18n.t("HOVER_BLUE_ROUTE_INSTRUCTION");
  document.body.dataset.focusId = focused?.id || '';
  document.body.dataset.focusKind = focused?.kind || '';
  if (!focused || focused.kind === 'missing') { focusMarker.remove(); return; }
  const lng = focused.lng + 360 * Math.round((map.getCenter().lng - focused.lng) / 360);
  focusMarker.setLatLng([focused.lat, lng]).setStyle({ fillColor: focused.kind === 'estimated' ? '#ffffff' : '#086bea', color: '#086bea' }).addTo(map);
  if (message.source !== 'map' && !map.getBounds().contains(focusMarker.getLatLng())) map.panTo(focusMarker.getLatLng(), { animate: false });
}

// Hit test the drawn segments, including estimates. Long gaps have no edges to hit.
// Cache projection per zoom; panning does not change these world pixel coordinates.
function hoverAt(latlng) {
  const pointer = map.project(latlng);
  let best = null, bestDistance = 24 ** 2;
  function consider(point, distance) {
    const tied = Math.abs(distance - bestDistance) < .01;
    const focusDistance = candidate => focused && candidate.sessionId === focused.sessionId ? Math.abs(candidate.sampleIndex - focused.sampleIndex) : Infinity;
    if (distance < bestDistance - .01 || (tied && best && focusDistance(point) < focusDistance(best))) {
      best = point; bestDistance = distance;
    }
  }
  for (const segment of projected) {
    for (let index = 0; index < segment.length; index++) {
      const point = segment[index], p = point.pixel;
      consider(point, (pointer.x - p.x) ** 2 + (pointer.y - p.y) ** 2);
      if (!index) continue;
      const before = segment[index - 1], a = before.pixel;
      const dx = p.x - a.x, dy = p.y - a.y, length = dx * dx + dy * dy;
      if (!length) continue;
      const ratio = Math.max(0, Math.min(1, ((pointer.x - a.x) * dx + (pointer.y - a.y) * dy) / length));
      consider(ratio < .5 ? before : point, (pointer.x - a.x - ratio * dx) ** 2 + (pointer.y - a.y - ratio * dy) ** 2);
    }
  }
  send({ type: 'hover', id: best?.id || null });
}
map.on('zoomend', projectRoute);
map.on('mousemove', event => {
  pendingPointer = event.latlng;
  if (!pointerFrame) pointerFrame = requestAnimationFrame(() => { pointerFrame = 0; hoverAt(pendingPointer); });
});
map.on('mouseout', () => { cancelAnimationFrame(pointerFrame); pointerFrame = 0; send({ type: 'hover', id: null }); });
document.querySelector('#fitRoute').addEventListener('click', fitRoute);
document.querySelector('#fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (_) { status.textContent = i18n.t("FULL_SCREEN_UNAVAILABLE"); }
});
document.addEventListener('fullscreenchange', () => {
  document.querySelector('#fullscreen').textContent = document.fullscreenElement ? i18n.t("EXIT_FULL_SCREEN") : i18n.t("FULL_SCREEN");
  map.invalidateSize();
});
let resizeFrame = null;
new ResizeObserver(() => {
  // Fitting text can change layout. Defer writes until after observer delivery.
  if (resizeFrame !== null) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null;
    map.invalidateSize();
    fitReadoutHeading();
  });
}).observe(document.querySelector('#map'));
window.addEventListener('message', event => {
  if (event.source !== parent || !event.data || event.data.channel !== 'apex-route') return;
  const message = event.data;
  if (message.type === 'locale') {
    i18n = ApexI18n.create(message.config.locale, message.config.dictionary, message.config.english);
    i18n.apply(document);
    const zoomIn = document.querySelector('.leaflet-control-zoom-in');
    const zoomOut = document.querySelector('.leaflet-control-zoom-out');
    zoomIn.title = i18n.t('ZOOM_IN'); zoomIn.setAttribute('aria-label', zoomIn.title);
    zoomOut.title = i18n.t('ZOOM_OUT'); zoomOut.setAttribute('aria-label', zoomOut.title);
    tiles.options.attribution = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">' + i18n.t('OPENSTREETMAP_CONTRIBUTORS') + '</a>';
    updateReadout(); updateTiles();
  }
  if (message.type === 'hello') send({ type: 'ready' });
  if (message.type === 'theme' || message.type === 'data') document.documentElement.dataset.theme = message.theme === 'dark' ? 'dark' : 'light';
  if (message.type === 'data') {
    generation = message.generation; model = message.model; focused = null; inspectedId = null; focusMarker.remove();
    samples = new Map(model.samples.map(point => [point.id, point]));
    document.body.dataset.generation = String(generation);
    document.body.dataset.focusId = '';
    updateReadout();
    drawRoute();
  }
  if (message.type === 'focus' && message.generation === generation) showFocus(message);
});
send({ type: 'ready' });
