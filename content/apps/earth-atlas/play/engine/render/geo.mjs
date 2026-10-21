// @ts-check
// Geometry on the mean sphere used by engine/world (radius 6 371 008.8 m), in 64-bit numbers.
// Earth-centred axes: x through latitude 0 / longitude 0, y through 90 E, z through the north pole.
// A local frame at a place has axes east, north, up; frames are stored as 12 numbers: E(3), N(3), U(3), origin(3).

export const R_EARTH = 6371008.8;
export const RAD = Math.PI / 180;
export const DEG = 180 / Math.PI;
export const M_PER_DEG = R_EARTH * RAD;

/** @param {number} v @param {number} a @param {number} b */
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/** @param {number} a @param {number} b @param {number} t */
export const mix = (a, b, t) => a + (b - a) * t;
/** @param {number} a @param {number} b @param {number} v */
export const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** Longitude (or any angle in degrees) wrapped into [-180, 180). @param {number} d */
export const wrap180 = d => (d >= -180 && d < 180 ? d : d - 360 * Math.floor((d + 180) / 360));
/** A finite number or the fallback. @param {any} v @param {number} d */
export const num = (v, d) => (typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity ? v : d);

/**
 * Local frame at a place. @param {number} lat @param {number} lon @param {number} [altM]
 * @param {Float64Array} [out] 12 numbers: east, north, up unit vectors and the origin, all earth-centred
 */
export function frameAt(lat, lon, altM = 0, out = new Float64Array(12)) {
  const sp = Math.sin(lat * RAD), cp = Math.cos(lat * RAD), sl = Math.sin(lon * RAD), cl = Math.cos(lon * RAD), r = R_EARTH + altM;
  out[0] = -sl; out[1] = cl; out[2] = 0;
  out[3] = -sp * cl; out[4] = -sp * sl; out[5] = cp;
  out[6] = cp * cl; out[7] = cp * sl; out[8] = sp;
  out[9] = r * out[6]; out[10] = r * out[7]; out[11] = r * out[8];
  return out;
}

/** Earth-centred position of a place. @param {number} lat @param {number} lon @param {number} altM @param {number[]|Float64Array} [out] */
export function toEcef(lat, lon, altM, out = [0, 0, 0]) {
  const cp = Math.cos(lat * RAD), r = R_EARTH + altM;
  out[0] = r * cp * Math.cos(lon * RAD); out[1] = r * cp * Math.sin(lon * RAD); out[2] = r * Math.sin(lat * RAD);
  return out;
}

/** @param {number} x @param {number} y @param {number} z @returns {{ lat: number, lon: number, altM: number }} */
export function fromEcef(x, y, z) {
  const r = Math.sqrt(x * x + y * y + z * z) || 1;
  return { lat: Math.asin(clamp(z / r, -1, 1)) * DEG, lon: Math.atan2(y, x) * DEG, altM: r - R_EARTH };
}

/** Position of a place in a local frame (metres east, north, up from its origin). @param {Float64Array} f @param {number[]|Float64Array|Float32Array} out @param {number} o */
export function toLocal(f, lat, lon, altM, out, o) {
  const cp = Math.cos(lat * RAD), r = R_EARTH + altM;
  const x = r * cp * Math.cos(lon * RAD) - f[9], y = r * cp * Math.sin(lon * RAD) - f[10], z = r * Math.sin(lat * RAD) - f[11];
  out[o] = f[0] * x + f[1] * y + f[2] * z; out[o + 1] = f[3] * x + f[4] * y + f[5] * z; out[o + 2] = f[6] * x + f[7] * y + f[8] * z;
}

/** Central angle in radians between two places. */
export function arc(lat1, lon1, lat2, lon2) {
  const a = Math.sin((lat2 - lat1) * RAD / 2), b = Math.sin((lon2 - lon1) * RAD / 2);
  return 2 * Math.asin(Math.min(1, Math.sqrt(a * a + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * b * b)));
}

/** The place reached from a start along a bearing. @returns {[number, number]} latitude, longitude */
export function destination(lat, lon, bearingDeg, distM) {
  const d = distM / R_EARTH, b = bearingDeg * RAD, sp = Math.sin(lat * RAD), cp = Math.cos(lat * RAD);
  const s2 = clamp(sp * Math.cos(d) + cp * Math.sin(d) * Math.cos(b), -1, 1);
  return [Math.asin(s2) * DEG, wrap180(lon + Math.atan2(Math.sin(b) * Math.sin(d) * cp, Math.cos(d) - sp * s2) * DEG)];
}

/** Central angle in radians from a point to the nearest point of a latitude/longitude box. */
export function arcToBox(lat, lon, south, west, north, east) {
  const clat = lat < south ? south : lat > north ? north : lat, half = (east - west) / 2;
  const off = Math.abs(wrap180(lon - west - half)), dlon = off <= half ? 0 : off - half;
  // nearest point on a meridian edge is not at the camera's latitude when the edge is far east or west; the clamped latitude is close enough for level-of-detail
  return arc(lat, 0, clat, dlon);
}

/** Angle in radians from a viewpoint at height h to its horizon on the sphere. @param {number} h */
export const horizonArc = h => Math.acos(R_EARTH / (R_EARTH + Math.max(h, 0)));

/** Colours: '#rgb', '#rrggbb', '#rrggbbaa' or [r, g, b, a?] in 0..1 -> one number 0xRRGGBBAA. @param {any} c @param {number} fallback */
export function rgba(c, fallback) {
  if (typeof c === 'number') return c >>> 0;
  if (Array.isArray(c) && c.length >= 3) return ((clamp(Math.round(c[0] * 255), 0, 255) << 24) | (clamp(Math.round(c[1] * 255), 0, 255) << 16) | (clamp(Math.round(c[2] * 255), 0, 255) << 8) | clamp(Math.round(num(c[3], 1) * 255), 0, 255)) >>> 0;
  if (typeof c === 'string' && c[0] === '#') {
    let s = c.slice(1);
    if (s.length === 3 || s.length === 4) s = s.replace(/./g, '$&$&');
    if (/^[0-9a-f]{6}$/i.test(s)) return (parseInt(s, 16) * 256 + 255) >>> 0;
    if (/^[0-9a-f]{8}$/i.test(s)) return parseInt(s, 16) >>> 0;
  }
  return fallback >>> 0;
}
/** @param {number} c 0xRRGGBBAA @param {number} [alpha] multiplier */
export const cssColour = (c, alpha = 1) => `rgba(${c >>> 24},${(c >>> 16) & 255},${(c >>> 8) & 255},${(((c & 255) / 255) * alpha).toFixed(3)})`;
