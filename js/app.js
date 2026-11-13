/*
 * EnviAeroSurvey: Mahidol University — UI controller (Leaflet map, drawing/editing, live planning, rendering, export).
 */
(function () {
  'use strict';
  const { data, geo, env, dem, planner, exporters, guard } = window.UAV;
  const $ = (id) => document.getElementById(id);
  const fmt = (v, d = 0) => (v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pad2 = (n) => String(n).padStart(2, '0');
  const mmss = (s) => (s >= 5400 ? `${Math.floor(s / 3600)} h ${pad2(Math.round((s % 3600) / 60))}` : `${Math.round(s / 60)}`);
  const hhmm = (min) => `${pad2(Math.floor(min / 60) % 24)}:${pad2(Math.round(min % 60))}`;
  const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } } };

  // ------------------------------------------------------------------ state
  const today = new Date();
  const DEF = {
    name: 'Untitled survey', mission: 'area', polygon: [], line: [], corridorWidth: 60, home: null,
    platformId: 'dji_m3e', cameraId: 'm3e_wide',
    customCam: { sw: 23.5, sh: 15.6, iw: 6000, ih: 4000, f: 16, minInt: 1 }, customPlat: { speed: 12, endurance: 30, wind: 10, ceiling: 5000 },
    terrainId: 'open', obstacle: 0, altMode: 'follow', fixedRef: 'takeoff', protectOverlap: true,
    agl: 100, lock: 'gsd', front: 75, side: 65, angle: 0, autoAngle: true, shutterIdx: 4, maxBlur: 0.5, speed: 0,
    margin: 0, lineExt: null, maxGrade: null, followTol: 3, reserve: 20, takeoffSafe: 20, legalAGL: 120, maxRel: 500, vlos: 500,
    demUnc: 10, orient: 'across', georef: 'rtk_gcp',
    windSpd: 3, windGust: 5, windDir: 90, temp: 25,
    date: `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`, time: '10:00', utc: -today.getTimezoneOffset() / 60,
    basemap: 'sat', hillshade: false, showPhotos: true, showFoot: false, colorBy: 'gsd', view: null
  };
  // one-time migration from the app's former name (AeroGrid)
  try { if (!localStorage.getItem('enviaerosurvey.state') && localStorage.getItem('aerogrid.state')) { localStorage.setItem('enviaerosurvey.state', localStorage.getItem('aerogrid.state')); localStorage.removeItem('aerogrid.state'); } if (localStorage.getItem('aerogrid.theme')) { if (!localStorage.getItem('enviaerosurvey.theme')) localStorage.setItem('enviaerosurvey.theme', localStorage.getItem('aerogrid.theme')); localStorage.removeItem('aerogrid.theme'); } } catch (e) { /* ignore */ }
  let S = Object.assign({}, DEF, store.get('enviaerosurvey.state') || {});
  let R = null; // last plan result
  const save = () => { S.view = map ? { c: map.getCenter(), z: map.getZoom() } : S.view; store.set('enviaerosurvey.state', S); };

  const platform = () => { const p = Object.assign({}, data.platforms[S.platformId] || data.platforms.dji_m3e); if (p.custom) Object.assign(p, S.customPlat); return p; };
  const camera = () => { const c = Object.assign({}, data.cameras[S.cameraId] || data.cameras.m3e_wide); if (c.custom) Object.assign(c, S.customCam); return c; };
  const terrain = () => data.terrains[S.terrainId] || data.terrains.open;
  const gsdFromAgl = (h) => (h * (camera().sw / camera().iw)) / camera().f * 100; // cm
  const aglFromGsd = (g) => (g / 100) * camera().f / (camera().sw / camera().iw);

  // ------------------------------------------------------------------ map
  const map = L.map('map', { zoomControl: true, preferCanvas: false, doubleClickZoom: true }).setView(S.view ? S.view.c : [20, 10], S.view ? S.view.z : 3);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  // Tile requests are made by the visitor's browser (no keys, no billing). Load tiles only when
  // panning/zooming stops and keep a small buffer, to stay inside community tile-server fair use.
  const TILE_OPTS = { updateWhenIdle: true, updateWhenZooming: false, keepBuffer: 2, crossOrigin: false };
  const bases = {
    sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', Object.assign({ maxZoom: 20, maxNativeZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }, TILE_OPTS)),
    topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', Object.assign({ maxZoom: 20, maxNativeZoom: 17, attribution: '© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)' }, TILE_OPTS)),
    street: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', Object.assign({ maxZoom: 20, maxNativeZoom: 19, attribution: '© OpenStreetMap contributors' }, TILE_OPTS))
  };
  const hillshade = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}', Object.assign({ maxZoom: 20, maxNativeZoom: 16, opacity: 0.45, attribution: 'Hillshade © Esri' }, TILE_OPTS));
  // fail-over: if a tile server keeps refusing tiles (rate limit / outage), fall back to satellite
  Object.entries(bases).forEach(([k, layer]) => {
    let errs = [];
    layer.on('tileerror', () => {
      const now = Date.now(), cfg = guard.CONFIG.basemap;
      errs = errs.filter((t) => now - t < cfg.errorWindowMs); errs.push(now);
      if (errs.length >= cfg.errorThreshold && S.basemap === k) {
        errs = [];
        if (k !== 'sat') { setBase('sat'); toast(`The ${k === 'topo' ? 'Topo' : 'Streets'} map server is not responding or is limiting requests — switched to Satellite.`, 6000); }
        else toast('Satellite imagery is not loading — check your internet connection.', 6000);
      }
    });
  });
  let baseLayer = null;
  function setBase(k) { if (baseLayer) map.removeLayer(baseLayer); baseLayer = bases[k] || bases.sat; baseLayer.addTo(map); baseLayer.bringToBack(); S.basemap = k; segSet('baseSeg', k); }

  const canvasR = L.canvas({ padding: 0.3 });
  const areaLayer = L.layerGroup().addTo(map);
  const editLayer = L.layerGroup().addTo(map);
  const planLayer = L.layerGroup().addTo(map);
  const photoLayer = L.layerGroup().addTo(map);
  const footLayer = L.layerGroup().addTo(map);
  let homeMarker = null, hoverMarker = null;

  // ------------------------------------------------------------------ populate selects
  function fillPlatforms() {
    const sel = $('platform'); sel.innerHTML = '';
    const groups = {};
    Object.entries(data.platforms).forEach(([id, p]) => { const g = p.custom ? 'Custom' : p.type === 'fixedwing' ? 'Fixed-wing / VTOL' : 'Multirotor'; (groups[g] = groups[g] || []).push([id, p]); });
    ['Multirotor', 'Fixed-wing / VTOL', 'Custom'].forEach((g) => {
      if (!groups[g]) return;
      const og = document.createElement('optgroup'); og.label = g;
      groups[g].forEach(([id, p]) => { const o = new Option(p.name, id); og.appendChild(o); });
      sel.appendChild(og);
    });
    sel.value = S.platformId;
  }
  function fillCameras() {
    const sel = $('camera'), p = platform(); sel.innerHTML = '';
    p.cameras.forEach((id) => sel.appendChild(new Option(data.cameras[id].name, id)));
    if (!p.cameras.includes(S.cameraId)) S.cameraId = p.cameras[0];
    sel.value = S.cameraId;
  }
  function fillMisc() {
    const t = $('terrain'); Object.entries(data.terrains).forEach(([id, x]) => t.appendChild(new Option(x.name, id)));
    const sh = $('shutter'); data.shutters.forEach((x, i) => sh.appendChild(new Option(x.label, i)));
    const g = $('georef'); Object.entries(data.georef).forEach(([id, x]) => g.appendChild(new Option(x.name, id)));
  }

  function segSet(id, v) { document.querySelectorAll('#' + id + ' button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); }

  // ------------------------------------------------------------------ UI sync
  function syncUI() {
    $('projName').value = S.name;
    segSet('missionSeg', S.mission); segSet('altSeg', S.altMode);
    $('corrWidthField').hidden = S.mission !== 'corridor';
    $('corrWidth').value = S.corridorWidth; $('corrWidthVal').textContent = S.corridorWidth + ' m';
    $('btnDraw').textContent = (S.mission === 'corridor' ? (S.line.length ? '✎ Redraw centre-line' : '✎ Draw centre-line') : (S.polygon.length ? '✎ Redraw area' : '✎ Draw area'));
    $('platform').value = S.platformId; fillCameras();
    $('terrain').value = S.terrainId;
    $('fixedOpts').hidden = S.altMode !== 'fixed';
    $('fixedRef').value = S.fixedRef; $('protectOverlap').checked = S.protectOverlap;
    const ids = { obstacle: 'obstacle', demUnc: 'demUnc', date: 'date', time: 'time', utc: 'utc', windSpd: 'windSpd', windGust: 'windGust', windDir: 'windDir', temp: 'temp', maxBlur: 'maxBlur', margin: 'margin', followTol: 'followTol', reserve: 'reserve', takeoffSafe: 'takeoffSafe', legalAGL: 'legalAGL', maxRel: 'maxRel', vlos: 'vlos' };
    Object.entries(ids).forEach(([k, id]) => { $(id).value = S[k]; });
    $('speed').value = S.speed || ''; $('lineExt').value = S.lineExt == null ? '' : S.lineExt; $('maxGrade').value = S.maxGrade == null ? '' : S.maxGrade;
    $('orient').value = S.orient; $('georef').value = S.georef; $('shutter').value = S.shutterIdx;
    $('front').value = S.front; $('side').value = S.side; $('frontNum').value = S.front; $('sideNum').value = S.side;
    $('autoAngle').checked = S.autoAngle; $('angleField').hidden = S.mission === 'corridor';
    $('hillshade').checked = S.hillshade; $('showPhotos').checked = S.showPhotos; $('showFoot').checked = S.showFoot; $('colorBy').value = S.colorBy;
    const cc = camera(); document.querySelectorAll('[data-cc]').forEach((el) => { el.value = cc[el.dataset.cc]; });
    const pp = platform(); document.querySelectorAll('[data-cp]').forEach((el) => { el.value = pp[el.dataset.cp]; });
    $('customCam').hidden = !data.cameras[S.cameraId].custom; $('customPlat').hidden = !data.platforms[S.platformId].custom;
    syncAltitude(); renderCamSpec(); renderTips(); renderSun();
  }
  function syncAltitude() {
    $('agl').value = Math.round(S.agl * 10) / 10;
    $('gsd').value = gsdFromAgl(S.agl).toFixed(2);
    $('aglRange').value = S.agl;
    const autoA = S.autoAngle && R && R.ok && R.design.angle != null ? R.design.angle : null;
    const shownA = S.autoAngle ? autoA : S.angle;
    $('angleVal').textContent = S.autoAngle ? 'auto' : 'manual';
    $('angle').value = shownA == null ? 0 : Math.round(shownA);
    if (document.activeElement !== $('angleNum')) $('angleNum').value = shownA == null ? '' : Math.round(shownA * 10) / 10;
    $('angleNum').classList.toggle('is-auto', !!S.autoAngle);
  }
  function renderCamSpec() {
    const c = camera(), p = platform();
    const mp = (c.iw * c.ih) / 1e6;
    $('camSpec').innerHTML = [
      ['Sensor', `${c.sw}×${c.sh} mm`], ['Resolution', `${fmt(mp, 1)} MP`], ['Focal', `${c.f} mm`],
      ['Pixel', `${fmt((c.sw / c.iw) * 1000, 2)} µm`], ['Shutter', c.shutter], ['Interval', `${c.minInt} s`],
      ['Type', p.type === 'fixedwing' ? 'Fixed-wing' : 'Multirotor'], ['Endurance', `${p.endurance} min`], ['Wind max', `${p.wind} m/s`]
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  }
  function renderTips() { $('terrainTips').innerHTML = terrain().tips.map((t) => `<li>${t}</li>`).join(''); }

  // ------------------------------------------------------------------ sun
  function siteLatLon() {
    const g = S.mission === 'corridor' ? S.line : S.polygon;
    if (g.length) return [g.reduce((s, p) => s + p[0], 0) / g.length, g.reduce((s, p) => s + p[1], 0) / g.length];
    const c = map.getCenter(); return [c.lat, c.lng];
  }
  let sunCache = null;
  function renderSun() {
    const [lat, lon] = siteLatLon();
    if (!S.date || !S.time) { $('sunInfo').textContent = ''; return; }
    const [hh, mm] = S.time.split(':').map(Number);
    const instant = new Date(Date.parse(S.date + 'T00:00:00Z') + ((hh * 60 + mm) - S.utc * 60) * 60000);
    const s = env.sunPosition(instant, lat, lon);
    const day = env.sunDay(S.date, S.utc, lat, lon, 30);
    sunCache = { s, day };
    const shadow = s.elevation > 0.5 ? 1 / Math.tan((s.elevation * Math.PI) / 180) : Infinity;
    const pct = (m) => (100 * m) / 1440;
    const bar = `<div class="sunbar">${day.daylight ? `<div class="day" style="left:${pct(day.daylight[0])}%;width:${pct(day.daylight[1] - day.daylight[0])}%"></div>` : ''}${day.window ? `<div class="good" style="left:${pct(day.window[0])}%;width:${pct(day.window[1] - day.window[0])}%"></div>` : ''}<div class="now" style="left:${pct(hh * 60 + mm)}%"></div></div>`;
    $('sunInfo').innerHTML = `Sun <b>${fmt(s.elevation, 1)}°</b> elevation, azimuth <b>${fmt(s.azimuth, 0)}°</b> · shadows <b>${isFinite(shadow) ? fmt(shadow, 1) + '×' : '—'}</b> object height${bar}` +
      `Daylight ${day.daylight ? hhmm(day.daylight[0]) + '–' + hhmm(day.daylight[1]) : 'none'} · ` + (day.window ? `best light (sun ≥ 30°) <b>${hhmm(day.window[0])}–${hhmm(day.window[1])}</b>` : `<b>sun never reaches 30°</b> (max ${fmt(day.maxElev, 0)}°)`) + (weatherNote ? `<br>${weatherNote}` : '');
  }

  function sunWarnings() {
    const out = [];
    if (!sunCache) return out;
    const e = sunCache.s.elevation, T = S.terrainId;
    if (e < 0) out.push({ level: 'danger', msg: `Sun is below the horizon at ${S.time} — imagery not possible (and night operations need approval).` });
    else if (e < 15) out.push({ level: 'caution', msg: `Low sun (${fmt(e, 0)}°): long shadows and dark imagery. Plan between ${sunCache.day.window ? hhmm(sunCache.day.window[0]) + ' and ' + hhmm(sunCache.day.window[1]) : 'midday'}.` });
    else if (e < 25 && T !== 'snow') out.push({ level: 'caution', msg: `Sun elevation ${fmt(e, 0)}° — shadows ${fmt(1 / Math.tan((e * Math.PI) / 180), 1)}× object height reduce matching in shaded areas.` });
    if (T === 'coastal' && e > 50) out.push({ level: 'caution', msg: `High sun (${fmt(e, 0)}°) over water causes sun-glint hotspots — prefer 25–45° elevation.` });
    if (/RE|NIR/.test(camera().bands) && e < 40) out.push({ level: 'caution', msg: 'Multispectral: sun below 40° increases BRDF effects — fly closer to solar noon.' });
    return out;
  }

  // ------------------------------------------------------------------ geometry editing
  let drawBackup = null;
  let drawing = false, drawPts = [], settingHome = false, tempLayer = L.layerGroup().addTo(map);
  const vtxIcon = (first) => L.divIcon({ className: '', html: `<div class="vtx${first ? ' first' : ''}"></div>`, iconSize: [12, 12], iconAnchor: [6, 6] });
  const midIcon = L.divIcon({ className: '', html: '<div class="mid"></div>', iconSize: [9, 9], iconAnchor: [4.5, 4.5] });

  function geom() { return S.mission === 'corridor' ? S.line : S.polygon; }
  function setGeom(g) { if (S.mission === 'corridor') S.line = g; else S.polygon = g; }

  function startDraw() {
    cancelHome();
    drawBackup = geom().slice(); drawing = true; drawPts = []; setGeom([]); clearPlan(); renderArea();
    $('btnDraw').classList.add('active'); $('btnDraw').textContent = 'Finish (Enter)';
    map.getContainer().style.cursor = 'crosshair'; map.doubleClickZoom.disable();
    $('drawHint').textContent = S.mission === 'corridor' ? 'Click to add centre-line points. Double-click or press Enter to finish, Esc to cancel.' : 'Click to add corners. Click the first point or press Enter to finish, Esc to cancel.';
    $('emptyState').hidden = true;
  }
  function finishDraw() {
    if (!drawing) return;
    const min = S.mission === 'corridor' ? 2 : 3;
    drawing = false; tempLayer.clearLayers();
    map.getContainer().style.cursor = ''; map.doubleClickZoom.enable();
    $('btnDraw').classList.remove('active');
    $('drawHint').textContent = 'Drag vertices to edit, drag the small midpoints to add a vertex, right-click a vertex to delete it.';
    if (drawPts.length >= min) {
      setGeom(drawPts.slice());
      if (!S.home || !homeNear()) placeDefaultHome();
    } else if (drawBackup && drawBackup.length) setGeom(drawBackup);
    drawBackup = null; drawPts = []; syncUI(); renderArea(); schedule(0);
  }
  function cancelDraw() { const restore = drawing && drawBackup && drawBackup.length; if (restore) setGeom(drawBackup); drawBackup = null; drawing = false; drawPts = []; tempLayer.clearLayers(); map.getContainer().style.cursor = ''; map.doubleClickZoom.enable(); $('btnDraw').classList.remove('active'); syncUI(); renderArea(); if (restore) schedule(0); }
  function renderTemp() {
    tempLayer.clearLayers();
    if (!drawPts.length) return;
    const isC = S.mission === 'corridor';
    (isC ? L.polyline(drawPts, { color: '#fbbf24', weight: 2.5, dashArray: '6 5' }) : L.polygon(drawPts, { color: '#fbbf24', weight: 2, dashArray: '6 5', fillOpacity: 0.08 })).addTo(tempLayer);
    drawPts.forEach((p, i) => {
      const m = L.marker(p, { icon: vtxIcon(i === 0), keyboard: false }).addTo(tempLayer);
      if (i === 0 && !isC) m.on('click', (e) => { L.DomEvent.stop(e); if (drawPts.length >= 3) finishDraw(); });
      if (i === drawPts.length - 1 && isC) m.on('click', (e) => { L.DomEvent.stop(e); if (drawPts.length >= 2) finishDraw(); });
    });
  }

  function homeNear() {
    if (!S.home) return false;
    const g = geom(); if (!g.length) return false;
    return g.some((p) => geo.haversine(p[0], p[1], S.home[0], S.home[1]) < 3000);
  }
  function placeDefaultHome() {
    const g = geom();
    if (S.mission === 'corridor') { S.home = g[0].slice(); return; }
    // nearest vertex pulled 15 % toward the centroid → inside the area, near a corner
    const c = [g.reduce((s, p) => s + p[0], 0) / g.length, g.reduce((s, p) => s + p[1], 0) / g.length];
    const v = g[0];
    S.home = [v[0] + (c[0] - v[0]) * 0.15, v[1] + (c[1] - v[1]) * 0.15];
  }

  function renderArea() {
    areaLayer.clearLayers(); editLayer.clearLayers();
    const g = geom();
    if (g.length >= 2) {
      if (S.mission === 'corridor') {
        L.polyline(g, { color: '#fbbf24', weight: 2, dashArray: '2 6', interactive: false }).addTo(areaLayer);
        if (R && R.ok) L.polygon(R.area.polygon, { color: '#fbbf24', weight: 1.5, fillOpacity: 0.06, interactive: false }).addTo(areaLayer);
      } else L.polygon(g, { color: '#fbbf24', weight: 2, fillColor: '#fbbf24', fillOpacity: 0.07, interactive: false }).addTo(areaLayer);
    }
    if (!drawing && g.length) {
      g.forEach((p, i) => {
        const m = L.marker(p, { icon: vtxIcon(false), draggable: true, keyboard: false }).addTo(editLayer);
        m.on('drag', (e) => { g[i] = [e.latlng.lat, e.latlng.lng]; redrawShapeOnly(); });
        m.on('dragend', () => { setGeom(g); renderArea(); schedule(0); });
        m.on('contextmenu', () => { const min = S.mission === 'corridor' ? 2 : 3; if (g.length > min) { g.splice(i, 1); setGeom(g); renderArea(); schedule(0); } else toast(`A ${S.mission === 'corridor' ? 'line' : 'polygon'} needs at least ${min} points.`); });
      });
      const n = g.length, closed = S.mission !== 'corridor';
      for (let i = 0; i < (closed ? n : n - 1); i++) {
        const a = g[i], b = g[(i + 1) % n];
        const mm = L.marker([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], { icon: midIcon, draggable: true, keyboard: false }).addTo(editLayer);
        mm.on('dragstart', () => { g.splice(i + 1, 0, [mm.getLatLng().lat, mm.getLatLng().lng]); });
        mm.on('drag', (e) => { g[i + 1] = [e.latlng.lat, e.latlng.lng]; redrawShapeOnly(); });
        mm.on('dragend', () => { setGeom(g); renderArea(); schedule(0); });
      }
    }
    renderHome();
  }
  function redrawShapeOnly() {
    areaLayer.clearLayers();
    const g = geom();
    if (S.mission === 'corridor') L.polyline(g, { color: '#fbbf24', weight: 2, dashArray: '2 6' }).addTo(areaLayer);
    else L.polygon(g, { color: '#fbbf24', weight: 2, fillOpacity: 0.07 }).addTo(areaLayer);
  }
  function renderHome() {
    if (homeMarker) { map.removeLayer(homeMarker); homeMarker = null; }
    if (!S.home || !geom().length) { $('homeInfo').textContent = '—'; return; }
    homeMarker = L.marker(S.home, { draggable: true, icon: L.divIcon({ className: '', html: '<div class="home-ic">H</div>', iconSize: [26, 26], iconAnchor: [13, 13] }), zIndexOffset: 1000 }).addTo(map);
    homeMarker.bindTooltip('Take-off / home point — drag to move', { className: 'tt', direction: 'top', offset: [0, -12] });
    homeMarker.on('dragend', (e) => { S.home = [e.target.getLatLng().lat, e.target.getLatLng().lng]; schedule(0); });
    const z = dem.sample(S.home[0], S.home[1]);
    $('homeInfo').textContent = `${S.home[0].toFixed(5)}, ${S.home[1].toFixed(5)}${isFinite(z) ? ` · ${fmt(z, 0)} m ASL` : ''}`;
  }
  function cancelHome() { settingHome = false; $('btnHome').classList.remove('primary'); map.getContainer().style.cursor = ''; }

  map.on('click', (e) => {
    if (drawing) { drawPts.push([e.latlng.lat, e.latlng.lng]); renderTemp(); return; }
    if (settingHome) { S.home = [e.latlng.lat, e.latlng.lng]; cancelHome(); renderHome(); schedule(0); }
  });
  map.on('dblclick', (e) => { if (drawing && S.mission === 'corridor') { L.DomEvent.stop(e); if (drawPts.length > 2) drawPts.pop(); finishDraw(); } });
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    if (drawing && e.key === 'Enter') finishDraw();
    if (drawing && e.key === 'Escape') cancelDraw();
    if (drawing && (e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey)))) { drawPts.pop(); renderTemp(); e.preventDefault(); }
    if (settingHome && e.key === 'Escape') cancelHome();
  });
  map.on('moveend', () => { save(); if (!geom().length) renderSun(); });

  // ------------------------------------------------------------------ planning pipeline
  let timer = null, seq = 0;
  function schedule(ms = 280) { clearTimeout(timer); timer = setTimeout(replan, ms); save(); }

  function buildInput() {
    const sh = data.shutters[S.shutterIdx] || data.shutters[4];
    return {
      mission: S.mission, polygon: S.polygon, line: S.line, corridorWidth: S.corridorWidth, home: S.home,
      platform: platform(), camera: camera(), terrain: terrain(),
      altMode: S.altMode, fixedRef: S.fixedRef, protectOverlap: S.protectOverlap,
      agl: S.agl, front: S.front, side: S.side, angle: S.angle, autoAngle: S.autoAngle, orientation: S.orient,
      speed: S.speed, shutter: sh.v, shutterLabel: sh.label, maxBlur: S.maxBlur,
      margin: S.margin, lineExtension: S.lineExt, maxGrade: S.maxGrade, followTolerance: S.followTol,
      obstacle: S.obstacle, demUncertainty: S.demUnc, reserve: S.reserve, takeoffSafeHeight: S.takeoffSafe,
      legalAGL: S.legalAGL, maxRelAlt: S.maxRel, vlos: S.vlos, georef: S.georef,
      wind: { speed: S.windSpd, gust: S.windGust, dir: S.windDir }, temperature: S.temp,
      elev: (lat, lon) => dem.sample(lat, lon)
    };
  }

  async function replan() {
    const my = ++seq;
    const g = geom();
    renderSun();
    if (g.length < (S.mission === 'corridor' ? 2 : 3) || drawing) { clearPlan(); return; }
    $('emptyState').hidden = true;
    // terrain tiles: area + home + buffer
    const pts = g.concat(S.home ? [S.home] : []);
    let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
    pts.forEach((p) => { s = Math.min(s, p[0]); n = Math.max(n, p[0]); w = Math.min(w, p[1]); e = Math.max(e, p[1]); });
    const bufM = Math.max(S.agl * 1.2, S.mission === 'corridor' ? S.corridorWidth : 0) + S.margin + 150;
    const dLat = bufM / 111320, dLon = bufM / (111320 * Math.cos((((s + n) / 2) * Math.PI) / 180));
    busy(true, 'Loading terrain model…');
    let info = null;
    try { info = await dem.ensure({ south: s - dLat, north: n + dLat, west: w - dLon, east: e + dLon }); } catch (err) { info = null; }
    if (my !== seq) return;
    busy(true, 'Computing flight plan…');
    await new Promise((r) => setTimeout(r, 10));
    let res;
    try { res = planner.plan(buildInput()); } catch (err) { console.error(err); res = { ok: false, error: 'Planning error: ' + err.message }; }
    if (my !== seq) return;
    busy(false);
    R = res;
    const demEl = $('demStatus');
    if (info && info.failed < info.tiles) { demEl.className = 'dem ok'; demEl.textContent = `Terrain model: AWS Terrain Tiles z${info.zoom} · ~${fmt(info.resolution, 1)} m/px grid · ${info.tiles - info.failed}/${info.tiles} tiles`; }
    else { demEl.className = 'dem'; demEl.textContent = 'Terrain model unavailable — flat ground assumed. Check network access to s3.amazonaws.com.'; }
    if (guard.usage().find((u) => u.svc === 'terrain').exhausted) { demEl.className = 'dem'; demEl.textContent = 'Terrain tile budget for this session reached (fair-use guard). Reload the page to continue with fresh terrain data.'; }
    render();
  }

  function clearPlan() {
    R = null; planLayer.clearLayers(); photoLayer.clearLayers(); footLayer.clearLayers();
    $('kpis').innerHTML = ''; $('details').innerHTML = '';
    $('warnings').innerHTML = `<li class="info">${geom().length ? 'Finish the geometry to compute a plan.' : 'Draw a survey area to start.'}</li>`;
    $('statusBadge').className = 'status'; $('statusBadge').textContent = 'No plan';
    $('legend').hidden = true; drawProfile();
    $('emptyState').hidden = !!geom().length || drawing;
    renderArea();
  }

  // ------------------------------------------------------------------ rendering
  const ramp = ['#2563eb', '#06b6d4', '#22c55e', '#eab308', '#f97316', '#ef4444'];
  function rampColor(t) {
    t = Math.max(0, Math.min(1, t)); const x = t * (ramp.length - 1), i = Math.min(ramp.length - 2, Math.floor(x)), f = x - i;
    const h = (c) => [1, 3, 5].map((k) => parseInt(c.substr(k, 2), 16));
    const a = h(ramp[i]), b = h(ramp[i + 1]);
    return '#' + a.map((v, k) => Math.round(v + (b[k] - v) * f).toString(16).padStart(2, '0')).join('');
  }
  const CAT = { good: '#34d399', ok: '#facc15', low: '#fb923c', bad: '#ef4444' };
  function photoColor(p, metric, st) {
    if (metric === 'front' || metric === 'side') {
      const v = p[metric], t = (metric === 'front' ? S.front : S.side) / 100;
      if (v == null) return '#94a3b8';
      return v >= t - 0.01 ? CAT.good : v >= t - 0.05 ? CAT.ok : v >= t - 0.15 ? CAT.low : CAT.bad;
    }
    if (metric === 'clearance') { const c = p.clearance - S.demUnc; return c >= 30 ? CAT.good : c >= 15 ? CAT.ok : c >= 0 ? CAT.low : CAT.bad; }
    const s = st[metric]; if (!s || s.max - s.min < 1e-9) return rampColor(0.4);
    return rampColor((p[metric] - s.min) / (s.max - s.min));
  }

  function render() {
    planLayer.clearLayers(); photoLayer.clearLayers(); footLayer.clearLayers();
    renderArea();
    if (!R) return;
    if (!R.ok) {
      $('kpis').innerHTML = ''; $('details').innerHTML = '';
      $('warnings').innerHTML = `<li class="danger">${R.error}</li>`;
      $('statusBadge').className = 'status danger'; $('statusBadge').textContent = 'Not flyable';
      $('legend').hidden = true; drawProfile(); return;
    }
    syncAltitude();
    // route
    let cur = null, curKind = null;
    const flush = () => { if (cur && cur.length > 1) L.polyline(cur, curKind === 'line' ? { color: '#38bdf8', weight: 2.6, opacity: 0.95, renderer: canvasR } : { color: '#e2e8f0', weight: 1.6, opacity: 0.7, dashArray: '5 6', renderer: canvasR }).addTo(planLayer); };
    for (let i = 1; i < R.route.length; i++) {
      const a = R.route[i - 1], b = R.route[i];
      const k = b.kind === 'line' && !b.first && a.kind === 'line' && a.pass === b.pass ? 'line' : 'transit';
      if (k !== curKind) { flush(); cur = [[a.lat, a.lon]]; curKind = k; }
      cur.push([b.lat, b.lon]);
    }
    flush();
    // start / end
    const lines = R.route.filter((r) => r.kind === 'line');
    if (lines.length) {
      L.marker([lines[0].lat, lines[0].lon], { icon: L.divIcon({ className: '', html: '<div class="se-ic s">S</div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false }).addTo(planLayer);
      const l = lines[lines.length - 1];
      L.marker([l.lat, l.lon], { icon: L.divIcon({ className: '', html: '<div class="se-ic e">E</div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false }).addTo(planLayer);
    }
    // battery swaps
    R.flight.splits.forEach((s, i) => {
      L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html: `<div class="bat-ic">${i + 2}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }) })
        .bindTooltip(`Battery ${i + 1} returns here · battery ${i + 2} resumes`, { className: 'tt', direction: 'top' }).addTo(planLayer);
    });
    // photos
    const st = R.stats;
    if (S.showPhotos) {
      const stp = { gsd: st.gsd, agl: st.agl };
      R.photos.forEach((p, i) => {
        L.circleMarker([p.lat, p.lon], { radius: 3.2, weight: 0.6, color: '#0b111b', fillColor: photoColor(p, S.colorBy, stp), fillOpacity: 0.95, renderer: canvasR })
          .bindTooltip(() => `<b>Photo ${i + 1}</b> · line ${p.pass + 1}<br>GSD ${fmt(p.gsd * 100, 2)} cm/px · AGL ${fmt(p.agl, 1)} m<br>Overlap F ${fmt(p.front * 100, 0)} %${p.side != null ? ` · S ${fmt(p.side * 100, 0)} %` : ''}<br>Ground ${fmt(p.ground, 1)} m · Alt ${fmt(p.z, 1)} m ASL<br>Clearance ${fmt(p.clearance, 0)} m`, { className: 'tt', sticky: true })
          .addTo(photoLayer);
      });
    }
    if (S.showFoot) {
      const step = Math.max(1, Math.ceil(R.photos.length / 1500));
      R.photos.forEach((p, i) => { if (i % step === 0) L.polygon(R.footprint(p), { color: '#38bdf8', weight: 0.6, opacity: 0.35, fillOpacity: 0.02, interactive: false, renderer: canvasR }).addTo(footLayer); });
      if (step > 1) toast(`Showing every ${step}${step === 2 ? 'nd' : step === 3 ? 'rd' : 'th'} footprint for performance.`);
    }
    renderLegend();
    renderResults();
    drawProfile();
  }

  function renderLegend() {
    const L2 = $('legend');
    if (!S.showPhotos || !R || !R.ok) { L2.hidden = true; return; }
    L2.hidden = false;
    const m = S.colorBy, st = R.stats;
    if (m === 'front' || m === 'side') {
      const t = m === 'front' ? S.front : S.side;
      L2.innerHTML = `<b>${m === 'front' ? 'Front' : 'Side'} overlap (target ${t} %)</b>` + [[CAT.good, `≥ ${t - 1} %`], [CAT.ok, `${t - 5}–${t - 1} %`], [CAT.low, `${t - 15}–${t - 5} %`], [CAT.bad, `< ${t - 15} %`]].map(([c, l]) => `<div><i class="sw" style="background:${c};height:8px;width:10px"></i> ${l}</div>`).join('');
    } else if (m === 'clearance') {
      L2.innerHTML = '<b>Clearance minus DEM uncertainty</b>' + [[CAT.good, '≥ 30 m'], [CAT.ok, '15–30 m'], [CAT.low, '0–15 m'], [CAT.bad, '< 0 m']].map(([c, l]) => `<div><i class="sw" style="background:${c};height:8px;width:10px"></i> ${l}</div>`).join('');
    } else {
      const s = st[m], k = m === 'gsd' ? 100 : 1, u = m === 'gsd' ? 'cm/px' : 'm';
      L2.innerHTML = `<b>${m === 'gsd' ? 'Ground sampling distance' : 'Height above ground'}</b><div class="bar" style="background:linear-gradient(90deg,${ramp.join(',')})"></div><div class="ends"><span>${fmt(s.min * k, 2)}</span><span>${fmt(s.max * k, 2)} ${u}</span></div>`;
    }
  }

  function renderResults() {
    const P = platform(), C = camera(), st = R.stats, fl = R.flight, d = R.design, t = R.terrain;
    const ha = R.area.m2 / 10000;
    const kp = (label, val, unit, sub, hl) => `<div class="kpi${hl ? ' hl' : ''}"><span>${label}</span><b>${val}</b><small>${unit || ''}</small>${sub ? `<em>${sub}</em>` : ''}</div>`;
    $('kpis').innerHTML = [
      kp('GSD', fmt(st.gsd.mean * 100, 2), 'cm/px', `range ${fmt(st.gsd.min * 100, 2)}–${fmt(st.gsd.max * 100, 2)}`, true),
      kp('Flight time', mmss(fl.totalTime), 'min', fl.batteries > 1 ? `incl. ${fl.splits.length} battery swap${fl.splits.length > 1 ? 's' : ''}` : `${fmt((fl.totalTime / 60 / (fl.usable / 60)) * 100, 0)} % of usable battery`, true),
      kp('Batteries', fl.batteries, '', `${fmt(fl.usable / 60, 1)} min usable each`),
      kp('Photos', fmt(st.nPhotos), '', `${fmt(st.storageGB, 1)} GB`),
      kp(S.mission === 'corridor' ? 'Corridor area' : 'Area', ha >= 100 ? fmt(ha / 100, 2) : fmt(ha, 2), ha >= 100 ? 'km²' : 'ha', S.mission === 'corridor' ? `${d.corridorLines} lines` : `${d.nLinesA + d.nLinesB} lines`),
      kp('Height AGL', fmt(d.H, 0), 'm', d.followOn ? 'terrain-following' : `fixed ${fmt(d.zFixed, 0)} m ASL`),
      kp('Speed', fmt(fl.speed, 1), 'm/s', P.type === 'fixedwing' ? `ground ${fmt(fl.gsMin, 1)}–${fmt(fl.gsMax, 1)} m/s` : `limited by ${fl.limitedBy}`),
      kp('Min overlap', `${fmt(st.front.min * 100, 0)}/${st.side ? fmt(st.side.min * 100, 0) : '—'}`, '%', `front/side · target ${S.front}/${S.side}`)
    ].join('');

    // warnings
    const ws = sunWarnings().concat(R.warnings);
    const order = { danger: 0, caution: 1, info: 2 };
    ws.sort((a, b) => order[a.level] - order[b.level]);
    if (!ws.some((w) => w.level !== 'info')) ws.unshift({ level: 'ok', msg: 'All safety and quality checks passed.' });
    $('warnings').innerHTML = ws.map((w) => `<li class="${w.level}">${w.msg}</li>`).join('');
    const worst = ws.some((w) => w.level === 'danger') ? 'danger' : ws.some((w) => w.level === 'caution') ? 'caution' : 'ok';
    $('statusBadge').className = 'status ' + worst;
    $('statusBadge').textContent = { danger: 'Not flyable', caution: 'Review warnings', ok: 'Ready' }[worst];

    const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`, sec = (k) => `<tr class="sec"><td colspan="2">${k}</td></tr>`;
    const ef = fl.endurance;
    $('details').innerHTML = [
      sec('Image geometry'),
      row('Footprint (across × along)', `${fmt(d.footX, 0)} × ${fmt(d.footY, 0)} m`),
      row('Line spacing', `${fmt(d.lineSpacing, 1)} m`),
      row('Photo spacing (trigger distance)', `${fmt(d.photoSpacing, 1)} m`),
      row('Trigger interval (fastest)', `${fmt(fl.triggerInt, 2)} s (cam ≥ ${C.minInt} s)`),
      row('Motion blur', `${fmt(fl.blurPx, 2)} px @ ${data.shutters[S.shutterIdx].label}`),
      d.angle != null ? row('Flight direction', `${fmt(d.angle, 1)}° / ${fmt((d.angle + 180) % 360, 1)}°`) : '',
      sec('Terrain'),
      row('Ground elevation', `${fmt(t.zmin, 0)} – ${fmt(t.zmax, 0)} m ASL`),
      row('Relief / mean slope', `${fmt(t.relief, 0)} m / ${fmt(t.slopeMean, 1)}° (max ${fmt(t.slopeMax, 0)}°)`),
      row('Take-off elevation', `${fmt(t.zHome, 1)} m ASL`),
      !d.followOn ? row('AGL range (fixed altitude)', `${fmt(d.minAGLfixed, 0)} – ${fmt(d.maxAGLfixed, 0)} m`) : '',
      row('Min clearance (obstacles ' + S.obstacle + ' m)', `${fmt(st.clearance.min, 0)} m`),
      sec('Flight'),
      row('Total distance', `${fmt(fl.totalDist / 1000, 2)} km (imaging ${fmt(fl.lineDist / 1000, 2)} km)`),
      row('Max above take-off', `${fmt(st.maxRel, 0)} m`),
      row('Max height above ground', `${fmt(st.maxAGL, 0)} m`),
      row('Max distance from take-off', `${fmt(st.maxDist, 0)} m`),
      row('Wind at flight height', `${fmt(fl.windAlt, 1)} m/s (gust ${fmt(fl.gustAlt, 1)})`),
      row('Density altitude', `${fmt(fl.air.densityAltitude, 0)} m (σ ${fmt(fl.air.sigma, 3)})`),
      row('Endurance derating', `${fmt(ef.total * 100, 0)} % (ρ ${fmt(ef.density * 100, 0)} · T ${fmt(ef.temperature * 100, 0)} · wind ${fmt(ef.wind * 100, 0)})`),
      row('Usable per battery', `${fmt(fl.usable / 60, 1)} min (reserve ${S.reserve} %)`),
      row('Waypoints', `${R.route.filter((r) => r.kind === 'line' || r.kind === 'transit').length}`),
      sec('Expected accuracy (rule of thumb)'),
      row('Method', R.accuracy.method),
      row('Horizontal (RMSE)', `${fmt(R.accuracy.h[0] * 100, 1)} – ${fmt(R.accuracy.h[1] * 100, 1)} cm`),
      row('Vertical (RMSE)', `${fmt(R.accuracy.v[0] * 100, 1)} – ${fmt(R.accuracy.v[1] * 100, 1)} cm`),
      row('Mean front / side overlap', `${fmt(st.front.mean * 100, 1)} / ${st.side ? fmt(st.side.mean * 100, 1) : '—'} %`)
    ].join('');
  }

  // ------------------------------------------------------------------ theme (light default)
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
  const ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  function currentTheme() { return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'; }
  function applyTheme(t) {
    if (t === 'dark') document.documentElement.dataset.theme = 'dark'; else delete document.documentElement.dataset.theme;
    try { localStorage.setItem('enviaerosurvey.theme', t); } catch (e) { /* ignore */ }
    $('btnTheme').innerHTML = t === 'dark' ? ICON_SUN : ICON_MOON;
    $('btnTheme').title = t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    drawProfile();
  }
  $('btnTheme').onclick = () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  $('btnHelp').onclick = () => window.UAV.help.open();

  // ------------------------------------------------------------------ profile chart
  const cvs = $('profileCanvas');
  let chartGeom = null;
  function drawProfile(hoverIdx) {
    const ctx = cvs.getContext('2d');
    const dpr = window.devicePixelRatio || 1, W = cvs.clientWidth, H = cvs.clientHeight;
    if (!W || !H) return;
    if (cvs.width !== Math.round(W * dpr) || cvs.height !== Math.round(H * dpr)) { cvs.width = Math.round(W * dpr); cvs.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    if (!R || !R.ok || !R.profile.length) { ctx.fillStyle = css('--chart-text'); ctx.font = '12px Inter, sans-serif'; ctx.fillText('The terrain and altitude profile along the route appears here.', 14, H / 2); chartGeom = null; return; }
    const pr = R.profile, ob = S.obstacle;
    let zlo = Infinity, zhi = -Infinity;
    pr.forEach((p) => { zlo = Math.min(zlo, p.ground); zhi = Math.max(zhi, p.z, p.ground + ob); });
    const padY = (zhi - zlo) * 0.08 + 5; zlo -= padY; zhi += padY;
    const m = { l: 52, r: 12, t: 8, b: 20 }, dmax = pr[pr.length - 1].d || 1;
    const X = (d) => m.l + (d / dmax) * (W - m.l - m.r), Y = (z) => m.t + (1 - (z - zlo) / (zhi - zlo)) * (H - m.t - m.b);
    chartGeom = { X, Y, m, W, H, dmax };
    // grid
    ctx.strokeStyle = css('--chart-grid'); ctx.fillStyle = css('--chart-text'); ctx.font = '10.5px JetBrains Mono, monospace'; ctx.lineWidth = 1;
    const niceStep = (r, n) => { const raw = r / n, p = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw); };
    const zs = niceStep(zhi - zlo, 4);
    for (let z = Math.ceil(zlo / zs) * zs; z <= zhi; z += zs) { ctx.beginPath(); ctx.moveTo(m.l, Y(z)); ctx.lineTo(W - m.r, Y(z)); ctx.stroke(); ctx.fillText(fmt(z, 0) + ' m', 4, Y(z) + 3); }
    const ds = niceStep(dmax, 8);
    for (let d = 0; d <= dmax; d += ds) ctx.fillText(d >= 1000 ? fmt(d / 1000, 1) + ' km' : fmt(d, 0) + ' m', X(d) - 10, H - 5);
    // ground
    const grd = ctx.createLinearGradient(0, m.t, 0, H - m.b); grd.addColorStop(0, 'rgba(161,98,7,.75)'); grd.addColorStop(1, 'rgba(120,53,15,.25)');
    ctx.beginPath(); ctx.moveTo(X(0), Y(zlo)); pr.forEach((p) => ctx.lineTo(X(p.d), Y(p.ground))); ctx.lineTo(X(dmax), Y(zlo)); ctx.closePath(); ctx.fillStyle = grd; ctx.fill();
    // obstacles
    if (ob > 0) { ctx.setLineDash([4, 4]); ctx.strokeStyle = '#22c55e'; ctx.beginPath(); pr.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(p.d), Y(p.ground + ob))); ctx.stroke(); ctx.setLineDash([]); }
    // flight
    ctx.strokeStyle = css('--chart-fly'); ctx.lineWidth = 1.6; ctx.beginPath(); pr.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(p.d), Y(p.z))); ctx.stroke();
    ctx.strokeStyle = css('--chart-cap'); ctx.lineWidth = 2.4;
    for (let i = 1; i < pr.length; i++) if (pr[i].line) { ctx.beginPath(); ctx.moveTo(X(pr[i - 1].d), Y(pr[i - 1].z)); ctx.lineTo(X(pr[i].d), Y(pr[i].z)); ctx.stroke(); }
    ctx.lineWidth = 1;
    if (hoverIdx != null && pr[hoverIdx]) {
      const p = pr[hoverIdx];
      ctx.strokeStyle = css('--chart-cursor'); ctx.beginPath(); ctx.moveTo(X(p.d), m.t); ctx.lineTo(X(p.d), H - m.b); ctx.stroke();
      ctx.fillStyle = css('--text'); ctx.beginPath(); ctx.arc(X(p.d), Y(p.z), 3.5, 0, 7); ctx.fill();
    }
  }
  cvs.addEventListener('mousemove', (e) => {
    if (!chartGeom || !R || !R.ok) return;
    const r = cvs.getBoundingClientRect(), x = e.clientX - r.left;
    const d = ((x - chartGeom.m.l) / (chartGeom.W - chartGeom.m.l - chartGeom.m.r)) * chartGeom.dmax;
    let best = 0, bd = Infinity; R.profile.forEach((p, i) => { const dd = Math.abs(p.d - d); if (dd < bd) { bd = dd; best = i; } });
    const p = R.profile[best];
    drawProfile(best);
    $('profileHover').textContent = `${fmt(p.d, 0)} m · ground ${fmt(p.ground, 1)} · alt ${fmt(p.z, 1)} m ASL · AGL ${fmt(p.z - p.ground, 1)} m`;
    const ll = R.proj.toLatLon(p.x, p.y);
    if (!hoverMarker) hoverMarker = L.circleMarker(ll, { radius: 6, color: '#fff', weight: 2, fillColor: '#fbbf24', fillOpacity: 1, interactive: false }).addTo(map);
    else hoverMarker.setLatLng(ll);
  });
  cvs.addEventListener('mouseleave', () => { drawProfile(); $('profileHover').textContent = ''; if (hoverMarker) { map.removeLayer(hoverMarker); hoverMarker = null; } });
  window.addEventListener('resize', () => { drawProfile(); map.invalidateSize(); });
  $('btnProfile').onclick = () => { const p = $('profileDrawer'); p.classList.toggle('collapsed'); $('btnProfile').textContent = p.classList.contains('collapsed') ? 'Show' : 'Hide'; setTimeout(() => { map.invalidateSize(); drawProfile(); }, 220); };

  // ------------------------------------------------------------------ busy / toast
  function busy(on, text) { $('busy').hidden = !on; if (text) $('busyText').textContent = text; }
  let toastT = null;
  function toast(msg, ms = 3200) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms); }

  // ------------------------------------------------------------------ bindings
  function bindSeg(id, fn) { document.querySelectorAll('#' + id + ' button').forEach((b) => b.addEventListener('click', () => fn(b.dataset.v))); }
  bindSeg('missionSeg', (v) => {
    const wasCorr = S.mission === 'corridor';
    S.mission = v;
    if (wasCorr !== (v === 'corridor')) { if (!geom().length) { cancelDraw(); clearPlan(); } }
    syncUI(); renderArea(); schedule(0);
  });
  bindSeg('altSeg', (v) => { S.altMode = v; syncUI(); schedule(0); });
  bindSeg('baseSeg', (v) => { setBase(v); save(); });

  $('btnDraw').onclick = () => (drawing ? finishDraw() : startDraw());
  $('btnClear').onclick = () => { cancelDraw(); setGeom([]); clearPlan(); syncUI(); save(); };
  $('btnHome').onclick = () => { if (!geom().length) { toast('Draw the area first.'); return; } settingHome = !settingHome; $('btnHome').classList.toggle('primary', settingHome); map.getContainer().style.cursor = settingHome ? 'crosshair' : ''; if (settingHome) toast('Click on the map to place the take-off point (Esc to cancel).'); };
  $('corrWidth').oninput = (e) => { S.corridorWidth = +e.target.value; $('corrWidthVal').textContent = S.corridorWidth + ' m'; schedule(); };
  $('projName').oninput = (e) => { S.name = e.target.value; save(); };

  $('platform').onchange = (e) => {
    S.platformId = e.target.value; fillCameras(); S.cameraId = $('camera').value;
    if (S.lock === 'gsd') S.agl = aglFromGsd(+$('gsd').value || 2.5);
    syncUI(); schedule(0);
  };
  $('camera').onchange = (e) => { const g = +$('gsd').value; S.cameraId = e.target.value; if (S.lock === 'gsd' && g) S.agl = aglFromGsd(g); syncUI(); schedule(0); };
  document.querySelectorAll('[data-cc]').forEach((el) => el.addEventListener('input', () => { const v = parseFloat(el.value); if (v > 0) { S.customCam[el.dataset.cc] = v; renderCamSpec(); syncAltitude(); schedule(); } }));
  document.querySelectorAll('[data-cp]').forEach((el) => el.addEventListener('input', () => { const v = parseFloat(el.value); if (v > 0) { S.customPlat[el.dataset.cp] = v; renderCamSpec(); schedule(); } }));

  $('terrain').onchange = (e) => {
    S.terrainId = e.target.value; const t = terrain();
    S.front = t.front; S.side = t.side; S.obstacle = t.obstacle;
    if (t.follow === 'on') S.altMode = 'follow';
    if (t.follow === 'off') { S.altMode = 'fixed'; S.fixedRef = 'takeoff'; }
    if (t.doubleGrid && S.mission === 'area') toast('Tip: a double-grid mission is recommended for this scene type.');
    syncUI(); schedule(0);
  };
  $('fixedRef').onchange = (e) => { S.fixedRef = e.target.value; schedule(0); };
  $('protectOverlap').onchange = (e) => { S.protectOverlap = e.target.checked; schedule(0); };

  const numBind = { obstacle: 'obstacle', demUnc: 'demUnc', utc: 'utc', windSpd: 'windSpd', windGust: 'windGust', windDir: 'windDir', temp: 'temp', maxBlur: 'maxBlur', margin: 'margin', followTol: 'followTol', reserve: 'reserve', takeoffSafe: 'takeoffSafe', legalAGL: 'legalAGL', maxRel: 'maxRel', vlos: 'vlos' };
  Object.entries(numBind).forEach(([id, k]) => $(id).addEventListener('input', (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) { S[k] = v; schedule(); } }));
  ['date', 'time'].forEach((id) => $(id).addEventListener('change', (e) => { S[id] = e.target.value; weatherNote = ''; renderSun(); schedule(); }));
  $('speed').oninput = (e) => { S.speed = parseFloat(e.target.value) || 0; schedule(); };
  $('lineExt').oninput = (e) => { const v = parseFloat(e.target.value); S.lineExt = isFinite(v) ? v : null; schedule(); };
  $('maxGrade').oninput = (e) => { const v = parseFloat(e.target.value); S.maxGrade = isFinite(v) ? v : null; schedule(); };
  $('orient').onchange = (e) => { S.orient = e.target.value; schedule(0); };
  $('georef').onchange = (e) => { S.georef = e.target.value; schedule(0); };
  $('shutter').onchange = (e) => { S.shutterIdx = +e.target.value; schedule(0); };

  $('gsd').addEventListener('input', (e) => { const g = parseFloat(e.target.value); if (g > 0) { S.lock = 'gsd'; S.agl = aglFromGsd(g); $('agl').value = Math.round(S.agl * 10) / 10; $('aglRange').value = S.agl; schedule(); } });
  $('agl').addEventListener('input', (e) => { const h = parseFloat(e.target.value); if (h >= 5) { S.lock = 'agl'; S.agl = h; $('gsd').value = gsdFromAgl(h).toFixed(2); $('aglRange').value = h; schedule(); } });
  $('aglRange').addEventListener('input', (e) => { S.lock = 'agl'; S.agl = +e.target.value; $('agl').value = S.agl; $('gsd').value = gsdFromAgl(S.agl).toFixed(2); schedule(); });
  /** Link a range slider with an exact-value number box (live while typing, clamped on commit). */
  function linkSliderNum(rangeId, numId, key, min, max, onSet) {
    const set = (v, src) => { S[key] = v; if (src !== 'range') $(rangeId).value = Math.round(v); if (src !== 'num') $(numId).value = v; if (onSet) onSet(v); schedule(); };
    $(rangeId).addEventListener('input', (e) => set(+e.target.value, 'range'));
    $(numId).addEventListener('input', (e) => { const v = parseFloat(e.target.value); if (isFinite(v) && v >= min && v <= max) set(v, 'num'); });
    $(numId).addEventListener('change', (e) => { let v = parseFloat(e.target.value); if (!isFinite(v)) v = S[key]; v = Math.min(max, Math.max(min, v)); e.target.value = v; set(v, 'num'); });
  }
  linkSliderNum('front', 'frontNum', 'front', 50, 95);
  linkSliderNum('side', 'sideNum', 'side', 30, 90);
  $('btnRecOverlap').onclick = () => { const t = terrain(); S.front = t.front; S.side = t.side; syncUI(); schedule(0); };
  const manualAngle = () => { S.autoAngle = false; $('autoAngle').checked = false; $('angleVal').textContent = 'manual'; $('angleNum').classList.remove('is-auto'); };
  $('angle').addEventListener('input', (e) => { manualAngle(); S.angle = +e.target.value; $('angleNum').value = S.angle; schedule(); });
  $('angleNum').addEventListener('input', (e) => { const v = parseFloat(e.target.value); if (isFinite(v) && v >= 0 && v < 360) { manualAngle(); S.angle = v; $('angle').value = Math.round(v); schedule(); } });
  $('angleNum').addEventListener('change', (e) => { let v = parseFloat(e.target.value); if (!isFinite(v)) { syncAltitude(); return; } v = ((v % 360) + 360) % 360; manualAngle(); S.angle = v; e.target.value = v; $('angle').value = Math.round(v); schedule(0); });
  $('autoAngle').onchange = (e) => { S.autoAngle = e.target.checked; if (!S.autoAngle && R && R.ok && R.design.angle != null) S.angle = Math.round(R.design.angle); syncUI(); schedule(0); };
  $('btnCrosswind').onclick = () => { S.angle = Math.round((S.windDir + 90) % 180); S.autoAngle = false; syncUI(); schedule(0); toast(`Flight direction set to ${S.angle}° — perpendicular to wind from ${S.windDir}°.`); };

  $('hillshade').onchange = (e) => { S.hillshade = e.target.checked; S.hillshade ? hillshade.addTo(map) : map.removeLayer(hillshade); save(); };
  $('showPhotos').onchange = (e) => { S.showPhotos = e.target.checked; render(); save(); };
  $('showFoot').onchange = (e) => { S.showFoot = e.target.checked; render(); save(); };
  $('colorBy').onchange = (e) => { S.colorBy = e.target.value; render(); save(); };

  // ------------------------------------------------------------------ weather (Open-Meteo)
  let weatherNote = '';
  const escHTML = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  $('btnWeather').onclick = async () => {
    const [lat, lon] = siteLatLon();
    // ~1 km rounding: plenty for a forecast, improves cache hits and shares less location detail
    const la = lat.toFixed(2), lo = lon.toFixed(2);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,precipitation_probability&wind_speed_unit=ms&timezone=auto&start_date=${S.date}&end_date=${S.date}`;
    $('btnWeather').disabled = true; $('btnWeather').textContent = 'Fetching…';
    try {
      const { data: j, cached } = await guard.fetchJSON('forecast', url, `${la},${lo},${S.date}`);
      if (!j.hourly || !j.hourly.time || !j.hourly.time.length) throw new guard.GuardError('Forecast unavailable for this date (Open-Meteo covers the next 16 days).');
      const hh = +S.time.split(':')[0], h = j.hourly, i = Math.min(h.time.length - 1, hh);
      S.windSpd = Math.round(h.wind_speed_10m[i] * 10) / 10; S.windDir = Math.round(h.wind_direction_10m[i]); S.windGust = Math.round(h.wind_gusts_10m[i] * 10) / 10;
      S.temp = Math.round(h.temperature_2m[i]); S.utc = j.utc_offset_seconds / 3600;
      weatherNote = `Forecast ${S.date} ${pad2(hh)}:00 (${escHTML(j.timezone_abbreviation || j.timezone)}) · cloud <b>${h.cloud_cover[i]} %</b> · rain chance <b>${h.precipitation_probability[i] ?? '—'} %</b>`;
      syncUI(); schedule(0); toast(cached ? 'Site forecast applied (cached, < 1 h old).' : 'Site forecast applied (Open-Meteo).');
    } catch (err) { toast(err instanceof guard.GuardError ? err.message : 'Forecast unavailable for this date (Open-Meteo covers the next 16 days).', 5000); }
    $('btnWeather').disabled = false; $('btnWeather').textContent = '☁ Fetch site forecast';
  };

  // ------------------------------------------------------------------ search (Nominatim: on Enter only, cached, rate-limited)
  $('searchBox').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const q = e.target.value.trim(); if (!q) return;
    const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) { map.setView([+m[1], +m[2]], 16); $('searchResults').hidden = true; return; }
    if (q.length < 3) { toast('Type at least 3 characters, or coordinates like 13.79, 100.32.'); return; }
    const box = $('searchResults'); box.hidden = true;
    try {
      const { data: j } = await guard.fetchJSON('search', `https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(q)}`, q.toLowerCase(), { headers: { 'Accept-Language': 'en' } });
      box.innerHTML = j.length ? j.map((x, i) => `<div data-i="${i}">${escHTML(x.display_name)}</div>`).join('') : '<div>No results</div>';
      box.hidden = false;
      box.querySelectorAll('[data-i]').forEach((el) => el.onclick = () => { const x = j[+el.dataset.i]; if (x.boundingbox) map.fitBounds([[+x.boundingbox[0], +x.boundingbox[2]], [+x.boundingbox[1], +x.boundingbox[3]]], { maxZoom: 17 }); else map.setView([+x.lat, +x.lon], 16); box.hidden = true; });
    } catch (err) { toast((err instanceof guard.GuardError ? err.message : 'Search unavailable.') + ' You can always type coordinates (lat, lon).', 6000); }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) $('searchResults').hidden = true; });

  // ------------------------------------------------------------------ files: save / open / import
  function download(name, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const safeName = () => (S.name || 'mission').replace(/[^\w\-]+/g, '_').slice(0, 60);
  $('btnSave').onclick = () => { const o = Object.assign({}, S); delete o.view; download(safeName() + '.envi-aero-survey.json', JSON.stringify({ app: 'EnviAeroSurvey', org: 'Mahidol University', version: 1, state: o }, null, 1), 'application/json'); };
  let importOnly = false;
  $('btnOpen').onclick = () => { importOnly = false; $('fileOpen').click(); };
  $('btnImport').onclick = () => { importOnly = true; $('fileOpen').click(); };
  $('btnNew').onclick = () => { if (!confirm('Start a new project? Unsaved changes to the current plan will be lost.')) return; const v = S.view; S = Object.assign({}, DEF, { view: v }); cancelDraw(); clearPlan(); syncUI(); renderArea(); save(); };
  $('fileOpen').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const txt = await f.text();
    try {
      if (/\.kml$/i.test(f.name) || /<kml/i.test(txt.slice(0, 500))) return importKML(txt);
      const j = JSON.parse(txt);
      if ((j.app === 'EnviAeroSurvey' || j.app === 'AeroGrid') && j.state && !importOnly) { S = Object.assign({}, DEF, j.state, { view: S.view }); syncUI(); renderArea(); fitGeom(); schedule(0); toast('Project loaded.'); return; }
      importGeoJSON(j);
    } catch (err) { toast('Could not read file: ' + err.message); }
  };
  function applyImported(kind, coords) {
    if (kind === 'line') { S.mission = 'corridor'; S.line = coords; } else { if (S.mission === 'corridor') S.mission = 'area'; S.polygon = coords; }
    placeDefaultHome(); syncUI(); renderArea(); fitGeom(); schedule(0); toast(`Imported ${kind === 'line' ? 'centre-line' : 'boundary'} with ${coords.length} points.`);
  }
  function importKML(txt) {
    const doc = new DOMParser().parseFromString(txt, 'text/xml');
    const parse = (el) => el.textContent.trim().split(/\s+/).map((c) => c.split(',').map(Number)).filter((c) => c.length >= 2 && isFinite(c[0]) && isFinite(c[1])).map((c) => [c[1], c[0]]);
    const poly = doc.querySelector('Polygon outerBoundaryIs coordinates, Polygon coordinates');
    if (poly) { let c = parse(poly); if (c.length > 1 && c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1]) c.pop(); return applyImported('poly', c); }
    const ls = doc.querySelector('LineString coordinates'); if (ls) return applyImported('line', parse(ls));
    toast('No Polygon or LineString found in KML.');
  }
  function importGeoJSON(j) {
    const geoms = [];
    const walk = (o) => { if (!o) return; if (o.type === 'FeatureCollection') o.features.forEach(walk); else if (o.type === 'Feature') walk(o.geometry); else geoms.push(o); };
    walk(j);
    const g = geoms.find((x) => /Polygon/.test(x.type)) || geoms.find((x) => /LineString/.test(x.type));
    if (!g) return toast('No Polygon or LineString found.');
    const ring = g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0][0] : g.type === 'LineString' ? g.coordinates : g.coordinates[0];
    let c = ring.map((p) => [p[1], p[0]]);
    if (/Polygon/.test(g.type) && c.length > 1 && c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1]) c.pop();
    applyImported(/Polygon/.test(g.type) ? 'poly' : 'line', c);
  }
  function fitGeom() { const g = geom(); if (g.length) map.fitBounds(L.latLngBounds(g).pad(0.25)); }

  // ------------------------------------------------------------------ exports
  document.querySelectorAll('[data-exp]').forEach((b) => b.addEventListener('click', () => {
    if (!R || !R.ok) { toast('No valid plan to export.'); return; }
    const k = b.dataset.exp, P = platform(), n = safeName();
    const summary = `${P.name} · ${camera().name} · GSD ${fmt(R.stats.gsd.mean * 100, 2)} cm/px · ${R.stats.nPhotos} photos · ${mmss(R.flight.totalTime)} min`;
    if (k === 'kml') download(n + '.kml', exporters.kml(R, { name: S.name, summary }), 'application/vnd.google-earth.kml+xml');
    if (k === 'wpml') {
      if (P.type === 'fixedwing') toast('Note: DJI WPML targets DJI multirotors. Use KML/CSV for this platform.', 5000);
      else if (!P.dji) toast('Platform is not a DJI WPML aircraft — file uses M3E enums; edit in Pilot 2.', 5000);
      download(n + '.kmz', exporters.wpml(R, { platform: P, takeoffSafe: S.takeoffSafe }));
    }
    if (k === 'litchi') { const parts = exporters.litchi(R); parts.forEach((c, i) => download(n + (parts.length > 1 ? `_part${i + 1}of${parts.length}` : '') + '_litchi.csv', c, 'text/csv')); if (parts.length > 1) toast(`Litchi allows 99 waypoints — split into ${parts.length} files.`); }
    if (k === 'wpcsv') download(n + '_waypoints.csv', exporters.waypointCSV(R), 'text/csv');
    if (k === 'photocsv') download(n + '_photos.csv', exporters.photoCSV(R), 'text/csv');
    if (k === 'geojson') download(n + '.geojson', exporters.geojson(R), 'application/geo+json');
  }));

  // ------------------------------------------------------------------ report
  $('btnReport').onclick = () => {
    if (!R || !R.ok) { toast('No valid plan to report.'); return; }
    const P = platform(), C = camera(), T = terrain();
    // plan sketch (SVG in local metres)
    const pts = R.area.polygon.map((p) => R.proj.toLocal(p[0], p[1])).concat(R.route.map((r) => [r.x, r.y]));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; pts.forEach((p) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
    const sc = 560 / Math.max(x1 - x0, y1 - y0, 1), w = (x1 - x0) * sc + 20, h = (y1 - y0) * sc + 20;
    const sx = (x) => 10 + (x - x0) * sc, sy = (y) => 10 + (y1 - y) * sc;
    const areaPath = R.area.polygon.map((p) => R.proj.toLocal(p[0], p[1])).map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join('') + 'Z';
    const routePath = R.route.map((r, i) => `${i ? 'L' : 'M'}${sx(r.x).toFixed(1)},${sy(r.y).toFixed(1)}`).join('');
    const home = R.route[0];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}"><path d="${areaPath}" fill="#fde68a55" stroke="#d97706" stroke-width="1.5"/><path d="${routePath}" fill="none" stroke="#0369a1" stroke-width="1"/>${R.flight.splits.map((s, i) => `<rect x="${sx(s.x) - 6}" y="${sy(s.y) - 6}" width="12" height="12" fill="#f59e0b"/><text x="${sx(s.x) + 8}" y="${sy(s.y) + 4}" font-size="10">B${i + 2}</text>`).join('')}<circle cx="${sx(home.x)}" cy="${sy(home.y)}" r="6" fill="#10b981" stroke="#fff"/><text x="${sx(home.x) + 9}" y="${sy(home.y) + 4}" font-size="11" font-weight="700">H</text><g transform="translate(${w - 24},22)"><path d="M0,-14 L5,4 L0,0 L-5,4Z" fill="#111"/><text x="-4" y="16" font-size="10">N</text></g></svg>`;
    drawProfile(); const profImg = cvs.toDataURL('image/png');
    const ws = sunWarnings().concat(R.warnings);
    const kv = (rows) => rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${S.name} — Mission report</title><style>
      body{font:12px/1.45 Inter,system-ui,sans-serif;color:#0f172a;max-width:900px;margin:24px auto;padding:0 20px;background:#fff}
      h1{font-size:20px;margin:0}h2{font-size:13px;text-transform:uppercase;letter-spacing:.8px;color:#0369a1;border-bottom:1px solid #e2e8f0;padding-bottom:4px;margin:20px 0 8px}
      .meta{color:#64748b;margin:4px 0 12px}.cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}table{width:100%;border-collapse:collapse}td{padding:3px 0;border-bottom:1px solid #f1f5f9}td:last-child{text-align:right;font-variant-numeric:tabular-nums}
      .w{padding:5px 8px;border-left:3px solid;margin:4px 0;border-radius:0 5px 5px 0}.danger{border-color:#dc2626;background:#fef2f2}.caution{border-color:#d97706;background:#fffbeb}.info{border-color:#2563eb;background:#eff6ff}
      .sk{border:1px solid #e2e8f0;border-radius:8px;padding:8px;text-align:center}img{max-width:100%;background:${css("--panel")};border-radius:6px}.sig{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-top:30px}.sig div{border-top:1px solid #94a3b8;padding-top:4px;color:#64748b}
      @media print{body{margin:0}button{display:none}}</style></head><body>
      <button onclick="print()" style="float:right;padding:6px 14px">Print / PDF</button>
      <h1>${S.name}</h1><div class="meta">Photogrammetry mission report · generated ${new Date().toLocaleString()} · EnviAeroSurvey: Mahidol University</div>
      <div class="cols"><div><h2>Mission</h2><table>${kv([
        ['Type', { area: 'Area grid', double: 'Double grid', corridor: 'Corridor' }[S.mission]], ['Platform', P.name], ['Payload', C.name], ['Scene', T.name],
        ['Area', `${fmt(R.area.m2 / 10000, 2)} ha`], ['Altitude mode', R.design.followOn ? 'Terrain-following' : `Fixed ${fmt(R.design.zFixed, 0)} m ASL`],
        ['Height AGL', `${fmt(R.design.H, 0)} m`], ['GSD (mean, range)', `${fmt(R.stats.gsd.mean * 100, 2)} cm/px (${fmt(R.stats.gsd.min * 100, 2)}–${fmt(R.stats.gsd.max * 100, 2)})`],
        ['Overlap target F/S', `${S.front} / ${S.side} %`], ['Overlap achieved min F/S', `${fmt(R.stats.front.min * 100, 0)} / ${R.stats.side ? fmt(R.stats.side.min * 100, 0) : '—'} %`],
        ['Line spacing / photo spacing', `${fmt(R.design.lineSpacing, 1)} / ${fmt(R.design.photoSpacing, 1)} m`], ['Flight direction', R.design.angle != null ? fmt(R.design.angle, 1) + '°' : 'corridor'],
        ['Speed', `${fmt(R.flight.speed, 1)} m/s`], ['Shutter / blur', `${data.shutters[S.shutterIdx].label} / ${fmt(R.flight.blurPx, 2)} px`]])}</table></div>
      <div><h2>Flight</h2><table>${kv([
        ['Flight time', `${mmss(R.flight.totalTime)} min`], ['Batteries', R.flight.batteries], ['Photos / storage', `${R.stats.nPhotos} / ${fmt(R.stats.storageGB, 1)} GB`],
        ['Distance', `${fmt(R.flight.totalDist / 1000, 2)} km`], ['Take-off', `${S.home[0].toFixed(6)}, ${S.home[1].toFixed(6)} · ${fmt(R.terrain.zHome, 0)} m ASL`],
        ['Terrain', `${fmt(R.terrain.zmin, 0)}–${fmt(R.terrain.zmax, 0)} m ASL (relief ${fmt(R.terrain.relief, 0)} m)`], ['Max above take-off', `${fmt(R.stats.maxRel, 0)} m`],
        ['Max AGL / min clearance', `${fmt(R.stats.maxAGL, 0)} m / ${fmt(R.stats.clearance.min, 0)} m`], ['Wind (10 m / flight height)', `${S.windSpd} / ${fmt(R.flight.windAlt, 1)} m/s from ${S.windDir}°`],
        ['Temperature / density alt.', `${S.temp} °C / ${fmt(R.flight.air.densityAltitude, 0)} m`], ['Date / time', `${S.date} ${S.time} (UTC${S.utc >= 0 ? '+' : ''}${S.utc})`],
        ['Sun', sunCache ? `${fmt(sunCache.s.elevation, 0)}° el, ${fmt(sunCache.s.azimuth, 0)}° az` : '—'], ['Expected accuracy H / V', `${fmt(R.accuracy.h[0] * 100, 1)}–${fmt(R.accuracy.h[1] * 100, 1)} / ${fmt(R.accuracy.v[0] * 100, 1)}–${fmt(R.accuracy.v[1] * 100, 1)} cm`]])}</table></div></div>
      <h2>Plan sketch</h2><div class="sk">${svg}</div>
      <h2>Terrain &amp; altitude profile</h2><img src="${profImg}" alt="profile">
      <h2>Checks</h2>${ws.length ? ws.map((x) => `<div class="w ${x.level}">${x.msg}</div>`).join('') : '<div class="w info">All checks passed.</div>'}
      <h2>Pre-flight checklist</h2><table>${kv([['Airspace authorisation / NOTAM checked', '☐'], ['Site risk assessment & take-off/landing zone clear', '☐'], ['Batteries charged & warmed (≥ 15 °C)', `☐ × ${R.flight.batteries}`], ['RTK / GCPs / checkpoints set out', '☐'], ['Camera: focus ∞, shutter ' + data.shutters[S.shutterIdx].label + ', ISO auto ≤ 400', '☐'], ['Mission verified in flight app simulator', '☐'], ['Storage ≥ ' + fmt(R.stats.storageGB * 1.3, 1) + ' GB free', '☐']])}</table>
      <div class="sig"><div>Remote pilot</div><div>Observer</div><div>Date</div></div>
      </body></html>`;
    const wdw = window.open('', '_blank');
    if (!wdw) { download(safeName() + '_report.html', html, 'text/html'); return; }
    wdw.document.write(html); wdw.document.close();
  };

  // ------------------------------------------------------------------ demo
  $('btnDemo').onclick = () => {
    Object.assign(S, {
      name: 'Demo — hillside terrain survey', mission: 'area', terrainId: 'mountain', platformId: 'dji_m3e', cameraId: 'm3e_wide',
      polygon: [[18.8072, 98.9118], [18.8078, 98.9205], [18.8012, 98.9222], [18.7996, 98.9136]], home: [18.8012, 98.9140],
      front: 80, side: 70, obstacle: 10, altMode: 'follow', agl: aglFromGsd(2.5), lock: 'gsd', autoAngle: true, windSpd: 4, windGust: 7, windDir: 220, temp: 27, time: '10:00', utc: 7
    });
    syncUI(); renderArea(); fitGeom(); schedule(0);
  };

  // ------------------------------------------------------------------ init
  fillPlatforms(); fillMisc(); applyTheme(currentTheme());
  setBase(S.basemap); if (S.hillshade) hillshade.addTo(map);
  syncUI(); renderArea();
  if (geom().length) { $('emptyState').hidden = true; schedule(0); } else clearPlan();
  setTimeout(() => { map.invalidateSize(); drawProfile(); }, 100);
  window.EnviAeroSurvey = { get state() { return S; }, get plan() { return R; }, replan };
})();
