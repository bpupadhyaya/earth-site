// @ts-check
// Mesh patch extraction: a regular latitude/longitude grid of the terrain as typed arrays for a renderer.
// Positions are metres in a local east-north-up frame on the mean sphere, relative to an origin, so 32-bit floats stay precise.
import { EARTH_RADIUS_M, M_PER_DEG } from './addressing.mjs';

const RAD = 0.017453292519943295;
/** Post spacing of pyramid level 0 in metres. */
const LEVEL0_POST_M = 180 / 256 * M_PER_DEG;

/**
 * @typedef {object} PatchRequest
 * @property {number} south @property {number} west @property {number} north @property {number} east   degrees; east may exceed 180 to cross the date line
 * @property {number} rows   grid intervals south to north (1..1024)
 * @property {number} cols   grid intervals west to east (1..1024)
 * @property {number} [originLat] @property {number} [originLon] @property {number} [originAltM]   frame origin; default: patch centre at sea level
 * @property {number} [skirtM]   when > 0, a vertical skirt of this depth is added around the patch to hide gaps between patches of different detail
 * @property {boolean} [detail]  false = data surface only
 *
 * @typedef {object} MeshPatch
 * @property {Float32Array} positions   x east, y north, z up, metres from the origin; 3 per vertex
 * @property {Float32Array} normals     unit normals in the same frame; 3 per vertex
 * @property {Uint16Array|Uint32Array} indices   triangles, counter-clockwise seen from above
 * @property {Float32Array} heights     elevation in metres above sea level; 1 per grid vertex
 * @property {Uint8Array} landCover     class id; 1 per grid vertex
 * @property {number} rows @property {number} cols
 * @property {number} gridVertices      vertices of the grid itself ((rows+1) * (cols+1)); skirt vertices follow
 * @property {number} detailLevel       finest procedural octave used (chosen from the grid spacing to avoid aliasing; -1 = none)
 * @property {{ lat: number, lon: number, altM: number }} origin
 */

/**
 * @param {PatchRequest} req
 * @param {{ height: (lat: number, lon: number, maxLevel: number) => number, landCover: (lat: number, lon: number) => number }} src
 * @returns {MeshPatch}
 */
export function buildMeshPatch(req, src) {
  const rows = Math.max(1, Math.min(1024, Math.floor(req.rows))), cols = Math.max(1, Math.min(1024, Math.floor(req.cols)));
  const dLat = (req.north - req.south) / rows, dLon = (req.east - req.west) / cols;
  const lat0 = req.originLat ?? (req.south + req.north) / 2, lon0 = req.originLon ?? (req.west + req.east) / 2, alt0 = req.originAltM ?? 0;
  const midCos = Math.max(0.02, Math.cos(Math.min(89.9, Math.max(Math.abs(req.south), Math.abs(req.north))) * RAD));
  const spacing = Math.min(dLat * M_PER_DEG, dLon * M_PER_DEG * midCos);
  let detailLevel = -1;
  while (detailLevel < 22 && LEVEL0_POST_M / 2 ** (detailLevel + 1) >= 2 * spacing) detailLevel++;

  // frame: rotation from earth-centred coordinates to east-north-up at the origin
  const sp = Math.sin(lat0 * RAD), cp = Math.cos(lat0 * RAD), sl = Math.sin(lon0 * RAD), cl = Math.cos(lon0 * RAD), r0 = EARTH_RADIUS_M + alt0;
  const R = rows + 3, C = cols + 3;                       // one extra ring for normals
  const px = new Float64Array(R * C), py = new Float64Array(R * C), pz = new Float64Array(R * C), hh = new Float64Array(R * C);
  for (let j = 0; j < R; j++) {
    const lat = Math.max(-90, Math.min(90, req.south + (j - 1) * dLat)), sphi = Math.sin(lat * RAD), cphi = Math.cos(lat * RAD);
    for (let i = 0; i < C; i++) {
      const lon = req.west + (i - 1) * dLon, h = src.height(lat, lon, detailLevel), r = EARTH_RADIUS_M + h;
      const x = r * cphi * Math.cos(lon * RAD) - r0 * cp * cl, y = r * cphi * Math.sin(lon * RAD) - r0 * cp * sl, z = r * sphi - r0 * sp, o = j * C + i;
      px[o] = -sl * x + cl * y; py[o] = -sp * cl * x - sp * sl * y + cp * z; pz[o] = cp * cl * x + cp * sl * y + sp * z; hh[o] = h;
    }
  }
  const grid = (rows + 1) * (cols + 1), skirt = req.skirtM && req.skirtM > 0 ? 2 * (rows + cols) : 0, nv = grid + skirt;
  const positions = new Float32Array(nv * 3), normals = new Float32Array(nv * 3), heights = new Float32Array(grid), landCover = new Uint8Array(grid);
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const o = (j + 1) * C + i + 1, v = j * (cols + 1) + i;
    positions[3 * v] = px[o]; positions[3 * v + 1] = py[o]; positions[3 * v + 2] = pz[o]; heights[v] = hh[o];
    const ex = px[o + 1] - px[o - 1], ey = py[o + 1] - py[o - 1], ez = pz[o + 1] - pz[o - 1], nx = px[o + C] - px[o - C], ny = py[o + C] - py[o - C], nz = pz[o + C] - pz[o - C];
    let cx = ey * nz - ez * ny, cy = ez * nx - ex * nz, cz = ex * ny - ey * nx;
    const l = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (l > 0) { cx /= l; cy /= l; cz /= l; } else { cx = 0; cy = 0; cz = 1; }
    normals[3 * v] = cx; normals[3 * v + 1] = cy; normals[3 * v + 2] = cz;
    landCover[v] = src.landCover(Math.max(-90, Math.min(90, req.south + j * dLat)), req.west + i * dLon);
  }
  const tris = rows * cols * 2 + skirt * 2;
  const indices = nv > 65535 ? new Uint32Array(tris * 3) : new Uint16Array(tris * 3);
  let p = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    indices[p++] = a; indices[p++] = b; indices[p++] = d; indices[p++] = a; indices[p++] = d; indices[p++] = c;
  }
  if (skirt) {
    /** @type {number[]} */
    const rim = [];
    for (let i = 0; i < cols; i++) rim.push(i);
    for (let j = 0; j < rows; j++) rim.push(j * (cols + 1) + cols);
    for (let i = cols; i > 0; i--) rim.push(rows * (cols + 1) + i);
    for (let j = rows; j > 0; j--) rim.push(j * (cols + 1));
    const depth = /** @type {number} */ (req.skirtM);
    rim.forEach((v, k) => {
      const s = grid + k;
      positions[3 * s] = positions[3 * v]; positions[3 * s + 1] = positions[3 * v + 1]; positions[3 * s + 2] = positions[3 * v + 2] - depth;
      normals[3 * s] = normals[3 * v]; normals[3 * s + 1] = normals[3 * v + 1]; normals[3 * s + 2] = normals[3 * v + 2];
    });
    for (let k = 0; k < rim.length; k++) {
      const a = rim[k], a2 = rim[(k + 1) % rim.length], s = grid + k, s2 = grid + (k + 1) % rim.length;
      indices[p++] = a; indices[p++] = s; indices[p++] = s2; indices[p++] = a; indices[p++] = s2; indices[p++] = a2;
    }
  }
  return { positions, normals, indices, heights, landCover, rows, cols, gridVertices: grid, detailLevel, origin: { lat: lat0, lon: lon0, altM: alt0 } };
}
