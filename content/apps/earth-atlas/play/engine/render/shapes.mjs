// @ts-check
// Geometry builders for everything that is not terrain: lines draped on the ground (rivers, roads, borders, rings, zones,
// routes, graticule), runways and simple vehicle shapes. Pure data in, typed arrays out; positions are metres in a local frame.
import { R_EARTH, RAD, M_PER_DEG, wrap180, frameAt, toLocal, destination, rgba } from './geo.mjs';

/** Bytes per ribbon vertex: position (3 floats), sideways unit vector (3 floats), longitude/latitude offset from the frame origin in degrees (2 floats), half width in metres and signed minimum half width in pixels (2 floats), colour (4 bytes). */
export const RIBBON_STRIDE = 44;
/** Bytes per runway vertex: position, sideways vector, chainage of the piece and across metres, length/width, along axis, piece centre, flags. */
export const RUNWAY_STRIDE = 68;
/** Bytes per vehicle vertex: position, normal (4 signed bytes), colour (4 bytes). */
export const MESH_STRIDE = 20;

/**
 * @typedef {{ pts: ArrayLike<number>, stride?: number, colour: number, halfWidthM: number, minPx?: number, closed?: boolean, drape?: boolean }} Line
 *   pts = lat, lon (, altM when stride is 3) per point
 */

/**
 * Ribbons for a set of lines in one local frame. Long segments are split so that they follow the ground and the curve of the planet.
 * @param {Float64Array} frame @param {Line[]} lines @param {((lat: number, lon: number) => number)|null} elevation @param {{ maxSegM?: number, liftM?: number }} [o]
 */
export function buildRibbons(frame, lines, elevation, o = {}) {
  const maxSeg = o.maxSegM || 2000, lift = o.liftM ?? 2, origin = { lat: Math.asin(frame[8]) / RAD, lon: Math.atan2(frame[7], frame[6]) / RAD };
  /** @type {number[]} */ const v = [], col = [], idx = [];
  const p = [0, 0, 0];
  for (const ln of lines) {
    const st = ln.stride || 2, n0 = Math.floor(ln.pts.length / st);
    if (n0 < 2) continue;
    /** @type {number[]} */ const pts = [];           // lat, lon, alt, x, y, z
    const push = (lat, lon, alt) => { const a = ln.drape !== false && elevation ? elevation(lat, lon) + lift : alt; toLocal(frame, lat, lon, a, p, 0); pts.push(lat, lon, a, p[0], p[1], p[2]); };
    const count = ln.closed ? n0 + 1 : n0;
    for (let i = 0; i < count; i++) {
      const a = (i % n0) * st, lat = ln.pts[a], lon = ln.pts[a + 1], alt = st > 2 ? ln.pts[a + 2] || 0 : 0;
      if (i > 0) {
        const b = ((i - 1) % n0) * st, la0 = ln.pts[b], lo0 = ln.pts[b + 1], al0 = st > 2 ? ln.pts[b + 2] || 0 : 0, dLon = wrap180(lon - lo0);
        const d = Math.hypot((lat - la0) * M_PER_DEG, dLon * M_PER_DEG * Math.cos(lat * RAD)), parts = Math.min(64, Math.ceil(d / maxSeg));
        for (let k = 1; k < parts; k++) push(la0 + (lat - la0) * k / parts, lo0 + dLon * k / parts, al0 + (alt - al0) * k / parts);
      }
      push(lat, lon, alt);
    }
    const n = pts.length / 6, base = v.length / 10;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1) * 6, b = Math.min(n - 1, i + 1) * 6, c = i * 6;
      let tx = pts[b + 3] - pts[a + 3], ty = pts[b + 4] - pts[a + 4], tz = pts[b + 5] - pts[a + 5];
      // up at the point: away from the planet's centre, which is R below the frame origin
      let ux = pts[c + 3], uy = pts[c + 4], uz = pts[c + 5] + R_EARTH + frameAlt(frame);
      const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
      let sx = ty * uz - tz * uy, sy = tz * ux - tx * uz, sz = tx * uy - ty * ux;
      const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
      for (const side of [-1, 1]) { v.push(pts[c + 3], pts[c + 4], pts[c + 5], sx * side, sy * side, sz * side, wrap180(pts[c + 1] - origin.lon), pts[c] - origin.lat, ln.halfWidthM, (ln.minPx || 0.75) * side); col.push(ln.colour); }
      if (i > 0) { const q = base + 2 * i; idx.push(q - 2, q - 1, q, q - 1, q + 1, q); }
    }
  }
  const nv = v.length / 10, buf = new ArrayBuffer(nv * RIBBON_STRIDE), f = new Float32Array(buf), dv = new DataView(buf);
  for (let i = 0; i < nv; i++) { for (let k = 0; k < 10; k++) f[i * 11 + k] = v[i * 10 + k]; dv.setUint32(i * RIBBON_STRIDE + 40, col[i]); }
  return { vertices: buf, indices: nv > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), indexCount: idx.length, frame };
}
const frameAlt = f => Math.hypot(f[9], f[10], f[11]) - R_EARTH;

