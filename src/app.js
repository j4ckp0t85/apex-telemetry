const $ = selector => document.querySelector(selector);
const fmt = (value, digits = 1) => i18n.number(value, digits);
const emphasize = text => `<b>${text}</b>`;
let telemetrySessions = [];
let exampleSession = null;
let exampleEnabled = false;
let personalFilterMode = 'all';
let telemetryFolder = null;
let overviewSubtitle = i18n.t("SELECT_FOLDER_TO_START_ANALYSIS");
let currentPage = 'overview';

function showPage(page) {
  const importing = page === 'import';
  currentPage = importing ? 'import' : 'overview';
  $('#overviewScreen').classList.toggle('hidden', importing);
  $('#importScreen').classList.toggle('hidden', !importing);
  $('#overviewNav').classList.toggle('active', !importing);
  $('#importNav').classList.toggle('active', importing);
  $('#pageTitle').textContent = importing ? i18n.t("IMPORT_DATA") : i18n.t("RIDE_OVERVIEW");
  $('#pageEyebrow').textContent = importing ? i18n.t("DATA_IMPORT") : i18n.t("ANALYTICS_LIVE_WORKSPACE");
  $('#sourceText').textContent = importing ? i18n.t("CHOOSE_IMPORT_SOURCE_INSTRUCTION") : overviewSubtitle;
}

const { parseCSV, buildSession, prepareChartRows, nearestSample, sessionDuration, durationHoursMinutes, durationHoursMinutesSeconds, sortSessionsDescending } = TelemetryData;
let chartViews = [];
const chartLayouts = new Map();
const chartResizeObserver = new ResizeObserver(entries => {
  for (const entry of entries) chartLayouts.get(entry.target)?.(entry.contentRect);
});
let selectedRows = new Map();
let routeMap;
let focusedSampleId = null;

function focusSample(id, source = 'chart') {
  const row = selectedRows.get(id) || null;
  focusedSampleId = row?.Sample_Id || null;
  chartViews.forEach(view => view(row));
  routeMap?.focus(focusedSampleId, source);
  document.querySelectorAll('#assistChart .bar-row').forEach(bar => {
    bar.classList.toggle('sample-active', !!row && bar.dataset.level === String(row.Assist_Level));
  });
  $('#assistFocus').textContent = row ? i18n.t("SELECTED_SAMPLE_ASSIST_LEVEL", { level: fmt(row.Assist_Level, 0) }) : i18n.t("INSPECT_ASSIST_LEVEL_INSTRUCTION");
}

function sampleRows(data, limit = 260) {
  const step = Math.max(1, Math.ceil(data.length / limit));
  const sampled = data.filter((_, index) => index % step === 0);
  if (sampled[sampled.length - 1] !== data[data.length - 1]) sampled.push(data[data.length - 1]);
  return sampled;
}

