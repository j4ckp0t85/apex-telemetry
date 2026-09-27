const $ = selector => document.querySelector(selector);
const fmt = (value, digits = 1) => Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: digits }) : '—';
let telemetrySessions = [];
let overviewSubtitle = 'Select a folder to start the analysis.';
let currentPage = 'overview';

function showPage(page) {
  const importing = page === 'import';
  currentPage = importing ? 'import' : 'overview';
  $('#overviewScreen').classList.toggle('hidden', importing);
  $('#importScreen').classList.toggle('hidden', !importing);
  $('#overviewNav').classList.toggle('active', !importing);
  $('#importNav').classList.toggle('active', importing);
  $('#pageTitle').textContent = importing ? 'Import data' : 'Ride overview';
  $('#pageEyebrow').textContent = importing ? 'DATA / IMPORT' : 'ANALYTICS / LIVE WORKSPACE';
  $('#sourceText').textContent = importing ? 'Choose a folder on this computer or sync completed sessions from your phone.' : overviewSubtitle;
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
    return row;
  }).filter(row => row.Timestamp_ISO && Number.isFinite(row.Timestamp_UnixMs));
}

function buildSession(file, index) {
  const rows = parseCSV(file.content).sort((a, b) => a.Timestamp_UnixMs - b.Timestamp_UnixMs);
  if (!rows.length) return null;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const date = first.Timestamp_ISO.slice(0, 10);
  const time = first.Timestamp_ISO.slice(11, 16);
  return { id: String(index), name: file.name, rows, first, last, date, label: `${date} ${time} — ${file.name}` };
}

function prepareChartRows(sessions) {
  const combined = [];
  let offsetMinutes = 0;
  sessions.forEach(session => {
    const baseElapsed = session.first.Elapsed_Sec || 0;
    session.rows.forEach(row => { row.Chart_Min = offsetMinutes + ((row.Elapsed_Sec || 0) - baseElapsed) / 60; combined.push(row); });
    offsetMinutes += Math.max(0, ((session.last.Elapsed_Sec || 0) - baseElapsed) / 60);
  });
  return combined;
}

function sampleRows(data, limit = 260) {
  const step = Math.max(1, Math.ceil(data.length / limit));
  const sampled = data.filter((_, index) => index % step === 0);
  if (sampled[sampled.length - 1] !== data[data.length - 1]) sampled.push(data[data.length - 1]);
  return sampled;
}

