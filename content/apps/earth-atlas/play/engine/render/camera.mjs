// @ts-check
// The view of one frame: camera matrices, culling, level-of-detail classification, projection and picking. Pure maths, no drawing.
// Flight and globe share a perspective camera (the globe is the same planet seen from far away); the map is a flat projection.
// Everything is computed in 64-bit numbers relative to the camera, so the picture is steady from a runway to orbit.
import { R_EARTH, RAD, DEG, M_PER_DEG, clamp, wrap180, frameAt, toEcef, arcToBox, horizonArc } from './geo.mjs';

/** @typedef {{ south: number, west: number, north: number, east: number, cx: number, cy: number, cz: number, radius: number, minH: number, maxH: number, size: number, pri: number }} ViewNode */
/** @typedef {{ lat: number, lon: number, elevationM: number, distanceM?: number }} Pick */

/**
 * @param {ReturnType<typeof import('./handle.mjs').normalise>} n normalised handle @param {number} w canvas width in pixels @param {number} h height
 * @param {{ elevation?: (lat: number, lon: number) => number }} [world] @param {number} [nearHintM] distance to the nearest drawn object
 */
export function createView(n, w, h, world, nearHintM = Infinity) {
  const elevation = (lat, lon) => (world && world.elevation ? world.elevation(lat, lon) : 0);
  return n.mode === 'map' ? mapView(n, w, h, elevation) : perspectiveView(n, w, h, elevation, nearHintM);
}

