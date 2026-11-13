/*
 * EnviAeroSurvey: Mahidol University — built-in user guide: searchable topics, contextual "?" buttons, "show me" links.
 */
(function (root) {
  const UAV = (root.UAV = root.UAV || {});
  const go = (id, label) => `<button class="btn sm goto" data-goto="${id}">Show me: ${label} →</button>`;

  const topics = [
    // ---------------------------------------------------------------- Getting started
    { id: 'quickstart', group: 'Getting started', title: 'Quick start (4 steps)', html: `
      <p class="lead">Plan a survey-grade mapping mission in about a minute. Everything updates live as you change settings.</p>
      <ol>
        <li><b>Find your site.</b> Type a place name or coordinates (<code>18.80, 98.92</code>) in the search box and press <kbd>Enter</kbd>.</li>
        <li><b>Draw the area.</b> Press <b>Draw area</b>, click the corners on the map, then click the first point (or press <kbd>Enter</kbd>). Drag the green <b>H</b> marker to where you will take off.</li>
        <li><b>Choose aircraft &amp; camera</b> in step 2, then the <b>scene type</b> in step 3. The scene sets recommended overlap, obstacle height and terrain-following for you.</li>
        <li><b>Set the target GSD</b> (image resolution) in step 4. Check the <b>Mission summary</b> on the right: fix any red or amber warnings, then <b>Export</b> the mission for your flight app.</li>
      </ol>
      <div class="callout">New to the app? Press <b>Load a demo mission</b> on the empty map to see a complete hillside survey.</div>
      <h4>What the status badge means</h4>
      <table><tr><th>Badge</th><th>Meaning</th></tr>
        <tr><td><b style="color:var(--ok)">Ready</b></td><td>All safety and quality checks passed.</td></tr>
        <tr><td><b style="color:var(--caution)">Review warnings</b></td><td>Flyable, but something reduces quality or safety margin. Read the amber items.</td></tr>
        <tr><td><b style="color:var(--danger)">Not flyable</b></td><td>A hard limit is exceeded (wind, altitude, terrain clearance…). Change the plan before flying.</td></tr></table>
      <p>Your work is saved automatically in this browser. Use <b>Save</b> to keep a project file and <b>Open</b> to load it again.</p>` },

    { id: 'workflow', group: 'Getting started', title: 'Recommended field workflow', html: `
      <p class="lead">A planning tool is only as good as the field procedure around it.</p>
      <h4>In the office</h4>
      <ol><li>Draw the area with a margin around what you really need (edges always have less overlap).</li>
        <li>Choose the scene type, then a GSD about 1.5–2× finer than the accuracy you must deliver.</li>
        <li>Check airspace, permissions and the <b>Daylight / best light</b> window in step 3.</li>
        <li>Fetch the site forecast the day before and on the morning of the flight.</li>
        <li>Open the <b>Report</b>, print it, and export the mission file.</li></ol>
      <h4>On site</h4>
      <ol><li>Re-check wind at take-off height. Wind at flight height is usually 20–60 % stronger.</li>
        <li>Lay out GCPs / checkpoints (see <i>Accuracy &amp; ground control</i>).</li>
        <li>Set the camera: focus at infinity, shutter as planned, ISO as low as the light allows, no digital zoom.</li>
        <li>Load the mission, run it in the app's simulator or preview, and confirm take-off height and RTH altitude.</li>
        <li>Fly, keep visual line of sight, and swap batteries where the report shows.</li></ol>` },

    // ---------------------------------------------------------------- Step by step
    { id: 'area', group: 'Step by step', title: '1 · Drawing & editing the area', html: `
      <h4>Draw</h4>
      <ul><li><b>Draw area</b> → click each corner → click the first (yellow) point or press <kbd>Enter</kbd>.</li>
        <li><kbd>Backspace</kbd> removes the last point while drawing. <kbd>Esc</kbd> cancels and restores the previous shape.</li>
        <li>For <b>Corridor</b> missions you draw the centre-line instead; finish with a double-click or <kbd>Enter</kbd>, then set the corridor width.</li></ul>
      <h4>Edit</h4>
      <ul><li>Drag a white vertex to move it.</li>
        <li>Drag a small midpoint dot to add a new vertex.</li>
        <li>Right-click a vertex to delete it.</li></ul>
      <h4>Import</h4>
      <p><b>Import</b> accepts KML (Google Earth) and GeoJSON. The first polygon becomes the survey area; a line becomes a corridor centre-line.</p>
      <h4>Take-off point (H)</h4>
      <p>The take-off point matters: all heights in DJI and Litchi files are <b>relative to take-off</b>, and the aircraft's altitude limit (often 500 m above take-off) applies from here. On hills, take off from the <b>higher</b> side if the route would otherwise climb too far. Use <b>Set take-off point</b> or drag the <b>H</b> marker.</p>
      ${go('btnDraw', 'Draw button')}` },

    { id: 'missions', group: 'Step by step', title: 'Choosing a mission type', html: `
      <table><tr><th>Type</th><th>Use for</th><th>Notes</th></tr>
        <tr><td><b>Area grid</b></td><td>Orthomosaics, DTM/DSM, agriculture, general mapping</td><td>Most efficient. Parallel lines in one direction.</td></tr>
        <tr><td><b>Double grid</b></td><td>3D models, buildings, stockpiles, steep cuts</td><td>Adds a second set of lines at 90°. Roughly twice the flight time and photos; much better façades and vertical surfaces.</td></tr>
        <tr><td><b>Corridor</b></td><td>Roads, rail, pipelines, rivers, power lines</td><td>Lines follow your centre-line. Use at least 2 lines (default) — a single line gives weak geometry.</td></tr></table>` },

    { id: 'platform', group: 'Step by step', title: '2 · Aircraft & camera', html: `
      <p>Choose your aircraft, then one of its compatible payloads. The spec cards show the values the calculations use.</p>
      <table><tr><th>Spec</th><th>Why it matters</th></tr>
        <tr><td>Sensor size &amp; focal length</td><td>Define footprint and GSD at a given height.</td></tr>
        <tr><td>Pixel size</td><td>Bigger pixels gather more light → cleaner images at fast shutter speeds.</td></tr>
        <tr><td>Shutter type</td><td><b>Mechanical / global</b> shutters freeze motion. <b>Rolling</b> shutters distort at speed — fly slower and enable rolling-shutter correction in processing.</td></tr>
        <tr><td>Min interval</td><td>Fastest the camera can take photos. Limits flight speed at low altitude / high overlap.</td></tr>
        <tr><td>Endurance, wind limit, ceiling</td><td>Used for battery planning and safety checks.</td></tr></table>
      <h4>Custom equipment</h4>
      <p>Choose <b>Custom multirotor…</b> or <b>Custom fixed-wing…</b> to type your own aircraft limits, and <b>Custom camera…</b> to enter sensor width/height (mm), image width/height (px), focal length (mm) and minimum interval.</p>
      <div class="callout warn">Specs are manufacturer nominal values. Firmware, batteries and accessories change real performance — keep a margin.</div>` },

    { id: 'scene', group: 'Step by step', title: '3 · Scene type & terrain', html: `
      <p class="lead">The scene type tells the planner what the ground looks like. Changing it applies these defaults (you can still edit each value):</p>
      <table><tr><th>Scene</th><th>Overlap F/S</th><th>Altitude mode</th><th>Obstacle</th></tr>
        <tr><td>Open / flat</td><td>75 / 65</td><td>unchanged</td><td>0 m</td></tr>
        <tr><td>Agriculture / crops</td><td>85 / 70</td><td>unchanged</td><td>2 m</td></tr>
        <tr><td>Forest / dense vegetation</td><td>85 / 75</td><td>Terrain-follow</td><td>25 m</td></tr>
        <tr><td>Urban / built-up</td><td>80 / 75</td><td>Fixed altitude</td><td>30 m</td></tr>
        <tr><td>Mountainous</td><td>80 / 70</td><td>Terrain-follow</td><td>10 m</td></tr>
        <tr><td>Mine / quarry</td><td>80 / 70</td><td>Terrain-follow</td><td>5 m</td></tr>
        <tr><td>Coastal / water</td><td>85 / 75</td><td>unchanged</td><td>0 m</td></tr>
        <tr><td>Snow / sand</td><td>85 / 70</td><td>unchanged</td><td>0 m</td></tr></table>
      <p>It also sets how quickly wind increases with height (rougher surfaces such as forest and cities have stronger wind shear) and shows field tips under the selector.</p>
      <p>The terrain model loads automatically for your area — the box under the obstacle fields shows its resolution.</p>` },

    { id: 'altitude', group: 'Step by step', title: 'Terrain-follow vs fixed altitude', html: `
      <h4>Terrain-follow (recommended on slopes)</h4>
      <p>The aircraft keeps the same height above the ground. GSD and overlap stay constant. The planner follows the terrain model, limits climbs to the <b>max climb grade</b>, and only ever raises the path when simplifying — it never dips below your target height.</p>
      <h4>Fixed altitude</h4>
      <p>The aircraft flies at one altitude. Over higher ground it is closer to the surface, so <b>GSD gets finer but overlap drops</b>; over valleys GSD gets coarser.</p>
      <ul><li><b>Height measured from</b> — what your "Height AGL" is relative to: take-off point (how most apps work), lowest, mean or highest ground.</li>
        <li><b>Protect overlap on high ground</b> — sizes line and photo spacing for the highest ground so overlap never falls below target (costs more photos and time).</li></ul>
      <div class="callout">Rule of thumb: if terrain relief exceeds ~20 % of flight height, use terrain-follow. The app warns you when this happens.</div>
      <p>Use <b>Colour: GSD</b> or <b>Colour: front/side overlap</b> on the map to see the effect photo by photo.</p>` },

    { id: 'obstacles', group: 'Step by step', title: 'Obstacles & terrain-model accuracy', html: `
      <p><b>Obstacle / canopy height</b> is the tallest thing above bare ground in the area (trees, buildings, masts, power lines). Clearance checks use <i>ground + obstacle height</i>.</p>
      <p><b>DEM uncertainty</b> is how wrong the terrain model may be. The free global model (mostly SRTM 30 m) is typically ±5–16 m vertically, worse on steep slopes and in forests. Keep 10 m unless you know better data covers your site.</p>
      <div class="callout danger">The terrain model does not contain new buildings, cranes, wires or individual trees. Always inspect the site and set the obstacle height honestly. Clearance below ~15 m above obstacles is flagged amber; below zero is red.</div>` },

    { id: 'weather', group: 'Step by step', title: 'Weather, wind & sunlight', html: `
      <h4>Wind</h4>
      <p>Enter wind at 10 m (the value in forecasts) or press <b>Fetch site forecast</b> (Open-Meteo, next 16 days). The planner raises it to flight height with a surface-roughness wind profile — at 100 m wind is often 30–60 % stronger than at 10 m. It is compared to the aircraft's wind limit and reduces battery endurance.</p>
      <h4>Temperature &amp; altitude</h4>
      <p>Cold batteries hold less charge (≈ 85 % at 0 °C, ≈ 70 % at −10 °C). Thin air at high elevation or in heat ("density altitude") cuts endurance and climb performance. Both are applied to the battery plan.</p>
      <h4>Sunlight</h4>
      <p>The bar shows daylight (blue) and the <b>best light window</b> where the sun is ≥ 30° (amber). The white mark is your planned time. Low sun creates long shadows that hide detail; over water a high sun causes glare (glint).</p>
      <p>Set the correct <b>UTC offset</b> for the site — fetching the forecast sets it automatically.</p>` },

    { id: 'gsd', group: 'Step by step', title: '4 · GSD & flight height', html: `
      <p class="lead"><b>GSD</b> (ground sampling distance) is the ground size of one image pixel — the resolution of your map.</p>
      <div class="formula">GSD = height × pixel size ÷ focal length
footprint = height × sensor size ÷ focal length</div>
      <p>Type either <b>Target GSD</b> or <b>Height AGL</b>; the other updates. When you switch camera, the app keeps whichever you edited last.</p>
      <table><tr><th>Typical application</th><th>GSD</th></tr>
        <tr><td>Detailed inspection, small sites</td><td>0.5 – 1 cm</td></tr>
        <tr><td>Construction, topographic survey</td><td>1 – 2 cm</td></tr>
        <tr><td>Mining volumes, earthworks</td><td>2 – 3 cm</td></tr>
        <tr><td>Agriculture (RGB), large areas</td><td>3 – 5 cm</td></tr>
        <tr><td>Multispectral, forestry</td><td>5 – 10 cm</td></tr></table>
      <p>Finer GSD means lower flight, more photos, more batteries and longer processing. Check the legal height limit in your country (often 120 m / 400 ft).</p>
      ${go('gsd', 'GSD field')}` },

    { id: 'overlap', group: 'Step by step', title: 'Front & side overlap', html: `
      <p><b>Front overlap</b> is how much consecutive photos along a line share. <b>Side overlap</b> is how much neighbouring lines share. Photogrammetry needs every point seen in many photos.</p>
      <p>Use the slider for quick changes or type an exact value in the box beside it (front 50–95 %, side 30–90 %). <b>Use recommended overlap for scene</b> resets both to the scene defaults.</p>
      <table><tr><th>Situation</th><th>Front / side</th></tr>
        <tr><td>Well-textured, flat ground</td><td>75 / 65</td></tr>
        <tr><td>General survey, DSM</td><td>80 / 70</td></tr>
        <tr><td>Uniform crops, sand, snow, water edges</td><td>85 / 70</td></tr>
        <tr><td>Forest, 3D models</td><td>85 / 75 – 80</td></tr></table>
      <h4>Achieved overlap</h4>
      <p>The planner measures the real overlap of every photo against the terrain model. <b>Min overlap</b> in the summary and the map colours (<b>Colour: front / side overlap</b>) show where terrain reduced it. Edge lines only have neighbours on one side — this is normal.</p>
      ${go('frontNum', 'Overlap boxes')}` },

    { id: 'direction', group: 'Step by step', title: 'Flight direction', html: `
      <p><b>Flight direction</b> is the bearing of the flight lines in degrees clockwise from north (0° = north–south lines, 90° = east–west). The aircraft flies back and forth, so 30° and 210° give the same lines.</p>
      <ul><li><b>Auto</b> (default) chooses the direction with the fewest turns — usually along the longest side of the area. The computed value appears greyed in the box.</li>
        <li>Drag the slider or type an exact bearing (0–359, decimals allowed). Doing so switches Auto off.</li>
        <li><b>Align flight lines crosswind</b> sets lines perpendicular to the wind. This keeps ground speed and photo spacing even — especially important for fixed-wing aircraft.</li></ul>
      <div class="callout">Also consider: lines along contours on steep slopes (less climbing), and lines parallel to long features such as roads.</div>
      ${go('angleNum', 'Flight direction box')}` },

    { id: 'shutter', group: 'Step by step', title: 'Shutter, motion blur & speed', html: `
      <div class="formula">motion blur (px) = ground speed × exposure time ÷ GSD</div>
      <p>Keep blur ≤ 0.5 px for survey work (≤ 1 px is acceptable for visual products). The planner automatically reduces speed until blur, the camera's minimum interval and the aircraft's maximum speed are all respected. The summary says which one limited the speed.</p>
      <ul><li>Bright sun: 1/1000 – 1/2000 s. Overcast: 1/500 – 1/800 s (raise ISO moderately).</li>
        <li>Leave <b>Speed</b> empty for automatic, or type a lower value to fly slower.</li>
        <li>Fixed-wing aircraft fly at a set airspeed; wind changes their ground speed line by line, which the planner checks.</li></ul>` },

    { id: 'advanced', group: 'Step by step', title: '5 · Advanced & safety settings', html: `
      <table><tr><th>Setting</th><th>What it does</th></tr>
        <tr><td>Boundary margin</td><td>Extends coverage beyond the drawn boundary so edges get full overlap. 10–30 m is common.</td></tr>
        <tr><td>Line run-in/out</td><td>Extra straight flight before and after each line so the aircraft is stable when photos start. Auto = 0 m multirotor, 30 m fixed-wing.</td></tr>
        <tr><td>Max climb grade</td><td>Steepest climb/descent allowed when following terrain (auto: 40 % multirotor, 15 % fixed-wing).</td></tr>
        <tr><td>Follow tolerance</td><td>How closely waypoints track the terrain. Smaller = more waypoints; larger = smoother path (the path is still never below target height).</td></tr>
        <tr><td>Battery reserve</td><td>Charge left on landing. 20 % normal; 25–30 % in cold, wind or mountains.</td></tr>
        <tr><td>Take-off safe height</td><td>Vertical climb at take-off before flying to the first waypoint.</td></tr>
        <tr><td>Regulatory max AGL</td><td>Your legal height limit; exceeding it gives a warning.</td></tr>
        <tr><td>Aircraft max above take-off</td><td>Firmware altitude limit (DJI default 500 m).</td></tr>
        <tr><td>VLOS radius</td><td>Distance you can keep the aircraft in sight; beyond it you get a reminder.</td></tr>
        <tr><td>Sensor orientation</td><td>Most drones fly with the long side of the image across the line (default).</td></tr>
        <tr><td>Georeferencing</td><td>How the map will be tied to the ground — sets the expected accuracy.</td></tr></table>` },

    // ---------------------------------------------------------------- Results
    { id: 'results', group: 'Results & output', title: 'Reading the mission summary', html: `
      <table><tr><th>Card</th><th>Meaning</th></tr>
        <tr><td>GSD</td><td>Mean achieved resolution and its range over all photos.</td></tr>
        <tr><td>Flight time</td><td>Total including climbs, turns, transits and battery swaps.</td></tr>
        <tr><td>Batteries</td><td>Number needed with your reserve, after derating for wind, temperature and air density. Yellow numbered squares on the map mark swap points.</td></tr>
        <tr><td>Photos</td><td>Image count and approximate storage.</td></tr>
        <tr><td>Height AGL</td><td>Target height and the altitude mode.</td></tr>
        <tr><td>Speed</td><td>Planned speed and what limited it.</td></tr>
        <tr><td>Min overlap</td><td>Worst front/side overlap of any photo vs your target.</td></tr></table>
      <p>The <b>Details</b> table lists footprint, spacing, trigger interval, blur, terrain statistics, distances, wind at height, endurance derating and expected accuracy.</p>` },

    { id: 'warnings', group: 'Results & output', title: 'Understanding warnings', html: `
      <table><tr><th>Colour</th><th>Action</th></tr>
        <tr><td><b style="color:var(--danger)">Red</b></td><td>Do not fly this plan. Typical causes: wind above the limit, altitude above ceiling, too little clearance over terrain/obstacles, route above the aircraft's altitude limit, motion blur &gt; 1 px.</td></tr>
        <tr><td><b style="color:var(--caution)">Amber</b></td><td>Flyable but reduced margin or quality: overlap lost to terrain, low sun, near wind limit, above legal height.</td></tr>
        <tr><td><b style="color:var(--info)">Blue</b></td><td>Information: what limited speed, number of batteries, VLOS distance, equipment tips.</td></tr></table>
      <h4>Common fixes</h4>
      <ul><li><b>Overlap below target</b> → switch to terrain-follow, enable <i>Protect overlap</i>, or raise overlap a few %.</li>
        <li><b>Low clearance</b> → raise height, check obstacle height, or move the take-off point.</li>
        <li><b>Exceeds altitude limit above take-off</b> → take off from higher ground or split the area.</li>
        <li><b>Too many batteries</b> → coarser GSD, lower overlap, or split into several missions.</li></ul>` },

    { id: 'profile', group: 'Results & output', title: 'Map colours & altitude profile', html: `
      <h4>Map</h4>
      <ul><li><b>Blue solid lines</b> — imaging lines. <b>Dashed lines</b> — transits without photos.</li>
        <li><b>S / E</b> — start and end of the imaging lines. <b>H</b> — take-off. <b>Numbered squares</b> — battery swaps.</li>
        <li><b>Dots</b> — planned photo positions, coloured by the metric chosen in the <b>Colour</b> menu. Hover a dot for its GSD, overlap and clearance.</li>
        <li><b>Footprints</b> shows the ground area of each image. <b>Hillshade</b> adds relief shading.</li></ul>
      <h4>Profile</h4>
      <p>The chart under the map shows the whole route: brown = ground, green dashed = ground + obstacle height, blue = flight path, amber = while taking photos. Move the mouse over it to see heights and the matching position on the map.</p>` },

    { id: 'exports', group: 'Results & output', title: 'Exporting to your flight app', html: `
      <table><tr><th>Format</th><th>Use with</th><th>How to load</th></tr>
        <tr><td><b>DJI KMZ (WPML)</b></td><td>DJI Pilot 2 (M3E, M3M, M4E, M300/M350), FlightHub 2</td><td>Copy the .kmz to the controller → Pilot 2 → Flight Route → Import Route (KMZ/KML). Open it, check the take-off altitude and RTH height, then fly.</td></tr>
        <tr><td><b>Litchi CSV</b></td><td>Litchi (DJI consumer drones)</td><td>Mission Hub → Missions → Import. Max 99 waypoints per mission, so large plans are split into parts.</td></tr>
        <tr><td><b>KML</b></td><td>Google Earth, GIS review</td><td>Shows the area, the 3D flight path and photo centres at real altitude.</td></tr>
        <tr><td><b>Waypoints CSV</b></td><td>Other autopilots (UgCS, QGroundControl, eMotion, WingtraPilot via import tools)</td><td>Each waypoint with height above sea level, above take-off and above ground.</td></tr>
        <tr><td><b>Photo centres CSV / GeoJSON</b></td><td>QA, GIS, processing planning</td><td>Planned image positions with GSD and overlap.</td></tr></table>
      <div class="callout warn"><b>Heights:</b> DJI and Litchi files use heights <b>relative to the take-off point</b>, so take off from the <b>H</b> location you planned. KML/CSV also give heights above mean sea level (EGM96).</div>
      <div class="callout danger">Always open the imported mission in the flight app and check it (and run the simulator if available) before flying. Verify that photo capture is enabled on every line.</div>
      <p><b>Report</b> opens a printable mission sheet with a plan sketch, profile, checks and a pre-flight checklist.</p>` },

    { id: 'accuracy', group: 'Results & output', title: 'Accuracy & ground control', html: `
      <p>Absolute accuracy depends on how images are tied to real coordinates. The summary gives a rule-of-thumb range:</p>
      <table><tr><th>Method</th><th>Horizontal</th><th>Vertical</th></tr>
        <tr><td>RTK/PPK + checkpoints</td><td>1–2 × GSD</td><td>1.5–3 × GSD</td></tr>
        <tr><td>Ground control points</td><td>1–2 × GSD</td><td>1.5–3 × GSD</td></tr>
        <tr><td>RTK/PPK, no checks</td><td>1–3 × GSD + 3 cm</td><td>2–4 × GSD + 3 cm</td></tr>
        <tr><td>Standalone GNSS</td><td>1–2.5 m</td><td>2–5 m</td></tr></table>
      <ul><li>Use at least 5 GCPs spread around the edges and centre, plus independent checkpoints to prove accuracy.</li>
        <li>With RTK/PPK, still place 3–5 checkpoints; they catch base-station and datum errors.</li>
        <li>Corridors: place GCPs on alternating sides every few hundred metres.</li></ul>` },

    // ---------------------------------------------------------------- Reference
    { id: 'shortcuts', group: 'Reference', title: 'Keyboard shortcuts', html: `
      <table><tr><th>Key</th><th>Action</th></tr>
        <tr><td><kbd>?</kbd> or <kbd>F1</kbd></td><td>Open this guide</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Close the guide · cancel drawing · cancel take-off placement</td></tr>
        <tr><td><kbd>Enter</kbd></td><td>Finish drawing</td></tr>
        <tr><td><kbd>Backspace</kbd> / <kbd>Ctrl</kbd>+<kbd>Z</kbd></td><td>Remove last point while drawing</td></tr></table>` },

    { id: 'troubleshooting', group: 'Reference', title: 'Troubleshooting & FAQ', html: `
      <h4>"Terrain model unavailable — flat ground assumed"</h4>
      <p>The terrain tiles could not load (offline, firewall or proxy). Terrain checks are then meaningless — connect and the plan recomputes when you change anything.</p>
      <h4>Plan says "Not flyable" but I need this area</h4>
      <p>Read the red items: they say what limit is exceeded and how to fix it. Splitting a large or very steep area into two missions with separate take-off points often solves altitude and battery problems.</p>
      <h4>Why is my flight slower than the aircraft's maximum?</h4>
      <p>Motion blur or the camera's minimum photo interval limits it. A faster shutter or a higher altitude allows faster flight.</p>
      <h4>Why does overlap differ from what I typed?</h4>
      <p>Your values are the target at the design height. Real terrain moves the ground closer or further away; the summary shows what is actually achieved.</p>
      <h4>Where is my data stored?</h4>
      <p>Only in this browser (automatic save) and in files you export. Site coordinates are sent to the map, terrain, search and forecast services to fetch their data.</p>
      <h4>How do I switch between light and dark?</h4>
      <p>Use the sun/moon button in the top-right corner. Light is the default; your choice is remembered.</p>` },

    { id: 'fairuse', group: 'Reference', title: 'Fair use, data sources & limits', html: () => {
      const G = UAV.guard, u = G ? G.usage() : [];
      const rows = u.map((x) => x.svc === 'terrain'
        ? `<tr><td>${x.label}</td><td>${x.session} / ${x.maxPerSession} tiles this session</td><td>${x.exhausted ? 'Budget reached — reload' : x.enabled ? 'OK' : 'Off'}</td></tr>`
        : `<tr><td>${x.label}</td><td>${x.hour} / ${x.maxPerHour} this hour · ${x.day} / ${x.maxPerDay} today</td><td>${!x.enabled ? 'Off' : x.cooldown ? 'Paused ' + G.fmtWait(x.cooldown) : 'OK'}</td></tr>`).join('');
      return `
      <p class="lead">EnviAeroSurvey runs entirely in your browser and uses free, public data services. There are no accounts or API keys, so <b>no one is ever billed</b> for using it.</p>
      <h4>Your usage in this browser</h4>
      <table><tr><th>Service</th><th>Used / limit</th><th>Status</th></tr>${rows}</table>
      <h4>Built-in guardrails</h4>
      <ul><li><b>Place search</b> runs only when you press Enter (no search-as-you-type), at most one request every 1.5 s, 30 per hour and 120 per day, and repeated searches come from a 7-day cache.</li>
        <li><b>Weather forecast</b>: at most one request every 5 s, 20 per hour and 80 per day; the same site and date is reused from cache for 1 hour. Coordinates are rounded to about 1 km.</li>
        <li><b>Map tiles</b> load only when you stop panning or zooming. If a community tile server starts refusing tiles, the map switches to Satellite automatically.</li>
        <li><b>Terrain tiles</b> are cached in memory and capped per session.</li>
        <li>If any service replies "too many requests", the app pauses that service on its own (30–60 min) instead of retrying, so the site is not blocked.</li></ul>
      <div class="callout">Coordinates typed as <code>lat, lon</code> in the search box never use the search service — a quick way to navigate when the search limit is reached.</div>
      <h4>Data sources &amp; terms</h4>
      <table><tr><th>Data</th><th>Provider</th><th>Terms</th></tr>
        <tr><td>Satellite imagery, hillshade</td><td>Esri World Imagery</td><td>Free to view with attribution; non-commercial use</td></tr>
        <tr><td>Streets map, place search</td><td>OpenStreetMap / Nominatim</td><td>ODbL; light use only under the OSMF usage policies</td></tr>
        <tr><td>Topographic map</td><td>OpenTopoMap</td><td>CC-BY-SA; light use</td></tr>
        <tr><td>Terrain model</td><td>AWS Open Data Terrain Tiles (SRTM, NED, EU-DEM…)</td><td>Open data, free</td></tr>
        <tr><td>Weather forecast</td><td>Open-Meteo</td><td>Free for non-commercial use (CC-BY 4.0)</td></tr></table>
      <p>This tool is intended for research and education at Mahidol University. Commercial use would need paid plans from the map and weather providers.</p>`; } },

    { id: 'method', group: 'Reference', title: 'How the calculations work', html: `
      <ul><li><b>Coordinates</b> — a local Transverse Mercator projection centred on your site gives true metres (error &lt; 1 mm).</li>
        <li><b>Coverage</b> — lines are generated so every point of the polygon falls under a line band; concave shapes are handled.</li>
        <li><b>Terrain</b> — AWS Terrain Tiles (SRTM / NED / EU-DEM blend), zoom chosen for the area size, bilinear interpolation.</li>
        <li><b>Achieved overlap</b> — for each photo, the image-edge rays are intersected with the terrain in four directions and compared with the next photo and the neighbouring line.</li>
        <li><b>Endurance</b> — nominal flight time × √(air density ratio) × temperature factor × wind factor × (1 − reserve).</li>
        <li><b>Sun</b> — NOAA solar position algorithm with refraction.</li></ul>
      <p>Values are planning estimates. Real results depend on weather, equipment condition and processing software.</p>` }
  ];

  // ---------------------------------------------------------------- controller
  const $ = (id) => document.getElementById(id);
  let current = 'quickstart';
  const strip = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const htmlOf = (t) => (typeof t.html === 'function' ? t.html() : t.html);

  function renderNav(filter) {
    const q = (filter || '').trim().toLowerCase();
    const nav = $('helpNav'); nav.innerHTML = '';
    let lastGroup = null, count = 0;
    topics.forEach((t) => {
      if (q && !(t.title + ' ' + strip(htmlOf(t))).toLowerCase().includes(q)) return;
      if (t.group !== lastGroup) { const g = document.createElement('div'); g.className = 'grp'; g.textContent = t.group; nav.appendChild(g); lastGroup = t.group; }
      const b = document.createElement('button'); b.textContent = t.title; b.dataset.topic = t.id; b.classList.toggle('on', t.id === current);
      b.onclick = () => show(t.id, q); nav.appendChild(b); count++;
    });
    if (!count) nav.innerHTML = '<div class="help-empty">No topics match your search.</div>';
    return count;
  }

  function highlight(el, q) {
    if (!q) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    nodes.forEach((n) => {
      if (!re.test(n.nodeValue)) return; re.lastIndex = 0;
      const span = document.createElement('span'); span.innerHTML = n.nodeValue.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(re, (m) => `<mark>${m}</mark>`);
      n.parentNode.replaceChild(span, n);
    });
  }

  function show(id, q) {
    const i = topics.findIndex((t) => t.id === id); if (i < 0) return;
    current = id; const t = topics[i], prev = topics[i - 1], next = topics[i + 1];
    const body = $('helpBody');
    body.innerHTML = `<h3>${t.title}</h3>${htmlOf(t)}<div class="help-foot">${prev ? `<button class="btn sm" data-topic-go="${prev.id}">← ${prev.title}</button>` : '<span></span>'}${next ? `<button class="btn sm" data-topic-go="${next.id}">${next.title} →</button>` : ''}</div>`;
    highlight(body, q);
    body.scrollTop = 0;
    document.querySelectorAll('#helpNav button').forEach((b) => b.classList.toggle('on', b.dataset.topic === id));
    body.querySelectorAll('[data-topic-go]').forEach((b) => (b.onclick = () => show(b.dataset.topicGo)));
    body.querySelectorAll('[data-goto]').forEach((b) => (b.onclick = () => gotoControl(b.dataset.goto)));
  }

  function gotoControl(id) {
    close();
    const el = $(id); if (!el) return;
    const det = el.closest('details'); if (det) det.open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    setTimeout(() => { try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 400);
  }

  let lastFocus = null;
  function open(id) {
    lastFocus = document.activeElement;
    $('help').hidden = false; $('helpScrim').hidden = false;
    $('helpSearch').value = ''; renderNav(''); show(id || current);
    setTimeout(() => $('helpSearch').focus(), 30);
  }
  function close() {
    if ($('help').hidden) return;
    $('help').hidden = true; $('helpScrim').hidden = true;
    if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }

  function init() {
    $('helpClose').onclick = close;
    $('helpScrim').onclick = close;
    $('helpSearch').addEventListener('input', (e) => {
      const q = e.target.value;
      renderNav(q);
      const first = document.querySelector('#helpNav button');
      if (first) show(first.dataset.topic, q.trim().toLowerCase());
    });
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-help]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      open(b.dataset.help);
    }, true);
    document.addEventListener('keydown', (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox';
      if (e.key === 'Escape' && !$('help').hidden) { close(); e.stopImmediatePropagation(); return; }
      if (e.key === 'F1' || (e.key === '?' && !typing)) { e.preventDefault(); open(); }
    }, true);
  }

  UAV.help = { open, close, init, topics };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
