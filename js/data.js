/*
 * EnviAeroSurvey: Mahidol University — platform, payload and environment database.
 * Values are manufacturer nominal specifications (verify against your unit / firmware).
 * Units: mm for sensor & focal length, px for image size, s for intervals, m/s, minutes, metres.
 */
(function (root) {
  const UAV = (root.UAV = root.UAV || {});

  // ---------------------------------------------------------------- Cameras / payloads
  // sw/sh = sensor width/height (mm), iw/ih = image width/height (px), f = focal length (mm)
  // minInt = minimum trigger interval (s), shutter = mechanical | global | rolling
  // mb = approx. storage per capture (MB), bands = spectral description
  const cameras = {
    m3e_wide:   { name: 'Mavic 3E — 4/3" CMOS 20 MP (24 mm eq.)', sw: 17.3, sh: 13.0, iw: 5280, ih: 3956, f: 12.29, minInt: 0.7, shutter: 'mechanical', mb: 12, bands: 'RGB' },
    m4e_wide:   { name: 'Matrice 4E — 4/3" CMOS 20 MP (24 mm eq.)', sw: 17.3, sh: 13.0, iw: 5280, ih: 3956, f: 12.29, minInt: 0.5, shutter: 'mechanical', mb: 12, bands: 'RGB' },
    m3m_rgb:    { name: 'Mavic 3M — RGB 4/3" 20 MP', sw: 17.3, sh: 13.0, iw: 5280, ih: 3956, f: 12.29, minInt: 1.0, shutter: 'mechanical', mb: 12, bands: 'RGB' },
    m3m_ms:     { name: 'Mavic 3M — Multispectral 5 MP (G/R/RE/NIR)', sw: 5.18, sh: 3.89, iw: 2592, ih: 1944, f: 4.34, minInt: 1.0, shutter: 'global', mb: 22, bands: 'G·R·RE·NIR' },
    p4rtk:      { name: 'Phantom 4 RTK — 1" CMOS 20 MP', sw: 13.2, sh: 8.8, iw: 5472, ih: 3648, f: 8.8, minInt: 2.0, shutter: 'mechanical', mb: 9, bands: 'RGB' },
    p1_24:      { name: 'Zenmuse P1 — 45 MP FF, 24 mm', sw: 35.9, sh: 24.0, iw: 8192, ih: 5460, f: 24, minInt: 0.7, shutter: 'global', mb: 25, bands: 'RGB' },
    p1_35:      { name: 'Zenmuse P1 — 45 MP FF, 35 mm', sw: 35.9, sh: 24.0, iw: 8192, ih: 5460, f: 35, minInt: 0.7, shutter: 'global', mb: 25, bands: 'RGB' },
    p1_50:      { name: 'Zenmuse P1 — 45 MP FF, 50 mm', sw: 35.9, sh: 24.0, iw: 8192, ih: 5460, f: 50, minInt: 0.7, shutter: 'global', mb: 25, bands: 'RGB' },
    evo2_rtk:   { name: 'EVO II Pro RTK — 1" CMOS 20 MP (6K)', sw: 13.2, sh: 8.8, iw: 5472, ih: 3648, f: 10.6, minInt: 2.0, shutter: 'rolling', mb: 10, bands: 'RGB' },
    rx1r2:      { name: 'Sony RX1R II — 42 MP FF, 35 mm', sw: 35.9, sh: 24.0, iw: 7952, ih: 5304, f: 35, minInt: 1.0, shutter: 'mechanical', mb: 30, bands: 'RGB' },
    a6100_20:   { name: 'Sony a6100 — 24 MP APS-C, 20 mm', sw: 23.5, sh: 15.6, iw: 6000, ih: 4000, f: 20, minInt: 1.0, shutter: 'mechanical', mb: 14, bands: 'RGB' },
    soda3d:     { name: 'senseFly S.O.D.A. 3D — 1" 20 MP', sw: 13.2, sh: 8.8, iw: 5472, ih: 3648, f: 10.6, minInt: 1.0, shutter: 'global', mb: 9, bands: 'RGB' },
    aeria_x:    { name: 'senseFly Aeria X — 24 MP APS-C, 18.5 mm', sw: 23.5, sh: 15.6, iw: 6000, ih: 4000, f: 18.5, minInt: 1.0, shutter: 'mechanical', mb: 14, bands: 'RGB' },
    r10c_16:    { name: 'Sony UMC-R10C — 20 MP APS-C, 16 mm', sw: 23.5, sh: 15.6, iw: 5456, ih: 3632, f: 16, minInt: 1.0, shutter: 'mechanical', mb: 12, bands: 'RGB' },
    lr1_24:     { name: 'Sony ILX-LR1 — 61 MP FF, 24 mm', sw: 35.7, sh: 23.8, iw: 9504, ih: 6336, f: 24, minInt: 1.0, shutter: 'mechanical', mb: 35, bands: 'RGB' },
    lr1_35:     { name: 'Sony ILX-LR1 — 61 MP FF, 35 mm', sw: 35.7, sh: 23.8, iw: 9504, ih: 6336, f: 35, minInt: 1.0, shutter: 'mechanical', mb: 35, bands: 'RGB' },
    rededge_p:  { name: 'MicaSense RedEdge-P — MS bands 1.6 MP', sw: 5.02, sh: 3.75, iw: 1456, ih: 1088, f: 5.5, minInt: 1.0, shutter: 'global', mb: 15, bands: 'B·G·R·RE·NIR (+Pan)' },
    altum_pt:   { name: 'MicaSense Altum-PT — MS bands 3.2 MP', sw: 7.12, sh: 5.33, iw: 2064, ih: 1544, f: 8.0, minInt: 1.0, shutter: 'global', mb: 30, bands: 'B·G·R·RE·NIR·LWIR (+Pan)' },
    custom:     { name: 'Custom camera…', sw: 23.5, sh: 15.6, iw: 6000, ih: 4000, f: 16, minInt: 1.0, shutter: 'mechanical', mb: 15, bands: 'RGB', custom: true }
  };

  // ---------------------------------------------------------------- Platforms
  // type: multirotor | fixedwing ; speed = max recommended mapping speed (multirotor) or
  // cruise airspeed (fixed-wing) in m/s ; endurance = nominal flight time with payload (min)
  // wind = max wind resistance (m/s) ; ceiling = max take-off altitude ASL (m)
  // turnTime = seconds added per line turn ; turnRadius = fixed-wing turn radius (m)
  // dji = WPML enum values (for DJI Pilot 2 / FlightHub 2 KMZ export)
  const platforms = {
    dji_m3e: { name: 'DJI Mavic 3 Enterprise (M3E)', maker: 'DJI', type: 'multirotor', speed: 15, endurance: 45, wind: 12, ceiling: 6000, turnTime: 6, cameras: ['m3e_wide'], rtk: true, dji: { drone: 77, sub: 0, payload: 66 } },
    dji_m4e: { name: 'DJI Matrice 4E', maker: 'DJI', type: 'multirotor', speed: 17, endurance: 49, wind: 12, ceiling: 6000, turnTime: 5, cameras: ['m4e_wide'], rtk: true, dji: { drone: 99, sub: 0, payload: 88 } },
    dji_m3m: { name: 'DJI Mavic 3 Multispectral (M3M)', maker: 'DJI', type: 'multirotor', speed: 15, endurance: 43, wind: 12, ceiling: 6000, turnTime: 6, cameras: ['m3m_rgb', 'm3m_ms'], rtk: true, dji: { drone: 77, sub: 2, payload: 68 } },
    dji_p4rtk: { name: 'DJI Phantom 4 RTK', maker: 'DJI', type: 'multirotor', speed: 13.9, endurance: 30, wind: 10, ceiling: 6000, turnTime: 7, cameras: ['p4rtk'], rtk: true, dji: null },
    dji_m350_p1: { name: 'DJI Matrice 350 RTK', maker: 'DJI', type: 'multirotor', speed: 15, endurance: 40, wind: 12, ceiling: 7000, turnTime: 8, cameras: ['p1_35', 'p1_24', 'p1_50', 'rededge_p', 'altum_pt'], rtk: true, dji: { drone: 89, sub: 0, payload: 50 } },
    dji_m300_p1: { name: 'DJI Matrice 300 RTK', maker: 'DJI', type: 'multirotor', speed: 15, endurance: 38, wind: 12, ceiling: 7000, turnTime: 8, cameras: ['p1_35', 'p1_24', 'p1_50', 'rededge_p', 'altum_pt'], rtk: true, dji: { drone: 60, sub: 0, payload: 50 } },
    autel_evo2_rtk: { name: 'Autel EVO II Pro RTK V3', maker: 'Autel', type: 'multirotor', speed: 15, endurance: 36, wind: 12, ceiling: 7000, turnTime: 7, cameras: ['evo2_rtk'], rtk: true, dji: null },
    freefly_astro: { name: 'Freefly Astro', maker: 'Freefly', type: 'multirotor', speed: 15, endurance: 30, wind: 12, ceiling: 5000, turnTime: 8, cameras: ['lr1_24', 'lr1_35'], rtk: true, dji: null },
    wingtra_gen2: { name: 'WingtraOne Gen II (VTOL)', maker: 'Wingtra', type: 'fixedwing', speed: 16, endurance: 59, wind: 12, ceiling: 4800, turnTime: 20, turnRadius: 45, cameras: ['rx1r2', 'a6100_20', 'altum_pt'], rtk: true, dji: null },
    ebee_x: { name: 'AgEagle / senseFly eBee X', maker: 'AgEagle', type: 'fixedwing', speed: 14, endurance: 90, wind: 12.8, ceiling: 4000, turnTime: 18, turnRadius: 40, cameras: ['soda3d', 'aeria_x'], rtk: true, dji: null },
    trinity_pro: { name: 'Quantum Systems Trinity Pro (VTOL)', maker: 'Quantum Systems', type: 'fixedwing', speed: 17, endurance: 90, wind: 12, ceiling: 5500, turnTime: 22, turnRadius: 60, cameras: ['r10c_16', 'lr1_35', 'rededge_p', 'altum_pt'], rtk: true, dji: null },
    custom_mr: { name: 'Custom multirotor…', maker: 'Custom', type: 'multirotor', speed: 12, endurance: 30, wind: 10, ceiling: 5000, turnTime: 7, cameras: Object.keys(cameras), rtk: false, dji: null, custom: true },
    custom_fw: { name: 'Custom fixed-wing…', maker: 'Custom', type: 'fixedwing', speed: 16, endurance: 60, wind: 12, ceiling: 4000, turnTime: 20, turnRadius: 50, cameras: Object.keys(cameras), rtk: false, dji: null, custom: true }
  };

  // ---------------------------------------------------------------- Terrain / scene profiles
  // front/side = recommended overlaps (%) ; alpha = wind-shear power-law exponent (surface roughness)
  // obstacle = typical obstacle / canopy height (m) ; follow = terrain-following recommendation
  const terrains = {
    open:        { name: 'Open / flat (grass, bare soil, sites)', front: 75, side: 65, alpha: 0.14, obstacle: 0, follow: 'auto', doubleGrid: false,
                   tips: ['Standard overlap is sufficient for well-textured ground.', 'Place GCPs/checkpoints on stable, flat, well-visible locations.'] },
    agriculture: { name: 'Agriculture / crops (uniform texture)', front: 85, side: 70, alpha: 0.16, obstacle: 2, follow: 'auto', doubleGrid: false,
                   tips: ['Uniform crops have repetitive texture — high overlap (≥85/70) is needed for reliable tie points.', 'For multispectral work fly near solar noon ±2 h with a reflectance panel capture before and after.'] },
    forest:      { name: 'Forest / dense vegetation', front: 85, side: 75, alpha: 0.25, obstacle: 25, follow: 'on', doubleGrid: false,
                   tips: ['Canopy moves and is hard to match — increase altitude and overlap (≥85/75).', 'Flight altitude is checked against canopy height for clearance.', 'Prefer overcast or high-sun conditions to minimise deep canopy shadows.'] },
    urban:       { name: 'Urban / built-up (3D models)', front: 80, side: 75, alpha: 0.30, obstacle: 30, follow: 'off', doubleGrid: true,
                   tips: ['Use a double grid (crosshatch) for façade coverage and better 3D reconstruction.', 'Set the obstacle height to the tallest structure in the area.', 'Reflective glass and deep shadows reduce quality — prefer diffuse light.'] },
    mountain:    { name: 'Mountainous / steep relief', front: 80, side: 70, alpha: 0.20, obstacle: 10, follow: 'on', doubleGrid: false,
                   tips: ['Terrain-following keeps GSD and overlap constant on slopes.', 'Plan lines along contours where possible to limit climb/descent.', 'Expect turbulence and stronger winds on ridges — keep battery reserve ≥ 25 %.'] },
    mine:        { name: 'Mine / quarry / stockpiles', front: 80, side: 70, alpha: 0.18, obstacle: 5, follow: 'on', doubleGrid: false,
                   tips: ['Terrain-following avoids GSD loss on benches and pit floors.', 'For accurate volumes keep vertical accuracy ≤ 2–3 × GSD with RTK/PPK + checkpoints.'] },
    coastal:     { name: 'Coastal / water bodies', front: 85, side: 75, alpha: 0.10, obstacle: 0, follow: 'auto', doubleGrid: false,
                   tips: ['Open water cannot be reconstructed — keep enough land in every image.', 'Avoid sun glint: plan when sun elevation is between 25° and 45°.', 'Wind over water is stronger and more laminar.'] },
    snow:        { name: 'Snow / sand / desert (low texture)', front: 85, side: 70, alpha: 0.12, obstacle: 0, follow: 'auto', doubleGrid: false,
                   tips: ['Low-texture surfaces need high overlap and correct exposure (+0.7 to +1.3 EV on snow).', 'Fly at low sun angles (25–40°) — shadows add texture on snow and sand.'] }
  };

  // Common shutter speeds (s)
  const shutters = [
    { label: '1/320 s', v: 1 / 320 }, { label: '1/500 s', v: 1 / 500 }, { label: '1/640 s', v: 1 / 640 }, { label: '1/800 s', v: 1 / 800 },
    { label: '1/1000 s', v: 1 / 1000 }, { label: '1/1250 s', v: 1 / 1250 }, { label: '1/1600 s', v: 1 / 1600 }, { label: '1/2000 s', v: 1 / 2000 }
  ];

  // Absolute accuracy rule of thumb (multiples of GSD) by georeferencing method
  const georef = {
    rtk_gcp: { name: 'RTK/PPK + checkpoints', h: [1, 2], v: [1.5, 3], fixed: 0 },
    gcp:     { name: 'Ground control points (GCPs)', h: [1, 2], v: [1.5, 3], fixed: 0 },
    rtk:     { name: 'RTK/PPK only (no checks)', h: [1, 3], v: [2, 4], fixed: 0.03 },
    gnss:    { name: 'Standalone GNSS (no RTK, no GCP)', h: [0, 0], v: [0, 0], fixed: 2.5, fixedV: 5 }
  };

  UAV.data = { cameras, platforms, terrains, shutters, georef };
})(typeof window !== 'undefined' ? window : globalThis);