/**
 * A line cut into dashes. `dash`: true for a pattern that fits the length of the line (about 40 dashes), or [dash, gap] in metres.
 * A line never gets more than 240 dashes: a pattern too fine for its length is widened.
 * @param {ArrayLike<number>} pts lat, lon, altM per point @param {any} dash @returns {number[][]} the dashes, each lat, lon, altM per point
 */
export function dashes(pts, dash) {
  const n = Math.floor(pts.length / 3), len = [0];
  for (let i = 1; i < n; i++) { const a = 3 * (i - 1), b = 3 * i; len.push(len[i - 1] + Math.hypot((pts[b] - pts[a]) * M_PER_DEG, wrap180(pts[b + 1] - pts[a + 1]) * M_PER_DEG * Math.cos((pts[a] + pts[b]) / 2 * RAD), pts[b + 2] - pts[a + 2])); }
  const total = len[n - 1];
  if (!(total > 0)) return n > 1 ? [Array.from(pts)] : [];
  let on = Array.isArray(dash) && dash[0] > 0 ? dash[0] : total / 66, off = Array.isArray(dash) && dash[1] > 0 ? dash[1] : on * 0.65;
  const widen = total / (on + off) / 240;
  if (widen > 1) { on *= widen; off *= widen; }
  /** @type {number[][]} */ const out = [];
  const at = (d, seg) => { const a = 3 * seg, b = a + 3, f = (d - len[seg]) / ((len[seg + 1] - len[seg]) || 1); return [pts[a] + (pts[b] - pts[a]) * f, pts[a + 1] + wrap180(pts[b + 1] - pts[a + 1]) * f, pts[a + 2] + (pts[b + 2] - pts[a + 2]) * f]; };
  let seg = 0;
  for (let d0 = 0; d0 < total; d0 += on + off) {
    const d1 = Math.min(total, d0 + on), piece = [];
    while (seg < n - 2 && len[seg + 1] <= d0) seg++;
    piece.push(...at(d0, seg));
    let s = seg;
    while (s < n - 2 && len[s + 1] < d1) { s++; piece.push(pts[3 * s], pts[3 * s + 1], pts[3 * s + 2]); }
    piece.push(...at(d1, s));
    out.push(piece);
  }
  return out;
}

/** A circle on the ground as lat, lon pairs. */
export function circle(lat, lon, radiusM, n = 72) {
  const out = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) { const p = destination(lat, lon, 360 * i / n, radiusM); out[2 * i] = p[0]; out[2 * i + 1] = p[1]; }
  return out;
}
/** Corners of a rectangle on the ground: centre, axis heading, length along the axis, width. */
export function rectangle(lat, lon, headingDeg, lengthM, widthM) {
  const out = new Float64Array(8), half = Math.hypot(lengthM, widthM) / 2, a = Math.atan2(widthM, lengthM) / RAD;
  [a, 180 - a, 180 + a, -a].forEach((b, i) => { const p = destination(lat, lon, headingDeg + b, half); out[2 * i] = p[0]; out[2 * i + 1] = p[1]; });
  return out;
}
/** Lines of latitude and longitude every `stepDeg` degrees. @returns {Line[]} */
export function graticule(stepDeg, colour, west = -180, east = 180) {
  /** @type {Line[]} */ const lines = [], s = Math.max(1, stepDeg);
  for (let lon = -180; lon < 180; lon += s) { if (lon < west || lon >= east) continue; const pts = []; for (let lat = -88; lat <= 88; lat += 4) pts.push(lat, lon); lines.push({ pts, colour, halfWidthM: 0, minPx: 0.6, drape: false }); }
  for (let lat = -90 + s; lat < 90; lat += s) { const pts = []; for (let lon = west; lon < east; lon += 4) pts.push(lat, lon); pts.push(lat, east); lines.push({ pts, colour, halfWidthM: 0, minPx: lat === 0 ? 0.9 : 0.6, drape: false }); }
  return lines;
}

