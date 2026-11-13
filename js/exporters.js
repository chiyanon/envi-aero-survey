/*
 * EnviAeroSurvey: Mahidol University — mission exporters: KML (Google Earth), DJI WPML KMZ (Pilot 2 / FlightHub 2),
 * Litchi CSV, generic waypoint CSV, photo-centre CSV, GeoJSON, project JSON.
 */
(function (root) {
  const UAV = (root.UAV = root.UAV || {});
  const f = (v, d) => Number(v).toFixed(d);
  const esc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

  // ---------------------------------------------------------------- minimal ZIP (store) writer
  const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files) { // files: [{name, data(string)}]
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const fl of files) {
      const name = enc.encode(fl.name), data = typeof fl.data === 'string' ? enc.encode(fl.data) : fl.data, crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.google-earth.kmz' });
  }

  // ---------------------------------------------------------------- helpers
  /** Mission waypoints (everything airborne between take-off climb and descent). */
  function missionWaypoints(R) {
    return R.route.filter((r) => r.kind === 'line' || r.kind === 'transit');
  }

  function kml(R, meta) {
    const area = R.area.polygon.concat([R.area.polygon[0]]).map((p) => `${f(p[1], 8)},${f(p[0], 8)},0`).join(' ');
    const path = R.route.map((r) => `${f(r.lon, 8)},${f(r.lat, 8)},${f(r.z, 2)}`).join(' ');
    const photos = R.photos.map((p, i) => `<Placemark><name>${i + 1}</name><styleUrl>#ph</styleUrl><Point><altitudeMode>absolute</altitudeMode><coordinates>${f(p.lon, 8)},${f(p.lat, 8)},${f(p.z, 2)}</coordinates></Point></Placemark>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document><name>${esc(meta.name)}</name>
<description>${esc(meta.summary)}</description>
<Style id="area"><LineStyle><color>ff00d7ff</color><width>2</width></LineStyle><PolyStyle><color>3300d7ff</color></PolyStyle></Style>
<Style id="path"><LineStyle><color>ffff9a2e</color><width>2.5</width></LineStyle><PolyStyle><color>22ff9a2e</color></PolyStyle></Style>
<Style id="ph"><IconStyle><scale>0.35</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle><LabelStyle><scale>0</scale></LabelStyle></Style>
<Placemark><name>Survey area</name><styleUrl>#area</styleUrl><Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${area}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>Flight path (altitude ASL / EGM96)</name><styleUrl>#path</styleUrl><LineString><extrude>1</extrude><altitudeMode>absolute</altitudeMode><coordinates>${path}</coordinates></LineString></Placemark>
<Folder><name>Photo positions (${R.photos.length})</name><visibility>0</visibility>
${photos}
</Folder>
</Document></kml>`;
  }

  // ---------------------------------------------------------------- DJI WPML (KMZ) — waypoint mission with distance-interval capture
  function wpml(R, meta) {
    const P = meta.platform, wps = missionWaypoints(R);
    const dji = P.dji || { drone: 77, sub: 0, payload: 66 };
    const speed = R.flight.speed;
    const header = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2">`;
    const missionConfig = `
    <wpml:missionConfig>
      <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>
      <wpml:finishAction>goHome</wpml:finishAction>
      <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>
      <wpml:executeRCLostAction>goBack</wpml:executeRCLostAction>
      <wpml:takeOffSecurityHeight>${f(Math.max(20, meta.takeoffSafe || 20), 0)}</wpml:takeOffSecurityHeight>
      <wpml:globalTransitionalSpeed>${f(Math.min(15, P.speed), 1)}</wpml:globalTransitionalSpeed>
      <wpml:globalRTHHeight>${f(Math.max(R.stats.maxRel + 10, 50), 0)}</wpml:globalRTHHeight>
      <wpml:droneInfo><wpml:droneEnumValue>${dji.drone}</wpml:droneEnumValue><wpml:droneSubEnumValue>${dji.sub}</wpml:droneSubEnumValue></wpml:droneInfo>
      <wpml:payloadInfo><wpml:payloadEnumValue>${dji.payload}</wpml:payloadEnumValue><wpml:payloadPositionIndex>0</wpml:payloadPositionIndex></wpml:payloadInfo>
    </wpml:missionConfig>`;

    let groupId = 0;
    const placemarks = wps.map((w, i) => {
      const actions = [];
      if (i === 0) {
        actions.push(`<wpml:actionGroup><wpml:actionGroupId>${groupId++}</wpml:actionGroupId><wpml:actionGroupStartIndex>0</wpml:actionGroupStartIndex><wpml:actionGroupEndIndex>0</wpml:actionGroupEndIndex><wpml:actionGroupMode>sequence</wpml:actionGroupMode><wpml:actionTrigger><wpml:actionTriggerType>reachPoint</wpml:actionTriggerType></wpml:actionTrigger>
          <wpml:action><wpml:actionId>0</wpml:actionId><wpml:actionActuatorFunc>gimbalRotate</wpml:actionActuatorFunc><wpml:actionActuatorFuncParam><wpml:gimbalHeadingYawBase>aircraft</wpml:gimbalHeadingYawBase><wpml:gimbalRotateMode>absoluteAngle</wpml:gimbalRotateMode><wpml:gimbalPitchRotateEnable>1</wpml:gimbalPitchRotateEnable><wpml:gimbalPitchRotateAngle>-90</wpml:gimbalPitchRotateAngle><wpml:gimbalRollRotateEnable>0</wpml:gimbalRollRotateEnable><wpml:gimbalRollRotateAngle>0</wpml:gimbalRollRotateAngle><wpml:gimbalYawRotateEnable>0</wpml:gimbalYawRotateEnable><wpml:gimbalYawRotateAngle>0</wpml:gimbalYawRotateAngle><wpml:gimbalRotateTimeEnable>0</wpml:gimbalRotateTimeEnable><wpml:gimbalRotateTime>0</wpml:gimbalRotateTime><wpml:payloadPositionIndex>0</wpml:payloadPositionIndex></wpml:actionActuatorFuncParam></wpml:action></wpml:actionGroup>`);
      }
      if (w.kind === 'line' && w.first) {
        // find this pass's last waypoint index
        let j = i; while (j < wps.length - 1 && !(wps[j].kind === 'line' && wps[j].last && wps[j].pass === w.pass)) j++;
        actions.push(`<wpml:actionGroup><wpml:actionGroupId>${groupId++}</wpml:actionGroupId><wpml:actionGroupStartIndex>${i}</wpml:actionGroupStartIndex><wpml:actionGroupEndIndex>${j}</wpml:actionGroupEndIndex><wpml:actionGroupMode>sequence</wpml:actionGroupMode><wpml:actionTrigger><wpml:actionTriggerType>multipleDistance</wpml:actionTriggerType><wpml:actionTriggerParam>${f(R.design.photoSpacing, 2)}</wpml:actionTriggerParam></wpml:actionTrigger>
          <wpml:action><wpml:actionId>0</wpml:actionId><wpml:actionActuatorFunc>takePhoto</wpml:actionActuatorFunc><wpml:actionActuatorFuncParam><wpml:payloadPositionIndex>0</wpml:payloadPositionIndex><wpml:useGlobalPayloadLensIndex>0</wpml:useGlobalPayloadLensIndex></wpml:actionActuatorFuncParam></wpml:action></wpml:actionGroup>`);
      }
      return `
      <Placemark>
        <Point><coordinates>${f(w.lon, 9)},${f(w.lat, 9)}</coordinates></Point>
        <wpml:index>${i}</wpml:index>
        <wpml:executeHeight>${f(w.rel, 2)}</wpml:executeHeight>
        <wpml:waypointSpeed>${f(w.kind === 'line' ? speed : Math.min(15, P.speed), 1)}</wpml:waypointSpeed>
        <wpml:waypointHeadingParam><wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode><wpml:waypointHeadingAngle>0</wpml:waypointHeadingAngle><wpml:waypointPoiPoint>0.000000,0.000000,0.000000</wpml:waypointPoiPoint><wpml:waypointHeadingAngleEnable>0</wpml:waypointHeadingAngleEnable><wpml:waypointHeadingPathMode>followBadArc</wpml:waypointHeadingPathMode></wpml:waypointHeadingParam>
        <wpml:waypointTurnParam><wpml:waypointTurnMode>${w.kind === 'line' && !w.first && !w.last ? 'toPointAndPassWithContinuityCurvature' : 'toPointAndStopWithDiscontinuityCurvature'}</wpml:waypointTurnMode><wpml:waypointTurnDampingDist>0</wpml:waypointTurnDampingDist></wpml:waypointTurnParam>
        <wpml:useStraightLine>1</wpml:useStraightLine>${actions.join('')}
      </Placemark>`;
    }).join('');

    const waylines = `${header}
  <Document>${missionConfig}
    <Folder>
      <wpml:templateId>0</wpml:templateId>
      <wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>
      <wpml:waylineId>0</wpml:waylineId>
      <wpml:distance>${f(R.flight.totalDist, 1)}</wpml:distance>
      <wpml:duration>${f(R.flight.flightTime, 1)}</wpml:duration>
      <wpml:autoFlightSpeed>${f(speed, 1)}</wpml:autoFlightSpeed>${placemarks}
    </Folder>
  </Document>
</kml>`;

    const now = Date.now();
    const template = `${header}
  <Document>
    <wpml:author>EnviAeroSurvey (Mahidol University)</wpml:author>
    <wpml:createTime>${now}</wpml:createTime>
    <wpml:updateTime>${now}</wpml:updateTime>${missionConfig}
    <Folder>
      <wpml:templateType>waypoint</wpml:templateType>
      <wpml:templateId>0</wpml:templateId>
      <wpml:waylineCoordinateSysParam><wpml:coordinateMode>WGS84</wpml:coordinateMode><wpml:heightMode>relativeToStartPoint</wpml:heightMode></wpml:waylineCoordinateSysParam>
      <wpml:autoFlightSpeed>${f(speed, 1)}</wpml:autoFlightSpeed>
      <wpml:globalHeight>${f(R.design.H, 1)}</wpml:globalHeight>
      <wpml:caliFlightEnable>0</wpml:caliFlightEnable>
      <wpml:gimbalPitchMode>usePointSetting</wpml:gimbalPitchMode>
      <wpml:globalWaypointHeadingParam><wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode></wpml:globalWaypointHeadingParam>
      <wpml:globalWaypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:globalWaypointTurnMode>
      <wpml:globalUseStraightLine>1</wpml:globalUseStraightLine>${wps.map((w, i) => `
      <Placemark><Point><coordinates>${f(w.lon, 9)},${f(w.lat, 9)}</coordinates></Point><wpml:index>${i}</wpml:index><wpml:height>${f(w.rel, 2)}</wpml:height><wpml:ellipsoidHeight>${f(w.rel, 2)}</wpml:ellipsoidHeight><wpml:useGlobalHeight>0</wpml:useGlobalHeight><wpml:useGlobalSpeed>1</wpml:useGlobalSpeed><wpml:useGlobalHeadingParam>1</wpml:useGlobalHeadingParam><wpml:useGlobalTurnParam>1</wpml:useGlobalTurnParam><wpml:gimbalPitchAngle>-90</wpml:gimbalPitchAngle></Placemark>`).join('')}
    </Folder>
  </Document>
</kml>`;
    return zip([{ name: 'wpmz/template.kml', data: template }, { name: 'wpmz/waylines.wpml', data: waylines }]);
  }

  // ---------------------------------------------------------------- Litchi CSV (max 99 waypoints per mission)
  function litchi(R) {
    const wps = missionWaypoints(R);
    const hdr = 'latitude,longitude,altitude(m),heading(deg),curvesize(m),rotationdir,gimbalmode,gimbalpitchangle,actiontype1,actionparam1,altitudemode,speed(m/s),poi_latitude,poi_longitude,poi_altitude(m),poi_altitudemode,photo_timeinterval,photo_distinterval';
    const chunks = [];
    for (let s = 0; s < wps.length; s += 99) {
      const rows = wps.slice(s, s + 99).map((w, k, arr) => {
        const nx = arr[k + 1] || w, pv = arr[k - 1] || w;
        const ref = nx !== w ? nx : pv;
        const hd = nx !== w ? bearingLL(w, ref) : bearingLL(pv, w);
        const shoot = w.kind === 'line' && !w.last;
        return [f(w.lat, 8), f(w.lon, 8), f(w.rel, 1), f(hd, 0), 0, 0, 2, -90, -1, 0, 0, f(w.kind === 'line' ? R.flight.speed : Math.min(15, R.flight.speed * 1.2), 1), 0, 0, 0, 0, -1, shoot ? f(R.design.photoSpacing, 1) : -1].join(',');
      });
      chunks.push(hdr + '\n' + rows.join('\n') + '\n');
    }
    return chunks;
  }
  function bearingLL(a, b) {
    const D = Math.PI / 180, y = Math.sin((b.lon - a.lon) * D) * Math.cos(b.lat * D);
    const x = Math.cos(a.lat * D) * Math.sin(b.lat * D) - Math.sin(a.lat * D) * Math.cos(b.lat * D) * Math.cos((b.lon - a.lon) * D);
    return (Math.atan2(y, x) / D + 360) % 360;
  }

  function waypointCSV(R) {
    const rows = ['index,type,line,latitude,longitude,alt_asl_m,alt_rel_takeoff_m,ground_m,agl_m'];
    missionWaypoints(R).forEach((w, i) => rows.push([i + 1, w.kind, w.pass >= 0 ? w.pass + 1 : '', f(w.lat, 8), f(w.lon, 8), f(w.z, 2), f(w.rel, 2), f(w.ground, 2), f(w.z - w.ground, 2)].join(',')));
    return rows.join('\n') + '\n';
  }

  function photoCSV(R) {
    const rows = ['photo,line,latitude,longitude,alt_asl_m,ground_m,agl_m,gsd_cm,front_overlap_pct,side_overlap_pct'];
    R.photos.forEach((p, i) => rows.push([i + 1, p.pass + 1, f(p.lat, 8), f(p.lon, 8), f(p.z, 2), f(p.ground, 2), f(p.agl, 2), f(p.gsd * 100, 3), f(p.front * 100, 1), p.side == null ? '' : f(p.side * 100, 1)].join(',')));
    return rows.join('\n') + '\n';
  }

  function geojson(R) {
    const fc = { type: 'FeatureCollection', features: [] };
    fc.features.push({ type: 'Feature', properties: { name: 'survey area' }, geometry: { type: 'Polygon', coordinates: [R.area.polygon.concat([R.area.polygon[0]]).map((p) => [p[1], p[0]])] } });
    fc.features.push({ type: 'Feature', properties: { name: 'flight path', alt: 'ASL (m)' }, geometry: { type: 'LineString', coordinates: R.route.map((r) => [+f(r.lon, 8), +f(r.lat, 8), +f(r.z, 2)]) } });
    R.photos.forEach((p, i) => fc.features.push({ type: 'Feature', properties: { photo: i + 1, line: p.pass + 1, gsd_cm: +f(p.gsd * 100, 3), front: +f(p.front * 100, 1), side: p.side == null ? null : +f(p.side * 100, 1), agl: +f(p.agl, 2) }, geometry: { type: 'Point', coordinates: [+f(p.lon, 8), +f(p.lat, 8), +f(p.z, 2)] } }));
    return JSON.stringify(fc);
  }

  UAV.exporters = { kml, wpml, litchi, waypointCSV, photoCSV, geojson, zip, crc32 };
})(typeof window !== 'undefined' ? window : globalThis);
