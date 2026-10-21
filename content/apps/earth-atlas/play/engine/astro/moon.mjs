// @ts-check
// Moon: position, phase, illumination, topocentric altitude/azimuth and phase-event finder, from clock + location. No tables, no network.
// Method: Paul Schlyter's "How to compute planetary positions" lunar orbital elements with his 12 longitude, 5 latitude and 2 distance
// perturbation terms (public-domain algorithm notes, stjarnhimlen.se). Accuracy: ~0.25 degrees in ecliptic longitude, ~0.2 in latitude,
// distance ~0.5 percent; phase events within ~1.5 hours; rise/set within ~10 minutes. Good for sky rendering, phase glyphs, tide timing.
import { rad, deg, norm360, norm180, dayNumber, obliquity, eclipticToEquatorial, equatorialToHorizontal, lst, solveKepler, refraction } from './time.mjs';

/** Geocentric ecliptic longitude of the sun (degrees) and mean anomaly, Schlyter low-precision (~0.01-0.02 degrees). */
export function sunEclipticLongitude(ms) {
  const d = dayNumber(ms);
  const w = 282.9404 + 4.70935e-5 * d, e = 0.016709 - 1.151e-9 * d, M = norm360(356.047 + 0.9856002585 * d);
  const E = solveKepler(rad(M), e);
  const xv = Math.cos(E) - e, yv = Math.sqrt(1 - e * e) * Math.sin(E);
  return { lon: norm360(deg(Math.atan2(yv, xv)) + w), M, w, r: Math.hypot(xv, yv) };
}

/**
 * Geocentric moon: ecliptic longitude/latitude (degrees of date), distance in Earth radii, equatorial ra/dec (degrees of date).
 * @param {number} ms
 */
export function moonGeocentric(ms) {
  const d = dayNumber(ms);
  const N = norm360(125.1228 - 0.0529538083 * d), i = 5.1454, w = norm360(318.0634 + 0.1643573223 * d);
  const a = 60.2666, e = 0.0549, Mm = norm360(115.3654 + 13.0649929509 * d);
  const E = solveKepler(rad(Mm), e);
  const xv = a * (Math.cos(E) - e), yv = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const v = deg(Math.atan2(yv, xv)), r = Math.hypot(xv, yv);
  const vw = rad(v + w), Nr = rad(N), ir = rad(i);
  const xh = r * (Math.cos(Nr) * Math.cos(vw) - Math.sin(Nr) * Math.sin(vw) * Math.cos(ir));
  const yh = r * (Math.sin(Nr) * Math.cos(vw) + Math.cos(Nr) * Math.sin(vw) * Math.cos(ir));
  const zh = r * Math.sin(vw) * Math.sin(ir);
  let lon = deg(Math.atan2(yh, xh)), lat = deg(Math.atan2(zh, Math.hypot(xh, yh)));
  let dist = Math.hypot(xh, yh, zh);
  const sun = sunEclipticLongitude(ms);
  const Ms = sun.M, Ls = sun.w + Ms, Lm = Mm + w + N, D = Lm - Ls, F = Lm - N;
  const s = x => Math.sin(rad(x)), c = x => Math.cos(rad(x));
  lon += -1.274 * s(Mm - 2 * D) + 0.658 * s(2 * D) - 0.186 * s(Ms) - 0.059 * s(2 * Mm - 2 * D) - 0.057 * s(Mm - 2 * D + Ms)
    + 0.053 * s(Mm + 2 * D) + 0.046 * s(2 * D - Ms) + 0.041 * s(Mm - Ms) - 0.035 * s(D) - 0.031 * s(Mm + Ms) - 0.015 * s(2 * F - 2 * D) + 0.011 * s(Mm - 4 * D);
  lat += -0.173 * s(F - 2 * D) - 0.055 * s(Mm - F - 2 * D) - 0.046 * s(Mm + F - 2 * D) + 0.033 * s(F + 2 * D) + 0.017 * s(2 * Mm + F);
  dist += -0.58 * c(Mm - 2 * D) - 0.46 * c(2 * D);
  lon = norm360(lon);
  const eq = eclipticToEquatorial(lon, lat, obliquity(ms));
  return { lon, lat, distance: dist, ra: eq.ra, dec: eq.dec };
}

