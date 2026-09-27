function initFolderAccordion() {
  const card = document.querySelector('#folderCard');
  const bar = document.querySelector('#folderBar');
  const toggleBtn = document.querySelector('#folderToggleBtn');
  const chooseBtn = document.querySelector('#chooseBtn');
  if (!card || !bar) return;

  const setExpanded = expanded => {
    card.dataset.expanded = String(expanded);
    bar.setAttribute('aria-expanded', String(expanded));
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(expanded));
    const drawer = document.querySelector('#folderDetails');
    if (drawer) drawer.setAttribute('aria-hidden', String(!expanded));
    const label = document.querySelector('#folderToggleLabel');
    if (label) label.textContent = expanded ? 'Hide details' : 'Details';
  };

  const toggle = () => {
    const isExpanded = card.dataset.expanded === 'true';
    const next = !isExpanded;
    setExpanded(next);
    try { localStorage.setItem('apex_csv_folder_expanded', String(next)); } catch (_) {}
  };

  window.setFolderAccordionExpanded = setExpanded;
  window.updateFolderCard = folder => {
    const isConfigured = typeof folder === 'string' && folder.trim().length > 0;
    card.dataset.configured = String(isConfigured);
    const pathEl = document.querySelector('#folderPath');
    const pathWrap = document.querySelector('#folderPathWrap');
    const fullPathEl = document.querySelector('#folderMetaPath');
    const statusTag = document.querySelector('#folderStatusTag');
    const statusMeta = document.querySelector('#folderMetaStatus');

    if (pathEl) pathEl.textContent = isConfigured ? folder : 'No folder selected yet';
    if (pathWrap) pathWrap.title = isConfigured ? folder : 'No folder selected yet';
    if (fullPathEl) fullPathEl.textContent = isConfigured ? folder : 'No folder selected yet';
    if (statusTag) {
      statusTag.textContent = isConfigured ? 'Ready' : 'Not configured';
      statusTag.className = isConfigured ? 'folder-status-tag tag-ready' : 'folder-status-tag tag-missing';
    }
    if (statusMeta) {
      statusMeta.textContent = isConfigured ? 'Active storage folder' : 'No folder selected';
    }
    if (chooseBtn && !chooseBtn.disabled) {
      chooseBtn.innerHTML = isConfigured
        ? '<span class="btn-icon">⇄</span> Change folder'
        : '<span>＋</span> Choose folder';
      chooseBtn.classList.toggle('primary', !isConfigured);
      chooseBtn.classList.toggle('secondary', isConfigured);
    }

    let userPref = null;
    try { userPref = localStorage.getItem('apex_csv_folder_expanded'); } catch (_) {}
    if (userPref === null) {
      setExpanded(!isConfigured);
    } else {
      setExpanded(userPref === 'true');
    }
  };

  bar.addEventListener('click', event => {
    if (event.target.closest('#chooseBtn')) return;
    toggle();
  });

  bar.addEventListener('keydown', event => {
    if (event.target.closest('#chooseBtn')) return;
    if (event.target === bar && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      toggle();
    }
  });

  if (chooseBtn) {
    chooseBtn.addEventListener('click', event => {
      event.stopPropagation();
    });
  }
}

