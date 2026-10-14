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
    if (label) label.textContent = expanded ? i18n.t("HIDE_DETAILS") : i18n.t("DETAILS");
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

    if (pathEl) pathEl.textContent = isConfigured ? folder : i18n.t("NO_FOLDER_SELECTED_YET");
    if (pathWrap) pathWrap.title = isConfigured ? folder : i18n.t("NO_FOLDER_SELECTED_YET");
    if (fullPathEl) fullPathEl.textContent = isConfigured ? folder : i18n.t("NO_FOLDER_SELECTED_YET");
    if (statusTag) {
      statusTag.textContent = isConfigured ? i18n.t("READY") : i18n.t("NOT_CONFIGURED");
      statusTag.className = isConfigured ? 'folder-status-tag tag-ready' : 'folder-status-tag tag-missing';
    }
    if (statusMeta) {
      statusMeta.textContent = isConfigured ? i18n.t("ACTIVE_STORAGE_FOLDER") : i18n.t("NO_FOLDER_SELECTED");
    }
    if (chooseBtn && !chooseBtn.disabled) {
      chooseBtn.innerHTML = isConfigured
        ? '<span class="btn-icon">⇄</span> ' + i18n.html("CHANGE_FOLDER")
        : '<span>＋</span> ' + i18n.html("CHOOSE_FOLDER");
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
  section.innerHTML = `<div class="sync-heading"><div><span class="kicker" data-i18n="USB_IMPORT">USB IMPORT</span><h2 id="syncHeading" data-i18n="SYNC_FROM_PHONE">Sync from your phone</h2></div></div>
    <p class="sync-hint">${i18n.html("PHONE_SYNC_SETUP_INSTRUCTION", {
      transferMode: i18n.t("PHONE_FILE_TRANSFER_MODE"), dcim: 'DCIM', pictures: 'Pictures'
    }, { transferMode: text => `<b>${text}</b>`, dcim: text => `<b>${text}</b>`, pictures: text => `<b>${text}</b>` })}</p>
    <p id="syncLockedNote" class="sync-locked-note" data-i18n="CHOOSE_FOLDER_TO_ENABLE_SYNC">Choose a CSV folder above to enable phone sync.</p>
    <fieldset id="syncControls" class="sync-controls-fieldset" disabled>
      <div class="sync-controls"><label><span data-i18n="PHONE">PHONE</span><select id="syncPhone"><option value="" data-i18n="FIND_CONNECTED_PHONE">Find a connected phone</option></select></label><button id="syncRefresh" type="button" data-i18n="FIND_PHONE">Find phone</button><button class="primary" id="syncStart" type="button" data-i18n="SYNC_CSV_FILES">Sync CSV files</button><button id="syncCancel" class="hidden" type="button" data-i18n="CANCEL">Cancel</button></div>
      <label class="sync-auto"><input id="syncAuto" type="checkbox"> <span data-i18n="SYNC_PHONE_WHEN_CONNECTED">Sync this phone when connected</span></label>
    </fieldset>
    <div id="syncStatus" role="status" aria-live="polite" data-i18n="CHOOSE_FOLDER_TO_ENABLE_SYNC">Choose a CSV folder above to enable phone sync.</div>
    <progress id="syncProgress" class="hidden" max="100" aria-label="USB copy progress" data-i18n-aria-label="USB_COPY_PROGRESS"></progress>
    <p id="syncBytes" class="sync-hint"></p><ul id="syncDetails" class="sync-details"></ul>`;
  i18n.apply(section);
  document.querySelector('#phoneSyncMount').append(section);
  const el = id => section.querySelector('#' + id);
  let busy = false; let checking = false; let previous = new Set(); let supported = true; let destinationReady = false;
  const formatBytes = bytes => bytes >= 1024 ** 2 ? `${i18n.number(bytes / 1024 ** 2, 1)} MB` : `${i18n.number(bytes / 1024, 1)} KB`;
  const setBusy = value => {
    busy = value;
    el('syncControls').disabled = value || !supported || !destinationReady;
    document.querySelector('#chooseBtn').disabled = value;
    el('syncCancel').classList.toggle('hidden', !value);
    el('syncProgress').classList.toggle('hidden', !value);
  };
  const showResult = result => {
    const incomplete = result.errors.length || result.conflicts.length || result.pending;
    el('syncStatus').textContent = i18n.t('SYNC_RESULT_SUMMARY', {
      status: result.cancelled ? i18n.t('CANCELLED') : incomplete ? i18n.t('SYNC_NEEDS_ATTENTION') : i18n.t('SYNC_COMPLETE'),
      added: i18n.number(result.added, 0), present: i18n.number(result.present, 0), pending: i18n.number(result.pending, 0)
    });
    el('syncDetails').replaceChildren(...[...result.conflicts, ...result.errors].map(message => {
      const item = document.createElement('li'); item.textContent = i18n.message(message); return item;
    }));
    if (result.retainedBytes) el('syncBytes').textContent = i18n.t('SYNC_RETAINED_BYTES_NOTICE', { size: formatBytes(result.retainedBytes) });
    else el('syncBytes').textContent = i18n.t("SYNC_FILES_READY_NOTICE");
  };
  const start = async () => {
    if (busy || !supported) return;
    try {
      const config = await api.syncConfig();
      if (!config.telemetryFolder) { setDestination(null, false); return; }
      if (!el('syncPhone').value) await refresh(false);
      if (!el('syncPhone').value) { el('syncStatus').textContent = i18n.t("SELECT_CONNECTED_PHONE_INSTRUCTION"); return; }
      setBusy(true); el('syncDetails').replaceChildren(); el('syncBytes').textContent = '';
      el('syncProgress').removeAttribute('value');
      const result = await api.syncPhone(el('syncPhone').value);
      showResult(result);
      // syncPhone resolves only after the backend releases its single-job lock.
      await loadFolder(config.telemetryFolder);
    } catch (error) { el('syncStatus').textContent = i18n.message(error); }
    finally { setBusy(false); }
  };
  const refresh = async automatic => {
    if (busy || checking || !supported || !destinationReady) return;
    checking = true;
    try {
      const config = await api.syncConfig();
      const devices = await api.listPhones();
      const selected = el('syncPhone').value || config.syncDeviceId;
      el('syncPhone').replaceChildren(new Option(devices.length ? i18n.t("SELECT_PHONE") : i18n.t("NO_PHONE_DETECTED"), ''),
        ...devices.map(device => new Option(device.name, device.id)));
      if (devices.some(device => device.id === selected)) el('syncPhone').value = selected;
      else if (devices.length === 1) el('syncPhone').value = devices[0].id;
      if (!automatic) el('syncStatus').textContent = devices.length ? i18n.t("PHONE_DETECTED_INSTRUCTION") : i18n.t("NO_PHONE_DETECTED_INSTRUCTION");
      const newlyConnected = devices.some(device => device.id === config.syncDeviceId && !previous.has(device.id));
      previous = new Set(devices.map(device => device.id));
      if (automatic && config.autoSync && config.telemetryFolder && newlyConnected) {
        el('syncPhone').value = config.syncDeviceId;
        await start();
      }
    } catch (error) { if (!automatic) el('syncStatus').textContent = i18n.message(error); }
    finally { checking = false; }
  };
  const setDestination = (folder, shouldRefresh = true) => {
    destinationReady = typeof folder === 'string' && folder.length > 0;
    if (window.updateFolderCard) window.updateFolderCard(folder);
    else { const p = document.querySelector('#folderPath'); if (p) p.textContent = folder || i18n.t("NO_FOLDER_SELECTED_YET"); }
    el('syncControls').disabled = busy || !supported || !destinationReady;
    el('syncLockedNote').classList.toggle('hidden', destinationReady);
    el('syncLockedNote').textContent = supported ? i18n.t("CHOOSE_FOLDER_TO_ENABLE_SYNC") : i18n.t("PHONE_SYNC_WINDOWS_ONLY");
    section.classList.toggle('sync-disabled', !destinationReady || !supported);
    section.setAttribute('aria-disabled', String(!destinationReady || !supported));
    if (!supported) el('syncStatus').textContent = i18n.t("DIRECT_USB_SYNC_WINDOWS_ONLY");
    else if (!destinationReady) el('syncStatus').textContent = i18n.t("CHOOSE_FOLDER_TO_ENABLE_SYNC");
    else if (shouldRefresh) refresh(false);
  };
  window.updatePhoneSyncDestination = folder => setDestination(folder);
  api.onSyncProgress(event => {
    if (event.phase === 'done') return;
    el('syncStatus').textContent = i18n.message(event.message);
    if (event.totalBytes > 0) {
      el('syncProgress').value = event.bytes / event.totalBytes * 100;
      el('syncBytes').textContent = `${formatBytes(event.bytes)} / ${formatBytes(event.totalBytes)} • ${Math.floor(el('syncProgress').value)}%`;
    } else el('syncProgress').removeAttribute('value');
  });
  el('syncStart').addEventListener('click', start);
  el('syncRefresh').addEventListener('click', () => refresh(false));
  el('syncCancel').addEventListener('click', async () => { await api.cancelSync(); el('syncStatus').textContent = i18n.t("SYNC_CANCELLING_NOTICE"); });
  el('syncAuto').addEventListener('change', async () => { try { await api.setAutoSync(el('syncAuto').checked); } catch (error) { el('syncStatus').textContent = i18n.message(error); } });
  try {
    const config = await api.syncConfig(); supported = config.supported;
    el('syncAuto').checked = !!config.autoSync;
    setDestination(config.telemetryFolder, false);
    if (supported && destinationReady) await refresh(!!config.autoSync);
    if (supported) setInterval(async () => { if (destinationReady && el('syncAuto').checked) await refresh(true); }, 8000);
  } catch (error) { el('syncStatus').textContent = i18n.message(error); }
};