/**
 * Phase of the moon.
 * @param {number} ms
 * @returns {{ elongation: number, illumination: number, age: number, name: string, waxing: boolean, phaseIndex: number }}
 *   elongation 0..360 (moon longitude minus sun longitude; 0 new, 180 full), illumination 0..1, age in days since new (approximate), name one of
 *   new, waxing-crescent, first-quarter, waxing-gibbous, full, waning-gibbous, last-quarter, waning-crescent.
 */
export function moonPhase(ms) {
  const m = moonGeocentric(ms), s = sunEclipticLongitude(ms);
  const elongation = norm360(m.lon - s.lon);
  const illumination = (1 - Math.cos(rad(elongation))) / 2;
  const idx = Math.floor((elongation + 22.5) / 45) % 8;
  const names = ['new', 'waxing-crescent', 'first-quarter', 'waxing-gibbous', 'full', 'waning-gibbous', 'last-quarter', 'waning-crescent'];
  return { elongation, illumination, age: (elongation / 360) * 29.530589, name: names[idx], waxing: elongation < 180, phaseIndex: idx };
}

/**
 * Topocentric moon position (parallax included, ~1 degree at the horizon). Altitude is geometric; add refraction() for the apparent value.
 * @returns {{ altitude: number, azimuth: number, ra: number, dec: number, distanceKm: number, angularDiameter: number }}
 */
export function moonPosition(ms, lat, lon) {
  const m = moonGeocentric(ms);
  const L = lst(ms, lon);
  const H = rad(L - m.ra), phi = rad(lat), dec = rad(m.dec);
  const par = Math.asin(1 / m.distance); // equatorial horizontal parallax
  // Topocentric ra/dec (Meeus 40.2-40.3, spherical Earth)
  const rho = 1;
  const dRa = Math.atan2(-rho * Math.sin(par) * Math.cos(phi) * Math.sin(H), Math.cos(dec) - rho * Math.sin(par) * Math.cos(phi) * Math.cos(H));
  const decT = Math.atan2((Math.sin(dec) - rho * Math.sin(par) * Math.sin(phi)) * Math.cos(dRa), Math.cos(dec) - rho * Math.sin(par) * Math.cos(phi) * Math.cos(H));
  const raT = m.ra + deg(dRa);
  const h = equatorialToHorizontal(raT, deg(decT), L, lat);
  return { altitude: h.altitude, azimuth: h.azimuth, ra: norm360(raT), dec: deg(decT), distanceKm: m.distance * 6378.14, angularDiameter: deg(2 * Math.asin(1737.4 / (m.distance * 6378.14))) };
}

/** Altitude threshold (degrees, geometric centre) at which the upper limb of the moon meets the horizon with standard refraction. */
export function moonHorizonThreshold(ms) {
  const m = moonGeocentric(ms);
  // topocentric altitude of the centre at rise = -(refraction at horizon 34') - semi-diameter; parallax is already inside moonPosition
  return -(34 / 60) - deg(Math.asin(1737.4 / (m.distance * 6378.14)));
}

/** Convenience: apparent (refracted) altitude. */
export const apparentAltitude = alt => alt + refraction(alt);

/**
 * Next time at or after ms when the moon reaches the target elongation (0 new, 90 first quarter, 180 full, 270 last quarter).
 * @param {number} ms @param {0|90|180|270|number} target
 * @returns {number} ms
 */
export function nextMoonPhase(ms, target) {
  const f = t => norm180(moonPhase(t).elongation - target);
  let t = ms;
  // elongation advances ~12.19 deg/day; step by 6 hours until the signed difference crosses zero going up
  let prev = f(t);
  for (let i = 0; i < 4 * 31; i++) {
    const t2 = t + 6 * 3600000, v = f(t2);
    if (prev <= 0 && v > 0 && v - prev < 90) {
      let a = t, b = t2;
      while (b - a > 1000) { const m = (a + b) / 2; if (f(m) <= 0) a = m; else b = m; }
      return Math.round((a + b) / 2);
    }
    t = t2; prev = v;
  }
  return NaN;
}