function perspectiveView(n, w, h, elevation, nearHintM) {
  const c = n.cam, f = frameAt(c.lat, c.lon, c.altM), pos = f.subarray(9, 12);
  const hd = c.headingDeg * RAD, pt = c.pitchDeg * RAD, rl = c.rollDeg * RAD, sh = Math.sin(hd), ch = Math.cos(hd), sp = Math.sin(pt), cp = Math.cos(pt), sr = Math.sin(rl), cr = Math.cos(rl);
  // east/north/up components of forward, right and up, then into earth-centred axes
  const world3 = (e, nn, u) => [e * f[0] + nn * f[3] + u * f[6], e * f[1] + nn * f[4] + u * f[7], e * f[2] + nn * f[5] + u * f[8]];
  const F = world3(sh * cp, ch * cp, sp), r0 = [ch, -sh, 0], u0 = [-sh * sp, -ch * sp, cp];
  const Rt = world3(r0[0] * cr - u0[0] * sr, r0[1] * cr - u0[1] * sr, r0[2] * cr - u0[2] * sr), U = world3(u0[0] * cr + r0[0] * sr, u0[1] * cr + r0[1] * sr, u0[2] * cr + r0[2] * sr);
  const tanY = Math.tan(c.fovDeg * RAD / 2), tanX = tanY * w / h, ground = elevation(c.lat, c.lon), agl = c.altM - ground, hs = Math.max(c.altM, 2);
  const near = Math.max(0.3, Math.min(clamp(agl * 0.08, 0.5, 5e4), nearHintM * 0.3)), far = Math.sqrt(hs * (2 * R_EARTH + hs)) + 4e5;
  const vp = new Float32Array(16), q = (far + near) / (near - far);
  for (let j = 0; j < 3; j++) { vp[4 * j] = Rt[j] / tanX; vp[4 * j + 1] = U[j] / tanY; vp[4 * j + 2] = -F[j] * q; vp[4 * j + 3] = F[j]; }
  vp[14] = 2 * far * near / (near - far);
  const horizon = horizonArc(hs), kx = Math.sqrt(1 + tanX * tanX), ky = Math.sqrt(1 + tanY * tanY), p3 = [0, 0, 0];

  const view = {
    mode: n.mode, map: false, w, h, lat: c.lat, lon: c.lon, altM: c.altM, agl, groundM: ground, frame: f, pos, R: Rt, U, F, tanX, tanY, near, far, vp,
    /** Size in metres of one pixel at one metre distance. */
    pxAngle: 2 * tanY / h,
    /** Sine of the elevation angle of the sea horizon (negative: the horizon dips with height). */
    horizonSin: -Math.sqrt(Math.max(0, 1 - (R_EARTH / (R_EARTH + hs)) ** 2)),
    /** Origin of a local frame relative to the camera. @param {Float64Array} fr @param {Float32Array|number[]} out */
    offset(fr, out) { out[0] = fr[9] - pos[0]; out[1] = fr[10] - pos[1]; out[2] = fr[11] - pos[2]; return out; },
    /**
     * 0 = not visible, 1 = draw as it is, 2 = wants finer patches. Sets node.pri (smaller = more urgent).
     * @param {ViewNode} nd @param {{ factor: number }} lod
     */
    classify(nd, lod) {
      const a = arcToBox(c.lat, c.lon, nd.south, nd.west, nd.north, nd.east);
      if (a > horizon + horizonArc(Math.max(nd.maxH, 0) + 200) + 0.003) return 0;
      const x = nd.cx - pos[0], y = nd.cy - pos[1], z = nd.cz - pos[2], r = nd.radius;
      const vz = x * F[0] + y * F[1] + z * F[2];
      if (vz < -r || vz - r > far) return 0;
      if (Math.abs(x * Rt[0] + y * Rt[1] + z * Rt[2]) > vz * tanX + r * kx || Math.abs(x * U[0] + y * U[1] + z * U[2]) > vz * tanY + r * ky) return 0;
      const dh = c.altM > nd.maxH ? c.altM - nd.maxH : c.altM < nd.minH ? nd.minH - c.altM : 0, d = Math.sqrt(a * a * R_EARTH * R_EARTH + dh * dh);
      nd.pri = d / nd.size;
      return d < lod.factor * nd.size ? 2 : 1;
    },
    /** Unit direction of the ray through a pixel, earth-centred. @returns {number[]} */
    ray(x, y) {
      const a = (2 * x / w - 1) * tanX, b = (1 - 2 * y / h) * tanY, dx = F[0] + a * Rt[0] + b * U[0], dy = F[1] + a * Rt[1] + b * U[1], dz = F[2] + a * Rt[2] + b * U[2], l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      return [dx / l, dy / l, dz / l];
    },
    /**
     * Where a place is on the canvas. `visible`: in front of the camera, inside the canvas and not hidden behind the planet.
     * @param {number} lat @param {number} lon @param {number} [altM] @param {{ x: number, y: number, visible: boolean, depthM: number }} [out]
     */
    project(lat, lon, altM = 0, out = { x: 0, y: 0, visible: false, depthM: 0 }) {
      toEcef(lat, lon, altM, p3);
      const x = p3[0] - pos[0], y = p3[1] - pos[1], z = p3[2] - pos[2], vz = x * F[0] + y * F[1] + z * F[2];
      out.depthM = vz;
      if (vz <= 1e-6) { out.x = out.y = NaN; out.visible = false; return out; }
      out.x = (0.5 + 0.5 * (x * Rt[0] + y * Rt[1] + z * Rt[2]) / (vz * tanX)) * w; out.y = (0.5 - 0.5 * (x * U[0] + y * U[1] + z * U[2]) / (vz * tanY)) * h;
      // hidden by the planet: the sight line passes below the sea sphere before it reaches the point
      const l = Math.sqrt(x * x + y * y + z * z), tc = -(pos[0] * x + pos[1] * y + pos[2] * z) / l;
      let hidden = false;
      if (tc > 0 && tc < l) { const qx = pos[0] + x / l * tc, qy = pos[1] + y / l * tc, qz = pos[2] + z / l * tc; hidden = qx * qx + qy * qy + qz * qz < (R_EARTH - 30) ** 2; }
      out.visible = !hidden && out.x >= 0 && out.x <= w && out.y >= 0 && out.y <= h;
      return out;
    },
    /** Unit direction from the camera to a place in the camera's own axes: [right, up, forward]. Also valid behind the camera. */
    direction(lat, lon, altM = 0, out = [0, 0, 0]) {
      toEcef(lat, lon, altM, p3);
      const x = p3[0] - pos[0], y = p3[1] - pos[1], z = p3[2] - pos[2], l = Math.sqrt(x * x + y * y + z * z) || 1;
      out[0] = (x * Rt[0] + y * Rt[1] + z * Rt[2]) / l; out[1] = (x * U[0] + y * U[1] + z * U[2]) / l; out[2] = (x * F[0] + y * F[1] + z * F[2]) / l;
      return out;
    },
    /** A direction given as heading and pitch, on the canvas (for conformal symbols). */
    projectDir(headingDeg, pitchDeg, out = { x: 0, y: 0, visible: false, depthM: 0 }) {
      const a = headingDeg * RAD, b = pitchDeg * RAD, d = world3(Math.sin(a) * Math.cos(b), Math.cos(a) * Math.cos(b), Math.sin(b)), vz = d[0] * F[0] + d[1] * F[1] + d[2] * F[2];
      out.depthM = vz; out.visible = vz > 1e-6;
      if (!out.visible) { out.x = out.y = NaN; return out; }
      out.x = (0.5 + 0.5 * (d[0] * Rt[0] + d[1] * Rt[1] + d[2] * Rt[2]) / (vz * tanX)) * w; out.y = (0.5 - 0.5 * (d[0] * U[0] + d[1] * U[1] + d[2] * U[2]) / (vz * tanY)) * h;
      return out;
    },
    /** The point of the sea-level sphere under a pixel (no terrain), or null. @returns {{ lat: number, lon: number }|null} */
    ground(x, y) {
      const d = view.ray(x, y), b = pos[0] * d[0] + pos[1] * d[1] + pos[2] * d[2], disc = b * b - (pos[0] * pos[0] + pos[1] * pos[1] + pos[2] * pos[2] - R_EARTH * R_EARTH);
      if (disc < 0) return null;
      const t = -b - Math.sqrt(disc);
      if (t <= 0) return null;
      const z = (pos[2] + d[2] * t) / R_EARTH;
      return { lat: Math.asin(clamp(z, -1, 1)) * DEG, lon: Math.atan2(pos[1] + d[1] * t, pos[0] + d[0] * t) * DEG };
    },
    /**
     * The terrain point under a pixel, by marching the sight line over the world's surface. Null when the ray meets the sky.
     * @returns {Pick|null}
     */
    pick(x, y) {
      const d = view.ray(x, y), b = pos[0] * d[0] + pos[1] * d[1] + pos[2] * d[2], cc = pos[0] * pos[0] + pos[1] * pos[1] + pos[2] * pos[2], top = R_EARTH + 9500, disc = b * b - (cc - top * top);
      if (disc < 0) return null;
      const t1 = -b + Math.sqrt(disc);
      let t = Math.max(0, -b - Math.sqrt(disc)), prev = t;
      const at = tt => { const px = pos[0] + d[0] * tt, py = pos[1] + d[1] * tt, pz = pos[2] + d[2] * tt, r = Math.sqrt(px * px + py * py + pz * pz), lat = Math.asin(clamp(pz / r, -1, 1)) * DEG, lon = Math.atan2(py, px) * DEG, g = elevation(lat, lon); return { lat, lon, g, above: r - R_EARTH - g }; };
      for (let i = 0; i < 900 && t <= t1; i++) {
        const s = at(t);
        if (s.above <= 0) {
          let lo = prev, hi = t, hit = s;
          for (let k = 0; k < 24 && hi - lo > 0.05; k++) { const mid = (lo + hi) / 2, m = at(mid); if (m.above <= 0) { hi = mid; hit = m; } else lo = mid; }
          return { lat: hit.lat, lon: wrap180(hit.lon), elevationM: hit.g, distanceM: hi };
        }
        prev = t; t += Math.max(1, t * 0.002, s.above * 0.5);
      }
      return null;
    },
  };
  return view;
}

