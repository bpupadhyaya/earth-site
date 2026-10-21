// @ts-check
// What the ground looks like: colours per land-cover class, and the vertex data of one terrain patch built from
// world.meshPatch(). Pure data in, typed arrays out; the WebGL layer only uploads them.
import { clamp, smooth } from './geo.mjs';

/** Base colour per land-cover class of engine/world (LC), 0..255. */
export const LC_RGB = [[128, 126, 108], [14, 44, 84], [34, 78, 108], [236, 240, 245], [158, 140, 114], [124, 130, 98], [106, 136, 74], [128, 130, 86], [152, 152, 86], [84, 114, 94], [142, 138, 134],
  [38, 74, 50], [34, 88, 44], [60, 100, 50], [48, 86, 50], [88, 114, 64]];
const FOREST = [0, 0, 0, 0, 0, 0, 0, 60, 0, 40, 0, 255, 255, 255, 255, 150];
const WATER = c => c === 1 || c === 2;
/** Smooth pseudo-random value in -1..1 at a point of a plane; `k` picks one of several independent fields. */
function wobble(x, y, k) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const h = (a, b) => { let n = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(k, 0x9e3779b1); n = Math.imul(n ^ (n >>> 15), 0x85ebca6b); n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35); return ((n ^ (n >>> 16)) >>> 0) / 2147483648 - 1; };
  const p = h(i, j), q = h(i + 1, j), r = h(i, j + 1), t = h(i + 1, j + 1);
  return p + (q - p) * sx + (r + (t - r) * sx - p - (q - p) * sx) * sy;
}
/** Bytes per patch vertex: position (3 floats), height (1 float), normal (4 signed bytes), colour (4 bytes), material (4 bytes). */
export const PATCH_STRIDE = 28;

/**
 * Vertex and index data of one terrain patch.
 * Vertex layout (PATCH_STRIDE bytes): x east, y north, z up in metres from the patch origin; height above sea level;
 * normal; colour r, g, b + cropland weight; material = water weight, tree weight, built-up weight, water depth.
 * @param {any} world engine/world instance @param {{ south: number, west: number, north: number, east: number, lat0: number, lon0: number }} box
 * @param {number} rows @param {number} cols @param {number} skirtM
 */