window.setupPhoneSync = async function (loadFolder) {
  initFolderAccordion();
  const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = 'sync.css'; document.head.append(stylesheet);
  const api = window.telemetryAPI;
  const section = document.createElement('section');
  section.className = 'phone-sync';
  section.setAttribute('aria-labelledby', 'syncHeading');
  section.innerHTML = `<div class="sync-heading"><div><span class="kicker">USB IMPORT</span><h2 id="syncHeading">Sync from your phone</h2></div></div>
    <p class="sync-hint">Connect and unlock your phone, then select <b>File transfer / Android Auto</b>. Completed sessions are added to the CSV folder selected above. If Windows shows only <b>DCIM</b> and <b>Pictures</b>, the phone is in Photo transfer (PTP) mode and telemetry files cannot be exposed.</p>
    <p id="syncLockedNote" class="sync-locked-note">Choose a CSV folder above to enable phone sync.</p>
    <fieldset id="syncControls" class="sync-controls-fieldset" disabled>
      <div class="sync-controls"><label>PHONE<select id="syncPhone"><option value="">Find a connected phone</option></select></label><button id="syncRefresh" type="button">Find phone</button><button class="primary" id="syncStart" type="button">Sync CSV files</button><button id="syncCancel" class="hidden" type="button">Cancel</button></div>
      <label class="sync-auto"><input id="syncAuto" type="checkbox"> Sync this phone when connected</label>
    </fieldset>
    <div id="syncStatus" role="status" aria-live="polite">Choose a CSV folder above to enable phone sync.</div>
    <progress id="syncProgress" class="hidden" max="100" aria-label="USB copy progress"></progress>
    <p id="syncBytes" class="sync-hint"></p><ul id="syncDetails" class="sync-details"></ul>`;
  document.querySelector('#phoneSyncMount').append(section);
  const el = id => section.querySelector('#' + id);
  let busy = false; let checking = false; let previous = new Set(); let supported = true; let destinationReady = false;
  const formatBytes = bytes => bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
  const setBusy = value => {
    busy = value;
    el('syncControls').disabled = value || !supported || !destinationReady;
    document.querySelector('#chooseBtn').disabled = value;
    el('syncCancel').classList.toggle('hidden', !value);
    el('syncProgress').classList.toggle('hidden', !value);
  };
  const showResult = result => {
    const incomplete = result.errors.length || result.conflicts.length || result.pending;
    el('syncStatus').textContent = `${result.cancelled ? 'Cancelled' : incomplete ? 'Sync finished with items needing attention' : 'Sync complete'} — ${result.added} added, ${result.present} already present, ${result.pending} pending.`;
    el('syncDetails').replaceChildren(...[...result.conflicts, ...result.errors].map(message => {
      const item = document.createElement('li'); item.textContent = message; return item;
    }));
    if (result.retainedBytes) el('syncBytes').textContent = `${formatBytes(result.retainedBytes)} retained for recovery. No files were deleted.`;
    else el('syncBytes').textContent = 'Completed files are ready for analysis. No files were deleted.';
  };
  const start = async () => {
    if (busy || !supported) return;
    try {
      const config = await api.syncConfig();
      if (!config.telemetryFolder) { setDestination(null, false); return; }
      if (!el('syncPhone').value) await refresh(false);
      if (!el('syncPhone').value) { el('syncStatus').textContent = 'Select a connected phone. Unlock it and choose File transfer if it is not listed.'; return; }
      setBusy(true); el('syncDetails').replaceChildren(); el('syncBytes').textContent = '';
      el('syncProgress').removeAttribute('value');
      const result = await api.syncPhone(el('syncPhone').value);
      showResult(result);
      // syncPhone resolves only after the backend releases its single-job lock.
      await loadFolder(config.telemetryFolder);
    } catch (error) { el('syncStatus').textContent = error.message; }
    finally { setBusy(false); }
  };
  const refresh = async automatic => {
    if (busy || checking || !supported || !destinationReady) return;
    checking = true;
    try {
      const config = await api.syncConfig();
      const devices = await api.listPhones();
      const selected = el('syncPhone').value || config.syncDeviceId;
      el('syncPhone').replaceChildren(new Option(devices.length ? 'Select a phone' : 'No phone detected', ''),
        ...devices.map(device => new Option(device.name, device.id)));
      if (devices.some(device => device.id === selected)) el('syncPhone').value = selected;
      else if (devices.length === 1) el('syncPhone').value = devices[0].id;
      if (!automatic) el('syncStatus').textContent = devices.length ? 'Phone detected. Start sync to check storage and import completed sessions.' : 'No phone detected. Connect a data-capable USB cable, unlock the phone and select File transfer.';
      const newlyConnected = devices.some(device => device.id === config.syncDeviceId && !previous.has(device.id));
      previous = new Set(devices.map(device => device.id));
      if (automatic && config.autoSync && config.telemetryFolder && newlyConnected) {
        el('syncPhone').value = config.syncDeviceId;
        await start();
      }
    } catch (error) { if (!automatic) el('syncStatus').textContent = error.message; }
    finally { checking = false; }
  };
  const setDestination = (folder, shouldRefresh = true) => {
    destinationReady = typeof folder === 'string' && folder.length > 0;
    if (window.updateFolderCard) window.updateFolderCard(folder);
    else { const p = document.querySelector('#folderPath'); if (p) p.textContent = folder || 'No folder selected yet'; }
    el('syncControls').disabled = busy || !supported || !destinationReady;
    el('syncLockedNote').classList.toggle('hidden', destinationReady);
    el('syncLockedNote').textContent = supported ? 'Choose a CSV folder above to enable phone sync.' : 'Phone sync is available on Windows.';
    section.classList.toggle('sync-disabled', !destinationReady || !supported);
    section.setAttribute('aria-disabled', String(!destinationReady || !supported));
    if (!supported) el('syncStatus').textContent = 'Direct USB sync is available on Windows.';
    else if (!destinationReady) el('syncStatus').textContent = 'Choose a CSV folder above to enable phone sync.';
    else if (shouldRefresh) refresh(false);
  };
  window.updatePhoneSyncDestination = folder => setDestination(folder);
  api.onSyncProgress(event => {
    if (event.phase === 'done') return;
    el('syncStatus').textContent = event.message;
    if (event.totalBytes > 0) {
      el('syncProgress').value = event.bytes / event.totalBytes * 100;
      el('syncBytes').textContent = `${formatBytes(event.bytes)} / ${formatBytes(event.totalBytes)} • ${Math.floor(el('syncProgress').value)}%`;
    } else el('syncProgress').removeAttribute('value');
  });
  el('syncStart').addEventListener('click', start);
  el('syncRefresh').addEventListener('click', () => refresh(false));
  el('syncCancel').addEventListener('click', async () => { await api.cancelSync(); el('syncStatus').textContent = 'Cancelling… Completed copies will be preserved.'; });
  el('syncAuto').addEventListener('change', async () => { try { await api.setAutoSync(el('syncAuto').checked); } catch (error) { el('syncStatus').textContent = error.message; } });
  try {
    const config = await api.syncConfig(); supported = config.supported;
    el('syncAuto').checked = !!config.autoSync;
    setDestination(config.telemetryFolder, false);
    if (supported && destinationReady) await refresh(!!config.autoSync);
    if (supported) setInterval(async () => { if (destinationReady && el('syncAuto').checked) await refresh(true); }, 8000);
  } catch (error) { el('syncStatus').textContent = error.message; }
};
