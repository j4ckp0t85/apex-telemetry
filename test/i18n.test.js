const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { supported, resolveLocale, create } = require('../src/i18n');
const { systemLocalization } = require('../lib/localization');
const english = require('../src/locales/en.json');
const tokens = text => (text.match(/\{\w+\}/g) || []).sort();

for (const locale of supported) {
  test(`${locale}: dictionary is complete, plain text and preserves placeholders and technical units`, () => {
    const dictionary = require(`../src/locales/${locale}.json`);
    assert.deepEqual(Object.keys(dictionary).sort(), Object.keys(english).sort());
    for (const [first, second] of [['ZOOM_IN', 'ZOOM_OUT'], ['LIGHT_THEME', 'DARK_THEME'], ['FULL_SCREEN', 'EXIT_FULL_SCREEN'], ['MOTOR_POWER', 'RIDER_POWER']]) {
      assert.notEqual(dictionary[first], dictionary[second], `${locale}: distinct controls need distinct meanings`);
    }
    const importInstruction = dictionary.OPEN_IMPORT_DATA_INSTRUCTION;
    assert.ok(importInstruction.includes('{importData}'), `${locale}: import instruction uses the translated navigation slot`);
    for (const [key, entry] of Object.entries(dictionary)) {
      assert.match(key, /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/, `${locale}: invalid message label`);
      const base = typeof english[key] === 'string' ? english[key] : english[key].other;
      const values = typeof entry === 'string' ? [entry] : Object.values(entry);
      if (typeof entry !== 'string') {
        assert.ok(Object.hasOwn(entry, 'other'), `${locale}: ${key} needs a plural fallback`);
        assert.ok(Object.keys(entry).every(category => ['zero', 'one', 'two', 'few', 'many', 'other'].includes(category)), key);
      }
      for (const value of values) {
        assert.ok(typeof value === 'string' && value.trim(), key);
        assert.deepEqual(tokens(value), tokens(base), `${locale}: ${key}`);
        assert.ok(!/[<>]|&(?:#\d+|#x[\da-f]+|[a-z]+);/i.test(value), `${locale}: HTML markup or entity in ${key}`);
        assert.ok(!/\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\uFE0F\u20E3]/u.test(value), `${locale}: emoji or decorative icon in ${key}`);
        assert.ok(!/ZXQ|QXZ|<>|\[[\p{Nd}]{3}\]/u.test(value), `${locale}: drafting artifact in ${key}`);
        for (const unit of ['pp', 'km/h', 'km', '°C', 'W', 'KiB', '64', '100', 'NTFS', 'DCIM', 'Pictures', 'Android Auto', 'Download/ApexDrive/Telemetry']) {
          const expression = new RegExp('(?<![\\p{L}\\p{N}])' + unit + '(?![\\p{L}\\p{N}])', 'u');
          if (expression.test(base)) assert.ok(expression.test(value), `${locale}: lost ${unit} in ${key}`);
        }
        for (const identifier of ['GPS', 'CSV', 'USB', 'PTP', 'IP', 'ApexDrive', 'OpenStreetMap', 'Ko-fi', 'PayPal']) {
          if (base.includes(identifier)) assert.ok(value.includes(identifier), `${locale}: lost ${identifier} in ${key}`);
        }
      }
    }
  });
}

test('language follows the primary OS language and falls back to English', () => {
  for (const [value, expected] of [['it-IT', 'it'], ['DE-at', 'de'], ['fr_CA', 'fr'], ['es-419', 'es'], ['pt-BR', 'pt'], ['en-AU', 'en'], ['ja-JP', 'ja'], ['tl-PH', 'fil'], ['zh-CN', 'zh-Hans'], ['zh-SG', 'zh-Hans'], ['zh-TW', 'zh-Hant'], ['zh-HK', 'zh-Hant'], ['zh-MO', 'zh-Hant'], ['zh-Hant-CN', 'zh-Hant'], ['zh-Hans-TW', 'zh-Hans'], ['pa-Guru-IN', 'pa'], ['pa-Arab-PK', 'en'], ['pa-PK', 'en'], ['hi-Latn', 'en'], ['zh-Latn', 'en'], ['eo', 'en'], ['', 'en'], [null, 'en']]) assert.equal(resolveLocale(value), expected);
  assert.equal(systemLocalization({ getPreferredSystemLanguages: () => ['it-IT'], getLocale: () => 'en-US' }).locale, 'it-IT');
  assert.equal(systemLocalization({ getPreferredSystemLanguages: () => ['eo', 'it-IT'] }).locale, 'en');
  assert.equal(systemLocalization({ getPreferredSystemLanguages: () => [] }).locale, 'en');
  assert.equal(systemLocalization({ getPreferredSystemLanguages: () => { throw new Error('Unavailable'); } }).locale, 'en');
});

test('plural categories and RTL interpolation follow the selected language', () => {
  const categories = Object.fromEntries(['zero', 'one', 'two', 'few', 'many', 'other'].map(category => [category, category + ': {count}']));
  const ar = create('ar', { COUNTER: categories }, { PATH_MESSAGE: 'Path: {path}' });
  for (const [count, category] of [[0, 'zero'], [1, 'one'], [2, 'two'], [3, 'few'], [11, 'many'], [100, 'other']]) {
    assert.equal(ar.t('COUNTER', { count }), `${category}: \u2068${ar.number(count, 0)}\u2069`);
  }
  assert.equal(ar.direction, 'rtl');
  assert.equal(create('ur-PK').direction, 'rtl');
  assert.equal(create('ja').direction, 'ltr');
  assert.equal(create('fr_CA').locale, 'fr-CA');
  assert.equal(ar.html('PATH_MESSAGE', { path: '<file>' }), 'Path: \u2068&lt;file&gt;\u2069');
  assert.equal(create('ru', { COUNTER: categories }).t('COUNTER', { count: 21 }), 'one: 21');
  assert.equal(create('ru', { COUNTER: categories }).t('COUNTER', { count: 22 }), 'few: 22');
  assert.equal(create('ru', { COUNTER: categories }).t('COUNTER', { count: 25 }), 'many: 25');
});

test('missing and empty entries fall back to English, and HTML interpolation escapes data', () => {
  const instance = create('it', { SPEED: '', DISTANCE: null }, english);
  assert.equal(instance.t('SPEED'), 'Speed');
  assert.equal(instance.t('DISTANCE'), 'Distance');
  assert.equal(instance.t('UNKNOWN_FUTURE_LABEL'), 'UNKNOWN_FUTURE_LABEL');
  assert.equal(instance.t('constructor'), 'constructor');
  assert.equal(instance.html('SAMPLE_INDEX', { index: '<img onerror="alert(1)">' }), 'Sample &lt;img onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(instance.t('SAMPLE_INDEX', { index: 3 }), 'Sample 3');
  assert.equal(create('ru', {}, english).t('SESSION_COUNT', { count: 21 }), '21 sessions');
});

test('local grammar, formatting and missing-data presentation work independently of host locale', () => {
  const it = create('it-IT', require('../src/locales/it.json'), english);
  assert.equal(it.t('SESSION_COUNT', { count: 1 }), '1 sessione');
  assert.equal(it.t('SESSION_COUNT', { count: 2 }), '2 sessioni');
  assert.equal(it.t('FILE_COUNT', { count: 1 }), '· 1 file');
  assert.equal(it.t('BATTERY_EXCLUDED_INVALID_READINGS', { count: 1,
    exclusion: it.t('BATTERY_INVALID_READINGS_EXCLUSION', { count: 1 }) }), '1 esclusa: letture della batteria mancanti, non valide o insufficienti.');
  assert.equal(it.t('BATTERY_INVALID_READINGS_EXCLUSION', { count: 2 }), '2 escluse:');
  assert.equal(it.number(12.5), '12,5');
  assert.equal(it.number(null), '—');
  assert.equal(it.number(NaN), '—');
  assert.equal(create('en', english, english).number(12.5), '12.5');
  assert.equal(it.t('SESSION_COUNT', { count: 1000 }), it.number(1000, 0) + ' sessioni');
  assert.equal(create('bn', {}, english).t('SAMPLE_INDEX', { index: 3 }), 'Sample ৩');
});

test('known backend/native diagnostics translate while paths and unknown diagnostics stay intact', () => {
  const it = create('it', require('../src/locales/it.json'), english);
  assert.equal(it.message('Checking session 2 of 5…'), 'Verifica della sessione 2 di 5…');
  assert.equal(it.message(new Error("Error invoking remote method 'sync-start': Error: Select a destination folder first.")), 'Seleziona prima una cartella di destinazione.');
  assert.equal(it.message('session.csv: Invalid GPS coordinate.'), 'session.csv: Coordinata GPS non valida.');
  assert.equal(it.message('session.csv: Conflict: session.csv already exists with different content.'), 'session.csv: Conflitto: session.csv esiste già con contenuti diversi.');
  const folder = 'C:\\Users\\Rider\\Telemetry';
  assert.equal(it.message('The telemetry folder is no longer available: ' + folder), 'La cartella di telemetria non è più disponibile: ' + folder);
  assert.equal(it.message('Unknown OS error 0x1234'), 'Unknown OS error 0x1234');
  assert.equal(it.message('INVALID_GPS_COORDINATE'), 'INVALID_GPS_COORDINATE', 'Diagnostics are recognized by English values, not symbolic IDs');
  assert.equal(it.message('Sync cancelled. Completed copies are preserved.'), it.t('SYNC_CANCELLED_NOTICE'));
  assert.equal(it.message('Cannot safely add this file (EXDEV). Choose a local folder that supports hard links, such as NTFS.'), it.t('FILE_ADD_UNSAFE_NOTICE', { code: 'EXDEV' }));
  const ar = create('ar', require('../src/locales/ar.json'), english);
  for (const diagnostic of ['Unknown OS error: 12%', 'Unknown OS error: 12 km', 'File transfer / Android Auto']) {
    assert.equal(ar.message(diagnostic), diagnostic, 'Template fragments must not reinterpret unknown diagnostics');
  }
});

test('markup belongs to templates and all dictionary text and interpolations are escaped', () => {
  const instance = create('en', { NOTICE: 'Text <b>stays literal</b> & {file}; {count}.' });
  const emphasize = text => `<b>${text}</b>`;
  assert.equal(instance.html('NOTICE', { file: '<img onerror="alert(1)">', count: 2 }, { file: emphasize }),
    'Text &lt;b&gt;stays literal&lt;/b&gt; &amp; <b>&lt;img onerror=&quot;alert(1)&quot;&gt;</b>; 2.');
  assert.equal(instance.html('NOTICE', { count: 2 }, { file: emphasize }),
    'Text &lt;b&gt;stays literal&lt;/b&gt; &amp; {file}; 2.');
  const rtl = create('ar', { NOTICE: '{file}' });
  assert.equal(rtl.html('NOTICE', { file: '<file>&' }, { file: emphasize }), '<b>\u2068&lt;file&gt;&amp;\u2069</b>');
  assert.equal(instance.html('NOTICE', { file: '<file>', count: 2 }, Object.create({ file: emphasize })),
    'Text &lt;b&gt;stays literal&lt;/b&gt; &amp; &lt;file&gt;; 2.');
});

test('UI translation references and packaged dictionaries match the catalog', () => {
  const files = ['../main.js', 'localization.js', 'app.js', 'sync-ui.js', 'route-map.js', 'route-frame.js', 'index_en.html', 'route-frame.html'];
  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
    assert.ok(!source.includes('data-i18n-html'), `${file}: dictionary markup is no longer supported`);
    for (const match of source.matchAll(/\.(?:t|html)\(("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)) {
      const key = match[1][0] === '"' ? JSON.parse(match[1]) : match[1].slice(1, -1);
      assert.ok(Object.hasOwn(english, key), `${file}: ${key}`);
    }
    for (const match of source.matchAll(/data-i18n(?:-html|-aria-label|-title)?="([^"]+)"/g)) {
      const key = match[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&');
      assert.ok(Object.hasOwn(english, key), `${file}: ${key}`);
    }
  }
  assert.ok(require('../package.json').build.files.includes('src/**/*'));
  const resources = require('../package.json').build.electronLanguages;
  for (const locale of supported) {
    assert.ok(fs.existsSync(path.join(__dirname, '../src/locales', locale + '.json')));
    // Chromium does not provide Punjabi or Hausa packs. Their custom UI still translates.
    if (!['pa', 'ha'].includes(locale)) assert.ok(resources.some(resource => resolveLocale(resource) === locale), `${locale}: missing Chromium resource`);
  }
});
