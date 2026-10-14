// Shared by Electron and the renderer. Stable UPPER_SNAKE_CASE labels identify messages.
(function (root) {
  const batches = Object.freeze({
    europe: Object.freeze(['en', 'it', 'de', 'fr', 'es', 'pt']),
    east: Object.freeze(['zh-Hans', 'zh-Hant', 'ja', 'ko']),
    south: Object.freeze(['hi', 'bn', 'ta', 'te', 'mr', 'gu', 'pa', 'ur']),
    west: Object.freeze(['ar', 'fa', 'ru', 'tr']),
    southeast: Object.freeze(['id', 'ms', 'vi', 'th', 'fil']),
    africa: Object.freeze(['sw', 'ha', 'am'])
  });
  const supported = Object.freeze(Object.values(batches).flat());
  const rtl = Object.freeze(['ar', 'fa', 'ur']);
  function resolveLocale(value) {
    if (typeof value !== 'string') return 'en';
    try {
      const locale = new Intl.Locale(value.trim().replace(/_/g, '-'));
      const language = locale.language;
      const script = locale.maximize().script;
      if (language === 'zh') return ['Hans', 'Hant'].includes(script) ? 'zh-' + script : 'en';
      // A Punjabi dictionary in Gurmukhi must not replace Shahmukhi, for example.
      if (!supported.includes(language) || script !== new Intl.Locale(language).maximize().script) return 'en';
      return language;
    } catch (_) { return 'en'; }
  }
  const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  function create(locale, dictionary = {}, english = {}) {
    const language = resolveLocale(locale);
    const direction = rtl.includes(language) ? 'rtl' : 'ltr';
    let formatLocale = language === 'en' ? 'en-GB' : String(locale).replace(/_/g, '-');
    try { new Intl.NumberFormat(formatLocale); } catch (_) { formatLocale = language; }
    const number = (value, digits = 1) => Number.isFinite(value)
      ? value.toLocaleString(language === 'en' ? 'en-US' : formatLocale, { maximumFractionDigits: digits }) : '—';
    const lookup = (key, values) => {
      const choose = (value, pluralLocale) => value && typeof value === 'object'
        ? value[new Intl.PluralRules(pluralLocale).select(Number(values.count))] || value.other : value;
      const value = Object.hasOwn(dictionary, key) ? choose(dictionary[key], formatLocale) : null;
      return typeof value === 'string' && value.trim() ? value : (Object.hasOwn(english, key) ? choose(english[key], 'en') : null) || key;
    };
    const interpolate = (key, values, escape) => lookup(key, values).replace(/\{(\w+)\}/g,
      (token, name) => Object.hasOwn(values, name) ? escape(values[name]) : token);
    // Isolate inserted paths, quantities and nested messages from surrounding RTL text.
    const isolate = value => {
      const text = typeof value === 'number' ? number(value) : String(value);
      return direction === 'rtl' ? '\u2068' + text + '\u2069' : text;
    };
    const t = (key, values = {}) => interpolate(key, values, isolate);
    // Dictionaries are plain text. Templates may decorate named slots with markup.
    // Escape the complete message and each value before any template sees it.
    const html = (key, values = {}, templates = {}) => escapeHTML(lookup(key, values)).replace(/\{(\w+)\}/g,
      (token, name) => {
        if (!Object.hasOwn(values, name)) return token;
        const text = escapeHTML(isolate(values[name]));
        return Object.hasOwn(templates, name) && typeof templates[name] === 'function' ? templates[name](text) : text;
      });
    // Backend/native diagnostics keep their English contract. Translate known messages
    // at the presentation boundary; unknown OS diagnostics and filenames stay verbatim.
    // Recognize the original English diagnostic text from values, independently of IDs.
    // Formatting fragments are inserted by templates, never emitted as backend diagnostics.
    const templateFragments = new Set(['BATTERY_INCLUDED_SESSIONS', 'BATTERY_CHARGE_INCREASE_EXCLUSION',
      'BATTERY_INVALID_READINGS_EXCLUSION', 'BATTERY_CHARGE_VALUE', 'BATTERY_RANGE_VALUE', 'PHONE_FILE_TRANSFER_MODE']);
    const sources = Object.entries(english).filter(([key]) => !templateFragments.has(key)).map(([key, entry]) =>
      ({ key, source: typeof entry === 'string' ? entry : entry?.other }))
      .filter(({ source }) => typeof source === 'string');
    const exactMessages = new Map(sources.filter(({ source }) => !/\{\w+\}/.test(source))
      .map(({ key, source }) => [source, key]));
    const patterns = sources.filter(({ source }) => /\{\w+\}/.test(source)).map(({ key, source }) => {
      const names = [];
      const pattern = source.split(/(\{\w+\})/).map(part => {
        if (/^\{\w+\}$/.test(part)) { names.push(part.slice(1, -1)); return '(.+?)'; }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('');
      return { key, names, expression: new RegExp('^' + pattern + '$') };
    });
    function message(value) {
      const source = String(value?.message ?? value).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
      if (exactMessages.has(source)) return t(exactMessages.get(source));
      for (const { key, names, expression } of patterns) {
        const match = source.match(expression);
        if (match) return t(key, Object.fromEntries(names.map((name, index) => [name, match[index + 1]])));
      }
      const prefix = source.match(/^([^\r\n]+?\.(?:csv|ready\.json)): (.+)$/);
      return prefix ? isolate(prefix[1]) + ': ' + message(prefix[2]) : source;
    }
    function apply(container) {
      const document = container.ownerDocument || container;
      document.documentElement.lang = language;
      document.documentElement.dir = direction;
      container.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = t(element.dataset.i18n); });
      for (const attribute of ['aria-label', 'title']) {
        container.querySelectorAll('[data-i18n-' + attribute + ']').forEach(element => {
          element.setAttribute(attribute, t(element.getAttribute('data-i18n-' + attribute)));
        });
      }
    }
    return { language, direction, locale: formatLocale, dictionary, english, t, html, message, apply,
      number,
      date: (value, options) => new Date(value).toLocaleString(formatLocale, options) };
  }
  const api = { supported, batches, rtl, resolveLocale, create, escapeHTML };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ApexI18n = api;
})(globalThis);
