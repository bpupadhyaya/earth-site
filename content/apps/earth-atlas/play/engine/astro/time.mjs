// @ts-check
// Shared astronomy time and coordinate helpers. Pure functions of milliseconds since the Unix epoch (UTC; the TT-UT difference of ~70 s is ignored,
// it changes the moon by < 0.01 degree). Formulas: Meeus, "Astronomical Algorithms" 2nd ed. (chapters 7, 12, 13, 21, 22) and Schlyter's day number.
export const rad = d => (d * Math.PI) / 180;
export const deg = r => (r * 180) / Math.PI;
/** @param {number} x degrees */
export const norm360 = x => ((x % 360) + 360) % 360;
/** @param {number} x degrees */
export const norm180 = x => { const n = norm360(x); return n > 180 ? n - 360 : n; };

/** Julian date (UT) from ms. @param {number} ms */
export const julianDate = ms => ms / 86400000 + 2440587.5;
/** Julian centuries since J2000.0. @param {number} ms */
export const centuries = ms => (julianDate(ms) - 2451545) / 36525;
/** Schlyter day number: days since 1999-12-31 00:00 UT. @param {number} ms */
export const dayNumber = ms => julianDate(ms) - 2451543.5;
/** ms from a Julian date. @param {number} jd */
export const msFromJd = jd => (jd - 2440587.5) * 86400000;

/** Mean obliquity of the ecliptic of date, degrees. @param {number} ms */
export function obliquity(ms) { const T = centuries(ms); return 23.439291111 - 0.0130041667 * T - 1.64e-7 * T * T; }

/** Greenwich mean sidereal time, degrees. @param {number} ms */
export function gmst(ms) {
  const jd = julianDate(ms), T = (jd - 2451545) / 36525;
  return norm360(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T - (T * T * T) / 38710000);
}
/** Local mean sidereal time, degrees. @param {number} ms @param {number} lon east positive */
export const lst = (ms, lon) => norm360(gmst(ms) + lon);

/** Ecliptic (lon, lat degrees) to equatorial (ra, dec degrees) for obliquity eps degrees. */
export function eclipticToEquatorial(lonDeg, latDeg, epsDeg) {
  const l = rad(lonDeg), b = rad(latDeg), e = rad(epsDeg);
  const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  return { ra: norm360(deg(ra)), dec: deg(dec) };
}

/** Equatorial of date (ra, dec degrees) to horizontal for local sidereal time (degrees) and latitude. Azimuth clockwise from north. */
export function equatorialToHorizontal(raDeg, decDeg, lstDeg, latDeg) {
  const H = rad(lstDeg - raDeg), d = rad(decDeg), p = rad(latDeg);
  const sinAlt = Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(H);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const az = Math.atan2(-Math.cos(d) * Math.sin(H), Math.sin(d) * Math.cos(p) - Math.cos(d) * Math.sin(p) * Math.cos(H));
  return { altitude: deg(alt), azimuth: norm360(deg(az)) };
}

/** Precess J2000 (ra, dec degrees) to the equator of date (Meeus 21.2). @param {number} T Julian centuries since J2000 */
export function precessFromJ2000(raDeg, decDeg, T) {
  const as = Math.PI / 648000;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) * as;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) * as;
  const th = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) * as;
  const a = rad(raDeg), d = rad(decDeg);
  const A = Math.cos(d) * Math.sin(a + zeta);
  const B = Math.cos(th) * Math.cos(d) * Math.cos(a + zeta) - Math.sin(th) * Math.sin(d);
  const C = Math.sin(th) * Math.cos(d) * Math.cos(a + zeta) + Math.cos(th) * Math.sin(d);
  return { ra: norm360(deg(Math.atan2(A, B) + z)), dec: deg(Math.asin(Math.max(-1, Math.min(1, C)))) };
}

/** Atmospheric refraction in degrees for a true (geometric) altitude in degrees (Saemundsson 1986, 1010 hPa, 10 C). Valid above about -1 degree. */
export function refraction(altDeg) {
  if (altDeg < -1.5) return 0;
  return 1.02 / Math.tan(rad(altDeg + 10.3 / (altDeg + 5.11))) / 60;
}

/** Kepler's equation, returns eccentric anomaly in radians. @param {number} Mrad @param {number} e */
export function solveKepler(Mrad, e) {
  let E = Mrad + e * Math.sin(Mrad) * (1 + e * Math.cos(Mrad));
  for (let i = 0; i < 12; i++) {
    const dE = (E - e * Math.sin(E) - Mrad) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}
