// @ts-check
// Light and air of one frame as plain numbers for both renderers: where the sun is, how bright and what colour the light is,
// the colours of the sky, how thick the haze is. Taken from the handle's `light` (engine/sim/weather lighting() output) where
// present, otherwise worked out from the handle's `time` with engine/astro. Nothing is drawn here.
import { sunPosition } from '../astro/sun.mjs';
import { moonPosition, moonPhase } from '../astro/moon.mjs';
import { RAD, clamp, mix, num, smooth } from './geo.mjs';

const lerp3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
/** Colour of a light source by its colour temperature, relative to white at 6500 K. @param {number} k */
function temperature(k) {
  const t = clamp(k, 1800, 10000);
  return t < 6500 ? lerp3([1, 0.52, 0.2], [1, 1, 1], Math.pow((t - 1800) / 4700, 0.6)) : lerp3([1, 1, 1], [0.8, 0.88, 1], (t - 6500) / 3500);
}

/**
 * @param {ReturnType<typeof import('./handle.mjs').normalise>} n @param {{ lat: number, lon: number, altM: number, frame?: Float64Array, map?: boolean }} view
 */
export function frameLight(n, view) {
  const L = n.light || {}, lit = n.layers.terminator;
  let e = num(L.sunE, NaN), nn = num(L.sunN, NaN), u = num(L.sunU, NaN), el = num(L.sunElevationDeg, NaN);
  if (!(e === e && nn === nn && u === u)) {
    if (Number.isFinite(n.time)) { const s = sunPosition(n.time, view.lat, view.lon), se = s.elevation * RAD, sa = s.azimuth * RAD; el = s.elevation; u = Math.sin(se); e = Math.cos(se) * Math.sin(sa); nn = Math.cos(se) * Math.cos(sa); }
    else { el = 50; u = Math.sin(50 * RAD); e = Math.cos(50 * RAD) * 0.6; nn = -Math.cos(50 * RAD) * 0.8; }
  }
  if (el !== el) el = Math.asin(clamp(u, -1, 1)) / RAD;
  // the moon: east, north, up and the lit fraction of its disc
  let moonV = [num(L.moonE, 0), num(L.moonN, 0), num(L.moonU, -1), num(L.moonIllumination, 0.5)];
  if (L.moonU === undefined && Number.isFinite(n.time)) { const m = moonPosition(n.time, view.lat, view.lon), ma = m.altitude * RAD, mz = m.azimuth * RAD; moonV = [Math.cos(ma) * Math.sin(mz), Math.cos(ma) * Math.cos(mz), Math.sin(ma), moonPhase(n.time).illumination]; }
  if (!lit) { el = 50; e = -0.45; nn = 0.45; u = 0.77; }
  let above = 0;
  for (const k of n.clouds) if (k.topM > (view.altM || 0)) above = Math.max(above, k.cover);
  const cover = clamp(num(L.cloudCoverAbove, num(L.cloudCover, above)), 0, 1), inCloud = n.inCloud;
  const day = smooth(-6, 6, el), twilight = smooth(-14, -3, el) * (1 - smooth(1, 12, el));
  const airmass = el > 0 ? 1 / (Math.sin(el * RAD) + 0.15 * Math.pow(el + 3.885, -1.253)) : 40;
  const sunI = lit ? num(L.sunIntensity, (el > -0.8 ? Math.pow(0.8, Math.min(airmass, 40) - 1) : 0) * (1 - 0.9 * cover)) : 0;
  const ambI = lit ? clamp(0.06 + 0.5 * Math.pow(clamp(num(L.ambientIntensity, day * (0.3 + 0.7 * Math.max(0, Math.sin(el * RAD))) * (1 - 0.6 * cover)), 0, 1), 0.6), 0.06, 0.6) : 1;
  const sunTint = temperature(num(L.colourTemperatureK, 2000 + 3800 * (1 - Math.exp(-Math.max(el, 0) / 9))));
  // sky: day blue, a warm band at twilight, near black at night; grey under cloud
  let zenith = lerp3(lerp3([0.008, 0.012, 0.03], [0.1, 0.13, 0.3], twilight), [0.16, 0.38, 0.82], day);
  let horizonC = lerp3(lerp3([0.02, 0.03, 0.055], [0.86, 0.5, 0.3], twilight), [0.66, 0.79, 0.93], day);
  const grey = 0.12 + 0.55 * day, g = cover * 0.85;
  zenith = lerp3(zenith, [grey * 0.9, grey * 0.93, grey], g); horizonC = lerp3(horizonC, [grey * 1.05, grey * 1.07, grey * 1.1], g);
  // haze: density at sea level and a scale height. A stated visibility is the visibility at the ground below the camera; a density
  // from the weather module is the density at the eye.
  const alt = Math.max(0, view.altM || 0), groundM = Math.max(0, /** @type {any} */ (view).groundM || 0), eye = num(L.fogDensityPerM, 0);
  const surface = Number.isFinite(n.visibilityM) && n.visibilityM > 0 ? 3 / n.visibilityM : 0;
  const hazeScaleM = n.hazeScaleM || (surface > 3 / 3000 ? 500 : 2500);
  const fogSea = n.mode === 'map' ? 0 : clamp(surface ? surface * Math.exp(groundM / hazeScaleM) : eye ? eye * Math.exp(Math.min(alt, 3 * hazeScaleM) / hazeScaleM) : 3 / 90000, 3 / 400000, 0.5);
  const fogDensity = fogSea * Math.exp(-alt / hazeScaleM);
  const cloudGrey = 0.25 + 0.65 * day;
  const fog = lerp3(lerp3(horizonC, [grey, grey, grey * 1.03], clamp(fogDensity * 1500, 0, 0.8)), [cloudGrey, cloudGrey, cloudGrey * 1.02], inCloud);
  const f = view.frame, dir = (a, b, c) => (f ? [a * f[0] + b * f[3] + c * f[6], a * f[1] + b * f[4] + c * f[7], a * f[2] + b * f[5] + c * f[8]] : [a, b, c]);
  const amb = lit ? lerp3([0.55, 0.62, 0.8], [0.8, 0.84, 0.9], day).map(v => v * ambI) : [0.72, 0.72, 0.72];
  return {
    lit, sunElevationDeg: el, day, twilight, night: lit ? 1 - smooth(-8, 2, el) : 0,
    /** Unit vector at the sun: east/north/up at the camera and earth-centred. */
    sunEnu: [e, nn, u], sun: dir(e, nn, u),
    moon: dir(moonV[0], moonV[1], moonV[2]), moonLight: moonV[3] * (moonV[2] > 0 ? 1 : 0),
    sunColour: lit ? sunTint.map(v => v * sunI * 0.85) : [0.4, 0.4, 0.4], sunTint, sunIntensity: sunI,
    ambient: amb, zenith, horizon: horizonC, fog,
    /** Haze density at the eye and at sea level (1/m), and the height over which it thins by e. */
    fogDensity, fogSea, hazeScaleM, inCloud, cover,
    stars: n.layers.stars ? num(L.starVisibility, 1 - smooth(-14, -5, el)) * (1 - cover) : 0, lightning: num(L.lightning, 0),
  };
}
