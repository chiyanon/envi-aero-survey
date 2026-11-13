/*
 * EnviAeroSurvey: Mahidol University — photogrammetry flight-planning engine (pure, DOM-free; runs in browser or Node).
 *
 * Core relations (pinhole camera, nadir):
 *   GSD [m/px]        = H · p / f            (p = pixel pitch = sensor width / image width)
 *   footprint [m]     = H · s / f            (s = sensor dimension)
 *   line spacing      = footprint_across · (1 − side overlap)
 *   photo spacing     = footprint_along  · (1 − front overlap)
 *   motion blur [px]  = v · t_exposure / GSD
 * Terrain effects are evaluated photo-by-photo against the DEM: the worst (highest) ground point
 * inside each footprint gives the minimum effective height, hence the minimum achieved overlap.
 */
(function (root) {
  const UAV = (root.UAV = root.UAV || {});
  const G = () => UAV.geo, E = () => UAV.env;
  const D2R = Math.PI / 180;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ------------------------------------------------------------------ line generation
  function frame(bearingDeg) {
    const b = bearingDeg * D2R;
    const u = [Math.sin(b), Math.cos(b)], v = [Math.cos(b), -Math.sin(b)];
    return { u, v, S: (p) => p[0] * u[0] + p[1] * u[1], T: (p) => p[0] * v[0] + p[1] * v[1], P: (s, t) => [s * u[0] + t * v[0], s * u[1] + t * v[1]] };
  }

  /** Bearing (0–179°) that minimises the polygon's extent across the lines (fewest lines / turns). */
  function bestAngle(poly) {
    let best = 0, bestW = Infinity;
    for (let a = 0; a < 180; a += 0.5) {
      const F = frame(a);
      let tmin = Infinity, tmax = -Infinity;
      for (const p of poly) { const t = F.T(p); if (t < tmin) tmin = t; if (t > tmax) tmax = t; }
      if (tmax - tmin < bestW - 1e-6) { bestW = tmax - tmin; best = a; }
    }
    return best;
  }

  /** Exact s-extent of polygon ∩ band ta ≤ t ≤ tb (merged intervals). */
  function bandIntervals(st, ta, tb, mergeGap) {
    const iv = [];
    for (let i = 0, j = st.length - 1; i < st.length; j = i++) {
      const [s1, t1] = st[j], [s2, t2] = st[i];
      if (Math.abs(t2 - t1) < 1e-12) { if (t1 >= ta && t1 <= tb) iv.push([Math.min(s1, s2), Math.max(s1, s2)]); continue; }
      let l0 = (ta - t1) / (t2 - t1), l1 = (tb - t1) / (t2 - t1);
      if (l0 > l1) [l0, l1] = [l1, l0];
      l0 = Math.max(0, l0); l1 = Math.min(1, l1);
      if (l0 > l1) continue;
      const sa = lerp(s1, s2, l0), sb = lerp(s1, s2, l1);
      iv.push([Math.min(sa, sb), Math.max(sa, sb)]);
    }
    // band boundary lines inside the polygon are also part of the clipped region's boundary
    for (const t of [ta, tb]) {
      const xs = [];
      for (let i = 0, j = st.length - 1; i < st.length; j = i++) {
        const [s1, t1] = st[j], [s2, t2] = st[i];
        if ((t1 <= t && t < t2) || (t2 <= t && t < t1)) xs.push(s1 + ((t - t1) / (t2 - t1)) * (s2 - s1));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) iv.push([xs[k], xs[k + 1]]);
    }
    iv.sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const r of iv) {
      if (out.length && r[0] <= out[out.length - 1][1] + mergeGap) out[out.length - 1][1] = Math.max(out[out.length - 1][1], r[1]);
      else out.push([r[0], r[1]]);
    }
    return out;
  }

  /** Parallel-line (lawnmower) rows covering polygon. Returns rows [[seg, seg...]] of [p0, p1]. */
  function gridRows(poly, bearingDeg, spacing, margin, ext, mergeGap) {
    const F = frame(bearingDeg);
    const st = poly.map((p) => [F.S(p), F.T(p)]);
    let tmin = Infinity, tmax = -Infinity;
    for (const q of st) { tmin = Math.min(tmin, q[1]); tmax = Math.max(tmax, q[1]); }
    const width = tmax - tmin + 2 * margin;
    const n = Math.max(1, Math.ceil(width / spacing - 1e-9));
    const tmid = (tmin + tmax) / 2, h = spacing / 2 + margin;
    const rows = [];
    for (let k = 0; k < n; k++) {
      const t = tmid + (k - (n - 1) / 2) * spacing;
      const ivs = bandIntervals(st, t - h, t + h, mergeGap);
      if (!ivs.length) continue;
      rows.push(ivs.map(([s0, s1]) => Object.assign([F.P(s0 - margin - ext, t), F.P(s1 + margin + ext, t)], { row: k, n, fv: F.v })));
    }
    return rows;
  }

  /** Order rows boustrophedon; tries 4 start corners, picks shortest home→start + end→home. */
  function orderRows(rows, home, prevEnd) {
    const variants = [];
    for (const revRows of [false, true]) for (const firstRev of [false, true]) {
      const rr = revRows ? rows.slice().reverse() : rows;
      const passes = [];
      rr.forEach((segs, k) => {
        const rev = (k % 2 === 1) !== firstRev;
        const ss = rev ? segs.slice().reverse().map((s) => Object.assign([s[1], s[0]], { row: s.row, n: s.n, fv: s.fv })) : segs;
        ss.forEach((s) => passes.push(s));
      });
      if (!passes.length) continue;
      const start = prevEnd || home;
      const cost = G().dist(start, passes[0][0]) + G().dist(passes[passes.length - 1].slice(-1)[0], home);
      variants.push({ passes, cost });
    }
    variants.sort((a, b) => a.cost - b.cost);
    return variants.length ? variants[0].passes : [];
  }

  function extendPolyline(pts, e) {
    if (pts.length < 2 || e <= 0) return pts;
    const out = pts.map((p) => p.slice());
    const ext = (a, b) => { const L = G().dist(a, b) || 1; return [a[0] + ((a[0] - b[0]) / L) * e, a[1] + ((a[1] - b[1]) / L) * e]; };
    out[0] = ext(pts[0], pts[1]);
    out[out.length - 1] = ext(pts[pts.length - 1], pts[pts.length - 2]);
    return out;
  }

  // ------------------------------------------------------------------ altitude profiles
  /** Raise-only slope limiting: |dz/dd| ≤ g, never below the desired profile. */
  function limitGrade(prof, g) {
    for (let i = 1; i < prof.length; i++) prof[i].z = Math.max(prof[i].z, prof[i - 1].z - g * (prof[i].d - prof[i - 1].d));
    for (let i = prof.length - 2; i >= 0; i--) prof[i].z = Math.max(prof[i].z, prof[i + 1].z - g * (prof[i + 1].d - prof[i].d));
    return prof;
  }

  /** Simplify a smoothed profile while guaranteeing the result never dips below it. */
  function simplifySafe(prof, tol) {
    const keep = G().simplifyProfile(prof, tol);
    const z = keep.map((i) => prof[i].z);
    for (let k = 0; k < keep.length - 1; k++) {
      const a = keep[k], b = keep[k + 1];
      let deficit = 0;
      for (let i = a + 1; i < b; i++) {
        const zi = lerp(z[k], z[k + 1], (prof[i].d - prof[a].d) / (prof[b].d - prof[a].d || 1));
        deficit = Math.max(deficit, prof[i].z - zi);
      }
      if (deficit > 0) { z[k] += deficit; z[k + 1] += deficit; }
    }
    return keep.map((i, k) => ({ d: prof[i].d, z: z[k], ground: prof[i].ground }));
  }

  function interpProfile(wps, d) {
    if (d <= wps[0].d) return wps[0].z;
    for (let i = 1; i < wps.length; i++) if (d <= wps[i].d) return lerp(wps[i - 1].z, wps[i].z, (d - wps[i - 1].d) / (wps[i].d - wps[i - 1].d || 1));
    return wps[wps.length - 1].z;
  }

  // ------------------------------------------------------------------ main
  function plan(inp) {
    const geo = G(), env = E();
    const P = inp.platform, C = inp.camera, TR = inp.terrain;
    const warnings = [];
    const warn = (level, msg) => warnings.push({ level, msg });
    const isCorr = inp.mission === 'corridor';
    const srcLL = isCorr ? inp.line : inp.polygon;
    if (!srcLL || srcLL.length < (isCorr ? 2 : 3)) return { ok: false, error: isCorr ? 'Draw a corridor centre-line (≥ 2 points).' : 'Draw a survey polygon (≥ 3 points).' };

    // projection centred on the mission
    const lat0 = srcLL.reduce((s, p) => s + p[0], 0) / srcLL.length, lon0 = srcLL.reduce((s, p) => s + p[1], 0) / srcLL.length;
    const proj = geo.makeProjection(lat0, lon0);
    const toLL = (p) => proj.toLatLon(p[0], p[1]);

    // terrain access
    const elevFn = inp.elev || (() => NaN);
    let demN = 0, demMiss = 0;
    const fallback = isFinite(inp.fallbackElev) ? inp.fallbackElev : 0;
    const elevXY = (p) => { demN++; const ll = toLL(p); const z = elevFn(ll[0], ll[1]); if (!isFinite(z)) { demMiss++; return fallback; } return z; };

    // camera geometry
    const pitch = C.sw / C.iw; // mm/px
    const sAcross = inp.orientation === 'along' ? C.sh : C.sw, sAlong = inp.orientation === 'along' ? C.sw : C.sh;
    const gsdAt = (h) => (h * pitch) / C.f;
    const footX = (h) => (h * sAcross) / C.f, footY = (h) => (h * sAlong) / C.f;

    // area geometry
    const srcLocal = srcLL.map((p) => proj.toLocal(p[0], p[1]));
    const corrW = Math.max(1, inp.corridorWidth || 60);
    const areaPoly = isCorr ? geo.corridorPolygon(srcLocal, corrW / 2) : srcLocal;
    const areaM2 = isCorr ? geo.polylineLength(srcLocal) * corrW : Math.abs(geo.polygonArea(areaPoly));
    const home = inp.home ? proj.toLocal(inp.home[0], inp.home[1]) : geo.polygonCentroid(areaPoly);

    // ---- terrain survey of the area
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const p of areaPoly) { bx0 = Math.min(bx0, p[0]); by0 = Math.min(by0, p[1]); bx1 = Math.max(bx1, p[0]); by1 = Math.max(by1, p[1]); }
    const gstep = clamp(Math.sqrt(Math.max(areaM2, 1) / 3000), 5, 250);
    const tz = [];
    let zmin = Infinity, zmax = -Infinity, zsum = 0, slopeMax = 0, slopeSum = 0, slopeN = 0;
    const nx = Math.floor((bx1 - bx0) / gstep) + 1, ny = Math.floor((by1 - by0) / gstep) + 1;
    const grid = new Float64Array(nx * ny).fill(NaN);
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const p = [bx0 + i * gstep, by0 + j * gstep];
      if (!geo.pointInPolygon(p, areaPoly)) continue;
      const z = elevXY(p); grid[i * ny + j] = z; tz.push(z);
    }
    for (const p of areaPoly) tz.push(elevXY(p));
    for (const z of tz) { zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); zsum += z; }
    const zmean = zsum / tz.length;
    for (let i = 1; i < nx; i++) for (let j = 1; j < ny; j++) {
      const z = grid[i * ny + j], zx = grid[(i - 1) * ny + j], zy = grid[i * ny + j - 1];
      if (isNaN(z) || isNaN(zx) || isNaN(zy)) continue;
      const s = Math.atan(Math.hypot((z - zx) / gstep, (z - zy) / gstep)) / D2R;
      slopeMax = Math.max(slopeMax, s); slopeSum += s; slopeN++;
    }
    const zHome = isFinite(inp.homeElev) ? inp.homeElev : elevXY(home);
    const relief = zmax - zmin;

    // ---- altitude design
    const H = Math.max(5, inp.agl);
    const followOn = inp.altMode === 'follow';
    let zFixed = null, Hdesign = H, minAGLfixed = null, maxAGLfixed = null;
    if (!followOn) {
      const zRef = { takeoff: zHome, lowest: zmin, highest: zmax, mean: zmean }[inp.fixedRef || 'takeoff'];
      zFixed = zRef + H;
      minAGLfixed = zFixed - zmax; maxAGLfixed = zFixed - zmin;
      if (minAGLfixed <= 0) return { ok: false, error: `Fixed flight altitude (${zFixed.toFixed(0)} m ASL) is below the highest terrain in the area (${zmax.toFixed(0)} m). Raise the altitude, change the reference, or use terrain-following.` };
      if (inp.protectOverlap !== false) Hdesign = Math.min(H, minAGLfixed);
    }
    const front = clamp(inp.front, 10, 95) / 100, side = clamp(inp.side, 10, 95) / 100;
    const lineSpacing = footX(Hdesign) * (1 - side);
    const photoSpacing = footY(Hdesign) * (1 - front);

    // ---- passes
    const isFW = P.type === 'fixedwing';
    const margin = Math.max(0, inp.margin || 0);
    const ext = Math.max(0, inp.lineExtension != null ? inp.lineExtension : isFW ? 30 : 0);
    let angle = isCorr ? null : ((inp.angle % 180) + 180) % 180;
    if (!isCorr && inp.autoAngle) angle = bestAngle(areaPoly);
    let passes = [], nLinesA = 0, nLinesB = 0;
    if (isCorr) {
      const cover = footX(Hdesign);
      let n = corrW > cover ? Math.ceil((corrW - cover) / lineSpacing - 1e-9) + 1 : 1;
      n = Math.max(n, Math.max(1, inp.corridorMinLines || 2));
      const base = extendPolyline(srcLocal, margin + ext + footY(Hdesign) * 0.25);
      const lines = [];
      for (let k = 0; k < n; k++) lines.push(geo.offsetPolyline(base, (k - (n - 1) / 2) * lineSpacing));
      const variants = [];
      for (const revOrder of [false, true]) for (const firstRev of [false, true]) {
        const idx = lines.map((l, k) => k); if (revOrder) idx.reverse();
        const ps = idx.map((k, i) => { const rev = (i % 2 === 1) !== firstRev; return { pts: rev ? lines[k].slice().reverse() : lines[k], set: 0, corr: { k, n, rev } }; });
        variants.push({ ps, cost: geo.dist(home, ps[0].pts[0]) + geo.dist(ps[ps.length - 1].pts.slice(-1)[0], home) });
      }
      variants.sort((a, b) => a.cost - b.cost);
      passes = variants[0].ps;
      nLinesA = n;
    } else {
      const mergeGap = Math.max(footY(Hdesign), 25);
      const rowsA = gridRows(areaPoly, angle, lineSpacing, margin, ext, mergeGap);
      const pa = orderRows(rowsA, home, null);
      nLinesA = rowsA.length;
      passes = pa.map((s) => ({ pts: s, set: 0, row: s.row, nRows: s.n, fv: s.fv }));
      if (inp.mission === 'double') {
        const rowsB = gridRows(areaPoly, (angle + 90) % 180, lineSpacing, margin, ext, mergeGap);
        const pb = orderRows(rowsB, home, pa.length ? pa[pa.length - 1][1] : home);
        nLinesB = rowsB.length;
        passes = passes.concat(pb.map((s) => ({ pts: s, set: 1, row: s.row, nRows: s.n, fv: s.fv })));
      }
    }
    if (!passes.length) return { ok: false, error: 'No flight lines could be generated — check the area geometry.' };

    // ---- per-pass altitude profile, waypoints and photos
    const maxGrade = (inp.maxGrade != null ? inp.maxGrade : isFW ? 15 : 40) / 100;
    const tol = Math.max(0.5, inp.followTolerance || 3);
    const obstacle = Math.max(0, inp.obstacle || 0);
    const photos = [];
    const sampleStep = clamp(photoSpacing / 2, 4, 25);

    function followProfile(pts, Hreq, startZ, endZ) {
      const L = geo.polylineLength(pts);
      const n = Math.max(1, Math.ceil(L / sampleStep));
      const prof = [];
      for (let i = 0; i <= n; i++) {
        const d = (L * i) / n, p = geo.pointAlong(pts, d), g = elevXY(p);
        prof.push({ d, z: g + Hreq, ground: g });
      }
      if (startZ != null) prof[0].z = Math.max(prof[0].z, startZ);
      if (endZ != null) prof[prof.length - 1].z = Math.max(prof[prof.length - 1].z, endZ);
      limitGrade(prof, maxGrade);
      return { L, prof };
    }

    const kx = sAcross / (2 * C.f), ky = sAlong / (2 * C.f);
    /** Horizontal distance from nadir point p to where the image edge ray (half-FOV tan = kk) meets the terrain. */
    function extent(p, dir, z, kk) {
      let x = Math.max(0.1, (z - elevXY(p)) * kk);
      for (let it = 0; it < 6; it++) {
        const nx = Math.max(0.1, (z - elevXY([p[0] + dir[0] * x, p[1] + dir[1] * x])) * kk);
        if (Math.abs(nx - x) < 0.05) { x = nx; break; }
        x = it < 2 ? nx : 0.5 * (x + nx);
      }
      return x;
    }

    passes.forEach((ps, k) => {
      const pts = ps.pts;
      let wps;
      const L = geo.polylineLength(pts);
      if (followOn) {
        const { prof } = followProfile(pts, H);
        ps.profile = prof;
        wps = simplifySafe(prof, tol);
        // also keep polyline vertices (corridor bends)
        if (pts.length > 2) {
          let acc = 0; const vd = [0];
          for (let i = 1; i < pts.length; i++) { acc += geo.dist(pts[i - 1], pts[i]); vd.push(acc); }
          for (const d of vd.slice(1, -1)) if (!wps.some((w) => Math.abs(w.d - d) < 0.5)) wps.push({ d, z: interpProfile(wps, d), ground: elevXY(geo.pointAlong(pts, d)) });
          wps.sort((a, b) => a.d - b.d);
        }
      } else {
        let acc = 0; wps = [];
        pts.forEach((p, i) => { if (i) acc += geo.dist(pts[i - 1], p); wps.push({ d: acc, z: zFixed, ground: elevXY(p) }); });
      }
      ps.wps = wps.map((w) => { const p = geo.pointAlong(pts, w.d); return { x: p[0], y: p[1], z: w.z, ground: w.ground, d: w.d }; });
      ps.length = L;
      // photos (distance-triggered from line start)
      const nPh = Math.floor(L / photoSpacing + 1e-9) + 1;
      ps.photoStart = photos.length;
      const list = [];
      for (let j = 0; j < nPh; j++) {
        const d = j * photoSpacing, p = geo.pointAlong(pts, d), si = p[2];
        const a = pts[si], b = pts[si + 1] || pts[si];
        const L2 = geo.dist(a, b) || 1, u = [(b[0] - a[0]) / L2, (b[1] - a[1]) / L2], v = [u[1], -u[0]];
        const z = interpProfile(wps, d), g = elevXY(p);
        const aglC = z - g;
        // footprint edge distances on the real terrain (ray/terrain intersection per direction)
        const fwd = extent(p, u, z, ky), back = extent(p, [-u[0], -u[1]], z, ky);
        const right = extent(p, v, z, kx), left = extent(p, [-v[0], -v[1]], z, kx);
        // which neighbouring lines exist on the right / left of this photo
        let hasR, hasL;
        if (ps.corr) { const { k: ck, n: cn, rev } = ps.corr; hasR = rev ? ck < cn - 1 : ck > 0; hasL = rev ? ck > 0 : ck < cn - 1; }
        else { const sgn = v[0] * ps.fv[0] + v[1] * ps.fv[1] > 0; hasR = sgn ? ps.row < ps.nRows - 1 : ps.row > 0; hasL = sgn ? ps.row > 0 : ps.row < ps.nRows - 1; }
        const sideOv = [];
        const nb = (dir, own, ownOpp) => {
          const q = [p[0] + dir[0] * lineSpacing, p[1] + dir[1] * lineSpacing];
          const zq = followOn ? elevXY(q) + H : zFixed;
          const back2 = extent(q, [-dir[0], -dir[1]], zq, kx);
          return (own + back2 - lineSpacing) / (own + ownOpp);
        };
        if (hasR) sideOv.push(nb(v, right, left));
        if (hasL) sideOv.push(nb([-v[0], -v[1]], left, right));
        // clearance: highest ground within 20 m of the nadir point
        let gmax = g;
        for (const [sx, sy] of [[20, 0], [-20, 0], [0, 20], [0, -20]]) gmax = Math.max(gmax, elevXY([p[0] + u[0] * sx + v[0] * sy, p[1] + u[1] * sx + v[1] * sy]));
        list.push({
          x: p[0], y: p[1], z, ground: g, agl: aglC, pass: k, set: ps.set, u, fwd, back,
          gsd: gsdAt(aglC),
          side: sideOv.length ? Math.min(...sideOv) : null,
          clearance: z - gmax - obstacle
        });
      }
      list.forEach((ph, j) => {
        const nx = list[j + 1], pv = list[j - 1];
        ph.front = nx ? (ph.fwd + nx.back - photoSpacing) / (ph.fwd + ph.back) : pv ? (pv.fwd + ph.back - photoSpacing) / (ph.fwd + ph.back) : null;
        photos.push(ph);
      });
      ps.photoEnd = photos.length - 1;
      ps.bearing = geo.bearing(pts[0], pts[1]);
    });

    // ---- route assembly with terrain-safe transits
    const takeoffSafe = Math.max(10, inp.takeoffSafeHeight || 20);
    const route = []; // {x,y,z,ground,kind,pass,first,last}
    function addTransit(from, to, zFrom, zTo) {
      // straight connector, raised where needed to keep >= ground + H (follow) / at zFixed (fixed)
      const pts = [from, to];
      if (geo.dist(from, to) < 1) return;
      if (followOn) {
        const { prof } = followProfile(pts, Math.min(H, Math.max(obstacle + 10, H * 0.8)), zFrom, zTo);
        const s = simplifySafe(prof, tol);
        s.slice(1, -1).forEach((w) => { const p = geo.pointAlong(pts, w.d); route.push({ x: p[0], y: p[1], z: w.z, ground: w.ground, kind: 'transit', pass: -1 }); });
        return s;
      }
      // fixed altitude: verify the straight transit clears terrain + obstacles
      const L = geo.dist(from, to), n = Math.max(1, Math.ceil(L / sampleStep));
      for (let i = 1; i < n; i++) {
        const p = [lerp(from[0], to[0], i / n), lerp(from[1], to[1], i / n)];
        if (geo.dist(p, home) < 30) continue;
        transitClrMin = Math.min(transitClrMin, lerp(zFrom, zTo, i / n) - elevXY(p) - obstacle);
      }
      return null;
    }
    let transitClrMin = Infinity;
    // takeoff
    const firstZ = passes[0].wps[0].z;
    route.push({ x: home[0], y: home[1], z: zHome, ground: zHome, kind: 'home', pass: -1 });
    route.push({ x: home[0], y: home[1], z: Math.max(zHome + takeoffSafe, followOn ? zHome + takeoffSafe : zFixed), ground: zHome, kind: 'climb', pass: -1 });
    let last = route[route.length - 1];
    passes.forEach((ps, k) => {
      const w0 = ps.wps[0];
      const tr = addTransit([last.x, last.y], [w0.x, w0.y], last.z, w0.z);
      // if the transit start was raised (e.g. climb at home), lift the previous point
      if (tr && tr[0].z > last.z + 0.01) { if (last.kind === 'climb') last.z = tr[0].z; else route.push({ x: last.x, y: last.y, z: tr[0].z, ground: last.ground, kind: 'transit', pass: -1 }); }
      if (tr && tr[tr.length - 1].z > w0.z + 0.01) route.push({ x: w0.x, y: w0.y, z: tr[tr.length - 1].z, ground: w0.ground, kind: 'transit', pass: -1 });
      ps.routeStart = route.length;
      ps.wps.forEach((w, i) => route.push({ x: w.x, y: w.y, z: w.z, ground: w.ground, kind: 'line', pass: k, first: i === 0, last: i === ps.wps.length - 1 }));
      ps.routeEnd = route.length - 1;
      last = route[route.length - 1];
    });
    // return home
    const homeTop = { x: home[0], y: home[1], z: Math.max(zHome + takeoffSafe, followOn ? zHome + takeoffSafe : zFixed), ground: zHome };
    const trBack = addTransit([last.x, last.y], [home[0], home[1]], last.z, homeTop.z);
    if (trBack && trBack[0].z > last.z + 0.01) route.push({ x: last.x, y: last.y, z: trBack[0].z, ground: last.ground, kind: 'transit', pass: -1 });
    if (trBack) homeTop.z = Math.max(homeTop.z, trBack[trBack.length - 1].z);
    route.push(Object.assign(homeTop, { kind: 'descend', pass: -1 }));
    route.push({ x: home[0], y: home[1], z: zHome, ground: zHome, kind: 'land', pass: -1 });

    // ---- statistics on photos
    const stat = (arr) => { const a = arr.filter((v) => v != null && isFinite(v)); if (!a.length) return null; let mn = Infinity, mx = -Infinity, s = 0; for (const v of a) { mn = Math.min(mn, v); mx = Math.max(mx, v); s += v; } return { min: mn, max: mx, mean: s / a.length, n: a.length }; };
    const gsdS = stat(photos.map((p) => p.gsd)), frontS = stat(photos.map((p) => p.front)), sideS = stat(photos.map((p) => p.side)), aglS = stat(photos.map((p) => p.agl)), clrS = stat(photos.map((p) => p.clearance));
    const lowFront = photos.filter((p) => p.front != null && p.front < front - 0.05).length, lowSide = photos.filter((p) => p.side != null && p.side < side - 0.05).length;

    // ---- wind & speed
    const windAlt = env.windAt(inp.wind ? inp.wind.speed : 0, Math.max(Hdesign, 10), TR.alpha);
    const gustAlt = env.windAt(inp.wind ? (inp.wind.gust || inp.wind.speed) : 0, Math.max(Hdesign, 10), TR.alpha);
    const windTo = ((inp.wind ? inp.wind.dir : 0) + 180) * D2R;
    const wv = [Math.sin(windTo) * windAlt, Math.cos(windTo) * windAlt];
    const shutter = inp.shutter || 1 / 1000, maxBlur = inp.maxBlur || 0.5;
    const gsdMin = gsdS ? gsdS.min : gsdAt(Hdesign);
    const vBlur = (maxBlur * gsdMin) / shutter;
    const vInterval = photoSpacing / C.minInt;
    let speed, limitedBy = 'user';
    const gsOf = (u, va) => { const along = wv[0] * u[0] + wv[1] * u[1], cross = wv[0] * u[1] - wv[1] * u[0]; return Math.sqrt(Math.max(0, va * va - cross * cross)) + along; };
    if (!isFW) {
      const req = inp.speed > 0 ? inp.speed : P.speed;
      speed = Math.min(req, P.speed); if (P.speed < req) limitedBy = 'platform';
      if (vBlur < speed) { speed = vBlur; limitedBy = 'motion blur'; }
      if (vInterval < speed) { speed = vInterval; limitedBy = 'camera trigger interval'; }
      speed = Math.max(1, Math.floor(speed * 10) / 10);
    } else {
      speed = inp.speed > 0 ? clamp(inp.speed, P.speed * 0.8, P.speed * 1.3) : P.speed; limitedBy = 'airframe cruise';
    }
    // per-pass ground speed (fixed-wing affected by wind)
    let gsMax = speed, gsMin = speed;
    passes.forEach((ps) => {
      const a = ps.pts[0], b = ps.pts[1], L = geo.dist(a, b) || 1, u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      ps.gs = isFW ? Math.max(2, gsOf(u, speed)) : speed;
      gsMax = Math.max(gsMax, ps.gs); gsMin = Math.min(gsMin, ps.gs);
    });
    const blurPx = (gsMax * shutter) / gsdMin;
    const triggerInt = photoSpacing / gsMax;

    // ---- timing per route segment
    const vClimb = isFW ? 3 : 5, vDesc = isFW ? 3 : 3;
    const transitSpeed = isFW ? speed : Math.min(P.speed, Math.max(speed, 12));
    const segTime = [];
    let totalDist = 0, lineDist = 0;
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i];
      const dh = Math.hypot(b.x - a.x, b.y - a.y), dz = b.z - a.z;
      totalDist += dh;
      const onLine = b.kind === 'line' && !b.first && a.kind === 'line' && a.pass === b.pass;
      let v = onLine ? passes[b.pass].gs : transitSpeed;
      if (isFW && !onLine && dh > 0) { const u = [(b.x - a.x) / dh, (b.y - a.y) / dh]; v = Math.max(3, gsOf(u, speed)); }
      if (onLine) lineDist += dh;
      let t = dh / v;
      t = Math.max(t, dz > 0 ? dz / vClimb : -dz / vDesc);
      if (b.kind === 'line' && b.first) t += P.turnTime || 6;
      segTime.push(t);
    }
    const vtolOverhead = isFW ? 90 : 0;
    const flightTime = segTime.reduce((s, t) => s + t, 0) + vtolOverhead;

    // ---- endurance & battery planning
    const zFlightMean = route.reduce((s, r) => s + r.z, 0) / route.length;
    const tempAlt = (inp.temperature != null ? inp.temperature : 20) - 0.0065 * (zFlightMean - zHome);
    const air = env.airDensity(zFlightMean, tempAlt);
    const ef = env.enduranceFactor(P.type, air.sigma, inp.temperature != null ? inp.temperature : 20, windAlt, P.wind);
    const reserve = clamp(inp.reserve != null ? inp.reserve : 20, 0, 60) / 100;
    const usable = P.endurance * 60 * ef.total * (1 - reserve);
    // walk route to place battery swaps (must be able to return home from the swap point)
    const splits = [];
    let used = 0;
    const rtlTime = (p) => Math.hypot(p.x - home[0], p.y - home[1]) / transitSpeed + Math.max(0, p.z - zHome) / vDesc;
    const reTime = (p) => Math.hypot(p.x - home[0], p.y - home[1]) / transitSpeed + Math.max(0, p.z - zHome) / vClimb;
    let extraTime = 0;
    for (let i = 1; i < route.length; i++) {
      const t = segTime[i - 1];
      if (route[i].kind === 'descend' || route[i].kind === 'land') { used += t; continue; }
      if (used + t + rtlTime(route[i]) > usable && used > 0) {
        const p = route[i - 1];
        splits.push({ x: p.x, y: p.y, z: p.z, index: i - 1 });
        extraTime += rtlTime(p) + reTime(p) + (isFW ? vtolOverhead : 0);
        used = reTime(p);
        if (splits.length > 200) break;
      }
      used += t;
    }
    const totalTime = flightTime + extraTime;
    const batteries = splits.length + 1;

    // ---- extents & limits
    let maxRel = -Infinity, maxDist = 0, maxAGLroute = 0;
    route.forEach((r) => { if (r.kind === 'line' || r.kind === 'transit') { maxRel = Math.max(maxRel, r.z - zHome); maxAGLroute = Math.max(maxAGLroute, r.z - r.ground); } maxDist = Math.max(maxDist, Math.hypot(r.x - home[0], r.y - home[1])); });
    const maxAGLphotos = aglS ? aglS.max : H;
    const maxZ = Math.max(...route.map((r) => r.z));

    // ---- warnings
    if (demN && demMiss / demN > 0.02) warn('caution', `Terrain data unavailable for ${((100 * demMiss) / demN).toFixed(0)} % of samples — flat ground at ${fallback.toFixed(0)} m assumed there. Check your connection and re-plan.`);
    if (windAlt > P.wind) warn('danger', `Wind at flight height ≈ ${windAlt.toFixed(1)} m/s exceeds the ${P.name} limit (${P.wind} m/s). Do not fly.`);
    else if (gustAlt > P.wind) warn('caution', `Gusts at flight height ≈ ${gustAlt.toFixed(1)} m/s exceed the platform limit (${P.wind} m/s).`);
    else if (windAlt > 0.75 * P.wind) warn('caution', `Wind at flight height ≈ ${windAlt.toFixed(1)} m/s is above 75 % of the platform limit — expect reduced endurance and crab angle.`);
    if (maxZ > P.ceiling) warn('danger', `Highest planned altitude ${maxZ.toFixed(0)} m ASL exceeds the service ceiling (${P.ceiling} m).`);
    if (air.densityAltitude > 3000) warn('caution', `Density altitude ≈ ${air.densityAltitude.toFixed(0)} m — reduced lift and ${((1 - ef.density) * 100).toFixed(0)} % less endurance. Consider high-altitude propellers.`);
    const T0 = inp.temperature != null ? inp.temperature : 20;
    if (T0 < 0) warn('caution', `Ambient ${T0} °C — pre-heat batteries above 15 °C; capacity derated to ${(ef.temperature * 100).toFixed(0)} %.`);
    if (T0 > 40) warn('caution', `Ambient ${T0} °C — battery and motor overheating risk.`);
    if (!followOn) {
      if (relief > 0.2 * H) warn('caution', `Terrain relief ${relief.toFixed(0)} m is ${((100 * relief) / H).toFixed(0)} % of flight height — GSD varies ${gsdS ? (gsdS.min * 100).toFixed(1) + '–' + (gsdS.max * 100).toFixed(1) : ''} cm/px. Terrain-following is recommended.`);
      if (inp.protectOverlap !== false && Hdesign < H - 0.5) warn('info', `Line/photo spacing computed for the highest ground (effective ${Hdesign.toFixed(0)} m) to protect overlap.`);
    }
    if (clrS && clrS.min - (inp.demUncertainty || 0) < 0) warn('danger', `Minimum clearance above terrain + obstacles (${obstacle} m) is ${clrS.min.toFixed(0)} m, within DEM uncertainty (±${inp.demUncertainty || 0} m). Raise altitude or reduce obstacle height.`);
    else if (clrS && clrS.min - (inp.demUncertainty || 0) < 15) warn('caution', `Low clearance: ${clrS.min.toFixed(0)} m above highest obstacle in footprint (DEM uncertainty ±${inp.demUncertainty || 0} m).`);
    if (transitClrMin < 10) warn('danger', `Transit to/from take-off passes only ${transitClrMin.toFixed(0)} m above terrain + obstacles. Move the take-off point or raise the altitude.`);
    if (maxRel > (inp.maxRelAlt || 500)) warn('danger', `Route climbs to ${maxRel.toFixed(0)} m above take-off — exceeds the aircraft altitude limit (${inp.maxRelAlt || 500} m). Choose a take-off point on higher ground or split the mission.`);
    if (Math.max(maxAGLphotos, maxAGLroute) > (inp.legalAGL || 120) + 0.5) warn('caution', `Height above ground reaches ${Math.max(maxAGLphotos, maxAGLroute).toFixed(0)} m — above the ${inp.legalAGL || 120} m regulatory limit used in many jurisdictions.`);
    if (maxDist > (inp.vlos || 500)) warn('info', `Mission extends ${(maxDist / 1000).toFixed(2)} km from take-off — beyond the ${inp.vlos || 500} m VLOS reference. Ensure visual observers / BVLOS approval.`);
    if (!isFW && limitedBy === 'motion blur') warn('info', `Speed limited to ${speed.toFixed(1)} m/s by motion blur (≤ ${maxBlur} px at ${inp.shutterLabel || ''}). Faster shutter allows faster flight.`);
    if (!isFW && limitedBy === 'camera trigger interval') warn('info', `Speed limited to ${speed.toFixed(1)} m/s by the camera's minimum capture interval (${C.minInt} s).`);
    if (isFW && triggerInt < C.minInt) warn('danger', `Down-wind ground speed ${gsMax.toFixed(1)} m/s needs a ${triggerInt.toFixed(2)} s capture interval — faster than the camera (${C.minInt} s). Raise altitude, reduce front overlap, or orient lines crosswind.`);
    if (blurPx > maxBlur + 1e-6) warn(blurPx > 1 ? 'danger' : 'caution', `Motion blur up to ${blurPx.toFixed(2)} px (ground speed ${gsMax.toFixed(1)} m/s). Use a faster shutter.`);
    if (lowFront) warn('caution', `${lowFront} photos (${((100 * lowFront) / photos.length).toFixed(0)} %) fall > 5 % below the target front overlap because of terrain.`);
    if (lowSide) warn('caution', `${lowSide} photos (${((100 * lowSide) / photos.length).toFixed(0)} %) fall > 5 % below the target side overlap because of terrain.`);
    if (C.shutter === 'rolling') warn('info', 'Rolling-shutter camera: keep speed low or enable rolling-shutter correction in processing (Pix4D / Metashape).');
    if (/RE|NIR/.test(C.bands)) warn('info', 'Multispectral: capture the calibration reflectance panel before and after the flight; fly within ±2 h of solar noon.');
    if (isFW && lineSpacing < 2 * (P.turnRadius || 50)) warn('info', `Line spacing ${lineSpacing.toFixed(0)} m < turn diameter — the autopilot will use loop/skip turns (accounted for in time).`);
    if (batteries > 1) warn('info', `${batteries} batteries required (${splits.length} swap${splits.length > 1 ? 's' : ''}) with ${(reserve * 100).toFixed(0)} % reserve.`);
    if (isCorr && nLinesA < 2) warn('caution', 'Single-line corridors give weak geometry — use ≥ 2 lines or GCPs on both sides.');
    if (TR.doubleGrid && inp.mission === 'area') warn('info', 'Double-grid (crosshatch) mission is recommended for this terrain type.');
    if (TR.follow === 'on' && !followOn) warn('caution', 'Terrain-following is recommended for this terrain type.');

    // ---- accuracy estimate (rule-of-thumb)
    const gr = UAV.data.georef[inp.georef || 'rtk_gcp'];
    const gm = gsdS ? gsdS.mean : gsdAt(H);
    const accuracy = gr.fixed >= 1 ? { h: [gr.fixed * 0.4, gr.fixed], v: [gr.fixedV * 0.4, gr.fixedV], method: gr.name } : { h: [gr.h[0] * gm + gr.fixed, gr.h[1] * gm + gr.fixed], v: [gr.v[0] * gm + gr.fixed, gr.v[1] * gm + gr.fixed], method: gr.name };

    // ---- profile along route for chart
    const profile = [];
    let dacc = 0;
    const pStep = Math.max(3, totalDist / 1200);
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i];
      const dh = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(dh / pStep));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) {
        const t = k / n, x = lerp(a.x, b.x, t), y = lerp(a.y, b.y, t);
        const g = (k === 0 ? a.ground : k === n ? b.ground : elevXY([x, y]));
        profile.push({ d: dacc + dh * t, z: lerp(a.z, b.z, t), ground: g, line: b.kind === 'line' && !b.first, x, y });
      }
      dacc += dh;
    }

    // ---- outputs in lat/lon
    const LL = (p) => toLL([p.x, p.y]);
    const photosLL = photos.map((p) => { const ll = LL(p); return Object.assign(p, { lat: ll[0], lon: ll[1] }); });
    const routeLL = route.map((r) => { const ll = LL(r); return Object.assign(r, { lat: ll[0], lon: ll[1], rel: r.z - zHome }); });
    const footprint = (ph) => {
      const hx = footX(Math.max(ph.agl, 1)) / 2, hy = footY(Math.max(ph.agl, 1)) / 2, u = ph.u, v = [u[1], -u[0]];
      return [[hy, hx], [hy, -hx], [-hy, -hx], [-hy, hx]].map(([a, b]) => toLL([ph.x + u[0] * a + v[0] * b, ph.y + u[1] * a + v[1] * b]));
    };

    return {
      ok: true, warnings, proj,
      area: { m2: areaM2, polygon: areaPoly.map(toLL), perimeter: geo.polylineLength(areaPoly.concat([areaPoly[0]])) },
      terrain: { zmin, zmax, zmean, relief, slopeMax, slopeMean: slopeN ? slopeSum / slopeN : 0, zHome, demMissing: demN ? demMiss / demN : 0 },
      design: { H, Hdesign, zFixed, minAGLfixed, maxAGLfixed, gsdTarget: gsdAt(H), footX: footX(Hdesign), footY: footY(Hdesign), lineSpacing, photoSpacing, angle, followOn, nLinesA, nLinesB, corridorLines: isCorr ? nLinesA : 0 },
      photos: photosLL, route: routeLL, passes, footprint,
      stats: { gsd: gsdS, front: frontS, side: sideS, agl: aglS, clearance: clrS, lowFront, lowSide, nPhotos: photos.length, storageGB: (photos.length * C.mb) / 1024, maxRel, maxDist, maxAGL: Math.max(maxAGLphotos, maxAGLroute), maxZ },
      flight: { speed, limitedBy, gsMin, gsMax, blurPx, triggerInt, vBlur, vInterval, totalDist, lineDist, flightTime, totalTime, batteries, splits: splits.map((s) => Object.assign(s, (([lat, lon]) => ({ lat, lon }))(toLL([s.x, s.y])))), usable, endurance: ef, air, windAlt, gustAlt, reserve },
      accuracy, profile
    };
  }

  UAV.planner = { plan, bestAngle, gridRows, bandIntervals, limitGrade, simplifySafe };
})(typeof window !== 'undefined' ? window : globalThis);