function createLineChart(container, data, series, useGradient = false, options = {}) {
  const hoverRows = options.hoverRows || data;
  // Draw each CSV independently and retain endpoints when simplifying visuals.
  const groups = [];
  for (const row of data) {
    if (!groups.length || groups[groups.length - 1][0].Session_Id !== row.Session_Id) groups.push([]);
    groups[groups.length - 1].push(row);
  }
  const drawnGroups = options.step ? groups : groups.map(group => sampleRows(group));
  let width = 0, height = 0, plotWidth = 0, plotHeight = 0;
  const pad = { left: 42, right: 12, top: 12, bottom: 28 };
  let minimum = 0, maximum = 1;
  for (const row of hoverRows) for (const item of series) {
    if (Number.isFinite(row[item.key])) { minimum = Math.min(minimum, row[item.key]); maximum = Math.max(maximum, row[item.key]); }
  }
  maximum = options.maximum || maximum;
  const range = maximum - minimum || 1;
  const endMinutes = hoverRows[hoverRows.length - 1].Chart_Min || 0;
  const xFor = row => pad.left + row.Chart_Min / (endMinutes || 1) * plotWidth;
  const yFor = value => pad.top + plotHeight - ((value - minimum) / range) * plotHeight;
  const pointsFor = (rows, key) => rows.map((row, index) => {
    const step = options.step && index > 0 ? xFor(row) + ',' + yFor(rows[index - 1][key]) + ' ' : '';
    return step + xFor(row) + ',' + yFor(Number(row[key]) || 0);
  }).join(' ');
  let svg, layer, vertical, horizontal, dot, tooltip;
  const draw = rect => {
    // SVG coordinates match CSS pixels so labels and strokes never stretch.
    // Hidden pages are redrawn by the observer when they become visible.
    if (rect.width <= pad.left + pad.right || rect.height <= pad.top + pad.bottom ||
        (rect.width === width && rect.height === height)) return;
    width = rect.width; height = rect.height;
    plotWidth = width - pad.left - pad.right;
    plotHeight = height - pad.top - pad.bottom;
    let grid = '';
    for (let index = 0; index < 4; index += 1) {
      const y = pad.top + plotHeight * index / 3;
      grid += '<line class="gridline" x1="' + pad.left + '" x2="' + (width - pad.right) + '" y1="' + y + '" y2="' + y + '"/><text class="axis" x="4" y="' + (y + 4) + '">' + fmt(maximum - (maximum - minimum) * index / 3, 0) + (options.yUnit || '') + '</text>';
    }
    const lines = series.map(item => drawnGroups.map(rows => '<polyline class="' + item.className + '" points="' + pointsFor(rows, item.key) + '"/>').join('')).join('');
    const gradient = useGradient ? '<defs><linearGradient id="speedFill" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#62e6d2" stop-opacity=".24"/><stop offset="1" stop-color="#62e6d2" stop-opacity="0"/></linearGradient></defs>' + drawnGroups.map(rows => '<polygon class="area-speed" points="' + xFor(rows[0]) + ',' + (pad.top + plotHeight) + ' ' + pointsFor(rows, series[0].key) + ' ' + xFor(rows[rows.length - 1]) + ',' + (pad.top + plotHeight) + '"/>').join('') : '';
    container.innerHTML = '<svg class="chart-svg" viewBox="0 0 ' + width + ' ' + height + '">' + gradient + grid + lines + '<text class="axis" x="' + pad.left + '" y="' + (height - 5) + '">0 min</text><text class="axis" text-anchor="end" x="' + (width - pad.right) + '" y="' + (height - 5) + '">' + fmt(endMinutes, 0) + ' min</text><g class="hover-layer hidden"><line class="crosshair crosshair-v"/><line class="crosshair crosshair-h"/><circle class="hover-dot" r="4"/></g></svg><div class="chart-tooltip"></div>';
    svg = container.querySelector('svg'); layer = container.querySelector('.hover-layer');
    vertical = container.querySelector('.crosshair-v'); horizontal = container.querySelector('.crosshair-h');
    dot = container.querySelector('.hover-dot'); tooltip = container.querySelector('.chart-tooltip');
    updateFocus(selectedRows.get(focusedSampleId) || null);
  };
  const updateFocus = row => {
    if (!svg) return;
    container.dataset.focusId = row?.Sample_Id || '';
    if (!row) { layer.classList.add('hidden'); tooltip.classList.remove('visible'); return; }
    const chartX = xFor(row), chartY = yFor(Number(row[series[0].key]) || 0);
    vertical.setAttribute('x1', chartX); vertical.setAttribute('x2', chartX); vertical.setAttribute('y1', pad.top); vertical.setAttribute('y2', pad.top + plotHeight);
    horizontal.setAttribute('x1', pad.left); horizontal.setAttribute('x2', width - pad.right); horizontal.setAttribute('y1', chartY); horizontal.setAttribute('y2', chartY);
    dot.setAttribute('cx', chartX); dot.setAttribute('cy', chartY); layer.classList.remove('hidden');
    const timestamp = i18n.date(row.Timestamp_UnixMs, { dateStyle: 'medium', timeStyle: 'medium' });
    tooltip.innerHTML = '<strong>' + timestamp + '</strong><span>' + i18n.html("SAMPLE_INDEX", { index: fmt(row.Sample_Index + 1, 0) }) + '</span>' + series.map((item, index) => '<span><i class="' + (index ? 'tip-orange' : 'tip-cyan') + '"></i>' + item.label + ': <b>' + fmt(row[item.key], 1) + ' ' + item.unit + '</b></span>').join('');
    const rect = svg.getBoundingClientRect();
    tooltip.style.left = Math.max(0, Math.min(chartX / width * rect.width + 10, rect.width - tooltip.offsetWidth)) + 'px';
    tooltip.style.top = '8px';
    tooltip.classList.add('visible');
  };
  chartViews.push(updateFocus);
  chartLayouts.set(container, draw);
  draw(container.getBoundingClientRect());
  chartResizeObserver.observe(container);
  container.onmousemove = event => {
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const pointerX = (event.clientX - rect.left) / rect.width * width;
    const ratio = Math.max(0, Math.min(1, (pointerX - pad.left) / plotWidth));
    focusSample(nearestSample(hoverRows, ratio * endMinutes)?.Sample_Id);
  };
  container.onmouseleave = () => focusSample(null);
}

