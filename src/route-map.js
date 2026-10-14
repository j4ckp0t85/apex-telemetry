// Parent-side controller. Only the local map frame can send sample-focus events.
class RouteMap {
  constructor(onFocus) {
    this.frame = document.querySelector('#routeFrame');
    this.onFocus = onFocus;
    this.generation = 0;
    this.ready = false;
    this.rows = [];
    this.byId = new Map();
    this.frame.addEventListener('load', () => { this.ready = true; this.sendData(); });
    this.slider = document.querySelector('#sampleSlider');
    this.slider.addEventListener('input', () => this.onFocus(this.rows[Number(this.slider.value)]?.Sample_Id));
    window.addEventListener('message', event => {
      if (event.source !== this.frame.contentWindow || !event.data || event.data.channel !== 'apex-route') return;
      const message = event.data;
      if (message.type === 'ready') { this.ready = true; this.sendData(); }
      if (message.type === 'hover' && this.active && message.generation === this.generation &&
          (message.id === null || this.byId.has(message.id))) this.onFocus(message.id, 'map');
    });
    // The iframe may finish before the parent's DOMContentLoaded callback.
    this.frame.contentWindow.postMessage({ channel: 'apex-route', type: 'hello' }, '*');
    new MutationObserver(() => this.send({ type: 'theme', theme: document.documentElement.dataset.theme }))
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  send(message) {
    if (this.ready) this.frame.contentWindow.postMessage({ channel: 'apex-route', generation: this.generation, ...message }, '*');
  }

  setSessions(sessions, rows, enabled = true) {
    this.active = enabled;
    document.querySelector('#routePanel').classList.toggle('hidden', !enabled);
    if (!enabled) { sessions = []; rows = []; }
    this.rows = rows;
    this.byId = new Map(rows.map((row, index) => [row.Sample_Id, { row, index }]));
    this.model = GpsRoute.buildRouteModel(sessions);
    this.positions = new Map(this.model.samples.map(point => [point.id, point]));
    this.generation++;
    const model = this.model;
    const summary = document.querySelector('#routeSummary');
    summary.textContent = model.measured ?
      i18n.t("GPS_SAMPLE_COVERAGE", { measured: i18n.number(model.measured, 0), total: i18n.number(model.total, 0), segments: i18n.t('SEGMENT_COUNT', { count: model.segments.length }) }) :
      i18n.t("GPS_UNAVAILABLE_SELECTION_NOTICE");
    const notes = [];
    if (model.sessionsWithoutGPS) notes.push(i18n.t("GPS_SESSIONS_WITHOUT_COORDINATES", { missing: model.sessionsWithoutGPS, total: model.sessionCount }));
    if (model.bridgedGaps) notes.push(i18n.t("GPS_BRIDGED_GAPS_SUMMARY", { count: model.bridgedGaps, positions: model.estimated }));
    if (model.breaks) notes.push(i18n.t("GPS_DISCONNECTED_GAPS_SUMMARY", { count: model.breaks }));
    if (model.missing) notes.push(i18n.t("GPS_SAMPLES_WITHOUT_POSITION", { count: model.missing }));
    notes.push(i18n.t("GPS_STRAIGHT_CONNECTION_NOTICE"));
    document.querySelector('#routeNote').textContent = notes.join(' ');
    document.querySelector('#routeEmpty').classList.toggle('hidden', model.measured > 0);
    this.frame.classList.toggle('hidden', model.measured === 0);
    this.slider.max = Math.max(0, rows.length - 1);
    this.slider.value = 0;
    this.slider.disabled = !rows.length;
    this.sendData();
    this.focus(null);
  }

  sendData() {
    this.send({ type: 'locale', config: { locale: i18n.locale, dictionary: i18n.dictionary, english: i18n.english } });
    if (this.model) this.send({ type: 'data', model: this.model, theme: document.documentElement.dataset.theme });
  }

  focus(id, source) {
    if (!this.active) return;
    const entry = this.byId.get(id);
    const point = this.positions?.get(id);
    let label = i18n.t("INSPECT_CHART_OR_ROUTE_INSTRUCTION");
    if (entry) {
      const row = entry.row;
      const location = point?.kind === 'measured' ? i18n.t("RECORDED_GPS") : point?.kind === 'estimated' ? i18n.t("ESTIMATED_GPS_SHORT_GAP") : i18n.t("SAMPLE_GPS_UNAVAILABLE");
      label = i18n.t("SAMPLE_FOCUS_SUMMARY", { time: i18n.date(row.Timestamp_UnixMs), index: i18n.number(row.Sample_Index + 1, 0), location });
      this.slider.value = entry.index;
      this.slider.setAttribute('aria-valuetext', label);
      document.querySelector('#sampleSession').textContent = row.Session_Name;
    } else {
      this.slider.removeAttribute('aria-valuetext');
      document.querySelector('#sampleSession').textContent = '';
    }
    document.querySelector('#sampleFocus').textContent = label;
    const fields = ['Speed_kmh', 'Motor_Watts', 'Rider_Watts', 'Cadence_RPM', 'Motor_Temp_C',
      'Controller_Temp_C', 'Battery_Pct', 'Battery_Voltage_V', 'Distance_km', 'Assist_Level'];
    const sample = entry ? { timestamp: entry.row.Timestamp_UnixMs, index: entry.row.Sample_Index,
      values: Object.fromEntries(fields.map(key => [key, Number.isFinite(entry.row[key]) ? entry.row[key] : null])) } : null;
    this.send({ type: 'focus', id: entry ? id : null, label, source, sample });
  }
}
