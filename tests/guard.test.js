// Guardrail tests — run: node tests/guard.test.js
require('../js/guard.js');
const G = globalThis.UAV.guard;
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

let calls = 0, nextStatus = 200;
globalThis.fetch = async () => { calls++; return { status: nextStatus, ok: nextStatus < 400, json: async () => ({ hello: 'world', reason: 'x' }) }; };

(async () => {
  console.log('Search rate limits & cache');
  const r1 = await G.fetchJSON('search', 'u', 'bangkok');
  ok(!r1.cached && calls === 1, 'first search hits the network');
  const r2 = await G.fetchJSON('search', 'u', 'bangkok');
  ok(r2.cached && calls === 1, 'repeat search served from cache (no request)');
  let err = null; try { await G.fetchJSON('search', 'u', 'salaya'); } catch (e) { err = e; }
  ok(err && err.code === 'interval' && calls === 1, 'second request within 1.5 s is blocked locally');

  console.log('Hourly cap');
  G.CONFIG.forecast.minIntervalMs = 0;
  for (let i = 0; i < G.CONFIG.forecast.maxPerHour; i++) await G.fetchJSON('forecast', 'u', null);
  err = null; try { await G.fetchJSON('forecast', 'u', null); } catch (e) { err = e; }
  ok(err && err.code === 'hourly', `request ${G.CONFIG.forecast.maxPerHour + 1} in an hour is refused`);

  console.log('Back-off on 429');
  G.CONFIG.search.minIntervalMs = 0; nextStatus = 429; const before = calls;
  err = null; try { await G.fetchJSON('search', 'u', 'nakhon pathom'); } catch (e) { err = e; }
  ok(err && err.code === 'limited', '429 reply reported as limited');
  nextStatus = 200; err = null; try { await G.fetchJSON('search', 'u', 'chiang mai'); } catch (e) { err = e; }
  ok(err && err.code === 'cooldown' && calls === before + 1, 'service pauses itself after 429 (no further requests)');

  console.log('Kill switch & terrain budget');
  G.CONFIG.forecast.enabled = false; err = null; try { await G.fetchJSON('forecast', 'u', null); } catch (e) { err = e; }
  ok(err && err.code === 'disabled', 'disabled service makes no request');
  G.CONFIG.terrain.maxTilesPerSession = 3;
  const t = [1, 2, 3, 4].map(() => G.terrainTileAllowed());
  ok(t.join() === 'true,true,true,false', 'terrain tile budget enforced');

  console.log(fails ? `\n${fails} FAILED` : '\nAll guard tests passed');
  process.exit(fails ? 1 : 0);
})();