function sessionDistance(session) {
  const values = session.rows.map(row => Number(row.Distance_km)).filter(Number.isFinite);
  return values.length ? Math.max(0, Math.max(...values) - Math.min(...values)) : 0;
}


function renderDashboard(sessions) {
  const viewingExample = $('#filterMode').value === 'example';
  const singleSession = viewingExample || $('#filterMode').value === 'session';
  $('#exampleNotice').classList.toggle('hidden', !viewingExample);
  $('#fileCount').textContent = viewingExample ? '' : i18n.t('FILE_COUNT', { count: telemetrySessions.length });
  $('#sourceText').title = viewingExample ? exampleSession.name : telemetryFolder || '';
  const data = prepareChartRows(sessions);
  chartResizeObserver.disconnect();
  chartLayouts.clear();
  chartViews = [];
  selectedRows = new Map(data.map(row => [row.Sample_Id, row]));
  routeMap.setSessions(sessions, data, singleSession && sessions.length === 1);
  const first = sessions[0].first, last = sessions[sessions.length - 1].last;
  const totalDistance = sessions.reduce((sum, session) => sum + sessionDistance(session), 0);
  const totalDuration = sessions.reduce((sum, session) => sum + sessionDuration(session), 0);
  const durationParts = durationHoursMinutesSeconds(totalDuration);
  const formattedDuration = i18n.t("DURATION_HOURS_MINUTES_SECONDS", {
    hours: fmt(durationParts.hours, 0),
    minutes: fmt(durationParts.minutes, 0),
    seconds: String(durationParts.seconds).padStart(2, '0')
  });
  const battery = summarizeBatteryUsage(sessions);
  const batteryStatus = battery.included === 0 ? i18n.t("UNAVAILABLE") : battery.included < battery.total ? i18n.t("PARTIAL_ESTIMATE") : i18n.t("ESTIMATED_FROM_REPORTED_CHARGE");
  const maximumSpeed = data.reduce((maximum, row) => Math.max(maximum, row.Speed_kmh || 0), 0);
  const maximumMotor = data.reduce((maximum, row) => Math.max(maximum, row.Motor_Watts || 0), 0);
  const maximumTemperature = data.reduce((maximum, row) => Math.max(maximum, row.Motor_Temp_C || 0, row.Controller_Temp_C || 0), 0);
  overviewSubtitle = i18n.t("RIDE_SELECTION_SUMMARY", { sessions: i18n.t('SESSION_COUNT', { count: sessions.length }), from: first.Timestamp_ISO.slice(0, 10), to: last.Timestamp_ISO.slice(0, 10), duration: fmt(totalDuration, 0) });
  if (currentPage === 'overview') $('#sourceText').textContent = overviewSubtitle;
  $('#filterSummary').textContent = i18n.t("FILTER_SELECTION_SUMMARY", { count: sessions.length, distance: fmt(totalDistance, 1), duration: fmt(totalDuration, 0) });
  $('#metrics').innerHTML = [
    [i18n.t("DISTANCE"), fmt(totalDistance, 1), 'km', i18n.t("AGGREGATED_TOTAL")],
    [i18n.t("RIDE_TIME"), formattedDuration, '', i18n.t("AGGREGATED_TOTAL")],
    [i18n.t("TOP_SPEED"), fmt(maximumSpeed, 1), 'km/h', i18n.t("ACROSS_SELECTION")],
    [i18n.t("MOTOR_PEAK"), fmt(maximumMotor, 0), 'W', i18n.t("ACROSS_SELECTION")],
    [i18n.t("BATTERY_USED"), fmt(battery.used, 1), 'pp', batteryStatus]
  ].map(item => `<div class="metric"><div class="metric-label">${item[0]}</div><div class="metric-value">${item[1]}${item[2] ? ` <span class="metric-unit">${item[2]}</span>` : ''}</div><div class="metric-trend">↗ ${item[3]}</div></div>`).join('');
  createLineChart($('#performanceChart'), data, [{ key: 'Speed_kmh', label: i18n.t("SPEED"), unit: 'km/h', className: 'line-speed' }, { key: 'Motor_Watts', label: i18n.t("MOTOR"), unit: 'W', className: 'line-power' }], true);
  createLineChart($('#temperatureChart'), data, [{ key: 'Motor_Temp_C', label: i18n.t("MOTOR_TEMP"), unit: '°C', className: 'line-temp' }, { key: 'Controller_Temp_C', label: i18n.t("CONTROLLER_TEMP"), unit: '°C', className: 'line-power' }]);
  $('#batteryChart').innerHTML = `<div class="battery-total"><strong>${fmt(battery.used, 1)} <span>pp</span></strong><span>${batteryStatus}</span></div>`;
  const dischargeRows = singleSession && sessions.length === 1 ? batteryDischargeRows(sessions[0]) : null;
  $('#batteryChart').classList.toggle('has-discharge', Boolean(dischargeRows));
  if (dischargeRows) {
    $('#batteryChart').insertAdjacentHTML('beforeend', '<div class="battery-discharge-title">' + i18n.html("REPORTED_CHARGE_OVER_TIME") + '</div><div id="batteryDischargeChart" class="chart-wrap battery-discharge" role="img" aria-label="' + i18n.html("BATTERY_CHARGE_TIME_ACCESSIBILITY_DESCRIPTION") + '"></div>');
    createLineChart($('#batteryDischargeChart'), dischargeRows, [{ key: 'Battery_Pct', label: i18n.t("REPORTED_CHARGE"), unit: '%', className: 'line-speed' }], false,
      { timeAxis: true, step: true, hoverRows: data, maximum: 100, yUnit: '%' });
  }
  const batteryNotes = [
    i18n.html("BATTERY_CHARGE_DROP_SUMMARY", {
      sessions: i18n.t("BATTERY_INCLUDED_SESSIONS", { included: fmt(battery.included, 0), total: fmt(battery.total, 0) })
    }, { sessions: emphasize }),
    i18n.html("BATTERY_PERCENTAGE_POINTS_NOTICE")
  ];
  if (battery.increases) batteryNotes.push(i18n.html("BATTERY_EXCLUDED_CHARGE_INCREASE", {
    count: battery.increases, exclusion: i18n.t("BATTERY_CHARGE_INCREASE_EXCLUSION", { count: battery.increases })
  }, { exclusion: emphasize }));
  if (battery.invalid) batteryNotes.push(i18n.html("BATTERY_EXCLUDED_INVALID_READINGS", {
    count: battery.invalid, exclusion: i18n.t("BATTERY_INVALID_READINGS_EXCLUSION", { count: battery.invalid })
  }, { exclusion: emphasize }));
  batteryNotes.push(i18n.html("BATTERY_PROVENANCE_NOTICE"));
  if (sessions.length === 1) {
    const remaining = Number.isFinite(last.Battery_Pct) && last.Battery_Pct >= 0 && last.Battery_Pct <= 100 ? last.Battery_Pct : null;
    batteryNotes.push(i18n.html("BATTERY_REMAINING_RANGE_SUMMARY", {
      chargeValue: i18n.t("BATTERY_CHARGE_VALUE", { charge: fmt(remaining, 0) }),
      rangeValue: i18n.t("BATTERY_RANGE_VALUE", { range: fmt(last.Range_Est_km, 1) })
    }, { chargeValue: emphasize, rangeValue: emphasize }));
    if (singleSession && !dischargeRows) batteryNotes.push(i18n.html("BATTERY_DISCHARGE_REQUIREMENTS", { minimum: BATTERY_DISCHARGE_MIN_PP }));
  }
  $('#batteryNote').innerHTML = batteryNotes.map(note => `<p>${note}</p>`).join('');
  $('#tempChip').textContent = i18n.t("PEAK_TEMPERATURE", { temperature: fmt(maximumTemperature, 0) });
  const counts = {}; data.forEach(row => { counts[row.Assist_Level] = (counts[row.Assist_Level] || 0) + 1; });
  $('#assistChart').innerHTML = Object.entries(counts).sort((a, b) => Number(a[0]) - Number(b[0])).map(([level, count]) => { const percentage = count / data.length * 100; return `<div class="bar-row" data-level="${Number(level)}" tabindex="0"><span>${i18n.html("LEVEL_NUMBER", { level: fmt(Number(level), 0) })}</span><div class="bar-track"><div class="bar-fill" style="width:${percentage}%"></div></div><span>${fmt(percentage, 0)}%</span></div>`; }).join('');
  document.querySelectorAll('#assistChart .bar-row').forEach(bar => {
    const inspect = () => {
      const current = selectedRows.get(focusedSampleId);
      const row = current && String(current.Assist_Level) === bar.dataset.level ? current : data.find(item => String(item.Assist_Level) === bar.dataset.level);
      focusSample(row?.Sample_Id, 'assist');
    };
    bar.onmouseenter = inspect; bar.onfocus = inspect;
    bar.onmouseleave = () => focusSample(null); bar.onblur = () => focusSample(null);
  });
  focusSample(null);
  const moving = data.filter(row => row.Speed_kmh > 2), assisted = data.filter(row => row.Motor_Watts > 0);
  const movingAverage = moving.reduce((sum, row) => sum + row.Speed_kmh, 0) / (moving.length || 1);
  const averagePower = assisted.reduce((sum, row) => sum + row.Motor_Watts, 0) / (assisted.length || 1);
  $('#insightCards').innerHTML = [['⌁', i18n.t("SELECTED_SCOPE"), i18n.t("SELECTED_SCOPE_SUMMARY", { sessions: i18n.t('SESSION_COUNT', { count: sessions.length }), distance: fmt(totalDistance, 1) })], ['◒', i18n.t("EFFICIENCY"), i18n.t("AVERAGE_ASSISTED_MOTOR_POWER", { power: fmt(averagePower, 0) })], ['♨', i18n.t("RIDE_PROFILE"), i18n.t("RIDE_PROFILE_SUMMARY", { speed: fmt(movingAverage, 1), temperature: fmt(maximumTemperature, 0) })]].map(item => `<div class="insight"><div class="insight-icon">${item[0]}</div><strong>${item[1]}</strong><p>${item[2]}</p></div>`).join('');
  $('#dashboard').classList.remove('hidden'); $('#emptyState').classList.add('hidden'); $('#dropzone').classList.add('hidden');
}

