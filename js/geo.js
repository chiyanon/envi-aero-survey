/*
 * EnviAeroSurvey: Mahidol University — geodesy & planar geometry.
 * Local Transverse Mercator (Krüger series, WGS84, k0 = 1) centred on the mission area,
 * giving sub-millimetre projection error and < 0.01 % scale error within ±50 km.
 */
(function (root) {
  const UAV = (root.UAV = root.UAV || {});
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  // WGS84 Krüger coefficients
  const a = 6378137, f = 1 / 298.257223563, n = f / (2 - f);
  const n2 = n * n, n3 = n2 * n, n4 = n3 * n;
  const A = (a / (1 + n)) * (1 + n2 / 4 + n4 / 64);
  const alpha = [n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180, (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440, (61 * n3) / 240 - (103 * n4) / 140, (49561 * n4) / 161280];
  const beta = [n / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360, n2 / 48 + n3 / 15 - (437 * n4) / 1440, (17 * n3) / 480 - (37 * n4) / 840, (4397 * n4) / 161280];
  const delta = [2 * n - (2 * n2) / 3 - 2 * n3 + (116 * n4) / 45, (7 * n2) / 3 - (8 * n3) / 5 - (227 * n4) / 45, (56 * n3) / 15 - (136 * n4) / 35, (4279 * n4) / 630];
  const e2n = (2 * Math.sqrt(n)) / (1 + n); // first eccentricity

  function tmForward(lat, lon, lon0) {
    const phi = lat * D2R, lam = (lon - lon0) * D2R;
    const sp = Math.sin(phi);
    const t = Math.sinh(Math.atanh(sp) - e2n * Math.atanh(e2n * sp));
    const xi_ = Math.atan2(t, Math.cos(lam));
    const eta_ = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
    let xi = xi_, eta = eta_;
    for (let j = 1; j <= 4; j++) {
      xi += alpha[j - 1] * Math.sin(2 * j * xi_) * Math.cosh(2 * j * eta_);
      eta += alpha[j - 1] * Math.cos(2 * j * xi_) * Math.sinh(2 * j * eta_);
    }
    return [A * eta, A * xi];
  }

  function tmInverse(E, N, lon0) {
    const xi = N / A, eta = E / A;
    let xi_ = xi, eta_ = eta;
    for (let j = 1; j <= 4; j++) {
      xi_ -= beta[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
      eta_ -= beta[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    }
    const chi = Math.asin(Math.sin(xi_) / Math.cosh(eta_));
    let phi = chi;
    for (let j = 1; j <= 4; j++) phi += delta[j - 1] * Math.sin(2 * j * chi);
    const lam = Math.atan2(Math.sinh(eta_), Math.cos(xi_));
    return [phi * R2D, lon0 + lam * R2D];
  }

  /** Local metric frame centred on (lat0, lon0): x = east, y = north (metres). */
  function makeProjection(lat0, lon0) {
    const o = tmForward(lat0, lon0, lon0);
    return {
      lat0, lon0,
      toLocal(lat, lon) { const p = tmForward(lat, lon, lon0); return [p[0] - o[0], p[1] - o[1]]; },
      toLatLon(x, y) { return tmInverse(x + o[0], y + o[1], lon0); }
    };
  }

  // ---------------------------------------------------------------- planar helpers
  const dist = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);

  function polygonArea(pts) { // signed (CCW positive)
    let s = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    return s / 2;
  }

  function polygonCentroid(pts) {
    let cx = 0, cy = 0, s = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const c = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
      s += c; cx += (pts[j][0] + pts[i][0]) * c; cy += (pts[j][1] + pts[i][1]) * c;
    }
    if (Math.abs(s) < 1e-9) return pts.reduce((m, p) => [m[0] + p[0] / pts.length, m[1] + p[1] / pts.length], [0, 0]);
    return [cx / (3 * s), cy / (3 * s)];
  }

  function pointInPolygon(p, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function polylineLength(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]); return L; }

  /** Point at distance d along polyline (clamped). Returns [x, y, segIndex]. */
  function pointAlong(pts, d) {
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const L = dist(pts[i - 1], pts[i]);
      if (acc + L >= d || i === pts.length - 1) {
        const t = L > 0 ? Math.min(1, Math.max(0, (d - acc) / L)) : 0;
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t, i - 1];
      }
      acc += L;
    }
    return [pts[0][0], pts[0][1], 0];
  }

  /** Offset an open polyline by distance o (positive = left of travel direction), mitred joins. */
  function offsetPolyline(pts, o) {
    const out = [];
    const nrm = (p, q) => { const L = dist(p, q) || 1; return [-(q[1] - p[1]) / L, (q[0] - p[0]) / L]; };
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) { const nn = nrm(pts[0], pts[1]); out.push([pts[0][0] + nn[0] * o, pts[0][1] + nn[1] * o]); continue; }
      if (i === pts.length - 1) { const nn = nrm(pts[i - 1], pts[i]); out.push([pts[i][0] + nn[0] * o, pts[i][1] + nn[1] * o]); continue; }
      const n1 = nrm(pts[i - 1], pts[i]), n2 = nrm(pts[i], pts[i + 1]);
      let mx = n1[0] + n2[0], my = n1[1] + n2[1];
      const ml = Math.hypot(mx, my);
      if (ml < 1e-6) { out.push([pts[i][0] + n1[0] * o, pts[i][1] + n1[1] * o]); continue; }
      mx /= ml; my /= ml;
      const cosHalf = mx * n1[0] + my * n1[1];
      const scale = Math.min(4, 1 / Math.max(cosHalf, 0.25)); // limit miter spikes
      out.push([pts[i][0] + mx * o * scale, pts[i][1] + my * o * scale]);
    }
    return out;
  }

  /** Buffer polygon for an open polyline with half-width w (simple: left & right offsets joined). */
  function corridorPolygon(pts, w) {
    const l = offsetPolyline(pts, w), r = offsetPolyline(pts, -w).reverse();
    return l.concat(r);
  }

  /** Bearing (deg from north, clockwise) of vector p->q in local frame. */
  function bearing(p, q) { return (Math.atan2(q[0] - p[0], q[1] - p[1]) * R2D + 360) % 360; }

  /** Great-circle distance (m) — used for display only. */
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371008.8, dLat = (lat2 - lat1) * D2R, dLon = (lon2 - lon1) * D2R;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  /** Douglas–Peucker on a 1-D profile [{d, z}], returns kept indices. */
  function simplifyProfile(prof, tol) {
    const keep = new Uint8Array(prof.length); keep[0] = keep[prof.length - 1] = 1;
    const stack = [[0, prof.length - 1]];
    while (stack.length) {
      const [i0, i1] = stack.pop();
      let maxE = 0, idx = -1;
      const d0 = prof[i0].d, z0 = prof[i0].z, dd = prof[i1].d - d0, dz = prof[i1].z - z0;
      for (let i = i0 + 1; i < i1; i++) {
        const zi = dd > 0 ? z0 + (dz * (prof[i].d - d0)) / dd : z0;
        const e = Math.abs(prof[i].z - zi);
        if (e > maxE) { maxE = e; idx = i; }
      }
      if (maxE > tol && idx > 0) { keep[idx] = 1; stack.push([i0, idx], [idx, i1]); }
    }
    const out = []; for (let i = 0; i < prof.length; i++) if (keep[i]) out.push(i);
    return out;
  }

  UAV.geo = { D2R, R2D, makeProjection, tmForward, tmInverse, dist, polygonArea, polygonCentroid, pointInPolygon, polylineLength, pointAlong, offsetPolyline, corridorPolygon, bearing, haversine, simplifyProfile };
})(typeof window !== 'undefined' ? window : globalThis);
