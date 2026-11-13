/*
 * EnviAeroSurvey: Mahidol University — terrain model loader.
 * Uses the public AWS "Terrain Tiles" dataset (Terrarium PNG encoding, no API key, CORS enabled):
 *   elevation = (R * 256 + G + B / 256) - 32768   [metres, ~EGM96 / MSL]
 * Source blend: SRTM 30 m, NED 10 m / 3 m (USA), ETOPO1, EU-DEM, ArcticDEM, etc.
 */
(function (root) {
  const UAV = (root.UAV = root.UAV || {});
  const URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  const TILE = 256;

  const cache = new Map(); // key z/x/y -> Float32Array | 'loading' promise | null
  let zoom = 14;

  const lon2x = (lon, z) => ((lon + 180) / 360) * Math.pow(2, z);
  const lat2y = (lat, z) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z); };

  function loadTile(z, x, y) {
    const key = z + '/' + x + '/' + y;
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (typeof Image === 'undefined') return Promise.resolve(null);
    if (UAV.guard && !UAV.guard.terrainTileAllowed()) return Promise.resolve(null); // session budget reached
    const p = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas'); c.width = c.height = TILE;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          const d = ctx.getImageData(0, 0, TILE, TILE).data;
          const arr = new Float32Array(TILE * TILE);
          for (let i = 0, j = 0; i < arr.length; i++, j += 4) arr[i] = d[j] * 256 + d[j + 1] + d[j + 2] / 256 - 32768;
          cache.set(key, arr); resolve(arr);
        } catch (e) { cache.set(key, null); resolve(null); }
      };
      img.onerror = () => { cache.set(key, null); resolve(null); };
      img.src = URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    });
    cache.set(key, p);
    return p.then((v) => { cache.set(key, v); return v; });
  }

  /** Choose zoom so the bbox needs at most maxTiles tiles (z 10–15). */
  function chooseZoom(b, maxTiles) {
    for (let z = 15; z >= 10; z--) {
      const nx = Math.floor(lon2x(b.east, z)) - Math.floor(lon2x(b.west, z)) + 1;
      const ny = Math.floor(lat2y(b.south, z)) - Math.floor(lat2y(b.north, z)) + 1;
      if (nx * ny <= maxTiles) return z;
    }
    return 10;
  }

  /** Ensure tiles covering bbox {south, west, north, east} are loaded. Resolves {zoom, tiles, failed}. */
  async function ensure(b, maxTiles = 48) {
    const z = chooseZoom(b, maxTiles);
    zoom = z;
    const x0 = Math.floor(lon2x(b.west, z)), x1 = Math.floor(lon2x(b.east, z));
    const y0 = Math.floor(lat2y(b.north, z)), y1 = Math.floor(lat2y(b.south, z));
    const jobs = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push(loadTile(z, x, y));
    const res = await Promise.all(jobs);
    return { zoom: z, tiles: res.length, failed: res.filter((r) => !r).length, resolution: resolution(((b.south + b.north) / 2), z) };
  }

  function resolution(lat, z) { return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z); }

  function pix(z, tx, ty, px, py) {
    // handle pixel overflow into neighbour tiles
    if (px >= TILE) { tx += 1; px -= TILE; } if (py >= TILE) { ty += 1; py -= TILE; }
    const t = cache.get(z + '/' + tx + '/' + ty);
    if (!t || t instanceof Promise) return NaN;
    return t[py * TILE + px];
  }

  /** Bilinear elevation sample (m) or NaN when tile unavailable. */
  function sample(lat, lon) {
    const z = zoom;
    const fx = lon2x(lon, z) * TILE - 0.5, fy = lat2y(lat, z) * TILE - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy), dx = fx - ix, dy = fy - iy;
    const get = (X, Y) => { const tx = Math.floor(X / TILE), ty = Math.floor(Y / TILE); return pix(z, tx, ty, X - tx * TILE, Y - ty * TILE); };
    const a = get(ix, iy), b = get(ix + 1, iy), c = get(ix, iy + 1), d = get(ix + 1, iy + 1);
    if ([a, b, c, d].some(isNaN)) { const v = [a, b, c, d].filter((q) => !isNaN(q)); return v.length ? v.reduce((s, q) => s + q, 0) / v.length : NaN; }
    return a * (1 - dx) * (1 - dy) + b * dx * (1 - dy) + c * (1 - dx) * dy + d * dx * dy;
  }

  UAV.dem = { ensure, sample, get zoom() { return zoom; }, resolution };
})(typeof window !== 'undefined' ? window : globalThis);