function updateFilterVisibility() {
  const mode = $('#filterMode').value;
  if (mode !== 'session' && mode !== 'example') routeMap?.setSessions([], [], false);
  $('#dateFields').classList.toggle('hidden', mode !== 'range');
  $('#sessionFields').classList.toggle('hidden', mode !== 'session');
  $('#applyFilter').classList.toggle('hidden', mode !== 'range');
}

function applyFilter() {
  const mode = $('#filterMode').value;
  let selected = telemetrySessions;
  if (mode === 'example') selected = exampleEnabled && exampleSession ? [exampleSession] : [];
  else personalFilterMode = mode;
  if (mode === 'session') selected = telemetrySessions.filter(session => session.id === $('#sessionSelect').value);
  if (mode === 'range') {
    const from = $('#dateFrom').value || '0000-01-01', to = $('#dateTo').value || '9999-12-31';
    selected = telemetrySessions.filter(session => session.date >= from && session.date <= to);
  }
  if (!selected.length) { showError(new Error(i18n.t("NO_SESSIONS_MATCH_FILTER"))); return false; }
  $('#error').classList.add('hidden');
  renderDashboard(selected);
  return true;
}

function configureFilters(preserveRange = false) {
  const dates = telemetrySessions.map(session => session.date).sort();
  const from = (preserveRange && $('#dateFrom').value) || dates[0] || '';
  const to = (preserveRange && $('#dateTo').value) || dates[dates.length - 1] || '';
  $('#dateFrom').min = dates[0] || ''; $('#dateFrom').max = dates[dates.length - 1] || ''; $('#dateFrom').value = from;
  $('#dateTo').min = dates[0] || ''; $('#dateTo').max = dates[dates.length - 1] || ''; $('#dateTo').value = to;
  const selectedSession = $('#sessionSelect').value;
  const dropdownSessions = sortSessionsDescending(telemetrySessions);
  $('#sessionSelect').replaceChildren(...dropdownSessions.map(session => new Option(session.label, session.id)));
  if (telemetrySessions.some(session => session.id === selectedSession)) $('#sessionSelect').value = selectedSession;
  for (const option of $('#filterMode').options) {
    option.disabled = option.value === 'example' ? !exampleEnabled : !telemetrySessions.length;
    if (option.value === 'example') option.hidden = !exampleEnabled;
  }
  $('#filters').classList.toggle('hidden', !telemetrySessions.length && !exampleEnabled);
  $('#fileCount').textContent = i18n.t("FILE_COUNT", { count: telemetrySessions.length });
  updateFilterVisibility();
}

