const { create, resolveLocale } = require('../src/i18n');
const english = require('../src/locales/en.json');

function systemLocalization(app) {
  // Chromium's application locale may be English even on a translated OS.
  let locale = 'en';
  try { locale = app.getPreferredSystemLanguages()[0] || 'en'; } catch (_) {}
  const language = resolveLocale(locale);
  if (language === 'en' && !/^en(?:[-_]|$)/i.test(locale)) locale = 'en';
  return { locale, dictionary: require(`../src/locales/${language}.json`), english };
}

module.exports = { systemLocalization, create };