/**
 * Runway surfaces of engine/world runway records in one local frame.
 * @param {Float64Array} frame @param {any[]} records @param {(r: any) => boolean} [emphasised]
 */
export function buildRunways(frame, records, emphasised) {
  // One quad per 150 m piece of strip, with its own four vertices. Every vertex of a piece carries the same plane (centre, along and
  // across axes, middle chainage), so the fragment shader can find where a pixel's sight line meets the strip by itself: values that
  // are interpolated between vertices go wrong for pieces that reach behind the camera (a cockpit sits right over the strip).
  /** @type {number[]} */ const v = [], flags = [], idx = [];
  const e0 = [0, 0, 0], e1 = [0, 0, 0], e2 = [0, 0, 0], e3 = [0, 0, 0];
  for (const r of records) {
    const L = r.lengthM, W = r.widthM > 0 ? r.widthM : 30, parts = Math.max(1, Math.ceil(L / 150)), em = emphasised && emphasised(r) ? 255 : 0;
    const edge = (s, a, b) => {
      const c = destination(r.lat, r.lon, r.headingDeg, s), alt = r.elevationM + (r.riseM || 0) * (s / L) + 0.3;
      const pa = destination(c[0], c[1], r.headingDeg - 90, W / 2), pb = destination(c[0], c[1], r.headingDeg + 90, W / 2);
      toLocal(frame, pa[0], pa[1], alt, a, 0); toLocal(frame, pb[0], pb[1], alt, b, 0);
    };
    edge(-L / 2, e0, e1);
    for (let i = 1; i <= parts; i++) {
      const s0 = -L / 2 + L * (i - 1) / parts, s1 = -L / 2 + L * i / parts;
      edge(s1, e2, e3);
      const cx = (e0[0] + e1[0] + e2[0] + e3[0]) / 4, cy = (e0[1] + e1[1] + e2[1] + e3[1]) / 4, cz = (e0[2] + e1[2] + e2[2] + e3[2]) / 4;
      let ax = (e2[0] + e3[0] - e0[0] - e1[0]) / 2, ay = (e2[1] + e3[1] - e0[1] - e1[1]) / 2, az = (e2[2] + e3[2] - e0[2] - e1[2]) / 2;
      let bx = (e1[0] - e0[0] + e3[0] - e2[0]) / 2, by = (e1[1] - e0[1] + e3[1] - e2[1]) / 2, bz = (e1[2] - e0[2] + e3[2] - e2[2]) / 2;
      const la = Math.hypot(ax, ay, az) || 1, lb = Math.hypot(bx, by, bz) || 1;
      ax /= la; ay /= la; az /= la; bx /= lb; by /= lb; bz /= lb;
      const base = v.length / 16, sm = (s0 + s1) / 2;
      for (const [p, sgn] of [[e0, -1], [e1, 1], [e2, -1], [e3, 1]]) {
        v.push(p[0], p[1], p[2], sgn * bx, sgn * by, sgn * bz, sm, sgn * W / 2, L, W, ax, ay, az, cx, cy, cz); flags.push(r.surface || 0, em);
      }
      idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      e0[0] = e2[0]; e0[1] = e2[1]; e0[2] = e2[2]; e1[0] = e3[0]; e1[1] = e3[1]; e1[2] = e3[2];
    }
  }
  const nv = v.length / 16, buf = new ArrayBuffer(nv * RUNWAY_STRIDE), f = new Float32Array(buf), u8 = new Uint8Array(buf);
  for (let i = 0; i < nv; i++) { for (let k = 0; k < 16; k++) f[i * 17 + k] = v[i * 16 + k]; u8[i * RUNWAY_STRIDE + 64] = flags[2 * i]; u8[i * RUNWAY_STRIDE + 65] = flags[2 * i + 1]; }
  return { vertices: buf, indices: nv < 65536 ? new Uint16Array(idx) : new Uint32Array(idx), indexCount: idx.length, frame };
}