function showEmptyDashboard() {
  chartResizeObserver.disconnect(); chartLayouts.clear(); chartViews = [];
  selectedRows.clear(); focusSample(null); routeMap?.setSessions([], [], false);
  $('#dashboard').classList.add('hidden'); $('#filters').classList.add('hidden');
  $('#exampleNotice').classList.add('hidden'); $('#emptyState').classList.remove('hidden');
  $('#fileCount').textContent = ''; $('#filterSummary').textContent = '';
  $('#sourceText').title = telemetryFolder || '';
  overviewSubtitle = i18n.t(telemetryFolder ? 'FOLDER_READY_FOR_SYNC' : 'SELECT_FOLDER_TO_START_ANALYSIS');
  if (currentPage === 'overview') $('#sourceText').textContent = overviewSubtitle;
}

async function readExampleSession() {
  if (!exampleSession) {
    const file = await window.telemetryAPI.readExample();
    exampleSession = buildSession(file, 'bundled-example');
    if (!exampleSession) throw new Error('The bundled example has no valid telemetry samples.');
    $('#exampleFileName').textContent = file.name;
  }
}

async function setExampleEnabled(enabled) {
  const toggle = $('#showExample');
  const previous = exampleEnabled;
  toggle.disabled = true; $('#tryExample').disabled = true;
  try {
    $('#error').classList.add('hidden');
    if (enabled) await readExampleSession();
    await window.telemetryAPI.saveExampleEnabled(enabled);
    exampleEnabled = enabled; toggle.checked = enabled;
    if (enabled) {
      if ($('#filterMode').value !== 'example') personalFilterMode = $('#filterMode').value;
      $('#filterMode').value = 'example';
    } else if ($('#filterMode').value === 'example') $('#filterMode').value = personalFilterMode;
    configureFilters(true);
    if (telemetrySessions.length || enabled) {
      if (!applyFilter() && !enabled) {
        // A previously empty date filter cannot leave hidden example data on screen.
        $('#filterMode').value = 'all'; updateFilterVisibility(); applyFilter();
      }
    }
    else showEmptyDashboard();
    if (enabled) showPage('overview');
  } catch (error) { toggle.checked = previous; showError(error); }
  finally { toggle.disabled = false; $('#tryExample').disabled = false; }
}

