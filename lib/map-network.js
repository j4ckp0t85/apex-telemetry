// Native Electron tile requests have no web Referer. Identify the app as required
// by OSM, and leave Chromium's normal persistent HTTP cache headers untouched.
function configureMapNetwork(session, version) {
  session.webRequest.onBeforeSendHeaders({ urls: ['https://tile.openstreetmap.org/*'] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, 'User-Agent': `ApexTelemetry/${version} (desktop ride viewer)` } });
  });
}

module.exports = { configureMapNetwork };