function createLineChart(container, data, series, useGradient = false, options = {}) {
  const rows = options.timeAxis ? data : sampleRows(data);
  const width = options.width || 720, height = 250;
  const pad = { left: 42, right: 12, top: 12, bottom: 28 };
  const plotWidth = width - pad.left - pad.right, plotHeight = height - pad.top - pad.bottom;
  const values = series.reduce((all, item) => all.concat(rows.map(row => Number(row[item.key]) || 0)), []);
  const minimum = Math.min(0, ...values), maximum = options.maximum || Math.max(1, ...values), range = maximum - minimum || 1;
  const endMinutes = rows[rows.length - 1].Chart_Min || 0;
  const xFor = index => pad.left + (options.timeAxis ? rows[index].Chart_Min / (endMinutes || 1) : rows.length === 1 ? 0 : index / (rows.length - 1)) * plotWidth;
  const yFor = value => pad.top + plotHeight - ((value - minimum) / range) * plotHeight;
  const pointsFor = key => rows.map((row, index) => {
    const step = options.step && index > 0 ? `${xFor(index)},${yFor(rows[index - 1][key])} ` : '';
    return `${step}${xFor(index)},${yFor(Number(row[key]) || 0)}`;
  }).join(' ');
  let grid = '';
  for (let index = 0; index < 4; index += 1) {
    const y = pad.top + plotHeight * index / 3;
    grid += `<line class="gridline" x1="${pad.left}" x2="${width - pad.right}" y1="${y}" y2="${y}"/><text class="axis" x="4" y="${y + 4}">${fmt(maximum - (maximum - minimum) * index / 3, 0)}${options.yUnit || ''}</text>`;
  }
  const lines = series.map(item => `<polyline class="${item.className}" points="${pointsFor(item.key)}"/>`).join('');
  const gradient = useGradient ? `<defs><linearGradient id="speedFill" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#62e6d2" stop-opacity=".24"/><stop offset="1" stop-color="#62e6d2" stop-opacity="0"/></linearGradient></defs><polygon class="area-speed" points="${pad.left},${pad.top + plotHeight} ${pointsFor(series[0].key)} ${width - pad.right},${pad.top + plotHeight}"/>` : '';
  container.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${gradient}${grid}${lines}<text class="axis" x="${pad.left}" y="${height - 5}">0 min</text><text class="axis" x="${width - 55}" y="${height - 5}">${fmt(endMinutes, 0)} min</text><g class="hover-layer hidden"><line class="crosshair crosshair-v"/><line class="crosshair crosshair-h"/><circle class="hover-dot" r="4"/></g></svg><div class="chart-tooltip"></div>`;
  const svg = container.querySelector('svg'), layer = container.querySelector('.hover-layer');
  const vertical = container.querySelector('.crosshair-v'), horizontal = container.querySelector('.crosshair-h');
  const dot = container.querySelector('.hover-dot'), tooltip = container.querySelector('.chart-tooltip');
  container.onmousemove = event => {
    const rect = svg.getBoundingClientRect();
    const pointerX = (event.clientX - rect.left) / rect.width * width;
    const ratio = Math.max(0, Math.min(1, options.timeAxis ? (pointerX - pad.left) / plotWidth : pointerX / width));
    const index = options.timeAxis ? Math.max(0, rows.findLastIndex(row => row.Chart_Min <= ratio * endMinutes)) : Math.min(rows.length - 1, Math.round(ratio * (rows.length - 1)));
    const row = rows[index], chartX = xFor(index), chartY = yFor(Number(row[series[0].key]) || 0);
    vertical.setAttribute('x1', chartX); vertical.setAttribute('x2', chartX); vertical.setAttribute('y1', pad.top); vertical.setAttribute('y2', pad.top + plotHeight);
    horizontal.setAttribute('x1', pad.left); horizontal.setAttribute('x2', width - pad.right); horizontal.setAttribute('y1', chartY); horizontal.setAttribute('y2', chartY);
    dot.setAttribute('cx', chartX); dot.setAttribute('cy', chartY); layer.classList.remove('hidden');
    const timestamp = new Date(row.Timestamp_ISO).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium' });
    tooltip.innerHTML = `<strong>${timestamp}</strong>${series.map((item, itemIndex) => `<span><i class="${itemIndex ? 'tip-orange' : 'tip-cyan'}"></i>${item.label}: <b>${fmt(Number(row[item.key]) || 0, 1)} ${item.unit}</b></span>`).join('')}`;
    tooltip.style.left = `${Math.min(Math.max(event.clientX - rect.left + 12, 8), rect.width - 190)}px`;
    tooltip.style.top = `${Math.max(event.clientY - rect.top - 82, 8)}px`;
    tooltip.classList.add('visible');
  };
  container.onmouseleave = () => { layer.classList.add('hidden'); tooltip.classList.remove('visible'); };
}

function sessionDistance(session) {
  const values = session.rows.map(row => Number(row.Distance_km)).filter(Number.isFinite);
  return values.length ? Math.max(0, Math.max(...values) - Math.min(...values)) : 0;
}

function sessionDuration(session) {
  return Math.max(0, ((session.last.Elapsed_Sec || 0) - (session.first.Elapsed_Sec || 0)) / 60);
}

function renderDashboard(sessions) {
  const data = prepareChartRows(sessions);
  const first = sessions[0].first, last = sessions[sessions.length - 1].last;
  const totalDistance = sessions.reduce((sum, session) => sum + sessionDistance(session), 0);
  const totalDuration = sessions.reduce((sum, session) => sum + sessionDuration(session), 0);
  const battery = summarizeBatteryUsage(sessions);
  const batteryStatus = battery.included === 0 ? 'unavailable' : battery.included < battery.total ? 'partial estimate' : 'estimated from reported charge';
  const maximumSpeed = data.reduce((maximum, row) => Math.max(maximum, row.Speed_kmh || 0), 0);
  const maximumMotor = data.reduce((maximum, row) => Math.max(maximum, row.Motor_Watts || 0), 0);
  const maximumTemperature = data.reduce((maximum, row) => Math.max(maximum, row.Motor_Temp_C || 0, row.Controller_Temp_C || 0), 0);
  overviewSubtitle = `${sessions.length} session${sessions.length === 1 ? '' : 's'} · ${first.Timestamp_ISO.slice(0, 10)} to ${last.Timestamp_ISO.slice(0, 10)} · ${fmt(totalDuration, 0)} min riding`;
  if (currentPage === 'overview') $('#sourceText').textContent = overviewSubtitle;
  $('#filterSummary').textContent = `${sessions.length} selected · ${fmt(totalDistance, 1)} km · ${fmt(totalDuration, 0)} min`;
  $('#metrics').innerHTML = [
    ['Distance', fmt(totalDistance, 1), 'km', 'aggregated total'],
    ['Top speed', fmt(maximumSpeed, 1), 'km/h', 'across selection'],
    ['Motor peak', fmt(maximumMotor, 0), 'W', 'across selection'],
    ['Battery used', fmt(battery.used, 1), 'pp', batteryStatus]
  ].map(item => `<div class="metric"><div class="metric-label">${item[0]}</div><div class="metric-value">${item[1]} <span class="metric-unit">${item[2]}</span></div><div class="metric-trend">↗ ${item[3]}</div></div>`).join('');
  createLineChart($('#performanceChart'), data, [{ key: 'Speed_kmh', label: 'Speed', unit: 'km/h', className: 'line-speed' }, { key: 'Motor_Watts', label: 'Motor', unit: 'W', className: 'line-power' }], true);
  createLineChart($('#temperatureChart'), data, [{ key: 'Motor_Temp_C', label: 'Motor temp', unit: '°C', className: 'line-temp' }, { key: 'Controller_Temp_C', label: 'Controller temp', unit: '°C', className: 'line-power' }]);
  $('#batteryChart').innerHTML = `<div class="battery-total"><strong>${fmt(battery.used, 1)} <span>pp</span></strong><span>${batteryStatus}</span></div>`;
  const dischargeRows = $('#filterMode').value === 'session' && sessions.length === 1 ? batteryDischargeRows(sessions[0]) : null;
  $('#batteryChart').classList.toggle('has-discharge', Boolean(dischargeRows));
  if (dischargeRows) {
    $('#batteryChart').insertAdjacentHTML('beforeend', '<div class="battery-discharge-title">Reported charge over time</div><div id="batteryDischargeChart" class="chart-wrap battery-discharge" role="img" aria-label="Battery charge percentage over elapsed session time"></div>');
    createLineChart($('#batteryDischargeChart'), dischargeRows, [{ key: 'Battery_Pct', label: 'Reported charge', unit: '%', className: 'line-speed' }], false,
      { timeAxis: true, step: true, maximum: 100, yUnit: '%', width: 360 });
  }
  const batteryNotes = [
    `Sum of charge drops in <b>${battery.included} of ${battery.total} sessions</b>.`,
    'pp = percentage points; totals can exceed 100. Charging between sessions does not affect the sum.'
  ];
  if (battery.increases) batteryNotes.push(`<b>${battery.increases} excluded:</b> charge increased within the session (possible charging or gauge recovery).`);
  if (battery.invalid) batteryNotes.push(`<b>${battery.invalid} excluded:</b> missing, invalid or insufficient battery readings.`);
  batteryNotes.push('Based on reported charge levels, not measured energy. Unrecorded consumption is not included.');
  if (sessions.length === 1) {
    const remaining = Number.isFinite(last.Battery_Pct) && last.Battery_Pct >= 0 && last.Battery_Pct <= 100 ? last.Battery_Pct : null;
    batteryNotes.push(`Last reported charge <b>${fmt(remaining, 0)}%</b> · estimated range <b>${fmt(last.Range_Est_km, 1)} km</b>`);
    if ($('#filterMode').value === 'session' && !dischargeRows) batteryNotes.push(`Discharge chart requires at least ${BATTERY_DISCHARGE_MIN_PP} pp of drop, valid timestamps and no charge increases.`);
  }
  $('#batteryNote').innerHTML = batteryNotes.map(note => `<p>${note}</p>`).join('');
  $('#tempChip').textContent = `peak ${fmt(maximumTemperature, 0)}°C`;
  const counts = {}; data.forEach(row => { counts[row.Assist_Level] = (counts[row.Assist_Level] || 0) + 1; });
  $('#assistChart').innerHTML = Object.entries(counts).sort((a, b) => Number(a[0]) - Number(b[0])).map(([level, count]) => { const percentage = count / data.length * 100; return `<div class="bar-row"><span>Level ${level}</span><div class="bar-track"><div class="bar-fill" style="width:${percentage}%"></div></div><span>${fmt(percentage, 0)}%</span></div>`; }).join('');
  const moving = data.filter(row => row.Speed_kmh > 2), assisted = data.filter(row => row.Motor_Watts > 0);
  const movingAverage = moving.reduce((sum, row) => sum + row.Speed_kmh, 0) / (moving.length || 1);
  const averagePower = assisted.reduce((sum, row) => sum + row.Motor_Watts, 0) / (assisted.length || 1);
  $('#insightCards').innerHTML = [['⌁', 'Selected scope', `${sessions.length} session${sessions.length === 1 ? '' : 's'} covering ${fmt(totalDistance, 1)} km.`], ['◒', 'Efficiency', `Average assisted motor power: ${fmt(averagePower, 0)} W.`], ['♨', 'Ride profile', `Moving average ${fmt(movingAverage, 1)} km/h · thermal peak ${fmt(maximumTemperature, 0)}°C.`]].map(item => `<div class="insight"><div class="insight-icon">${item[0]}</div><strong>${item[1]}</strong><p>${item[2]}</p></div>`).join('');
  $('#dashboard').classList.remove('hidden'); $('#emptyState').classList.add('hidden'); $('#dropzone').classList.add('hidden');
}

function updateFilterVisibility() {
  const mode = $('#filterMode').value;
  $('#dateFields').classList.toggle('hidden', mode !== 'range');
  $('#sessionFields').classList.toggle('hidden', mode !== 'session');
  $('#applyFilter').classList.toggle('hidden', mode !== 'range');
}

function applyFilter() {
  const mode = $('#filterMode').value;
  let selected = telemetrySessions;
  if (mode === 'session') selected = telemetrySessions.filter(session => session.id === $('#sessionSelect').value);
  if (mode === 'range') {
    const from = $('#dateFrom').value || '0000-01-01', to = $('#dateTo').value || '9999-12-31';
    selected = telemetrySessions.filter(session => session.date >= from && session.date <= to);
  }
  if (!selected.length) { showError(new Error('No telemetry sessions match the selected filter.')); return; }
  $('#error').classList.add('hidden');
  renderDashboard(selected);
}

function configureFilters() {
  const dates = telemetrySessions.map(session => session.date).sort();
  $('#dateFrom').min = dates[0]; $('#dateFrom').max = dates[dates.length - 1]; $('#dateFrom').value = dates[0];
  $('#dateTo').min = dates[0]; $('#dateTo').max = dates[dates.length - 1]; $('#dateTo').value = dates[dates.length - 1];
  $('#sessionSelect').replaceChildren(...telemetrySessions.map(session => new Option(session.label, session.id)));
  $('#filters').classList.remove('hidden');
  $('#fileCount').textContent = `· ${telemetrySessions.length} files`;
  updateFilterVisibility();
}

function showError(error) {
  console.error(error); const element = $('#error'); element.textContent = error && error.message ? error.message : String(error); element.classList.remove('hidden');
}

async function loadFolder(folder) {
  const button = $('#chooseBtn');
  try {
    $('#error').classList.add('hidden'); button.disabled = true; button.innerHTML = '<span>◌</span> Loading…';
    if (window.updatePhoneSyncDestination) window.updatePhoneSyncDestination(folder);
    const result = await window.telemetryAPI.readFolder(folder);
    $('#sourceText').title = folder;
    telemetrySessions = result.files.map(buildSession).filter(Boolean).sort((a, b) => a.first.Timestamp_UnixMs - b.first.Timestamp_UnixMs);
    if (!telemetrySessions.length) {
      $('#dashboard').classList.add('hidden'); $('#filters').classList.add('hidden');
      $('#emptyState').classList.remove('hidden'); $('#fileCount').textContent = '';
      overviewSubtitle = 'Folder ready. Sync your phone to add completed sessions.';
      if (currentPage === 'overview') $('#sourceText').textContent = overviewSubtitle;
      return;
    }
    configureFilters(); renderDashboard(telemetrySessions);
  } catch (error) { showError(error); }
  finally {
    button.disabled = false;
    if (window.updateFolderCard) window.updateFolderCard(folder);
    else button.innerHTML = folder ? '<span class="btn-icon">⇄</span> Change folder' : '<span>＋</span> Choose folder';
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

window.addEventListener('DOMContentLoaded', () => {
  window.setupPhoneSync(loadFolder);
  $('#chooseBtn').addEventListener('click', chooseFolder);
  $('#overviewNav').addEventListener('click', () => showPage('overview'));
  $('#importNav').addEventListener('click', () => showPage('import'));
  $('#filterMode').addEventListener('change', () => { updateFilterVisibility(); if ($('#filterMode').value !== 'range') applyFilter(); });
  $('#applyFilter').addEventListener('click', applyFilter); $('#sessionSelect').addEventListener('change', () => { if ($('#filterMode').value === 'session') applyFilter(); });
  const donationModal = $('#donationModal');
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
  loadSavedFolder();
});