function showError(error) {
  console.error(error); const element = $('#error'); element.textContent = i18n.message(error); element.classList.remove('hidden');
}

async function loadFolder(folder) {
  const button = $('#chooseBtn');
  try {
    $('#error').classList.add('hidden'); button.disabled = true; button.innerHTML = '<span>◌</span> ' + i18n.html("LOADING");
    if (window.updatePhoneSyncDestination) window.updatePhoneSyncDestination(folder);
    const result = await window.telemetryAPI.readFolder(folder);
    telemetryFolder = folder;
    telemetrySessions = result.files.map(buildSession).filter(Boolean).sort((a, b) => a.first.Timestamp_UnixMs - b.first.Timestamp_UnixMs);
    configureFilters();
    if (exampleEnabled && ($('#filterMode').value === 'example' || !telemetrySessions.length)) {
      $('#filterMode').value = 'example'; updateFilterVisibility(); applyFilter();
    }
    else if (telemetrySessions.length) {
      $('#filterMode').value = 'all'; updateFilterVisibility(); applyFilter();
    } else showEmptyDashboard();
  } catch (error) { showError(error); }
  finally {
    button.disabled = false;
    if (window.updateFolderCard) window.updateFolderCard(folder);
    else button.innerHTML = folder ? '<span class="btn-icon">⇄</span> ' + i18n.html("CHANGE_FOLDER") : '<span>＋</span> ' + i18n.html("CHOOSE_FOLDER");
  }
}

