# EnviAeroSurvey: Mahidol University — Developer Guide

**Repository:** `envi-aero-survey` · **Live app:** <https://chiyanon.github.io/envi-aero-survey/> · **Document date:** 13 November 2026

This guide is for developers who will maintain, study or extend EnviAeroSurvey. It covers the architecture, every module, the math behind the planning engine, the data contracts between modules, testing and deployment. It also lists known limitations and a suggested roadmap. Read sections 1–4 first, then whichever module you need.

---

## Contents

1. [Purpose and scope](#1-purpose-and-scope)
2. [Quick start for developers](#2-quick-start-for-developers)
3. [Architecture](#3-architecture)
4. [Repository layout](#4-repository-layout)
5. [Module reference](#5-module-reference)
   - 5.1 [`data.js`: equipment and scene database](#51-datajs--equipment-and-scene-database)
   - 5.2 [`geo.js`: geodesy and planar geometry](#52-geojs--geodesy-and-planar-geometry)
   - 5.3 [`environment.js`: sun, air, wind, batteries](#53-environmentjs--sun-air-wind-batteries)
   - 5.4 [`dem.js`: terrain model](#54-demjs--terrain-model)
   - 5.5 [`planner.js`: the planning engine](#55-plannerjs--the-planning-engine)
   - 5.6 [`exporters.js`: mission file formats](#56-exportersjs--mission-file-formats)
   - 5.7 [`guard.js`: fair-use guardrails](#57-guardjs--fair-use-guardrails)
   - 5.8 [`help.js`: built-in user guide](#58-helpjs--built-in-user-guide)
   - 5.9 [`app.js`: UI controller](#59-appjs--ui-controller)
   - 5.10 [`index.html` and `css/app.css`](#510-indexhtml-and-cssappcss)
6. [Planning engine in depth](#6-planning-engine-in-depth)
7. [Data contracts](#7-data-contracts)
8. [Persistence, storage keys and file formats](#8-persistence-storage-keys-and-file-formats)
9. [External services](#9-external-services)
10. [Testing](#10-testing)
11. [Deployment and release](#11-deployment-and-release)
12. [How to extend](#12-how-to-extend)
13. [Coding conventions](#13-coding-conventions)
14. [Known limitations and technical debt](#14-known-limitations-and-technical-debt)
15. [Roadmap suggestions](#15-roadmap-suggestions)
16. [Troubleshooting for developers](#16-troubleshooting-for-developers)
17. [References](#17-references)
18. [Change history](#18-change-history)

---

## 1. Purpose and scope

EnviAeroSurvey plans **nadir photogrammetry missions** for professional UAVs. Users draw an area or a corridor, pick an aircraft and camera, and pick a scene type. The app then computes:

- flight lines, waypoints and photo positions for **area grid**, **double grid** (crosshatch) and **corridor** missions;
- the **achieved** GSD and front/side overlap of every photo against a real terrain model (DEM), in both **terrain-following** and **fixed-altitude** modes;
- speed limits from motion blur, camera capture interval and the airframe;
- flight time, endurance derating (air density, temperature, wind) and **battery swap points**;
- safety checks: wind, ceiling, clearance, altitude limits, VLOS, sunlight;
- exports for DJI Pilot 2 (WPML KMZ), Litchi, Google Earth (KML), CSV and GeoJSON, plus a printable report.

It deliberately **is not** a flight controller or ground station, and it does not upload missions to aircraft. Oblique, façade and LiDAR missions are out of scope for now.

**Design goals**, in priority order:

1. Accuracy that is honest about its limits.
2. Ease of use for non-experts.
3. Zero cost and zero setup to host: static files, no build step, no API keys.
4. A planning engine that is testable without a browser.

---

## 2. Quick start for developers

Requirements: a modern browser, Python 3 (any static server works) and Node ≥ 18 for tests.

```bash
git clone https://github.com/chiyanon/envi-aero-survey.git
cd envi-aero-survey
python -m http.server 8765        # then open http://localhost:8765
node tests/planner.test.js        # engine tests
node --no-warnings tests/guard.test.js   # guardrail tests
```

Open the app and click **Load a demo mission**, a hillside survey near Chiang Mai. This exercises every subsystem.

Debug handles in the browser console:

```js
EnviAeroSurvey.state    // the UI state object (S)
EnviAeroSurvey.plan     // the last planner result (R)
EnviAeroSurvey.replan() // force a re-plan
UAV.guard.usage()       // fair-use counters for this browser
UAV.help.open('overlap')
```

> Pages must be served over HTTP(S). With `file://`, the browser blocks canvas reads of the DEM tiles (CORS), and the terrain silently falls back to flat ground.

---

## 3. Architecture

### 3.1 Principles

- **No build, no framework.** Plain ES2020 scripts loaded in order by `index.html`. Each module is an IIFE that attaches to a single global namespace, `window.UAV` (or `globalThis.UAV` in Node).
- **Pure core, thin shell.** `geo`, `environment`, `planner`, `exporters` (apart from `Blob`) and `guard` do not touch the DOM. `planner.plan()` is a pure function of its input object, apart from the injected `elev()` sampler. All UI lives in `app.js`.
- **Dependency injection for terrain.** The planner receives `elev(lat, lon) → metres | NaN`. In the browser this is `dem.sample`. In tests it is an analytic function such as a ramp or a cliff, which is how the terrain math is verified exactly.
- **Local metric frame.** All geometry is computed in metres in a local Transverse Mercator frame centred on the mission. Lat/lon is used only at the edges, for input, output and DEM lookups.

### 3.2 Runtime data flow

```
 user input ──► app.js (state S) ──debounce 280 ms──► replan()
                                                   │
                       dem.ensure(bbox) ◄──────────┤  (loads Terrarium PNG tiles, guarded)
                                                   │
                     planner.plan(buildInput()) ◄──┘  (pure; uses dem.sample via elev())
                                                   │
                                   result R ───────┼──► render(): map layers, KPIs, warnings,
                                                   │             details, legend, profile chart
                                                   └──► exporters.* (on click) ──► file download
```

`replan()` uses a sequence counter (`seq`). If an older async DEM load finishes after a newer request has started, its result is thrown away.

### 3.3 Script load order (`index.html`)

```
leaflet.js → guard.js → data.js → geo.js → environment.js → dem.js → planner.js → exporters.js → help.js → app.js
```

`dem.js` calls `UAV.guard` lazily, so `guard.js` only has to load before the first tile request. `app.js` must load last.

---

## 4. Repository layout

```
index.html              UI shell: all markup, the help drawer, script tags, theme bootstrap script
css/app.css             design tokens (light default + dark), layout, components, responsive rules
js/data.js              platforms, cameras, scene/terrain profiles, shutters, georeferencing table
js/geo.js               Krüger Transverse Mercator, polygons, polylines, offsets, Douglas–Peucker
js/environment.js       NOAA sun position, ISA density, wind power law, endurance factors
js/dem.js               AWS Terrain Tiles (Terrarium) loader, cache and bilinear sampler
js/planner.js           planning engine (lines, terrain-following, photos, overlap, timing, checks)
js/exporters.js         KML, DJI WPML KMZ (own ZIP writer), Litchi CSV, CSVs, GeoJSON
js/guard.js             fair-use guardrails (rate limits, cache, cool-downs, budgets, kill switches)
js/help.js              help topics (content) and the help drawer controller
js/app.js               UI controller: Leaflet map, drawing, state, re-planning, rendering, files, report
tests/planner.test.js   engine tests (geodesy, camera geometry, coverage, terrain, missions, environment)
tests/guard.test.js     guardrail tests (cache, interval, hourly cap, 429 back-off, kill switch, budget)
docs/DEVELOPER_GUIDE.md this document
.nojekyll               tells GitHub Pages to serve files as-is (no Jekyll build)
.gitignore              excludes local tooling (.claude/), OS files and test downloads
```

Approximate size: about 3,200 lines in total. Planner 574, app 822, help 371, CSS 299.

---

## 5. Module reference

### 5.1 `data.js` — equipment and scene database

Exports `UAV.data = { cameras, platforms, terrains, shutters, georef }`.

**Camera record:**

| Field | Unit | Meaning |
|---|---|---|
| `sw`, `sh` | mm | sensor width / height |
| `iw`, `ih` | px | image width / height |
| `f` | mm | focal length (real, not 35 mm equivalent) |
| `minInt` | s | minimum capture interval |
| `shutter` | — | `mechanical` \| `global` \| `rolling` |
| `mb` | MB | storage per capture (all bands) |
| `bands` | — | text; a regex on `RE` or `NIR` marks multispectral |
| `custom` | bool | editable through the custom-camera form |

**Platform record:**

| Field | Unit | Meaning |
|---|---|---|
| `type` | — | `multirotor` \| `fixedwing` |
| `speed` | m/s | maximum mapping ground speed (multirotor) or cruise airspeed (fixed-wing) |
| `endurance` | min | nominal flight time with payload |
| `wind` | m/s | maximum wind resistance |
| `ceiling` | m ASL | maximum service ceiling |
| `turnTime` | s | time added per line turn |
| `turnRadius` | m | fixed-wing only |
| `cameras` | ids | compatible payloads, first = default |
| `dji` | `{drone, sub, payload}` | WPML enum values, or `null` for non-DJI aircraft |

**Terrain (scene) record:** `front`, `side` (recommended overlap, %), `alpha` (wind-shear exponent), `obstacle` (default obstacle/canopy height, m), `follow` (`on` \| `off` \| `auto`), `doubleGrid` (bool), `tips` (array of strings).

**`georef`:** rule-of-thumb accuracy multipliers of GSD, `h:[lo,hi]` and `v:[lo,hi]`, plus a `fixed` offset in metres. Standalone GNSS uses `fixed` and `fixedV` in metres instead.

> All specs are manufacturer nominal values. The DJI enum values for the Matrice 4E (`drone: 99, payload: 88`) are **unverified**. Check them against the current DJI Cloud API / WPML documentation.

### 5.2 `geo.js` — geodesy and planar geometry

- `tmForward(lat, lon, lon0)` and `tmInverse(E, N, lon0)` implement Transverse Mercator with the **Krüger n⁴ series** on WGS84 (Karney 2011 coefficients), k₀ = 1. They have been checked against an independent Snyder UTM formula to within 0.05 m.
- `makeProjection(lat0, lon0)` returns `{toLocal(lat, lon) → [x, y], toLatLon(x, y) → [lat, lon]}`, with the origin at (lat0, lon0), x pointing east and y pointing north. Inside ±50 km the scale error is below 0.01 %, so distances and areas can be used as true metres.
- Planar helpers: `dist`, `polygonArea` (signed, CCW positive), `polygonCentroid`, `pointInPolygon` (ray casting), `polylineLength`, `pointAlong(pts, d) → [x, y, segIndex]`, `offsetPolyline(pts, o)` (left = positive, mitred joins clamped to 4× and cos ≥ 0.25), `corridorPolygon(pts, w)`, `bearing(p, q)` (degrees clockwise from north), `haversine` (display only) and `simplifyProfile(prof, tol)` (Douglas–Peucker over `{d, z}` that returns the indices to keep).

### 5.3 `environment.js` — sun, air, wind, batteries

| Function | Model |
|---|---|
| `sunPosition(date, lat, lon)` | NOAA solar position algorithm (equation of time, declination) with Bennett refraction. Returns `{elevation, azimuth, declination}` in degrees. |
| `sunDay(dateStr, utcOffsetH, lat, lon, minElev)` | Samples the local day every 5 min. Returns `samples`, `maxElev`, `noonMinute`, `window` (elevation ≥ `minElev`) and `daylight` (elevation ≥ −0.833°). |
| `airDensity(h, T)` | ISA pressure `p = 101325·(1 − 2.25577e-5·h)^5.25588`, `ρ = p / (287.05·(T + 273.15))`, `σ = ρ / 1.225`, and density altitude from σ. |
| `windAt(v10, h, α)` | Power-law profile `v(h) = v₁₀·(h/10)^α`, with α taken from the scene type. |
| `tempFactor(T)` | Li-ion capacity: 1.0 between 20 and 35 °C, 0.85 at 0 °C, 0.70 at −10 °C, floor 0.55; above 35 °C −1 %/°C down to 0.85. |
| `enduranceFactor(type, σ, T, wind, windMax)` | `√σ × tempFactor × windFactor`, where windFactor = 1 − k·r², r = wind/windMax (capped at 1.2), k = 0.35 multirotor / 0.25 fixed-wing. |

These are **engineering heuristics**, not manufacturer data. They were chosen to produce conservative, explainable results.

### 5.4 `dem.js` — terrain model

- **Source:** AWS Open Data "Terrain Tiles", Terrarium PNG encoding at `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`. The data is a blend of SRTM 30 m, NED (USA) and EU-DEM, among others. Heights are roughly orthometric (EGM96 / mean sea level).
- **Decoding:** `elevation = R·256 + G + B/256 − 32768` (metres), read from a canvas `getImageData`. The image needs `crossOrigin = 'anonymous'`.
- `ensure(bbox, maxTiles = 48)` picks the highest zoom from 15 down to 10 that fits within `maxTiles` tiles, loads all tiles in parallel and resolves `{zoom, tiles, failed, resolution}`. The **zoom is global state**: `sample()` always reads at the zoom of the most recent `ensure()`.
- `sample(lat, lon)` does bilinear interpolation across tile borders. It returns `NaN` when a tile is missing, or averages whichever neighbours are available.
- Tiles are cached in a `Map` for the page's lifetime. A guard budget limits tiles per session (see 5.7).

### 5.5 `planner.js` — the planning engine

Public: `UAV.planner = { plan, bestAngle, gridRows, bandIntervals, limitGrade, simplifySafe }`. Section 6 describes `plan()` in full. The helpers:

| Helper | Purpose |
|---|---|
| `frame(bearing)` | Orthonormal along/across basis: `u` = line direction, `v` = across. `S(p)` and `T(p)` project a point; `P(s, t)` goes back. |
| `bestAngle(poly)` | Scans 0–179.5° in 0.5° steps and picks the bearing that minimises the polygon's across-track width, which means the fewest lines and turns. |
| `bandIntervals(st, ta, tb, gap)` | Exact s-extent of polygon ∩ {ta ≤ t ≤ tb}: the union of the projections of the clipped edges and of the band-boundary chords, merged when gaps are below `gap`. |
| `gridRows(poly, bearing, spacing, margin, ext, gap)` | Centred scan rows. Each row is a list of segments tagged with `row`, `n` and `fv` (frame v), which the overlap model uses. |
| `orderRows(rows, home, prevEnd)` | Boustrophedon ordering. Tries 4 start corners and keeps the one with the smallest home→start + end→home distance. |
| `limitGrade(prof, g)` | Raise-only slope limiter: a forward pass bounds descents, a backward pass bounds climbs. |
| `simplifySafe(prof, tol)` | Douglas–Peucker, then lifts the endpoints of each kept segment by the largest deficit, so the simplified path **never** dips below the smoothed profile. |

### 5.6 `exporters.js` — mission file formats

| Function | Output | Notes |
|---|---|---|
| `kml(R, {name, summary})` | KML string | Area polygon, 3D `LineString` (`altitudeMode absolute`, EGM96 heights), photo-centre folder (hidden by default). |
| `wpml(R, {platform, takeoffSafe})` | `Blob` (KMZ) | `wpmz/template.kml` + `wpmz/waylines.wpml`, namespace `http://www.dji.com/wpmz/1.0.2`, `executeHeightMode = relativeToStartPoint`. A gimbal −90° action fires at waypoint 0, and each imaging pass gets one `multipleDistance` `takePhoto` action group from its first to its last waypoint. Interior pass waypoints use `toPointAndPassWithContinuityCurvature`. |
| `litchi(R)` | `string[]` | Litchi CSV with 18 columns, split every 99 waypoints. `altitudemode 0` (above home), `gimbalmode 2` with pitch −90, `photo_distinterval` set on imaging segments and `-1` otherwise. |
| `waypointCSV(R)` | string | index, type, line, lat, lon, height ASL, height above take-off, ground, AGL. |
| `photoCSV(R)` | string | Planned photo centres with GSD and front/side overlap. |
| `geojson(R)` | string | FeatureCollection: area, path (with z) and photo points with attributes. |
| `zip(files)` | `Blob` | Minimal **store-only** ZIP writer with its own CRC-32 and the UTF-8 flag set. |

The waypoint list for DJI and Litchi is `R.route` filtered to the `line` and `transit` kinds. Take-off, climb, descent and landing are left to the flight app.

### 5.7 `guard.js` — fair-use guardrails

**Why it exists.** Every external request comes from the visitor's browser without keys, so nothing can be billed. The free providers do enforce fair-use policies, though: Nominatim allows 1 request/s, and the OSM tile servers forbid heavy use. Without limits the site could be throttled or blocked. The guard keeps usage well inside those policies.

`CONFIG` (edit it to tune limits or switch a service off):

| Service | Interval | /hour | /day | Cache TTL | Cool-down |
|---|---|---|---|---|---|
| `search` (Nominatim) | 1.5 s | 30 | 120 | 7 days | 30 min |
| `forecast` (Open-Meteo) | 5 s | 20 | 80 | 1 h | 60 min |
| `terrain` | — | — | — | memory (page lifetime) | — (2,500 tiles/session) |
| `basemap` | fail-over after 15 tile errors within 60 s | | | | |

API:

- `fetchJSON(svc, url, cacheKey, opts)`: cache → `check()` → `record()` → `fetch` with an `AbortController` time-out. A **429, 403 or 418** reply starts the cool-down; **5xx** pauses for 5 min. The function throws `GuardError` with a user-readable `message` and a `code` (`disabled`, `cooldown`, `interval`, `hourly`, `daily`, `limited`, `server`, `network`, `parse`, `http`). It resolves `{data, cached}`.
- `check`, `record`, `cooldown`, `cacheGet`, `cacheSet`, `terrainTileAllowed`, `usage`, `fmtWait`.
- **Storage:** request logs, cool-downs and the cache live in `localStorage` under `enviaerosurvey.guard.*`, with an in-memory mirror so the guard still works when storage is blocked. The cache keeps 40 entries per service with oldest-first eviction.

> The guard runs on the client. It protects normal users of the site; it cannot stop someone who calls the providers directly. That is acceptable because nothing is billable to the owner.

### 5.8 `help.js` — built-in user guide

- `topics`: an array of `{id, group, title, html}`. `html` can be a string or a function, so topics can render live data. The `fairuse` topic uses this to show the `guard.usage()` table.
- The controller renders the navigation, searches the title plus the text with tags stripped, highlights matches with `<mark>`, and adds previous/next links.
- **Contextual help:** any element with `data-help="<topicId>"` opens that topic. This works through a document-level click listener in the capture phase.
- **"Show me" links:** `data-goto="<elementId>"` closes the drawer, opens any enclosing `<details>`, scrolls to the element, plays a `.flash` animation and focuses it.
- **Keys:** `?` (when the user is not typing) and `F1` open the guide; `Esc` closes it. The Esc listener runs in the capture phase so it does not cancel drawing at the same time.
- `UAV.help = { open(id), close(), init(), topics }`.

### 5.9 `app.js` — UI controller

A single IIFE organised in sections. The `// ----` banners in the file mark them.

| Section | Responsibilities |
|---|---|
| State | `DEF` defaults, `S` (live state), `R` (last plan), `save()` → localStorage, one-time migration from the old `aerogrid.*` keys |
| Resolvers | `platform()`, `camera()` and `terrain()` merge the custom-form values; `gsdFromAgl` / `aglFromGsd` |
| Map | Leaflet map, base layers with `TILE_OPTS` (`updateWhenIdle`, `keepBuffer: 2`), tile-error fail-over to Satellite, layer groups `areaLayer`, `editLayer`, `planLayer`, `photoLayer`, `footLayer`, and a canvas renderer for dense layers |
| Selects and UI sync | `fillPlatforms` (optgroups by type), `fillCameras` (filtered by platform), `syncUI()` (state → DOM), `syncAltitude()` (GSD/AGL and the auto direction display) |
| Sun | `renderSun()` (elevation, azimuth, shadow factor, day bar), `sunWarnings()` (merged into the plan warnings at render time) |
| Drawing and editing | `startDraw` / `finishDraw` / `cancelDraw` (with `drawBackup` restore), vertex drag, midpoint insert, right-click delete, take-off marker |
| Planning | `schedule()` (280 ms debounce plus save), `buildInput()` (state → planner input), `replan()` (DEM `ensure` → `plan` → `render`) |
| Rendering | route polylines (imaging solid, transits dashed), S/E markers, battery swap markers, photo dots coloured by metric, footprints (decimated above 1,500), legend, KPIs, warnings, details table |
| Theme | `applyTheme()`, `currentTheme()`, the `css(varName)` helper; the profile chart reads CSS variables so it follows the theme |
| Profile chart | `drawProfile(hoverIdx)`: HiDPI canvas, nice-step axes, ground fill, obstacle line, path, imaging segments; hovering moves a marker on the map |
| Bindings | segment controls, `linkSliderNum()` (slider ↔ exact-value box, live while typing, clamped on commit), flight-direction box (0–359, wraps; turns Auto off) |
| Services | forecast (`guard.fetchJSON('forecast', …)`, coordinates rounded to 0.01°), search (Enter only, ≥ 3 characters, `lat, lon` bypass, HTML-escaped results) |
| Files | save/open project JSON, import KML/GeoJSON, export buttons, `download()` |
| Report | builds a standalone HTML report (SVG plan sketch in local metres, profile PNG, checks, checklist) in a new window, or downloads it when popups are blocked |
| Demo and init | demo mission; init order `fillPlatforms → fillMisc → applyTheme → setBase → syncUI → renderArea → schedule` |

**Important behaviours:**

- **GSD/AGL lock.** `S.lock` remembers which of the two the user edited last. When the camera or platform changes, the locked value is kept and the other is recomputed.
- **Scene change.** Changing the scene type overwrites front/side overlap and the obstacle height, and may switch the altitude mode (`follow: on` → terrain-follow; `off` → fixed relative to take-off).
- **Auto flight direction.** When Auto is on, `R.design.angle` is shown greyed in the number box (`.is-auto`).
- **Debug handle.** `window.EnviAeroSurvey = { state, plan, replan }`.

### 5.10 `index.html` and `css/app.css`

- **Layout:** a three-column grid (configuration 360 px | map | results 350 px) under a 52 px top bar. Below 980 px it stacks vertically.
- **Theme:** design tokens on `:root` (light, the default) and `:root[data-theme="dark"]`. A tiny inline script in `<head>` applies the stored theme before first paint, so dark-theme users see no flash of the light theme. **Always use the tokens** (`--card`, `--text`, `--accent`, …) rather than raw colours. The exceptions are map overlay markers, which must stay readable on satellite imagery in both themes.
- **Components:** `.card`, `.field`, `.seg` (segmented control), `.slider-num`, `.hq` (help "?" button), `.kpi`, `.warnings li.{danger,caution,info,ok}`, `.help*` (drawer), `.callout`, `.formula`.
- `[hidden] { display: none !important }` is required because several components set `display`.

---

## 6. Planning engine in depth

`plan(input)` runs these stages in order. Variable names match the code.

### 6.1 Set-up

1. **Validate geometry:** at least 3 polygon vertices, or at least 2 for a corridor line. On failure it returns `{ok: false, error}`.
2. **Projection:** centred on the vertex mean (`makeProjection`).
3. **Terrain accessor:** `elevXY(p)` calls `inp.elev`. When that returns `NaN` it counts the miss and uses `fallbackElev` (default 0). The miss ratio feeds a warning.
4. **Camera geometry:** pitch `p = sw / iw` (mm/px). The across-track sensor side is `sw` when `orientation = across` (long side across the line, the default), otherwise `sh`.

```
GSD(H)      = H · p / f                 [m/px]
footX(H)    = H · s_across / f          [m]
footY(H)    = H · s_along  / f          [m]
```

### 6.2 Terrain survey

The planner samples the area on a grid with step `clamp(√(area/3000), 5, 250)` m, plus the polygon vertices. This gives `zmin`, `zmax`, `zmean`, `relief`, and the mean and maximum slope (finite differences). Take-off elevation `zHome` comes from `inp.homeElev` or a DEM sample.

### 6.3 Altitude design

- **Terrain-follow:** the design height `Hdesign = H` (the target AGL).
- **Fixed altitude:** `zFixed = zRef + H`, where `zRef` is take-off, lowest, highest or mean ground. The minimum and maximum AGL are `zFixed − zmax` and `zFixed − zmin`. If the minimum AGL is ≤ 0, the plan is rejected. With `protectOverlap`, `Hdesign = min(H, minAGL)` so spacing is sized for the highest ground.

```
lineSpacing  = footX(Hdesign) · (1 − side)
photoSpacing = footY(Hdesign) · (1 − front)
```

### 6.4 Line generation

**Area grid.** The bearing comes from the user or from `bestAngle`. The rows are centred across the polygon's width plus 2·margin:

```
n  = ceil((tmax − tmin + 2·margin) / spacing)
t_k = tmid + (k − (n − 1)/2) · spacing
```

The edge offset is always ≤ spacing/2, which guarantees across-track coverage. Each row's s-range is the exact extent of the polygon inside the band `|t − t_k| ≤ spacing/2 + margin` (`bandIntervals`). This fills concave notches and corners that a single scanline would miss. Each segment is then extended by `margin + ext` (run-in/out). Intervals separated by less than `max(footY, 25 m)` are merged into one pass.

**Double grid.** A second set of rows at bearing + 90°, ordered to start near the end of the first set.

**Corridor.** The number of lines is

```
n = ceil((W − footX)/lineSpacing) + 1   (when W > footX), minimum 2
```

Each line is an `offsetPolyline` of the centre-line, extended by `margin + ext + footY/4`. Lines alternate direction, and 4 ordering variants are evaluated against the take-off point.

### 6.5 Altitude profile per pass

**Terrain-follow:**

1. Sample the ground along the pass every `clamp(photoSpacing/2, 4, 25)` m, with desired `z = ground + H`.
2. `limitGrade` with `maxGrade` (default 40 % multirotor, 15 % fixed-wing). This is **raise-only**, so it never goes below the desired profile.
3. `simplifySafe` with the follow tolerance (default 3 m) produces waypoints. After simplification each segment is lifted by its largest deficit, so the path is still never below the profile.
4. Corridor bend vertices are added back as waypoints.

**Fixed altitude:** the pass vertices at `zFixed`.

### 6.6 Photos and the achieved-overlap model

Photos are distance-triggered from each pass start, matching DJI `multipleDistance` and Litchi `photo_distinterval`: `d_j = j · photoSpacing` for j = 0 … floor(L / photoSpacing).

For each photo at nadir point **p** and altitude **z**, the image edge in direction **dir** is where the edge ray meets the terrain. With `k = tan(half-FOV) = s / (2f)`, it solves

```
x = (z − g(p + dir·x)) · k
```

by damped fixed-point iteration (up to 6 steps, tolerance 0.05 m). This gives the forward, back, right and left extents on the real terrain.

**Front overlap** with the next photo (the last photo uses its previous pair):

```
front_j = (fwd_j + back_{j+1} − photoSpacing) / (fwd_j + back_j)
```

**Side overlap.** For each side that has a neighbouring line, the neighbour's nadir is `q = p ± v·lineSpacing` and its altitude is `zq` (ground(q) + H when following terrain, `zFixed` otherwise). Its extent back toward **p** is computed the same way:

```
side = min over existing neighbours of (own_edge + neighbour_edge − lineSpacing) / (right + left)
```

Neighbour existence comes from the row index and row count (grid) or the line index and direction (corridor). Edge rows therefore only count their inward neighbour.

**Validation.** On a constant cross-slope s with terrain-following, the analytic solution is

```
overlap = (2Hk/(1 − s²k²) − S) / (Hk/(1 + sk) + Hk/(1 − sk))
```

The engine matches it to 0.01 % (see `tests/planner.test.js`, "Cross-slope"). Note that terrain-following on a cross-slope *slightly increases* side overlap. A naive "lowest AGL in the footprint" model wrongly predicts a loss.

**Other per-photo values:** `gsd` (at nadir AGL), `agl`, and `clearance = z − max ground within 20 m − obstacle`.

### 6.7 Route assembly

The route runs `home (ground) → climb (vertical) → [transit] → pass 1 waypoints → [transit] → … → descend → land`.

- **Terrain-follow transits** use the same follow → grade-limit → safe-simplify pipeline with a required height of `min(H, max(obstacle + 10, 0.8·H))`. If a transit needs to start higher, the preceding climb is raised.
- **Fixed-altitude transits** are straight lines. Their clearance over terrain plus obstacles is checked, ignoring points within 30 m of take-off.
- **Route point kinds:** `home`, `climb`, `transit`, `line` (with `first` and `last` flags and `pass`), `descend`, `land`.

### 6.8 Speed

**Multirotor:**

```
v = min(user or platform speed, platform.speed, vBlur, vInterval)
vBlur     = maxBlur · GSDmin / t_exposure
vInterval = photoSpacing / camera.minInt
```

The result is floored to 0.1 m/s, and `limitedBy` records which term won.

**Fixed-wing:** the airspeed is the cruise speed (user override clamped to ±20–30 %). The ground speed per pass comes from the wind triangle:

```
gs = √(Va² − w_cross²) + w_along
```

Here `w` is the wind at flight height (power law). The engine checks the worst (downwind) trigger interval and motion blur.

### 6.9 Timing, endurance and batteries

- **Segment time:** `max(horizontal/v, climb/vClimb or descent/vDesc)`, plus `turnTime` at each pass start. The transit speed is `min(platform.speed, max(v, 12))` for multirotors. VTOL aircraft get +90 s for transitions.
- **Usable time per battery:**

```
usable = endurance · 60 · enduranceFactor(σ at mean flight altitude, T, wind) · (1 − reserve)
```

  The temperature at altitude uses a −6.5 °C/km lapse rate.
- **Battery swaps.** The planner walks the route, and before each segment checks `used + t + RTL(next point) > usable`. When that is true it places a swap at the previous point. Each swap adds the return-to-home and resume times. `batteries = swaps + 1`.

### 6.10 Checks and warnings

Each warning has a level: `danger` (do not fly), `caution`, or `info`. The catalogue (in `planner.js`, after `// ---- warnings`):

| Trigger | Level |
|---|---|
| DEM missing > 2 % of samples | caution |
| Wind at height > platform limit | danger |
| Gust at height > limit, or wind > 75 % of limit | caution |
| Highest altitude > ceiling | danger |
| Density altitude > 3,000 m | caution |
| Temperature < 0 °C or > 40 °C | caution |
| Fixed mode: relief > 20 % of H | caution |
| Fixed mode with protect overlap (spacing sized for high ground) | info |
| Minimum clearance − DEM uncertainty < 0 | danger |
| Minimum clearance − DEM uncertainty < 15 m | caution |
| Fixed-altitude transit clearance < 10 m | danger |
| Height above take-off > aircraft limit | danger |
| Height AGL > regulatory limit | caution |
| Distance > VLOS radius | info |
| Speed limited by blur or capture interval | info |
| Fixed-wing downwind trigger interval < camera minimum | danger |
| Blur > max (danger when > 1 px) | caution / danger |
| Photos > 5 % below front/side target | caution |
| Rolling shutter, multispectral, fixed-wing loop turns, battery swaps | info |
| Single-line corridor | caution |
| Scene recommends double grid or terrain-following | info / caution |

`app.js` adds sun warnings (night, low sun, glint over water, multispectral timing) at render time.

### 6.11 Accuracy estimate

The horizontal and vertical ranges are the GSD multiples from `data.georef`, applied to the mean GSD (plus the fixed offset). This is a rule of thumb drawn from common photogrammetry practice. It is shown as an expectation, not a guarantee.

### 6.12 Complexity and performance

The work is roughly O(photos × DEM samples per photo). The overlap model costs about 25 samples per photo, and each sample is an inverse TM transform plus a bilinear lookup. Typical areas (≤ 3,000 photos) plan in well under a second. Very large areas (> 10,000 photos) can block the main thread for a noticeable time; see the roadmap item on Web Workers.

---

## 7. Data contracts

### 7.1 Planner input (`buildInput()` in `app.js`)

```js
{
  mission: 'area' | 'double' | 'corridor',
  polygon: [[lat, lon], ...],     line: [[lat, lon], ...],     corridorWidth: m,
  home: [lat, lon] | null,        homeElev?: m,                fallbackElev?: m,
  platform: PlatformRecord,       camera: CameraRecord,        terrain: TerrainRecord,
  altMode: 'follow' | 'fixed',    fixedRef: 'takeoff' | 'lowest' | 'mean' | 'highest',
  protectOverlap: bool,           agl: m,  front: %,  side: %,
  angle: deg,                     autoAngle: bool,             orientation: 'across' | 'along',
  speed: m/s (0 = auto),          shutter: s,  shutterLabel,   maxBlur: px,
  margin: m,  lineExtension: m | null,  maxGrade: % | null,    followTolerance: m,
  obstacle: m,  demUncertainty: m,  reserve: %,  takeoffSafeHeight: m,
  legalAGL: m,  maxRelAlt: m,  vlos: m,  georef: key of data.georef,
  wind: { speed, gust, dir /* from, deg */ },  temperature: °C,
  elev: (lat, lon) => m | NaN,
  corridorMinLines?: n
}
```

### 7.2 Planner result (`R`)

```js
{ ok: true, warnings: [{level, msg}], proj,
  area:    { m2, polygon: [[lat, lon]], perimeter },
  terrain: { zmin, zmax, zmean, relief, slopeMax, slopeMean, zHome, demMissing },
  design:  { H, Hdesign, zFixed, minAGLfixed, maxAGLfixed, gsdTarget, footX, footY,
             lineSpacing, photoSpacing, angle, followOn, nLinesA, nLinesB, corridorLines },
  photos:  [{ x, y, lat, lon, z, ground, agl, gsd, front, side, clearance, pass, set, u, fwd, back }],
  route:   [{ x, y, lat, lon, z, rel, ground, kind, pass, first?, last? }],
  passes:  [{ pts, wps, set, row?, nRows?, fv?, corr?, length, gs, bearing, photoStart, photoEnd, routeStart, routeEnd }],
  footprint: (photo) => [[lat, lon] × 4],
  stats:   { gsd, front, side, agl, clearance /* {min, max, mean, n} */, lowFront, lowSide,
             nPhotos, storageGB, maxRel, maxDist, maxAGL, maxZ },
  flight:  { speed, limitedBy, gsMin, gsMax, blurPx, triggerInt, vBlur, vInterval, totalDist, lineDist,
             flightTime, totalTime, batteries, splits: [{ x, y, z, lat, lon, index }], usable,
             endurance: { total, density, temperature, wind }, air, windAlt, gustAlt, reserve },
  accuracy:{ h: [lo, hi], v: [lo, hi], method },
  profile: [{ d, z, ground, line, x, y }] }
// or, on failure:
{ ok: false, error: 'human-readable reason' }
```

**Units:** metres, seconds, m/s, ratios in 0–1 (overlap), and GSD in m/px. The UI converts to cm.

**Heights:** `z` and `ground` are above mean sea level (DEM datum). `rel = z − zHome` is the height above take-off, which is what DJI and Litchi use.

---

## 8. Persistence, storage keys and file formats

| Key / file | Content |
|---|---|
| `localStorage['enviaerosurvey.state']` | The full UI state `S`, written on every change (debounced through `schedule`). |
| `localStorage['enviaerosurvey.theme']` | `light` or `dark`. A missing value means light. |
| `localStorage['enviaerosurvey.guard.*']` | Guard request logs, cool-downs and response cache. |
| `aerogrid.*` | Keys from the app's first name. Migrated once on load, then deleted. |
| `*.envi-aero-survey.json` | Saved project: `{app: 'EnviAeroSurvey', org, version: 1, state}`. Projects saved as `.aerogrid.json` or `.enviaerosurvey.json` still open, because loading checks the `app` field, not the extension. |

The storage keys keep the `enviaerosurvey` prefix on purpose. Renaming them would silently drop users' saved work unless a migration is added like the existing `aerogrid` one.

---

## 9. External services

| Service | Used for | Auth | Policy notes | Guarded by |
|---|---|---|---|---|
| Esri World Imagery / World Hillshade | basemap | none | attribution required; non-commercial | tile options + fail-over |
| OpenStreetMap tiles | Streets basemap | none | OSMF Tile Usage Policy; light use | tile options + fail-over |
| OpenTopoMap | Topo basemap | none | CC-BY-SA; light use | tile options + fail-over |
| Nominatim | place search | none | ≤ 1 req/s, no autocomplete, cache results | `guard` `search` |
| Open-Meteo | forecast | none | free for non-commercial use, CC-BY 4.0 | `guard` `forecast` |
| AWS Terrain Tiles | DEM | none | AWS Open Data | `guard` terrain budget |
| unpkg (Leaflet 1.9.4), Google Fonts | libraries, fonts | none | pinned version | — |

For commercial deployment, replace the tile URLs with a keyed provider (MapTiler, Mapbox, Esri with an ArcGIS key) and Open-Meteo with its commercial API. Keep every new call behind `guard.fetchJSON` or an equivalent budget.

---

## 10. Testing

### 10.1 Automated

`tests/planner.test.js` has 33 assertions:

- **Geodesy:** TM round-trip < 1e-9°, distance vs great circle, UTM easting vs the Snyder formula (±5 cm).
- **Camera geometry** (M3E at 100 m): GSD 2.67 cm, footprint 140.76 m, spacings, flat-terrain overlap equal to target, speed respects the capture interval.
- **Coverage:** every interior grid point lies within spacing/2 of a line.
- **Terrain:**
  - a ramp, under both terrain-follow and fixed altitude;
  - the protect-overlap option;
  - rejection of a fixed altitude below the terrain;
  - the grade limit over a cliff, without ever going below target;
  - a cross-slope compared with the analytic solution.
- **Missions:** double grid, corridor, fixed-wing wind ground speed, auto angle on an elongated area, multi-battery splitting.
- **Environment:** sun elevation (Bangkok solstice), ISA density, the wind power law.

`tests/guard.test.js` has 8 assertions: first request, cache hit, interval block, hourly cap, 429 → limited → cool-down, kill switch, terrain budget. `fetch` is mocked, and `localStorage` falls back to memory in Node.

**Rule for engine changes:** add an analytic test whenever you change geometry, overlap or timing. Synthetic DEMs (`elev: (lat, lon) => …`) make results exact and reproducible.

### 10.2 Manual checklist (before each release)

1. Load the demo. GSD ≈ 2.5 cm, the plan has no `danger` items, the profile renders, hovering the profile moves the map marker.
2. Switch to fixed altitude. The GSD range widens and relief/overlap warnings appear.
3. Draw a corridor (3 points, Enter). There are ≥ 2 lines and the buffer polygon is shown.
4. Type exact values in the front overlap, side overlap and direction boxes (try 397.5 → 37.5).
5. Toggle the theme. Every panel, the chart and the help drawer are readable in both themes.
6. Open help with `?`, search "litchi", use a "Show me" link, close with Esc.
7. Export each format. The KMZ opens as a ZIP containing `wpmz/template.kml` and `wpmz/waylines.wpml`, and the KML loads in Google Earth.
8. Check the mobile width (375 px): no horizontal scroll, and the legend does not cover the profile.
9. Check the console: no errors.

### 10.3 Field validation (recommended before relying on exports)

Import the KMZ into DJI Pilot 2 and run it in the simulator. Confirm photo capture on every line, the heights relative to take-off and the RTH height. Do the same for Litchi Mission Hub. Record the firmware versions in the change history.

---

## 11. Deployment and release

- **Hosting:** GitHub Pages, branch `main`, root folder. `.nojekyll` makes Pages serve files as they are (no build, no Actions minutes).
- **Release:** commit and push to `main`. Pages rebuilds in about 1 minute.
- **URL:** `https://chiyanon.github.io/envi-aero-survey/`. All asset paths are relative, so the app works under any sub-path.
- **Cache busting:** Pages sends short cache headers. If users report stale files after a change, add a version query to the script tags (`js/app.js?v=…`).
- **Costs:** none. Pages has soft limits of 100 GB bandwidth per month and a 1 GB site. Third-party data loads directly into users' browsers.

---

## 12. How to extend

### Add a camera

1. Add a record to `cameras` in `data.js` with the **true** focal length. Convert from a 35 mm equivalent with `f = f_eq · diag_sensor / 43.27`.
2. Add its id to the `cameras` list of each compatible platform.
3. Sanity-check it: GSD at 100 m should match the manufacturer's figure.

### Add a platform

Add a record to `platforms`. For DJI WPML, set `dji: {drone, sub, payload}` from the DJI Cloud API enum tables. Otherwise use `null`.

### Add a scene type

Add a record to `terrains` with overlaps, `alpha` (smooth 0.10 … rough 0.30+), the obstacle height, the `follow` policy and tips. Then update the scene table in the `scene` help topic.

### Add an exporter

1. Write `fn(R, meta)` in `exporters.js`. Use `missionWaypoints(R)` and `rel` for heights relative to take-off, or `z` for heights above sea level.
2. Add a button with `data-exp="<key>"` in `index.html` and a branch in the export handler in `app.js`.
3. Add a row to the `exports` help topic.

### Add a planner warning

Call `warn(level, msg)` in the warnings block of `plan()`. Keep messages actionable: say what is wrong and how to fix it.

### Add a help topic

Push `{id, group, title, html}` into `topics` in `help.js`. Link to it from anywhere with `data-help="<id>"`, and use `data-goto="<elementId>"` inside the topic for "Show me" buttons.

### Add an external service

1. Add a `CONFIG` entry in `guard.js`.
2. Call it only through `guard.fetchJSON(name, url, cacheKey)`, and show `err.message` from `GuardError` to the user.
3. Add a row to the `fairuse` help topic and to section 9 of this guide.

### Add a UI setting

1. Add a default to `DEF` in `app.js`.
2. Add the markup in `index.html`.
3. Bind it: for a plain number, add it to `numBind`; otherwise write a handler that calls `schedule()`.
4. Map it in `buildInput()` and read it in `plan()`.
5. Reflect it in `syncUI()`.

---

## 13. Coding conventions

- **Modules:** ES2020, no transpiler. Every module is an IIFE ending in `})(typeof window !== 'undefined' ? window : globalThis);` so it also runs in Node.
- **Units and coordinates:** metres and seconds internally. Coordinates are `[lat, lon]` arrays in the UI and the planner, and `[lon, lat]` only in KML and GeoJSON. Local points are `[x, y]` with x pointing east.
- **Purity:** keep `planner.js`, `geo.js` and `environment.js` free of DOM and network access.
- **Storage:** wrap every `localStorage` access in `try/catch`.
- **HTML safety:** escape any external string inserted as HTML (search results and forecast fields use `escHTML`).
- **Styling:** use CSS tokens, never raw colours, except for map overlay markers.
- **Style:** 2-space indentation, single quotes, semicolons, short section banners (`// ---- name`).

---

## 14. Known limitations and technical debt

| # | Area | Limitation | Suggested fix |
|---|---|---|---|
| 1 | DEM | Mostly ~30 m SRTM, ±5–16 m vertical; includes some canopy and buildings; zoom is global module state | Allow a user GeoTIFF DEM/DSM upload; per-call zoom |
| 2 | Datum | Heights are orthometric (EGM96). WPML `ellipsoidHeight` in `template.kml` carries the relative height as a placeholder | Add an EGM96/EGM2008 geoid grid and real ellipsoidal heights |
| 3 | DJI WPML | Not yet validated on hardware or in the Pilot 2 simulator; M4E enums unverified | Field test, then fix enums and action parameters |
| 4 | Overlap model | The neighbour line altitude uses ground + H and ignores grade-limit lifting; footprint polygons on the map are drawn flat (nominal AGL) | Use the neighbour pass's actual profile; draw terrain-projected footprints |
| 5 | Geometry | Polygons with holes are unsupported; self-intersecting polygons are not detected; tight corridor bends can make offsets self-intersect | Polygon clipping library (e.g. martinez or clipper); validate inputs |
| 6 | Transits | Within-row gaps in concave polygons are crossed without checking airspace or obstacles beyond the DEM | Route around exclusion zones; add no-fly polygons |
| 7 | Timing | Constant turn time; simplified fixed-wing turns and VTOL overhead; heuristic endurance model | Per-aircraft turn and acceleration models, calibrated with flight logs |
| 8 | Battery splits | Split points fall only on route vertices (often line ends in fixed mode) | Split mid-segment; export one mission per battery |
| 9 | Performance | `plan()` runs on the main thread | Move it to a Web Worker (it is already DOM-free) |
| 10 | UI code | `app.js` is a large single module with a mutable global state object | Split into modules (map, forms, render, files); a small store with subscriptions |
| 11 | Units and language | Metric and English only | Unit toggle; Thai translation (i18n table) |
| 12 | Capture modes | Nadir only; no oblique, façade or LiDAR | New mission types (section 15) |
| 13 | Tests | No automated UI or exporter tests | Playwright smoke tests; XML schema checks for WPML/KML |
| 14 | Guard | Client-side only | Acceptable (nothing billable); move to keyed providers if commercial |

---

## 15. Roadmap suggestions

**Short term**

- **Hardware validation:** DJI Pilot 2 import and Litchi field test (limitation 3).
- **Web Worker** planning (limitation 9).
- **Imports:** KMZ import (unzip with `DecompressionStream`), plus shapefile/GeoJSON with multiple polygons.
- **Thai translation:** add Thai language support; the help topics are already structured content.

**Medium term**

- **User DEM/DSM upload** (GeoTIFF via `geotiff.js`) for high-accuracy terrain-following, for example from a previous survey.
- **Geoid model** and true ellipsoidal heights; WGS84 height mode in WPML.
- **Oblique / smart-oblique planning:** gimbal pitch, 5-direction capture, façade coverage.
- **LiDAR planning:** point density, swath, strip overlap (DJI L2, other sensors).
- **Context layers:** airspace / no-fly zones and building heights from OSM, used for automatic obstacle height.

**Long term**

- **Quality loop:** import flight logs or EXIF positions to compare planned against achieved coverage and GSD.
- **Multi-mission planning:** divide large areas into battery-sized missions with separate take-off points.
- **Packaging:** an offline-capable PWA for field use (cached DEM tiles for a site).

---

## 16. Troubleshooting for developers

| Symptom | Cause / fix |
|---|---|
| Terrain always flat; "Terrain model unavailable" | Opened from `file://` (canvas CORS), offline, or the guard terrain budget is exhausted (reload) |
| Plan does not update | A JS error: check the console. `replan` swallows planner exceptions and shows "Planning error: …" in the warnings |
| Search or forecast refuses requests | Guard limit or cool-down. Check `UAV.guard.usage()`; clear `enviaerosurvey.guard.*` keys while developing |
| Help "?" inside a `<label>` focuses the input | Expected: the capture listener opens help first. Avoid putting `?` inside `<summary>` |
| Profile chart wrong colours after a theme change | `drawProfile()` reads CSS variables when it runs; make sure `applyTheme()` calls it |
| Node test warns about `localStorage` | Harmless (Node 26 experimental storage); run with `--no-warnings` |

---

## 17. References

- Karney, C. F. F. (2011). *Transverse Mercator with an accuracy of a few nanometers.* Journal of Geodesy 85, 475–485.
- Snyder, J. P. (1987). *Map Projections — A Working Manual.* USGS Professional Paper 1395.
- NOAA Global Monitoring Laboratory, *Solar Calculation Details* (solar position algorithm).
- ICAO Doc 7488, *Manual of the ICAO Standard Atmosphere.*
- Douglas, D. & Peucker, T. (1973). Algorithms for the reduction of the number of points required to represent a digitized line.
- DJI, *Cloud API — WPML (Waypoint Markup Language) specification*, version 1.0.2.
- Litchi, *Mission Hub CSV format.*
- Pix4D documentation, *Selecting the image acquisition plan type* and *Ground sampling distance*.
- ASPRS (2015/2023), *Positional Accuracy Standards for Digital Geospatial Data.*
- Mapzen / AWS Open Data, *Terrain Tiles* documentation.
- OSMF *Tile Usage Policy* and *Nominatim Usage Policy*; Open-Meteo *Terms of Use*.

---

## 18. Change history

| Date | Change |
|---|---|
| 2026-11-13 | Initial release (as "AeroGrid"): engine, UI, exports, tests |
| 2026-11-13 | Per-edge terrain overlap model (matches the analytic cross-slope solution) |
| 2026-11-13 | Exact-value inputs for overlap and flight direction; light (default) and dark themes; built-in help system |
| 2026-11-13 | Renamed to **EnviAeroSurvey: Mahidol University**; fair-use guardrails (`guard.js`); GitHub Pages deployment |
| 2026-11-13 | Repository and site renamed to **envi-aero-survey**; this developer guide added |
