# EnviAeroSurvey: Mahidol University

Terrain-aware UAV photogrammetry flight planner, for research and education at Mahidol University.

A browser-based mission planner for professional drone mapping. There is no build step and no API keys. You draw an area, pick a drone and camera, and pick a scene type. The app then shows the flight lines, GSD, overlap and flight time against a real terrain model, and it exports a mission file you can fly.

## Run

```bash
python -m http.server 8765
```

Open <http://localhost:8765>. The map, terrain tiles, geocoding and forecast all need internet access. Click **Load a demo mission** for a hillside survey near Chiang Mai.

Engine tests (Node ≥ 18):

```bash
node tests/planner.test.js
```

## Cost and fair-use guardrails

The site is static, and every external request is made by the visitor's own browser without API keys. **Nothing can be billed to the site owner.** GitHub Pages does not charge for traffic. Its soft limit is 100 GB per month, and the site itself is about 200 KB.

The free data services can still slow down or block traffic that breaks their fair-use policies. To prevent that, [js/guard.js](js/guard.js) adds these limits in each browser:

| Service | Guardrail |
|---|---|
| Place search (OSM Nominatim) | Runs on Enter only, never as you type. At most one request per 1.5 s, 30 per hour and 120 per day. Results are cached for 7 days. Typing `lat, lon` coordinates skips the service. |
| Forecast (Open-Meteo) | At most one request per 5 s, 20 per hour and 80 per day. Results are cached for 1 hour per site and date, and coordinates are rounded to about 1 km. |
| Basemap tiles (Esri, OSM, OpenTopoMap) | Tiles load only when panning or zooming stops. If a community tile server keeps refusing tiles, the map falls back to Satellite. |
| Terrain tiles (AWS Open Data) | Tiles are cached in memory, with up to 48 per plan and 2,500 per session. |
| All | Requests time out after 10–12 s. After an HTTP 429, 403 or 5xx reply, the service pauses itself for 30–60 min instead of retrying. |

To change a limit or switch a service off, edit `CONFIG` at the top of `js/guard.js`. Users can see their own usage under **Help → Fair use, data sources & limits**.

Commercial use would need paid plans from the providers: Esri, a commercial tile host, and Open-Meteo's API plan.

## Deploy (GitHub Pages, free)

1. Push the folder to a **public** GitHub repository. Pages on private repositories needs a paid plan.
2. Go to **Settings → Pages → Deploy from a branch → `main` / root**.
3. The site appears at `https://<user>.github.io/<repo>/`. The empty `.nojekyll` file makes Pages serve the files as they are, so no build or Actions minutes are used.

## What it covers

| Area | Details |
|---|---|
| **Mission types** | Area grid (orthomosaic and DSM), double grid / crosshatch (3D, urban, stockpiles), corridor (roads, rail, pipelines, power lines) |
| **Platforms** | DJI M3E, M4E, M3M, Phantom 4 RTK, M350 RTK, M300 RTK · Autel EVO II Pro RTK · Freefly Astro · WingtraOne Gen II · eBee X · Quantum Trinity Pro · custom multirotor or fixed-wing |
| **Payloads** | Zenmuse P1 (24/35/50 mm), M3E/M4E 4/3", M3M RGB and multispectral, P4RTK 1", Sony RX1R II / a6100 / UMC-R10C / ILX-LR1, S.O.D.A. 3D, Aeria X, MicaSense RedEdge-P / Altum-PT, custom |
| **Scene types** | Open, agriculture, forest, urban, mountain, mine/quarry, coastal/water, snow/sand. Each one sets the recommended overlap, obstacle/canopy height, terrain-following default, wind-shear exponent and field tips |
| **Terrain** | AWS Terrain Tiles DEM (SRTM / NED / EU-DEM blend), z10–15 depending on area size, bilinear sampling |
| **Environment** | NOAA sun position with a best-light window, Open-Meteo forecast (wind, gust, temperature, cloud, rain), power-law wind shear, ISA density altitude, battery temperature derating |
| **Usability** | Light theme by default with a dark theme toggle (remembered per browser). Overlap and flight direction take exact typed values as well as sliders. Built-in searchable guide with 22 topics, `?` buttons next to each section, "Show me" links that jump to the setting, and <kbd>?</kbd>/<kbd>F1</kbd> shortcuts |
| **Exports** | DJI WPML KMZ (Pilot 2 / FlightHub 2), Litchi CSV (split into 99-waypoint files), KML with 3D path, waypoint CSV, photo-centre CSV, GeoJSON, printable mission report with checklist |