const meshes = new Map();
/**
 * A simple vehicle shape, one unit long: x right, y forward, z up. Triangles with flat normals.
 * @param {string} model one of VEHICLE_MODELS @param {number} colour 0xRRGGBBAA @param {number} [flap] bird wing angle -1..1
 */
export function vehicleMesh(model, colour, flap = 0) {
  const key = `${model}/${colour}/${Math.round(flap * 8)}`;
  let m = meshes.get(key);
  if (m) return m;
  /** @type {number[]} */ const out = [], cols = [];
  const dark = (((colour >>> 24) * 0.55) << 24 | (((colour >>> 16) & 255) * 0.55) << 16 | (((colour >>> 8) & 255) * 0.55) << 8 | 255) >>> 0;
  const tri = (a, b, c, k = colour) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const p of [a, b, c]) { out.push(p[0], p[1], p[2], nx, ny, nz); cols.push(k); }
  };
  const quad = (a, b, c, d, k) => { tri(a, b, c, k); tri(a, c, d, k); };
  /** Body of revolution: sections [position along the axis, radius across, radius up, offset up]. */
  const lathe = (axis, sections, sides = 6, k = colour) => {
    const ring = s => { const r = []; for (let i = 0; i < sides; i++) { const a = 2 * Math.PI * i / sides, u = Math.cos(a) * s[1], w = Math.sin(a) * s[2] + (s[3] || 0); r.push(axis === 'y' ? [u, s[0], w] : [u, w, s[0]]); } return r; };
    for (let j = 0; j + 1 < sections.length; j++) { const a = ring(sections[j]), b = ring(sections[j + 1]); for (let i = 0; i < sides; i++) { const i2 = (i + 1) % sides; quad(a[i], b[i], b[i2], a[i2], k); } }
  };
  /** A pair of mirrored flat panels: points as [x, y, z] on the right side. */
  const wings = (pts, k = colour) => { for (const sgn of [1, -1]) { const p = pts.map(q => [q[0] * sgn, q[1], q[2]]); for (let i = 1; i + 1 < p.length; i++) tri(p[0], p[i], p[i + 1], k); } };
  const disc = (cx, cy, cz, r, vertical, k) => { for (let i = 0; i < 10; i++) { const a = 2 * Math.PI * i / 10, b = 2 * Math.PI * (i + 1) / 10; tri([cx, cy, cz], vertical ? [cx, cy + Math.cos(a) * r, cz + Math.sin(a) * r] : [cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz], vertical ? [cx, cy + Math.cos(b) * r, cz + Math.sin(b) * r] : [cx + Math.cos(b) * r, cy + Math.sin(b) * r, cz], k); } };
  if (model === 'helicopter') {
    lathe('y', [[0.42, 0.01, 0.01], [0.3, 0.1, 0.1], [0.05, 0.12, 0.13], [-0.12, 0.05, 0.06, 0.03], [-0.5, 0.015, 0.02, 0.05]]);
    disc(0, 0.08, 0.17, 0.55, false, (dark & 0xffffff00 | 90) >>> 0); disc(0.03, -0.48, 0.07, 0.09, true, dark);
    wings([[0.1, 0.22, -0.14], [0.11, 0.22, -0.14], [0.11, -0.08, -0.14], [0.1, -0.08, -0.14]], dark);
  } else if (model === 'bird') {
    const a = flap * 0.9, z1 = Math.sin(a) * 0.5, z2 = z1 + Math.sin(a * 1.5) * 0.55;
    lathe('y', [[0.5, 0.005, 0.005], [0.36, 0.06, 0.055], [0.05, 0.1, 0.09], [-0.3, 0.05, 0.04], [-0.5, 0.1, 0.004]], 5);
    wings([[0.05, 0.22, 0.03], [0.6, 0.2, 0.03 + z1], [0.6, -0.12, 0.03 + z1], [0.05, -0.1, 0.03]]);
    wings([[0.6, 0.2, 0.03 + z1], [1.2, -0.02, 0.03 + z2], [1.15, -0.16, 0.03 + z2], [0.6, -0.12, 0.03 + z1]], dark);
  } else if (model === 'balloon') {
    // an onion-shaped envelope with smooth shading and coloured gores (the brand's warm and cool accents; a colour given by the
    // handle replaces the warm pair), a woven basket under a burner frame, and a flame when `flap` > 0.5 (the burner is firing)
    const plain = colour === 0xf4f4f0ff, gore = plain ? [0xff9a52ff, 0xffd59aff] : [colour, 0xffd59aff], band = plain ? 0x2b6f98ff : dark, cap = plain ? 0xff9a52ff : colour;
    const prof = [[0.13, 0.07], [0.17, 0.125], [0.23, 0.215], [0.31, 0.3], [0.4, 0.37], [0.5, 0.405], [0.6, 0.41], [0.7, 0.38], [0.79, 0.32], [0.87, 0.23], [0.94, 0.12], [0.985, 0.045], [1, 0]];
    const sides = 16, ring = (z, r, j) => { const p = []; for (let i = 0; i < sides; i++) { const a = 2 * Math.PI * i / sides; p.push([Math.cos(a) * r, Math.sin(a) * r, z]); } return p; };
    // vertex normal of a surface of revolution at section j: perpendicular to the profile's tangent, tilted by the angle round the axis
    const nrm = (j, i) => { const a = prof[Math.max(0, j - 1)], b = prof[Math.min(prof.length - 1, j + 1)], dr = b[1] - a[1], dz = b[0] - a[0], l = Math.hypot(dr, dz) || 1, ang = 2 * Math.PI * i / sides; return [Math.cos(ang) * dz / l, Math.sin(ang) * dz / l, -dr / l]; };
    const smooth = (a, b, c, na, nb, nc, k) => { for (const [p, n] of [[a, na], [b, nb], [c, nc]]) { out.push(p[0], p[1], p[2], n[0], n[1], n[2]); cols.push(k); } };
    for (let j = 0; j + 1 < prof.length; j++) {
      const r0 = ring(prof[j][0], prof[j][1]), r1 = ring(prof[j + 1][0], prof[j + 1][1]);
      for (let i = 0; i < sides; i++) {
        const i2 = (i + 1) % sides, k = j >= 11 ? cap : j === 4 || j === 5 ? band : gore[i & 1];
        smooth(r0[i], r1[i], r1[i2], nrm(j, i), nrm(j + 1, i), nrm(j + 1, i2), k); smooth(r0[i], r1[i2], r0[i2], nrm(j, i), nrm(j + 1, i2), nrm(j, i2), k);
      }
    }
    const wicker = 0xa8743aff, box = (x0, y0, z0, x1, y1, z1, k) => {
      const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
      for (const f of [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]) quad(c[f[0]], c[f[1]], c[f[2]], c[f[3]], k);
    };
    box(-0.034, -0.034, 0, 0.034, 0.034, 0.055, wicker);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) box(sx * 0.03 - 0.003, sy * 0.03 - 0.003, 0.055, sx * 0.03 + 0.003, sy * 0.03 + 0.003, 0.135, 0x5c5c66ff);
    box(-0.012, -0.012, 0.1, 0.012, 0.012, 0.112, 0x5c5c66ff);
    if (flap > 0.5) {
      lathe('z', [[0.108, 0.003, 0.003], [0.125, 0.026, 0.026], [0.16, 0.034, 0.034], [0.205, 0.018, 0.018], [0.245, 0.0, 0.0]], 8, 0xffa024ff);
      lathe('z', [[0.112, 0.002, 0.002], [0.13, 0.014, 0.014], [0.17, 0.016, 0.016], [0.2, 0.0, 0.0]], 8, 0xfff0a0ff);
    }
  } else if (model === 'capsule') {
    lathe('y', [[0.5, 0.05, 0.05], [0.1, 0.3, 0.3], [-0.35, 0.42, 0.42], [-0.5, 0.3, 0.3]], 10);
  } else {
    const g = model === 'glider', j = model === 'jet';
    const span = g ? 0.95 : j ? 0.48 : 0.6, chord = g ? 0.07 : j ? 0.2 : 0.15, sweep = j ? 0.28 : 0.02, wz = j ? -0.02 : g ? 0.03 : 0.06, wy = j ? 0.02 : 0.14;
    lathe('y', [[0.5, 0.008, 0.008], [0.4, 0.045, 0.05], [0.18, g ? 0.045 : 0.062, g ? 0.055 : 0.07], [-0.15, 0.04, 0.045, 0.01], [-0.5, 0.01, 0.015, 0.035]]);
    wings([[0.02, wy + chord / 2, wz], [span, wy - sweep + chord * 0.3, wz + span * 0.06], [span, wy - sweep - chord * 0.25, wz + span * 0.06], [0.02, wy - chord / 2, wz]]);
    const tz = g ? 0.2 : 0.045;
    wings([[0, -0.38, tz], [0.2, -0.44, tz], [0.2, -0.5, tz], [0, -0.5, tz]]);
    quad([0, -0.3, 0.03], [0, -0.44, 0.21], [0, -0.5, 0.21], [0, -0.5, 0.03], dark);
  }
  const nv = out.length / 6, buf = new ArrayBuffer(nv * MESH_STRIDE), f = new Float32Array(buf), i8 = new Int8Array(buf), dv = new DataView(buf);
  for (let i = 0; i < nv; i++) { f[i * 5] = out[i * 6]; f[i * 5 + 1] = out[i * 6 + 1]; f[i * 5 + 2] = out[i * 6 + 2]; for (let k = 0; k < 3; k++) i8[i * MESH_STRIDE + 12 + k] = Math.round(out[i * 6 + 3 + k] * 127); dv.setUint32(i * MESH_STRIDE + 16, cols[i]); }
  m = { vertices: buf, vertexCount: nv };
  if (meshes.size > 64) meshes.clear();
  meshes.set(key, m);
  return m;
}
/** Default length in metres of a vehicle shape. */
export const VEHICLE_LENGTH = { airplane: 8, glider: 7, jet: 35, helicopter: 12, bird: 0.6, balloon: 22, capsule: 4 };

