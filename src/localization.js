// Start the workspace only after the OS language and bundled dictionary are ready.
window.i18n = ApexI18n.create('en');
window.localizationReady = (async () => {
  let config;
  try { config = await window.telemetryAPI.localization(); }
  catch (error) {
    console.warn('Cannot load system language; using bundled English:', error);
    // Symbolic IDs contain no display text. Keep the existing English fallback on IPC failure.
    const english = await (await fetch('locales/en.json')).json();
    config = { locale: 'en', dictionary: english, english };
  }
  window.i18n = ApexI18n.create(config.locale, config.dictionary, config.english);
  i18n.apply(document);
  document.querySelector('#importInstruction').innerHTML = i18n.html('OPEN_IMPORT_DATA_INSTRUCTION',
    { importData: i18n.t('IMPORT_DATA') }, { importData: text => `<b>${text}</b>` });
})();
