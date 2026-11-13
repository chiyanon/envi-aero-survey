/*
 * EnviAeroSurvey: Mahidol University — environment models: sun position (NOAA), ISA air density, wind shear, endurance derating.
 */
(function (root) {
  const UAV = (root.UAV = root.UAV || {});
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  /** Solar elevation/azimuth (deg) for a JS Date (absolute instant) at lat/lon — NOAA algorithm. */
  function sunPosition(date, lat, lon) {
    const jd = date.getTime() / 86400000 + 2440587.5;
    const T = (jd - 2451545) / 36525;
    const L0 = (((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360) + 360) % 360;
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    const Mr = M * D2R;
    const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
    const omega = 125.04 - 1934.136 * T;
    const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * D2R);
    const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    const eps = (eps0 + 0.00256 * Math.cos(omega * D2R)) * D2R;
    const decl = Math.asin(Math.sin(eps) * Math.sin(lambda * D2R));
    const y = Math.tan(eps / 2) ** 2, L0r = L0 * D2R;
    const eot = 4 * R2D * (y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr) + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) - 0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr));
    const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
    const tst = (((utcMin + eot + 4 * lon) % 1440) + 1440) % 1440;
    const ha = (tst / 4 - 180) * D2R, latr = lat * D2R;
    const cosZ = Math.sin(latr) * Math.sin(decl) + Math.cos(latr) * Math.cos(decl) * Math.cos(ha);
    const zen = Math.acos(Math.max(-1, Math.min(1, cosZ)));
    let elev = 90 - zen * R2D;
    // atmospheric refraction (Bennett), small correction near horizon
    if (elev > -1) elev += 1.02 / Math.tan((elev + 10.3 / (elev + 5.11)) * D2R) / 60;
    const az = (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(latr) - Math.tan(decl) * Math.cos(latr)) * R2D + 180 + 360) % 360;
    return { elevation: elev, azimuth: az, declination: decl * R2D };
  }

  /** Sample a whole local day: returns windows where elevation >= minElev. utcOffsetH = site UTC offset (h). */
  function sunDay(dateStr, utcOffsetH, lat, lon, minElev) {
    const base = Date.parse(dateStr + 'T00:00:00Z') - utcOffsetH * 3600000;
    const samples = [];
    let maxE = -90, noon = null;
    for (let m = 0; m <= 1440; m += 5) {
      const d = new Date(base + m * 60000), s = sunPosition(d, lat, lon);
      samples.push({ minute: m, elev: s.elevation, az: s.azimuth });
      if (s.elevation > maxE) { maxE = s.elevation; noon = m; }
    }
    const win = (thr) => {
      let a = null, b = null;
      for (const s of samples) if (s.elev >= thr) { if (a === null) a = s.minute; b = s.minute; }
      return a === null ? null : [a, b];
    };
    return { samples, maxElev: maxE, noonMinute: noon, window: win(minElev), daylight: win(-0.833) };
  }

  /** ISA pressure & density ratio at elevation h (m) and temperature T (°C). */
  function airDensity(h, T) {
    const p = 101325 * Math.pow(1 - 2.25577e-5 * Math.max(-500, h), 5.25588);
    const rho = p / (287.05 * (T + 273.15));
    const sigma = rho / 1.225;
    // density altitude (ft-free, metres): invert ISA density relation
    const da = (1 - Math.pow(sigma, 0.234969)) / 2.25577e-5;
    return { pressure: p, rho, sigma, densityAltitude: da };
  }

  /** Power-law wind profile: wind at height h from 10 m reference. */
  function windAt(v10, h, alpha) { return v10 * Math.pow(Math.max(h, 2) / 10, alpha); }

  /** Battery temperature capacity factor (Li-ion/LiPo, typical). */
  function tempFactor(T) {
    if (T >= 20 && T <= 35) return 1;
    if (T > 35) return Math.max(0.85, 1 - (T - 35) * 0.01);
    if (T >= 0) return 0.85 + (T / 20) * 0.15;      // 0 °C -> 0.85
    return Math.max(0.55, 0.85 + T * 0.015);          // -10 °C -> 0.70, -20 °C -> 0.55
  }

  /**
   * Endurance derating relative to manufacturer nominal (sea level, 25 °C, no wind).
   * Multirotor: hover power ∝ 1/sqrt(ρ) -> endurance ∝ sqrt(σ). Fixed-wing at constant IAS: power ∝ 1/sqrt(σ) as well.
   */
  function enduranceFactor(type, sigma, T, wind, windMax) {
    const fd = Math.sqrt(Math.min(1.05, sigma));
    const ft = tempFactor(T);
    const r = Math.min(1.2, wind / Math.max(1, windMax));
    const fw = type === 'fixedwing' ? 1 - 0.25 * r * r : 1 - 0.35 * r * r;
    return { total: fd * ft * fw, density: fd, temperature: ft, wind: fw };
  }

  UAV.env = { sunPosition, sunDay, airDensity, windAt, tempFactor, enduranceFactor };
})(typeof window !== 'undefined' ? window : globalThis);
