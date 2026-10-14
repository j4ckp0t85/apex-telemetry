# Third-party notices

## Leaflet 1.9.4

The local route iframe uses [Leaflet](https://leafletjs.com/), distributed under BSD-2-Clause. The complete notice is bundled at [`src/vendor/leaflet/LICENSE`](src/vendor/leaflet/LICENSE). These third-party components retain their own license terms.

Vendored release files, retrieved without modification from the pinned npm release:

| File | Source | SHA-256 |
| --- | --- | --- |
| `leaflet.js` | `https://unpkg.com/leaflet@1.9.4/dist/leaflet.js` | `db49d009c841f5ca34a888c96511ae936fd9f5533e90d8b2c4d57596f4e5641a` |
| `leaflet.css` | `https://unpkg.com/leaflet@1.9.4/dist/leaflet.css` | `a7837102824184820dfa198d1ebcd109ff6d0ff9a2672a074b9a1b4d147d04c6` |

The app uses vector circle markers and the standard zoom/scale controls, so Leaflet's optional marker/layer images are not needed. Scripts and styles load locally, including in packaged builds through the existing `src/**/*` inclusion.

## OpenStreetMap

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), under the Open Database License. Visible attribution is included in the map, including fullscreen.

Standard raster tiles use `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. They require no API key or account, but usage must comply with the [OSMF tile policy](https://operations.osmfoundation.org/policies/tiles/). This shared service has no availability guarantee. The app loads only viewed tiles, uses Chromium's HTTP cache, identifies itself as ApexTelemetry, and does not implement tile prefetch or offline downloads. Automated UI tests intercept all tile requests and use local fixture images.

The map background can be disabled without disabling the local route overlay. See [PRIVACY.md](PRIVACY.md) for network disclosures.
