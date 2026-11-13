/*
 * EnviAeroSurvey: Mahidol University — service guardrails.
 *
 * The app is a static site: every external request is made by the visitor's own browser,
 * with no API keys, so nothing can be billed to the site owner. These guardrails keep usage
 * well inside each free service's fair-use policy so the site is not throttled or blocked:
 *   • per-browser rate limits (minimum interval, hourly and daily caps)
 *   • response caching (repeat searches / forecasts cost no requests)
 *   • automatic cool-down after HTTP 429 / 403 / 5xx ("slow down") responses
 *   • request time-outs and kill switches (set enabled: false to turn a service off)
 *   • a per-session budget for terrain tiles
 * Owners: change limits or switch a service off in CONFIG below — no other code changes needed.
 */
(function (root) {
  const UAV = (root.UAV = root.UAV || {});
  const NS = 'enviaerosurvey.guard.';
  const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;

  const CONFIG = {
    search: {   // OpenStreetMap Nominatim — policy: ≤ 1 request/s, no autocomplete, cache results
      enabled: true, label: 'Place search (OpenStreetMap Nominatim)',
      minIntervalMs: 1500, maxPerHour: 30, maxPerDay: 120, cacheTtlMs: 7 * DAY, cooldownMs: 30 * MIN, timeoutMs: 10000
    },
    forecast: { // Open-Meteo — free for non-commercial use, ~10 000 calls/day per client
      enabled: true, label: 'Weather forecast (Open-Meteo)',
      minIntervalMs: 5000, maxPerHour: 20, maxPerDay: 80, cacheTtlMs: 1 * HOUR, cooldownMs: 1 * HOUR, timeoutMs: 12000
    },
    terrain: {  // AWS Open Data terrain tiles — free; budget prevents runaway loading
      enabled: true, label: 'Terrain model (AWS Terrain Tiles)', maxTilesPerSession: 2500
    },
    basemap: {  // map tiles — fall back to satellite if a community tile server refuses requests
      errorThreshold: 15, errorWindowMs: MIN
    }
  };

  // localStorage with an in-memory mirror, so limits and cache still work when storage is blocked (private mode)
  const mem = {};
  const ls = {
    get(k) { let v = null; try { v = JSON.parse(localStorage.getItem(NS + k)); } catch (e) { v = null; } return v != null ? v : (mem[k] !== undefined ? mem[k] : null); },
    set(k, v) { mem[k] = v; try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) { /* storage full / blocked */ } },
    del(k) { delete mem[k]; try { localStorage.removeItem(NS + k); } catch (e) { /* ignore */ } }
  };
  const getLog = (svc) => (ls.get('log.' + svc) || mem['log.' + svc] || []).filter((t) => Date.now() - t < DAY);
  const setLog = (svc, arr) => { mem['log.' + svc] = arr; ls.set('log.' + svc, arr); };

  class GuardError extends Error { constructor(msg, code) { super(msg); this.code = code; } }

  const fmtWait = (ms) => (ms >= HOUR ? `${Math.ceil(ms / HOUR)} h` : ms >= MIN ? `${Math.ceil(ms / MIN)} min` : `${Math.ceil(ms / 1000)} s`);

  /** Is a request to this service allowed right now? */
  function check(svc) {
    const c = CONFIG[svc];
    if (!c || c.enabled === false) return { ok: false, code: 'disabled', msg: `${c ? c.label : svc} is switched off on this site.` };
    const now = Date.now();
    const until = ls.get('cool.' + svc) || mem['cool.' + svc] || 0;
    if (until > now) return { ok: false, code: 'cooldown', wait: until - now, msg: `${c.label} asked us to slow down. Paused for ${fmtWait(until - now)} to avoid being blocked.` };
    const log = getLog(svc);
    const last = log.length ? log[log.length - 1] : 0;
    if (c.minIntervalMs && now - last < c.minIntervalMs) return { ok: false, code: 'interval', wait: c.minIntervalMs - (now - last), msg: `Please wait ${fmtWait(c.minIntervalMs - (now - last))} between requests (${c.label} fair-use limit).` };
    const hour = log.filter((t) => now - t < HOUR);
    if (c.maxPerHour && hour.length >= c.maxPerHour) { const w = HOUR - (now - hour[0]); return { ok: false, code: 'hourly', wait: w, msg: `Hourly limit reached for ${c.label} (${c.maxPerHour}/h) — try again in ${fmtWait(w)}.` }; }
    if (c.maxPerDay && log.length >= c.maxPerDay) { const w = DAY - (now - log[0]); return { ok: false, code: 'daily', wait: w, msg: `Daily limit reached for ${c.label} (${c.maxPerDay}/day) — try again in ${fmtWait(w)}.` }; }
    return { ok: true };
  }
  function record(svc) { const log = getLog(svc); log.push(Date.now()); setLog(svc, log.slice(-500)); }
  function cooldown(svc, ms) { const until = Date.now() + (ms || CONFIG[svc].cooldownMs || HOUR); mem['cool.' + svc] = until; ls.set('cool.' + svc, until); }

  // ---------------------------------------------------------------- response cache (localStorage, LRU-ish, per service)
  function cacheGet(svc, key) {
    const c = ls.get('cache.' + svc) || {};
    const e = c[key];
    if (e && Date.now() - e.t < CONFIG[svc].cacheTtlMs) return e.v;
    return undefined;
  }
  function cacheSet(svc, key, v) {
    const c = ls.get('cache.' + svc) || {};
    c[key] = { t: Date.now(), v };
    const keys = Object.keys(c).sort((a, b) => c[a].t - c[b].t);
    while (keys.length > 40) delete c[keys.shift()];
    ls.set('cache.' + svc, c);
  }

  /**
   * Guarded JSON fetch: cache → limits → time-out → back-off on 429/403/5xx.
   * Throws GuardError with a user-friendly message when a request is not made or fails.
   */
  async function fetchJSON(svc, url, cacheKey, opts) {
    const c = CONFIG[svc];
    if (cacheKey) { const hit = cacheGet(svc, cacheKey); if (hit !== undefined) return { data: hit, cached: true }; }
    const ok = check(svc);
    if (!ok.ok) throw new GuardError(ok.msg, ok.code);
    record(svc);
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), c.timeoutMs || 10000) : null;
    let r;
    try { r = await fetch(url, Object.assign({ signal: ctl ? ctl.signal : undefined, referrerPolicy: 'strict-origin-when-cross-origin' }, opts || {})); }
    catch (e) { throw new GuardError(e.name === 'AbortError' ? `${c.label} did not respond in time.` : `${c.label} is unreachable (offline?).`, 'network'); }
    finally { if (timer) clearTimeout(timer); }
    if (r.status === 429 || r.status === 403 || r.status === 418) { cooldown(svc); throw new GuardError(`${c.label} is limiting requests from this browser. Paused for ${fmtWait(c.cooldownMs)} to avoid a block.`, 'limited'); }
    if (r.status >= 500) { cooldown(svc, 5 * MIN); throw new GuardError(`${c.label} is temporarily unavailable. Try again in a few minutes.`, 'server'); }
    let data;
    try { data = await r.json(); } catch (e) { throw new GuardError(`${c.label} returned an unreadable response.`, 'parse'); }
    if (!r.ok) throw new GuardError((data && (data.reason || data.error)) || `${c.label} error ${r.status}.`, 'http');
    if (cacheKey) cacheSet(svc, cacheKey, data);
    return { data, cached: false };
  }

  // ---------------------------------------------------------------- terrain tile budget (per page session)
  let terrainTiles = 0, terrainWarned = false;
  function terrainTileAllowed() {
    if (CONFIG.terrain.enabled === false) return false;
    if (terrainTiles >= CONFIG.terrain.maxTilesPerSession) { terrainWarned = true; return false; }
    terrainTiles++; return true;
  }

  /** Summary of this browser's usage — shown in Help → Fair use. */
  function usage() {
    const now = Date.now();
    return ['search', 'forecast'].map((svc) => {
      const log = getLog(svc), c = CONFIG[svc];
      return { svc, label: c.label, enabled: c.enabled !== false, hour: log.filter((t) => now - t < HOUR).length, maxPerHour: c.maxPerHour, day: log.length, maxPerDay: c.maxPerDay, cooldown: Math.max(0, (ls.get('cool.' + svc) || mem['cool.' + svc] || 0) - now) };
    }).concat([{ svc: 'terrain', label: CONFIG.terrain.label, enabled: CONFIG.terrain.enabled !== false, session: terrainTiles, maxPerSession: CONFIG.terrain.maxTilesPerSession, exhausted: terrainWarned }]);
  }

  UAV.guard = { CONFIG, check, record, cooldown, fetchJSON, cacheGet, cacheSet, terrainTileAllowed, usage, GuardError, fmtWait };
})(typeof window !== 'undefined' ? window : globalThis);
