# Workflow regression checks

Run from the repository root:

```sh
node test7/tests/workflow-recovery.cjs
node test7/tests/barrier-recovery.cjs
```

For the browser suite, install Playwright, Leaflet, Leaflet Draw, Chart.js and the Earth Engine client in a separate test dependency directory, then install Chromium through Playwright. No production dependencies or model code need changing.

```sh
npm install --prefix /tmp/fire-tests playwright leaflet leaflet-draw chart.js @google/earthengine
/tmp/fire-tests/node_modules/.bin/playwright install chromium
PLAYWRIGHT_MODULE=/tmp/fire-tests/node_modules/playwright FIRE_TEST_DEPS=/tmp/fire-tests/node_modules node test7/tests/browser-workflows.cjs
```

`FIRE_TEST_CHROMIUM` optionally selects an existing Chromium executable. The suite serves this checkout on localhost port 8878.

The browser suite uses controlled, explicitly test-only Earth Engine, Overpass and weather responses. It exercises the real DOM, IndexedDB, preparation pipeline, scientific simulation, optimization worker, ensemble, GeoJSON picker, and TIFF/CSV exporters. It checks partial failures, cached chunks after refresh, selective retry, explicit skip, upload recovery, calibration cancellation/interlocks, late uploads after reset, language switching and missing-data guards. Satellite callbacks and remote responses are fixtures; the scientific model itself is not replaced. Video recording is disabled in this suite.

Passing these checks does not verify Google OAuth, production API availability, physical scientific accuracy, every possible input combination, or browser video/clipboard permissions. Those require live-session/device validation.

The ohsome checks use an explicitly controlled Parquet fixture and a dummy credential. They cover geometry decoding, Authorization header placement, cache reuse, authentication failure, and Remember-on/off persistence. No real API key is included.

## Temporal synchronization

```sh
node test7/tests/temporal-sync.cjs
node test7/tests/model-temporal.cjs
```

These Node checks cover date/year changes, leap dates, exact nowcast/forecast
windows, the 72-hour rain lookback, the existing 8,760-hour hindcast ceiling,
raw interval persistence, shorter/longer run reuse, forecast expiry, partial
point/hour failures, timeout recovery, cancellation and migration of existing
historical weather responses. The production weather conversion and actual CA
optimization worker run with clearly labelled test fixtures; Google sign-in
and satellite availability are not simulated as successful live tests.

Weather is cached before field corrections. Stable history is retained;
recent forecast hours expire after one hour. Forecast requests use hourly
bounds; the historical archive only documents day-level bounds, so repairing a
historical gap can return other hours in that same day. Valid cached hours are
kept. Missing optional history beyond the chosen run is logged and does not
block a run whose required weather is complete. Missing required weather
always blocks the run; no replacement weather is generated.
