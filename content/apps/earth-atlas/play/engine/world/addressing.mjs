// @ts-check
// Tile pyramid addressing: an equal-angle quadtree over latitude/longitude with two root tiles.
//   level z has 2^(z+1) columns (x, from 180W eastwards) and 2^z rows (y, from 90S northwards); a tile spans 180 / 2^z degrees.
//   every tile has TILE_N intervals of latitude; towards the poles the number of longitude intervals halves in bands so that the
//   east-west post spacing never shrinks below half of the north-south spacing (see README, "Poles").
// All functions here use only +, -, *, /, comparisons and Math.floor, so they give identical results on every engine.

export const TILE_N = 256;
export const MAX_LEVEL = 12;
/** Tiles are stored in bundles: all tiles of level z that share an ancestor BUNDLE_SPAN levels up (at most 16 tiles a bundle). */
export const BUNDLE_SPAN = 2;
/** |latitude| in degrees at which cos = 1/2, 1/4, 1/8, 1/16: where the longitude post count halves. */
export const BAND_LATS = [60, 75.52248781407008, 82.81924421854173, 86.41668033741773];

/** @param {number} z */
export const tileSpan = z => 180 / (1 << z);
/** @param {number} z @param {number} x @param {number} y */
export const tileId = (z, x, y) => z * 67108864 + y * 8192 + x;
/** @param {number} id */
export const tileFromId = id => ({ z: Math.floor(id / 67108864), y: Math.floor((id % 67108864) / 8192), x: id % 8192 });

/** Longitude wrapped into [-180, 180). @param {number} lon */
export function wrapLon(lon) {
  if (lon >= -180 && lon < 180) return lon;
  const w = lon - 360 * Math.floor((lon + 180) / 360);
  return w >= 180 ? -180 : w;
}
/** @param {number} lat */
export const clampLat = lat => (lat > 90 ? 90 : lat < -90 ? -90 : lat);

/** Tile column of a longitude at level z. @param {number} z @param {number} lon */
export function tileX(z, lon) { const c = 2 << z, x = Math.floor((wrapLon(lon) + 180) / 360 * c); return x >= c ? c - 1 : x < 0 ? 0 : x; }
/** Tile row of a latitude at level z (the north pole belongs to the top row). @param {number} z @param {number} lat */
export function tileY(z, lat) { const r = 1 << z, y = Math.floor((clampLat(lat) + 90) / 180 * r); return y >= r ? r - 1 : y < 0 ? 0 : y; }

/** @param {number} z @param {number} x @param {number} y */
export function tileBounds(z, x, y) { const s = tileSpan(z); return { south: -90 + y * s, west: -180 + x * s, north: -90 + (y + 1) * s, east: -180 + (x + 1) * s }; }

/**
 * Number of longitude intervals of the tile row y at level z (TILE_N, halved once per latitude band the row lies beyond).
 * @param {number} z @param {number} y @param {number} [n]
 */
export function lonIntervals(z, y, n = TILE_N) {
  const s = tileSpan(z), south = -90 + y * s, north = south + s;
  const a = south >= 0 ? south : north <= 0 ? -north : 0;     // edge nearest the equator
  let k = 0;
  while (k < BAND_LATS.length && a >= BAND_LATS[k] && (n >> (k + 1)) >= 16) k++;
  return n >> k;
}

/** Bundle that holds a tile: { z, gz, ax, ay } with (ax, ay) the ancestor at level gz. @param {number} z @param {number} x @param {number} y */
export function bundleOf(z, x, y) {
  const gz = z > BUNDLE_SPAN ? z - BUNDLE_SPAN : 0, sh = z - gz;
  return { z, gz, ax: x >> sh, ay: y >> sh };
}
/** @param {number} z @param {number} x @param {number} y */
export function bundleKey(z, x, y) { const b = bundleOf(z, x, y); return `${z}/${b.ax}/${b.ay}`; }

/** Metres per degree of latitude on the mean sphere used for horizontal distances. */
export const M_PER_DEG = 111194.92664455873;
export const EARTH_RADIUS_M = 6371008.8;

/**
 * cos(latitude in degrees) by a fixed polynomial (error below 1e-7): used wherever results must be identical on every engine.
 * @param {number} latDeg
 */
export function cosDeg(latDeg) {
  let a = latDeg < 0 ? -latDeg : latDeg; if (a > 90) a = 90;
  // cos(x) = sin(pi/2 - x); evaluate on [0, pi/4] by symmetry
  const x = a * 0.017453292519943295;
  if (x <= 0.7853981633974483) { const q = x * x; return 1 + q * (-0.5 + q * (0.041666666666666664 + q * (-0.001388888888888889 + q * (0.0000248015873015873 - q * 2.755731922398589e-7)))); }
  const t = 1.5707963267948966 - x, q = t * t;
  return t * (1 + q * (-0.16666666666666666 + q * (0.008333333333333333 + q * (-0.0001984126984126984 + q * 0.0000027557319223985893))));
}