async function chooseFolder() {
  try {
    const folder = await window.telemetryAPI.chooseFolder();
    if (folder) {
      try { localStorage.setItem('apex_csv_folder_expanded', 'false'); } catch (_) {}
      await window.telemetryAPI.saveFolder(folder);
      await loadFolder(folder);
    }
  } catch (error) { showError(error); }
}

async function loadSavedFolder() {
  try {
    const folder = await window.telemetryAPI.getSavedFolder();
    if (folder) await loadFolder(folder);
  } catch (error) { showError(error); }
}

window.addEventListener('DOMContentLoaded', async () => {
  await window.localizationReady;
  overviewSubtitle = i18n.t('SELECT_FOLDER_TO_START_ANALYSIS');
  routeMap = new RouteMap(focusSample);
  window.setupPhoneSync(loadFolder);
  $('#chooseBtn').addEventListener('click', chooseFolder);
  $('#showExample').addEventListener('change', event => setExampleEnabled(event.target.checked));
  $('#tryExample').addEventListener('click', () => setExampleEnabled(true));
  $('#overviewNav').addEventListener('click', () => showPage('overview'));
  $('#importNav').addEventListener('click', () => showPage('import'));
  $('#filterMode').addEventListener('change', () => { updateFilterVisibility(); if ($('#filterMode').value !== 'range') applyFilter(); });
  $('#applyFilter').addEventListener('click', applyFilter); $('#sessionSelect').addEventListener('change', () => { if ($('#filterMode').value === 'session') applyFilter(); });
  const donationModal = $('#donationModal');
  window.telemetryAPI.appInfo().then(info => { $('#appVersion').textContent = info.version; });
  const openDonation = () => donationModal.classList.remove('hidden');
  const closeDonation = () => donationModal.classList.add('hidden');
  $('#donationOpen').addEventListener('click', openDonation);
  $('#donationX').addEventListener('click', closeDonation);
  $('#donationClose').addEventListener('click', closeDonation);
  donationModal.addEventListener('click', event => { if (event.target === donationModal) closeDonation(); });
  $('#donateKofi').addEventListener('click', async () => { closeDonation(); await window.telemetryAPI.openExternal('https://ko-fi.com/j4ckp0t85'); });
  $('#donatePaypal').addEventListener('click', async () => { closeDonation(); await window.telemetryAPI.openExternal('https://www.paypal.com/donate/?business=ZDARGHTS7LUDA&no_recurring=1&currency_code=EUR'); });
  const themeLightBtn = $('#themeLight');
  const themeDarkBtn = $('#themeDark');
  const applyTheme = theme => {
    const isDark = theme === 'dark';
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    if (themeLightBtn && themeDarkBtn) {
      themeLightBtn.classList.toggle('active', !isDark);
      themeLightBtn.setAttribute('aria-checked', String(!isDark));
      themeDarkBtn.classList.toggle('active', isDark);
      themeDarkBtn.setAttribute('aria-checked', String(isDark));
    }
  };
  const setTheme = async theme => {
    applyTheme(theme);
    try {
      await window.telemetryAPI.saveTheme(theme);
    } catch (error) {
      showError(error);
      applyTheme(document.documentElement.dataset.theme || 'dark');
    }
  };
  if (themeLightBtn) themeLightBtn.addEventListener('click', () => setTheme('light'));
  if (themeDarkBtn) themeDarkBtn.addEventListener('click', () => setTheme('dark'));
  const switchThemeOnKey = event => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const isCurrentlyDark = document.documentElement.dataset.theme === 'dark';
      const targetTheme = isCurrentlyDark ? 'light' : 'dark';
      setTheme(targetTheme);
      (targetTheme === 'dark' ? themeDarkBtn : themeLightBtn)?.focus();
    }
  };
  themeLightBtn?.addEventListener('keydown', switchThemeOnKey);
  themeDarkBtn?.addEventListener('keydown', switchThemeOnKey);
  window.telemetryAPI.getTheme().then(applyTheme).catch(showError);
  window.addEventListener('keydown', event => { if (event.key === 'Escape') closeDonation(); });
  await loadSavedFolder();
  try {
    if (await window.telemetryAPI.getExampleEnabled()) {
      await readExampleSession(); exampleEnabled = true; $('#showExample').checked = true;
      $('#filterMode').value = 'example'; configureFilters(); applyFilter();
    }
  } catch (error) { showError(error); }
  finally { $('#showExample').disabled = false; $('#tryExample').disabled = false; }
});
