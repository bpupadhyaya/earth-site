// @ts-check
// Canvas2D renderer: the fallback when WebGL2 is not available. Flight is a horizon with a terrain profile cast in columns
// ("2.5D"); globe and map are flat shaded pictures of the same world through the same camera, so picks and projections agree
// with the WebGL renderer. Overlays are the same display list.
import { R_EARTH, RAD, clamp, mix, smooth, destination, cssColour, rgba, num, toEcef } from './geo.mjs';
import { groundColour } from './surface.mjs';
import { circle, rectangle, dashes, VECTOR_STYLE } from './shapes.mjs';
import { drawOps } from './draw2d.mjs';

const css3 = (c, k = 1) => `rgb(${Math.round(clamp(c[0] * k, 0, 1) * 255)},${Math.round(clamp(c[1] * k, 0, 1) * 255)},${Math.round(clamp(c[2] * k, 0, 1) * 255)})`;

/**
 * @param {any} ctx CanvasRenderingContext2D @param {{ world: any, regions?: (id: string) => any, createCanvas?: (w: number, h: number) => any }} o
 */
export function create2D(ctx, o) {
  const world = o.world, stats = { drawCalls: 0, triangles: 0, uploads: 0 };
  // the built-in base map answers a class lookup in a few hundred nanoseconds: draw its picture three times finer than the world's
  const fine = Boolean(world.info && world.info() && world.info().basemap);
  const newCanvas = o.createCanvas || ((w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; });
  /** @type {any} */
  let raster = null, rasterKey = '', lineLayer = null, lineKey = '', tiles = [], frameNo = 0, target = ctx;
  let lineFrame = 0;
  const rgb = [0, 0, 0], P = { x: 0, y: 0, visible: false, depthM: 0 }, e3 = [0, 0, 0], NW = [-0.5, 0.5, 0.7];

  /** Stroke or fill a line of places through the view; points behind the camera break the line. */
  const trace = (view, pts, stride, closed, alt) => {
    const ctx = target;
    ctx.beginPath();
    let pen = false, n = 0, lastX = 0;
    const count = Math.floor(pts.length / stride) + (closed ? 1 : 0), total = Math.floor(pts.length / stride);
    for (let i = 0; i < count; i++) {
      const a = (i % total) * stride;
      view.project(pts[a], pts[a + 1], alt === null ? (stride > 2 ? pts[a + 2] : 0) : alt(pts[a], pts[a + 1]), P);
      const ok = P.depthM > 0 && Number.isFinite(P.x) && (view.map || P.visible || (Math.abs(P.x) < 4 * view.w && Math.abs(P.y) < 4 * view.h && visibleOnGlobe(view, pts[a], pts[a + 1])));
      if (!ok) { pen = false; continue; }
      // the seam of a flat map (the meridian opposite the centre): a line that crosses it goes on at the other edge
      if (pen && view.map && !view.stereo && Math.abs(P.x - lastX) > view.w * 0.5) pen = false;
      if (pen) ctx.lineTo(P.x, P.y); else ctx.moveTo(P.x, P.y);
      pen = true; n++; lastX = P.x;
    }
    return n;
  };
  const visibleOnGlobe = (view, lat, lon) => { toEcef(lat, lon, 0, e3); return (e3[0] * view.pos[0] + e3[1] * view.pos[1] + e3[2] * view.pos[2]) > R_EARTH * R_EARTH; };
  const ground = (lat, lon) => world.elevation(lat, lon, { detail: false });

  /** Flight: sky, then terrain cast in columns from near to far with the planet's curve and haze. */
  function flight(n, view, L, tier) {
    const W = view.w, H = view.h, c = n.cam, cx = W / 2, cy = H / 2, focal = cx / view.tanX, roll = c.rollDeg * RAD, pitch = clamp(c.pitchDeg, -80, 80) * RAD, R = Math.hypot(W, H) / 2 + 2;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-roll);
    const yOf = ang => -focal * Math.tan(clamp(ang - pitch, -1.45, 1.45)), yh = yOf(Math.asin(view.horizonSin));
    const g = ctx.createLinearGradient(0, Math.min(yh - 1, -R), 0, yh);
    g.addColorStop(0, css3(L.zenith)); g.addColorStop(1, css3(L.horizon));
    ctx.fillStyle = g; ctx.fillRect(-R, -R, 2 * R, Math.max(0, yh + R));
    ctx.fillStyle = css3(L.fog); ctx.fillRect(-R, yh, 2 * R, R - yh + 1);
    const cols = tier.columns, cw = 2 * R / cols, K = 36, near = Math.max(25, view.agl * 0.4), far = clamp(Math.sqrt(2 * R_EARTH * Math.max(c.altM, 2)) + 50000, 8000, 250000), bright = 0.25 + 0.95 * Math.max(L.day, 0.08 + 0.1 * L.moonLight);
    for (let i = 0; i < cols; i++) {
      const x = -R + (i + 0.5) * cw, az = c.headingDeg + Math.atan(x / focal) / RAD;
      let top = R;
      for (let k = 0; k < K; k++) {
        const d = near * Math.pow(far / near, k / (K - 1)), p = destination(c.lat, c.lon, az, d), h = ground(p[0], p[1]);
        const y = yOf(Math.atan2(h - d * d / (2 * R_EARTH) - c.altM, d));
        if (y >= top) continue;
        groundColour(world, p[0], p[1], L.sunEnu, bright, rgb, d < 60000);
        const f = clamp(1 - Math.exp(-d * (L.fogDensity + L.inCloud * 0.03)), 0, 1);
        ctx.fillStyle = `rgb(${Math.round(mix(rgb[0], L.fog[0] * 255, f))},${Math.round(mix(rgb[1], L.fog[1] * 255, f))},${Math.round(mix(rgb[2], L.fog[2] * 255, f))})`;
        ctx.fillRect(x - cw / 2 - 0.5, y, cw + 1, top - y + 0.5); top = y; stats.drawCalls++;
      }
    }
    ctx.restore();
    // sun
    if (L.lit && L.sunIntensity > 0.02 && L.inCloud < 0.5) { view.projectDir(Math.atan2(L.sunEnu[0], L.sunEnu[1]) / RAD, Math.asin(clamp(L.sunEnu[2], -1, 1)) / RAD, P); if (P.visible) { ctx.fillStyle = css3(L.sunTint, 1.2); ctx.beginPath(); ctx.arc(P.x, P.y, Math.max(3, H * 0.012), 0, 7); ctx.fill(); } }
    // runways as flat outlines
    if (n.runways.show && world.runwaysNear) for (const r of world.runwaysNear(c.lat, c.lon, 40).slice(0, 12)) {
      if (trace(view, rectangle(r.lat, r.lon, r.headingDeg, r.lengthM, r.widthM || 30), 2, true, () => r.elevationM) < 5) continue;
      ctx.fillStyle = 'rgba(40,40,44,0.95)'; ctx.fill();
      ctx.strokeStyle = n.runways.emphasis !== 'none' ? cssColour(rgba(n.runways.color, 0x40ff80ff)) : 'rgba(235,235,225,0.9)'; ctx.lineWidth = n.runways.emphasis !== 'none' ? 2.5 : 1; ctx.stroke(); stats.drawCalls++;
    }
  }

  /** Globe and map: one colour per cell from the world, drawn as a small picture stretched over the canvas. */
  function flat(n, view, L, tier) {
    const W = view.w, H = view.h, cw = Math.max(2, Math.round(W / (tier.cells * (fine ? 3 : 1)))), nx = Math.ceil(W / cw), ny = Math.ceil(H / cw);
    ctx.fillStyle = view.map ? '#0e2c54' : '#03060c'; ctx.fillRect(0, 0, W, H);
    const c = n.cam, key = [n.mode, W, H, cw, c.lat, c.lon, c.altM, c.spanDeg, c.headingDeg, c.pitchDeg, c.rotationDeg, c.stereo, c.fovDeg, L.lit ? Math.round(n.time / 60000) : 0, world.stats ? world.stats().loads : 0].join();
    if (key !== rasterKey || !raster) {
      rasterKey = key;
      if (!raster || raster.width !== nx || raster.height !== ny) raster = newCanvas(nx, ny);
      const rc = raster.getContext('2d'), img = rc.createImageData(nx, ny), d = img.data, relief = (view.map ? view.metresPerPx * cw : view.altM * view.pxAngle * cw) < 20000;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const p = view.ground((i + 0.5) * cw, (j + 0.5) * cw), q = (j * nx + i) * 4;
        if (!p) { d[q + 3] = 0; continue; }
        let bright = 1;
        if (L.lit) { toEcef(p.lat, p.lon, 0, e3); bright = 0.28 + 0.72 * smooth(-0.1, 0.12, (e3[0] * L.sun[0] + e3[1] * L.sun[1] + e3[2] * L.sun[2]) / R_EARTH); }
        groundColour(world, p.lat, p.lon, NW, bright, rgb, relief);
        d[q] = rgb[0]; d[q + 1] = rgb[1]; d[q + 2] = rgb[2]; d[q + 3] = 255;
      }
      rc.putImageData(img, 0, 0); stats.uploads++;
    }
    ctx.imageSmoothingEnabled = true; ctx.drawImage(raster, 0, 0, nx, ny, 0, 0, nx * cw, ny * cw); stats.drawCalls++;
    // lines of the loaded tiles and the graticule: drawn once into a layer of their own and reused while the view stands still;
    // while the view moves only the main lines are drawn
    if (frameNo % 16 === 1 || !tiles.length) tiles = world.scene ? world.scene({ lat: view.lat, lon: view.lon, altM: view.altM }).tiles : [];
    const lkey = key + n.layers.vectors.join() + n.layers.graticule + tiles.length, moving = lkey !== lineKey && lineKey !== '' && frameNo - lineFrame < 3;
    if (lkey !== lineKey || !lineLayer) {
      lineKey = lkey; lineFrame = frameNo;
      if (!lineLayer || lineLayer.width !== W || lineLayer.height !== H) lineLayer = newCanvas(W, H);
      const lc = lineLayer.getContext('2d');
      lc.clearRect(0, 0, W, H); target = lc;
      if (n.layers.vectors.length && world.vectors) for (const t of tiles) {
        const s = (t.north - t.south) * 0.1;
        for (const f of world.vectors({ south: t.south + s, west: t.west + s, north: t.north - s, east: t.east - s }, { level: t.z })) {
          const st = VECTOR_STYLE[f.kind];
          if (!st || !n.layers.vectors.includes(st.layer) || (moving && f.rank > 1)) continue;
          if (trace(view, f.coords, 2, false, () => 0) > 1) { lc.strokeStyle = cssColour(st.colour); lc.lineWidth = Math.max(1, st.minPx * 1.6); lc.stroke(); stats.drawCalls++; }
        }
      }
      if (n.layers.graticule > 0) {
        lc.strokeStyle = 'rgba(255,255,255,0.28)'; lc.lineWidth = 1;
        const s = Math.max(1, n.layers.graticule);
        for (let lon = -180; lon < 180; lon += s) { const pts = []; for (let lat = -88; lat <= 88; lat += 4) pts.push(lat, lon); if (trace(view, pts, 2, false, () => 0) > 1) lc.stroke(); }
        for (let lat = -90 + s; lat < 90; lat += s) { const pts = []; for (let lon = -180; lon <= 180; lon += 4) pts.push(lat, lon); if (trace(view, pts, 2, false, () => 0) > 1) lc.stroke(); }
      }
      target = ctx;
    }
    ctx.drawImage(lineLayer, 0, 0); stats.drawCalls++;
  }

  /** Rings, zones, routes and highlighted regions, in every mode. */
  function shapes(n, view) {
    const drape = view.map ? () => 0 : ground;
    for (const hl of n.highlight) {
      const rings = Array.isArray(hl.ring) ? [hl.ring.flat()] : hl.circle ? [circle(hl.circle.lat, hl.circle.lon, hl.circle.radiusKm * 1000, 72)] : hl.box ? [[hl.box.south, hl.box.west, hl.box.south, hl.box.east, hl.box.north, hl.box.east, hl.box.north, hl.box.west]] : hl.id && o.regions ? (o.regions(hl.id) || {}).rings || [] : [];
      const k = rgba(hl.color, 0xffd040c0);
      for (const r of rings) { if (trace(view, r, 2, true, () => 0) < 3) continue; if (hl.fill !== false) { ctx.fillStyle = cssColour(k, 0.6); ctx.fill(); } ctx.strokeStyle = cssColour((k | 255) >>> 0); ctx.lineWidth = 2; ctx.stroke(); stats.drawCalls++; }
    }
    for (const ob of n.objects) {
      const k = cssColour(rgba(ob.color, ob.type === 'line' ? 0xff50ffff : 0xffd820ff));
      let n2 = 0;
      if (ob.type === 'ring' && ob.radiusM > 0) n2 = trace(view, circle(ob.lat, ob.lon, ob.radiusM, 48), 2, true, drape);
      else if (ob.type === 'zone' && ob.lengthM > 0) n2 = trace(view, rectangle(ob.lat, ob.lon, num(ob.headingDeg, 0), ob.lengthM, ob.widthM), 2, true, drape);
      else if (ob.type === 'thermal' && ob.radiusM > 0) n2 = trace(view, circle(ob.lat, ob.lon, ob.radiusM, 32), 2, true, () => num(ob.topM, ground(ob.lat, ob.lon) + 1500));
      else if (ob.type === 'line' && Array.isArray(ob.points) && ob.dash) {
        // the same dashes as on WebGL, each one stroked on its own
        ctx.strokeStyle = k; ctx.lineWidth = 2;
        const onGround = ob.drape ?? ob.points.every(p => p.length < 3);
        for (const d of dashes(ob.points.flatMap(p => [p[0], p[1], num(p[2], 0)]), ob.dash)) { if (onGround) for (let i = 2; i < d.length; i += 3) d[i] = drape(d[i - 2], d[i - 1]); if (trace(view, d, 3, false, null) > 1) ctx.stroke(); }
        stats.drawCalls++;
      } else if (ob.type === 'line' && Array.isArray(ob.points)) n2 = trace(view, ob.points.flatMap(p => [p[0], p[1], Number.isFinite(p[2]) ? p[2] : drape(p[0], p[1])]), 3, false, null);
      else if (ob.type === 'traffic' && !view.map) { view.project(ob.lat, ob.lon, num(ob.altM, 0), P); if (P.visible) { ctx.fillStyle = k; ctx.beginPath(); ctx.moveTo(P.x, P.y - 5); ctx.lineTo(P.x + 5, P.y); ctx.lineTo(P.x, P.y + 5); ctx.lineTo(P.x - 5, P.y); ctx.fill(); } }
      if (n2 > 1) { ctx.strokeStyle = k; ctx.lineWidth = 2; ctx.stroke(); stats.drawCalls++; }
    }
    const v = n.vehicle;
    if (v && !view.map) { view.project(v.lat, v.lon, num(v.altM, 0), P); if (P.visible && P.depthM > 3) { const s = clamp(600 / P.depthM, 0.5, 6) * view.h / 100; ctx.strokeStyle = '#f4f4f0'; ctx.lineWidth = Math.max(1.5, s * 0.4); ctx.beginPath(); ctx.moveTo(P.x - 3 * s, P.y); ctx.lineTo(P.x + 3 * s, P.y); ctx.moveTo(P.x, P.y - s); ctx.lineTo(P.x, P.y + 0.6 * s); ctx.stroke(); } }
  }

  return {
    /** @param {any} n @param {any} view @param {any} L @param {any} P unused @param {import('./overlays.mjs').Op[]} ops @param {any} tier */
    frame(n, view, L, P2, ops, tier) {
      stats.drawCalls = 0; stats.triangles = 0; stats.uploads = 0; frameNo++;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
      if (n.mode === 'flight') flight(n, view, L, tier); else flat(n, view, L, tier);
      shapes(n, view);
      drawOps(ctx, ops);
      return stats;
    },
    init() {}, release() {}, dispose() { raster = null; lineLayer = null; },
  };
}