## Method

- **Projection:** local Transverse Mercator (Krüger series, WGS84) centred on the site, so all geometry is in true metres. It is checked against an independent UTM formula to within 0.05 m.
- **Camera model:** pinhole camera. GSD = H·p/f, footprint = H·s/f, line spacing = footprint × (1 − side overlap), photo spacing = footprint × (1 − front overlap).
- **Coverage:** each flight line covers the exact polygon ∩ band intersection, so concave shapes and the boundary margin are handled. Line direction is either automatic (fewest turns) or aligned crosswind. The start corner is chosen to be nearest the take-off point.
- **Terrain-following:** the DEM is sampled along each line, then the profile is limited to a maximum climb grade and simplified with Douglas–Peucker. Simplification only ever raises the path, so the aircraft never drops below the target height above ground. Transits are lifted the same way.
- **Terrain effects on quality:** for every photo, the image-edge rays are intersected with the DEM in all four directions. Front and side overlap are computed from the real footprint edges and the neighbouring line, not from a flat-ground assumption. The result matches the analytic cross-slope solution to 0.01 %. Fixed-altitude missions show the GSD spread and the overlap loss on high ground, and can optionally size the spacing for the highest ground.
- **Speed:** the lowest of the platform maximum, the motion-blur limit (v·t/GSD ≤ max px) and the camera's capture interval. For fixed-wing aircraft, ground speed is computed per line from the wind vector.
- **Endurance:** nominal flight time × √σ (air density) × temperature factor × wind factor × (1 − reserve). Battery swap points are placed where the aircraft can still return home.
- **Safety checks:** wind and gust against the platform limit, service ceiling, density altitude, clearance over terrain plus obstacles plus DEM uncertainty, transit terrain conflicts, maximum height above take-off, regulatory height above ground, VLOS radius, sun elevation, glint, and multispectral timing.

## Limitations

- Platform and camera specs are nominal manufacturer values. Check them against your own unit and firmware.
- The DEM is roughly 30 m SRTM in most places, with ±5–16 m vertical error, and it can contain canopy or buildings. Keep the **DEM uncertainty** and **obstacle height** fields honest.
- Waypoint heights in DJI and Litchi files are relative to take-off. KML and CSV files also carry heights above sea level (EGM96), not ellipsoidal heights.
- The DJI WPML export is a waypoint mission with distance-interval capture. Check it in the DJI Pilot 2 simulator before flying. Enum values for newer aircraft such as the M4E may need updating.
- Accuracy figures are rules of thumb (multiples of GSD), not guarantees.

## Files

```
index.html            UI shell
css/app.css           styles (dark, responsive)
js/data.js            platforms, cameras, scene profiles
js/geo.js             projection and planar geometry
js/environment.js     sun, air density, wind shear, endurance
js/dem.js             Terrarium DEM tile loader / sampler
js/planner.js         planning engine (DOM-free)
js/guard.js           fair-use guardrails for external services (limits, cache, cool-downs)
js/exporters.js       KML / KMZ-WPML / Litchi / CSV / GeoJSON
js/help.js            built-in user guide (topics + controller)
js/app.js             map, drawing, rendering, files, report
tests/planner.test.js engine tests
```