function mapView(n, w, h, elevation) {
  const c = n.cam, k = w / c.spanDeg, rot = c.rotationDeg * RAD, cr = Math.cos(rot), sr = Math.sin(rot), s0 = Math.sin(c.lat * RAD), c0 = Math.cos(c.lat * RAD), cosScale = Math.max(c0, 0.01);
  /** Projected position in pixels from the map centre, x right and y up, before rotation. */
  const forward = (lat, lon, out) => {
    const dl = wrap180(lon - c.lon);
    if (!c.stereo) { out[0] = dl * cosScale * k; out[1] = (lat - c.lat) * k; out[2] = 1; return; }
    const sp = Math.sin(lat * RAD), cp = Math.cos(lat * RAD), cl = Math.cos(dl * RAD), den = 1 + s0 * sp + c0 * cp * cl, kk = 2 / Math.max(den, 1e-9) * k * DEG;
    out[0] = kk * cp * Math.sin(dl * RAD); out[1] = kk * (c0 * sp - s0 * cp * cl); out[2] = den;
  };
  /** @returns {{ lat: number, lon: number }|null} */
  const inverse = (x, y) => {
    const u = x - w / 2, v = h / 2 - y, X = u * cr + v * sr, Y = -u * sr + v * cr;
    if (!c.stereo) { const lat = c.lat + Y / k, lon = c.lon + X / (cosScale * k); return lat > 90 || lat < -90 || Math.abs(X / (cosScale * k)) > 180 ? null : { lat, lon: wrap180(lon) }; }
    const rho = Math.sqrt(X * X + Y * Y) / (k * DEG);
    if (rho < 1e-12) return { lat: c.lat, lon: c.lon };
    const ang = 2 * Math.atan(rho / 2), sa = Math.sin(ang), ca = Math.cos(ang), Yn = Y / (k * DEG), Xn = X / (k * DEG);
    return { lat: Math.asin(clamp(ca * s0 + Yn * sa * c0 / rho, -1, 1)) * DEG, lon: wrap180(c.lon + Math.atan2(Xn * sa, rho * c0 * ca - Yn * s0 * sa) * DEG) };
  };
  // latitude/longitude bounds of the canvas, for culling
  let latMin = 90, latMax = -90, halfLon = 0, whole = false;
  for (let i = 0; i <= 16; i++) for (const [x, y] of [[w * i / 16, 0], [w * i / 16, h], [0, h * i / 16], [w, h * i / 16], [w / 2, h / 2]]) {
    const p = inverse(x, y);
    if (!p) { whole = true; continue; }
    latMin = Math.min(latMin, p.lat); latMax = Math.max(latMax, p.lat); halfLon = Math.max(halfLon, Math.abs(wrap180(p.lon - c.lon)));
  }
  const tmp = [0, 0, 0], inside = (lat, lon) => { forward(lat, lon, tmp); const sx = tmp[0] * cr - tmp[1] * sr, sy = tmp[0] * sr + tmp[1] * cr; return tmp[2] > 0.05 && Math.abs(sx) <= w / 2 && Math.abs(sy) <= h / 2; };
  if (whole || c.spanDeg > 120) { latMin = -90; latMax = 90; halfLon = 180; }
  else { if (inside(89.9999, c.lon)) { latMax = 90; halfLon = 180; } if (inside(-89.9999, c.lon)) { latMin = -90; halfLon = 180; } halfLon = Math.min(180, halfLon * 1.02 + 1e-6); }
  const metresPerPx = M_PER_DEG / k;

  const view = {
    mode: 'map', map: true, w, h, lat: c.lat, lon: c.lon, frame: frameAt(c.lat, c.lon, 0), altM: metresPerPx * w, agl: metresPerPx * w, groundM: 0, stereo: c.stereo, k, cr, sr, s0, c0, cosScale, metresPerPx,
    /** @param {ViewNode} nd @param {{ grid: number, cellPx: number }} lod */
    classify(nd, lod) {
      if (nd.north < latMin || nd.south > latMax) return 0;
      const half = (nd.east - nd.west) / 2;
      if (halfLon < 180 && Math.abs(wrap180(nd.west + half - c.lon)) > halfLon + half) return 0;
      const px = (nd.north - nd.south) * k * (c.stereo ? 1.3 : 1);
      if (px < w) {         // small on the canvas: test its centre against the canvas, grown by the patch's own size
        forward((nd.south + nd.north) / 2, nd.west + half, tmp);
        if (tmp[2] > 0.3 && (Math.abs(tmp[0] * cr - tmp[1] * sr) > w / 2 + px * 1.1 || Math.abs(tmp[0] * sr + tmp[1] * cr) > h / 2 + px * 1.1)) return 0;
      }
      nd.pri = 1 / px;
      return px > lod.grid * lod.cellPx ? 2 : 1;
    },
    project(lat, lon, altM = 0, out = { x: 0, y: 0, visible: false, depthM: 0 }) {
      forward(lat, lon, tmp);
      out.x = w / 2 + tmp[0] * cr - tmp[1] * sr; out.y = h / 2 - (tmp[0] * sr + tmp[1] * cr); out.depthM = metresPerPx * w;
      out.visible = tmp[2] > 0.05 && out.x >= 0 && out.x <= w && out.y >= 0 && out.y <= h;
      return out;
    },
    direction(lat, lon, altM = 0, out = [0, 0, 0]) { forward(lat, lon, tmp); const x = tmp[0] * cr - tmp[1] * sr, y = tmp[0] * sr + tmp[1] * cr, l = Math.hypot(x, y) || 1; out[0] = x / l; out[1] = y / l; out[2] = 0; return out; },
    projectDir(headingDeg, pitchDeg, out = { x: 0, y: 0, visible: false, depthM: 0 }) { out.x = out.y = NaN; out.visible = false; return out; },
    ground: inverse,
    /** @returns {Pick|null} */
    pick(x, y) { const p = inverse(x, y); return p ? { lat: p.lat, lon: p.lon, elevationM: elevation(p.lat, p.lon) } : null; },
  };
  return view;
}
