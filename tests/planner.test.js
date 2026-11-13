// Engine tests — run: node tests/planner.test.js
require('../js/data.js'); require('../js/geo.js'); require('../js/environment.js'); require('../js/planner.js');
const UAV = globalThis.UAV;
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('Projection');
{
  const pr = UAV.geo.makeProjection(13.75, 100.5);
  const p = pr.toLocal(13.76, 100.51), back = pr.toLatLon(p[0], p[1]);
  ok(near(back[0], 13.76, 1e-9) && near(back[1], 100.51, 1e-9), 'TM forward/inverse round-trip < 1e-9°');
  const d = Math.hypot(p[0], p[1]), hv = UAV.geo.haversine(13.75, 100.5, 13.76, 100.51);
  ok(near(d, hv, hv * 0.004), `local distance ${d.toFixed(2)} m ≈ great-circle ${hv.toFixed(2)} m`);
  // known UTM check: Krüger with k0 = 0.9996 at lon0 = 99 (zone 47): point 13.75N 100.5E -> E ≈ 662 km
  const tm = UAV.geo.tmForward(13.75, 100.5, 99);
  ok(near(tm[0] * 0.9996 + 500000, 662176.29, 0.05), `UTM easting ${(tm[0] * 0.9996 + 500000).toFixed(1)}`);
}

console.log('Camera geometry (M3E @ 100 m)');
const D = UAV.data;
const base = {
  mission: 'area', platform: D.platforms.dji_m3e, camera: D.cameras.m3e_wide, terrain: D.terrains.open,
  polygon: [[13.75, 100.5], [13.75, 100.505], [13.754, 100.505], [13.754, 100.5]],
  altMode: 'follow', agl: 100, front: 80, side: 70, angle: 0, autoAngle: false, orientation: 'across',
  speed: 15, shutter: 1 / 1000, maxBlur: 0.5, wind: { speed: 3, dir: 90 }, temperature: 25, reserve: 20,
  elev: () => 10, georef: 'rtk_gcp'
};
{
  const r = UAV.planner.plan(base);
  ok(r.ok, 'plan succeeds');
  ok(near(r.design.gsdTarget * 100, 2.67, 0.02), `GSD ${(r.design.gsdTarget * 100).toFixed(3)} cm/px (expected 2.67)`);
  ok(near(r.design.footX, 140.76, 0.1), `footprint across ${r.design.footX.toFixed(2)} m`);
  ok(near(r.design.lineSpacing, 140.76 * 0.3, 0.1), `line spacing ${r.design.lineSpacing.toFixed(2)} m`);
  ok(near(r.design.photoSpacing, 105.78 * 0.2, 0.1), `photo spacing ${r.design.photoSpacing.toFixed(2)} m`);
  ok(r.photos.every((p) => near(p.agl, 100, 0.01)), 'flat terrain: all photos at 100 m AGL');
  ok(near(r.stats.front.min, 0.8, 1e-6) && near(r.stats.side.min, 0.7, 1e-6), 'flat terrain: achieved overlap = target');
  ok(r.flight.speed <= 15 && r.flight.speed > 0, `speed ${r.flight.speed} m/s (limited by ${r.flight.limitedBy})`);
  ok(r.flight.speed <= r.design.photoSpacing / 0.7 + 1e-9, 'speed respects camera interval');
  // coverage: every polygon interior point within half line spacing of a line (across) — test with grid
  const pr = r.proj, lines = r.passes.map((p) => p.pts);
  let maxGap = 0;
  for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
    const lat = 13.75 + 0.004 * i / 20, lon = 100.5 + 0.005 * j / 20, q = pr.toLocal(lat, lon);
    let best = Infinity;
    for (const l of lines) { const a = l[0], b = l[1]; const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * (b[0] - a[0]) + (q[1] - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2))); best = Math.min(best, Math.hypot(q[0] - a[0] - t * (b[0] - a[0]), q[1] - a[1] - t * (b[1] - a[1]))); }
    maxGap = Math.max(maxGap, best);
  }
  ok(maxGap <= r.design.lineSpacing / 2 + 0.5, `full coverage: max distance to nearest line ${maxGap.toFixed(1)} m ≤ spacing/2`);
}