/**
 * Rotation from a vehicle's own axes (x right, y forward, z up) to earth-centred axes, times its length.
 * @param {Float64Array} frame local frame at the vehicle @param {number} headingDeg @param {number} pitchDeg @param {number} rollDeg @param {number} scale @param {Float32Array} out 9 numbers, column-major
 */
export function attitudeMatrix(frame, headingDeg, pitchDeg, rollDeg, scale, out) {
  const hd = headingDeg * RAD, pt = pitchDeg * RAD, rl = rollDeg * RAD, sh = Math.sin(hd), ch = Math.cos(hd), sp = Math.sin(pt), cp = Math.cos(pt), sr = Math.sin(rl), cr = Math.cos(rl);
  const fwd = [sh * cp, ch * cp, sp], r0 = [ch, -sh, 0], u0 = [-sh * sp, -ch * sp, cp];
  const cols = [[r0[0] * cr - u0[0] * sr, r0[1] * cr - u0[1] * sr, r0[2] * cr - u0[2] * sr], fwd, [u0[0] * cr + r0[0] * sr, u0[1] * cr + r0[1] * sr, u0[2] * cr + r0[2] * sr]];
  for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[c * 3 + k] = scale * (cols[c][0] * frame[k] + cols[c][1] * frame[3 + k] + cols[c][2] * frame[6 + k]);
  return out;
}

/** Style of the vector layers of engine/world by kind (VEC): layer name, colour, half width in metres, minimum half width in pixels. */
export const VECTOR_STYLE = {
  1: { layer: 'coast', colour: rgba('#f2f0e0b0', 0), halfWidthM: 0, minPx: 0.7 },
  2: { layer: 'river', colour: rgba('#3f7fb0e0', 0), halfWidthM: 14, minPx: 0.7 },
  3: { layer: 'lake', colour: rgba('#3f7fb0c0', 0), halfWidthM: 0, minPx: 0.6 },
  4: { layer: 'road', colour: rgba('#5c5850e0', 0), halfWidthM: 5, minPx: 0.6 },
  5: { layer: 'rail', colour: rgba('#3c3438e0', 0), halfWidthM: 2, minPx: 0.5 },
  6: { layer: 'border', colour: rgba('#ffe08ad0', 0), halfWidthM: 0, minPx: 0.8 },
  7: { layer: 'border', colour: rgba('#ffe08aa8', 0), halfWidthM: 0, minPx: 0.8 },   // a boundary that is not settled: the base map hands it over as dashes
};
/** A local frame at a place on the sea sphere. */
export const frameOf = (lat, lon) => frameAt(lat, lon, 0);