export function buildPatch(world, box, rows, cols, skirtM, cellDeg = 0) {
  const m = world.meshPatch({ south: box.south, west: box.west, north: box.north, east: box.east, rows, cols, skirtM, originLat: box.lat0, originLon: box.lon0 });
  const nv = m.positions.length / 3, grid = m.gridVertices, cw = cols + 1, buf = new ArrayBuffer(nv * PATCH_STRIDE), f = new Float32Array(buf), i8 = new Int8Array(buf), u8 = new Uint8Array(buf);
  const lc = m.landCover, dLat = (box.north - box.south) / rows, dLon = (box.east - box.west) / cols, col = new Uint8Array(grid * 8);
  // A patch about as fine as the land-cover cells, or finer, would show them as squares: look the class up a little to the side, by a smooth
  // amount that depends only on the place, so that fields and woods get irregular edges. Shores stay where the heights put them.
  if (cellDeg > dLat * 0.3) for (let v = 0; v < grid; v++) {
    if (WATER(lc[v] & 15)) continue;
    const lat = box.south + Math.floor(v / cw) * dLat, lon = box.west + (v % cw) * dLon, a = lat / cellDeg, b = lon / cellDeg;
    const c = world.landCover(lat + cellDeg * 0.42 * (wobble(a * 0.83, b * 0.83, 1) + 0.4 * wobble(a * 2.9, b * 2.9, 3)), lon + cellDeg * 0.42 * (wobble(a * 0.83, b * 0.83, 2) + 0.4 * wobble(a * 2.9, b * 2.9, 4)));
    if (!WATER(c & 15)) lc[v] = c;
  }
  let minH = Infinity, maxH = -Infinity;
  for (let v = 0; v < grid; v++) {
    const c = lc[v] & 15, k = LC_RGB[c], o = v * 8, h = m.heights[v];
    if (h < minH) minH = h; if (h > maxH) maxH = h;
    col[o] = k[0]; col[o + 1] = k[1]; col[o + 2] = k[2]; col[o + 3] = c === 8 ? 255 : 0;
    col[o + 5] = FOREST[c]; col[o + 6] = c === 10 ? 255 : 0;
    if (WATER(c)) {
      col[o + 4] = 255;
      col[o + 7] = c === 1 && world.bathymetry ? Math.round(255 * smooth(0, 3500, -world.bathymetry(box.south + Math.floor(v / cw) * dLat, box.west + (v % cw) * dLon))) : 40;
    }
  }
  // water vertices take the colour of the land next to them, so that the shore line (drawn where the water weight crosses one half) has land colour on its land side
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const v = j * cw + i, o = v * 8;
    if (!col[o + 4]) continue;
    let r = 0, g = 0, b = 0, n = 0;
    for (let b2 = -1; b2 <= 1; b2++) for (let a = -1; a <= 1; a++) {
      const ii = i + a, jj = j + b2;
      if (ii < 0 || jj < 0 || ii > cols || jj > rows) continue;
      const c = lc[jj * cw + ii] & 15;
      if (!WATER(c)) { r += LC_RGB[c][0]; g += LC_RGB[c][1]; b += LC_RGB[c][2]; n++; }
    }
    if (n) { col[o] = r / n; col[o + 1] = g / n; col[o + 2] = b / n; } else { col[o] = 150; col[o + 1] = 142; col[o + 2] = 110; }
  }
  // skirt vertices repeat the rim of the grid in the order world.meshPatch appends them
  const src = new Uint32Array(nv);
  for (let v = 0; v < grid; v++) src[v] = v;
  if (nv > grid) {
    let k = grid;
    for (let i = 0; i < cols; i++) src[k++] = i;
    for (let j = 0; j < rows; j++) src[k++] = j * cw + cols;
    for (let i = cols; i > 0; i--) src[k++] = rows * cw + i;
    for (let j = rows; j > 0; j--) src[k++] = j * cw;
  }
  for (let v = 0; v < nv; v++) {
    const s = src[v], o = v * 7, b = v * PATCH_STRIDE, c = s * 8;
    f[o] = m.positions[3 * v]; f[o + 1] = m.positions[3 * v + 1]; f[o + 2] = m.positions[3 * v + 2]; f[o + 3] = m.heights[s];
    i8[b + 16] = Math.round(m.normals[3 * v] * 127); i8[b + 17] = Math.round(m.normals[3 * v + 1] * 127); i8[b + 18] = Math.round(m.normals[3 * v + 2] * 127);
    for (let q = 0; q < 8; q++) u8[b + 20 + q] = col[c + q];
  }
  return { vertices: buf, indices: m.indices, vertexCount: nv, indexCount: m.indices.length, gridIndexCount: rows * cols * 6, rows, cols, minH, maxH };
}

/**
 * Colour of the ground at a point for the Canvas2D renderer: land cover, snow line, relief shading from a light direction.
 * @param {any} world @param {number} lat @param {number} lon @param {number[]} lightEnu unit vector at the light, east/north/up
 * @param {number} bright 0..1.5 @param {number[]} out r, g, b in 0..255 @param {boolean} [relief]
 */
export function groundColour(world, lat, lon, lightEnu, bright, out, relief = true) {
  const c = world.landCover(lat, lon) & 15, k = LC_RGB[c];
  let r = k[0], g = k[1], b = k[2], shade = 1;
  if (!WATER(c)) {
    const h = world.elevation(lat, lon, { detail: false }), line = 5200 - 5200 * smooth(0.5, 1, Math.abs(Math.sin(lat * 0.017453292519943295))), s = smooth(-150, 250, h - line);
    r += (238 - r) * s; g += (241 - g) * s; b += (246 - b) * s;
    if (relief) { const nrm = world.normal(lat, lon); shade = clamp(0.35 + 0.9 * (nrm[0] * lightEnu[0] + nrm[1] * lightEnu[1] + nrm[2] * Math.max(lightEnu[2], 0.35)), 0.25, 1.3); }
  }
  out[0] = clamp(r * shade * bright, 0, 255); out[1] = clamp(g * shade * bright, 0, 255); out[2] = clamp(b * shade * bright, 0, 255);
  return out;
}