console.log('Terrain effects (ramp 0 → 120 m across area)');
{
  const ramp = (lat) => (lat - 13.75) / 0.004 * 120;
  const follow = UAV.planner.plan(Object.assign({}, base, { elev: (lat) => ramp(lat) }));
  ok(follow.ok, 'terrain-follow plan ok');
  ok(follow.photos.every((p) => p.agl >= 99.9), `terrain-follow keeps AGL ≥ H (min ${follow.stats.agl.min.toFixed(1)} m)`);
  ok(follow.stats.gsd.max / follow.stats.gsd.min < 1.15, `GSD variation ${(follow.stats.gsd.min * 100).toFixed(2)}–${(follow.stats.gsd.max * 100).toFixed(2)} cm`);
  const fixed = UAV.planner.plan(Object.assign({}, base, { elev: (lat) => ramp(lat), altMode: 'fixed', fixedRef: 'lowest', agl: 200, protectOverlap: false }));
  ok(fixed.ok, 'fixed-altitude plan ok');
  ok(fixed.stats.front.min < 0.8 - 0.05, `fixed altitude loses front overlap on high ground (min ${(fixed.stats.front.min * 100).toFixed(1)} %)`);
  ok(fixed.warnings.some((w) => /Terrain-following is recommended|relief/.test(w.msg)), 'warns about relief');
  const prot = UAV.planner.plan(Object.assign({}, base, { elev: (lat) => ramp(lat), altMode: 'fixed', fixedRef: 'lowest', agl: 200, protectOverlap: true }));
  ok(prot.stats.front.min >= 0.8 - 0.05, `protect-overlap keeps min front overlap ${(prot.stats.front.min * 100).toFixed(1)} %`);
  const bad = UAV.planner.plan(Object.assign({}, base, { elev: (lat) => ramp(lat), altMode: 'fixed', fixedRef: 'lowest', agl: 100 }));
  ok(!bad.ok && /below the highest terrain/.test(bad.error), 'rejects fixed altitude below terrain');
  // grade limit along N-S lines over a cliff
  const cliff = UAV.planner.plan(Object.assign({}, base, { elev: (lat) => (lat > 13.752 ? 80 : 0), maxGrade: 40 }));
  let maxG = 0;
  cliff.passes.forEach((ps) => { for (let i = 1; i < ps.wps.length; i++) maxG = Math.max(maxG, Math.abs(ps.wps[i].z - ps.wps[i - 1].z) / Math.max(1e-6, ps.wps[i].d - ps.wps[i - 1].d)); });
  ok(maxG <= 0.40 + 1e-6, `waypoint grade ≤ 40 % (max ${(maxG * 100).toFixed(1)} %)`);
  ok(cliff.photos.every((p) => p.agl >= 99.9), 'cliff: smoothed profile never below target AGL');
}

