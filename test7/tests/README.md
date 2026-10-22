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