console.log('Cross-slope (terrain-follow keeps side overlap; fixed altitude loses it uphill)');
{
  const xs = (lat, lon) => (lon - 100.5) / 0.005 * 150; // 150 m rise across 540 m, lines run N-S
  const fo = UAV.planner.plan(Object.assign({}, base, { elev: xs }));
  ok(fo.stats.side.min >= 0.7 - 0.01, `terrain-follow side overlap min ${(fo.stats.side.min * 100).toFixed(1)} % (target 70)`);
  ok(fo.stats.front.min >= 0.8 - 0.01, `terrain-follow front overlap min ${(fo.stats.front.min * 100).toFixed(1)} % (target 80)`);
  const fx = UAV.planner.plan(Object.assign({}, base, { elev: xs, altMode: 'fixed', fixedRef: 'lowest', agl: 200, protectOverlap: false }));
  ok(fx.stats.side.min < 0.6, `fixed altitude side overlap drops to ${(fx.stats.side.min * 100).toFixed(1)} % on the high side`);
  // analytic check: ray on slope s with tan(halfFOV) k: uphill edge = Hk/(1+sk)
  const s = 150 / Math.abs(fo.proj.toLocal(13.75, 100.505)[0] - fo.proj.toLocal(13.75, 100.5)[0]);
  const k = 17.3 / (2 * 12.29), ph = fo.photos[Math.floor(fo.photos.length / 2)];
  const expected = (2 * 100 * k / (1 - s * s * k * k) - fo.design.lineSpacing) / (100 * k / (1 + s * k) + 100 * k / (1 - s * k));
  ok(near(ph.side, expected, 0.01), `side overlap matches analytic slope model (${(ph.side * 100).toFixed(2)} vs ${(expected * 100).toFixed(2)} %)`);
}

console.log('Missions');
{
  const dbl = UAV.planner.plan(Object.assign({}, base, { mission: 'double' }));
  ok(dbl.ok && dbl.design.nLinesB > 0 && dbl.passes.some((p) => p.set === 1), `double grid: ${dbl.design.nLinesA} + ${dbl.design.nLinesB} lines`);
  const corr = UAV.planner.plan(Object.assign({}, base, { mission: 'corridor', line: [[13.75, 100.5], [13.76, 100.51], [13.77, 100.51]], corridorWidth: 80 }));
  ok(corr.ok && corr.design.corridorLines >= 2, `corridor: ${corr.design.corridorLines} lines, ${corr.stats.nPhotos} photos`);
  const fw = UAV.planner.plan(Object.assign({}, base, { platform: D.platforms.wingtra_gen2, camera: D.cameras.rx1r2, wind: { speed: 8, dir: 0 }, polygon: [[13.75, 100.5], [13.75, 100.53], [13.77, 100.53], [13.77, 100.5]] }));
  ok(fw.ok && fw.flight.gsMax > fw.flight.gsMin, `fixed-wing ground speed varies with wind ${fw.flight.gsMin.toFixed(1)}–${fw.flight.gsMax.toFixed(1)} m/s`);
  const auto = UAV.planner.plan(Object.assign({}, base, { autoAngle: true, polygon: [[13.75, 100.5], [13.751, 100.52], [13.755, 100.52], [13.754, 100.5]] }));
  ok(auto.ok && (auto.design.angle > 60 && auto.design.angle < 120), `auto angle aligns with long axis (${auto.design.angle}°)`);
  const big = UAV.planner.plan(Object.assign({}, base, { polygon: [[13.75, 100.5], [13.75, 100.55], [13.79, 100.55], [13.79, 100.5]] }));
  ok(big.ok && big.flight.batteries > 1 && big.flight.splits.length === big.flight.batteries - 1, `large area needs ${big.flight.batteries} batteries`);
}

console.log('Environment');
{
  // Sun at solar noon on equinox at equator ≈ 90°; NOAA reference: Bangkok 2024-06-21 12:00 +07 ≈ elev 80°
  const s = UAV.env.sunPosition(new Date(Date.UTC(2024, 5, 21, 5, 0)), 13.75, 100.5);
  ok(near(s.elevation, 80.2, 1.0), `sun elevation Bangkok solstice noon ${s.elevation.toFixed(1)}°`);
  const a = UAV.env.airDensity(2000, 5);
  ok(near(a.sigma, 0.83, 0.02), `density ratio at 2000 m / 5 °C: ${a.sigma.toFixed(3)}`);
  ok(near(UAV.env.windAt(5, 100, 0.14), 6.9, 0.1), 'power-law wind at 100 m');
}

console.log(fails ? `\n${fails} FAILED` : '\nAll tests passed');
process.exit(fails ? 1 : 0);
